"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Search, CornerDownLeft, Mail, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { EmailStatusChip } from "@/components/ui/status-chip";
import { NAV_ITEMS } from "./nav-items";
import { useThemeColor } from "@/context/theme-context";
import { cn } from "@/lib/utils";
import type { EmailRow } from "@/lib/types";

/**
 * Cmd/Ctrl+K palette.
 *
 * Combines static navigation with live Postgres full-text search over the
 * user's emails (`GET /api/emails?q=`), debounced so a fast typist issues one
 * query rather than one per keystroke.
 */
export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { themeColor } = useThemeColor();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<EmailRow[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reset on each open so the palette never reopens with a stale query.
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setCursor(0);
      // Focus after the entry animation has started.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced search
  React.useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const page = await api.emails.list({ q: term, pageSize: 6, sort: "relevance" });
        setResults(page.items);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  const navMatches = React.useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(term));
  }, [query]);

  type Row =
    | {
        kind: "nav";
        href: string;
        label: string;
        icon: React.ComponentType<{ className?: string }>;
      }
    | { kind: "email"; email: EmailRow };

  const rows: Row[] = React.useMemo(
    () => [
      ...navMatches.map((n) => ({
        kind: "nav" as const,
        href: n.href,
        label: n.label,
        icon: n.icon,
      })),
      ...results.map((email) => ({ kind: "email" as const, email })),
    ],
    [navMatches, results],
  );

  React.useEffect(() => {
    setCursor(0);
  }, [rows.length]);

  const go = React.useCallback(
    (row: Row) => {
      onClose();
      if (row.kind === "nav") router.push(row.href);
      else router.push(`/dashboard/scheduled?email=${row.email.id}`);
    },
    [onClose, router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[cursor];
      if (row) go(row);
    } else if (event.key === "Escape") {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -12 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="liquid-glass liquid-glass-strong w-full max-w-xl !rounded-3xl"
          >
            {/* Input */}
            <div className="flex items-center gap-3 border-b border-black/10 px-4 py-3.5 dark:border-white/10">
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: themeColor }} />
              ) : (
                <Search className="h-4 w-4 text-zinc-400" />
              )}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search recipients, subjects, or jump to a page..."
                className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-white"
              />
              <kbd className="rounded border border-black/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 dark:border-white/15">
                Esc
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-[52vh] overflow-y-auto p-2">
              {rows.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-zinc-500">
                  {query.trim().length >= 2 ? "No matches found" : "Type to search"}
                </p>
              )}

              {rows.map((row, index) => {
                const selected = index === cursor;
                const key = row.kind === "nav" ? `nav-${row.href}` : `email-${row.email.id}`;
                return (
                  <button
                    key={key}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => go(row)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                      selected ? "bg-black/5 dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/5",
                    )}
                  >
                    {row.kind === "nav" ? (
                      <>
                        <row.icon className="h-4 w-4 shrink-0 text-zinc-400" />
                        <span className="flex-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                          {row.label}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-zinc-400">
                          Page
                        </span>
                      </>
                    ) : (
                      <>
                        <Mail className="h-4 w-4 shrink-0 text-zinc-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                            {row.email.to}
                          </p>
                          <p className="truncate text-xs text-zinc-500">
                            {row.email.subject} &middot; {formatDateTime(row.email.sendAt)}
                          </p>
                        </div>
                        <EmailStatusChip status={row.email.status} />
                      </>
                    )}
                    {selected && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-zinc-400" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Global Ctrl/Cmd+K listener. */
export function useCommandPalette() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen, close: () => setOpen(false), toggle: () => setOpen((o) => !o) };
}
