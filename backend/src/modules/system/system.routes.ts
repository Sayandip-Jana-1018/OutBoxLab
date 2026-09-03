import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http';
import { validate } from '../../middleware/validate';
import { requireAuth, currentUser } from '../../middleware/auth';
import { env } from '../../config/env';
import { forbidden } from '../../lib/errors';
import { pingDatabase } from '../../db/prisma';
import { pingRedis, redis, key } from '../../lib/redis';
import {
  describeWindow,
  getRateWindowMs,
  resetRateWindowMs,
  setRateWindowMs,
} from '../../lib/clock';
import { queueCounts } from '../../queue/scheduler';
import { publishToUser } from '../../services/events';

export const systemRouter = Router();

/**
 * Liveness + readiness in one call, reporting each dependency separately so a
 * failure is immediately attributable rather than just "the API is down".
 */
systemRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const [database, cache] = await Promise.all([pingDatabase(), pingRedis()]);

    let queue: Awaited<ReturnType<typeof queueCounts>> | null = null;
    try {
      queue = await queueCounts();
    } catch {
      queue = null;
    }

    const healthy = database && cache;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      version: '1.0.0',
      dependencies: {
        postgres: database ? 'up' : 'down',
        redis: cache ? 'up' : 'down',
      },
      queue,
      timestamp: new Date().toISOString(),
    });
  }),
);

/**
 * Prometheus text-format metrics.
 *
 * Deliberately unauthenticated and instance-wide (not per user), because that
 * is what a scrape target has to look like.
 */
systemRouter.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    const names = ['sent', 'failed', 'retried', 'deferred_rate_limit', 'deferred_pacing'];
    const values = await redis.mget(names.map((name) => key.metrics(name)));
    const queue = await queueCounts();
    const windowMs = await getRateWindowMs();

    const lines: string[] = [
      '# HELP outboxlab_emails_total Lifetime email outcomes by result.',
      '# TYPE outboxlab_emails_total counter',
    ];

    names.forEach((name, index) => {
      lines.push(
        `outboxlab_emails_total{result="${name}"} ${Number.parseInt(values[index] ?? '0', 10) || 0}`,
      );
    });

    lines.push(
      '# HELP outboxlab_queue_jobs Current BullMQ job counts by state.',
      '# TYPE outboxlab_queue_jobs gauge',
    );
    for (const [state, count] of Object.entries(queue)) {
      lines.push(`outboxlab_queue_jobs{state="${state}"} ${count}`);
    }

    lines.push(
      '# HELP outboxlab_rate_window_ms Active rate-limit window length in milliseconds.',
      '# TYPE outboxlab_rate_window_ms gauge',
      `outboxlab_rate_window_ms ${windowMs}`,
      '# HELP outboxlab_process_uptime_seconds API process uptime.',
      '# TYPE outboxlab_process_uptime_seconds gauge',
      `outboxlab_process_uptime_seconds ${Math.round(process.uptime())}`,
    );

    res.type('text/plain; version=0.0.4').send(`${lines.join('\n')}\n`);
  }),
);

/** Current scheduling clock configuration. */
systemRouter.get(
  '/clock',
  asyncHandler(async (_req, res) => {
    const windowMs = await getRateWindowMs();
    res.json({
      windowMs,
      windowLabel: describeWindow(windowMs),
      defaultWindowMs: env.RATE_WINDOW_MS,
      isCompressed: windowMs !== env.RATE_WINDOW_MS,
      timeMachineEnabled: env.ENABLE_TIME_MACHINE,
      serverTime: new Date().toISOString(),
      workerConcurrency: env.WORKER_CONCURRENCY,
      queueLimiter: {
        max: env.QUEUE_LIMITER_MAX,
        durationMs: env.QUEUE_LIMITER_DURATION,
      },
    });
  }),
);

/**
 * Time Machine.
 *
 * Shrinks the rate-limit window at runtime so throttling and next-window
 * recovery can be demonstrated in seconds instead of hours. It changes one
 * number - the window length - and nothing else: the same Lua script, the same
 * `moveToDelayed` path and the same bucket arithmetic stay in use, so what a
 * reviewer watches is the real production behaviour, just faster.
 *
 * Gated behind `ENABLE_TIME_MACHINE` so it can be switched off in a real
 * deployment.
 */
systemRouter.post(
  '/time-machine',
  requireAuth,
  validate({
    body: z.object({
      windowMs: z.coerce.number().int().min(1000).max(24 * 3_600_000).optional(),
      reset: z.boolean().default(false),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!env.ENABLE_TIME_MACHINE) {
      throw forbidden('The Time Machine is disabled in this environment');
    }

    const { windowMs, reset } = req.body as { windowMs?: number; reset: boolean };
    const applied = reset || !windowMs ? await resetRateWindowMs() : await setRateWindowMs(windowMs);

    await publishToUser(currentUser(req).id, {
      type: 'system.window',
      windowMs: applied,
      at: new Date().toISOString(),
    });

    res.json({
      windowMs: applied,
      windowLabel: describeWindow(applied),
      isCompressed: applied !== env.RATE_WINDOW_MS,
      note:
        'Changing the window length re-indexes the quota buckets, which effectively clears current usage. Intended for demos and tests.',
    });
  }),
);
