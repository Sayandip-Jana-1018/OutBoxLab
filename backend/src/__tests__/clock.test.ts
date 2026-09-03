import { afterAll, describe, expect, it } from 'vitest';
import {
  describeWindow,
  windowEnd,
  windowIndex,
  windowStart,
} from '../lib/clock';
import { closeRedis } from '../lib/redis';

afterAll(async () => {
  await closeRedis();
});

/**
 * The window maths is the foundation every rate-limit decision sits on, so it
 * is tested independently of Redis: bucketing must be monotonic, aligned, and
 * correct across boundaries regardless of window length.
 */
describe('window bucketing', () => {
  const HOUR = 3_600_000;

  it('buckets by floor(epoch / windowMs)', () => {
    expect(windowIndex(0, HOUR)).toBe(0);
    expect(windowIndex(HOUR - 1, HOUR)).toBe(0);
    expect(windowIndex(HOUR, HOUR)).toBe(1);
    expect(windowIndex(HOUR * 2 + 5, HOUR)).toBe(2);
  });

  it('aligns exactly to UTC hour boundaries when the window is one hour', () => {
    const noon = Date.UTC(2026, 0, 15, 12, 0, 0);
    const later = Date.UTC(2026, 0, 15, 12, 59, 59);

    expect(windowIndex(noon, HOUR)).toBe(windowIndex(later, HOUR));
    expect(windowStart(later, HOUR)).toBe(noon);
    expect(windowEnd(later, HOUR)).toBe(noon + HOUR);
  });

  it('rolls over to a new bucket one millisecond past the boundary', () => {
    const boundary = Date.UTC(2026, 0, 15, 13, 0, 0);
    expect(windowIndex(boundary - 1, HOUR)).toBe(windowIndex(boundary, HOUR) - 1);
  });

  it('is monotonic - time never moves a bucket backwards', () => {
    let previous = windowIndex(0, HOUR);
    for (let t = 0; t < HOUR * 10; t += HOUR / 3) {
      const current = windowIndex(t, HOUR);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('works identically for a compressed (Time Machine) window', () => {
    const MINUTE = 60_000;
    const t = Date.UTC(2026, 0, 15, 12, 30, 45);

    expect(windowEnd(t, MINUTE) - windowStart(t, MINUTE)).toBe(MINUTE);
    expect(windowStart(t, MINUTE) % MINUTE).toBe(0);
    // A shorter window must never produce a later reset than a longer one.
    expect(windowEnd(t, MINUTE)).toBeLessThanOrEqual(windowEnd(t, HOUR));
  });

  it('always returns a reset instant strictly in the future', () => {
    const now = Date.now();
    for (const windowMs of [1000, 60_000, HOUR]) {
      expect(windowEnd(now, windowMs)).toBeGreaterThan(now);
    }
  });
});

describe('describeWindow', () => {
  it('renders human-readable labels', () => {
    expect(describeWindow(3_600_000)).toBe('1h');
    expect(describeWindow(7_200_000)).toBe('2h');
    expect(describeWindow(60_000)).toBe('1m');
    expect(describeWindow(300_000)).toBe('5m');
    expect(describeWindow(5_000)).toBe('5s');
  });
});
