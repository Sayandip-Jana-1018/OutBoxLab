import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { subLogger } from '../lib/logger';
import { emailQueue, maintenanceQueue } from './queues';
import { enqueueEmail } from './scheduler';
import { PENDING_STATUSES } from './reconciler';

const log = subLogger('sweeper');

const SWEEP_JOB_NAME = 'sweep';
const SWEEP_SCHEDULER_ID = 'outboxlab-drift-sweeper';

/** Emails due within this horizon are the ones worth checking. */
const LOOKAHEAD_MS = 10 * 60 * 1000;
const MAX_PER_SWEEP = 1000;

export interface SweepReport {
  checked: number;
  restored: number;
}

/**
 * Drift sweeper.
 *
 * ---------------------------------------------------------------------------
 * Why boot reconciliation alone is not enough
 * ---------------------------------------------------------------------------
 * Reconciling on boot fixes clean restarts. It does nothing for drift that
 * appears *while the process is running*:
 *
 *   - Redis was flushed, evicted or failed over without the API restarting.
 *   - A job was removed by hand from Bull Board.
 *   - An enqueue was lost to a transient Redis disconnect.
 *
 * In all of those cases Postgres still says "this email is scheduled" while
 * Redis has no job for it, and the email would silently never send. This sweep
 * runs on an interval, compares the two, and restores anything missing.
 *
 * It only inspects emails due inside a short horizon, so the cost stays
 * proportional to imminent work rather than to the whole backlog.
 */
export async function sweepForDrift(): Promise<SweepReport> {
  const horizon = new Date(Date.now() + LOOKAHEAD_MS);

  const candidates = await prisma.scheduledEmail.findMany({
    where: {
      status: { in: [...PENDING_STATUSES] },
      sendAt: { lte: horizon },
    },
    orderBy: { sendAt: 'asc' },
    take: MAX_PER_SWEEP,
    select: {
      id: true,
      userId: true,
      senderId: true,
      campaignId: true,
      sendAt: true,
    },
  });

  if (candidates.length === 0) {
    return { checked: 0, restored: 0 };
  }

  // One pipelined existence check instead of N round-trips.
  const jobs = await Promise.all(candidates.map((email) => emailQueue.getJob(email.id)));

  let restored = 0;
  for (const [index, job] of jobs.entries()) {
    if (job) continue;

    const email = candidates[index];
    if (!email) continue;

    await enqueueEmail({
      emailId: email.id,
      userId: email.userId,
      senderId: email.senderId,
      campaignId: email.campaignId,
      sendAt: email.sendAt,
    });
    restored += 1;

    log.warn(
      { emailId: email.id, sendAt: email.sendAt.toISOString() },
      'Restored an email that was present in Postgres but missing from Redis',
    );
  }

  if (restored > 0) {
    log.warn({ checked: candidates.length, restored }, 'Drift sweep restored missing jobs');
  } else {
    log.debug({ checked: candidates.length }, 'Drift sweep found no drift');
  }

  return { checked: candidates.length, restored };
}

/**
 * Register the repeating sweep with BullMQ's job scheduler.
 *
 * Using the queue's own scheduler rather than a local `setInterval` means the
 * sweep survives a worker restart, never double-fires when several workers are
 * running, and is visible in Bull Board like any other job.
 */
export async function registerSweeper(): Promise<void> {
  await maintenanceQueue.upsertJobScheduler(
    SWEEP_SCHEDULER_ID,
    { every: env.SWEEPER_INTERVAL_MS },
    { name: SWEEP_JOB_NAME, data: { reason: 'sweep' } },
  );

  log.info(
    { everyMs: env.SWEEPER_INTERVAL_MS },
    'Drift sweeper registered',
  );
}

export { SWEEP_JOB_NAME };
