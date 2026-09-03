"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Inbox,
  ExternalLink,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useLiveSubscription } from "@/context/live-context";
import { useThemeColor } from "@/context/theme-context";
import { EmailDrawer } from "./email-drawer";
import { EmailStatusChip } from "@/components/ui/status-chip";
import { Button, EmptyState, Input, Skeleton } from "@/components/ui/primitives";
import {
  EMAIL_STATUS_STYLES,
  formatDateTime,
  formatNumber,
  relativeTime,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EmailRow, EmailStatus } from "@/lib/types";

const PAGE_SIZE = 25;

export function EmailTable({
  view,
  statuses,
  campaignId,
  emptyTitle,
  emptyDescription,
  initialEmailId,
}: {
  view: "pending" | "history" | "all";
  statuses: EmailStatus[];
  campaignId?: string;
  emptyTitle: string;
  emptyDescription: string;
  initialEmailId?: string | null;
}) {
  const { themeColor } = useThemeColor();

  const [rows, setRows] = React.useState<EmailRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<EmailStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<string | null>(initialEmailId ?? null);
  /** Ids that just changed over SSE - drives a brief highlight flash. */
  const [flashed, setFlashed] = React.useState<Set<string>>(new Set());

  // Debounce so a fast typist issues one query, not one per keystroke.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = React.useCallback(async () => {
    try {
      const result = await api.emails.list({
        view,
        page,
        pageSize: PAGE_SIZE,
        q: debouncedQuery || undefined,
        status: statusFilter ?? undefined,
        campaignId,
        sort: debouncedQuery ? "relevance" : "sendAt",
        order: view === "history" ? "desc" : "asc",
      });
      setRows(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch {
      setRows([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [view, page, debouncedQuery, statusFilter, campaignId]);

  React.useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Realtime: patch the row in place when we already have it, then reload in a
  // coalesced pass because its new status may move it in or out of this view.
  const reloadTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveSubscription(
    React.useCallback(
      (event) => {
        if (event.type !== "email.status") return;

        setRows((prev) => {
          const index = prev.findIndex((r) => r.id === event.emailId);
          if (index === -1) return prev;
          const next = [...prev];
          next[index] = { ...next[index], status: event.status } as EmailRow;
          return next;
        });

        setFlashed((prev) => new Set(prev).add(event.emailId));
        setTimeout(() => {
          setFlashed((prev) => {
            const next = new Set(prev);
            next.delete(event.emailId);
            return next;
          });
        }, 1400);

        if (reloadTimer.current) clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(() => void load(), 900);
      },
      [load],
    ),
  );

  return (
    <>
      {/* ---- Centred controls ---- */}
      <div className="mb-7 flex flex-col items-center gap-4">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recipient, subject or body..."
            className="pl-11 pr-11 text-center"
            aria-label="Search emails"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-white"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => {
              setStatusFilter(null);
              setPage(1);
            }}
            className={cn(
              "rounded-full border px-4 py-1.5 text-[11px] font-bold transition-all duration-300",
              statusFilter === null
                ? "border-transparent text-white shadow-md"
                : "border-black/10 text-zinc-500 hover:text-zinc-900 dark:border-white/12 dark:hover:text-white",
            )}
            style={statusFilter === null ? { backgroundColor: themeColor } : undefined}
          >
            All
          </button>
          {statuses.map((status) => {
            const active = statusFilter === status;
            return (
              <button
                key={status}
                onClick={() => {
                  setStatusFilter(active ? null : status);
                  setPage(1);
                }}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-[11px] font-bold transition-all duration-300",
                  active
                    ? EMAIL_STATUS_STYLES[status].chip
                    : "border-black/10 text-zinc-500 hover:text-zinc-900 dark:border-white/12 dark:hover:text-white",
                )}
              >
                {EMAIL_STATUS_STYLES[status].label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Table ---- */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="liquid-glass"
      >
        {loading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<Inbox className="h-5 w-5" />}
              title={debouncedQuery ? "No emails match that search" : emptyTitle}
              description={
                debouncedQuery
                  ? "Try a different term - search covers recipient, subject and body via Postgres full-text search."
                  : emptyDescription
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-center text-sm">
              <thead>
                <tr className="border-b border-black/10 font-sans text-[10px] uppercase tracking-[0.14em] text-zinc-500 dark:border-white/10">
                  <th className="px-5 py-4 text-left font-bold">Recipient</th>
                  <th className="px-5 py-4 text-left font-bold">Subject</th>
                  <th className="px-5 py-4 font-bold">Status</th>
                  <th className="px-5 py-4 font-bold">
                    {view === "history" ? "Delivered" : "Send at"}
                  </th>
                  <th className="px-5 py-4 font-bold">Attempts</th>
                  <th className="w-12 px-5 py-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                <AnimatePresence initial={false}>
                  {rows.map((row) => (
                    <motion.tr
                      key={row.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{
                        opacity: 1,
                        backgroundColor: flashed.has(row.id)
                          ? `${themeColor}26`
                          : "rgba(0,0,0,0)",
                      }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.35 }}
                      onClick={() => setSelected(row.id)}
                      className="cursor-pointer transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.05]"
                    >
                      <td className="max-w-[220px] truncate px-5 py-4 text-left font-medium text-zinc-900 dark:text-white">
                        {row.to}
                      </td>
                      <td className="max-w-[280px] truncate px-5 py-4 text-left text-zinc-500 dark:text-zinc-400">
                        {row.subject}
                      </td>
                      <td className="px-5 py-4">
                        <EmailStatusChip
                          status={row.status}
                          pulse={row.status === "PROCESSING"}
                        />
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-zinc-500 dark:text-zinc-400">
                        <span title={formatDateTime(row.sentAt ?? row.sendAt)}>
                          {relativeTime(row.sentAt ?? row.sendAt)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-zinc-500 dark:text-zinc-400">
                        <span className="inline-flex items-center gap-1.5">
                          {row.deferredCount > 0 && (
                            <span
                              className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                              style={{ backgroundColor: "#fb923c22", color: "#fb923c" }}
                              title={`Deferred ${row.deferredCount}x by the rate limiter or pacer`}
                            >
                              {row.deferredCount}d
                            </span>
                          )}
                          {row.attempts}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {row.previewUrl && (
                          <a
                            href={row.previewUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white"
                            aria-label="Open delivered message"
                            title="Open delivered message"
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
        )}

        {/* Pagination */}
        {!loading && total > 0 && (
          <div className="flex flex-col items-center gap-3 border-t border-black/10 px-5 py-4 font-sans text-xs text-zinc-500 dark:border-white/10 sm:flex-row sm:justify-between">
            <span>
              {formatNumber(total)} email{total === 1 ? "" : "s"}
              {debouncedQuery && " matching"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                icon={<ChevronLeft className="h-3.5 w-3.5" />}
                aria-label="Previous page"
              >
                Prev
              </Button>
              <span className="font-semibold">
                {page} / {Math.max(1, totalPages)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </motion.div>

      <EmailDrawer emailId={selected} onClose={() => setSelected(null)} onChanged={load} />
    </>
  );
}
