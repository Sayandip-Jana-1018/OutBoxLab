"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Megaphone, PenSquare, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useLiveSubscription } from "@/context/live-context";
import { useThemeColor } from "@/context/theme-context";
import { CampaignStatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/ui/page-header";
import { Button, EmptyState, Skeleton } from "@/components/ui/primitives";
import { EMAIL_STATUS_STYLES, formatDateTime, formatNumber, relativeTime } from "@/lib/format";
import type { Campaign, EmailStatus } from "@/lib/types";

const SEGMENTS: EmailStatus[] = ["SENT", "PROCESSING", "DEFERRED", "SCHEDULED", "FAILED", "CANCELLED"];

/** Stacked progress bar built from the per-status counts. */
function ProgressBar({ counts, total }: { counts: Partial<Record<EmailStatus, number>>; total: number }) {
  if (total === 0) return null;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
      {SEGMENTS.map((status) => {
        const value = counts[status] ?? 0;
        if (value === 0) return null;
        return (
          <div
            key={status}
            style={{
              width: `${(value / total) * 100}%`,
              backgroundColor: EMAIL_STATUS_STYLES[status].dot,
            }}
            title={`${EMAIL_STATUS_STYLES[status].label}: ${value}`}
          />
        );
      })}
    </div>
  );
}

export default function CampaignsPage() {
  const { themeColor } = useThemeColor();
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([]);
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      const result = await api.campaigns.list({ page, pageSize: 12 });
      setCampaigns(result.items);
      setTotalPages(result.totalPages);
      setTotal(result.total);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  React.useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const pending = React.useRef(false);
  useLiveSubscription(
    React.useCallback(() => {
      if (pending.current) return;
      pending.current = true;
      setTimeout(() => {
        pending.current = false;
        void load();
      }, 1200);
    }, [load]),
  );

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow={
          total > 0 ? `${formatNumber(total)} campaign${total === 1 ? "" : "s"}` : "Batches"
        }
        title="Campaigns"
        description="Every scheduled batch with live progress. Open one to watch its recipients move across the delivery timeline in real time."
        action={
          <Link href="/dashboard/compose">
            <Button icon={<PenSquare className="h-4 w-4" />}>New campaign</Button>
          </Link>
        }
      />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-3xl" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-5 w-5" />}
          title="No campaigns yet"
          description="Compose your first campaign - drop in a CSV and OutboxLab will schedule every recipient."
          action={
            <Link href="/dashboard/compose">
              <Button size="sm">Compose a campaign</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {campaigns.map((campaign, index) => {
              const counts = campaign.counts ?? {};
              const sent = counts.SENT ?? 0;
              const total = campaign.totalRecipients || 1;
              const percent = Math.round((sent / total) * 100);

              return (
                <motion.div
                  key={campaign.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.03, 0.2) }}
                >
                  <Link
                    href={`/dashboard/campaigns/${campaign.id}`}
                    className="liquid-glass liquid-hover group flex h-full flex-col items-center p-6 text-center"
                  >
                    <CampaignStatusChip status={campaign.status} />

                    <h2 className="mt-3 line-clamp-2 font-serif text-lg font-bold text-zinc-900 dark:text-white">
                      {campaign.name}
                    </h2>

                    <p className="mt-1 truncate font-sans text-xs text-zinc-500">
                      {campaign.sender?.label ?? "Mailbox"} &middot; created{" "}
                      {relativeTime(campaign.createdAt)}
                    </p>

                    <div className="mt-5 w-full">
                      <p className="font-serif text-4xl font-bold leading-none text-zinc-900 dark:text-white">
                        {percent}
                        <span className="text-xl">%</span>
                      </p>
                      <p className="mb-3 mt-1.5 font-sans text-xs text-zinc-500">
                        {formatNumber(sent)} of {formatNumber(campaign.totalRecipients)} delivered
                      </p>
                      <ProgressBar counts={counts} total={campaign.totalRecipients} />
                    </div>

                    <div className="mt-5 flex w-full flex-col items-center gap-2 border-t border-black/5 pt-4 font-sans text-xs text-zinc-500 dark:border-white/5">
                      <span>Starts {formatDateTime(campaign.startAt)}</span>
                      <span
                        className="flex items-center gap-1 font-bold transition-transform group-hover:translate-x-0.5"
                        style={{ color: themeColor }}
                      >
                        Open timeline <ArrowRight className="h-3 w-3" />
                      </span>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 text-xs text-zinc-500">
              <Button
                size="sm"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                icon={<ChevronLeft className="h-3.5 w-3.5" />}
              >
                Prev
              </Button>
              <span className="font-medium">
                {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
