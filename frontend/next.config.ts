import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * Resolves the absolute URL of the OutboxLab API.
 *
 * The monorepo keeps a single `.env` at the repository root so the API, the
 * worker and this app can never disagree about the port the backend is on.
 * Next only auto-loads `.env` files from its own directory, so the root file is
 * parsed here. A real environment variable always beats the file, which keeps
 * Vercel and container overrides working.
 */
function resolveApiOrigin(): string {
  const rootEnv = path.resolve(__dirname, "../.env");
  const fromFile: Record<string, string> = {};

  if (fs.existsSync(rootEnv)) {
    for (const rawLine of fs.readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const eq = line.indexOf("=");
      if (eq === -1) continue;

      const key = line.slice(0, eq).trim();
      if (key !== "NEXT_PUBLIC_API_URL" && key !== "API_PROXY_TARGET") continue;

      // Strip matching surrounding quotes, if any.
      const value = line
        .slice(eq + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, "$2");

      if (value) fromFile[key] = value;
    }
  }

  const origin = (
    process.env.API_PROXY_TARGET ||
    process.env.NEXT_PUBLIC_API_URL ||
    fromFile.API_PROXY_TARGET ||
    fromFile.NEXT_PUBLIC_API_URL ||
    ""
  ).replace(/\/$/, "");

  // A hosted build has no repository-root .env to read, so the value must come
  // from the platform. Defaulting to localhost there would produce a build that
  // looks successful and is completely broken for every visitor - their browser
  // resolves localhost to their own machine - so fail now, naming the fix.
  const isHosted = Boolean(process.env.VERCEL || process.env.CI);
  const looksLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(origin);

  if (isHosted && (!origin || looksLocal)) {
    throw new Error(
      `The API URL is ${
        origin ? `"${origin}", which is not reachable from a browser` : "not set"
      }. Set NEXT_PUBLIC_API_URL in your hosting provider's environment ` +
        "variables to the public URL of the OutboxLab API, e.g. " +
        "https://outboxlab-api.onrender.com",
    );
  }

  return origin || "http://localhost:5000";
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
  // Hosted builds keep the conventional `.next`. Vercel and other platforms
  // detect Next.js by that directory, and there is no dev server alongside a
  // CI build to collide with - the split above only matters on a developer's
  // machine, where both run at once.
  const isHosted = Boolean(process.env.VERCEL || process.env.CI);
  const distDir =
    process.env.NEXT_DIST_DIR ??
    (isHosted || phase === PHASE_DEVELOPMENT_SERVER ? ".next" : ".next-build");

  const apiOrigin = resolveApiOrigin();

  return {
    reactStrictMode: true,
    distDir,

    env: {
      /**
       * Deliberately empty: the browser talks to this app's own origin and the
       * rewrite below forwards to the API. Set explicitly so a stale value in
       * the repository-root .env cannot leak an absolute URL into the bundle.
       */
      NEXT_PUBLIC_API_URL: "",
      /** Absolute, for the few links a human opens directly (Bull Board, metrics). */
      NEXT_PUBLIC_API_ORIGIN: apiOrigin,
    },

    /**
     * Proxy the API through this origin so the session cookie is first-party.
     *
     * The frontend and the API live on unrelated domains in production
     * (*.vercel.app and *.onrender.com). A cookie set by the API is therefore a
     * third-party cookie, and Chrome blocks those by default - so the browser
     * silently dropped the Set-Cookie on login, every subsequent request was
     * unauthenticated, and the app bounced straight back to the sign-in page.
     * No combination of SameSite=None, Secure and CORS can fix that; the
     * browser is not asking the server's opinion.
     *
     * Routing through this origin makes the cookie first-party, which no
     * browser blocks, and drops the CORS preflight entirely. It applies in
     * development too - localhost:3000 and localhost:5000 are same-site, so
     * dev never reproduced the failure and the bug only ever appeared in
     * production.
     */
    async rewrites() {
      return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
    },
  };
}
