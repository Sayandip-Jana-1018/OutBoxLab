# API reference

Base URL: `http://localhost:5000`

All routes except `/api/health`, `/api/metrics` and `/api/system/clock` require
authentication. The session cookie (`obl_token`, httpOnly) is set on login; an
`Authorization: Bearer <token>` header is also accepted so curl and Postman work without
disabling auth.

Every response carries an `x-request-id` header. Errors use one envelope:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request body",
    "details": [{ "field": "email", "message": "Enter a valid email address" }],
    "requestId": "0f9c…"
  }
}
```

Codes: `BAD_REQUEST` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 ·
`CONFLICT` 409 · `UNPROCESSABLE_ENTITY` 422 · `TOO_MANY_REQUESTS` 429 ·
`INTERNAL_ERROR` 500 · `SERVICE_UNAVAILABLE` 503.

---

## Auth

### `POST /api/auth/register`

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "at-least-8" }
```

`201` → `{ "user": { id, email, name, avatarUrl, createdAt }, "token": "…" }`

### `POST /api/auth/login`

```json
{ "email": "demo@outboxlab.dev", "password": "demo1234" }
```

`200` → `{ "user": {…}, "token": "…" }` and sets the `obl_token` cookie.

Rate limited to 20 attempts / 15 min / IP.

### `POST /api/auth/logout` → `{ "success": true }`

### `GET /api/auth/me` → `{ "user": {…} }`

---

## Senders (mailboxes)

### `GET /api/senders`

Returns each mailbox with **live quota** attached, so the dashboard needs one request:

```json
{
  "senders": [{
    "id": "…", "label": "Demo mailbox (cap 5)",
    "fromEmail": "xyz@ethereal.email", "provider": "ETHEREAL",
    "smtpHost": "smtp.ethereal.email", "smtpPort": 587,
    "hourlyLimit": 5, "minDelayMs": 1000, "isActive": true,
    "quota": { "used": 3, "limit": 5, "remaining": 2,
               "windowMs": 3600000, "resetsAt": "2026-09-03T17:00:00.000Z" },
    "nextSendSlotAt": "2026-09-03T16:42:07.000Z"
  }]
}
```

SMTP passwords are **never** returned.

### `POST /api/senders/ethereal`

Provisions a real sandboxed Ethereal mailbox. This is the endpoint that makes the project
self-contained — no credentials required.

```json
{ "label": "Ethereal mailbox", "hourlyLimit": 5, "minDelayMs": 1000 }
```

### `POST /api/senders` — add a real SMTP mailbox

```json
{
  "label": "Growth mailbox", "fromName": "Growth", "fromEmail": "growth@acme.com",
  "smtpHost": "smtp.acme.com", "smtpPort": 587, "smtpUser": "…", "smtpPassword": "…",
  "smtpSecure": false, "hourlyLimit": 100, "minDelayMs": 2000
}
```

### `PATCH /api/senders/:id`

Any of `label`, `fromName`, `hourlyLimit`, `minDelayMs`, `isActive`.

### `POST /api/senders/:id/verify` → `{ "verified": true }`

Opens a real SMTP connection and authenticates.

### `DELETE /api/senders/:id` → `204`

Refuses with `400` if the mailbox still has emails in flight, rather than orphaning work the
queue still holds jobs for.

---

## Campaigns

### `POST /api/campaigns`

Accepts either a structured `recipients` array (dashboard) or raw `csv` text (curl/Postman).

```json
{
  "name": "October update",
  "senderId": "…uuid…",
  "subjectTemplate": "Hello {{name}}",
  "bodyTemplate": "Hi {{name}}, welcome to {{company}}.",
  "startAt": "2026-09-03T17:00:00.000Z",
  "delayBetweenEmailsMs": 2000,
  "hourlyLimit": 5,
  "recipients": [
    { "email": "ada@example.com", "vars": { "name": "Ada", "company": "AE" } }
  ]
}
```

CSV form — needs a header row with an address column named `email`, `to`, `address`,
`recipient` or `e-mail`. Every other column becomes a template variable:

```json
{ "name": "…", "senderId": "…", "subjectTemplate": "…", "bodyTemplate": "…",
  "csv": "email,name,company\nada@example.com,Ada,AE" }
```

`201`:

```json
{
  "campaign": { "id": "…", "status": "SCHEDULED", "totalRecipients": 3, … },
  "scheduled": 3,
  "enqueued": 3,
  "skipped": { "invalid": [{ "value": "nope", "reason": "Not a valid email address" }],
               "duplicates": ["ada@example.com"] },
  "firstSendAt": "…", "lastSendAt": "…"
}
```

Invalid rows and duplicates are **reported, not fatal** — a 5,000-row CSV with three typos
still schedules 4,997 emails.

### `POST /api/campaigns/preview`

Dry run. Simulates the limiter and returns when each email is projected to land. Writes
nothing.

```json
{ "recipientCount": 12, "hourlyLimit": 5, "delayBetweenEmailsMs": 0,
  "minDelayMs": 1000, "startAt": "2026-09-03T17:00:00.000Z" }
```

```json
{
  "entries": [{ "index": 0, "plannedAt": "…", "projectedAt": "…", "deferred": false }],
  "totalRecipients": 12, "deferredCount": 7, "windowsRequired": 3,
  "firstSendAt": "…", "lastSendAt": "…", "estimatedDurationMs": 7200000,
  "windowMs": 3600000, "hourlyLimit": 5,
  "note": "Estimate only. Assumes the mailbox begins with a full quota…"
}
```

`deferred` means **this email sends later than its planned slot** — including emails pushed
late by an earlier email's window jump, not just the one that crossed the boundary.

### `GET /api/campaigns?page&pageSize&status`

Paginated, each item carrying per-status `counts` from one grouped query.

### `GET /api/campaigns/:id`

Returns `{ campaign, counts, nextUp, timeline }`. `timeline` is up to 300 recipients ordered
by `sendAt` — it drives the timeline visualiser.

### `POST /api/campaigns/:id/pause`

Queue jobs are intentionally **left in place**. The processor checks campaign status on every
pass and parks the job for 15s instead of sending, so pausing is instant, resuming needs no
re-creation, and nothing is lost if the process restarts while paused.

### `POST /api/campaigns/:id/resume` → `{ "status": "RUNNING", "requeued": 9 }`

Replaces parked jobs so delivery restarts immediately rather than waiting out the park
interval.

### `POST /api/campaigns/:id/cancel` → `{ "cancelled": 9 }`

Removes queue entries **first**, so no worker can claim one between the status update and
the cleanup.

---

## Emails

### `GET /api/emails`

| Param | Default | Notes |
| --- | --- | --- |
| `page` / `pageSize` | `1` / `25` | max 200 |
| `view` | `all` | `pending` (SCHEDULED+PROCESSING+DEFERRED) or `history` (SENT+FAILED+CANCELLED) |
| `status` | — | explicit status or array; wins over `view` |
| `campaignId`, `senderId` | — | uuid filters |
| `q` | — | full-text search; < 3 chars falls back to an indexed prefix match on the address |
| `sort` | `sendAt` | `sendAt` · `createdAt` · `relevance` |
| `order` | `asc` | `asc` · `desc` |

```json
{ "items": [{ "id": "…", "to": "…", "subject": "…", "status": "SENT",
              "sendAt": "…", "sentAt": "…", "previewUrl": "https://ethereal.email/message/…",
              "deferredCount": 2, "attempts": 1, "lastError": null }],
  "page": 1, "pageSize": 25, "total": 42, "totalPages": 2 }
```

### `GET /api/emails/:id`

Full row plus `sender`, `campaign`, and the complete `events[]` audit trail — this powers the
detail drawer and answers "why was this deferred?".

### `POST /api/emails/:id/reschedule` — `{ "sendAt": "2026-09-03T18:00:00.000Z" }`

### `POST /api/emails/:id/cancel`

### `POST /api/emails/:id/retry`

Only for `FAILED` or `CANCELLED`. Resets `attempts` so the retry budget applies to the new run.

---

## Stats

- `GET /api/stats/overview` — per-status counts, queue depth, active window, lifetime
  counters, and per-mailbox quota. One round trip for the whole dashboard header.
- `GET /api/stats/throughput?minutes=30` — deliveries per minute. Bucketed in Postgres with
  `generate_series`, so the series is **dense** (zero-minutes included) and the frontend
  needs no gap-filling.
- `GET /api/stats/activity?limit=20` — recent `EmailEvent`s with their email.

---

## Realtime

### `GET /api/events` — Server-Sent Events

```js
const es = new EventSource("http://localhost:5000/api/events", {
  withCredentials: true,
});
es.addEventListener("email.status", (e) => console.log(JSON.parse(e.data)));
```

Named events:

| Event | Payload |
| --- | --- |
| `ping` | `{ type, at }` — sent immediately on connect |
| `email.status` | `{ emailId, campaignId, senderId, status, event, message, payload, at }` |
| `campaign.progress` | `{ campaignId, sent, total, at }` |
| `system.window` | `{ windowMs, at }` — emitted by the Time Machine |

A `: heartbeat` comment frame is sent every 25s to keep intermediaries from closing the
connection.

---

## System

### `GET /api/health`

`200` when healthy, `503` when degraded — each dependency reported separately so a failure
is attributable.

```json
{ "status": "ok", "uptimeSeconds": 412, "version": "1.0.0",
  "dependencies": { "postgres": "up", "redis": "up" },
  "queue": { "waiting": 0, "active": 1, "delayed": 12, "completed": 340, "failed": 0, "paused": 0 },
  "timestamp": "…" }
```

### `GET /api/metrics` — Prometheus text format

Unauthenticated and instance-wide, because that is what a scrape target must look like.

```
outboxlab_emails_total{result="sent"} 340
outboxlab_emails_total{result="deferred_rate_limit"} 27
outboxlab_queue_jobs{state="delayed"} 12
outboxlab_rate_window_ms 3600000
```

### `GET /api/system/clock`

```json
{ "windowMs": 60000, "windowLabel": "1m", "defaultWindowMs": 3600000,
  "isCompressed": true, "timeMachineEnabled": true, "serverTime": "…",
  "workerConcurrency": 5, "queueLimiter": { "max": 20, "durationMs": 1000 } }
```

### `POST /api/system/time-machine`

```json
{ "windowMs": 60000 }        // compress
{ "reset": true }            // restore the env default
```

Gated behind `ENABLE_TIME_MACHINE`; returns `403` when disabled. Changing the window
re-indexes the quota buckets, which effectively clears current usage — stated in the
response `note`.

---

## Queue inspector

`GET /admin/queues` — Bull Board, basic auth (`BULL_BOARD_USER` / `BULL_BOARD_PASSWORD`,
default `admin` / `admin`). Delayed jobs and their exact scheduled timestamps, active jobs,
retry counts and failure reasons are all visible, which is the quickest way to *prove*
scheduling and deferral work rather than assert it.

---

## curl walkthrough

```bash
# 1. Sign in and keep the cookie
curl -s -c jar.txt -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@outboxlab.dev","password":"demo1234"}'

# 2. Find a mailbox id
curl -s -b jar.txt http://localhost:5000/api/senders

# 3. Schedule a campaign from raw CSV
curl -s -b jar.txt -X POST http://localhost:5000/api/campaigns \
  -H 'Content-Type: application/json' \
  -d '{
        "name":"CLI test",
        "senderId":"PASTE_SENDER_ID",
        "subjectTemplate":"Hello {{name}}",
        "bodyTemplate":"Hi {{name}}, this was scheduled from curl.",
        "delayBetweenEmailsMs":1000,
        "csv":"email,name\nada@example.com,Ada\ngrace@example.com,Grace"
      }'

# 4. Watch it happen live
curl -N -b jar.txt http://localhost:5000/api/events

# 5. Check the results
curl -s -b jar.txt 'http://localhost:5000/api/emails?view=history'
```
