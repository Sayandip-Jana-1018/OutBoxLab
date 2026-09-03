"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "ghost" | "outline" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-xs gap-1.5 rounded-xl",
  md: "h-11 px-5 text-sm gap-2 rounded-2xl",
  lg: "h-13 px-7 py-3.5 text-sm gap-2 rounded-2xl",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const base =
    "group relative inline-flex items-center justify-center font-semibold tracking-tight transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] disabled:opacity-45 disabled:pointer-events-none active:scale-[0.97] select-none whitespace-nowrap";

  const variants: Record<ButtonVariant, string> = {
    primary:
      "sheen bg-primary text-primary-foreground shadow-[0_10px_30px_-10px_hsl(var(--primary)/0.7)] hover:shadow-[0_16px_40px_-12px_hsl(var(--primary)/0.85)] hover:-translate-y-0.5",
    danger:
      "sheen bg-rose-500 text-white shadow-[0_10px_30px_-10px_rgb(244_63_94/0.7)] hover:bg-rose-600 hover:-translate-y-0.5",
    outline:
      "border backdrop-blur-xl border-black/10 bg-white/70 text-zinc-900 hover:bg-white hover:-translate-y-0.5 dark:border-white/15 dark:bg-white/[0.07] dark:text-white dark:hover:bg-white/[0.13]",
    ghost:
      "text-zinc-600 hover:bg-black/[0.06] hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/[0.09] dark:hover:text-white",
    subtle:
      "backdrop-blur-xl bg-black/[0.05] text-zinc-800 hover:bg-black/[0.09] dark:bg-white/[0.09] dark:text-white dark:hover:bg-white/[0.15]",
  };

  return (
    <button
      className={cn(base, SIZES[size], variants[variant], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const inputClasses =
  "w-full rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 shadow-[inset_0_1px_2px_rgb(255_255_255/0.6)] backdrop-blur-xl transition-all duration-300 focus:border-primary/50 focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/15 dark:border-white/12 dark:bg-white/[0.06] dark:text-white dark:shadow-none dark:placeholder:text-zinc-500 dark:focus:bg-white/[0.1]";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputClasses, className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea ref={ref} className={cn(inputClasses, "resize-y leading-relaxed", className)} {...props} />
  );
});

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
  center = false,
}: {
  label?: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
  center?: boolean;
}) {
  return (
    <div className={cn("w-full space-y-2", className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className={cn(
            "flex items-baseline gap-2 font-sans text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400",
            center ? "justify-center" : "justify-between",
          )}
        >
          <span>{label}</span>
          {hint && (
            <span className="font-medium normal-case tracking-normal text-zinc-400 dark:text-zinc-500">
              {hint}
            </span>
          )}
        </label>
      )}
      {children}
      {error && (
        <p className={cn("text-xs font-medium text-rose-400", center && "text-center")}>{error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback states
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-2xl bg-gradient-to-r from-black/[0.06] via-black/[0.11] to-black/[0.06] dark:from-white/[0.05] dark:via-white/[0.11] dark:to-white/[0.05]",
        className,
      )}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-5 w-5 animate-spin text-primary", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-black/10 px-6 py-16 text-center dark:border-white/12">
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-black/5 bg-black/[0.04] text-zinc-400 dark:border-white/10 dark:bg-white/[0.05]">
          {icon}
        </div>
      )}
      <div>
        <p className="font-serif text-base font-bold text-zinc-800 dark:text-zinc-100">{title}</p>
        {description && (
          <p className="mx-auto mt-2 max-w-sm font-sans text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-2xl border border-black/10 bg-black/[0.04] p-1.5 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.05]",
        className,
      )}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-all duration-300",
            value === opt.value
              ? "bg-white text-zinc-900 shadow-md dark:bg-white/20 dark:text-white"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
          )}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
