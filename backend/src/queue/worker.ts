import { Worker, type Job } from 'bullmq';
import { env } from '../config/env';
import { bullRedis } from '../lib/redis';
import { subLogger } from '../lib/logger';
import { EMAIL_QUEUE, MAINTENANCE_QUEUE, type EmailJobData, type MaintenanceJobData } from './queues';
import { processEmailJob } from './processor';
import { sweepForDrift } from './sweeper';

const log = subLogger('worker');

/**
 * Concurrency is controlled at three independent levels, and the README maps
 * each one to the behaviour it protects:
 *
 *   1. `concurrency`      - how many jobs THIS process handles at once.
 *   2. queue `limiter`    - a global ceiling across every worker, so scaling
 *                           out replicas cannot multiply outbound volume.
 *   3. per-sender quota   - the hourly cap plus the minimum-gap pacer, applied
 *                           inside the processor (rateLimiter.ts / pacer.ts).
 *
 * Levels 1 and 2 protect our own infrastructure; level 3 protects the sending
 * reputation of each individual mailbox.
 */
export function startEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE,
    (job: Job<EmailJobData>, token?: string) => processEmailJob(job, token),
    {
      connection: bullRedis,
      concurrency: env.WORKER_CONCURRENCY,
      limiter: {
        max: env.QUEUE_LIMITER_MAX,
        duration: env.QUEUE_LIMITER_DURATION,
      },
      // Required so the processor can call `job.moveToDelayed(at, token)`.
      autorun: true,
    },
  );

  worker.on('failed', (job, error) => {
    // A rate-limit or pacing deferral surfaces here as a DelayedError. It is
    // normal control flow, not a failure, so it must not be logged as one.
    if (error?.name === 'DelayedError') return;
    log.error(
      { jobId: job?.id, attempts: job?.attemptsMade, err: error?.message },
      'Job failed',
    );
  });

  worker.on('error', (error) => {
    log.error({ err: error.message }, 'Worker error');
  });

  worker.on('stalled', (jobId) => {
    log.warn({ jobId }, 'Job stalled and will be reclaimed');
  });

  log.info(
    {
      concurrency: env.WORKER_CONCURRENCY,
      limiter: `${env.QUEUE_LIMITER_MAX}/${env.QUEUE_LIMITER_DURATION}ms`,
    },
    'Email worker started',
  );

  return worker;
}

/** Separate worker for maintenance jobs so a slow sweep never blocks sends. */
export function startMaintenanceWorker(): Worker<MaintenanceJobData> {
  const worker = new Worker<MaintenanceJobData>(
    MAINTENANCE_QUEUE,
    async () => sweepForDrift(),
    { connection: bullRedis, concurrency: 1 },
  );

  worker.on('error', (error) => {
    log.error({ err: error.message }, 'Maintenance worker error');
  });

  log.info('Maintenance worker started');
  return worker;
}
