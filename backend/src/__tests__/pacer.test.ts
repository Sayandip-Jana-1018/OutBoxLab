import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { peekSendSlot, reserveSendSlot, resetSendSlot } from '../queue/pacer';
import { closeRedis } from '../lib/redis';

const sender = () => `test-${randomUUID()}`;

afterAll(async () => {
  await closeRedis();
});

/**
 * The pacer's contract: no two reservations for the same mailbox may ever be
 * closer together than `minDelayMs`, no matter how many workers ask at once.
 * This is the property `await sleep()` cannot provide.
 */
describe('distributed pacer', () => {
  it('gives the first caller an immediate slot', async () => {
    const id = sender();
    const reservation = await reserveSendSlot(id, 2000);

    expect(reservation.immediate).toBe(true);
    expect(reservation.waitMs).toBe(0);

    await resetSendSlot(id);
  });

  it('spaces sequential reservations by exactly the gap', async () => {
    const id = sender();
    const gap = 1000;

    const first = await reserveSendSlot(id, gap);
    const second = await reserveSendSlot(id, gap);
    const third = await reserveSendSlot(id, gap);

    expect(second.slotMs - first.slotMs).toBe(gap);
    expect(third.slotMs - second.slotMs).toBe(gap);
    expect(second.immediate).toBe(false);

    await resetSendSlot(id);
  });

  it('never issues two slots closer than the gap under concurrency', async () => {
    const id = sender();
    const gap = 250;
    const count = 200;

    // All 200 "workers" reserve simultaneously. Only the atomicity of the Lua
    // reservation stops them colliding.
    const reservations = await Promise.all(
      Array.from({ length: count }, () => reserveSendSlot(id, gap)),
    );

    const slots = reservations.map((r) => r.slotMs).sort((a, b) => a - b);
    const uniqueSlots = new Set(slots);

    // Every reservation must be distinct...
    expect(uniqueSlots.size).toBe(count);

    // ...and separated by at least the configured gap.
    let smallestGap = Number.POSITIVE_INFINITY;
    for (let i = 1; i < slots.length; i += 1) {
      smallestGap = Math.min(smallestGap, (slots[i] ?? 0) - (slots[i - 1] ?? 0));
    }
    expect(smallestGap).toBeGreaterThanOrEqual(gap);

    await resetSendSlot(id);
  });

  it('treats a zero or negative gap as pacing disabled', async () => {
    const id = sender();

    const a = await reserveSendSlot(id, 0);
    const b = await reserveSendSlot(id, 0);

    expect(a.immediate).toBe(true);
    expect(b.immediate).toBe(true);
    // No marker should be written when pacing is off.
    expect(await peekSendSlot(id)).toBeNull();
  });

  it('keeps mailboxes independent', async () => {
    const a = sender();
    const b = sender();
    const gap = 5000;

    await reserveSendSlot(a, gap);
    const bReservation = await reserveSendSlot(b, gap);

    // Saturating mailbox A must not delay mailbox B.
    expect(bReservation.immediate).toBe(true);

    await resetSendSlot(a);
    await resetSendSlot(b);
  });

  it('lets a dormant mailbox start fresh after its marker is cleared', async () => {
    const id = sender();
    await reserveSendSlot(id, 3000);
    await reserveSendSlot(id, 3000);

    expect(await peekSendSlot(id)).not.toBeNull();

    await resetSendSlot(id);
    const afterReset = await reserveSendSlot(id, 3000);
    expect(afterReset.immediate).toBe(true);

    await resetSendSlot(id);
  });
});
