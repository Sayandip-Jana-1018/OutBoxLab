import { redis, key } from '../lib/redis';
import { getRateWindowMs, windowEnd, windowIndex } from '../lib/clock';

/**
 * Per-sender rate limiter.
 *
 * ---------------------------------------------------------------------------
 * Why a Lua script and not INCR-then-compare
 * ---------------------------------------------------------------------------
 * The obvious implementation is:
 *
 *     const count = await redis.incr(k);
 *     if (count > limit) { defer(); }
 *
 * That is what the earlier version of this project did, and it is subtly
 * wrong: *rejected* attempts still increment the counter. Point a 1,000-job
 * burst at a sender capped to 5/hour and the counter ends the window at 1,005.
 * The consequences are real:
 *
 *   - The counter no longer means "emails sent this window", so it cannot be
 *     shown in the UI, logged, or used to compute remaining quota.
 *   - Every deferred job re-increments on every retry, so the number grows
 *     without bound and is unusable for alerting.
 *
 * The script below performs GET -> compare -> conditional INCR -> conditional
 * PEXPIRE as one atomic unit. The counter is therefore *exactly* the number of
 * sends permitted in the window and can never exceed the cap, no matter how
 * many workers race on it.
 *
 * The TTL is set only on the first increment (`count == 1`) and is derived from
 * the time left in the window plus a small buffer, so buckets expire on their
 * own and Redis never accumulates dead counters.
 */
const CONSUME_SCRIPT = `
local limit = tonumber(ARGV[1])
local ttlMs = tonumber(ARGV[2])
local current = tonumber(redis.call('GET', KEYS[1]) or '0')

if current >= limit then
  return {0, current, limit}
end

current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ttlMs)
end

return {1, current, limit}
`;

/**
 * Refund a consumed slot. Used when a send fails *after* the slot was taken:
 * the email did not go out, so it must not count against the sender's quota.
 * Guarded so a refund arriving after the window rolled over cannot push a
 * fresh counter negative.
 */
const REFUND_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current <= 0 then
  return 0
end
return redis.call('DECR', KEYS[1])
`;

export interface RateLimitDecision {
  allowed: boolean;
  /** Sends already consumed in the current window (never exceeds `limit`). */
  count: number;
  limit: number;
  /** Length of the active window in ms (see the Time Machine in lib/clock). */
  windowMs: number;
  /** Bucket identifier, useful for logs and debugging. */
  windowIndex: number;
  /** Earliest instant at which this sender regains quota. */
  retryAtMs: number;
}

/**
 * Attempt to consume one send slot for `senderId`.
 * Never throws for the "over quota" case - that is a normal decision, not an
 * error, and the caller reacts by deferring the job.
 */
export async function consumeRateLimit(
  senderId: string,
  limit: number,
  now: number = Date.now(),
): Promise<RateLimitDecision> {
  const windowMs = await getRateWindowMs();
  const index = windowIndex(now, windowMs);
  const resetAt = windowEnd(now, windowMs);
  const counterKey = key.rateLimit(senderId, index);

  // Keep the bucket alive slightly past its window so a job that wakes up
  // exactly on the boundary still sees a consistent view.
  const ttlMs = Math.max(1000, resetAt - now + 5000);

  const result = (await redis.eval(
    CONSUME_SCRIPT,
    1,
    counterKey,
    String(limit),
    String(ttlMs),
  )) as [number, number, number];

  const [allowedFlag, count] = result;

  return {
    allowed: allowedFlag === 1,
    count,
    limit,
    windowMs,
    windowIndex: index,
    retryAtMs: resetAt,
  };
}

/** Give a consumed slot back after a failed delivery. */
export async function refundRateLimit(
  senderId: string,
  now: number = Date.now(),
): Promise<void> {
  const windowMs = await getRateWindowMs();
  const counterKey = key.rateLimit(senderId, windowIndex(now, windowMs));
  await redis.eval(REFUND_SCRIPT, 1, counterKey);
}

/** Read the current usage without consuming anything (dashboard / stats). */
export async function peekRateLimit(
  senderId: string,
  limit: number,
  now: number = Date.now(),
): Promise<Omit<RateLimitDecision, 'allowed'> & { remaining: number }> {
  const windowMs = await getRateWindowMs();
  const index = windowIndex(now, windowMs);
  const raw = await redis.get(key.rateLimit(senderId, index));
  const count = raw ? Number.parseInt(raw, 10) : 0;

  return {
    count,
    limit,
    remaining: Math.max(0, limit - count),
    windowMs,
    windowIndex: index,
    retryAtMs: windowEnd(now, windowMs),
  };
}

/** Test helper: wipe a sender's counter for the current window. */
export async function resetRateLimit(
  senderId: string,
  now: number = Date.now(),
): Promise<void> {
  const windowMs = await getRateWindowMs();
  await redis.del(key.rateLimit(senderId, windowIndex(now, windowMs)));
}
