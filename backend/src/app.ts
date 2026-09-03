import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { httpLogger, requestId } from './middleware/requestContext';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRouter } from './modules/auth/auth.routes';
import { sendersRouter } from './modules/senders/senders.routes';
import { campaignsRouter } from './modules/campaigns/campaigns.routes';
import { emailsRouter } from './modules/emails/emails.routes';
import { statsRouter } from './modules/stats/stats.routes';
import { eventsRouter } from './modules/events/events.routes';
import { systemRouter } from './modules/system/system.routes';
import { mountBullBoard } from './modules/admin/bullBoard';

export function createApp(): Express {
  const app = express();

  // Behind a proxy in production so `secure` cookies and rate-limit IP
  // detection work correctly.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(httpLogger);

  app.use(
    helmet({
      // Bull Board serves its own inline assets; a strict CSP would break it.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(
    compression({
      // Compressing an SSE stream makes it buffer, which kills realtime
      // delivery. Opt the event stream out explicitly.
      filter: (req, res) => {
        if (req.path.startsWith('/api/events')) return false;
        const type = res.getHeader('Content-Type');
        if (typeof type === 'string' && type.includes('text/event-stream')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  app.use(
    cors({
      // Credentialed requests cannot use a wildcard origin, so the allowed
      // origins are explicit (comma-separated FRONTEND_URL).
      origin: (origin, callback) => {
        if (!origin || env.FRONTEND_URL.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
      exposedHeaders: ['x-request-id'],
    }),
  );

  // CSV payloads can be large; JSON limit is raised to match.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  app.get('/', (_req, res) => {
    res.json({
      name: 'OutboxLab API',
      version: '1.0.0',
      docs: '/api/health',
      queues: '/admin/queues',
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/senders', sendersRouter);
  app.use('/api/campaigns', campaignsRouter);
  app.use('/api/emails', emailsRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api', systemRouter);

  mountBullBoard(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
