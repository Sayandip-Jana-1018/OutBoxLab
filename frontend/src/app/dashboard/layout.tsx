"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuth } from "@/context/auth-context";
import { LiveProvider, useLive } from "@/context/live-context";
import { AppBackground } from "@/components/dashboard/app-background";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import {
  CommandPalette,
  useCommandPalette,
} from "@/components/dashboard/command-palette";
import { ThemeToggle } from "@/components/theme-toggle";
import { Spinner } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import type { ClockInfo } from "@/lib/types";

function DashboardShell({ children }: { children: React.ReactNode }) {
  const [clock, setClock] = React.useState<ClockInfo | null>(null);
  const palette = useCommandPalette();
  const { state } = useLive();

  // Tells the UI whether the Time Machine has compressed the rate-limit
  // window, which changes how every deferral timing should be read.
  const loadClock = React.useCallback(() => {
    api.system
      .clock()
      .then(setClock)
      .catch(() => undefined);
  }, []);

  React.useEffect(() => {
    loadClock();
    const timer = setInterval(loadClock, 30_000);
    return () => clearInterval(timer);
  }, [loadClock]);

  return (
    <div className="relative min-h-screen">
      <AppBackground intensity="dim" />

      <DashboardNav onSearch={palette.toggle} connection={state} clock={clock} />
      <ThemeToggle />

      {/* Centred content column. The generous top padding clears the floating
          dock and its status pills. */}
      <main className="page-shell relative z-10 pb-24 pt-36 sm:pt-40">{children}</main>

      <CommandPalette open={palette.open} onClose={palette.close} />
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Auth guard. The API is the real authority (every route sits behind
  // `requireAuth`); this only avoids rendering a shell that would 401.
  React.useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="relative flex min-h-screen items-center justify-center">
        <AppBackground intensity="dim" />
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="liquid-glass relative z-10 flex flex-col items-center gap-4 px-10 py-9 text-center"
        >
          <Spinner className="h-6 w-6" />
          <p className="font-sans text-sm text-zinc-500 dark:text-zinc-400">
            {loading ? "Loading your workspace..." : "Redirecting to sign in..."}
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <LiveProvider enabled>
      <DashboardShell>{children}</DashboardShell>
    </LiveProvider>
  );
}
