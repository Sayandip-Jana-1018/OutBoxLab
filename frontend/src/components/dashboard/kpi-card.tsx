"use client";

import * as React from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Count-up number that re-animates whenever the value changes.
 *
 * Values arrive over SSE, so the animation doubles as a change indicator: a
 * KPI ticking up while you watch is the clearest possible proof the dashboard
 * is live rather than polled.
 */
export function AnimatedNumber({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { stiffness: 110, damping: 26 });
  const rounded = useTransform(spring, (latest) =>
    Math.round(latest).toLocaleString("en-US"),
  );

  React.useEffect(() => {
    motionValue.set(value);
  }, [motionValue, value]);

  return <motion.span className={className}>{rounded}</motion.span>;
}

export function KpiCard({
  label,
  value,
  icon,
  accent,
  hint,
  loading,
  delay = 0,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: string;
  hint?: string;
  loading?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -6 }}
      className={cn(
        "liquid-glass group flex flex-col items-center p-6 text-center",
        "transition-shadow duration-500",
      )}
      style={{ ["--kpi-accent" as string]: accent }}
    >
      {/* Accent bloom so each KPI is distinguishable at a glance */}
      <div
        className="pointer-events-none absolute -top-12 left-1/2 h-28 w-28 -translate-x-1/2 rounded-full opacity-25 blur-3xl transition-opacity duration-500 group-hover:opacity-45"
        style={{ backgroundColor: accent }}
      />

      <div
        className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border transition-transform duration-500 group-hover:scale-110"
        style={{
          backgroundColor: `${accent}18`,
          borderColor: `${accent}44`,
          color: accent,
        }}
      >
        {icon}
      </div>

      {loading ? (
        <div className="h-9 w-20 animate-shimmer rounded-xl bg-gradient-to-r from-black/[0.06] via-black/[0.12] to-black/[0.06] dark:from-white/[0.05] dark:via-white/[0.12] dark:to-white/[0.05]" />
      ) : (
        <AnimatedNumber
          value={value}
          className="block font-serif text-4xl font-bold leading-none tracking-tight text-zinc-900 dark:text-white"
        />
      )}

      <p className="mt-3 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      {hint && (
        <p className="mt-1 font-sans text-[11px] text-zinc-400 dark:text-zinc-500">{hint}</p>
      )}
    </motion.div>
  );
}
