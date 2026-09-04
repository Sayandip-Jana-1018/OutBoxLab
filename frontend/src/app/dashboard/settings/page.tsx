"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Clock,
  Activity,
  Database,
  Server,
  ExternalLink,
  RotateCcw,
  Zap,
  Palette,
  Gauge,
} from "lucide-react";
import { api, ApiError, API_ORIGIN } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useThemeColor } from "@/context/theme-context";
import { useAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/ui/page-header";
import { Button, Skeleton } from "@/components/ui/primitives";
import { formatDuration, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClockInfo, HealthInfo } from "@/lib/types";

const PRESETS = [
  { label: "1 minute", ms: 60_000, hint: "demo speed" },
  { label: "5 minutes", ms: 300_000, hint: "" },
  { label: "1 hour", ms: 3_600_000, hint: "production default" },
];

export default function SettingsPage() {
  const toast = useToast();
  const { user } = useAuth();
  const { themeColor } = useThemeColor();

  const [clock, setClock] = React.useState<ClockInfo | null>(null);
  const [health, setHealth] = React.useState<HealthInfo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const [clockResult, healthResult] = await Promise.allSettled([
      api.system.clock(),
      api.system.health(),
    ]);
    if (clockResult.status === "fulfilled") setClock(clockResult.value);
    if (healthResult.status === "fulfilled") setHealth(healthResult.value);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const applyWindow = async (windowMs?: number, reset = false) => {
    setBusy(true);
    try {
      const result = await api.system.timeMachine(windowMs, reset);
      toast.success(
        reset ? "Window restored" : `Window compressed to ${result.windowLabel}`,
        result.note,
      );
      await load();
    } catch (err) {
      toast.error(
        "Could not change the window",
        err instanceof ApiError ? err.message : "Unexpected error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Engine configuration, system health and appearance."
      />

      {/* Time Machine */}
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="liquid-glass flex flex-col items-center p-6 text-center sm:p-8"
      >
        <div
          className="flex h-11 w-11 items-center justify-center rounded-2xl border"
          style={{
            color: themeColor,
            borderColor: `${themeColor}44`,
            backgroundColor: `${themeColor}14`,
          }}
        >
          <Clock className="h-5 w-5" />
        </div>
        <h2 className="mt-3 font-serif text-lg font-bold text-zinc-900 dark:text-white">
          Time Machine
        </h2>
        <p className="mx-auto mt-2 max-w-2xl font-sans text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Compresses the rate-limit window at runtime so throttling and next-window recovery can be
          demonstrated in seconds instead of an hour. It changes exactly one number - the window
          length. The same Lua limiter, the same{" "}
          <code className="font-mono">moveToDelayed</code> path and the same bucket arithmetic stay
          in use, so what you watch is the real production behaviour, just faster.
        </p>

        {loading ? (
          <Skeleton className="mt-6 h-24 w-full" />
        ) : !clock ? (
          <p className="mt-6 text-sm text-zinc-500">Could not read the clock configuration.</p>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <div
                className="rounded-2xl border px-6 py-4"
                style={{
                  borderColor: clock.isCompressed ? "#fbbf2455" : `${themeColor}44`,
                  backgroundColor: clock.isCompressed ? "#fbbf2415" : `${themeColor}12`,
                }}
              >
                <p className="font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                  Active window
                </p>
                <p
                  className="font-serif text-3xl font-bold"
                  style={{ color: clock.isCompressed ? "#fbbf24" : themeColor }}
                >
                  {clock.windowLabel}
                </p>
              </div>

              {clock.isCompressed && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
                  Compressed from {formatDuration(clock.defaultWindowMs)}
                  <br />
                  demo mode is on
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.ms}
                  size="sm"
                  variant={clock.windowMs === preset.ms ? "primary" : "outline"}
                  loading={busy}
                  disabled={!clock.timeMachineEnabled}
                  onClick={() => applyWindow(preset.ms)}
                  icon={<Zap className="h-3.5 w-3.5" />}
                >
                  {preset.label}
                  {preset.hint && (
                    <span className="ml-1 opacity-60">({preset.hint})</span>
                  )}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                loading={busy}
                disabled={!clock.timeMachineEnabled}
                onClick={() => applyWindow(undefined, true)}
                icon={<RotateCcw className="h-3.5 w-3.5" />}
              >
                Reset to env default
              </Button>
            </div>

            {!clock.timeMachineEnabled && (
              <p className="mt-3 text-xs text-zinc-500">
                The Time Machine is disabled in this environment
                (<code className="font-mono">ENABLE_TIME_MACHINE=false</code>).
              </p>
            )}
          </>
        )}
      </motion.section>

      {/* Concurrency */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="liquid-glass p-6 sm:p-7"
      >
        <h2 className="mb-1 flex items-center justify-center gap-2 font-serif text-lg font-bold text-zinc-900 dark:text-white">
          <Gauge className="h-4 w-4" style={{ color: themeColor }} />
          Concurrency controls
        </h2>
        <p className="mx-auto mb-6 max-w-xl text-center font-sans text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Three independent layers. The first two protect our own infrastructure; the third
          protects each mailbox&apos;s sending reputation.
        </p>

        {loading || !clock ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                label: "Worker concurrency",
                value: String(clock.workerConcurrency),
                hint: "jobs in parallel per worker process",
              },
              {
                label: "Global queue limiter",
                value: `${clock.queueLimiter.max} / ${clock.queueLimiter.durationMs}ms`,
                hint: "ceiling across every worker replica",
              },
              {
                label: "Per-mailbox budget",
                value: "cap + pacer",
                hint: "atomic Lua quota and min-gap reservation",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="liquid-well p-4 text-center"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {item.label}
                </p>
                <p className="mt-1 text-lg font-bold text-zinc-900 dark:text-white">{item.value}</p>
                <p className="mt-1 text-[11px] text-zinc-500">{item.hint}</p>
              </div>
            ))}
          </div>
        )}
      </motion.section>

      {/* Health */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="liquid-glass p-6 sm:p-7"
      >
        <h2 className="mb-5 flex items-center justify-center gap-2 font-serif text-lg font-bold text-zinc-900 dark:text-white">
          <Activity className="h-4 w-4" style={{ color: themeColor }} />
          System health
        </h2>

        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : !health ? (
          <p className="text-sm text-rose-400">The API is not reachable at {API_ORIGIN}.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  icon: Database,
                  label: "PostgreSQL",
                  ok: health.dependencies.postgres === "up",
                  value: health.dependencies.postgres,
                },
                {
                  icon: Server,
                  label: "Redis",
                  ok: health.dependencies.redis === "up",
                  value: health.dependencies.redis,
                },
                {
                  icon: Activity,
                  label: "API uptime",
                  ok: true,
                  value: formatDuration(health.uptimeSeconds * 1000),
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="liquid-well flex flex-col items-center gap-2 p-4 text-center"
                >
                  <item.icon
                    className="h-5 w-5 shrink-0"
                    style={{ color: item.ok ? "#34d399" : "#fb7185" }}
                  />
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      {item.label}
                    </p>
                    <p
                      className={cn(
                        "truncate text-sm font-bold capitalize",
                        item.ok ? "text-zinc-900 dark:text-white" : "text-rose-400",
                      )}
                    >
                      {item.value}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {health.queue && (
              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-black/10 pt-4 dark:border-white/10 sm:grid-cols-6">
                {Object.entries(health.queue).map(([state, count]) => (
                  <div key={state}>
                    <p className="text-base font-bold text-zinc-900 dark:text-white">
                      {formatNumber(count)}
                    </p>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      {state}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-2 border-t border-black/10 pt-6 dark:border-white/10">
          <a href={`${API_ORIGIN}/admin/queues`} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline" icon={<ExternalLink className="h-3.5 w-3.5" />}>
              Bull Board queue inspector
            </Button>
          </a>
          <a href={`${API_ORIGIN}/api/metrics`} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost" icon={<ExternalLink className="h-3.5 w-3.5" />}>
              Prometheus metrics
            </Button>
          </a>
          <a href={`${API_ORIGIN}/api/health`} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost" icon={<ExternalLink className="h-3.5 w-3.5" />}>
              Health JSON
            </Button>
          </a>
        </div>
      </motion.section>

      {/* Account + appearance */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="grid gap-5 sm:grid-cols-2"
      >
        <div className="liquid-glass p-6 sm:p-7">
          <h2 className="mb-4 text-center font-serif text-lg font-bold text-zinc-900 dark:text-white">Account</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-500">Name</dt>
              <dd className="font-medium text-zinc-900 dark:text-white">{user?.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="shrink-0 text-zinc-500">Email</dt>
              <dd className="truncate font-medium text-zinc-900 dark:text-white">{user?.email}</dd>
            </div>
          </dl>
        </div>

        <div className="liquid-glass p-6 sm:p-7">
          <h2 className="mb-3 flex items-center justify-center gap-2 font-serif text-lg font-bold text-zinc-900 dark:text-white">
            <Palette className="h-4 w-4" style={{ color: themeColor }} />
            Appearance
          </h2>
          <p className="text-center font-sans text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Use the palette button in the top-right corner to switch between light and dark, change
            the accent colour, and tune the WebGL background shaders. The dashboard dims the shader
            automatically, and disables it entirely when your system requests reduced motion.
          </p>
        </div>
      </motion.section>
    </div>
  );
}
