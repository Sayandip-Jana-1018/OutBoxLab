import { Router } from 'express';
import { asyncHandler, pathParam } from '../../lib/http';
import { validate } from '../../middleware/validate';
import { currentUser, requireAuth } from '../../middleware/auth';
import { emailIdParam, listEmailsQuery, rescheduleEmailSchema } from './emails.schemas';
import {
  cancelEmail,
  getEmail,
  listEmails,
  rescheduleEmail,
  retryEmail,
} from './emails.service';

export const emailsRouter = Router();

emailsRouter.use(requireAuth);

emailsRouter.get(
  '/',
  validate({ query: listEmailsQuery }),
  asyncHandler(async (req, res) => {
    res.json(await listEmails(currentUser(req).id, req.query as never));
  }),
);

emailsRouter.get(
  '/:id',
  validate({ params: emailIdParam }),
  asyncHandler(async (req, res) => {
    res.json({ email: await getEmail(currentUser(req).id, pathParam(req, 'id')) });
  }),
);

emailsRouter.post(
  '/:id/reschedule',
  validate({ params: emailIdParam, body: rescheduleEmailSchema }),
  asyncHandler(async (req, res) => {
    res.json({
      email: await rescheduleEmail(currentUser(req).id, pathParam(req, 'id'), req.body),
    });
  }),
);

emailsRouter.post(
  '/:id/cancel',
  validate({ params: emailIdParam }),
  asyncHandler(async (req, res) => {
    res.json({ email: await cancelEmail(currentUser(req).id, pathParam(req, 'id')) });
  }),
);

emailsRouter.post(
  '/:id/retry',
  validate({ params: emailIdParam }),
  asyncHandler(async (req, res) => {
    res.json({ email: await retryEmail(currentUser(req).id, pathParam(req, 'id')) });
  }),
);
