// ---------------------------------------------------------------------------
// API contract types
//
// These mirror the shapes returned by the OutboxLab backend (backend/src/
// modules/*). They are kept deliberately close to the server responses so the
// dashboard never has to reshape data on the client.
// ---------------------------------------------------------------------------

export type EmailStatus =
  | "SCHEDULED"
  | "PROCESSING"
  | "DEFERRED"
  | "SENT"
  | "FAILED"
  | "CANCELLED";

export type CampaignStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELLED";

export type EmailEventType =
  | "QUEUED"
  | "PICKED_UP"
  | "DEFERRED_RATE_LIMIT"
  | "DEFERRED_PACING"
  | "SENT"
  | "FAILED"
  | "RETRY_SCHEDULED"
  | "RESCHEDULED"
  | "CANCELLED"
  | "RECONCILED";

export type SenderProvider = "ETHEREAL" | "SMTP";

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface SenderQuota {
  used: number;
  limit: number;
  remaining: number;
  windowMs: number;
  resetsAt: string;
}

export interface Sender {
  id: string;
  label: string;
  fromName: string;
  fromEmail: string;
  provider: SenderProvider;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpSecure: boolean;
  hourlyLimit: number;
  minDelayMs: number;
  isActive: boolean;
  lastVerified: string | null;
  previewBase: string | null;
  createdAt: string;
  quota: SenderQuota;
  nextSendSlotAt: string | null;
}

export interface Campaign {
  id: string;
  userId: string;
  senderId: string;
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
  startAt: string;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  status: CampaignStatus;
  totalRecipients: number;
  createdAt: string;
  updatedAt: string;
  sender?: { id: string; label: string; fromEmail: string; minDelayMs?: number };
  counts?: Partial<Record<EmailStatus, number>>;
}

export interface EmailRow {
  id: string;
  to: string;
  subject: string;
  status: EmailStatus;
  sendAt: string;
  sentAt: string | null;
  previewUrl: string | null;
  messageId: string | null;
  deferredCount: number;
  attempts: number;
  lastError: string | null;
  campaignId: string | null;
  senderId: string;
  createdAt: string;
  rank?: number;
}

export interface EmailEvent {
  id: string;
  emailId: string;
  type: EmailEventType;
  message: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface EmailDetail extends EmailRow {
  body: string;
  vars: Record<string, unknown>;
  hourlyLimit: number;
  sender: { id: string; label: string; fromEmail: string; hourlyLimit: number };
  campaign: { id: string; name: string; status: CampaignStatus } | null;
  events: EmailEvent[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OverviewStats {
  emails: Partial<Record<EmailStatus, number>>;
  totals: { scheduled: number; inFlight: number; delivered: number; failed: number };
  campaigns: Partial<Record<CampaignStatus, number>>;
  queue: {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
    paused: number;
  };
  window: { ms: number; label: string };
  lifetime: Record<string, number>;
  senders: {
    id: string;
    label: string;
    used: number;
    limit: number;
    remaining: number;
    resetsAt: string;
  }[];
}

export interface ThroughputBucket {
  at: string;
  sent: number;
}

export interface ActivityEvent extends EmailEvent {
  email: { id: string; to: string; subject: string; status: EmailStatus };
}

export interface ClockInfo {
  windowMs: number;
  windowLabel: string;
  defaultWindowMs: number;
  isCompressed: boolean;
  timeMachineEnabled: boolean;
  serverTime: string;
  workerConcurrency: number;
  queueLimiter: { max: number; durationMs: number };
}

export interface HealthInfo {
  status: "ok" | "degraded";
  uptimeSeconds: number;
  version: string;
  dependencies: { postgres: "up" | "down"; redis: "up" | "down" };
  queue: OverviewStats["queue"] | null;
  timestamp: string;
}

export interface CampaignDetail {
  campaign: Campaign;
  counts: Partial<Record<EmailStatus, number>>;
  nextUp: { id: string; to: string; sendAt: string; status: EmailStatus } | null;
  timeline: {
    id: string;
    to: string;
    status: EmailStatus;
    sendAt: string;
    sentAt: string | null;
    deferredCount: number;
    previewUrl: string | null;
  }[];
}

export interface CreateCampaignResult {
  campaign: {
    id: string;
    name: string;
    status: CampaignStatus;
    totalRecipients: number;
    startAt: string;
    delayBetweenEmailsMs: number;
    hourlyLimit: number;
  };
  scheduled: number;
  enqueued: number;
  skipped: {
    invalid: { value: string; reason: string }[];
    duplicates: string[];
  };
  firstSendAt: string;
  lastSendAt: string;
}

export interface ScheduleForecast {
  entries: { index: number; plannedAt: string; projectedAt: string; deferred: boolean }[];
  totalRecipients: number;
  deferredCount: number;
  windowsRequired: number;
  firstSendAt: string;
  lastSendAt: string;
  estimatedDurationMs: number;
  windowMs: number;
  hourlyLimit: number;
  note: string;
}

// --- Realtime (SSE) --------------------------------------------------------

export type RealtimeEvent =
  | {
      type: "email.status";
      emailId: string;
      campaignId: string | null;
      senderId: string;
      status: EmailStatus;
      event: EmailEventType;
      message?: string;
      at: string;
      payload?: Record<string, unknown>;
    }
  | { type: "campaign.progress"; campaignId: string; sent: number; total: number; at: string }
  | { type: "system.window"; windowMs: number; at: string }
  | { type: "ping"; at: string };
