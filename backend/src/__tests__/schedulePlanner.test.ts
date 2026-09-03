import { afterAll, describe, expect, it } from 'vitest';
import {
  effectiveGapMs,
  forecastSchedule,
  layOutSendTimes,
} from '../modules/campaigns/schedulePlanner';
import { closeRedis } from '../lib/redis';

afterAll(async () => {
  await closeRedis();
});

describe('effective gap', () => {
  it("never goes below the mailbox's own minimum", () => {
    // A campaign asking for 100ms on a 2s mailbox must not generate thousands
    // of guaranteed pacing deferrals at runtime.
    expect(effectiveGapMs(100, 2000)).toBe(2000);
    expect(effectiveGapMs(5000, 2000)).toBe(5000);
    expect(effectiveGapMs(0, 0)).toBe(0);
    expect(effectiveGapMs(-100, -50)).toBe(0);
  });
});

describe('layOutSendTimes', () => {
  const start = new Date('2026-01-15T12:00:00.000Z');

  it('staggers sends by the effective gap', () => {
    const times = layOutSendTimes(4, start, 1000, 0);
    expect(times.map((t) => t.toISOString())).toEqual([
      '2026-01-15T12:00:00.000Z',
      '2026-01-15T12:00:01.000Z',
      '2026-01-15T12:00:02.000Z',
      '2026-01-15T12:00:03.000Z',
    ]);
  });

  it('honours the mailbox minimum over a smaller requested delay', () => {
    const times = layOutSendTimes(3, start, 100, 2000);
    expect(times[1]!.getTime() - times[0]!.getTime()).toBe(2000);
  });

  it('puts everything at the start instant when the gap is zero', () => {
    const times = layOutSendTimes(3, start, 0, 0);
    expect(new Set(times.map((t) => t.getTime())).size).toBe(1);
  });

  it('does NOT bake the hourly cap into sendAt', () => {
    // The cap is shared state across campaigns, so it can only be enforced at
    // runtime - the layout applies the stagger and nothing else.
    const times = layOutSendTimes(10, start, 1000, 0);
    const span = times[9]!.getTime() - times[0]!.getTime();
    expect(span).toBe(9000);
  });

  it('returns an empty array for no recipients', () => {
    expect(layOutSendTimes(0, start, 1000, 0)).toEqual([]);
  });
});

describe('forecastSchedule', () => {
  const start = new Date('2026-01-15T12:00:00.000Z');
  const HOUR = 3_600_000;

  it('reports no deferrals when the campaign fits inside one window', () => {
    const forecast = forecastSchedule({
      recipientCount: 5,
      startAt: start,
      delayBetweenEmailsMs: 1000,
      minDelayMs: 0,
      hourlyLimit: 10,
      windowMs: HOUR,
    });

    expect(forecast.deferredCount).toBe(0);
    expect(forecast.windowsRequired).toBe(1);
    expect(forecast.totalRecipients).toBe(5);
  });

  it('pushes the overflow into later windows when the cap is exceeded', () => {
    const forecast = forecastSchedule({
      recipientCount: 12,
      startAt: start,
      delayBetweenEmailsMs: 0,
      minDelayMs: 0,
      hourlyLimit: 5,
      windowMs: HOUR,
    });

    // 12 emails at 5 per window = 3 windows, 7 of them throttled.
    expect(forecast.windowsRequired).toBe(3);
    expect(forecast.deferredCount).toBe(7);
    expect(new Date(forecast.lastSendAt).getTime()).toBeGreaterThan(
      new Date(forecast.firstSendAt).getTime(),
    );
  });

  it('produces the same shape for a compressed window', () => {
    const forecast = forecastSchedule({
      recipientCount: 12,
      startAt: start,
      delayBetweenEmailsMs: 0,
      minDelayMs: 0,
      hourlyLimit: 5,
      windowMs: 60_000,
    });

    expect(forecast.windowsRequired).toBe(3);
    expect(forecast.deferredCount).toBe(7);
    // A 1-minute window drains far faster than an hourly one.
    expect(forecast.estimatedDurationMs).toBeLessThan(3 * HOUR);
  });

  it('marks entries that the limiter will throttle', () => {
    const forecast = forecastSchedule({
      recipientCount: 8,
      startAt: start,
      delayBetweenEmailsMs: 0,
      minDelayMs: 0,
      hourlyLimit: 3,
      windowMs: HOUR,
    });

    expect(forecast.entries.slice(0, 3).every((e) => !e.deferred)).toBe(true);
    expect(forecast.entries.slice(3).every((e) => e.deferred)).toBe(true);
  });

  it('caps the number of returned entries but still counts them all', () => {
    const forecast = forecastSchedule({
      recipientCount: 1000,
      startAt: start,
      delayBetweenEmailsMs: 0,
      minDelayMs: 0,
      hourlyLimit: 10_000,
      windowMs: HOUR,
    });

    expect(forecast.totalRecipients).toBe(1000);
    expect(forecast.entries.length).toBeLessThanOrEqual(200);
  });

  it('labels itself as an estimate', () => {
    const forecast = forecastSchedule({
      recipientCount: 1,
      startAt: start,
      delayBetweenEmailsMs: 0,
      minDelayMs: 0,
      hourlyLimit: 1,
      windowMs: HOUR,
    });
    expect(forecast.note).toMatch(/estimate/i);
  });
});
