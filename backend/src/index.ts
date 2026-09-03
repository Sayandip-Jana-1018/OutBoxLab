import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { closeRedis } from './lib/redis';
import { closeDatabase, pingDatabase } from './db/prisma';
import { closeQueues } from './queue/queues';

/**
 * API process entrypoint.
 *
 * The API deliberately does NOT reconcile the queue or run a worker - that is
 * the worker process's job (`src/worker.ts`). Keeping them apart means the two
 * can be restarted, scaled and reasoned about independently, and it makes the
 * restart demo unambiguous.
 */
async function main(): Promise<void> {
  if (!(await pingDatabase())) {
    logger.fatal(
      'Cannot reach PostgreSQL. Is `docker compose up -d` running and has `npm run db:migrate` been applied?',
    );
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, frontends: env.FRONTEND_URL },
      `OutboxLab API listening on ${env.APP_URL}`,
    );
    logger.info(`Queue inspector: ${env.APP_URL}/admin/queues`);
  });

  // SSE connections are long-lived; without this Node closes them at 5 minutes.
  server.requestTimeout = 0;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 61_000;

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'API shutting down');

    server.close();
    try {
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
  logger.fatal({ err: error.message, stack: error.stack }, 'API failed to start');
  process.exit(1);
});
