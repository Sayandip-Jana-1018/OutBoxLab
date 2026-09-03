import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * The monorepo keeps a single `.env` at the repository root so the API, the
 * worker and this app can never disagree about the port the backend is on.
 *
 * Next only auto-loads `.env` files from its own directory, so the root file is
 * parsed here and its NEXT_PUBLIC_* keys are inlined at build time. Values
 * already present in the real environment win, which keeps CI and container
 * overrides working.
 */
function loadRootPublicEnv(): Record<string, string> {
  const rootEnv = path.resolve(__dirname, "../.env");
  const out: Record<string, string> = {};

  if (fs.existsSync(rootEnv)) {
    for (const rawLine of fs.readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const eq = line.indexOf("=");
      if (eq === -1) continue;

      const key = line.slice(0, eq).trim();
      if (!key.startsWith("NEXT_PUBLIC_")) continue;

      // Strip matching surrounding quotes, if any.
      const value = line
        .slice(eq + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, "$2");

      if (value) out[key] = value;
    }
  }

  // A real environment variable always beats the file.
  for (const key of Object.keys(out)) {
    const fromProcess = process.env[key];
    if (fromProcess) out[key] = fromProcess;
  }

  // Guarantee the API URL is always defined so the client never falls back to
  // a same-origin request that would 404.
  if (!out.NEXT_PUBLIC_API_URL) {
    out.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
  }

  return out;
}

/**
 * `next dev` and `next build` MUST NOT share an output directory.
 *
 * They write different, incompatible artifacts to the same paths. Running a
 * production build while a dev server is up overwrites the chunks and module
 * manifests the dev server is still serving from, and the dev server then dies
 * with:
 *
 *   TypeError: __webpack_modules__[moduleId] is not a function
 *
 * after which every /_next/static/* request 404s - no CSS, no JS, no
 * hydration. The page renders as unstyled HTML with framer-motion's SSR
 * `opacity: 0` still applied, so most of it looks blank.
 *
 * Giving the dev server its own `.next` and sending build/start output to
 * `.next-build` makes that collision structurally impossible, so `npm run
 * build` is always safe to run while `npm run dev` is going.
 */
export default function config(phase: string): NextConfig {
  return {
    reactStrictMode: true,
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next" : ".next-build",
    env: loadRootPublicEnv(),
  };
}
