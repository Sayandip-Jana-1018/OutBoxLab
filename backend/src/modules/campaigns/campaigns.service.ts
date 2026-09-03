import { randomUUID } from 'node:crypto';
import { prisma } from '../../db/prisma';
import { badRequest, notFound } from '../../lib/errors';
import { subLogger } from '../../lib/logger';
import { getRateWindowMs } from '../../lib/clock';
import { paginate } from '../../lib/http';
import { render } from '../../services/template';
import { publishToUser } from '../../services/events';
import { enqueueEmailsBulk, removeEmailJob } from '../../queue/scheduler';
import { requeueCampaign, PENDING_STATUSES } from '../../queue/reconciler';
import { getSenderOrThrow } from '../senders/senders.service';
import { normaliseRecipients, parseCsvRecipients, type RecipientParseResult } from './recipients';
import { forecastSchedule, layOutSendTimes } from './schedulePlanner';
import type {
  CreateCampaignInput,
  ListCampaignsQuery,
  PreviewScheduleInput,
} from './campaigns.schemas';

const log = subLogger('campaigns');

/** Insert in chunks so a huge campaign cannot blow the statement size limit. */
const INSERT_CHUNK = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export interface CreateCampaignResult {
  campaign: {
    id: string;
    name: string;
    status: string;
    totalRecipients: number;
    startAt: Date;
    delayBetweenEmailsMs: number;
    hourlyLimit: number;
  };
  scheduled: number;
  enqueued: number;
  skipped: {
    invalid: RecipientParseResult['invalid'];
    duplicates: string[];
  };
  firstSendAt: string;
  lastSendAt: string;
}

/**
 * Create a campaign and schedule every recipient.
 *
 * Ordering is important: the database write is committed *first*, and only then
 * are jobs pushed to Redis. If the process dies in between, Postgres holds
 * SCHEDULED rows with no queue entry - which the boot reconciler and the drift
 * sweeper both detect and repair. The reverse order would produce jobs
 * referencing rows that never existed.
 */
export async function createCampaign(
  userId: string,
  input: CreateCampaignInput,
): Promise<CreateCampaignResult> {
  const sender = await getSenderOrThrow(userId, input.senderId);

  if (!sender.isActive) {
    throw badRequest('That mailbox is deactivated. Reactivate it or pick another one.');
  }

  const parsed: RecipientParseResult = input.csv?.trim()
    ? parseCsvRecipients(input.csv)
    : normaliseRecipients(input.recipients ?? []);

  const startAt = input.startAt ?? new Date();
  const hourlyLimit = input.hourlyLimit ?? sender.hourlyLimit;

  const sendTimes = layOutSendTimes(
    parsed.recipients.length,
    startAt,
    input.delayBetweenEmailsMs,
    sender.minDelayMs,
  );

  const campaignId = randomUUID();

  // Ids are generated up front so the rows and the queue jobs share the same
  // identifiers without needing a second read after insert.
  const rows = parsed.recipients.map((recipient, index) => {
    const vars = { ...recipient.vars, email: recipient.email };
    return {
      id: randomUUID(),
      userId,
      campaignId,
      senderId: sender.id,
      to: recipient.email,
      vars,
      subject: render(input.subjectTemplate, vars),
      body: render(input.bodyTemplate, vars),
      sendAt: sendTimes[index] ?? startAt,
      hourlyLimit,
      status: 'SCHEDULED' as const,
    };
  });

  await prisma.$transaction(async (tx) => {
    await tx.campaign.create({
      data: {
        id: campaignId,
        userId,
        senderId: sender.id,
        name: input.name,
        subjectTemplate: input.subjectTemplate,
        bodyTemplate: input.bodyTemplate,
        startAt,
        delayBetweenEmailsMs: input.delayBetweenEmailsMs,
        hourlyLimit,
        status: 'SCHEDULED',
        totalRecipients: rows.length,
      },
    });

    for (const batch of chunk(rows, INSERT_CHUNK)) {
      await tx.scheduledEmail.createMany({ data: batch });
      await tx.emailEvent.createMany({
        data: batch.map((row) => ({
          emailId: row.id,
          type: 'QUEUED' as const,
          message: `Scheduled for ${row.sendAt.toISOString()}`,
          payload: { sendAt: row.sendAt.toISOString(), hourlyLimit },
        })),
      });
    }
  });

  const enqueued = await enqueueEmailsBulk(
    rows.map((row) => ({
      emailId: row.id,
      userId,
      senderId: row.senderId,
      campaignId,
      sendAt: row.sendAt,
    })),
  );

  log.info(
    { campaignId, recipients: rows.length, enqueued, senderId: sender.id },
    'Campaign scheduled',
  );

  await publishToUser(userId, {
    type: 'campaign.progress',
    campaignId,
    sent: 0,
    total: rows.length,
    at: new Date().toISOString(),
  });

  const first = rows[0];
  const last = rows[rows.length - 1];

  return {
    campaign: {
      id: campaignId,
      name: input.name,
      status: 'SCHEDULED',
      totalRecipients: rows.length,
      startAt,
      delayBetweenEmailsMs: input.delayBetweenEmailsMs,
      hourlyLimit,
    },
    scheduled: rows.length,
    enqueued,
    skipped: { invalid: parsed.invalid, duplicates: parsed.duplicates },
    firstSendAt: (first?.sendAt ?? startAt).toISOString(),
    lastSendAt: (last?.sendAt ?? startAt).toISOString(),
  };
}

export async function listCampaigns(userId: string, query: ListCampaignsQuery) {
  const where = {
    userId,
    ...(query.status ? { status: query.status } : {}),
  };

  const [total, campaigns] = await Promise.all([
    prisma.campaign.count({ where }),
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        sender: { select: { id: true, label: true, fromEmail: true } },
      },
    }),
  ]);

  // One grouped query for the whole page instead of N per-campaign counts.
  const counts = await prisma.scheduledEmail.groupBy({
    by: ['campaignId', 'status'],
    where: { campaignId: { in: campaigns.map((campaign) => campaign.id) } },
    _count: { _all: true },
  });

  const byCampaign = new Map<string, Record<string, number>>();
  for (const row of counts) {
    if (!row.campaignId) continue;
    const bucket = byCampaign.get(row.campaignId) ?? {};
    bucket[row.status] = row._count._all;
    byCampaign.set(row.campaignId, bucket);
  }

  return paginate(
    campaigns.map((campaign) => ({
      ...campaign,
      counts: byCampaign.get(campaign.id) ?? {},
    })),
    total,
    query.page,
    query.pageSize,
  );
}

export async function getCampaign(userId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId },
    include: {
      sender: { select: { id: true, label: true, fromEmail: true, minDelayMs: true } },
    },
  });

  if (!campaign) throw notFound('Campaign');

  const grouped = await prisma.scheduledEmail.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {};
  for (const row of grouped) {
    counts[row.status] = row._count._all;
  }

  const [nextUp, timeline] = await Promise.all([
    prisma.scheduledEmail.findFirst({
      where: { campaignId, status: { in: [...PENDING_STATUSES] } },
      orderBy: { sendAt: 'asc' },
      select: { id: true, to: true, sendAt: true, status: true },
    }),
    // Powers the campaign timeline visualiser.
    prisma.scheduledEmail.findMany({
      where: { campaignId },
      orderBy: { sendAt: 'asc' },
      take: 300,
      select: {
        id: true,
        to: true,
        status: true,
        sendAt: true,
        sentAt: true,
        deferredCount: true,
        previewUrl: true,
      },
    }),
  ]);

  return { campaign, counts, nextUp, timeline };
}

async function loadOwnedCampaign(userId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId },
    select: { id: true, status: true },
  });
  if (!campaign) throw notFound('Campaign');
  return campaign;
}

/**
 * Pause a campaign.
 *
 * The queue jobs are intentionally left in place. The processor checks campaign
 * status on every pass and parks the job for a few seconds instead of sending,
 * so pausing is instant, resuming needs no re-creation, and nothing is lost if
 * the process restarts while paused.
 */
export async function pauseCampaign(userId: string, campaignId: string) {
  const campaign = await loadOwnedCampaign(userId, campaignId);

  if (!['SCHEDULED', 'RUNNING'].includes(campaign.status)) {
    throw badRequest(`A ${campaign.status.toLowerCase()} campaign cannot be paused`);
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'PAUSED' },
  });

  return { status: 'PAUSED' as const };
}

export async function resumeCampaign(userId: string, campaignId: string) {
  const campaign = await loadOwnedCampaign(userId, campaignId);

  if (campaign.status !== 'PAUSED') {
    throw badRequest('Only a paused campaign can be resumed');
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'RUNNING' },
  });

  // Replace the parked jobs so delivery restarts immediately rather than
  // waiting out the remaining park interval.
  const requeued = await requeueCampaign(campaignId);

  return { status: 'RUNNING' as const, requeued };
}

export async function cancelCampaign(userId: string, campaignId: string) {
  await loadOwnedCampaign(userId, campaignId);

  const pending = await prisma.scheduledEmail.findMany({
    where: { campaignId, status: { in: [...PENDING_STATUSES] } },
    select: { id: true },
  });

  // Remove the queue entries first so no worker can pick one up between the
  // status update and the cleanup.
  await Promise.all(pending.map((email) => removeEmailJob(email.id)));

  await prisma.$transaction([
    prisma.scheduledEmail.updateMany({
      where: { campaignId, status: { in: [...PENDING_STATUSES] } },
      data: { status: 'CANCELLED' },
    }),
    prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'CANCELLED' },
    }),
  ]);

  log.info({ campaignId, cancelled: pending.length }, 'Campaign cancelled');
  return { cancelled: pending.length };
}

/** Forecast a schedule before the campaign is created (compose preview). */
export async function previewSchedule(input: PreviewScheduleInput) {
  const windowMs = await getRateWindowMs();

  return forecastSchedule({
    recipientCount: input.recipientCount,
    startAt: input.startAt ?? new Date(),
    delayBetweenEmailsMs: input.delayBetweenEmailsMs,
    minDelayMs: input.minDelayMs,
    hourlyLimit: input.hourlyLimit,
    windowMs,
  });
}
