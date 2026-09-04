# Deploying OutboxLab

## Why not Vercel alone

Vercel is an excellent host for the Next.js frontend and a poor fit for the
backend. Two parts of this system cannot run on it:

| Component | Why serverless fails |
| --- | --- |
| **The worker** | It is a long-lived process that sits idle between jobs waiting for BullMQ to hand it work. Serverless functions only exist while handling a request. There is nothing to invoke them when a delayed job becomes due, so scheduled mail would simply never send. |
| **SSE (`/api/events`)** | The stream is held open for as long as the dashboard is on screen. Vercel functions cap out well before that, so the connection would be severed every few minutes. |

Redis and Postgres also need somewhere to live, and BullMQ needs a Redis that
does **not** evict keys.

So the deployment splits in two:

```
Vercel                     Render (or Railway / Fly.io)
────────                   ────────────────────────────
Next.js frontend  ──────▶  API  (web service, always on)
                           Worker (background worker)
                           Postgres
                           Redis
```

`render.yaml` in the repository root declares the whole right-hand column.

---

## 1. Rotate the JWT secret first

The `.env` on your machine still carries the development secret that is
published in `.env.example` in this public repository. Anyone can read it and
forge a session token. It must not reach production.

The blueprint handles this: `JWT_SECRET` uses `generateValue: true`, so Render
generates one and never displays it. Nothing to copy.

---

## 2. Backend, Postgres and Redis on Render

**Use the Blueprint flow, not "New Web Service".** The manual flow creates one
service at a time and leaves you hand-typing every environment variable across
four resources. `render.yaml` declares all of them, wires the database and Redis
URLs automatically, and generates the secrets.

1. Push this repository to GitHub.
2. Render dashboard → **New** → **Blueprint** → select the repo → **Apply**.
3. Render reads `render.yaml` and creates `outboxlab-postgres`,
   `outboxlab-redis` and `outboxlab-api`.
4. It prompts only for the values marked `sync: false`:

   | Variable | What to enter |
   | --- | --- |
   | `APP_URL` | The API's own URL. Render shows it as it creates the service — `https://outboxlab-api.onrender.com`. |
   | `FRONTEND_URL` | Your Vercel URL. You do not have it yet — put `https://localhost` for now and correct it in step 3. |
   | `DEMO_PASSWORD` | Any password for the seeded demo account. |

5. Deploy. Migrations run as part of the start command, so the schema is created
   on first boot.
6. Confirm `https://<api>.onrender.com/api/health` returns `"status": "ok"` with
   both dependencies `up`.

### Why one service instead of two

The README describes the API and worker as separate processes, and that is the
better shape. Render's free tier only offers web services — a background worker
is paid — so the blueprint runs both in one process via `dist/server.js`.
Deploying only the API would look perfectly healthy and never deliver anything.

On a paid plan, split them: change the web service's command to
`node dist/index.js` and add a `type: worker` service running
`node dist/worker.js`. Nothing else changes.

### What free tier costs you

- **The instance sleeps when idle.** A sleeping instance delivers nothing.
  Scheduled mail is not lost — on wake the boot reconciler re-enqueues
  everything Postgres still considers pending, and anything overdue goes out
  immediately — but it is late by however long the instance was down. For a
  portfolio deployment that is usually fine; for real mail it is not.
- **Free Postgres expires after 30 days.**
- **No shell access**, so seed via the API by registering an account rather than
  running `prisma db seed`.

## 3. Frontend on Vercel

1. Vercel → **Add New** → **Project** → select the same repository.
2. **Root Directory: `frontend`.** This is the only setting that matters for a
   monorepo; Vercel then detects Next.js normally.
3. Environment variables:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_API_URL` | `https://outboxlab-api.onrender.com` |

   There is no root `.env` on Vercel — the file is gitignored — so this must be
   set here. The build **fails deliberately** if it is missing or points at
   localhost, rather than shipping a site that is broken for every visitor.

4. Deploy, then go back to Render and set `FRONTEND_URL` to the Vercel URL.
   Redeploy the API so CORS accepts the new origin.

---

## 4. The session cookie

The frontend and the API sit on unrelated domains — `*.vercel.app` and
`*.onrender.com`. A cookie the API sets is therefore a **third-party cookie**,
and Chrome blocks those by default. Safari has for years; Firefox blocks them
under Enhanced Tracking Protection.

That failure is worth recognising, because it looks like everything else:

- login returns 200 and shows a success toast,
- the next request is anonymous, so the app bounces back to the sign-in page,
- the dashboard counters error out and the live pill sits on *Reconnecting*.

No server-side setting fixes it. `SameSite=None; Secure` and
`Access-Control-Allow-Credentials: true` are both already correct — the browser
simply is not asking the server's opinion.

The fix is to stop making the cookie third-party. `frontend/next.config.ts`
rewrites `/api/*` to the backend, so the browser only ever talks to the Vercel
origin and the cookie comes back first-party. CORS stops applying at all.

Two consequences worth knowing:

- `NEXT_PUBLIC_API_URL` on Vercel is the **proxy target**, not a URL the browser
  uses. It still must be the API's public URL.
- `FRONTEND_URL` on Render no longer gates normal traffic, since proxied
  requests are server-to-server. Keep it set correctly anyway — it still governs
  anything that reaches the API directly from a browser.

`COOKIE_SECURE=true` remains required: the cookie is `Secure`, and both sides
are HTTPS on Vercel and Render by default.

---

## 5. Should you upload your `.env`?

**No — and it would not work anyway.**

- `.env` is gitignored, so it is not in the repository, and it should stay that
  way.
- Render and Vercel do not read a `.env` file from the repo. They inject
  environment variables into the process, which is where secrets belong: stored
  encrypted, editable without a redeploy, and absent from your git history.
- Your current `.env` is wrong for production in six places — `NODE_ENV`,
  `COOKIE_SECURE`, both localhost URLs, both localhost datastore DSNs — and the
  `JWT_SECRET` is publicly known.

Set variables in each platform's dashboard. `render.yaml` already declares most
of them; only three need typing.

---

## Before real sending

The stack will run once the steps above are done, but sending genuine mail at
volume needs more:

- **SPF, DKIM and DMARC** on a sending domain. Without them, mail is filtered.
- **Bounce and complaint webhooks** feeding a suppression list. Ignoring these
  destroys sender reputation faster than anything else.
- **An unsubscribe link**, legally required for commercial mail.
- **Encrypted SMTP credentials.** They are currently stored in plaintext in
  Postgres — acceptable for a sandbox, not for production.
- **`ENABLE_TIME_MACHINE=false`**, already set in the blueprint. It clears live
  quota buckets and is demo-only.

See the trade-offs section in the [README](../README.md).
