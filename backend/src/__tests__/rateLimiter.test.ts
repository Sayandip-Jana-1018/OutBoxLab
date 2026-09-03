import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { consumeRateLimit, peekRateLimit, refundRateLimit, resetRateLimit } from '../queue/rateLimiter';
import { closeRedis, redis, key } from '../lib/redis';
import { getRateWindowMs, windowIndex } from '../lib/clock';

/**
 * These run against the real Redis from docker-compose, because the property
 * under test IS the atomicity of the Lua script - a mock would assert nothing.
 * Every test uses a fresh sender id so suites never collide.
 */

const sender = () => `test-${randomUUID()}`;

afterAll(async () => {
  await closeRedis();
});

describe('atomic rate limiter', () => {
  it('allows exactly `limit` sends and denies the rest', async () => {
    const id = sender();
    const limit = 5;

    const results = [];
    for (let i = 0; i < 12; i += 1) {
      results.push(await consumeRateLimit(id, limit));
    }

    expect(results.filter((r) => r.allowed)).toHaveLength(limit);
    expect(results.filter((r) => !r.allowed)).toHaveLength(7);

    await resetRateLimit(id);
  });

  it('never lets the counter exceed the cap under full concurrency', async () => {
    const id = sender();
    const limit = 5;
    const attempts = 500;

    // Fire everything at once with no coordination - this is the exact burst
    // that breaks INCR-then-compare.
    const decisions = await Promise.all(
      Array.from({ length: attempts }, () => consumeRateLimit(id, limit)),
    );

    const allowed = decisions.filter((d) => d.allowed).length;
    const highWater = Math.max(...decisions.map((d) => d.count));

    const windowMs = await getRateWindowMs();
    const stored = Number.parseInt(
      (await redis.get(key.rateLimit(id, windowIndex(Date.now(), windowMs)))) ?? '0',
      10,
    );

    expect(allowed).toBe(limit);
    expect(highWater).toBeLessThanOrEqual(limit);
    expect(stored).toBe(limit);
    // Nothing may be silently dropped: every attempt is either allowed or deferred.
    expect(allowed + decisions.filter((d) => !d.allowed).length).toBe(attempts);

    await resetRateLimit(id);
  });

  it('contrasts with the naive INCR-then-compare counter', async () => {
    const naiveKey = `test:naive:${randomUUID()}`;
    const limit = 5;
    const attempts = 200;

    await Promise.all(
      Array.from({ length: attempts }, async () => {
        const count = await redis.incr(naiveKey);
        return count <= limit;
      }),
    );

    const inflated = Number.parseInt((await redis.get(naiveKey)) ?? '0', 10);
    // The naive counter ends far above the cap - which is the bug.
    expect(inflated).toBe(attempts);
    expect(inflated).toBeGreaterThan(limit);

    await redis.del(naiveKey);
  });

  it('reports a retry instant at the end of the current window', async () => {
    const id = sender();
    await consumeRateLimit(id, 1);
    const denied = await consumeRateLimit(id, 1);

    expect(denied.allowed).toBe(false);
    expect(denied.retryAtMs).toBeGreaterThan(Date.now());
    expect(denied.retryAtMs - Date.now()).toBeLessThanOrEqual(denied.windowMs);

    await resetRateLimit(id);
  });

  it('sets a TTL so buckets expire instead of accumulating', async () => {
    const id = sender();
    await consumeRateLimit(id, 3);

    const windowMs = await getRateWindowMs();
    const ttl = await redis.pttl(key.rateLimit(id, windowIndex(Date.now(), windowMs)));

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(windowMs + 5000);

    await resetRateLimit(id);
  });

  it('refunds a slot after a failed delivery without going negative', async () => {
    const id = sender();
    await consumeRateLimit(id, 3);
    await consumeRateLimit(id, 3);

    let peek = await peekRateLimit(id, 3);
    expect(peek.count).toBe(2);

    await refundRateLimit(id);
    peek = await peekRateLimit(id, 3);
    expect(peek.count).toBe(1);
    expect(peek.remaining).toBe(2);

    // Over-refunding must not push a counter below zero.
    await refundRateLimit(id);
    await refundRateLimit(id);
    await refundRateLimit(id);
    peek = await peekRateLimit(id, 3);
    expect(peek.count).toBeGreaterThanOrEqual(0);

    await resetRateLimit(id);
  });

  it('isolates quota per sender', async () => {
    const a = sender();
    const b = sender();

    await consumeRateLimit(a, 1);
    const bDecision = await consumeRateLimit(b, 1);

    // Exhausting sender A must not affect sender B.
    expect(bDecision.allowed).toBe(true);

    await resetRateLimit(a);
    await resetRateLimit(b);
  });
});
