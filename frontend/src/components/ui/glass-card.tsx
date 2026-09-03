"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { useThemeColor } from "@/context/theme-context";

/**
 * Framer's `motion.div` defines its own drag/animation handlers whose
 * signatures conflict with the native DOM ones, so those keys are omitted from
 * the prop surface rather than papered over with a cast.
 */
type DivProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd"
>;

interface GlassCardProps extends DivProps {
  children: React.ReactNode;
  className?: string;
  spotlight?: boolean;
  interactive?: boolean;
  glowColor?: string;
  variant?: "default" | "subtle" | "prominent";
}

const VARIANTS: Record<NonNullable<GlassCardProps["variant"]>, string> = {
  default: "bg-white/80 dark:bg-black/50 border-black/10 dark:border-white/15",
  subtle: "bg-white/60 dark:bg-black/30 border-black/5 dark:border-white/10",
  prominent: "bg-white/90 dark:bg-black/70 border-black/15 dark:border-white/20",
};

export function GlassCard({
  children,
  className,
  spotlight = true,
  interactive = true,
  glowColor,
  variant = "default",
  onClick,
  ...props
}: GlassCardProps) {
  const { themeColor } = useThemeColor();
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const [isHovered, setIsHovered] = React.useState(false);

  const activeGlow = glowColor || themeColor;

  const spotlightBackground = useMotionTemplate`
    radial-gradient(
      450px circle at ${mouseX}px ${mouseY}px,
      ${activeGlow}25,
      rgba(255,255,255,0.08) 40%,
      transparent 80%
    )
  `;

  function handleMouseMove({
    currentTarget,
    clientX,
    clientY,
  }: React.MouseEvent<HTMLDivElement>) {
    const { left, top } = currentTarget.getBoundingClientRect();
    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  return (
    <motion.div
      whileHover={
        interactive
          ? {
              y: -8,
              scale: 1.015,
              transition: { type: "spring", stiffness: 380, damping: 22 },
            }
          : undefined
      }
      whileTap={
        interactive
          ? {
              scale: 0.97,
              transition: { type: "spring", stiffness: 450, damping: 18 },
            }
          : undefined
      }
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseMove={handleMouseMove}
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-3xl backdrop-blur-2xl transition-all duration-500",
        "border text-zinc-900 dark:text-white",
        VARIANTS[variant],
        "shadow-[0_20px_40px_-15px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)]",
        interactive && "cursor-pointer select-none",
        className,
      )}
      style={{
        boxShadow: isHovered
          ? `0 25px 60px -15px ${activeGlow}35, 0 0 35px -5px ${activeGlow}25, inset 0 1px 2px rgba(255,255,255,0.3)`
          : undefined,
        borderColor: isHovered ? `${activeGlow}60` : undefined,
      }}
      {...props}
    >
      {/* Specular top reflection ridge */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/10 to-transparent dark:via-white/40" />

      {/* Interactive cursor spotlight */}
      {spotlight && (
        <motion.div
          className="pointer-events-none absolute -inset-px rounded-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: spotlightBackground }}
        />
      )}

      {/* Ambient theme backlight */}
      <div
        className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-15"
        style={{
          background: `radial-gradient(circle at 50% 0%, ${activeGlow}, transparent 70%)`,
        }}
      />

      {/* Content */}
      <div className="relative z-10 h-full w-full">{children}</div>
    </motion.div>
  );
}
