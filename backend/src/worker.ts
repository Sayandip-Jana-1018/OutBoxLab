import { env } from './config/env';
import { logger } from './lib/logger';
import { closeRedis } from './lib/redis';
import { closeDatabase } from './db/prisma';
import { closeQueues } from './queue/queues';
import { reconcileOnBoot } from './queue/reconciler';
import { registerSweeper } from './queue/sweeper';
import { startEmailWorker, startMaintenanceWorker } from './queue/worker';
import { closeTransports } from './services/mailer';

/**
 * Worker process entrypoint.
 *
 * The worker runs separately from the API on purpose:
 *
 *   - A burst of sends cannot make the dashboard unresponsive, and a slow HTTP
 *     request cannot delay a send.
 *   - Workers scale horizontally and independently (`npm run dev:worker` any
 *     number of times); the global queue limiter keeps total volume in check.
 *   - The restart demo is honest: stopping the worker stops delivery while the
 *     API stays up, and starting it again drains the backlog from Postgres.
 */
async function main(): Promise<void> {
  logger.info(
    { concurrency: env.WORKER_CONCURRENCY, env: env.NODE_ENV },
    'OutboxLab worker starting',
  );

  // Rebuild the queue from the database before consuming anything, so an
  // email whose sendAt passed while we were down goes out immediately.
  await reconcileOnBoot();
  await registerSweeper();

  const emailWorker = startEmailWorker();
  const maintenanceWorker = startMaintenanceWorker();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Worker shutting down');

    try {
      // `close()` waits for in-flight jobs to finish, so no email is abandoned
      // half-sent during a deploy or a Ctrl+C.
      await Promise.allSettled([emailWorker.close(), maintenanceWorker.close()]);
      closeTransports();
      await closeQueues();
      await closeDatabase();
      await closeRedis();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: Error) => {
  logger.fatal({ err: error.message, stack: error.stack }, 'Worker failed to start');
  process.exit(1);
});
