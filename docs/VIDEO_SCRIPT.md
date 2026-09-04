# OutboxLab — 5 minute demo video script

A walkthrough for a portfolio recording: the problem, the interface, every page,
and a real Gmail send. Times are cumulative.

**Before you hit record**

```bash
docker compose up -d
npm run dev              # API :5000 · worker · web :3000
```

- Settings → Time Machine reads **1h** (not compressed).
- Mailboxes shows your **Gmail** card with the green *Live — delivers to real inboxes* badge.
- Have a second browser window on your Gmail inbox, ready to show arrival.
- Zoom the browser to ~110% so text survives video compression.
- Keep **one** terminal visible showing the worker log.

---

## 0:00 — 0:35 · The problem

> "If you have ever needed to send a few hundred emails from your own mailbox —
> a placement drive, a newsletter, outreach — you hit three problems fast.
>
> One: providers rate-limit you. Gmail cuts you off around 500 a day, and it
> throttles bursts long before that.
>
> Two: sending them in a loop gets you flagged as spam. You need real spacing
> between messages.
>
> And three, the one that actually hurts: if your process crashes halfway
> through, what happens to the emails that had not gone out yet? In most naive
> implementations, they are simply gone.
>
> OutboxLab is a scheduling engine that solves all three. Let me show you."

**On screen:** the landing page hero.

---

## 0:35 — 1:10 · Architecture, in one breath

**Do:** scroll slowly to the architecture diagram.

> "Six components, one invariant: PostgreSQL is the only source of truth. Redis
> holds nothing but derived state.
>
> Every campaign commits to Postgres before a single job reaches Redis. So if
> the process dies in between, the row exists with no queue entry — and a
> reconciler repairs exactly that.
>
> There is no cron here and no polling. Each email becomes one BullMQ delayed
> job, so a million emails scheduled a month out cost zero CPU until they are
> due."

**Do:** scroll to the "Four bugs worth fixing properly" cards. Pause on the first.

> "These are real concurrency bugs in the obvious implementation. The first: if
> you INCR a counter and then compare it, rejected attempts still inflate it.
> Point a thousand jobs at a cap of five and the counter ends at a thousand and
> five. OutboxLab does the whole check in one atomic Lua script."

---

## 1:10 — 1:40 · Sign in and the dashboard

**Do:** Sign in → *Use the demo account* → **Sign in**.

> "Auth is bcrypt with a JWT in an httpOnly cookie."

**Do:** land on Overview. Point at the **Live** pill.

> "Everything on this page streams over Server-Sent Events. Nothing is polled.
> The worker publishes to a Redis channel, the API relays it, and these numbers
> move on their own — you will see that in a minute.
>
> Scheduled, in flight, delivered, failed. Throughput per minute. And mailbox
> quota, because rate limiting is per mailbox, never global — that is how real
> providers throttle you."

---

## 1:40 — 2:10 · Mailboxes

**Do:** click **Mailboxes**.

> "A mailbox is one outbound identity with its own budget.
>
> These two are Ethereal — a sandbox that accepts mail and stores it but never
> delivers it. Ideal for testing a scheduler without spamming anyone, and each
> card says so.
>
> This one is my actual Gmail, added over SMTP. Green badge: it delivers for
> real. Cap of twenty per window, five seconds minimum between sends."

**Do:** click **Verify SMTP** on the Gmail card. Wait for the green toast.

> "That just opened a real connection to smtp.gmail.com and authenticated."

---

## 2:10 — 3:00 · Compose, and the real send

**Do:** click **Compose**. Select the **Gmail** mailbox.

> "Pick the mailbox and the cap and gap follow it automatically."

**Do:** set a campaign name, subject `Congratulations {{name}}!`, and a body
using `{{name}}` and `{{note}}`.

> "Subject and body are templates. Anything in double braces is substituted per
> recipient."

**Do:** drop your CSV onto the Recipients panel.

> "I drop a CSV. The email column is the address; every other column becomes a
> variable. It validates and de-duplicates in the browser — three valid, zero
> invalid, zero duplicates."

**Do:** step through recipients with the arrows in Live preview.

> "Live preview renders the real message for each recipient, so I can check
> every one before committing. Different name, different company, per person."

**Do:** point at Projected schedule.

> "And this forecasts exactly when each email lands, including any the cap will
> throttle, before I commit to anything."

**Do:** point at the pre-flight panel, then click **Schedule**.

> "Green across the board, and it confirms this mailbox delivers for real. Send."

---

## 3:00 — 3:50 · Watch it deliver

**Do:** you land on the campaign timeline. **Say nothing for a few seconds.**

> "No refresh. Those nodes are changing colour as the worker actually sends —
> scheduled, processing, sent — pushed over SSE.
>
> Five seconds between each. That is the pacer: a Redis slot reservation, not a
> sleep. A sleep would hold a worker slot hostage and, with concurrency five,
> fire five at once anyway."

**Do:** switch to your Gmail inbox. Show the emails arriving, each with the
right name.

> "And there they are. Real inboxes, each one personalised."

**Do:** back to **Sent & history**, click a row.

> "Every email keeps its full decision timeline — queued, picked up, sent, with
> timestamps. Read from a durable audit log, not from the stream."

---

## 3:50 — 4:30 · Rate limiting, made visible

**Do:** Settings → Time Machine → **1 minute**.

> "Rate limiting on an hourly window is impossible to show in a five-minute
> video. This compresses the window to sixty seconds at runtime. Same Lua
> script, same deferral path, same bucket maths — only the window length
> changes. What you are watching is the real production behaviour, just faster."

**Do:** Compose → the **cap-5 Ethereal mailbox** → 12 recipients → Schedule.

**Do:** go to **Queue**.

> "Twelve emails, cap of five. Exactly five send. The other seven go deferred —
> and that is not a failure, it is moveToDelayed. BullMQ does not count it as
> an attempt, so a throttled email keeps its full retry budget for genuine SMTP
> errors."

**Do:** open a deferred row's drawer, point at the event message.

> "It tells you the exact cap it hit and when it will retry."

**Do:** wait for the next window; show them draining.

---

## 4:30 — 5:00 · The restart guarantee

**Do:** schedule something a couple of minutes out, then **Ctrl+C the worker
terminal**.

> "Now the important part. I am killing the worker mid-campaign. The API is
> still up, the dashboard still works — but nothing can send."

**Do (optional, stronger):**

```bash
docker exec -it outboxlab-redis redis-cli FLUSHALL
```

> "I have just destroyed the entire queue. Postgres still has every row."

**Do:** run `npm run dev:worker`. Point at the log line.

> "Reconciliation complete — ten of ten emails back in the queue.
>
> Every pending email is back, because the job ID is the database row's primary
> key, so replaying is idempotent — and anything already overdue goes out
> immediately.
>
> No cron. Restart-safe by construction. Rate limiting that is atomic under
> concurrency. And a dashboard with zero polling.
>
> That is OutboxLab. Code is on GitHub."

---

## Backup shot: the burst test

If you want a hard number on camera:

```bash
npm run test:burst
```

> "A thousand concurrent jobs against a cap of five. Exactly five allowed,
> nothing dropped, the counter never exceeds the cap. Underneath it prints what
> the naive INCR-then-compare produces on the identical burst — a thousand.
> That is the bug this fixes."

---

## If something goes wrong on camera

| Symptom | Cause |
| --- | --- |
| Nothing sends | The worker terminal is not running. The API alone does not process jobs. |
| Everything deferred | Time Machine still compressed, or the mailbox is at its cap. |
| Live pill says Offline | API is down, or asleep - give a free instance up to a minute to wake. |
| Gmail send fails | Re-run **Verify SMTP**. App passwords can be revoked. |
| Preview link missing | Expected for SMTP mailboxes. Ethereal only. Show the Gmail Sent folder instead. |
