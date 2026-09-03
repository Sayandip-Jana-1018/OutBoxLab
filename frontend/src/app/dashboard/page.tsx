"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  CalendarClock,
  Timer,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Layers,
  PenSquare,
  Mailbox,
  ArrowRight,
  Gauge,
} from "lucide-react";
import { api } from "@/lib/api";
import { useLiveSubscription } from "@/context/live-context";
import { useThemeColor } from "@/context/theme-context";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Sparkline } from "@/components/charts/sparkline";
import { QuotaRing } from "@/components/charts/quota-ring";
import { PageHeader, GlassPanel } from "@/components/ui/page-header";
import { Button, EmptyState, Skeleton } from "@/components/ui/primitives";
import { EmailStatusChip } from "@/components/ui/status-chip";
import { EVENT_LABELS, formatNumber, relativeTime } from "@/lib/format";
import type { ActivityEvent, OverviewStats, ThroughputBucket } from "@/lib/types";

export default function OverviewPage() {
  const { themeColor } = useThemeColor();
  const [stats, setStats] = React.useState<OverviewStats | null>(null);
  const [throughput, setThroughput] = React.useState<ThroughputBucket[]>([]);
  const [activity, setActivity] = React.useState<ActivityEvent[]>([]);
  const [loading, setLoading] = React.useState(true);
  /** True when the counters could not be loaded, so zeros are not mistaken for real data. */
  const [statsFailed, setStatsFailed] = React.useState(false);

  /**
   * Each widget is settled independently.
   *
   * With Promise.all a single failing endpoint rejected the whole batch, so
   * the KPIs rendered zeros while the database held thousands of rows - the
   * page looked empty rather than broken, which is the worst of both. A
   * throughput query that 500s should cost the sparkline, not the counters.
   */
  const load = React.useCallback(async () => {
    const [overview, tp, act] = await Promise.allSettled([
      api.stats.overview(),
      api.stats.throughput(30),
      api.stats.activity(12),
    ]);

    if (overview.status === "fulfilled") setStats(overview.value);
    if (tp.status === "fulfilled") setThroughput(tp.value.buckets);
    if (act.status === "fulfilled") setActivity(act.value.events);

    setStatsFailed(overview.status === "rejected");
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Realtime. Refreshes are coalesced so a 500-email burst does not fire 500
  // requests at the API.
  const pending = React.useRef(false);
  useLiveSubscription(
    React.useCallback(
      (event) => {
        if (event.type === "ping" || pending.current) return;
        pending.current = true;
        setTimeout(() => {
          pending.current = false;
          void load();
        }, 700);
      },
      [load],
    ),
  );

  const totals = stats?.totals;

  return (
    <div className="space-y-10">
      {statsFailed && (
        <div className="mx-auto max-w-xl rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-center">
          <p className="font-sans text-xs leading-relaxed text-rose-300">
            Could not load the live counters, so the numbers below are not current. Check that the
            API is reachable and reload.
          </p>
        </div>
      )}

      <PageHeader
        eyebrow="Live engine state"
        title="Overview"
        description="Everything below streams in over Server-Sent Events. Nothing on this page is polled - the worker publishes, the API relays, the numbers move."
        action={
          <Link href="/dashboard/compose">
            <Button icon={<PenSquare className="h-4 w-4" />}>New campaign</Button>
          </Link>
        }
      />

      {/* KPIs */}
      <div className="mx-auto grid w-full grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Scheduled"
          value={totals?.scheduled ?? 0}
          icon={<CalendarClock className="h-4 w-4" />}
          accent="#38bdf8"
          hint="waiting in the delayed set"
          loading={loading}
          delay={0}
        />
        <KpiCard
          label="In flight"
          value={totals?.inFlight ?? 0}
          icon={<Timer className="h-4 w-4" />}
          accent="#fb923c"
          hint="processing or deferred"
          loading={loading}
          delay={0.06}
        />
        <KpiCard
          label="Delivered"
          value={totals?.delivered ?? 0}
          icon={<CheckCircle2 className="h-4 w-4" />}
          accent="#34d399"
          hint="reached the mailbox"
          loading={loading}
          delay={0.12}
        />
        <KpiCard
          label="Failed"
          value={totals?.failed ?? 0}
          icon={<AlertTriangle className="h-4 w-4" />}
          accent="#fb7185"
          hint="retries exhausted"
          loading={loading}
          delay={0.18}
        />
      </div>

      {/* Throughput */}
      <GlassPanel
        icon={<Activity className="h-5 w-5" />}
        title="Throughput"
        subtitle="Deliveries per minute over the last 30 minutes"
      >
        <div className="w-full">
          {loading ? (
            <Skeleton className="h-[84px] w-full" />
          ) : (
            <Sparkline data={throughput} height={84} showAxis />
          )}

          {stats && (
            <div className="mt-7 grid w-full grid-cols-3 gap-4 border-t border-black/10 pt-6 text-center dark:border-white/10 sm:grid-cols-6">
              {(
                [
                  ["Sent (30m)", throughput.reduce((s, b) => s + b.sent, 0)],
                  ["Waiting", stats.queue.waiting],
                  ["Active", stats.queue.active],
                  ["Delayed", stats.queue.delayed],
                  ["Completed", stats.queue.completed],
                  ["Failed", stats.queue.failed],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <p className="font-serif text-2xl font-bold leading-none text-zinc-900 dark:text-white">
                    {formatNumber(value)}
                  </p>
                  <p className="mt-1.5 font-sans text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </GlassPanel>

      {/* Mailbox quota */}
      <GlassPanel
        icon={<Gauge className="h-5 w-5" />}
        title="Mailbox quota"
        subtitle={`Consumed in the current ${stats?.window.label ?? "window"} - rate limiting is per mailbox, never global`}
        delay={0.05}
      >
        {loading ? (
          <div className="flex justify-center gap-6">
            <Skeleton className="h-[96px] w-[96px] !rounded-full" />
            <Skeleton className="h-[96px] w-[96px] !rounded-full" />
          </div>
        ) : stats && stats.senders.length > 0 ? (
          <div className="flex flex-wrap items-start justify-center gap-10">
            {stats.senders.map((sender) => (
              <QuotaRing
                key={sender.id}
                used={sender.used}
                limit={sender.limit}
                label={sender.label}
                size={96}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Mailbox className="h-5 w-5" />}
            title="No mailboxes yet"
            description="Provision a sandboxed Ethereal mailbox in one click - no SMTP credentials required."
            action={
              <Link href="/dashboard/senders">
                <Button size="sm" variant="outline">
                  Add a mailbox
                </Button>
              </Link>
            }
          />
        )}
      </GlassPanel>

      {/* Activity */}
      <GlassPanel
        icon={<Layers className="h-5 w-5" />}
        title="Recent activity"
        subtitle="Every decision the engine made, newest first"
        delay={0.1}
        action={
          <Link
            href="/dashboard/sent"
            className="flex items-center gap-1 font-sans text-xs font-bold transition-transform hover:translate-x-0.5"
            style={{ color: themeColor }}
          >
            View all history <ArrowRight className="h-3 w-3" />
          </Link>
        }
      >
        {loading ? (
          <div className="w-full space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : activity.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-5 w-5" />}
            title="Nothing has happened yet"
            description="Schedule a campaign and the engine's decisions will stream in here in real time."
            action={
              <Link href="/dashboard/compose">
                <Button size="sm">Compose a campaign</Button>
              </Link>
            }
          />
        ) : (
          <ul className="w-full space-y-2">
            {activity.map((event, index) => (
              <motion.li
                key={event.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.03, 0.25) }}
                className="liquid-well flex flex-wrap items-center justify-center gap-3 px-4 py-3 sm:flex-nowrap sm:justify-between"
              >
                <EmailStatusChip status={event.email.status} />
                <div className="min-w-0 flex-1 text-center sm:text-left">
                  <p className="truncate font-sans text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    {event.email.to}
                  </p>
                  <p className="truncate font-sans text-xs text-zinc-500 dark:text-zinc-400">
                    {EVENT_LABELS[event.type]}
                    {event.message ? ` - ${event.message}` : ""}
                  </p>
                </div>
                <span className="shrink-0 font-sans text-xs text-zinc-400">
                  {relativeTime(event.createdAt)}
                </span>
              </motion.li>
            ))}
          </ul>
        )}
      </GlassPanel>
    </div>
  );
}
