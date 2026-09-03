import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { unauthorized } from '../lib/errors';

export const AUTH_COOKIE = 'obl_token';

export interface JwtPayload {
  sub: string;
  email: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

/**
 * Tokens are read from an httpOnly cookie (browser, immune to XSS token theft)
 * or from an `Authorization: Bearer` header (Postman / curl / the burst
 * script). Supporting both is what makes the "create a campaign from Postman"
 * part of the demo possible without disabling auth.
 */
function extractToken(req: Request): string | null {
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE];
  if (cookieToken) return cookieToken;

  const header = req.header('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      next(unauthorized('You must be signed in to do that'));
      return;
    }

    let payload: JwtPayload;
    try {
      payload = verifyToken(token);
    } catch {
      next(unauthorized('Your session has expired, please sign in again'));
      return;
    }

    // Hit the DB so deleted users cannot keep using a still-valid token.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, avatarUrl: true },
    });

    if (!user) {
      next(unauthorized('Account no longer exists'));
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

/** Convenience accessor for handlers that run behind `requireAuth`. */
export function currentUser(req: Request) {
  if (!req.user) {
    throw unauthorized();
  }
  return req.user;
}
