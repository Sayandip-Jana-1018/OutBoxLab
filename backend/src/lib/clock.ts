import { env } from '../config/env';
import { redis, key } from './redis';
import { subLogger } from './logger';

const log = subLogger('clock');

const CONFIG_KEY = key.config('rateWindowMs');

/**
 * Every rate-limit decision in OutboxLab is expressed in terms of a *window*
 * rather than a hard-coded hour. Two reasons:
 *
 *  1. Testability / demoability. The "Time Machine" can shrink the window from
 *     3,600,000 ms to 60,000 ms at runtime, so a reviewer can watch a sender
 *     hit its cap, watch the overflow get deferred, and watch it drain into the
 *     next window - all inside a five-minute video. Nothing about the
 *     production code path changes; only the window length does.
 *
 *  2. Correct bucketing. Buckets are `floor(epochMs / windowMs)`, which is
 *     monotonic, timezone-free, and - when windowMs is exactly one hour -
 *     aligns precisely to UTC hour boundaries. Compare with formatting a
 *     `YYYY-MM-DD-HH` string, which cannot express any other window length.
 *
 * The active window length lives in Redis so the API process and every worker
 * process agree on it instantly, without a restart or a shared file.
 */

let cached: { value: number; readAt: number } | null = null;
const CACHE_TTL_MS = 1000;

/** Resolve the active rate-limit window length in milliseconds. */
export async function getRateWindowMs(): Promise<number> {
  const now = Date.now();
  if (cached && now - cached.readAt < CACHE_TTL_MS) {
    return cached.value;
  }

  let value = env.RATE_WINDOW_MS;
  try {
    const stored = await redis.get(CONFIG_KEY);
    if (stored) {
      const parsed = Number.parseInt(stored, 10);
      if (Number.isFinite(parsed) && parsed >= 1000) {
        value = parsed;
      }
    }
  } catch (error) {
    // Redis hiccup must never break scheduling: fall back to the env default.
    log.warn({ err: (error as Error).message }, 'Falling back to env RATE_WINDOW_MS');
  }

  cached = { value, readAt: now };
  return value;
}

/**
 * Override the window length at runtime (Time Machine).
 * Note: changing the length re-indexes the buckets, which intentionally clears
 * the effective counters - documented as demo-only behaviour.
 */
export async function setRateWindowMs(windowMs: number): Promise<number> {
  if (!Number.isFinite(windowMs) || windowMs < 1000) {
    throw new Error('windowMs must be an integer >= 1000');
  }
  await redis.set(CONFIG_KEY, String(Math.floor(windowMs)));
  cached = { value: Math.floor(windowMs), readAt: Date.now() };
  log.warn({ windowMs }, 'Rate-limit window length changed at runtime');
  return cached.value;
}

/** Restore the window length configured in the environment. */
export async function resetRateWindowMs(): Promise<number> {
  await redis.del(CONFIG_KEY);
  cached = { value: env.RATE_WINDOW_MS, readAt: Date.now() };
  log.warn({ windowMs: env.RATE_WINDOW_MS }, 'Rate-limit window length reset to env default');
  return env.RATE_WINDOW_MS;
}

/** Discard the in-process cache (used by tests). */
export function clearWindowCache(): void {
  cached = null;
}

/** Monotonic bucket index for a point in time. */
export function windowIndex(atMs: number, windowMs: number): number {
  return Math.floor(atMs / windowMs);
}

/** Inclusive start of the window containing `atMs`. */
export function windowStart(atMs: number, windowMs: number): number {
  return windowIndex(atMs, windowMs) * windowMs;
}

/**
 * Exclusive end of the window containing `atMs` - i.e. the earliest instant at
 * which a rate-limited job may be retried.
 */
export function windowEnd(atMs: number, windowMs: number): number {
  return windowStart(atMs, windowMs) + windowMs;
}

/** Human-readable window descriptor for logs and API responses. */
export function describeWindow(windowMs: number): string {
  if (windowMs % 3_600_000 === 0) return `${windowMs / 3_600_000}h`;
  if (windowMs % 60_000 === 0) return `${windowMs / 60_000}m`;
  return `${Math.round(windowMs / 1000)}s`;
}
