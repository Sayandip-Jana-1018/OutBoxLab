import { prisma } from '../db/prisma';
import { subLogger } from '../lib/logger';
import { enqueueEmailsBulk } from './scheduler';
import { emailQueue } from './queues';

const log = subLogger('reconciler');

/** Statuses that still owe a delivery attempt. */
export const PENDING_STATUSES = ['SCHEDULED', 'PROCESSING', 'DEFERRED'] as const;

const BATCH_SIZE = 500;

export interface ReconcileReport {
  scanned: number;
  requeued: number;
  resetFromProcessing: number;
  durationMs: number;
}

/**
 * Rebuild the queue from Postgres on boot.
 *
 * ---------------------------------------------------------------------------
 * How persistence on restart works
 * ---------------------------------------------------------------------------
 * Postgres is the source of truth; Redis only ever holds *derived* state. So
 * "what happens if the server restarts" has a single answer: read every email
 * that has not reached a terminal status and re-enqueue it.
 *
 * Three properties make this safe:
 *
 *   1. `jobId` is the email's primary key, so re-adding a job that survived
 *      the restart is a no-op instead of a duplicate.
 *   2. Emails whose `sendAt` has already passed are enqueued with delay 0 and
 *      catch up immediately, in `sendAt` order.
 *   3. Rows stuck in PROCESSING (the process died mid-send) are returned to
 *      SCHEDULED first, so they are eligible again.
 *
 * This recovers from an ordinary restart *and* from a completely wiped Redis
 * (`docker compose down -v`), which the plain "Redis is the queue" design
 * cannot do.
 *
 * Trade-off: delivery is at-least-once. If the process is killed in the narrow
 * window after SMTP accepted a message but before the status update committed,
 * that email is retried and could arrive twice. Guaranteeing exactly-once
 * would need a transactional outbox with a provider-side idempotency key,
 * which Ethereal does not offer.
 */
export async function reconcileOnBoot(): Promise<ReconcileReport> {
  const startedAt = Date.now();
  log.info('Reconciling queue from Postgres...');

  // Interrupted mid-send: make them schedulable again.
  const { count: resetFromProcessing } = await prisma.scheduledEmail.updateMany({
    where: { status: 'PROCESSING' },
    data: { status: 'SCHEDULED' },
  });

  if (resetFromProcessing > 0) {
    log.warn(
      { count: resetFromProcessing },
      'Recovered emails that were mid-flight when the process stopped',
    );
  }

  let scanned = 0;
  let requeued = 0;
  let cursor: string | undefined;

  // Keyset pagination: a campaign with hundreds of thousands of recipients
  // must not be loaded into memory in one go.
  for (;;) {
    const batch = await prisma.scheduledEmail.findMany({
      where: { status: { in: [...PENDING_STATUSES] } },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        userId: true,
        senderId: true,
        campaignId: true,
        sendAt: true,
      },
    });

    if (batch.length === 0) break;

    scanned += batch.length;
    requeued += await enqueueEmailsBulk(
      batch.map((email) => ({
        emailId: email.id,
        userId: email.userId,
        senderId: email.senderId,
        campaignId: email.campaignId,
        sendAt: email.sendAt,
      })),
    );

    cursor = batch[batch.length - 1]?.id;
    if (batch.length < BATCH_SIZE) break;
  }

  const report: ReconcileReport = {
    scanned,
    requeued,
    resetFromProcessing,
    durationMs: Date.now() - startedAt,
  };

  if (scanned === 0) {
    log.info(report, 'Reconciliation complete: nothing pending');
  } else {
    log.info(report, `Reconciliation complete: ${requeued}/${scanned} emails back in the queue`);
  }

  // Mark any campaign whose work is fully done but was interrupted before the
  // status flip, so the dashboard is accurate straight after a restart.
  await settleFinishedCampaigns();

  return report;
}

async function settleFinishedCampaigns(): Promise<void> {
  const stale = await prisma.campaign.findMany({
    where: { status: { in: ['SCHEDULED', 'RUNNING'] } },
    select: { id: true },
  });

  for (const campaign of stale) {
    const pending = await prisma.scheduledEmail.count({
      where: { campaignId: campaign.id, status: { in: [...PENDING_STATUSES] } },
    });
    if (pending === 0) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'COMPLETED' },
      });
    }
  }
}

/**
 * Re-enqueue the pending emails of a single campaign.
 * Used when a paused campaign resumes.
 */
export async function requeueCampaign(campaignId: string): Promise<number> {
  const emails = await prisma.scheduledEmail.findMany({
    where: { campaignId, status: { in: [...PENDING_STATUSES] } },
    select: { id: true, userId: true, senderId: true, campaignId: true, sendAt: true },
  });

  // Drop any parked jobs so they pick up the new (unpaused) state immediately
  // instead of waiting out their park interval.
  await Promise.all(
    emails.map(async (email) => {
      const job = await emailQueue.getJob(email.id);
      if (job) {
        await job.remove().catch(() => undefined);
      }
    }),
  );

  return enqueueEmailsBulk(
    emails.map((email) => ({
      emailId: email.id,
      userId: email.userId,
      senderId: email.senderId,
      campaignId: email.campaignId,
      sendAt: email.sendAt,
    })),
  );
}
