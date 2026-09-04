import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * The whole monorepo shares a single `.env` at the repository root, so the API,
 * the worker and the Next.js frontend can never drift out of sync.
 *
 * Resolution works identically for `tsx` (src/config -> root) and for the
 * compiled build (dist/config -> root) because both are three levels deep.
 */
const ROOT_ENV = path.resolve(__dirname, '../../../.env');
const LOCAL_ENV = path.resolve(__dirname, '../../.env');

if (fs.existsSync(ROOT_ENV)) {
  dotenv.config({ path: ROOT_ENV });
}
// Optional backend-local overrides (used by the test suite).
if (fs.existsSync(LOCAL_ENV)) {
  dotenv.config({ path: LOCAL_ENV, override: false });
}

/** Comma-separated list -> trimmed string array. */
const csvList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

/**
 * Comma-separated list of browser origins.
 *
 * Each entry must be a full origin including the scheme, because CORS compares
 * them against the browser's `Origin` header verbatim. "example.vercel.app"
 * never matches "https://example.vercel.app", and the failure is invisible from
 * the server side: the API starts, login appears to succeed, and then every
 * subsequent request is blocked by the browser. Rejecting it at boot turns a
 * baffling runtime symptom into a startup error that names the fix.
 */
const originList = csvList.superRefine((origins, ctx) => {
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${origin}" is not a full origin. Include the scheme, e.g. https://${origin}`,
      });
      continue;
    }
    if (parsed.pathname !== '/' || origin.endsWith('/')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${origin}" must be an origin only - no trailing slash or path, e.g. ${parsed.origin}`,
      });
    }
  }
});

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  // --- Runtime -------------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  APP_URL: z.string().url().default('http://localhost:5000'),
  FRONTEND_URL: originList.default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // --- Datastores ----------------------------------------------------------
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  // --- Auth ----------------------------------------------------------------
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  COOKIE_SECURE: booleanish.default('false'),

  DEMO_EMAIL: z.string().email().default('demo@outboxlab.dev'),
  DEMO_PASSWORD: z.string().min(8).default('demo1234'),
  DEMO_NAME: z.string().default('Demo Reviewer'),

  // --- Scheduling engine ---------------------------------------------------
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(5),
  QUEUE_LIMITER_MAX: z.coerce.number().int().min(1).default(20),
  QUEUE_LIMITER_DURATION: z.coerce.number().int().min(1).default(1000),
  RATE_WINDOW_MS: z.coerce.number().int().min(1000).default(3_600_000),
  DEFAULT_HOURLY_LIMIT: z.coerce.number().int().min(1).default(10),
  DEFAULT_MIN_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  MAX_JOB_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  SWEEPER_INTERVAL_MS: z.coerce.number().int().min(5000).default(60_000),
  ENABLE_TIME_MACHINE: booleanish.default('true'),

  // --- Queue inspector -----------------------------------------------------
  BULL_BOARD_USER: z.string().default('admin'),
  BULL_BOARD_PASSWORD: z.string().default('admin'),

  // --- Optional fixed SMTP -------------------------------------------------
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // Treat empty strings as "unset" so a blank SMTP_HOST= line does not fail
  // validation or produce an unusable half-configured transport.
  const raw: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    raw[key] = value === '' ? undefined : value;
  }

  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    // Fail fast and loudly: a misconfigured scheduler is worse than a dead one.
    console.error(
      `\nInvalid environment configuration:\n${issues}\n\n` +
        `Copy .env.example to .env at the repository root and try again.\n`,
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
