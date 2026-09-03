import { randomUUID } from 'node:crypto';
import { redis, key, closeRedis } from '../lib/redis';
import { getRateWindowMs, describeWindow, windowIndex, windowEnd } from '../lib/clock';
import { consumeRateLimit, resetRateLimit } from '../queue/rateLimiter';
import { reserveSendSlot, resetSendSlot } from '../queue/pacer';

/**
 * Burst load test for the rate limiter and the pacer.
 *
 * Runs against Redis directly rather than through SMTP, because the property
 * under test is the concurrency control, not the mail transport. Firing N
 * simultaneous requests at one sender is the scenario that breaks naive
 * implementations, so it is the one worth asserting.
 *
 *   npm run test:burst
 *   npm run test:burst -- --jobs 5000 --limit 25
 */

interface Options {
  jobs: number;
  limit: number;
  gapMs: number;
}

function parseArgs(argv: string[]): Options {
  const get = (name: string, fallback: number): number => {
    const index = argv.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const value = Number.parseInt(argv[index + 1] ?? '', 10);
    return Number.isFinite(value) ? value : fallback;
  };

  return {
    jobs: get('jobs', 1000),
    limit: get('limit', 5),
    gapMs: get('gap', 250),
  };
}

const pad = (value: string | number, width: number) => String(value).padEnd(width);
const num = (value: number) => value.toLocaleString('en-US');

function heading(title: string): void {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(72));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const windowMs = await getRateWindowMs();
  const senderId = `burst-${randomUUID()}`;
  const now = Date.now();

  heading('OutboxLab - rate limiter & pacer burst test');
  console.log(`  Sender under test      ${senderId}`);
  console.log(`  Concurrent jobs        ${num(options.jobs)}`);
  console.log(`  Quota                  ${options.limit} per ${describeWindow(windowMs)}`);
  console.log(`  Window bucket          ${windowIndex(now, windowMs)}`);
  console.log(`  Window resets at       ${new Date(windowEnd(now, windowMs)).toISOString()}`);

  await resetRateLimit(senderId);
  await resetSendSlot(senderId);

  // -----------------------------------------------------------------------
  // 1. The quota test.
  //
  // Every request is issued at once, with no coordination between them. The
  // only thing standing between them and an over-send is the atomicity of the
  // Lua script.
  // -----------------------------------------------------------------------
  heading('1. Atomic quota under full concurrency');

  const startedAt = Date.now();
  const decisions = await Promise.all(
    Array.from({ length: options.jobs }, () => consumeRateLimit(senderId, options.limit)),
  );
  const elapsedMs = Date.now() - startedAt;

  const allowed = decisions.filter((decision) => decision.allowed).length;
  const deferred = decisions.length - allowed;
  const counterValue = Number.parseInt(
    (await redis.get(key.rateLimit(senderId, windowIndex(Date.now(), windowMs)))) ?? '0',
    10,
  );
  const highWater = Math.max(...decisions.map((decision) => decision.count));

  console.log(`  ${pad('Permitted to send', 26)} ${num(allowed)}`);
  console.log(`  ${pad('Deferred to next window', 26)} ${num(deferred)}`);
  console.log(`  ${pad('Dropped / lost', 26)} ${num(options.jobs - allowed - deferred)}`);
  console.log(`  ${pad('Final counter in Redis', 26)} ${num(counterValue)}`);
  console.log(`  ${pad('Highest count observed', 26)} ${num(highWater)}`);
  console.log(`  ${pad('Elapsed', 26)} ${elapsedMs} ms`);

  // -----------------------------------------------------------------------
  // 2. Contrast with the naive implementation.
  //
  // This is exactly what INCR-then-compare produces under the same burst, and
  // it is the bug this project's earlier iteration shipped with.
  // -----------------------------------------------------------------------
  heading('2. Contrast: INCR-then-compare (the naive approach)');

  const naiveKey = `${key.rateLimit(senderId, windowIndex(Date.now(), windowMs))}:naive`;
  await redis.del(naiveKey);

  const naiveResults = await Promise.all(
    Array.from({ length: options.jobs }, async () => {
      const count = await redis.incr(naiveKey);
      return count <= options.limit;
    }),
  );
  const naiveAllowed = naiveResults.filter(Boolean).length;
  const naiveCounter = Number.parseInt((await redis.get(naiveKey)) ?? '0', 10);
  await redis.del(naiveKey);

  console.log(`  ${pad('Permitted to send', 26)} ${num(naiveAllowed)}`);
  console.log(`  ${pad('Final counter in Redis', 26)} ${num(naiveCounter)}  <-- inflated by ${num(naiveCounter - options.limit)}`);
  console.log(
    `  The naive counter no longer means "emails sent this window", so it cannot`,
  );
  console.log(`  drive a UI, an alert, or a remaining-quota calculation.`);

  // -----------------------------------------------------------------------
  // 3. The pacer test: reservations must be strictly gap-separated.
  // -----------------------------------------------------------------------
  heading(`3. Pacer: ${options.gapMs}ms minimum gap under concurrency`);

  const sampleSize = Math.min(options.jobs, 200);
  const reservations = await Promise.all(
    Array.from({ length: sampleSize }, () =>
      reserveSendSlot(senderId, options.gapMs),
    ),
  );

  const slots = reservations.map((reservation) => reservation.slotMs).sort((a, b) => a - b);
  let minGap = Number.POSITIVE_INFINITY;
  let collisions = 0;
  for (let i = 1; i < slots.length; i += 1) {
    const gap = (slots[i] ?? 0) - (slots[i - 1] ?? 0);
    minGap = Math.min(minGap, gap);
    if (gap < options.gapMs) collisions += 1;
  }

  const span = (slots[slots.length - 1] ?? 0) - (slots[0] ?? 0);
  console.log(`  ${pad('Slots reserved', 26)} ${num(sampleSize)}`);
  console.log(`  ${pad('Smallest gap between two', 26)} ${minGap === Number.POSITIVE_INFINITY ? 'n/a' : `${minGap} ms`}`);
  console.log(`  ${pad('Gap violations', 26)} ${num(collisions)}`);
  console.log(`  ${pad('Total span reserved', 26)} ${(span / 1000).toFixed(1)} s`);
  console.log(`  ${pad('Immediate sends', 26)} ${num(reservations.filter((r) => r.immediate).length)}`);

  // -----------------------------------------------------------------------
  // Assertions
  // -----------------------------------------------------------------------
  heading('Result');

  const checks: { label: string; pass: boolean; detail: string }[] = [
    {
      label: 'Exactly `limit` sends permitted',
      pass: allowed === options.limit,
      detail: `expected ${options.limit}, got ${allowed}`,
    },
    {
      label: 'No job dropped',
      pass: allowed + deferred === options.jobs,
      detail: `${allowed} + ${deferred} = ${allowed + deferred} of ${options.jobs}`,
    },
    {
      label: 'Counter never exceeds the cap',
      pass: counterValue <= options.limit && highWater <= options.limit,
      detail: `counter=${counterValue}, high-water=${highWater}, cap=${options.limit}`,
    },
    {
      label: 'Every deferral targets the next window',
      pass: decisions
        .filter((decision) => !decision.allowed)
        .every((decision) => decision.retryAtMs > Date.now() - windowMs),
      detail: 'retryAtMs is always a future window boundary',
    },
    {
      label: 'Pacer honours the minimum gap',
      pass: collisions === 0,
      detail: `${collisions} violation(s), smallest gap ${minGap} ms`,
    },
  ];

  for (const check of checks) {
    console.log(`  ${check.pass ? 'PASS' : 'FAIL'}  ${pad(check.label, 40)} ${check.detail}`);
  }

  await resetRateLimit(senderId);
  await resetSendSlot(senderId);

  const failed = checks.filter((check) => !check.pass);
  console.log('');
  if (failed.length === 0) {
    console.log(`  All ${checks.length} assertions passed.`);
  } else {
    console.log(`  ${failed.length} of ${checks.length} assertions FAILED.`);
  }
  console.log('');

  await closeRedis();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error: Error) => {
  console.error('Burst test crashed:', error.message);
  process.exit(1);
});
