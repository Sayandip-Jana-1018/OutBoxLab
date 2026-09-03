# Decision log

Each entry: the decision, the alternative, and why the alternative loses.

---

## D1 — BullMQ delayed jobs instead of a cron/polling sweep

**Alternative:** a `setInterval` (or `node-cron`) that queries
`SELECT * FROM scheduled_emails WHERE sendAt <= now() AND status = 'SCHEDULED'`.

**Why it loses:** polling costs a database query on every tick forever, whether or not
anything is due; it adds up to a full tick-interval of latency; and it needs a distributed
lock the moment you run two instances, or every worker claims the same rows.

**Chosen:** one delayed job per email. Redis holds it in a sorted set keyed by execution
time and delivers it at the right instant. A million emails scheduled a month out cost zero
CPU until they come due.

**Cost:** Redis becomes load-bearing for *timing*. Mitigated by D3 — Postgres can rebuild
the entire queue at any moment.

---

## D2 — `jobId` = `ScheduledEmail.id`

**Alternative:** let BullMQ generate ids and store the mapping in a `bullJobId` column.

**Why it loses:** it needs an extra write and an extra read, and it makes re-enqueueing
dangerous — you must check whether a job already exists, which is a race.

**Chosen:** the email's UUID *is* the job id. BullMQ ignores `add()` for an existing id, so
enqueueing is **idempotent by construction**. That one property is what makes the boot
reconciler and the drift sweeper safe to run as often as they like.

---

## D3 — Postgres is the source of truth; Redis holds only derived state

**Alternative:** treat the queue as the system of record (Redis AOF for durability).

**Why it loses:** it cannot survive `docker compose down -v`, an eviction, or a failover, and
it gives no queryable history for a dashboard.

**Chosen:** every write commits to Postgres *before* it reaches Redis. "What happens on
restart?" has one answer: read every non-terminal row and re-enqueue it.

**Cost:** two systems can disagree between the commit and the enqueue. That is exactly what
D4 exists for.

---

## D4 — Boot reconciliation **and** a periodic drift sweeper

**Alternative:** reconcile on boot only.

**Why it loses:** it fixes clean restarts and nothing else. If Redis is flushed, evicted, or
fails over while the API keeps running, Postgres still says "scheduled", Redis has no job,
and the email **silently never sends**. That is the worst possible failure for a scheduler:
no error, no retry, no signal.

**Chosen:** boot reconciliation plus a repeating BullMQ job every 60s that compares Postgres
against the live queue for emails due within 10 minutes and restores anything missing.

Using the queue's own scheduler rather than a local `setInterval` means the sweep survives a
worker restart, never double-fires across replicas, and is visible in Bull Board.

---

## D5 — Atomic Lua rate limiter instead of INCR-then-compare

**Alternative:**

```js
const count = await redis.incr(key);
if (count > limit) defer();
```

**Why it loses:** rejected attempts still increment. 1,000 jobs against a cap of 5 leaves the
counter at 1,005. The counter stops meaning "emails sent this window", so it cannot drive a
UI, an alert, or a remaining-quota calculation — and every deferred job re-increments on
every retry, so it grows without bound.

**Chosen:** one Lua script performs GET → compare → conditional INCR → conditional PEXPIRE
atomically. The counter is *exactly* the number of permitted sends and can never exceed the
cap.

**Verified:** `npm run test:burst` asserts it, and prints the naive counter side by side for
contrast (1,000 vs 5).

---

## D6 — Distributed pacer instead of `await sleep()`

**Alternative:** `await sleep(minDelayMs)` inside the job handler.

**Why it loses, twice over:**

1. **It does not pace.** With `concurrency: 5`, five jobs enter the handler at the same
   instant, all sleep in parallel, and all five sends fire simultaneously. "2s between
   emails" silently became "5 emails at once, every 2s".
2. **It wastes the worker.** A sleeping handler still occupies one of the N concurrency
   slots, so a large delay throttles throughput for *every* mailbox, not just the paced one.

**Chosen:** each mailbox owns a Redis key holding its next free send timestamp. A worker
atomically reserves the earliest slot and advances the marker; a future slot is handed back
to the delayed set and the worker is freed immediately.

**Verified:** 200 concurrent reservations, 0 gap violations, smallest gap exactly the
configured value.

---

## D7 — `moveToDelayed` + `DelayedError`, not a thrown failure

**Alternative:** throw when over quota and let BullMQ retry with backoff.

**Why it loses:** BullMQ counts that as an attempt. An email throttled 3 times would exhaust
`MAX_JOB_ATTEMPTS` and be permanently marked `FAILED` — dropping mail that was never broken.
It also conflates "the provider rejected this" with "we chose to wait", which makes the
failure metrics meaningless.

**Chosen:** `job.moveToDelayed(retryAt, token)` + `DelayedError`. `attemptsMade` is
untouched, so the full retry budget stays available for genuine SMTP errors. The `failed`
handler explicitly filters `DelayedError` so healthy throttling never pollutes the logs.

---

## D8 — Pace first, then check quota

**Alternative:** consume quota, then pace.

**Why it loses:** the send would be counted against a window it never sent in. The counter
over-reports the current window and under-uses the next one.

**Chosen:** reserve the pacing slot first, so quota is always checked against the window the
email genuinely sends in.

**Cost:** a harmless idle gap when a paced job then turns out to be over quota. Accepted.

---

## D9 — Configurable rate window (the Time Machine)

**Alternative:** hard-code one hour.

**Why it loses:** rate limiting becomes impossible to demonstrate in a short video and
impossible to unit test without waiting an hour — so in practice it goes untested.

**Chosen:** all bucket maths goes through `lib/clock.ts`, and one endpoint changes the window
length at runtime. Same Lua, same deferral path, same arithmetic. Stored in Redis so every
process agrees instantly. Gated behind `ENABLE_TIME_MACHINE`.

**Cost:** changing the length re-indexes buckets, effectively clearing usage. Documented in
the API response; demo/test only.

---

## D10 — Postgres full-text search instead of Elasticsearch

**Alternative:** mirror emails into Elasticsearch.

**Why it loses:** a second datastore to run, a dual-write consistency window to reason about,
and ~1.5 GB of memory — for a dataset that fits comfortably in Postgres.

**Chosen:** a functional GIN index over a weighted `tsvector` (recipient `A` > subject `B` >
body `C`), queried with `websearch_to_tsquery` so quoted phrases and `-negation` come free.

**Cost:** the query SQL must reproduce the index expression character for character or
Postgres silently falls back to a sequential scan. Contained by keeping the expression in a
single `Prisma.sql` constant.

---

## D11 — Job payloads carry identifiers, not content

**Alternative:** embed subject/body/hourlyLimit in the job data.

**Why it loses:** the payload goes stale. A job enqueued before the user edited or
rescheduled the email would send outdated copy against an outdated cap.

**Chosen:** the payload holds ids only; the worker re-reads the row every time. Postgres
stays authoritative, and cancellation works even for a job already in the active set.

---

## D12 — SSE instead of WebSockets

**Alternative:** Socket.IO or raw WebSockets.

**Why it loses:** the data only ever flows server → client. A duplex protocol buys nothing
while costing an extra handshake, a heavier client, and a separate auth path for the socket.

**Chosen:** SSE over plain HTTP, so the existing cookie auth and CORS apply unchanged, and
`EventSource` reconnects on its own.

**Cost:** SSE is text-only and capped by the browser's per-origin connection limit. Handled
by sharing **one** connection across the dashboard via React context.

---

## D13 — Worker in a separate process from the API

**Alternative:** run the worker inside the API process.

**Why it loses:** a burst of sends makes the dashboard unresponsive; they cannot be scaled
independently; and the restart demo becomes ambiguous because you cannot stop delivery
without also stopping the UI.

**Chosen:** two entrypoints. Stopping the worker stops delivery while the API stays up —
which is exactly what makes the persistence demo legible.

---

## D14 — Pausing parks jobs rather than removing them

**Alternative:** delete the queue entries on pause, recreate them on resume.

**Why it loses:** it is O(n) on both edges, and a crash while paused loses the jobs entirely.

**Chosen:** jobs stay in the queue; the processor checks campaign status on every pass and
parks for 15s. Pausing is instant and crash-safe. Resume additionally replaces parked jobs so
delivery restarts immediately instead of waiting out the interval.

---

## D15 — Refund the quota slot on delivery failure

**Alternative:** keep the consumed slot.

**Why it loses:** a flapping SMTP host would silently eat a mailbox's entire hourly
allowance without delivering anything.

**Chosen:** a failed send decrements the counter, guarded so a refund arriving after a window
rollover cannot push a fresh counter negative.

---

## D16 — `sendAt` carries the stagger only, never the cap

**Alternative:** compute cap-aware send times at creation and write them to `sendAt`.

**Why it loses:** the cap is **shared state**. Other campaigns on the same mailbox consume
the same quota, so any figure computed at creation time is already wrong by the time the job
runs — and it would be wrong in the worst way, because it looks authoritative.

**Chosen:** `layOutSendTimes` applies only the stagger (respecting the mailbox's own
`minDelayMs` so a campaign asking for 100ms on a 2s mailbox does not generate thousands of
guaranteed pacing deferrals). The runtime limiter is the single authority. `forecastSchedule`
simulates the limiter purely for the compose preview and is labelled an estimate in the UI.

---

## D17 — "Deferred" means "later than planned", not "crossed a boundary"

**Discovered by a test.** The forecast originally flagged an email as deferred only if *its
own* placement loop advanced past a window. But once the cap pushes one email into the next
window, every email behind it inherits the advanced cursor and also lands late — without its
loop ever iterating.

For 12 recipients against a cap of 5, that under-reported the delay as **2 affected instead
of 7**, and the compose UI printed a green "on time" label next to a timestamp an hour
adrift.

**Chosen:** `deferred = projectedAt > plannedAt`. The count and the per-row label now both
mean "this email sends later than its slot", which is what a user reads them as.

---

## D18 — A single `.liquid-glass` surface treatment

**Alternative:** style each panel with ad-hoc Tailwind translucency utilities.

**Why it loses:** panels drift apart — slightly different blur, border and shadow on every
screen — and the product stops looking like one thing.

**Chosen:** one CSS component class carrying the blur, the specular top ridge, the ambient
inner light and the shadow, with light/dark driven by custom properties. Every panel uses it,
so the whole app reads as one material.

---

## D19 — Floating centred nav dock instead of a left sidebar

**Alternative:** a fixed 248px left sidebar.

**Why it loses:** content is then centred in "viewport minus 248px", which reads as
off-centre, and the dashboard looks like a different product from the marketing page.

**Chosen:** a floating glass dock above a centred content column, sharing the landing page's
visual language.

---

## D20 — Vendored shaders are lint-exempt, scoped to their directory

**Alternative:** rewrite the `react-bits` WebGL components to satisfy the project lint
profile, or disable the rules globally.

**Why both lose:** rewriting forks them from upstream so they can never be cleanly updated;
disabling globally weakens the profile for code we actually own.

**Chosen:** an ESLint override scoped to `src/components/react-bits/**` only.
