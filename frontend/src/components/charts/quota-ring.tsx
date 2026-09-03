"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { useThemeColor } from "@/context/theme-context";
import { cn } from "@/lib/utils";

/**
 * Sender health ring: how much of a mailbox's per-window quota is consumed.
 *
 * The colour deliberately shifts from the theme accent to amber to rose as the
 * mailbox approaches its cap, so "this sender is about to start deferring" is
 * legible at a glance without reading the numbers.
 */
export function QuotaRing({
  used,
  limit,
  label,
  size = 84,
  className,
}: {
  used: number;
  limit: number;
  label?: string;
  size?: number;
  className?: string;
}) {
  const { themeColor } = useThemeColor();

  const safeLimit = Math.max(1, limit);
  const ratio = Math.min(1, used / safeLimit);

  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const color = ratio >= 1 ? "#fb7185" : ratio >= 0.8 ? "#fbbf24" : themeColor;

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          className="-rotate-90"
          role="img"
          aria-label={`${label ?? "Sender"} quota: ${used} of ${limit} used`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-black/10 dark:stroke-white/10"
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - ratio) }}
            transition={{ type: "spring", stiffness: 90, damping: 20 }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-bold leading-none text-zinc-900 dark:text-white">
            {used}
          </span>
          <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
            / {limit}
          </span>
        </div>
      </div>

      {label && (
        <span className="max-w-[100px] truncate text-center text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
          {label}
        </span>
      )}
    </div>
  );
}
