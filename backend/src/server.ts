import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { closeRedis } from './lib/redis';
import { closeDatabase, pingDatabase } from './db/prisma';
import { closeQueues } from './queue/queues';
import { reconcileOnBoot } from './queue/reconciler';
import { registerSweeper } from './queue/sweeper';
import { startEmailWorker, startMaintenanceWorker } from './queue/worker';
import { closeTransports } from './services/mailer';

/**
 * Combined API + worker entrypoint, for hosts that only give you one process.
 *
 * Running them apart (`index.ts` and `worker.ts`) is the better shape and what
 * the README describes: a send burst cannot make the dashboard unresponsive,
 * the two scale independently, and stopping delivery without stopping the UI is
 * what makes the restart demo legible.
 *
 * But several free tiers - Render's among them - only offer web services, and
 * a background worker costs money. Deploying just the API there would look
 * healthy and silently never deliver anything, which is the worst possible
 * failure. This entrypoint keeps the app honest on those platforms by running
 * the worker in-process.
 *
 * The trade-off is real and worth stating: the two now share a CPU and an event
 * loop, and if the platform sleeps the instance the worker sleeps with it.
 * Delivery resumes on wake, because the boot reconciler re-enqueues everything
 * Postgres still considers pending - which is exactly the guarantee the engine
 * was built around.
 */
async function main(): Promise<void> {
  if (!(await pingDatabase())) {
    logger.fatal('Cannot reach PostgreSQL. Check DATABASE_URL.');
    process.exit(1);
  }

  // Rebuild the queue before serving traffic or consuming jobs, so anything
  // that came due while the instance was asleep goes out immediately.
  await reconcileOnBoot();
  await registerSweeper();

  const emailWorker = startEmailWorker();
  const maintenanceWorker = startMaintenanceWorker();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, concurrency: env.WORKER_CONCURRENCY },
      `OutboxLab API + worker listening on ${env.APP_URL}`,
    );
  });

  // SSE connections are long-lived; without this Node closes them at 5 minutes.
  server.requestTimeout = 0;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 61_000;

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    server.close();
    try {
      // close() waits for in-flight jobs, so no email is abandoned half-sent.
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
  logger.fatal({ err: error.message, stack: error.stack }, 'Failed to start');
  process.exit(1);
});
