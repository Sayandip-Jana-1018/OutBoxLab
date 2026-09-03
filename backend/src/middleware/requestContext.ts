import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import pinoHttp from 'pino-http';
import { logger } from '../lib/logger';

/**
 * Attaches a correlation id to every request and echoes it back as
 * `x-request-id`, so a line in the API log, a line in the worker log and a
 * failed call in the browser network tab can all be tied together.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.id = incoming && incoming.length <= 100 ? incoming : randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
};

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as { id?: string }).id ?? randomUUID(),
  // Health checks and the SSE stream would otherwise drown the log.
  autoLogging: {
    ignore: (req) => req.url === '/api/health' || req.url?.startsWith('/api/events') === true,
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'debug';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
  customErrorMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
