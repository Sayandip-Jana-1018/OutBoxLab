import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { badRequest, notFound } from '../../lib/errors';
import { paginate } from '../../lib/http';
import { subLogger } from '../../lib/logger';
import { recordEmailEvent } from '../../services/events';
import { enqueueEmail, removeEmailJob, rescheduleEmail as requeueAt } from '../../queue/scheduler';
import { PENDING_STATUSES } from '../../queue/reconciler';
import type { ListEmailsQuery, RescheduleEmailInput } from './emails.schemas';

const log = subLogger('emails');

const PENDING = ['SCHEDULED', 'PROCESSING', 'DEFERRED'] as const;
const HISTORY = ['SENT', 'FAILED', 'CANCELLED'] as const;

/** Minimum query length before full-text ranking is worth using. */
const FTS_MIN_LENGTH = 3;

interface EmailRow {
  id: string;
  to: string;
  subject: string;
  status: string;
  sendAt: Date;
  sentAt: Date | null;
  previewUrl: string | null;
  messageId: string | null;
  deferredCount: number;
  attempts: number;
  lastError: string | null;
  campaignId: string | null;
  senderId: string;
  createdAt: Date;
  rank?: number;
}

/**
 * The weighted tsvector expression. It must match the functional GIN index
 * created in the migration *character for character*, otherwise Postgres
 * cannot use the index and silently falls back to a sequential scan.
 */
const SEARCH_VECTOR = Prisma.sql`(
  setweight(to_tsvector('english', coalesce("to", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("subject", '')), 'B') ||
  setweight(to_tsvector('english', coalesce("body", '')), 'C')
)`;

function resolveStatuses(query: ListEmailsQuery): readonly string[] | null {
  if (query.status?.length) return query.status;
  if (query.view === 'pending') return PENDING;
  if (query.view === 'history') return HISTORY;
  return null;
}

/**
 * List and search emails.
 *
 * Search runs in Postgres rather than in a separate Elasticsearch mirror.
 * `websearch_to_tsquery` gives users quoted phrases and `-exclusions` for
 * free, results are ranked (recipient beats subject beats body), and there is
 * no dual-write consistency window to reason about. Queries shorter than three
 * characters fall back to an indexed prefix match on the address, because
 * tsquery cannot usefully match a two-letter fragment.
 */
export async function listEmails(userId: string, query: ListEmailsQuery) {
  const statuses = resolveStatuses(query);
  const conditions: Prisma.Sql[] = [Prisma.sql`"userId" = ${userId}::uuid`];

  if (statuses) {
    conditions.push(Prisma.sql`status::text = ANY(${[...statuses]}::text[])`);
  }
  if (query.campaignId) {
    conditions.push(Prisma.sql`"campaignId" = ${query.campaignId}::uuid`);
  }
  if (query.senderId) {
    conditions.push(Prisma.sql`"senderId" = ${query.senderId}::uuid`);
  }

  const term = query.q;
  const useFts = Boolean(term && term.length >= FTS_MIN_LENGTH);

  if (term) {
    conditions.push(
      useFts
        ? Prisma.sql`(${SEARCH_VECTOR} @@ websearch_to_tsquery('english', ${term})
             OR lower("to") LIKE ${`${term.toLowerCase()}%`})`
        : Prisma.sql`lower("to") LIKE ${`${term.toLowerCase()}%`}`,
    );
  }

  const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

  // Ranking only makes sense when there is a query to rank against.
  const rankExpr = useFts
    ? Prisma.sql`ts_rank(${SEARCH_VECTOR}, websearch_to_tsquery('english', ${term}))`
    : Prisma.sql`0`;

  const direction = query.order === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const orderBy =
    query.sort === 'relevance' && useFts
      ? Prisma.sql`rank DESC, "sendAt" ASC`
      : query.sort === 'createdAt'
        ? Prisma.sql`"createdAt" ${direction}`
        : Prisma.sql`"sendAt" ${direction}`;

  const offset = (query.page - 1) * query.pageSize;

  const [rows, countResult] = await Promise.all([
    prisma.$queryRaw<EmailRow[]>(Prisma.sql`
      SELECT
        id, "to", subject, status, "sendAt", "sentAt", "previewUrl", "messageId",
        "deferredCount", attempts, "lastError", "campaignId", "senderId", "createdAt",
        ${rankExpr} AS rank
      FROM "scheduled_emails"
      ${where}
      ORDER BY ${orderBy}
      LIMIT ${query.pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT count(*)::bigint AS count FROM "scheduled_emails" ${where}
    `),
  ]);

  const total = Number(countResult[0]?.count ?? 0);

  return paginate(rows, total, query.page, query.pageSize);
}

/** Single email plus its full audit trail (powers the detail drawer). */
export async function getEmail(userId: string, emailId: string) {
  const email = await prisma.scheduledEmail.findFirst({
    where: { id: emailId, userId },
    include: {
      sender: { select: { id: true, label: true, fromEmail: true, hourlyLimit: true } },
      campaign: { select: { id: true, name: true, status: true } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!email) throw notFound('Email');
  return email;
}

async function loadPendingEmail(userId: string, emailId: string) {
  const email = await prisma.scheduledEmail.findFirst({
    where: { id: emailId, userId },
    select: {
      id: true,
      userId: true,
      senderId: true,
      campaignId: true,
      status: true,
      sendAt: true,
    },
  });
  if (!email) throw notFound('Email');
  return email;
}

/** Move a single email to a new send time. */
export async function rescheduleEmail(
  userId: string,
  emailId: string,
  input: RescheduleEmailInput,
) {
  const email = await loadPendingEmail(userId, emailId);

  if (!PENDING_STATUSES.includes(email.status as (typeof PENDING_STATUSES)[number])) {
    throw badRequest(`A ${email.status.toLowerCase()} email cannot be rescheduled`);
  }

  const updated = await prisma.scheduledEmail.update({
    where: { id: emailId },
    data: { sendAt: input.sendAt, status: 'SCHEDULED' },
  });

  await requeueAt({
    emailId,
    userId: email.userId,
    senderId: email.senderId,
    campaignId: email.campaignId,
    sendAt: input.sendAt,
  });

  await recordEmailEvent({
    emailId,
    userId: email.userId,
    campaignId: email.campaignId,
    senderId: email.senderId,
    type: 'RESCHEDULED',
    status: 'SCHEDULED',
    message: `Moved to ${input.sendAt.toISOString()}`,
    payload: { from: email.sendAt.toISOString(), to: input.sendAt.toISOString() },
  });

  return updated;
}

export async function cancelEmail(userId: string, emailId: string) {
  const email = await loadPendingEmail(userId, emailId);

  if (!PENDING_STATUSES.includes(email.status as (typeof PENDING_STATUSES)[number])) {
    throw badRequest(`A ${email.status.toLowerCase()} email cannot be cancelled`);
  }

  // Remove the job first; if it is already active the processor's status guard
  // stops the send when it re-reads the row.
  await removeEmailJob(emailId);

  const updated = await prisma.scheduledEmail.update({
    where: { id: emailId },
    data: { status: 'CANCELLED' },
  });

  await recordEmailEvent({
    emailId,
    userId: email.userId,
    campaignId: email.campaignId,
    senderId: email.senderId,
    type: 'CANCELLED',
    status: 'CANCELLED',
    message: 'Cancelled by user',
  });

  return updated;
}

/**
 * Put a failed or cancelled email back in the queue.
 * `attempts` is reset so the retry budget applies to this new run.
 */
export async function retryEmail(userId: string, emailId: string) {
  const email = await loadPendingEmail(userId, emailId);

  if (!['FAILED', 'CANCELLED'].includes(email.status)) {
    throw badRequest('Only failed or cancelled emails can be retried');
  }

  const sendAt = new Date();

  const updated = await prisma.scheduledEmail.update({
    where: { id: emailId },
    data: { status: 'SCHEDULED', sendAt, attempts: 0, lastError: null },
  });

  await removeEmailJob(emailId);
  await enqueueEmail({
    emailId,
    userId: email.userId,
    senderId: email.senderId,
    campaignId: email.campaignId,
    sendAt,
  });

  await recordEmailEvent({
    emailId,
    userId: email.userId,
    campaignId: email.campaignId,
    senderId: email.senderId,
    type: 'RESCHEDULED',
    status: 'SCHEDULED',
    message: 'Retried by user',
  });

  log.info({ emailId }, 'Email retried by user');
  return updated;
}
