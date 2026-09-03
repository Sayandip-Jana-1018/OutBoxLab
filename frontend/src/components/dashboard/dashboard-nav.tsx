"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  LogOut,
  Clock,
  Wifi,
  WifiOff,
  RefreshCw,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { useThemeColor } from "@/context/theme-context";
import { NAV_ITEMS, isActivePath } from "./nav-items";
import { cn } from "@/lib/utils";
import type { ConnectionState } from "@/hooks/useLiveEvents";
import type { ClockInfo } from "@/lib/types";

const CONNECTION_META: Record<
  ConnectionState,
  { label: string; color: string; icon: React.ComponentType<{ className?: string }> }
> = {
  live: { label: "Live", color: "#34d399", icon: Wifi },
  connecting: { label: "Connecting", color: "#fbbf24", icon: RefreshCw },
  reconnecting: { label: "Reconnecting", color: "#fbbf24", icon: RefreshCw },
  offline: { label: "Offline", color: "#fb7185", icon: WifiOff },
};

/**
 * Floating centred navigation dock.
 *
 * Replaces a left sidebar deliberately: with the nav floating above the page,
 * the content column is centred in the actual viewport rather than in
 * "viewport minus 248px", and the dashboard shares one visual language with
 * the marketing page instead of looking like a different product.
 */
export function DashboardNav({
  onSearch,
  connection,
  clock,
}: {
  onSearch: () => void;
  connection: ConnectionState;
  clock: ClockInfo | null;
}) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { themeColor } = useThemeColor();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const meta = CONNECTION_META[connection];
  const StatusIcon = meta.icon;

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex flex-col items-center gap-3 px-4 pt-4 sm:pt-5">
        {/* ---- Primary dock ---- */}
        <motion.nav
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="liquid-glass liquid-glass-strong pointer-events-auto flex max-w-full items-center gap-1.5 !rounded-full p-1.5"
        >
          {/* Brand */}
          <Link
            href="/"
            className="group flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
          >
            <span
              className="relative flex h-6 w-6 items-center justify-center rounded-lg border border-black/10 transition-transform group-hover:scale-110 dark:border-white/20"
              style={{ backgroundColor: `${themeColor}25` }}
            >
              <span
                className="absolute h-2 w-2 animate-ping rounded-full"
                style={{ backgroundColor: themeColor }}
              />
              <span
                className="relative h-2 w-2 rounded-full"
                style={{ backgroundColor: themeColor }}
              />
            </span>
            <span className="hidden text-sm font-bold tracking-tight text-zinc-900 dark:text-white sm:inline">
              Outbox<span style={{ color: themeColor }}>Lab</span>
            </span>
          </Link>

          <span className="mx-0.5 hidden h-5 w-px bg-black/10 dark:bg-white/15 lg:block" />

          {/* Desktop nav */}
          <div className="hidden items-center gap-0.5 lg:flex">
            {NAV_ITEMS.map((item) => {
              const active = isActivePath(pathname, item.href, item.exact);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-300",
                    active
                      ? "text-zinc-900 dark:text-white"
                      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                  )}
                  style={{ color: active ? themeColor : undefined }}
                >
                  {active && (
                    <motion.span
                      layoutId="dock-active"
                      className="absolute inset-0 rounded-full border"
                      style={{
                        backgroundColor: `${themeColor}1c`,
                        borderColor: `${themeColor}44`,
                      }}
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <item.icon className="relative z-10 h-3.5 w-3.5" />
                  <span className="relative z-10">{item.short}</span>
                </Link>
              );
            })}
          </div>

          <span className="mx-0.5 h-5 w-px bg-black/10 dark:bg-white/15" />

          {/* Search */}
          <button
            onClick={onSearch}
            aria-label="Open command palette"
            className="flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-black/[0.05] hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
          >
            <Search className="h-3.5 w-3.5" />
            <kbd className="hidden rounded border border-black/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold dark:border-white/15 xl:inline-block">
              Ctrl K
            </kbd>
          </button>

          {/* User */}
          <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/[0.05] p-1 dark:bg-white/[0.08]">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold uppercase text-white"
              style={{ backgroundColor: themeColor }}
              title={user?.email}
            >
              {user?.name?.slice(0, 1) ?? "?"}
            </span>
            <button
              onClick={handleLogout}
              className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-black/[0.08] hover:text-rose-500 dark:hover:bg-white/10"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileOpen((o) => !o)}
            className="shrink-0 rounded-full p-2 text-zinc-600 transition-colors hover:bg-black/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08] lg:hidden"
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </motion.nav>

        {/* ---- Status pills ---- */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="pointer-events-auto flex items-center gap-2"
        >
          <span
            className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold backdrop-blur-xl"
            style={{
              color: meta.color,
              borderColor: `${meta.color}44`,
              backgroundColor: `${meta.color}14`,
            }}
            role="status"
            aria-live="polite"
          >
            <StatusIcon
              className={cn(
                "h-3 w-3",
                (connection === "connecting" || connection === "reconnecting") && "animate-spin",
              )}
            />
            {meta.label}
          </span>

          {clock?.isCompressed && (
            <span
              className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold backdrop-blur-xl"
              style={{
                color: "#fbbf24",
                borderColor: "#fbbf2444",
                backgroundColor: "#fbbf2414",
              }}
              title={`Rate-limit window compressed to ${clock.windowLabel}`}
            >
              <Clock className="h-3 w-3" />
              Window {clock.windowLabel}
            </span>
          )}
        </motion.div>
      </div>

      {/* ---- Mobile sheet ---- */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
              aria-hidden
            />
            <motion.div
              initial={{ opacity: 0, y: -16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 340, damping: 30 }}
              className="liquid-glass liquid-glass-strong fixed inset-x-4 top-32 z-40 p-3 lg:hidden"
            >
              <div className="grid grid-cols-2 gap-2">
                {NAV_ITEMS.map((item) => {
                  const active = isActivePath(pathname, item.href, item.exact);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-sm font-medium transition-colors",
                        active
                          ? "text-zinc-900 dark:text-white"
                          : "border-transparent text-zinc-600 hover:bg-black/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.06]",
                      )}
                      style={
                        active
                          ? {
                              backgroundColor: `${themeColor}1c`,
                              borderColor: `${themeColor}44`,
                              color: themeColor,
                            }
                          : undefined
                      }
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
