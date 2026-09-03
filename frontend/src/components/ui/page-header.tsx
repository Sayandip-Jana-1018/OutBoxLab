"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { useThemeColor } from "@/context/theme-context";
import { cn } from "@/lib/utils";

/**
 * The single centred page header used by every screen.
 *
 * Keeping this in one component is what makes the whole app feel like one
 * product: identical eyebrow / title / description rhythm and identical
 * entrance motion on every route.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  const { themeColor } = useThemeColor();

  return (
    <motion.header
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      className={cn("flex flex-col items-center text-center", className)}
    >
      {eyebrow && (
        <span
          className="mb-3 inline-flex items-center gap-2 rounded-full border px-3.5 py-1 font-sans text-[10px] font-bold uppercase tracking-[0.18em]"
          style={{
            color: themeColor,
            borderColor: `${themeColor}44`,
            backgroundColor: `${themeColor}12`,
          }}
        >
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full"
            style={{ backgroundColor: themeColor }}
          />
          {eyebrow}
        </span>
      )}

      <h1 className="font-serif text-3xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-4xl">
        {title}
      </h1>

      {description && (
        <p className="mt-3 max-w-2xl text-balance font-sans text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {description}
        </p>
      )}

      {action && <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div>}

      {/* Hairline divider that fades out at both ends. */}
      <div
        className="mt-7 h-px w-full max-w-md"
        style={{
          background: `linear-gradient(90deg, transparent, ${themeColor}55, transparent)`,
        }}
      />
    </motion.header>
  );
}

/**
 * A centred glass panel with an optional titled header row.
 * `align` controls the body only - the heading is always centred.
 */
export function GlassPanel({
  title,
  subtitle,
  icon,
  action,
  children,
  className,
  delay = 0,
  align = "center",
}: {
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  delay?: number;
  align?: "center" | "left";
}) {
  const { themeColor } = useThemeColor();

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      className={cn("liquid-glass p-6 sm:p-7", className)}
    >
      {(title || action) && (
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {icon && (
            <div
              className="flex h-11 w-11 items-center justify-center rounded-2xl border"
              style={{
                color: themeColor,
                borderColor: `${themeColor}44`,
                backgroundColor: `${themeColor}14`,
              }}
            >
              {icon}
            </div>
          )}
          {title && (
            <div>
              <h2 className="font-serif text-lg font-bold text-zinc-900 dark:text-white">
                {title}
              </h2>
              {subtitle && (
                <p className="mt-1 font-sans text-xs text-zinc-500 dark:text-zinc-400">
                  {subtitle}
                </p>
              )}
            </div>
          )}
          {action}
        </div>
      )}

      <div className={cn(align === "center" && "flex flex-col items-center")}>{children}</div>
    </motion.section>
  );
}
