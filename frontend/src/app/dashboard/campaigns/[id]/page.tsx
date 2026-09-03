"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Pause,
  Play,
  Ban,
  ExternalLink,
  Activity,
  AlertCircle,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useLiveSubscription } from "@/context/live-context";
import { useThemeColor } from "@/context/theme-context";
import { EmailDrawer } from "@/components/dashboard/email-drawer";
import { CampaignStatusChip, EmailStatusChip } from "@/components/ui/status-chip";
import { Button, Skeleton } from "@/components/ui/primitives";
import {
  EMAIL_STATUS_STYLES,
  formatDateTime,
  formatNumber,
  relativeTime,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CampaignDetail, EmailStatus } from "@/lib/types";

const LEGEND: EmailStatus[] = ["SCHEDULED", "PROCESSING", "DEFERRED", "SENT", "FAILED", "CANCELLED"];

/**
 * Campaign timeline visualiser.
 *
 * Each recipient is a node positioned on a shared horizontal time axis by its
 * `sendAt`. As the worker publishes over SSE the node changes colour in place
 * (scheduled -> deferred -> sent), so a throttled campaign visibly bunches up
 * against a window boundary instead of being a number in a table.
 */
function Timeline({
  rows,
  onSelect,
}: {
  rows: CampaignDetail["timeline"];
  onSelect: (id: string) => void;
}) {
  const { themeColor } = useThemeColor();

  const { minTime, span } = React.useMemo(() => {
    if (rows.length === 0) return { minTime: 0, span: 1 };
    const times = rows.map((r) => new Date(r.sentAt ?? r.sendAt).getTime());
    const min = Math.min(...times);
    const max = Math.max(...times);
    return { minTime: min, span: Math.max(1, max - min) };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-zinc-500">No recipients to plot yet.</p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Axis */}
      <div className="liquid-well relative h-36 w-full overflow-hidden">
        {/* Gridlines */}
        {[0, 25, 50, 75, 100].map((pct) => (
          <div
            key={pct}
            className="absolute inset-y-0 w-px bg-black/5 dark:bg-white/5"
            style={{ left: `${pct}%` }}
          />
        ))}

        {rows.map((row, index) => {
          const time = new Date(row.sentAt ?? row.sendAt).getTime();
          const x = ((time - minTime) / span) * 96 + 2; // 2% padding each side
          // Deterministic vertical scatter so nodes at the same instant don't
          // stack into a single invisible dot.
          const y = 12 + ((index * 37) % 76);
          const style = EMAIL_STATUS_STYLES[row.status];

          return (
            <motion.button
              key={row.id}
              layout
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 24 }}
              onClick={() => onSelect(row.id)}
              className="absolute h-2.5 w-2.5 rounded-full ring-2 ring-white/40 transition-transform hover:scale-[2.2] dark:ring-black/40"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                backgroundColor: style.dot,
              }}
              title={`${row.to} - ${style.label}${row.deferredCount ? ` (deferred ${row.deferredCount}x)` : ""} - ${formatDateTime(row.sentAt ?? row.sendAt)}`}
              aria-label={`${row.to}, ${style.label}`}
            />
          );
        })}

        {/* "now" marker */}
        <div
          className="pointer-events-none absolute inset-y-0 w-px opacity-60"
          style={{
            left: `${Math.min(98, Math.max(2, ((Date.now() - minTime) / span) * 96 + 2))}%`,
            backgroundColor: themeColor,
          }}
        />
      </div>

      <div className="flex justify-between text-[10px] font-medium text-zinc-500">
        <span>{formatDateTime(new Date(minTime))}</span>
        <span>time &rarr;</span>
        <span>{formatDateTime(new Date(minTime + span))}</span>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-4">
        {LEGEND.map((status) => {
          const count = rows.filter((r) => r.status === status).length;
          if (count === 0) return null;
          return (
            <div key={status} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: EMAIL_STATUS_STYLES[status].dot }}
              />
              {EMAIL_STATUS_STYLES[status].label} ({count})
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;
  const toast = useToast();
  const { themeColor } = useThemeColor();

  const [data, setData] = React.useState<CampaignDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setData(await api.campaigns.get(campaignId));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Live: refresh when any email of this campaign moves.
  const pending = React.useRef(false);
  useLiveSubscription(
    React.useCallback(
      (event) => {
        const relevant =
          (event.type === "email.status" && event.campaignId === campaignId) ||
          (event.type === "campaign.progress" && event.campaignId === campaignId);
        if (!relevant || pending.current) return;
        pending.current = true;
        setTimeout(() => {
          pending.current = false;
          void load();
        }, 600);
      },
      [campaignId, load],
    ),
  );

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      await load();
    } catch (err) {
      toast.error(
        `Could not ${label.toLowerCase()}`,
        err instanceof ApiError ? err.message : "Unexpected error",
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full rounded-3xl" />
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/campaigns">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-3.5 w-3.5" />}>
            Back to campaigns
          </Button>
        </Link>
        <div className="flex items-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          <AlertCircle className="h-4 w-4" />
          Campaign not found.
        </div>
      </div>
    );
  }

  const { campaign, counts, nextUp, timeline } = data;
  const sent = counts.SENT ?? 0;
  const percent = campaign.totalRecipients
    ? Math.round((sent / campaign.totalRecipients) * 100)
    : 0;

  const canPause = ["SCHEDULED", "RUNNING"].includes(campaign.status);
  const canResume = campaign.status === "PAUSED";
  const canCancel = !["COMPLETED", "CANCELLED"].includes(campaign.status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link href="/dashboard/campaigns">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-3.5 w-3.5" />}>
            Campaigns
          </Button>
        </Link>

        <div className="mt-4 flex flex-col items-center gap-4 text-center">
          <CampaignStatusChip status={campaign.status} />
          <div>
            <h1 className="font-serif text-3xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-4xl">
              {campaign.name}
            </h1>
            <p className="mt-2 font-sans text-sm text-zinc-500 dark:text-zinc-400">
              {campaign.sender?.label} &middot; cap {campaign.hourlyLimit}/window &middot;{" "}
              {campaign.delayBetweenEmailsMs}ms stagger
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {canPause && (
              <Button
                variant="outline"
                loading={busy}
                icon={<Pause className="h-4 w-4" />}
                onClick={() => act("Paused", () => api.campaigns.pause(campaignId))}
              >
                Pause
              </Button>
            )}
            {canResume && (
              <Button
                loading={busy}
                icon={<Play className="h-4 w-4" />}
                onClick={() => act("Resumed", () => api.campaigns.resume(campaignId))}
              >
                Resume
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outline"
                loading={busy}
                icon={<Ban className="h-4 w-4" />}
                onClick={() => act("Cancelled", () => api.campaigns.cancel(campaignId))}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Progress */}
      <section className="liquid-glass p-6 sm:p-7">
        <div className="flex flex-col items-center gap-5 text-center">
          <div>
            <p className="font-serif text-6xl font-bold leading-none text-zinc-900 dark:text-white">
              {percent}<span className="text-3xl">%</span>
            </p>
            <p className="mt-1.5 text-xs text-zinc-500">
              {formatNumber(sent)} of {formatNumber(campaign.totalRecipients)} delivered
            </p>
          </div>
          {nextUp && (
            <div className="text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Next up
              </p>
              <p className="text-sm font-medium text-zinc-900 dark:text-white">{nextUp.to}</p>
              <p className="text-xs text-zinc-500">{relativeTime(nextUp.sendAt)}</p>
            </div>
          )}
        </div>

        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: themeColor }}
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ type: "spring", stiffness: 80, damping: 20 }}
          />
        </div>

        <div className="mt-6 grid grid-cols-3 gap-4 text-center sm:grid-cols-6">
          {LEGEND.map((status) => (
            <div key={status}>
              <p className="font-serif text-2xl font-bold leading-none text-zinc-900 dark:text-white">
                {formatNumber(counts[status] ?? 0)}
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {EMAIL_STATUS_STYLES[status].label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Timeline */}
      <section className="liquid-glass p-6 sm:p-7">
        <h2 className="mb-5 flex flex-col items-center gap-2 text-center font-serif text-lg font-bold text-zinc-900 dark:text-white">
          <Activity className="h-4 w-4" style={{ color: themeColor }} />
          Delivery timeline
          <span className="text-xs font-normal text-zinc-500">
            (click a node to inspect that email)
          </span>
        </h2>
        <Timeline rows={timeline} onSelect={setSelected} />
      </section>

      {/* Recipients */}
      <section className="liquid-glass">
        <h2 className="border-b border-black/10 px-5 py-5 text-center font-serif text-lg font-bold text-zinc-900 dark:border-white/10 dark:text-white">
          Recipients
        </h2>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[600px] text-left text-sm">
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              <AnimatePresence initial={false}>
                {timeline.map((row) => (
                  <motion.tr
                    key={row.id}
                    layout
                    onClick={() => setSelected(row.id)}
                    className="cursor-pointer transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  >
                    <td className="max-w-[240px] truncate px-5 py-3 font-medium text-zinc-900 dark:text-white">
                      {row.to}
                    </td>
                    <td className="px-5 py-3">
                      <EmailStatusChip
                        status={row.status}
                        pulse={row.status === "PROCESSING"}
                      />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-zinc-500">
                      {formatDateTime(row.sentAt ?? row.sendAt)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {row.deferredCount > 0 && (
                        <span
                          className={cn("mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold")}
                          style={{ backgroundColor: "#fb923c22", color: "#fb923c" }}
                        >
                          {row.deferredCount}x deferred
                        </span>
                      )}
                      {row.previewUrl && (
                        <a
                          href={row.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex rounded p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                          aria-label="Open delivered message"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </section>

      <EmailDrawer emailId={selected} onClose={() => setSelected(null)} onChanged={load} />
    </div>
  );
}
