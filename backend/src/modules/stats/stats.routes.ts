import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http';
import { validate } from '../../middleware/validate';
import { currentUser, requireAuth } from '../../middleware/auth';
import { getOverview, getRecentActivity, getThroughput } from './stats.service';

export const statsRouter = Router();

statsRouter.use(requireAuth);

statsRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    res.json(await getOverview(currentUser(req).id));
  }),
);

statsRouter.get(
  '/throughput',
  validate({
    query: z.object({
      minutes: z.coerce.number().int().min(5).max(1440).default(30),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { minutes } = req.query as unknown as { minutes: number };
    res.json({ buckets: await getThroughput(currentUser(req).id, minutes) });
  }),
);

statsRouter.get(
  '/activity',
  validate({
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { limit } = req.query as unknown as { limit: number };
    res.json({ events: await getRecentActivity(currentUser(req).id, limit) });
  }),
);
