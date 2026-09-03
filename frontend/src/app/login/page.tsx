"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { ArrowRight, Mail, Lock, Sparkles } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { useThemeColor } from "@/context/theme-context";
import { useToast } from "@/components/ui/toast";
import { AppBackground } from "@/components/dashboard/app-background";
import { Button, Field, Input } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type FormValues = z.infer<typeof schema>;

// Matches the account created by `npm run db:seed`.
const DEMO = { email: "demo@outboxlab.dev", password: "demo1234" };

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const { themeColor } = useThemeColor();
  const toast = useToast();
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  // Already signed in -> skip the form.
  React.useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      await login(values.email, values.password);
      toast.success("Welcome back", "Signed in to OutboxLab");
      router.push("/dashboard");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      toast.error("Could not sign in", message);
    } finally {
      setSubmitting(false);
    }
  };

  const useDemo = () => {
    setValue("email", DEMO.email, { shouldValidate: true });
    setValue("password", DEMO.password, { shouldValidate: true });
    toast.info("Demo credentials filled", "Press Sign in to continue");
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <AppBackground intensity="full" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Brand */}
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <div
            className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 dark:border-white/20"
            style={{ backgroundColor: `${themeColor}22` }}
          >
            <span
              className="absolute h-2 w-2 animate-ping rounded-full"
              style={{ backgroundColor: themeColor }}
            />
            <span
              className="relative h-2 w-2 rounded-full"
              style={{ backgroundColor: themeColor }}
            />
          </div>
          <span className="font-serif text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
            Outbox<span style={{ color: themeColor }}>Lab</span>
          </span>
        </Link>

        <div className="liquid-glass liquid-glass-strong p-8 sm:p-10">
          <div className="mb-7 text-center">
            <h1 className="font-serif text-2xl font-bold text-zinc-900 dark:text-white">
              Sign in
            </h1>
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
              Access your scheduling dashboard
            </p>
          </div>

          {/* Demo shortcut - the fastest path for a reviewer */}
          <button
            type="button"
            onClick={useDemo}
            className="mb-6 flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{ borderColor: `${themeColor}44`, backgroundColor: `${themeColor}12` }}
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${themeColor}22` }}
            >
              <Sparkles className="h-4 w-4" style={{ color: themeColor }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                Use the demo account
              </p>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {DEMO.email} - seeded with two Ethereal mailboxes
              </p>
            </div>
          </button>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <Field label="Email" htmlFor="email" error={errors.email?.message}>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="pl-9"
                  {...register("email")}
                />
              </div>
            </Field>

            <Field label="Password" htmlFor="password" error={errors.password?.message}>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  className="pl-9"
                  {...register("password")}
                />
              </div>
            </Field>

            <Button type="submit" size="lg" loading={submitting} className="w-full">
              Sign in
              {!submitting && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No account yet?{" "}
            <Link
              href="/register"
              className="font-semibold transition-opacity hover:opacity-80"
              style={{ color: themeColor }}
            >
              Create one
            </Link>
          </p>
        </div>
      </motion.div>
    </main>
  );
}
