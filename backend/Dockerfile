# ---------------------------------------------------------------------------
# OutboxLab backend - one image, two entrypoints.
#
# The API and the worker share all their code and differ only in which file
# they run, so they ship as a single image and the platform overrides the
# command. That guarantees the two processes can never drift to different
# builds of the engine.
#
#   API     node dist/index.js
#   Worker  node dist/worker.js
# ---------------------------------------------------------------------------

# --- build ---------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Prisma's engines need OpenSSL on Alpine.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# --- runtime -------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# The generated Prisma client lives in node_modules, so it is copied from the
# build stage rather than regenerated.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
COPY prisma ./prisma

# Run unprivileged.
USER node

EXPOSE 5000
CMD ["node", "dist/index.js"]
