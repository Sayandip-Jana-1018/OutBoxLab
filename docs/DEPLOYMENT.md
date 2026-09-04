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

1. Push this repository to GitHub.
2. Render dashboard → **New** → **Blueprint** → select the repo.
3. Render reads `render.yaml` and creates four resources: `outboxlab-postgres`,
   `outboxlab-redis`, `outboxlab-api`, `outboxlab-worker`.
4. It prompts for the values marked `sync: false`:

   | Variable | Value |
   | --- | --- |
   | `APP_URL` | the API's own URL, e.g. `https://outboxlab-api.onrender.com` |
   | `FRONTEND_URL` | your Vercel URL — fill this in after step 3 and redeploy |
   | `DEMO_PASSWORD` | any password for the seeded demo account |

5. Deploy. `preDeployCommand` runs `prisma migrate deploy` before the new
   instance takes traffic, so the schema is created automatically.
6. Confirm `https://<api>.onrender.com/api/health` returns `"status": "ok"`
   with both dependencies `up`.

> **The worker is on the `starter` plan deliberately.** Render's free web
> services sleep when idle; a worker that sleeps stops delivering mail. The API
> may stay free — a sleeping API only delays the dashboard, and the boot
> reconciler rebuilds the queue when it wakes.

### Seeding the demo account

Optional. Render shell on `outboxlab-api`:

```bash
npx prisma db seed
```

---

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

## 4. Cross-origin cookies

The frontend and API are on different domains, so the session cookie needs
`SameSite=None; Secure`. `COOKIE_SECURE=true` in the blueprint does this. With
it left at `false` the browser silently drops the cookie and every request 401s
after a seemingly successful login.

Both sides must be HTTPS. Vercel and Render both are by default.

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
