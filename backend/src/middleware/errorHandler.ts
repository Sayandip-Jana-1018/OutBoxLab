import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { isProduction } from '../config/env';
import { subLogger } from '../lib/logger';

const log = subLogger('http');

/**
 * Prisma's error classes are re-exported inconsistently between versions and
 * generators, so we match on the stable public surface (`name` + `code`)
 * instead of doing an `instanceof` against an import that may not exist.
 */
interface PrismaKnownError {
  name: string;
  code: string;
  meta?: { target?: string[] };
}

function asPrismaKnownError(err: unknown): PrismaKnownError | null {
  if (typeof err !== 'object' || err === null) return null;
  const candidate = err as Partial<PrismaKnownError>;
  if (candidate.name === 'PrismaClientKnownRequestError' && typeof candidate.code === 'string') {
    return candidate as PrismaKnownError;
  }
  return null;
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} does not exist`,
      requestId: req.id,
    },
  });
};

/**
 * Single exit point for every error. Known operational errors keep their
 * status/code; Prisma's constraint errors are translated into meaningful HTTP
 * responses; anything else is logged in full and reported as an opaque 500.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Client aborted (very common with SSE) - nothing to report.
  if (res.headersSent) {
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId: req.id,
      },
    });
    return;
  }

  const prismaError = asPrismaKnownError(err);
  if (prismaError) {
    if (prismaError.code === 'P2002') {
      const target = prismaError.meta?.target?.join(', ');
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: target
            ? `A record with this ${target} already exists`
            : 'A record with these values already exists',
          requestId: req.id,
        },
      });
      return;
    }
    if (prismaError.code === 'P2025') {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Resource not found', requestId: req.id },
      });
      return;
    }
    if (prismaError.code === 'P2003') {
      res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Referenced record does not exist',
          requestId: req.id,
        },
      });
      return;
    }
  }

  const error = err as Error;
  log.error(
    { err: error.message, stack: error.stack, requestId: req.id, path: req.path },
    'Unhandled error',
  );

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side',
      requestId: req.id,
      ...(isProduction ? {} : { debug: error.message }),
    },
  });
};
