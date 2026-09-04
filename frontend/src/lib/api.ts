// ---------------------------------------------------------------------------
// OutboxLab API client
//
// A single typed wrapper around fetch. Every request sends the auth cookie
// (`credentials: "include"`) and normalises the backend's error envelope
// ({ error: { code, message } }) into a thrown `ApiError`, so callers can rely
// on try/catch and a stable `.message`.
// ---------------------------------------------------------------------------

import type {
  ActivityEvent,
  Campaign,
  CampaignDetail,
  ClockInfo,
  CreateCampaignResult,
  EmailDetail,
  EmailRow,
  HealthInfo,
  OverviewStats,
  Paginated,
  ScheduleForecast,
  Sender,
  ThroughputBucket,
  User,
} from "./types";

/**
 * What fetch and EventSource actually call.
 *
 * Empty on purpose: every request goes to this app's own origin and a Next.js
 * rewrite forwards it to the API, which keeps the session cookie first-party.
 * See the `rewrites()` block in next.config.ts for why that matters.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Absolute URL of the backend. Only for links a human opens in a new tab -
 * Bull Board, /metrics - which are not proxied and must resolve on their own.
 */
export const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/$/, "") || "http://localhost:5000";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  // API_BASE is empty in the proxied setup, so resolve against the current
  // origin - `new URL` needs an absolute base, and searchParams below needs a
  // URL. Server-side there is no window, so fall back to the real backend.
  const base = API_BASE || (typeof window === "undefined" ? API_ORIGIN : window.location.origin);
  const url = new URL(`${base}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, signal } = options;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    // Network-level failure (API down, CORS, DNS). Give a human message.
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      `Cannot reach the API at ${API_ORIGIN}. Is the backend running?`,
      err,
    );
  }

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);

  if (!res.ok) {
    const envelope = payload as { error?: { code?: string; message?: string; details?: unknown } } | null;
    throw new ApiError(
      res.status,
      envelope?.error?.code ?? "ERROR",
      envelope?.error?.message ?? `Request failed with status ${res.status}`,
      envelope?.error?.details,
    );
  }

  return payload as T;
}

// ---------------------------------------------------------------------------
// Endpoint methods, grouped to match the backend module layout.
// ---------------------------------------------------------------------------

export const api = {
  raw: request,

  auth: {
    me: () => request<{ user: User }>("/api/auth/me"),
    login: (email: string, password: string) =>
      request<{ user: User }>("/api/auth/login", { method: "POST", body: { email, password } }),
    register: (name: string, email: string, password: string) =>
      request<{ user: User }>("/api/auth/register", {
        method: "POST",
        body: { name, email, password },
      }),
    logout: () => request<{ success: boolean }>("/api/auth/logout", { method: "POST" }),
  },

  senders: {
    list: () => request<{ senders: Sender[] }>("/api/senders"),
    createEthereal: (label?: string, hourlyLimit?: number, minDelayMs?: number) =>
      request<{ sender: Sender }>("/api/senders/ethereal", {
        method: "POST",
        body: { label, hourlyLimit, minDelayMs },
      }),
    create: (input: Record<string, unknown>) =>
      request<{ sender: Sender }>("/api/senders", { method: "POST", body: input }),
    update: (id: string, input: Record<string, unknown>) =>
      request<{ sender: Sender }>(`/api/senders/${id}`, { method: "PATCH", body: input }),
    verify: (id: string) =>
      request<{ verified: boolean }>(`/api/senders/${id}/verify`, { method: "POST" }),
    remove: (id: string) => request<void>(`/api/senders/${id}`, { method: "DELETE" }),
  },

  campaigns: {
    list: (query?: { page?: number; pageSize?: number; status?: string }) =>
      request<Paginated<Campaign>>("/api/campaigns", { query }),
    get: (id: string) => request<CampaignDetail>(`/api/campaigns/${id}`),
    create: (input: Record<string, unknown>) =>
      request<CreateCampaignResult>("/api/campaigns", { method: "POST", body: input }),
    preview: (input: {
      recipientCount: number;
      hourlyLimit: number;
      delayBetweenEmailsMs?: number;
      minDelayMs?: number;
      startAt?: string;
    }) => request<ScheduleForecast>("/api/campaigns/preview", { method: "POST", body: input }),
    pause: (id: string) =>
      request<{ status: string }>(`/api/campaigns/${id}/pause`, { method: "POST" }),
    resume: (id: string) =>
      request<{ status: string; requeued: number }>(`/api/campaigns/${id}/resume`, {
        method: "POST",
      }),
    cancel: (id: string) =>
      request<{ cancelled: number }>(`/api/campaigns/${id}/cancel`, { method: "POST" }),
  },

  emails: {
    list: (query?: {
      page?: number;
      pageSize?: number;
      view?: "all" | "pending" | "history";
      status?: string;
      campaignId?: string;
      senderId?: string;
      q?: string;
      sort?: "sendAt" | "createdAt" | "relevance";
      order?: "asc" | "desc";
    }) => request<Paginated<EmailRow>>("/api/emails", { query }),
    get: (id: string) => request<{ email: EmailDetail }>(`/api/emails/${id}`),
    reschedule: (id: string, sendAt: string) =>
      request<{ email: EmailRow }>(`/api/emails/${id}/reschedule`, {
        method: "POST",
        body: { sendAt },
      }),
    cancel: (id: string) =>
      request<{ email: EmailRow }>(`/api/emails/${id}/cancel`, { method: "POST" }),
    retry: (id: string) =>
      request<{ email: EmailRow }>(`/api/emails/${id}/retry`, { method: "POST" }),
  },

  stats: {
    overview: () => request<OverviewStats>("/api/stats/overview"),
    throughput: (minutes = 30) =>
      request<{ buckets: ThroughputBucket[] }>("/api/stats/throughput", { query: { minutes } }),
    activity: (limit = 20) =>
      request<{ events: ActivityEvent[] }>("/api/stats/activity", { query: { limit } }),
  },

  system: {
    health: () => request<HealthInfo>("/api/health"),
    clock: () => request<ClockInfo>("/api/system/clock"),
    timeMachine: (windowMs?: number, reset = false) =>
      request<{ windowMs: number; windowLabel: string; isCompressed: boolean; note: string }>(
        "/api/system/time-machine",
        { method: "POST", body: { windowMs, reset } },
      ),
  },
};
