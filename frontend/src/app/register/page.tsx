"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { ArrowRight, Mail, Lock, User as UserIcon } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { useThemeColor } from "@/context/theme-context";
import { useToast } from "@/components/ui/toast";
import { AppBackground } from "@/components/dashboard/app-background";
import { Button, Field, Input } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";

// Mirrors backend/src/modules/auth/auth.schemas.ts so the client rejects the
// same input the server would.
const schema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const { register: signUp, user, loading } = useAuth();
  const { themeColor } = useThemeColor();
  const toast = useToast();
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "" },
  });

  React.useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      await signUp(values.name, values.email, values.password);
      toast.success("Account created", "Add a mailbox to start scheduling");
      router.push("/dashboard/senders");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      toast.error("Could not create account", message);
    } finally {
      setSubmitting(false);
    }
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
              Create account
            </h1>
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
              You can provision an Ethereal mailbox in one click afterwards
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <Field label="Name" htmlFor="name" error={errors.name?.message}>
              <div className="relative">
                <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input
                  id="name"
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  className="pl-9"
                  {...register("name")}
                />
              </div>
            </Field>

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

            <Field
              label="Password"
              htmlFor="password"
              hint="min 8 characters"
              error={errors.password?.message}
            >
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Choose a password"
                  className="pl-9"
                  {...register("password")}
                />
              </div>
            </Field>

            <Button type="submit" size="lg" loading={submitting} className="w-full">
              Create account
              {!submitting && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold transition-opacity hover:opacity-80"
              style={{ color: themeColor }}
            >
              Sign in
            </Link>
          </p>
        </div>
      </motion.div>
    </main>
  );
}
