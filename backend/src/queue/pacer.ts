import { redis, key } from '../lib/redis';

/**
 * Per-sender send pacer: guarantees a minimum gap between two sends from the
 * same mailbox.
 *
 * ---------------------------------------------------------------------------
 * Why not `await sleep(minDelayMs)` inside the processor
 * ---------------------------------------------------------------------------
 * The earlier version of this project slept inside the job handler. That has
 * two defects:
 *
 *   1. It does not actually pace anything. With `concurrency: 5`, five jobs
 *      enter the handler at the same instant, all sleep in parallel, and all
 *      five sends fire simultaneously. The configured "2s between emails"
 *      silently became "5 emails at once, every 2s".
 *
 *   2. It wastes the worker. A sleeping handler still occupies one of the N
 *      concurrency slots, so a large delay throttles throughput for *every*
 *      sender, not just the paced one.
 *
 * Instead, each sender owns a Redis key holding the next free send timestamp.
 * A worker atomically *reserves* the earliest available slot and advances the
 * marker. If the reserved slot is in the future the job is handed back to
 * BullMQ's delayed set (`moveToDelayed`) and the worker is freed immediately.
 * Spacing is therefore enforced across every worker in the fleet, and no
 * worker ever blocks.
 */
const RESERVE_SCRIPT = `
local now = tonumber(ARGV[1])
local gap = tonumber(ARGV[2])
local ttlMs = tonumber(ARGV[3])

local nextFree = tonumber(redis.call('GET', KEYS[1]) or '0')
local slot = now
if nextFree > now then
  slot = nextFree
end

redis.call('SET', KEYS[1], slot + gap, 'PX', ttlMs)
return tostring(slot)
`;

export interface PacerReservation {
  /** Instant at which this job is allowed to send. */
  slotMs: number;
  /** True when the slot is now - the job may send on this pass. */
  immediate: boolean;
  /** How far in the future the slot is, in ms. */
  waitMs: number;
}

/**
 * Reserve the next send slot for a sender.
 * `minDelayMs <= 0` disables pacing and always returns an immediate slot.
 */
export async function reserveSendSlot(
  senderId: string,
  minDelayMs: number,
  now: number = Date.now(),
): Promise<PacerReservation> {
  if (minDelayMs <= 0) {
    return { slotMs: now, immediate: true, waitMs: 0 };
  }

  // Keep the marker alive comfortably longer than the queue it represents, but
  // let it expire once a sender goes idle so a long-dormant sender is not
  // penalised by a stale reservation.
  const ttlMs = Math.max(minDelayMs * 10, 60_000);

  const raw = (await redis.eval(
    RESERVE_SCRIPT,
    1,
    key.pacer(senderId),
    String(now),
    String(minDelayMs),
    String(ttlMs),
  )) as string;

  const slotMs = Number.parseInt(raw, 10);
  const waitMs = Math.max(0, slotMs - now);

  return { slotMs, immediate: waitMs === 0, waitMs };
}

/** Inspect a sender's pacing marker without reserving (dashboard / tests). */
export async function peekSendSlot(senderId: string): Promise<number | null> {
  const raw = await redis.get(key.pacer(senderId));
  return raw ? Number.parseInt(raw, 10) : null;
}

/** Test helper: forget a sender's pacing marker. */
export async function resetSendSlot(senderId: string): Promise<void> {
  await redis.del(key.pacer(senderId));
}
