#!/usr/bin/env node
/**
 * Generate a local .env from .env.example.
 *
 * .env.example is committed, so it must never contain a usable secret - not
 * even a development one, because example files get copied into production
 * verbatim. It therefore ships CHANGE_ME placeholders, and this script fills
 * them with freshly generated values on each developer's machine.
 *
 * Idempotent: an existing .env is never overwritten.
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = path.join(root, '.env.example');
const envPath = path.join(root, '.env');

if (fs.existsSync(envPath)) {
  console.log('.env already exists - leaving it untouched.');
  process.exit(0);
}

if (!fs.existsSync(examplePath)) {
  console.error('.env.example is missing; cannot generate .env.');
  process.exit(1);
}

/** URL-safe secret, no padding, safe to paste into a DSN. */
const secret = (bytes) => randomBytes(bytes).toString('base64url');

const jwtSecret = secret(48);           // ~64 chars, well over the 32 minimum
const postgresPassword = secret(18);
const demoPassword = 'demo1234';        // documented in the README so a reviewer can sign in
const bullBoardPassword = secret(12);

let contents = fs.readFileSync(examplePath, 'utf8');

// Order matters: the DATABASE_URL line embeds the Postgres password, so it is
// rewritten explicitly rather than relying on a bare CHANGE_ME replacement.
contents = contents
  .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${jwtSecret}`)
  .replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${postgresPassword}`)
  .replace(
    /^DATABASE_URL=.*$/m,
    `DATABASE_URL=postgresql://outboxlab:${postgresPassword}@localhost:5432/outboxlab?schema=public`,
  )
  .replace(/^DEMO_PASSWORD=.*$/m, `DEMO_PASSWORD=${demoPassword}`)
  .replace(/^BULL_BOARD_PASSWORD=.*$/m, `BULL_BOARD_PASSWORD=${bullBoardPassword}`);

const leftover = contents.match(/^([A-Z_]+)=.*CHANGE_ME.*$/gm);
if (leftover) {
  console.error(
    `\nThese placeholders were not filled in:\n${leftover.map((l) => `  ${l}`).join('\n')}\n`,
  );
  process.exit(1);
}

fs.writeFileSync(envPath, contents, 'utf8');

console.log(`
Created .env with generated credentials.

  JWT_SECRET           generated (64 chars)
  POSTGRES_PASSWORD    generated
  BULL_BOARD_PASSWORD  ${bullBoardPassword}   <- queue inspector, user "admin"
  DEMO_PASSWORD        ${demoPassword}        <- sign in as ${'demo@outboxlab.dev'}

.env is gitignored and never committed.
`);
