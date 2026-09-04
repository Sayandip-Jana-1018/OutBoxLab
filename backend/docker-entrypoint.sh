#!/bin/sh
# ---------------------------------------------------------------------------
# Container entrypoint.
#
# Migrations run here rather than in the platform's start-command field. Render
# does not evaluate that field as a shell line - it exec's it - so
# `sh -c "npx prisma migrate deploy && node dist/server.js"` was looked up as a
# single binary with that exact name and exited 127. Putting the sequence in a
# real script sidesteps every platform's argv-parsing quirks.
#
# `migrate deploy` only applies pending migrations and is a no-op once the
# schema is current, so running it on every boot is safe.
#
# APP_ENTRYPOINT selects which process this container runs, so one image can
# serve as the API, the worker, or both:
#   dist/server.js  API + worker in one process   (default; single-service hosts)
#   dist/index.js   API only
#   dist/worker.js  worker only
# ---------------------------------------------------------------------------
set -e

npx prisma migrate deploy

# exec so the app becomes PID 1 and receives SIGTERM directly - otherwise the
# graceful shutdown that waits for in-flight sends never runs.
exec node "${APP_ENTRYPOINT:-dist/server.js}"
