import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { redis, key } from '../../lib/redis';
import { describeWindow, getRateWindowMs } from '../../lib/clock';
import { queueCounts } from '../../queue/scheduler';
import { peekRateLimit } from '../../queue/rateLimiter';

const METRIC_NAMES = ['sent', 'failed', 'retried', 'deferred_rate_limit', 'deferred_pacing'] as const;

export interface OverviewStats {
  emails: Record<string, number>;
  totals: { scheduled: number; inFlight: number; delivered: number; failed: number };
  campaigns: Record<string, number>;
  queue: Awaited<ReturnType<typeof queueCounts>>;
  window: { ms: number; label: string };
  lifetime: Record<string, number>;
  senders: {
    id: string;
    label: string;
    used: number;
    limit: number;
    remaining: number;
    resetsAt: string;
  }[];
}

/** Everything the dashboard's header and KPI row needs, in one round trip. */
export async function getOverview(userId: string): Promise<OverviewStats> {
  const [emailGroups, campaignGroups, queue, windowMs, senders, metrics] = await Promise.all([
    prisma.scheduledEmail.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.campaign.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    }),
    queueCounts(),
    getRateWindowMs(),
    prisma.sender.findMany({
      where: { userId, isActive: true },
      select: { id: true, label: true, hourlyLimit: true },
      orderBy: { createdAt: 'asc' },
    }),
    readMetrics(),
  ]);

  const emails: Record<string, number> = {};
  for (const row of emailGroups) {
    emails[row.status] = row._count._all;
  }

  const campaigns: Record<string, number> = {};
  for (const row of campaignGroups) {
    campaigns[row.status] = row._count._all;
  }

  const senderQuotas = await Promise.all(
    senders.map(async (sender) => {
      const quota = await peekRateLimit(sender.id, sender.hourlyLimit);
      return {
        id: sender.id,
        label: sender.label,
        used: quota.count,
        limit: quota.limit,
        remaining: quota.remaining,
        resetsAt: new Date(quota.retryAtMs).toISOString(),
      };
    }),
  );

  return {
    emails,
    totals: {
      scheduled: emails.SCHEDULED ?? 0,
      inFlight: (emails.PROCESSING ?? 0) + (emails.DEFERRED ?? 0),
      delivered: emails.SENT ?? 0,
      failed: emails.FAILED ?? 0,
    },
    campaigns,
    queue,
    window: { ms: windowMs, label: describeWindow(windowMs) },
    lifetime: metrics,
    senders: senderQuotas,
  };
}

async function readMetrics(): Promise<Record<string, number>> {
  const values = await redis.mget(METRIC_NAMES.map((name) => key.metrics(name)));
  const out: Record<string, number> = {};
  METRIC_NAMES.forEach((name, index) => {
    out[name] = Number.parseInt(values[index] ?? '0', 10) || 0;
  });
  return out;
}

interface ThroughputBucket {
  bucket: Date;
  sent: number;
}

/**
 * Deliveries per minute over a trailing window, bucketed in Postgres.
 *
 * `date_trunc` + `generate_series` produces a dense series (including the
 * minutes with zero sends), so the sparkline on the dashboard has no gaps and
 * the frontend needs no gap-filling logic.
 */
export async function getThroughput(userId: string, minutes: number) {
  const rows = await prisma.$queryRaw<ThroughputBucket[]>(Prisma.sql`
    WITH series AS (
      SELECT generate_series(
        -- The ::int cast is required. A JS number binds as bigint, and there is
        -- no make_interval(mins => bigint) overload, so without it Postgres
        -- raises 42883 and the whole throughput query 500s.
        date_trunc('minute', now()) - make_interval(mins => ${minutes - 1}::int),
        date_trunc('minute', now()),
        interval '1 minute'
      ) AS bucket
    )
    SELECT
      series.bucket AS bucket,
      count(e.id)::int AS sent
    FROM series
    LEFT JOIN "scheduled_emails" e
      ON date_trunc('minute', e."sentAt") = series.bucket
     AND e."userId" = ${userId}::uuid
     AND e.status = 'SENT'
    GROUP BY series.bucket
    ORDER BY series.bucket ASC
  `);

  return rows.map((row) => ({
    at: row.bucket.toISOString(),
    sent: Number(row.sent),
  }));
}

/** Recent activity feed for the dashboard overview. */
export async function getRecentActivity(userId: string, limit: number) {
  return prisma.emailEvent.findMany({
    where: { email: { userId } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      email: { select: { id: true, to: true, subject: true, status: true } },
    },
  });
}
