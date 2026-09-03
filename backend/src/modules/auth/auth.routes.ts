import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../lib/http';
import { validate } from '../../middleware/validate';
import { currentUser, requireAuth } from '../../middleware/auth';
import { isTest } from '../../config/env';
import { loginSchema, registerSchema } from './auth.schemas';
import {
  authenticateUser,
  clearSession,
  issueSession,
  registerUser,
} from './auth.service';

/**
 * Credential endpoints get their own throttle. This is API abuse protection and
 * is completely separate from the per-sender email rate limiter.
 */
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTest ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many attempts. Please wait a few minutes and try again.',
    },
  },
});

export const authRouter = Router();

authRouter.post(
  '/register',
  credentialLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const user = await registerUser(req.body);
    const token = issueSession(res, user);
    res.status(201).json({ user, token });
  }),
);

authRouter.post(
  '/login',
  credentialLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const user = await authenticateUser(req.body);
    const token = issueSession(res, user);
    res.json({ user, token });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    clearSession(res);
    res.json({ success: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: currentUser(req) });
  }),
);
