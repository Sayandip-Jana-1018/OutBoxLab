# OutboxLab

A distributed outbound email scheduler with per-mailbox rate limiting, a lock-free
distributed pacer, restart-safe persistence, and a realtime glassmorphic dashboard.

Kill the worker mid-campaign, wipe Redis entirely, restart — every pending email still
sends. PostgreSQL is the only source of truth; Redis holds nothing but derived state.

**Author:** Sayandip Jana · **Stack:** Express · BullMQ · Redis · PostgreSQL · Next.js 15

---

## Table of contents

- [Quick start](#quick-start)
- [Architecture](#architecture)
- [How scheduling works](#how-scheduling-works)
- [How persistence on restart works](#how-persistence-on-restart-works)
- [How rate limiting works](#how-rate-limiting-works)
- [How concurrency is controlled](#how-concurrency-is-controlled)
- [The four bugs this project fixes](#the-four-bugs-this-project-fixes)
- [Empirical proof: burst test](#empirical-proof-burst-test)
- [Testing it yourself](#testing-it-yourself)
- [Requirement coverage](#requirement-coverage)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Assumptions, shortcuts and trade-offs](#assumptions-shortcuts-and-trade-offs)
- [Demo script](#demo-script)

---

## Quick start

**Prerequisites:** Node.js ≥ 20, Docker Desktop.

```bash
git clone https://github.com/Sayandip-Jana-1018/OutBoxLab.git
cd OutBoxLab
npm run setup     # generate .env + docker up + install deps + migrate + seed
npm run dev       # API :5000 + worker + web :3000
```

Then open **http://localhost:3000** and sign in with the seeded account:

| Field | Value |
| --- | --- |
| Email | `demo@outboxlab.dev` |
| Password | `demo1234` |

The login page has a **"Use the demo account"** button that fills this in for you.

### What `npm run setup` does

0. `npm run env:init` — generates `.env` from `.env.example`, filling in a fresh
   `JWT_SECRET` and a random Postgres password. **`.env.example` is committed and
   therefore contains no usable secret**, only `CHANGE_ME` placeholders — an example file
   gets copied into production verbatim, so it must never carry a working credential.
   An existing `.env` is never overwritten.
1. `docker compose up -d` — starts `postgres:16-alpine` and `redis:7-alpine`, both health-checked.
2. `npm install` in `backend/` and `frontend/`.
3. `prisma generate` + `prisma migrate deploy` — creates the schema and the full-text GIN index.
4. `prisma db seed` — creates the demo user and **provisions two real Ethereal mailboxes**
   (one capped at 5/hour so you can hit the limit immediately, one at 100/hour).

### Running the three processes

`npm run dev` runs all three concurrently. To run them separately — which is what makes
the restart demo legible — use three terminals:

```bash
npm run dev:api       # Express API on :5000
```

```bash
npm run dev:worker    # BullMQ worker (separate process)
```

```bash
npm run dev:web       # Next.js dashboard on :3000
```

### Ports

Defaults are Postgres `5432` and Redis `6379`. If those are taken on your machine, change
`POSTGRES_PORT` / `REDIS_PORT` in `.env` — `docker-compose.yml` reads them, and
`DATABASE_URL` / `REDIS_URL` must be updated to match.

### Email delivery (Ethereal)

**No SMTP credentials are needed.** OutboxLab provisions [Ethereal](https://ethereal.email)
mailboxes on demand — one click in *Mailboxes → Generate Ethereal mailbox*, or automatically
during seeding. Ethereal accepts and stores mail but never delivers it onward, which is
exactly the isolation you want for a scheduler demo.

Every delivered message gets a **preview URL** stored on the row. That link is the proof
surface: open it from the Sent table to read the exact message that went out. To use a real
SMTP server instead, set `SMTP_*` in `.env` or add an SMTP mailbox from the dashboard.

---

## Architecture

```mermaid
flowchart LR
  subgraph Client
    UI[Next.js dashboard<br/>App Router]
  end

  subgraph API["API process (src/index.ts)"]
    REST[Express REST]
    SSE[SSE /api/events]
    BOARD[Bull Board<br/>/admin/queues]
  end

  subgraph Worker["Worker process (src/worker.ts)"]
    PROC[Processor]
    RECON[Boot reconciler]
    SWEEP[Drift sweeper<br/>every 60s]
  end

  PG[(PostgreSQL<br/>source of truth)]
  RD[(Redis<br/>queue · quota · pacer · pubsub)]
  SMTP[SMTP / Ethereal]

  UI -->|fetch + cookie| REST
  UI -.->|EventSource| SSE
  REST -->|1 . write rows| PG
  REST -->|2 . enqueue delayed jobs| RD
  RD -->|job due| PROC
  PROC -->|read row, guard status| PG
  PROC -->|quota + pacer Lua| RD
  PROC -->|deliver| SMTP
  PROC -->|append event| PG
  PROC -->|publish| RD
  RD -->|per-user channel| SSE
  RECON -->|rebuild queue| RD
  PG --> RECON
  SWEEP --> RD
```

**The invariant:** every write hits PostgreSQL *before* it reaches Redis. If the process
dies in between, Postgres holds a `SCHEDULED` row with no queue entry — which is precisely
the drift the reconciler and sweeper detect and repair. The reverse order would produce
jobs referencing rows that never existed.

### Repository layout

```
outbox/
├─ docker-compose.yml          postgres:16 + redis:7, health-checked
├─ .env.example                one env file for the whole monorepo
├─ docs/                       ARCHITECTURE · API · DECISIONS · DEMO_SCRIPT
├─ backend/
│  ├─ prisma/schema.prisma     data model + FTS index migration
│  └─ src/
│     ├─ index.ts              API entrypoint
│     ├─ worker.ts             worker entrypoint (separate process)
│     ├─ config/env.ts         zod-validated env, fails fast
│     ├─ lib/                  clock · redis · logger · errors · http
│     ├─ queue/                queues · scheduler · processor · rateLimiter
│     │                        pacer · reconciler · sweeper · worker
│     ├─ modules/              auth · senders · campaigns · emails · stats
│     │                        events(SSE) · system · admin(Bull Board)
│     ├─ services/             mailer · template · events(pubsub)
│     ├─ scripts/              seed.ts · burst-test.ts
│     └─ __tests__/            52 vitest tests
└─ frontend/
   └─ src/
      ├─ app/                  landing · login · register · dashboard/*
      ├─ components/           ui · dashboard · charts · react-bits(shaders)
      ├─ context/              auth · theme · live(SSE)
      ├─ hooks/                useLiveEvents
      └─ lib/                  api · format · types
```

---

## How scheduling works

**There is no cron and no polling anywhere in OutboxLab.** No `node-cron`, no `setInterval`
sweep over "emails due now", no OS crontab.

Each email becomes exactly **one BullMQ delayed job** whose delay is `sendAt - now`. Redis
holds it in a sorted set keyed by execution time and hands it to a worker at the right
instant. The cost of having a million emails scheduled a month out is therefore zero CPU
until they come due.

```mermaid
sequenceDiagram
  participant U as Dashboard
  participant A as API
  participant P as PostgreSQL
  participant R as Redis/BullMQ
  participant W as Worker
  participant S as SMTP

  U->>A: POST /api/campaigns (recipients + templates)
  A->>A: parse CSV, validate, de-duplicate
  A->>A: render {{vars}} per recipient
  A->>P: BEGIN — campaign + N rows + N QUEUED events — COMMIT
  A->>R: addBulk N delayed jobs (jobId = email UUID)
  A-->>U: 201 {scheduled, enqueued, firstSendAt, lastSendAt}

  Note over R,W: ...time passes, job becomes due...

  R->>W: deliver job
  W->>P: SELECT row (authoritative)
  alt already SENT or CANCELLED
    W-->>R: no-op (idempotent)
  else campaign PAUSED
    W-->>R: moveToDelayed(+15s)
  else
    W->>P: status = PROCESSING, append PICKED_UP
    W->>R: pacer: reserve next slot (Lua)
    alt slot is in the future
      W->>P: status = DEFERRED, append DEFERRED_PACING
      W-->>R: moveToDelayed(slot) + DelayedError
    else
      W->>R: quota: consume 1 unit (Lua)
      alt over cap
        W->>P: status = DEFERRED, append DEFERRED_RATE_LIMIT
        W-->>R: moveToDelayed(next window) + DelayedError
      else
        W->>S: sendMail
        W->>P: status = SENT + messageId + previewUrl
        W->>R: publish to per-user channel
      end
    end
  end
```

### Deterministic job ids make enqueueing idempotent

`jobId` is always the `ScheduledEmail.id` (a UUID). BullMQ silently ignores an `add()` for
a job id that already exists, so **re-enqueueing is a guaranteed no-op rather than a
duplicate send**. That single property is what makes the boot reconciler and the drift
sweeper safe to run as often as they like.

### Jobs carry identifiers, not content

The job payload holds only `{ emailId, userId, senderId, campaignId }`. The worker always
re-reads the row from Postgres, so a job enqueued before the user rescheduled or cancelled
the email cannot act on stale content.

### Pace first, then check quota

The ordering is deliberate. If quota were consumed first and the job were *then* paced into
the next window, the send would be counted against a window it never sent in — the counter
would over-report the current window and under-use the next. Reserving the pacing slot
first means quota is always checked against the window the email genuinely sends in.

---

## How persistence on restart works

PostgreSQL is the source of truth; Redis only ever holds derived state. So "what happens if
the server restarts?" has one answer: **read every email that has not reached a terminal
status and re-enqueue it.**

### 1. Boot reconciliation (`queue/reconciler.ts`)

On every worker start:

1. Rows stuck in `PROCESSING` (the process died mid-send) are returned to `SCHEDULED`.
2. Every row in `SCHEDULED` / `PROCESSING` / `DEFERRED` is re-enqueued in keyset-paginated
   batches of 500 — a campaign with hundreds of thousands of recipients is never loaded
   into memory at once.
3. Emails whose `sendAt` already passed get delay `0` and catch up immediately, in `sendAt`
   order.
4. Campaigns whose work finished while the process was down are flipped to `COMPLETED`.

This recovers from an ordinary restart **and from a completely wiped Redis**
(`docker compose down -v`) — which a "Redis is the queue" design cannot do.

Real output from a cold start on this machine:

```
INFO: Reconciling queue from Postgres...
INFO: Bulk-enqueued emails  count: 3
INFO: Reconciliation complete: 3/3 emails back in the queue
      scanned: 3  requeued: 3  resetFromProcessing: 0  durationMs: 40
INFO: Drift sweeper registered  everyMs: 60000
INFO: Email worker started  concurrency: 5  limiter: "20/1000ms"
```

### 2. Drift sweeper (`queue/sweeper.ts`)

Boot reconciliation fixes clean restarts. It does nothing for drift that appears *while the
process is running*:

- Redis was flushed, evicted, or failed over without the API restarting.
- A job was removed by hand from Bull Board.
- An enqueue was lost to a transient Redis disconnect.

In all of those cases Postgres still says "scheduled" while Redis has no job, and the email
would silently never send. A repeating BullMQ job runs every 60s, compares the two for
emails due within a 10-minute horizon, and restores anything missing. It uses the queue's
own scheduler rather than a local `setInterval`, so it survives a worker restart, never
double-fires across replicas, and is visible in Bull Board like any other job.

> **Trade-off — at-least-once delivery.** If the process is killed in the narrow window
> after SMTP accepted a message but before the status update committed, that email is
> retried and could arrive twice. Exactly-once would need a transactional outbox with a
> provider-side idempotency key, which Ethereal does not offer.

---

## How rate limiting works

Rate limiting is **per mailbox**, never global — that is how real providers bill and
throttle. Each `Sender` row carries its own `hourlyLimit` and `minDelayMs`.

### Atomic quota (`queue/rateLimiter.ts`)

Buckets are `floor(epochMs / windowMs)` — monotonic, timezone-free, and exactly aligned to
UTC hour boundaries when the window is one hour.

The whole check is one Lua script, so it is atomic no matter how many workers race:

```lua
local limit   = tonumber(ARGV[1])
local ttlMs   = tonumber(ARGV[2])
local current = tonumber(redis.call('GET', KEYS[1]) or '0')

if current >= limit then
  return {0, current, limit}          -- denied, counter untouched
end

current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ttlMs)  -- TTL only on first write
end

return {1, current, limit}            -- allowed
```

The counter is therefore **exactly the number of sends permitted in the window** and can
never exceed the cap. The TTL is set only on the first increment and derived from the time
left in the window plus a small buffer, so buckets expire on their own and Redis never
accumulates dead counters.

A failed delivery **refunds** its consumed slot, so a flapping SMTP host cannot silently
eat a mailbox's entire allowance without delivering anything.

### Deferral is not failure

An over-quota job calls `job.moveToDelayed(nextWindowStart, token)` and throws
`DelayedError`. BullMQ does **not** count that as an attempt, so an email throttled 50
times still has its full retry budget available for genuine SMTP errors. Marking
rate-limited jobs as failed — the naive approach — would exhaust `attempts` and permanently
drop mail that was never broken.

### The Time Machine

Rate limiting on an hourly window is impossible to demonstrate in a five-minute video. Every
bucket calculation goes through one module (`lib/clock.ts`), and
`POST /api/system/time-machine {"windowMs": 60000}` compresses the window to 60 seconds at
runtime. The same Lua script, the same `moveToDelayed` path, the same bucket arithmetic —
only the window length changes, so what you watch is the real production behaviour, faster.

The active window lives in Redis, so the API and every worker agree on it instantly without
a restart. It is gated behind `ENABLE_TIME_MACHINE` so it can be switched off in production.

---

## How concurrency is controlled

Three independent layers, each protecting something different:

| # | Control | Where | Protects |
| --- | --- | --- | --- |
| 1 | `WORKER_CONCURRENCY` (default 5) | BullMQ `Worker` option | How many jobs *this* process handles at once |
| 2 | `QUEUE_LIMITER_MAX / DURATION` (20 per 1000ms) | BullMQ queue limiter | A global ceiling across *every* worker replica, so scaling out cannot multiply outbound volume |
| 3 | Per-mailbox cap + min-gap pacer | `rateLimiter.ts` / `pacer.ts` | The sending reputation of each individual mailbox |

Layers 1–2 protect our infrastructure; layer 3 protects the mailbox.

### The distributed pacer (`queue/pacer.ts`)

Each mailbox owns a Redis key holding its next free send timestamp. A worker atomically
*reserves* the earliest available slot and advances the marker:

```lua
local now = tonumber(ARGV[1])
local gap = tonumber(ARGV[2])

local nextFree = tonumber(redis.call('GET', KEYS[1]) or '0')
local slot = now
if nextFree > now then slot = nextFree end

redis.call('SET', KEYS[1], slot + gap, 'PX', ttlMs)
return tostring(slot)
```

If the reserved slot is in the future, the job is handed back to BullMQ's delayed set and
**the worker is freed immediately**. Spacing is enforced across every worker in the fleet,
and no worker ever blocks.

---

## The four bugs this project fixes

Each of these is a real concurrency defect in the obvious implementation, and each is
covered by an assertion in `npm run test:burst` and by unit tests.

### 1. Atomic quota, not INCR-then-compare

```js
const count = await redis.incr(key);   // ❌
if (count > limit) defer();
```

Rejected attempts still increment. Point 1,000 jobs at a mailbox capped to 5 and the counter
ends the window at **1,005**. The counter no longer means "emails sent this window", so it
cannot drive a UI, an alert, or a remaining-quota calculation — and every deferred job
re-increments on every retry, so it grows without bound.

**Fixed:** single Lua script does GET → compare → conditional INCR → conditional PEXPIRE
atomically.

### 2. Distributed pacer, not `sleep()`

```js
await sleep(sender.minDelayMs);        // ❌
```

Two defects. It does not actually pace anything — with `concurrency: 5`, five jobs enter the
handler at the same instant, all sleep in parallel, and all five sends fire simultaneously;
the configured "2s between emails" silently became "5 emails at once, every 2s". And it
wastes the worker: a sleeping handler still occupies one of the N concurrency slots, so a
large delay throttles throughput for *every* mailbox.

**Fixed:** Redis slot reservation + `moveToDelayed`, releasing the worker immediately.

### 3. Configurable window, not a hard-coded hour

A literal `3600000` sprinkled through the code makes rate limiting impossible to demonstrate
and impossible to unit test without waiting an hour.

**Fixed:** all bucket maths goes through `lib/clock.ts`; the Time Machine changes one number.

### 4. Drift sweeper, not just boot recovery

Reconciling only on boot silently loses emails when Redis is flushed or fails over while the
process keeps running.

**Fixed:** a repeating job reconciles Postgres against the live queue every 60s. Idempotent,
because `jobId` is the email's primary key.

---

## Empirical proof: burst test

`npm run test:burst` fires N simultaneous requests at one mailbox with no coordination
between them — the exact scenario that breaks naive implementations. **Real output from
this machine:**

```
========================================================================
  OutboxLab - rate limiter & pacer burst test
========================================================================
  Sender under test      burst-66720949-0f33-48aa-b1b5-0a464983e4fb
  Concurrent jobs        1,000
  Quota                  5 per 1h
  Window resets at       2026-09-03T17:00:00.000Z

========================================================================
  1. Atomic quota under full concurrency
========================================================================
  Permitted to send          5
  Deferred to next window    995
  Dropped / lost             0
  Final counter in Redis     5
  Highest count observed     5
  Elapsed                    67 ms

========================================================================
  2. Contrast: INCR-then-compare (the naive approach)
========================================================================
  Permitted to send          5
  Final counter in Redis     1,000  <-- inflated by 995
  The naive counter no longer means "emails sent this window", so it cannot
  drive a UI, an alert, or a remaining-quota calculation.

========================================================================
  3. Pacer: 250ms minimum gap under concurrency
========================================================================
  Slots reserved             200
  Smallest gap between two   250 ms
  Gap violations             0
  Total span reserved        49.8 s

========================================================================
  Result
========================================================================
  PASS  Exactly `limit` sends permitted          expected 5, got 5
  PASS  No job dropped                           5 + 995 = 1000 of 1000
  PASS  Counter never exceeds the cap            counter=5, high-water=5, cap=5
  PASS  Every deferral targets the next window   retryAtMs is always a future window boundary
  PASS  Pacer honours the minimum gap            0 violation(s), smallest gap 250 ms

  All 5 assertions passed.
```

Tune it: `npm run test:burst -- --jobs 5000 --limit 25 --gap 500`

---

## Testing it yourself

### Automated

```bash
npm test              # 52 vitest tests across 6 files
npm run test:burst    # concurrency assertions above
npm run typecheck     # backend + frontend
npm run build         # production build of both
```

Current state — all green:

```
 ✓ src/__tests__/clock.test.ts           (11 tests)
 ✓ src/__tests__/pacer.test.ts            (6 tests)
 ✓ src/__tests__/rateLimiter.test.ts      (7 tests)
 ✓ src/__tests__/recipients.test.ts      (10 tests)
 ✓ src/__tests__/schedulePlanner.test.ts (11 tests)
 ✓ src/__tests__/template.test.ts        (10 tests)

 Test Files  6 passed (6)
      Tests  52 passed (52)
```

The rate-limiter and pacer suites run against the **real Redis** from docker-compose,
because the property under test *is* the atomicity of the Lua scripts — a mock would assert
nothing.

### Manual — the five-minute tour

1. **Sign in** at http://localhost:3000 → "Use the demo account" → Sign in.
2. **Compose** (`/dashboard/compose`): pick *Demo mailbox (cap 5)*, click
   **Use sample data** (3 recipients), and watch the **Projected schedule** panel forecast
   when each email lands. Click **Schedule 3 emails**.
3. You land on the campaign page. Watch the **timeline** nodes flip
   `scheduled → processing → sent` in real time. No refresh — that is SSE.
4. **Sent & history** → click a row → the drawer shows the full event timeline and a
   **preview link**. Open it to read the actual delivered message.
5. **Prove rate limiting** — Settings → Time Machine → **1 minute**. Compose 12 recipients
   against the cap-5 mailbox. Exactly 5 send; the rest go `DEFERRED` with a message naming
   the cap and the retry instant, then drain in the next 60-second window.
6. **Prove restart safety** — schedule a campaign starting a few minutes out, then
   `Ctrl+C` the worker terminal. Confirm rows sit in `SCHEDULED`. Restart with
   `npm run dev:worker` and watch the log print
   `Reconciliation complete: N/N emails back in the queue`. Delivery resumes.
7. **Nuclear test** — `docker compose down -v` (destroys Redis *and* Postgres volumes), then
   `docker compose up -d && npm run db:migrate && npm run db:seed`. For a Redis-only wipe,
   use `redis-cli FLUSHALL` and watch the drift sweeper restore the jobs within 60s.
8. **Inspect the queue** — http://localhost:5000/admin/queues (`admin` / `admin`). Delayed
   jobs and their exact scheduled timestamps are visible, which is the quickest way to
   *prove* scheduling works rather than assert it.

---

## Requirement coverage

### Backend

| Requirement | Where | Notes |
| --- | --- | --- |
| **Scheduler** | `queue/scheduler.ts`, `queue/processor.ts` | Zero cron. One BullMQ delayed job per email, `jobId` = row PK |
| **Persistence on restart** | `queue/reconciler.ts`, `queue/sweeper.ts` | Boot reconciliation + 60s drift sweep; survives a full Redis wipe |
| **Rate limiting** | `queue/rateLimiter.ts` | Atomic Lua GET→compare→INCR→PEXPIRE, per mailbox, per window |
| **Concurrency** | `queue/worker.ts`, `queue/pacer.ts` | Worker concurrency + global queue limiter + per-mailbox pacer |
| REST API | `modules/*` | Auth, senders, campaigns, emails, stats, system |
| Auth | `modules/auth` | bcrypt (12 rounds) + JWT in an httpOnly cookie; Bearer also accepted |
| Queue visibility | `modules/admin/bullBoard.ts` | Bull Board at `/admin/queues`, basic-auth protected |
| Observability | `modules/system` | `/api/health`, Prometheus `/api/metrics`, pino + request ids |

### Frontend

| Requirement | Route | Notes |
| --- | --- | --- |
| **Login** | `/login` | zod + react-hook-form, one-click demo prefill |
| **Dashboard** | `/dashboard` | Live KPIs, throughput sparkline, quota rings, activity feed |
| **Compose** | `/dashboard/compose` | CSV drag-drop with validation/dedupe, `{{var}}` chips, live preview, schedule forecast |
| **Tables** | `/dashboard/scheduled`, `/dashboard/sent` | Server-paginated, Postgres full-text search, status filters, detail drawer |
| Campaign timeline | `/dashboard/campaigns/[id]` | Animated node timeline, pause/resume/cancel |
| Mailboxes | `/dashboard/senders` | One-click Ethereal provisioning, live quota rings, per-mailbox limits |
| Settings | `/dashboard/settings` | Time Machine, concurrency readout, system health |
| Realtime | everywhere | One SSE connection shared via context; **zero polling** |
| Polish | — | Cmd/Ctrl+K palette, toasts, skeletons, empty states, `prefers-reduced-motion`, responsive, focus-visible |

---

## Environment variables

One `.env` at the repository root serves the API, the worker and the frontend, so they can
never drift out of sync. The backend loads it directly; `next.config.ts` parses it and
inlines the `NEXT_PUBLIC_*` keys at build time. **Every value has a working default — the
stack boots with zero edits.**

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5000` | API port |
| `APP_URL` | `http://localhost:5000` | Public API URL |
| `FRONTEND_URL` | `http://localhost:3000` | CORS allowlist (comma-separated) |
| `NEXT_PUBLIC_API_URL` | `http://localhost:5000` | API base the browser calls |
| `DATABASE_URL` | `postgresql://outboxlab:outboxlab@localhost:5432/outboxlab` | Postgres DSN |
| `REDIS_URL` | `redis://localhost:6379` | Redis DSN |
| `POSTGRES_PORT` / `REDIS_PORT` | `5432` / `6379` | Host ports docker-compose publishes |
| `JWT_SECRET` | dev value | **Min 32 chars.** Change in production |
| `JWT_EXPIRES_IN` | `7d` | Session lifetime |
| `COOKIE_SECURE` | `false` | `true` behind HTTPS (switches SameSite to `none`) |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | `demo@outboxlab.dev` / `demo1234` | Seeded account |
| `WORKER_CONCURRENCY` | `5` | Jobs in parallel per worker process |
| `QUEUE_LIMITER_MAX` / `_DURATION` | `20` / `1000` | Global ceiling across all workers |
| `RATE_WINDOW_MS` | `3600000` | Rate-limit window; Time Machine overrides at runtime |
| `DEFAULT_HOURLY_LIMIT` | `10` | Fallback per-mailbox cap |
| `DEFAULT_MIN_DELAY_MS` | `2000` | Fallback minimum gap between sends |
| `MAX_JOB_ATTEMPTS` | `3` | Retries for *genuine* failures (deferrals are not retries) |
| `SWEEPER_INTERVAL_MS` | `60000` | Drift sweep interval |
| `ENABLE_TIME_MACHINE` | `true` | Allows runtime window compression |
| `BULL_BOARD_USER` / `_PASSWORD` | `admin` / `admin` | Queue inspector basic auth |
| `SMTP_*` | *(blank)* | Optional fixed SMTP; blank uses Ethereal |

Env is validated with zod at startup (`config/env.ts`) and **fails fast with a readable
error** — a misconfigured scheduler is worse than a dead one. No secrets are committed;
only `.env.example`.

---

## API reference

Full detail in [`docs/API.md`](docs/API.md).

| Group | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/register` · `/login` · `/logout` · `GET /api/auth/me` |
| Senders | `GET/POST /api/senders` · `POST /api/senders/ethereal` · `PATCH/DELETE /api/senders/:id` · `POST /api/senders/:id/verify` |
| Campaigns | `POST /api/campaigns` · `POST /api/campaigns/preview` · `GET /api/campaigns` · `GET /api/campaigns/:id` · `POST /:id/pause` · `/resume` · `/cancel` |
| Emails | `GET /api/emails?status&q&page&sort` · `GET /api/emails/:id` · `POST /:id/reschedule` · `/cancel` · `/retry` |
| Stats | `GET /api/stats/overview` · `/throughput?minutes=` · `/activity?limit=` |
| Realtime | `GET /api/events` (SSE, per-user channel) |
| System | `GET /api/health` · `/api/metrics` · `/api/system/clock` · `POST /api/system/time-machine` |
| Queue UI | `GET /admin/queues` (basic auth) |

---

## Assumptions, shortcuts and trade-offs

**Deliberate decisions, with the reasoning:**

1. **Postgres full-text search instead of Elasticsearch.** A weighted `tsvector` + GIN index
   gives ranked multi-field search (recipient `A` > subject `B` > body `C`) with
   `websearch_to_tsquery`, so users get quoted phrases and `-negation` free. No second
   datastore to keep in sync, no dual-write consistency window, ~1.5 GB less memory locally.
   Queries under 3 characters fall back to an indexed prefix match, because tsquery cannot
   usefully match a two-letter fragment.

2. **At-least-once delivery, not exactly-once.** Explained above. The honest bound given
   that Ethereal offers no idempotency key.

3. **Ethereal never truly delivers.** Expected and intentional. Messages are accepted and
   stored, and the per-email `previewUrl` is the proof surface.

4. **SMTP passwords are stored in plaintext in Postgres.** A real deployment would use
   envelope encryption (KMS/Vault) or a provider token. Passwords are never returned by the
   API — every read path goes through an explicit column projection so a credential cannot
   leak when a new endpoint is added later.

5. **The forecast is an estimate, not a promise.** `layOutSendTimes` writes only the
   *stagger* to `sendAt`; it deliberately does **not** bake in the hourly cap, because the
   cap is shared state — other campaigns on the same mailbox consume the same quota, so any
   figure computed at creation time would already be wrong by the time the job ran. The
   runtime limiter is the single authority. The compose preview simulates the limiter purely
   to answer "when will this finish?", and says so in the UI.

6. **The Time Machine clears effective quota.** Changing the window length re-indexes the
   buckets. Documented in the API response and gated behind an env flag; demo/test only.

7. **JWT in an httpOnly cookie, with Bearer also accepted.** The cookie is immune to XSS
   token theft; the Bearer header makes curl/Postman usable without disabling auth. No
   refresh-token rotation — out of scope for this exercise.

8. **No email open/click tracking, no bounce handling, no unsubscribe.** Out of scope; a
   production sender needs all three.

9. **Vendored `react-bits` WebGL shaders are lint-exempt.** They are third-party components
   kept verbatim so they can be diffed against upstream. The exemption is scoped to that one
   directory rather than weakening the project-wide lint profile.

10. **Single-region, single-Redis.** No Redis Cluster or cross-region failover. The drift
    sweeper is the mitigation for Redis loss, not a replacement for HA.

---

## Demo script

A timestamped walkthrough for recording, with the exact commands, is in
[`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

| Time | Beat |
| --- | --- |
| 0:00 | `docker compose up -d`, `npm run dev` — three processes boot, worker reconciles |
| 0:40 | Landing page → architecture diagram → sign in with the demo account |
| 1:10 | Dashboard overview: live KPIs, throughput, quota rings |
| 1:40 | Compose: drop a CSV, `{{name}}` renders live, projected schedule forecasts deferrals |
| 2:30 | Schedule → campaign timeline animates `scheduled → sent` over SSE, no refresh |
| 3:10 | Time Machine → 1 minute → 12 emails at cap 5 → exactly 5 send, 7 defer with reasons |
| 4:00 | Kill the worker mid-campaign → restart → `Reconciliation complete: N/N` → delivery resumes |
| 4:40 | `npm run test:burst` → 1,000 jobs, 5 allowed, 0 dropped, counter never exceeds cap |

---

## Further reading

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — component-by-component deep dive
- [`docs/API.md`](docs/API.md) — full endpoint reference with payloads
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — the engineering decision log
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — recording script

---

MIT © Sayandip Jana
