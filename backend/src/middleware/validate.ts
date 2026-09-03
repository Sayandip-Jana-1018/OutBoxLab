import type { RequestHandler } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { badRequest } from '../lib/errors';

type Source = 'body' | 'query' | 'params';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * Validates and *replaces* the request parts with the parsed output, so
 * downstream handlers work with coerced, defaulted, fully typed values rather
 * than raw strings.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    for (const source of ['params', 'query', 'body'] as Source[]) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (!result.success) {
        next(
          badRequest(`Invalid request ${source}`, formatZodError(result.error)),
        );
        return;
      }
      // Express 5 makes req.query a getter; assign defensively.
      Object.defineProperty(req, source, {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    next();
  };
}
