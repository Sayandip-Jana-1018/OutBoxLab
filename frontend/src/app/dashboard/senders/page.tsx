"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Sparkles,
  Mailbox,
  ShieldCheck,
  Trash2,
  Power,
  Check,
  X,
  Pencil,
  Server,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useThemeColor } from "@/context/theme-context";
import { useLiveSubscription } from "@/context/live-context";
import { QuotaRing } from "@/components/charts/quota-ring";
import { PageHeader } from "@/components/ui/page-header";
import { AddSmtpDialog } from "@/components/dashboard/add-smtp-dialog";
import {
  Button,
  EmptyState,
  Field,
  Input,
  Skeleton,
} from "@/components/ui/primitives";
import { formatDateTime, relativeTime } from "@/lib/format";
import type { Sender } from "@/lib/types";

function SenderCard({
  sender,
  onChanged,
}: {
  sender: Sender;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { themeColor } = useThemeColor();
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [limit, setLimit] = React.useState(sender.hourlyLimit);
  const [gap, setGap] = React.useState(sender.minDelayMs);

  /**
   * `done` is past tense ("Verified"), `failed` is the whole failure title.
   * Deriving one from the other produced "Could not verified", which is the
   * kind of thing a reader notices immediately and trusts a little less.
   */
  const act = async (
    done: string,
    failed: string,
    fn: () => Promise<unknown>,
  ) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      onChanged();
    } catch (err) {
      toast.error(
        failed,
        err instanceof ApiError ? err.message : "Unexpected error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="liquid-glass flex w-full max-w-md flex-col items-center p-6 text-center lg:w-[460px]"
    >
      <div className="flex flex-col items-center gap-4">
        <QuotaRing
          used={sender.quota.used}
          limit={sender.quota.limit}
          size={92}
        />

        <div className="min-w-0 w-full">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <h3 className="truncate font-serif text-lg font-bold text-zinc-900 dark:text-white">
              {sender.label}
            </h3>
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                color: sender.provider === "ETHEREAL" ? themeColor : "#a1a1aa",
                borderColor:
                  sender.provider === "ETHEREAL"
                    ? `${themeColor}55`
                    : "#a1a1aa55",
                backgroundColor:
                  sender.provider === "ETHEREAL"
                    ? `${themeColor}15`
                    : "#a1a1aa15",
              }}
            >
              {sender.provider}
            </span>
            {!sender.isActive && (
              <span className="rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Inactive
              </span>
            )}
          </div>

          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {sender.fromEmail}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-zinc-400">
            {sender.smtpHost}:{sender.smtpPort}
          </p>

          {/* The single most important thing to know about a mailbox: whether
              anything it sends actually arrives. */}
          <p
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold"
            style={
              sender.provider === "ETHEREAL"
                ? {
                    color: "#fbbf24",
                    borderColor: "#fbbf2444",
                    backgroundColor: "#fbbf2414",
                  }
                : {
                    color: "#34d399",
                    borderColor: "#34d39944",
                    backgroundColor: "#34d39914",
                  }
            }
          >
            {sender.provider === "ETHEREAL"
              ? "Sandbox - stores mail, never delivers"
              : "Live - delivers to real inboxes"}
          </p>

          {editing ? (
            <div className="mt-5 flex flex-wrap items-end justify-center gap-3">
              <Field label="Cap / window" className="w-32" center>
                <Input
                  type="number"
                  min={1}
                  value={limit}
                  onChange={(e) =>
                    setLimit(Math.max(1, Number(e.target.value)))
                  }
                  className="py-2 text-center"
                />
              </Field>
              <Field label="Min gap (ms)" className="w-32" center>
                <Input
                  type="number"
                  min={0}
                  step={250}
                  value={gap}
                  onChange={(e) => setGap(Math.max(0, Number(e.target.value)))}
                  className="py-2 text-center"
                />
              </Field>
              <Button
                size="sm"
                loading={busy}
                icon={<Check className="h-3.5 w-3.5" />}
                onClick={async () => {
                  await act(
                    "Mailbox updated",
                    "Could not update the mailbox",
                    () =>
                      api.senders.update(sender.id, {
                        hourlyLimit: limit,
                        minDelayMs: gap,
                      }),
                  );
                  setEditing(false);
                }}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<X className="h-3.5 w-3.5" />}
                onClick={() => {
                  setEditing(false);
                  setLimit(sender.hourlyLimit);
                  setGap(sender.minDelayMs);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="mt-5 grid w-full grid-cols-3 gap-3">
              {(
                [
                  ["Cap", `${sender.hourlyLimit}`, "per window"],
                  ["Min gap", `${sender.minDelayMs}ms`, "between sends"],
                  [
                    "Resets",
                    relativeTime(sender.quota.resetsAt),
                    "next window",
                  ],
                ] as const
              ).map(([label, value, hint]) => (
                <div key={label} className="liquid-well px-2 py-3">
                  <p className="font-serif text-base font-bold text-zinc-900 dark:text-white">
                    {value}
                  </p>
                  <p className="mt-0.5 font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">
                    {label}
                  </p>
                  <p className="font-sans text-[10px] text-zinc-400">{hint}</p>
                </div>
              ))}
            </div>
          )}
          {!editing && sender.lastVerified && (
            <p className="mt-3 font-sans text-[11px] text-zinc-400">
              SMTP verified {formatDateTime(sender.lastVerified)}
            </p>
          )}
        </div>
      </div>

      {!editing && (
        <div className="mt-6 flex w-full flex-wrap justify-center gap-2 border-t border-black/5 pt-5 dark:border-white/5">
          <Button
            size="sm"
            variant="ghost"
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => setEditing(true)}
          >
            Edit limits
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            onClick={() =>
              act("Verified", "Verification failed", async () => {
                const { verified } = await api.senders.verify(sender.id);
                if (!verified)
                  throw new ApiError(
                    400,
                    "SMTP",
                    "SMTP credentials did not authenticate",
                  );
              })
            }
          >
            Verify SMTP
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            icon={<Power className="h-3.5 w-3.5" />}
            onClick={() =>
              act(
                sender.isActive ? "Deactivated" : "Activated",
                sender.isActive
                  ? "Could not deactivate the mailbox"
                  : "Could not activate the mailbox",
                () =>
                  api.senders.update(sender.id, { isActive: !sender.isActive }),
              )
            }
          >
            {sender.isActive ? "Deactivate" : "Activate"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() =>
              act("Deleted", "Could not delete the mailbox", () =>
                api.senders.remove(sender.id),
              )
            }
          >
            Delete
          </Button>
        </div>
      )}
    </motion.div>
  );
}

export default function SendersPage() {
  const toast = useToast();
  const [senders, setSenders] = React.useState<Sender[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [provisioning, setProvisioning] = React.useState(false);
  /** Mailboxes are unbounded (one click each), so cap the grid and collapse
   * the rest rather than letting it grow into a ragged wall of cards. */
  const [smtpOpen, setSmtpOpen] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);
  const VISIBLE = 6;

  const load = React.useCallback(async () => {
    try {
      const { senders } = await api.senders.list();
      setSenders(senders);
    } catch {
      setSenders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Quota rings should move as the worker consumes budget.
  const pending = React.useRef(false);
  useLiveSubscription(
    React.useCallback(() => {
      if (pending.current) return;
      pending.current = true;
      setTimeout(() => {
        pending.current = false;
        void load();
      }, 1000);
    }, [load]),
  );

  const provision = async () => {
    setProvisioning(true);
    try {
      const { sender } = await api.senders.createEthereal("Ethereal mailbox");
      toast.success("Mailbox provisioned", sender.fromEmail);
      await load();
    } catch (err) {
      toast.error(
        "Could not provision mailbox",
        err instanceof ApiError ? err.message : "Unexpected error",
      );
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Sending identities"
        title="Mailboxes"
        description="Each mailbox carries its own throughput budget. Rate limiting is enforced per mailbox, never globally - that is how real providers throttle."
        action={
          <>
            <Button
              variant="outline"
              loading={provisioning}
              onClick={provision}
              icon={<Sparkles className="h-4 w-4" />}
            >
              Generate Ethereal mailbox
            </Button>
            <Button
              onClick={() => setSmtpOpen(true)}
              icon={<Server className="h-4 w-4" />}
            >
              Add SMTP mailbox
            </Button>
          </>
        }
      />

      {loading ? (
        <div className="flex flex-wrap justify-center gap-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full max-w-md lg:w-[460px]" />
          ))}
        </div>
      ) : senders.length === 0 ? (
        <EmptyState
          icon={<Mailbox className="h-5 w-5" />}
          title="No mailboxes yet"
          description="Generate a sandboxed Ethereal mailbox in one click - no credentials needed, and every message gets a shareable preview link. Add an SMTP mailbox instead if you want mail to actually reach real inboxes."
          action={
            <Button loading={provisioning} onClick={provision} size="sm">
              Generate Ethereal mailbox
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap justify-center gap-5">
            {(showAll ? senders : senders.slice(0, VISIBLE)).map((sender) => (
              <SenderCard key={sender.id} sender={sender} onChanged={load} />
            ))}
          </div>

          {senders.length > VISIBLE && (
            <div className="flex justify-center">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll
                  ? "Show fewer"
                  : `Show all ${senders.length} mailboxes`}
              </Button>
            </div>
          )}
        </>
      )}

      <AddSmtpDialog
        open={smtpOpen}
        onClose={() => setSmtpOpen(false)}
        onCreated={load}
      />
    </div>
  );
}
