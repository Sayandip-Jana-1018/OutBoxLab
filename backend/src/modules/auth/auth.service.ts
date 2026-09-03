import bcrypt from 'bcryptjs';
import type { CookieOptions, Response } from 'express';
import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { conflict, unauthorized } from '../../lib/errors';
import { AUTH_COOKIE, signToken } from '../../middleware/auth';
import type { LoginInput, RegisterInput } from './auth.schemas';

const BCRYPT_ROUNDS = 12;

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: Date;
}

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  createdAt: true,
} as const;

/** Deterministic avatar so every account has an identity without file uploads. */
function avatarFor(email: string): string {
  return `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(email)}`;
}

export async function registerUser(input: RegisterInput): Promise<PublicUser> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    throw conflict('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  return prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash,
      avatarUrl: avatarFor(input.email),
    },
    select: publicUserSelect,
  });
}

export async function authenticateUser(input: LoginInput): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Compare against a dummy hash when the user does not exist so the response
  // time does not reveal whether an email is registered.
  const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const valid = await bcrypt.compare(input.password, hash);

  if (!user || !valid) {
    throw unauthorized('Incorrect email or password');
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // `lax` keeps the cookie working across localhost:3000 -> localhost:5000
    // in development; production deployments behind HTTPS use `none` + secure.
    sameSite: env.COOKIE_SECURE ? 'none' : 'lax',
    secure: env.COOKIE_SECURE,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

/** Issues the session cookie and returns the raw token for Bearer clients. */
export function issueSession(res: Response, user: PublicUser): string {
  const token = signToken({ sub: user.id, email: user.email });
  res.cookie(AUTH_COOKIE, token, cookieOptions());
  return token;
}

export function clearSession(res: Response): void {
  res.clearCookie(AUTH_COOKIE, { ...cookieOptions(), maxAge: undefined });
}
