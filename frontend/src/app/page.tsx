"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Database,
  Server,
  Cpu,
  Mail,
  Radio,
  ShieldCheck,
  Gauge,
  RefreshCcw,
  Clock,
  Layers,
  Terminal,
  CheckCircle2,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { ThemeToggle } from "@/components/theme-toggle";
import { GlassCard } from "@/components/ui/glass-card";
import Silk from "@/components/react-bits/Silk";
import MoltenMetal from "@/components/react-bits/MoltenMetal";
import { useThemeColor } from "@/context/theme-context";
import { useAuth } from "@/context/auth-context";

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const PIPELINE = [
  {
    icon: Server,
    title: "API writes first",
    body: "A campaign is committed to PostgreSQL before a single job reaches Redis. If the process dies in between, the row exists with no queue entry - which is exactly the drift the reconciler repairs.",
  },
  {
    icon: Database,
    title: "One delayed job per email",
    body: "No cron, no polling. Each email becomes one BullMQ delayed job keyed by its own primary key, so a million emails scheduled a month out cost zero CPU until they are due.",
  },
  {
    icon: Gauge,
    title: "Pace, then check quota",
    body: "The worker reserves a send slot from a Redis pacer, then consumes one unit of the mailbox's window quota. Over quota means moveToDelayed - never a failure, so retries stay intact.",
  },
  {
    icon: Mail,
    title: "Deliver and record",
    body: "Nodemailer sends through the mailbox's own SMTP credentials, the result and preview URL are persisted, and the decision is appended to an immutable event log.",
  },
  {
    icon: Radio,
    title: "Stream it back",
    body: "The worker publishes to a per-user Redis channel; the API relays it over SSE. The dashboard mutates rows in place with zero polling.",
  },
];

const ENGINE_FIXES = [
  {
    icon: ShieldCheck,
    title: "Atomic quota, not INCR-then-compare",
    problem: "INCR first, compare after: rejected attempts still inflate the counter. Point 1,000 jobs at a cap of 5 and the window ends at 1,005.",
    fix: "One Lua script does GET → compare → conditional INCR → conditional PEXPIRE atomically. The counter is exactly the number of permitted sends and can never exceed the cap.",
  },
  {
    icon: Gauge,
    title: "Distributed pacer, not sleep()",
    problem: "await sleep(2000) inside the handler paces nothing: with concurrency 5, five jobs sleep in parallel and five sends fire at once - while holding five worker slots hostage.",
    fix: "Each mailbox owns a Redis key holding its next free slot. Workers atomically reserve it; a future slot is handed back to the delayed set and the worker is freed immediately.",
  },
  {
    icon: Clock,
    title: "Configurable window, not a hard-coded hour",
    problem: "A hard-coded 3,600,000 makes rate limiting impossible to demonstrate, and impossible to unit test without waiting an hour.",
    fix: "Every bucket calculation goes through one clock module. The Time Machine compresses the window to 60s at runtime - same code path, same Lua, just faster.",
  },
  {
    icon: RefreshCcw,
    title: "Drift sweeper, not just boot recovery",
    problem: "Reconciling only on boot fixes clean restarts. It does nothing for Redis being flushed or failing over while the process keeps running - those emails silently never send.",
    fix: "A repeating job compares Postgres against the live queue every 60s and restores anything missing. Idempotent, because the job id is the email's primary key.",
  },
];

// ---------------------------------------------------------------------------
// Architecture diagram
// ---------------------------------------------------------------------------

function ArchitectureDiagram() {
  const { themeColor } = useThemeColor();

  const nodes = [
    { icon: Layers, label: "Next.js", sub: "dashboard" },
    { icon: Server, label: "Express API", sub: "REST + SSE" },
    { icon: Database, label: "PostgreSQL", sub: "source of truth" },
    { icon: Cpu, label: "Redis + BullMQ", sub: "delayed jobs" },
    { icon: Terminal, label: "Worker", sub: "separate process" },
    { icon: Mail, label: "SMTP", sub: "Ethereal" },
  ];

  return (
    <div className="liquid-glass p-6 sm:p-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {nodes.map((node, index) => (
          <motion.div
            key={node.label}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.08 }}
            className="liquid-well relative flex flex-col items-center gap-2 p-4 text-center"
          >
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl border"
              style={{
                backgroundColor: `${themeColor}18`,
                borderColor: `${themeColor}44`,
                color: themeColor,
              }}
            >
              <node.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-zinc-900 dark:text-white">{node.label}</p>
              <p className="text-[10px] text-zinc-500">{node.sub}</p>
            </div>

            {/* Flow pulse between nodes */}
            {index < nodes.length - 1 && (
              <motion.span
                className="absolute -right-2 top-1/2 hidden h-1.5 w-1.5 rounded-full lg:block"
                style={{ backgroundColor: themeColor }}
                animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.3, 0.8] }}
                transition={{
                  duration: 1.8,
                  repeat: Infinity,
                  delay: index * 0.25,
                  ease: "easeInOut",
                }}
              />
            )}
          </motion.div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-black/10 pt-5 text-[11px] text-zinc-500 dark:border-white/10">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: themeColor }} />
          Writes commit to Postgres before jobs reach Redis
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Worker publishes → API relays over SSE → UI updates in place
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Home() {
  const { themeColor, backgroundType, silkConfig, moltenMetalConfig } = useThemeColor();
  const { user } = useAuth();

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-background font-serif transition-colors duration-500 selection:bg-primary/30">
      {/* Shader background */}
      <div className="pointer-events-none fixed inset-0 z-0 h-full w-full transition-opacity duration-700">
        {backgroundType === "silk" ? (
          <div className="absolute inset-0 h-full w-full opacity-90">
            <Silk
              color={themeColor}
              speed={silkConfig.speed}
              scale={silkConfig.scale}
              noiseIntensity={silkConfig.noiseIntensity}
              rotation={silkConfig.rotation}
            />
          </div>
        ) : (
          <div className="absolute inset-0 h-full w-full">
            <MoltenMetal
              color1={moltenMetalConfig.color1}
              color2={moltenMetalConfig.color2}
              color3={moltenMetalConfig.color3}
              speed={moltenMetalConfig.speed}
              scale={moltenMetalConfig.scale}
              detail={moltenMetalConfig.detail}
              glow={moltenMetalConfig.glow}
              coreSize={moltenMetalConfig.coreSize}
              swirl={moltenMetalConfig.swirl}
              fold={moltenMetalConfig.fold}
              blackPoint={moltenMetalConfig.blackPoint}
              brightness={moltenMetalConfig.brightness}
              colorMode={moltenMetalConfig.colorMode}
              grain={moltenMetalConfig.grain}
              grainIntensity={moltenMetalConfig.grainIntensity}
              mouseInteraction={moltenMetalConfig.mouseInteraction}
              mouseStrength={moltenMetalConfig.mouseStrength}
              opacity={moltenMetalConfig.opacity}
            />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-white/45 transition-colors duration-500 dark:bg-black/45" />
      </div>

      <Navbar />
      <ThemeToggle />

      {/* ---------------- Hero ---------------- */}
      <section className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-20 pt-36 text-center">
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-black/10 bg-white/80 px-5 py-2 shadow-xl backdrop-blur-2xl dark:border-white/15 dark:bg-black/50"
        >
          <div
            className="h-2 w-2 animate-pulse rounded-full"
            style={{ backgroundColor: themeColor }}
          />
          <span className="font-sans text-xs font-semibold uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
            Restart-safe email scheduling
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="mb-6 max-w-5xl font-serif text-4xl font-normal leading-[1.2] tracking-tight text-zinc-950 drop-shadow-sm dark:text-white dark:drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)] sm:text-6xl sm:leading-[1.24] md:text-7xl lg:text-8xl"
        >
          <span className="block pb-2">Schedule mail that</span>
          <span
            className="block bg-clip-text py-1 font-bold text-transparent drop-shadow-md"
            style={{
              backgroundImage: `linear-gradient(135deg, var(--hero-title-from, #ffffff) 30%, ${
                themeColor === "#ffffff" ? "#aaaaaa" : themeColor
              } 100%)`,
            }}
          >
            survives the restart
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.7 }}
          className="mb-10 max-w-2xl font-sans text-lg font-light leading-relaxed text-zinc-700 drop-shadow-sm dark:text-zinc-200 sm:text-xl md:text-2xl"
        >
          A distributed outbound scheduler with per-mailbox rate limiting, a lock-free pacer, and a
          realtime dashboard. Kill the process mid-campaign - Postgres rebuilds the queue and
          delivery resumes.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.7 }}
          className="flex flex-wrap items-center justify-center gap-4 font-sans"
        >
          <Link
            href={user ? "/dashboard" : "/login"}
            className="group relative overflow-hidden rounded-full px-9 py-4 text-sm font-bold shadow-2xl transition-all hover:scale-105 active:scale-95"
            style={{
              backgroundColor: themeColor,
              color: themeColor.toLowerCase() === "#ffffff" ? "#000000" : "#ffffff",
            }}
          >
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/35 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <span className="relative flex items-center gap-2">
              {user ? "Open dashboard" : "Open the dashboard"}
              <ArrowRight className="h-4 w-4" />
            </span>
          </Link>

          <a
            href="#architecture"
            className="flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-9 py-4 text-sm font-bold text-zinc-900 shadow-xl backdrop-blur-2xl transition-all hover:scale-105 hover:bg-white/95 active:scale-95 dark:border-white/15 dark:bg-black/50 dark:text-white dark:hover:bg-white/10"
          >
            <Layers className="h-4 w-4" style={{ color: themeColor }} />
            How it works
          </a>
        </motion.div>

        {/* Demo credentials */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-6 font-sans text-xs text-zinc-500 dark:text-zinc-400"
        >
          Demo account:{" "}
          <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono dark:bg-white/10">
            demo@outboxlab.dev
          </code>{" "}
          /{" "}
          <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono dark:bg-white/10">
            demo1234
          </code>
        </motion.p>
      </section>

      {/* ---------------- Architecture ---------------- */}
      <section id="architecture" className="section-anchor relative z-10 mx-auto w-full max-w-7xl px-6 py-16">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <span className="font-sans text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Architecture
          </span>
          <h2 className="mb-3 mt-2 text-3xl font-normal text-zinc-950 dark:text-white sm:text-5xl">
            Six moving parts, one invariant
          </h2>
          <p className="font-sans text-sm text-zinc-700 dark:text-zinc-300">
            PostgreSQL is the only source of truth. Redis holds nothing but derived state - which
            is precisely why a full <code className="font-mono">docker compose down -v</code> is
            recoverable.
          </p>
        </div>

        <ArchitectureDiagram />

        {/* Pipeline steps */}
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: index * 0.06 }}
            >
              <GlassCard className="flex h-full flex-col items-center p-7 text-center" interactive={false}>
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border"
                  style={{
                    backgroundColor: `${themeColor}18`,
                    borderColor: `${themeColor}44`,
                    color: themeColor,
                  }}
                >
                  <step.icon className="h-5 w-5" />
                </div>
                <span className="mt-3 font-mono text-[11px] font-bold tracking-[0.2em] text-zinc-500">
                  0{index + 1}
                </span>
                <h3 className="mb-2 mt-2 text-base font-bold text-zinc-950 dark:text-white">
                  {step.title}
                </h3>
                <p className="font-sans text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {step.body}
                </p>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ---------------- Engine fixes ---------------- */}
      <section id="engine" className="section-anchor relative z-10 mx-auto w-full max-w-7xl px-6 py-16">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <span className="font-sans text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            The engine
          </span>
          <h2 className="mb-3 mt-2 text-3xl font-normal text-zinc-950 dark:text-white sm:text-5xl">
            Four bugs worth fixing properly
          </h2>
          <p className="font-sans text-sm text-zinc-700 dark:text-zinc-300">
            Each of these is a real concurrency defect in the obvious implementation - and each one
            is verified by an assertion in <code className="font-mono">npm run test:burst</code>.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {ENGINE_FIXES.map((item, index) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: index * 0.06 }}
            >
              <GlassCard className="flex h-full flex-col items-center p-7 text-center" interactive={false}>
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border"
                  style={{
                    backgroundColor: `${themeColor}18`,
                    borderColor: `${themeColor}44`,
                    color: themeColor,
                  }}
                >
                  <item.icon className="h-5 w-5" />
                </div>
                <h3 className="mb-5 mt-3 text-base font-bold text-zinc-950 dark:text-white">
                  {item.title}
                </h3>

                <div className="w-full space-y-3 text-center font-sans text-xs leading-relaxed">
                  <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.09] p-4">
                    <p className="mb-1.5 font-bold uppercase tracking-[0.14em] text-rose-400">
                      The trap
                    </p>
                    <p className="text-zinc-700 dark:text-zinc-300">{item.problem}</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.09] p-4">
                    <p className="mb-1.5 font-bold uppercase tracking-[0.14em] text-emerald-400">
                      What OutboxLab does
                    </p>
                    <p className="text-zinc-700 dark:text-zinc-300">{item.fix}</p>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ---------------- Realtime ---------------- */}
      <section id="realtime" className="section-anchor relative z-10 mx-auto w-full max-w-7xl px-6 py-16">
        <div className="grid gap-6 lg:grid-cols-3">
          <GlassCard className="flex flex-col items-center p-7 text-center lg:col-span-2" interactive={false}>
            <div className="mb-4 flex flex-col items-center gap-3">
              <Radio className="h-6 w-6" style={{ color: themeColor }} />
              <h3 className="text-lg font-bold text-zinc-950 dark:text-white">
                Zero polling, end to end
              </h3>
            </div>
            <p className="mb-5 font-sans text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              The worker is a separate process, so it cannot write to a browser&apos;s HTTP
              response. Redis pub/sub bridges the gap: the worker publishes to a per-user channel
              and every API replica relays it downstream over Server-Sent Events. Rows in the
              dashboard change status in place as the engine works - no interval, no refetch loop,
              and no sticky sessions needed to scale the API horizontally.
            </p>
            <div className="grid w-full gap-3 sm:grid-cols-3">
              {[
                ["SSE over WebSockets", "Data flows one way; cookie auth and CORS apply unchanged."],
                ["Automatic reconnect", "EventSource repairs itself after a worker restart or sleep."],
                ["Durable first", "Events persist to Postgres before broadcast - the stream is an accelerator, not the record."],
              ].map(([title, body]) => (
                <div
                  key={title}
                  className="liquid-well flex flex-col items-center p-4 text-center"
                >
                  <div className="mb-1.5 flex flex-col items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" style={{ color: themeColor }} />
                    <p className="font-sans text-xs font-bold text-zinc-900 dark:text-white">
                      {title}
                    </p>
                  </div>
                  <p className="font-sans text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {body}
                  </p>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="flex flex-col items-center justify-between p-7 text-center" interactive={false}>
            <div>
              <Clock className="mx-auto mb-3 h-6 w-6" style={{ color: themeColor }} />
              <h3 className="mb-2 text-lg font-bold text-zinc-950 dark:text-white">Time Machine</h3>
              <p className="font-sans text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                Rate limiting on an hourly window is impossible to show in a five-minute demo. One
                API call compresses the window to 60 seconds - same Lua script, same deferral path,
                same bucket maths. Watch a mailbox hit its cap, watch the overflow defer, watch it
                drain into the next window.
              </p>
            </div>
            <Link
              href={user ? "/dashboard/settings" : "/login"}
              className="mt-6 inline-flex items-center justify-center gap-1.5 font-sans text-sm font-bold transition-transform hover:translate-x-0.5"
              style={{ color: themeColor }}
            >
              Try it in Settings <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </GlassCard>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer className="relative z-10 mt-auto border-t border-black/10 bg-white/70 px-6 py-10 backdrop-blur-2xl dark:border-white/10 dark:bg-black/50">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-center font-sans text-xs text-zinc-600 dark:text-zinc-400 sm:flex-row sm:text-left">
          <div className="flex items-center gap-3">
            <div
              className="h-2 w-2 animate-pulse rounded-full"
              style={{ backgroundColor: themeColor }}
            />
            <span>
              <strong className="font-serif text-zinc-900 dark:text-white">OutboxLab</strong> - built
              by Sayandip Jana
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span>Express + BullMQ + Redis + PostgreSQL</span>
            <span aria-hidden>&bull;</span>
            <span>Next.js App Router</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
