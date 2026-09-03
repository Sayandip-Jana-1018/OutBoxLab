import { Router } from 'express';
import { asyncHandler, pathParam } from '../../lib/http';
import { validate } from '../../middleware/validate';
import { currentUser, requireAuth } from '../../middleware/auth';
import {
  createEtherealSenderSchema,
  createSenderSchema,
  senderIdParam,
  updateSenderSchema,
} from './senders.schemas';
import {
  createEtherealSender,
  createSender,
  deleteSender,
  listSenders,
  updateSender,
  verifySenderCredentials,
} from './senders.service';

export const sendersRouter = Router();

sendersRouter.use(requireAuth);

sendersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ senders: await listSenders(currentUser(req).id) });
  }),
);

sendersRouter.post(
  '/',
  validate({ body: createSenderSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ sender: await createSender(currentUser(req).id, req.body) });
  }),
);

/** Provision a sandboxed Ethereal mailbox - no credentials required. */
sendersRouter.post(
  '/ethereal',
  validate({ body: createEtherealSenderSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ sender: await createEtherealSender(currentUser(req).id, req.body) });
  }),
);

sendersRouter.patch(
  '/:id',
  validate({ params: senderIdParam, body: updateSenderSchema }),
  asyncHandler(async (req, res) => {
    res.json({
      sender: await updateSender(currentUser(req).id, pathParam(req, 'id'), req.body),
    });
  }),
);

sendersRouter.post(
  '/:id/verify',
  validate({ params: senderIdParam }),
  asyncHandler(async (req, res) => {
    res.json(await verifySenderCredentials(currentUser(req).id, pathParam(req, 'id')));
  }),
);

sendersRouter.delete(
  '/:id',
  validate({ params: senderIdParam }),
  asyncHandler(async (req, res) => {
    await deleteSender(currentUser(req).id, pathParam(req, 'id'));
    res.status(204).send();
  }),
);
