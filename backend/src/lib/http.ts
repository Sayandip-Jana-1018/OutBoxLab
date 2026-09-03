import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { badRequest } from './errors';

/**
 * Wraps an async route handler so a rejected promise reaches Express's error
 * pipeline instead of becoming an unhandled rejection. Express 4 does not
 * understand async handlers on its own.
 */
export function asyncHandler<T>(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<T>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * Reads a route parameter as a definite string.
 *
 * `noUncheckedIndexedAccess` correctly types `req.params.id` as
 * `string | undefined`. Rather than relaxing that compiler flag for the whole
 * project, this narrows in one audited place. Routes always pair it with a Zod
 * `params` schema, so reaching the throw means the route was mounted wrong.
 */
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw badRequest(`Missing path parameter "${name}"`);
  }
  return value;
}

/** Cursor-less pagination envelope used by every list endpoint. */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  };
}
