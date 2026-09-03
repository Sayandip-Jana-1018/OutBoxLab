// ---------------------------------------------------------------------------
// Presentation helpers - dates, durations, and the status vocabulary shared by
// every table, chip and drawer in the dashboard.
// ---------------------------------------------------------------------------

import type { CampaignStatus, EmailEventType, EmailStatus } from "./types";

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "-";
  return timeFmt.format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "-";
  return dateTimeFmt.format(d);
}

/** Compact relative time: "in 3m", "12s ago", "just now". */
export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "-";

  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const future = diffMs > 0;

  const units: [number, string][] = [
    [1000, "s"],
    [60_000, "m"],
    [3_600_000, "h"],
    [86_400_000, "d"],
  ];

  if (abs < 5_000) return "just now";
  let label = "";
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const [ms, suffix] = units[i];
    if (abs >= ms) {
      label = `${Math.round(abs / ms)}${suffix}`;
      break;
    }
  }
  return future ? `in ${label}` : `${label} ago`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return remS ? `${m}m ${remS}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM ? `${h}h ${remM}m` : `${h}h`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

// --- Status vocabulary -----------------------------------------------------

export interface StatusStyle {
  label: string;
  /** Tailwind classes for a chip (text + subtle bg + border). */
  chip: string;
  /** Solid dot / accent color as a hex-ish token for inline styles. */
  dot: string;
}

export const EMAIL_STATUS_STYLES: Record<EmailStatus, StatusStyle> = {
  SCHEDULED: {
    label: "Scheduled",
    chip: "text-sky-300 bg-sky-500/10 border-sky-500/30",
    dot: "#38bdf8",
  },
  PROCESSING: {
    label: "Processing",
    chip: "text-amber-300 bg-amber-500/10 border-amber-500/30",
    dot: "#fbbf24",
  },
  DEFERRED: {
    label: "Deferred",
    chip: "text-orange-300 bg-orange-500/10 border-orange-500/30",
    dot: "#fb923c",
  },
  SENT: {
    label: "Sent",
    chip: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
    dot: "#34d399",
  },
  FAILED: {
    label: "Failed",
    chip: "text-rose-300 bg-rose-500/10 border-rose-500/30",
    dot: "#fb7185",
  },
  CANCELLED: {
    label: "Cancelled",
    chip: "text-zinc-400 bg-zinc-500/10 border-zinc-500/30",
    dot: "#a1a1aa",
  },
};

export const CAMPAIGN_STATUS_STYLES: Record<CampaignStatus, StatusStyle> = {
  DRAFT: { label: "Draft", chip: "text-zinc-400 bg-zinc-500/10 border-zinc-500/30", dot: "#a1a1aa" },
  SCHEDULED: {
    label: "Scheduled",
    chip: "text-sky-300 bg-sky-500/10 border-sky-500/30",
    dot: "#38bdf8",
  },
  RUNNING: {
    label: "Running",
    chip: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
    dot: "#34d399",
  },
  PAUSED: {
    label: "Paused",
    chip: "text-amber-300 bg-amber-500/10 border-amber-500/30",
    dot: "#fbbf24",
  },
  COMPLETED: {
    label: "Completed",
    chip: "text-violet-300 bg-violet-500/10 border-violet-500/30",
    dot: "#a78bfa",
  },
  CANCELLED: {
    label: "Cancelled",
    chip: "text-zinc-400 bg-zinc-500/10 border-zinc-500/30",
    dot: "#a1a1aa",
  },
};

export const EVENT_LABELS: Record<EmailEventType, string> = {
  QUEUED: "Queued",
  PICKED_UP: "Picked up",
  DEFERRED_RATE_LIMIT: "Deferred - rate limit",
  DEFERRED_PACING: "Deferred - pacing",
  SENT: "Sent",
  FAILED: "Failed",
  RETRY_SCHEDULED: "Retry scheduled",
  RESCHEDULED: "Rescheduled",
  CANCELLED: "Cancelled",
  RECONCILED: "Reconciled",
};

// --- CSV parsing (client-side, for the compose drop zone) ------------------

export interface ParsedCsv {
  headers: string[];
  addressColumn: string | null;
  valid: { email: string; vars: Record<string, string> }[];
  invalid: { value: string; reason: string }[];
  duplicates: string[];
}

const ADDRESS_COLUMNS = ["email", "to", "address", "recipient", "e-mail"];
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;

/** Split one CSV line, honouring simple double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function parseCsv(text: string): ParsedCsv {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { headers: [], addressColumn: null, valid: [], invalid: [], duplicates: [] };
  }

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const addressColumn = ADDRESS_COLUMNS.find((c) => headers.includes(c)) ?? null;
  const addressIdx = addressColumn ? headers.indexOf(addressColumn) : -1;

  const valid: ParsedCsv["valid"] = [];
  const invalid: ParsedCsv["invalid"] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const email = (addressIdx >= 0 ? cells[addressIdx] ?? "" : cells[0] ?? "")
      .trim()
      .toLowerCase();

    if (!email) {
      invalid.push({ value: "(blank)", reason: "Missing email" });
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      invalid.push({ value: email, reason: "Invalid email" });
      continue;
    }
    if (seen.has(email)) {
      duplicates.push(email);
      continue;
    }
    seen.add(email);

    const vars: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (idx === addressIdx) return;
      vars[h] = cells[idx] ?? "";
    });
    valid.push({ email, vars });
  }

  return { headers, addressColumn, valid, invalid, duplicates };
}

/** Pull the distinct {{variables}} referenced by a template. */
export function extractTemplateVars(template: string): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    if (m[1]) found.add(m[1]);
  }
  return [...found];
}

/** Render {{vars}} for a live preview (mirrors the server renderer). */
export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_full, name: string) => {
    const v = vars[name];
    if (v === null || v === undefined) return "";
    return String(v);
  });
}
