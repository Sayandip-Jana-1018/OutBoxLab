import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import basicAuth from 'express-basic-auth';
import type { Express } from 'express';
import { env } from '../../config/env';
import { emailQueue, maintenanceQueue } from '../../queue/queues';
import { subLogger } from '../../lib/logger';

const log = subLogger('bull-board');

export const BULL_BOARD_PATH = '/admin/queues';

/**
 * Mounts Bull Board, a read/write inspector for the live queue.
 *
 * It exists so the queue is not a black box during review: delayed jobs and
 * their exact scheduled timestamps, active jobs, retry counts and failure
 * reasons are all visible, which is the quickest way to *prove* that
 * scheduling and deferral work as described rather than just asserting it.
 *
 * Protected with basic auth because it can also mutate the queue.
 */
export function mountBullBoard(app: Express): void {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);

  createBullBoard({
    queues: [new BullMQAdapter(emailQueue), new BullMQAdapter(maintenanceQueue)],
    serverAdapter,
    options: {
      uiConfig: {
        boardTitle: 'OutboxLab',
      },
    },
  });

  app.use(
    BULL_BOARD_PATH,
    basicAuth({
      users: { [env.BULL_BOARD_USER]: env.BULL_BOARD_PASSWORD },
      challenge: true,
      realm: 'OutboxLab Queues',
    }),
    serverAdapter.getRouter(),
  );

  log.info({ path: BULL_BOARD_PATH, user: env.BULL_BOARD_USER }, 'Queue inspector mounted');
}
