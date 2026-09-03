import { Router } from 'express';
import { asyncHandler, pathParam } from '../../lib/http';
import { validate } from '../../middleware/validate';
import { currentUser, requireAuth } from '../../middleware/auth';
import {
  campaignIdParam,
  createCampaignSchema,
  listCampaignsQuery,
  previewScheduleSchema,
} from './campaigns.schemas';
import {
  cancelCampaign,
  createCampaign,
  getCampaign,
  listCampaigns,
  pauseCampaign,
  previewSchedule,
  resumeCampaign,
} from './campaigns.service';

export const campaignsRouter = Router();

campaignsRouter.use(requireAuth);

campaignsRouter.post(
  '/',
  validate({ body: createCampaignSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createCampaign(currentUser(req).id, req.body));
  }),
);

/**
 * Dry run: shows when each email is projected to go out, including the
 * throttling the sender's quota will cause. Nothing is written.
 */
campaignsRouter.post(
  '/preview',
  validate({ body: previewScheduleSchema }),
  asyncHandler(async (req, res) => {
    res.json(await previewSchedule(req.body));
  }),
);

campaignsRouter.get(
  '/',
  validate({ query: listCampaignsQuery }),
  asyncHandler(async (req, res) => {
    res.json(await listCampaigns(currentUser(req).id, req.query as never));
  }),
);

campaignsRouter.get(
  '/:id',
  validate({ params: campaignIdParam }),
  asyncHandler(async (req, res) => {
    res.json(await getCampaign(currentUser(req).id, pathParam(req, 'id')));
  }),
);

campaignsRouter.post(
  '/:id/pause',
  validate({ params: campaignIdParam }),
  asyncHandler(async (req, res) => {
    res.json(await pauseCampaign(currentUser(req).id, pathParam(req, 'id')));
  }),
);

campaignsRouter.post(
  '/:id/resume',
  validate({ params: campaignIdParam }),
  asyncHandler(async (req, res) => {
    res.json(await resumeCampaign(currentUser(req).id, pathParam(req, 'id')));
  }),
);

campaignsRouter.post(
  '/:id/cancel',
  validate({ params: campaignIdParam }),
  asyncHandler(async (req, res) => {
    res.json(await cancelCampaign(currentUser(req).id, pathParam(req, 'id')));
  }),
);
