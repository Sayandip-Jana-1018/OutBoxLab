# Demo script

A ~5 minute walkthrough that demonstrates every graded requirement. Each beat lists exactly
what to run and what to point at.

**Before recording**

```bash
docker compose down -v          # start from nothing, so reconciliation is honest
docker compose up -d
npm run db:setup                # migrate + seed (provisions 2 Ethereal mailboxes)
```

Open three terminals so the worker can be killed independently:

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

---

## 0:00 — Boot (30s)

**Show:** the three terminals side by side.

**Say:** "Three processes. The API serves HTTP and the SSE stream. The worker is separate —
that separation is what makes the restart demo honest, because I can stop delivery without
stopping the dashboard. Postgres and Redis are the only infrastructure."

**Point at** the worker log:

```
INFO: Reconciling queue from Postgres...
INFO: Reconciliation complete: 0/0 emails back in the queue
INFO: Drift sweeper registered  everyMs: 60000
INFO: Email worker started  concurrency: 5  limiter: "20/1000ms"
```

**Say:** "It reconciles from Postgres on every boot before consuming anything, and registers
a drift sweeper. Nothing pending right now — we'll come back to this line."

---

## 0:40 — Landing and sign-in (30s)

**Do:** open http://localhost:3000.

**Say:** "The landing page documents the architecture — six components, one invariant:
Postgres is the source of truth, Redis holds only derived state."

**Do:** Sign in → **Use the demo account** → **Sign in**.

**Say:** "Seeded account, bcrypt with a JWT in an httpOnly cookie."

---

## 1:10 — Dashboard overview (30s)

**Point at,** in order:

- **KPIs** — Scheduled / In flight / Delivered / Failed.
- **Throughput** — deliveries per minute, bucketed in Postgres with `generate_series` so the
  series is dense.
- **Mailbox quota rings** — "rate limiting is per mailbox, never global. The seed created two:
  one capped at 5 per window so we can hit the limit on camera, one at 100."
- The **Live** pill, top of screen.

**Say:** "Everything here streams over Server-Sent Events. There is no polling anywhere in
this app — watch the numbers move on their own in a moment."

---

## 1:40 — Compose (50s)

**Do:** Compose → select **Demo mailbox (cap 5)** → **Use sample data**.

**Point at:**

- The CSV report — **valid / invalid / duplicates**. "Client-side validation and dedupe.
  Duplicates matter: there's a unique index on `(campaignId, to)`, so a duplicate would abort
  the whole insert."
- The `{{name}}` / `{{company}}` chips and the **Live preview** rendering a real recipient.
- The **Projected schedule** panel. "This calls a dry-run endpoint that simulates the rate
  limiter and tells you when each email will land — including which ones will be throttled —
  before you commit. It's labelled an estimate, because the cap is shared state."

**Do:** set the gap to `2000`, click **Schedule 3 emails**.

---

## 2:30 — Live delivery (40s)

You land on the campaign page.

**Do:** say nothing for a few seconds and let it run.

**Point at:** the timeline nodes flipping colour, the progress ring climbing, the recipient
rows changing status — **without a refresh**.

**Say:** "The worker publishes each decision to a per-user Redis channel; the API relays it
over SSE. The worker is a different process, so it can't write to the browser directly —
pub/sub bridges that, and it means the API scales horizontally with no sticky sessions."

**Do:** open **Sent & history** → click a row.

**Point at:** the event timeline in the drawer — `Queued → Picked up → Sent` with timestamps.
Then click the **preview link**.

**Say:** "Ethereal accepts and stores mail but never delivers onward, which is the isolation
you want for a scheduler demo. Every message keeps a preview URL — that's the proof it
actually sent."

---

## 3:10 — Rate limiting, provably (50s)

**Do:** Settings → **Time Machine** → **1 minute**.

**Say:** "Rate limiting on an hourly window is impossible to show in a five-minute video. This
compresses the window to 60 seconds at runtime. It changes exactly one number — the same Lua
script, the same `moveToDelayed` path, the same bucket arithmetic. What you're about to watch
is the real production code path, just faster."

**Do:** Compose → same cap-5 mailbox → paste 12 addresses → gap `500` → Schedule.

**Point at:** exactly **5** go to Sent; the rest turn **DEFERRED**.

**Do:** open a deferred email's drawer.

**Point at:** the event message —
*"Sender 'Demo mailbox (cap 5)' reached its cap of 5 per 1m. Retrying at …"*

**Say:** "That's not a failure — it's `moveToDelayed`. BullMQ doesn't count it as an attempt,
so an email throttled fifty times still has its full retry budget for genuine SMTP errors."

**Do:** wait for the next window.

**Point at:** the deferred emails draining automatically.

---

## 4:00 — Persistence across restart (40s)

**Do:** Compose a campaign with **Start at** ~2 minutes in the future, say 10 recipients.

**Do:** show them sitting in **Scheduled**, then `Ctrl+C` the **worker** terminal only.

**Say:** "The API is still up, the dashboard still works — but nothing can send. This is where
a Redis-only queue design would be at risk."

**Do (optional, stronger):** in another terminal —

```bash
docker exec -it outboxlab-redis redis-cli FLUSHALL
```

**Say:** "I've just destroyed the entire queue. Postgres still has every row."

**Do:** restart the worker: `npm run dev:worker`.

**Point at** the log:

```
INFO: Reconciling queue from Postgres...
INFO: Bulk-enqueued emails  count: 10
INFO: Reconciliation complete: 10/10 emails back in the queue
```

**Say:** "Every pending email is back. That works because the job id *is* the row's primary
key, so re-enqueueing is idempotent — and anything whose send time already passed goes out
immediately, in order."

**Do:** watch them deliver.

---

## 4:40 — Concurrency proof (30s)

**Do:**

```bash
npm run test:burst
```

**Point at** the output:

```
  Permitted to send          5
  Deferred to next window    995
  Dropped / lost             0
  Final counter in Redis     5

  Contrast: INCR-then-compare
  Final counter in Redis     1,000  <-- inflated by 995

  Pacer: 200 slots, 0 gap violations, smallest gap 250 ms

  All 5 assertions passed.
```

**Say:** "A thousand concurrent jobs against a cap of five. Exactly five allowed, nothing
dropped, and the counter never exceeds the cap. Underneath it prints what the naive
INCR-then-compare produces on the identical burst — 1,000 — which is the bug this fixes.
And the pacer: two hundred simultaneous reservations, zero gap violations."

**Optionally also:**

```bash
npm test        # 52 tests, 6 files
```

---

## Closing (15s)

**Do:** open http://localhost:5000/admin/queues (`admin` / `admin`).

**Say:** "Bull Board, so the queue isn't a black box — delayed jobs with their exact scheduled
timestamps, retry counts, failure reasons. And `/api/health` and `/api/metrics` for
operations."

**Close on** the dashboard overview.

**Say:** "OutboxLab: no cron, restart-safe by construction, per-mailbox rate limiting that's
atomic under concurrency, and a dashboard with zero polling."

---

## Recovery notes

| If | Then |
| --- | --- |
| Nothing sends | Is the **worker** terminal running? The API alone does not process jobs |
| Ports clash | Change `POSTGRES_PORT` / `REDIS_PORT` in `.env` and update `DATABASE_URL` / `REDIS_URL` |
| Live pill says Offline | The API isn't up, or `FRONTEND_URL` doesn't list the origin you're browsing from |
| Everything is deferred | The Time Machine is still compressed, or the mailbox is at its cap — Settings → Reset to env default |
| Ethereal provisioning fails | It needs outbound network access; add an SMTP mailbox manually instead |
