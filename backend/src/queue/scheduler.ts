import { emailQueue, type EmailJobData } from './queues';
import { subLogger } from '../lib/logger';

const log = subLogger('scheduler');

/**
 * Enqueueing layer.
 *
 * ---------------------------------------------------------------------------
 * Zero cron, zero polling
 * ---------------------------------------------------------------------------
 * There is no `node-cron`, no `setInterval` sweep over "emails due now" and no
 * OS crontab anywhere in OutboxLab. Each email becomes exactly one BullMQ
 * *delayed job* whose delay is `sendAt - now`. Redis holds it in a sorted set
 * keyed by execution time and hands it to a worker at the right instant, so
 * the cost of having a million emails scheduled a month out is zero CPU.
 *
 * ---------------------------------------------------------------------------
 * Deterministic job ids
 * ---------------------------------------------------------------------------
 * `jobId` is always the `ScheduledEmail.id`. BullMQ ignores an `add()` for a
 * job id that already exists, which turns enqueueing into an idempotent
 * operation. That single property is what makes the boot reconciler and the
 * drift sweeper safe to run as often as we like: re-adding an email that is
 * already queued is a guaranteed no-op rather than a duplicate send.
 */

export interface EnqueueOptions {
  emailId: string;
  userId: string;
  senderId: string;
  campaignId?: string | null;
  sendAt: Date;
  /** Carried over when re-queueing a job that already holds a pacer slot. */
  reservedSlotMs?: number;
}

export async function enqueueEmail(options: EnqueueOptions): Promise<{
  jobId: string;
  delayMs: number;
  created: boolean;
}> {
  const delayMs = Math.max(0, options.sendAt.getTime() - Date.now());

  const data: EmailJobData = {
    emailId: options.emailId,
    userId: options.userId,
    senderId: options.senderId,
    campaignId: options.campaignId ?? null,
    ...(options.reservedSlotMs ? { reservedSlotMs: options.reservedSlotMs } : {}),
  };

  const existing = await emailQueue.getJob(options.emailId);
  if (existing) {
    return { jobId: options.emailId, delayMs, created: false };
  }

  const job = await emailQueue.add('send', data, {
    jobId: options.emailId,
    delay: delayMs,
  });

  log.debug(
    { emailId: options.emailId, delayMs, sendAt: options.sendAt.toISOString() },
    'Email enqueued',
  );

  return { jobId: job.id ?? options.emailId, delayMs, created: true };
}

/**
 * Enqueue many emails in one Redis round-trip.
 * Used when a campaign is created: 5,000 recipients should not mean 5,000
 * sequential network calls.
 */
export async function enqueueEmailsBulk(items: EnqueueOptions[]): Promise<number> {
  if (items.length === 0) return 0;

  const now = Date.now();
  const jobs = items.map((item) => ({
    name: 'send' as const,
    data: {
      emailId: item.emailId,
      userId: item.userId,
      senderId: item.senderId,
      campaignId: item.campaignId ?? null,
    } satisfies EmailJobData,
    opts: {
      jobId: item.emailId,
      delay: Math.max(0, item.sendAt.getTime() - now),
    },
  }));

  const added = await emailQueue.addBulk(jobs);
  log.info({ count: added.length }, 'Bulk-enqueued emails');
  return added.length;
}

/**
 * Move an already-scheduled email to a new time.
 * A delayed job's delay cannot be edited in place, so the old job is removed
 * and re-added under the same deterministic id.
 */
export async function rescheduleEmail(options: EnqueueOptions): Promise<void> {
  await removeEmailJob(options.emailId);
  await enqueueEmail(options);
  log.info(
    { emailId: options.emailId, sendAt: options.sendAt.toISOString() },
    'Email rescheduled',
  );
}

/**
 * Drop an email's job from the queue.
 * Safe to call for a job that is already gone, or that is currently active
 * (in which case BullMQ refuses removal and the processor's status guard stops
 * the send instead - Postgres remains the authority).
 */
export async function removeEmailJob(emailId: string): Promise<boolean> {
  try {
    const job = await emailQueue.getJob(emailId);
    if (!job) return false;
    await job.remove();
    return true;
  } catch (error) {
    log.debug(
      { emailId, err: (error as Error).message },
      'Job could not be removed (likely active); relying on DB status guard',
    );
    return false;
  }
}

/** Live queue depth, surfaced by /api/stats and /api/health. */
export async function queueCounts() {
  const counts = await emailQueue.getJobCounts(
    'waiting',
    'active',
    'delayed',
    'completed',
    'failed',
    'paused',
  );
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    paused: counts.paused ?? 0,
  };
}
