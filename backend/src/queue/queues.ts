import { Queue } from 'bullmq';
import { bullRedis } from '../lib/redis';
import { env } from '../config/env';

// BullMQ reserves ':' as its internal Redis key separator and rejects it in
// queue names, so these use hyphens.
export const EMAIL_QUEUE = 'outboxlab-emails';
export const MAINTENANCE_QUEUE = 'outboxlab-maintenance';

/**
 * Payload carried by every send job.
 *
 * Deliberately minimal: it holds identifiers, not content. The worker always
 * re-reads the row from Postgres, so a job that was enqueued before the user
 * rescheduled or cancelled the email cannot act on stale content. (The earlier
 * iteration of this project embedded subject/body/hourlyLimit in the payload
 * and could therefore send outdated copy after an edit.)
 */
export interface EmailJobData {
  emailId: string;
  userId: string;
  senderId: string;
  campaignId?: string | null;
  /**
   * Set when the pacer has already reserved this job's send slot. Prevents a
   * deferred job from reserving a *second*, later slot when it wakes up, which
   * would make it drift forward forever.
   */
  reservedSlotMs?: number;
}

export interface MaintenanceJobData {
  reason: 'sweep';
}

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE, {
  connection: bullRedis,
  defaultJobOptions: {
    // Retries apply to genuine delivery failures only. A rate-limit deferral
    // uses moveToDelayed + DelayedError, which BullMQ does not count as an
    // attempt - so a throttled email never burns its retry budget.
    attempts: env.MAX_JOB_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 24 * 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

export const maintenanceQueue = new Queue<MaintenanceJobData>(MAINTENANCE_QUEUE, {
  connection: bullRedis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 20 },
    removeOnFail: { count: 50 },
  },
});

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([emailQueue.close(), maintenanceQueue.close()]);
}
