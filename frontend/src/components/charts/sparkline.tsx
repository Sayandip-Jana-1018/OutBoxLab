"use client";

import * as React from "react";
import { useThemeColor } from "@/context/theme-context";

/**
 * Dependency-free throughput sparkline.
 *
 * The backend returns a dense series (one bucket per minute, zeros included),
 * so this only has to map values onto a path - no gap filling, no scales
 * library. An area fill plus a "current value" head dot keeps it readable at
 * ~40px tall.
 */
export function Sparkline({
  data,
  height = 56,
  className,
  showAxis = false,
}: {
  data: { at: string; sent: number }[];
  height?: number;
  className?: string;
  showAxis?: boolean;
}) {
  const { themeColor } = useThemeColor();
  const gradientId = React.useId();

  if (data.length === 0) {
    return (
      <div
        className={className}
        style={{ height }}
        aria-label="No throughput data yet"
      />
    );
  }

  const width = 100; // viewBox units; SVG scales to its container
  const max = Math.max(1, ...data.map((d) => d.sent));
  const stepX = data.length > 1 ? width / (data.length - 1) : width;

  const points = data.map((d, i) => {
    const x = i * stepX;
    // Leave 10% headroom at the top so the peak never clips.
    const y = height - (d.sent / max) * (height * 0.9);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const head = points[points.length - 1];
  const total = data.reduce((sum, d) => sum + d.sent, 0);

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Throughput sparkline: ${total} emails sent across ${data.length} minutes, peak ${max} per minute`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={themeColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={themeColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={themeColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {head && (
          <circle
            cx={head[0]}
            cy={head[1]}
            r="2"
            fill={themeColor}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {showAxis && (
        <div className="mt-1 flex justify-between text-[10px] font-medium text-zinc-500 dark:text-zinc-500">
          <span>{data.length}m ago</span>
          <span>peak {max}/min</span>
          <span>now</span>
        </div>
      )}
    </div>
  );
}
