"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Workflow, ShieldCheck, Radio, LogIn } from "lucide-react";
import Link from "next/link";
import { useThemeColor } from "@/context/theme-context";
import { useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { name: "Architecture", icon: Workflow, href: "#architecture" },
  { name: "Engine", icon: ShieldCheck, href: "#engine" },
  { name: "Realtime", icon: Radio, href: "#realtime" },
];

export function Navbar() {
  const { themeColor } = useThemeColor();
  const { user } = useAuth();
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-none fixed inset-x-0 top-5 z-50 flex items-center justify-center px-4"
    >
      <nav
        className={cn(
          "pointer-events-auto relative flex items-center gap-1.5 rounded-full p-1.5",
          "bg-white/80 dark:bg-black/60",
          "border border-black/10 backdrop-blur-2xl dark:border-white/15",
          "shadow-[0_15px_35px_rgba(0,0,0,0.25)] transition-all duration-300",
        )}
      >
        {/* Brand */}
        <Link
          href="/"
          className="group flex items-center gap-2 rounded-full px-3.5 py-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        >
          <div
            className="relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-lg border border-black/10 shadow-sm transition-transform group-hover:scale-110 dark:border-white/20"
            style={{ backgroundColor: `${themeColor}25` }}
          >
            <div
              className="absolute h-2 w-2 animate-ping rounded-full"
              style={{ backgroundColor: themeColor }}
            />
            <div
              className="relative z-10 h-2 w-2 rounded-full"
              style={{ backgroundColor: themeColor }}
            />
          </div>
          <span className="text-sm font-bold tracking-tight text-zinc-900 transition-opacity group-hover:opacity-90 dark:text-white">
            Outbox<span style={{ color: themeColor }}>Lab</span>
          </span>
        </Link>

        <div className="mx-1 hidden h-5 w-px bg-black/10 dark:bg-white/15 sm:block" />

        {/* Section links */}
        <div className="hidden items-center gap-1 sm:flex">
          {NAV_ITEMS.map((item, index) => {
            const isHovered = hoveredIndex === index;
            return (
              <a
                key={item.name}
                href={item.href}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="relative z-10 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-zinc-600 transition-all duration-200 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                style={{ color: isHovered ? themeColor : undefined }}
              >
                <item.icon
                  className="relative z-10 h-3.5 w-3.5"
                  style={{ color: isHovered ? themeColor : undefined }}
                />
                <span className="relative z-10">{item.name}</span>
              </a>
            );
          })}
        </div>

        <div className="mx-1 hidden h-5 w-px bg-black/10 dark:bg-white/15 sm:block" />

        {/* CTA */}
        <Link
          href={user ? "/dashboard" : "/login"}
          className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition-transform hover:scale-105"
          style={{
            backgroundColor: themeColor,
            color: themeColor.toLowerCase() === "#ffffff" ? "#000" : "#fff",
          }}
        >
          <LogIn className="h-3.5 w-3.5" />
          {user ? "Dashboard" : "Sign in"}
        </Link>
      </nav>
    </motion.header>
  );
}
