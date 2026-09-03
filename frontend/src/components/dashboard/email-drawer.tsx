"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  ExternalLink,
  RotateCcw,
  Ban,
  CalendarClock,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useThemeColor } from "@/context/theme-context";
import { useLiveSubscription } from "@/context/live-context";
import { Button, Field, Input, Skeleton } from "@/components/ui/primitives";
import { Portal } from "@/components/ui/portal";
import { EmailStatusChip } from "@/components/ui/status-chip";
import {
  EVENT_LABELS,
  formatDateTime,
  formatTime,
  relativeTime,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EmailDetail, EmailEventType } from "@/lib/types";

const EVENT_ACCENT: Record<EmailEventType, string> = {
  QUEUED: "#38bdf8",
  PICKED_UP: "#fbbf24",
  DEFERRED_RATE_LIMIT: "#fb923c",
  DEFERRED_PACING: "#fb923c",
  SENT: "#34d399",
  FAILED: "#fb7185",
  RETRY_SCHEDULED: "#fbbf24",
  RESCHEDULED: "#a78bfa",
  CANCELLED: "#a1a1aa",
  RECONCILED: "#38bdf8",
};

/**
 * Per-email inspector.
 *
 * The timeline is the honest answer to "why did this email do that?": it is
 * rendered straight from the durable `email_events` audit trail, so a deferral
 * shows the exact cap that was hit and the window it was pushed into.
 */
export function EmailDrawer({
  emailId,
  onClose,
  onChanged,
}: {
  emailId: string | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const { themeColor } = useThemeColor();
  const [email, setEmail] = React.useState<EmailDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [rescheduleAt, setRescheduleAt] = React.useState("");

  const load = React.useCallback(async () => {
    if (!emailId) return;
    setLoading(true);
    try {
      const { email } = await api.emails.get(emailId);
      setEmail(email);
    } catch {
      setEmail(null);
    } finally {
      setLoading(false);
    }
  }, [emailId]);

  React.useEffect(() => {
    setEmail(null);
    setRescheduleAt("");
    void load();
  }, [load]);

  // Keep the open drawer in sync with the worker.
  useLiveSubscription(
    React.useCallback(
      (event) => {
        if (event.type === "email.status" && event.emailId === emailId) void load();
      },
      [emailId, load],
    ),
  );

  // Escape to close.
  React.useEffect(() => {
    if (!emailId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [emailId, onClose]);

  // Stop the page scrolling behind the overlay.
  React.useEffect(() => {
    if (!emailId) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [emailId]);


  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(
        `Could not ${label.toLowerCase()}`,
        err instanceof ApiError ? err.message : "Unexpected error",
      );
    } finally {
      setBusy(false);
    }
  };

  const canCancel =
    email && ["SCHEDULED", "PROCESSING", "DEFERRED"].includes(email.status);
  const canRetry = email && ["FAILED", "CANCELLED"].includes(email.status);

  return (
    <Portal>
      <AnimatePresence>
        {emailId && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm"
            aria-hidden
          />

          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            role="dialog"
            aria-modal="true"
            aria-label="Email details"
            className="liquid-glass liquid-glass-strong fixed inset-y-0 right-0 z-[100] flex w-full max-w-lg flex-col !rounded-l-3xl !rounded-r-none"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-black/10 p-5 dark:border-white/10">
              <div className="min-w-0 flex-1">
                {loading && !email ? (
                  <Skeleton className="h-5 w-48" />
                ) : (
                  <>
                    <p className="truncate font-serif text-lg font-bold text-zinc-900 dark:text-white">
                      {email?.to ?? "Email"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {email?.subject}
                    </p>
                  </>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {email && <EmailStatusChip status={email.status} pulse={email.status === "PROCESSING"} />}
                <button
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
                  aria-label="Close details"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              {loading && !email ? (
                <div className="space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !email ? (
                <p className="text-sm text-zinc-500">Could not load this email.</p>
              ) : (
                <>
                  {/* Facts */}
                  <dl className="grid grid-cols-2 gap-3">
                    {(
                      [
                        ["Scheduled for", formatDateTime(email.sendAt)],
                        ["Delivered", email.sentAt ? formatDateTime(email.sentAt) : "-"],
                        ["Mailbox", email.sender.label],
                        ["Cap", `${email.hourlyLimit} / window`],
                        ["Attempts", String(email.attempts)],
                        ["Deferrals", String(email.deferredCount)],
                      ] as const
                    ).map(([label, value]) => (
                      <div
                        key={label}
                        className="liquid-well px-3 py-3 text-center"
                      >
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          {label}
                        </dt>
                        <dd className="mt-0.5 truncate text-sm font-medium text-zinc-900 dark:text-white">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {email.lastError && (
                    <div className="flex gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <p className="break-words">{email.lastError}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    {email.previewUrl && (
                      <a href={email.previewUrl} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="outline" icon={<ExternalLink className="h-3.5 w-3.5" />}>
                          View delivered message
                        </Button>
                      </a>
                    )}
                    {canCancel && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busy}
                        icon={<Ban className="h-3.5 w-3.5" />}
                        onClick={() => act("Cancelled", () => api.emails.cancel(email.id))}
                      >
                        Cancel
                      </Button>
                    )}
                    {canRetry && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busy}
                        icon={<RotateCcw className="h-3.5 w-3.5" />}
                        onClick={() => act("Retried", () => api.emails.retry(email.id))}
                      >
                        Retry now
                      </Button>
                    )}
                  </div>

                  {/* Reschedule */}
                  {canCancel && (
                    <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
                      <Field
                        label="Reschedule"
                        hint="local time"
                        htmlFor="reschedule-at"
                      >
                        <div className="flex gap-2">
                          <Input
                            id="reschedule-at"
                            type="datetime-local"
                            value={rescheduleAt}
                            onChange={(e) => setRescheduleAt(e.target.value)}
                          />
                          <Button
                            size="md"
                            disabled={!rescheduleAt}
                            loading={busy}
                            icon={<CalendarClock className="h-4 w-4" />}
                            onClick={() =>
                              act("Rescheduled", () =>
                                api.emails.reschedule(
                                  email.id,
                                  new Date(rescheduleAt).toISOString(),
                                ),
                              )
                            }
                          >
                            Move
                          </Button>
                        </div>
                      </Field>
                    </div>
                  )}

                  {/* Timeline */}
                  <div>
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-white">
                      <Clock className="h-4 w-4" style={{ color: themeColor }} />
                      Timeline
                      <span className="text-xs font-normal text-zinc-500">
                        ({email.events.length} events)
                      </span>
                    </h3>

                    <ol className="relative space-y-0 border-l border-black/10 pl-5 dark:border-white/10">
                      {email.events.map((event) => (
                        <li key={event.id} className="relative pb-5 last:pb-0">
                          <span
                            className="absolute -left-[25px] top-1 flex h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-zinc-950"
                            style={{ backgroundColor: EVENT_ACCENT[event.type] }}
                          />
                          <div className="flex items-baseline justify-between gap-2">
                            <p
                              className="text-xs font-bold"
                              style={{ color: EVENT_ACCENT[event.type] }}
                            >
                              {EVENT_LABELS[event.type]}
                            </p>
                            <time
                              className="shrink-0 font-mono text-[10px] text-zinc-400"
                              dateTime={event.createdAt}
                              title={formatDateTime(event.createdAt)}
                            >
                              {formatTime(event.createdAt)}
                            </time>
                          </div>
                          {event.message && (
                            <p className="mt-1 break-words text-xs text-zinc-500 dark:text-zinc-400">
                              {event.message}
                            </p>
                          )}
                          <p className="mt-0.5 text-[10px] text-zinc-400">
                            {relativeTime(event.createdAt)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Rendered body */}
                  <div>
                    <h3 className="mb-2 text-sm font-bold text-zinc-900 dark:text-white">
                      Rendered body
                    </h3>
                    <pre
                      className={cn(
                        "max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border p-3.5 text-xs leading-relaxed",
                        "border-black/10 bg-black/[0.03] text-zinc-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300",
                      )}
                    >
                      {email.body}
                    </pre>
                  </div>
                </>
              )}
            </div>
          </motion.aside>
        </>
        )}
      </AnimatePresence>
    </Portal>
  );
}
