import { windowEnd, windowIndex } from '../../lib/clock';

/**
 * Schedule planning.
 *
 * Two distinct jobs live here, and keeping them separate matters:
 *
 *   1. `layOutSendTimes` computes the `sendAt` actually written to the
 *      database. It applies only the *stagger* - it deliberately does NOT bake
 *      in the hourly cap. The cap is shared state: other campaigns using the
 *      same mailbox consume the same quota, so any figure computed at creation
 *      time would already be wrong by the time the job ran. The runtime
 *      limiter is the single authority.
 *
 *   2. `forecastSchedule` simulates what the limiter will do, purely to show
 *      the user "your last email lands around 14:20 tomorrow" before they
 *      commit. It is an estimate and is labelled as such in the UI.
 */

/**
 * Effective gap between consecutive emails.
 *
 * The sender's own `minDelayMs` is respected here, so a campaign asking for
 * 100ms spacing on a mailbox configured for 2s does not generate thousands of
 * guaranteed pacing deferrals at runtime - the schedule is laid out correctly
 * from the start and the pacer becomes a safety net rather than the mechanism.
 */
export function effectiveGapMs(delayBetweenEmailsMs: number, minDelayMs: number): number {
  return Math.max(delayBetweenEmailsMs, minDelayMs, 0);
}

export function layOutSendTimes(
  count: number,
  startAt: Date,
  delayBetweenEmailsMs: number,
  minDelayMs: number,
): Date[] {
  const gap = effectiveGapMs(delayBetweenEmailsMs, minDelayMs);
  const base = startAt.getTime();
  return Array.from({ length: count }, (_v, index) => new Date(base + index * gap));
}

export interface ForecastEntry {
  index: number;
  /** Time implied by the stagger alone. */
  plannedAt: string;
  /** Time after simulating the per-sender quota. */
  projectedAt: string;
  /** True when the quota pushed this email into a later window. */
  deferred: boolean;
}

export interface ScheduleForecast {
  /** First slice of the timeline, for rendering. */
  entries: ForecastEntry[];
  totalRecipients: number;
  /** How many are expected to be throttled at least once. */
  deferredCount: number;
  windowsRequired: number;
  firstSendAt: string;
  lastSendAt: string;
  estimatedDurationMs: number;
  windowMs: number;
  hourlyLimit: number;
  note: string;
}

const MAX_FORECAST_ENTRIES = 200;

/**
 * Simulate the limiter over a campaign to estimate when it will finish.
 *
 * Assumes the sender starts the run with a full quota and that no other
 * campaign competes for it - stated in `note` so the number is never mistaken
 * for a guarantee.
 */
export function forecastSchedule(input: {
  recipientCount: number;
  startAt: Date;
  delayBetweenEmailsMs: number;
  minDelayMs: number;
  hourlyLimit: number;
  windowMs: number;
}): ScheduleForecast {
  const gap = effectiveGapMs(input.delayBetweenEmailsMs, input.minDelayMs);
  const base = input.startAt.getTime();

  const usedPerWindow = new Map<number, number>();
  const entries: ForecastEntry[] = [];

  let deferredCount = 0;
  let cursor = base;
  let firstSendAt = base;
  let lastSendAt = base;

  for (let index = 0; index < input.recipientCount; index += 1) {
    const plannedAt = base + index * gap;
    // Sends cannot run earlier than the previous one plus the gap.
    let candidate = Math.max(plannedAt, cursor);

    // Walk forward until a window with spare quota is found.
    for (;;) {
      const bucket = windowIndex(candidate, input.windowMs);
      const used = usedPerWindow.get(bucket) ?? 0;

      if (used < input.hourlyLimit) {
        usedPerWindow.set(bucket, used + 1);
        break;
      }

      candidate = windowEnd(candidate, input.windowMs);
    }

    /**
     * "Deferred" means this email sends later than its planned slot.
     *
     * Deliberately NOT "this email's own loop advanced a window": once the cap
     * pushes one email into the next window, every email behind it inherits the
     * advanced cursor and also lands late, without its own loop ever iterating.
     * Flagging only the boundary-crossers under-reports the delay badly - a
     * campaign of 12 against a cap of 5 would claim 2 affected instead of 7,
     * and the UI would print "on time" next to a timestamp an hour adrift.
     */
    const deferred = candidate > plannedAt;
    if (deferred) deferredCount += 1;
    if (index === 0) firstSendAt = candidate;
    lastSendAt = candidate;
    cursor = candidate + gap;

    if (entries.length < MAX_FORECAST_ENTRIES) {
      entries.push({
        index,
        plannedAt: new Date(plannedAt).toISOString(),
        projectedAt: new Date(candidate).toISOString(),
        deferred,
      });
    }
  }

  return {
    entries,
    totalRecipients: input.recipientCount,
    deferredCount,
    windowsRequired: usedPerWindow.size,
    firstSendAt: new Date(firstSendAt).toISOString(),
    lastSendAt: new Date(lastSendAt).toISOString(),
    estimatedDurationMs: lastSendAt - firstSendAt,
    windowMs: input.windowMs,
    hourlyLimit: input.hourlyLimit,
    note:
      'Estimate only. Assumes the mailbox begins with a full quota and that no other campaign is competing for it. The runtime limiter is authoritative.',
  };
}
