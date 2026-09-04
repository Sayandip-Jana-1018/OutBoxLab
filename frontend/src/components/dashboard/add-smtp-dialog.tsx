"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X, Server, ShieldCheck, ExternalLink, Info } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useThemeColor } from "@/context/theme-context";
import { Button, Field, Input } from "@/components/ui/primitives";
import { Portal } from "@/components/ui/portal";
import { cn } from "@/lib/utils";

/**
 * Mirrors backend/src/modules/senders/senders.schemas.ts so the client rejects
 * exactly what the API would.
 */
const schema = z.object({
  label: z.string().trim().min(2, "At least 2 characters").max(60),
  fromName: z.string().trim().min(2, "At least 2 characters").max(80),
  fromEmail: z.string().trim().toLowerCase().email("Enter a valid address"),
  smtpHost: z.string().trim().min(1, "Required"),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpUser: z.string().trim().min(1, "Required"),
  smtpPassword: z.string().min(1, "Required"),
  hourlyLimit: z.coerce.number().int().min(1).max(100_000),
  minDelayMs: z.coerce.number().int().min(0).max(3_600_000),
});

type FormValues = z.infer<typeof schema>;

interface Preset {
  id: string;
  name: string;
  host: string;
  port: number;
  note: string;
  helpUrl?: string;
  helpLabel?: string;
  /** Sensible starting throughput for this provider. */
  hourlyLimit: number;
  minDelayMs: number;
}

const PRESETS: Preset[] = [
  {
    id: "gmail",
    name: "Gmail",
    host: "smtp.gmail.com",
    port: 587,
    note: "Needs an App Password, not your normal password. Turn on 2-Step Verification first, then generate one. Free accounts allow roughly 500 recipients a day.",
    helpUrl: "https://myaccount.google.com/apppasswords",
    helpLabel: "Generate an App Password",
    hourlyLimit: 20,
    minDelayMs: 5000,
  },
  {
    id: "outlook",
    name: "Outlook",
    host: "smtp-mail.outlook.com",
    port: 587,
    note: "Microsoft accounts also require an app password when 2FA is enabled.",
    hourlyLimit: 20,
    minDelayMs: 5000,
  },
  {
    id: "brevo",
    name: "Brevo",
    host: "smtp-relay.brevo.com",
    port: 587,
    note: "Free tier sends 300 a day. The SMTP key from the dashboard is the password - not your login password.",
    helpUrl: "https://app.brevo.com/settings/keys/smtp",
    helpLabel: "Get your SMTP key",
    hourlyLimit: 50,
    minDelayMs: 2000,
  },
  {
    id: "custom",
    name: "Custom",
    host: "",
    port: 587,
    note: "Any SMTP server. Port 587 uses STARTTLS; choose 465 only if your provider requires implicit TLS.",
    hourlyLimit: 20,
    minDelayMs: 3000,
  },
];

export function AddSmtpDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const { themeColor } = useThemeColor();
  const [preset, setPreset] = React.useState<Preset>(PRESETS[0]);
  const [submitting, setSubmitting] = React.useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      label: "Gmail",
      fromName: "",
      fromEmail: "",
      smtpHost: PRESETS[0].host,
      smtpPort: PRESETS[0].port,
      smtpUser: "",
      smtpPassword: "",
      hourlyLimit: PRESETS[0].hourlyLimit,
      minDelayMs: PRESETS[0].minDelayMs,
    },
  });

  /**
   * Gmail, Outlook and most providers refuse to send as an address other than
   * the authenticated account - the message is rejected with 553-5.7.508, or
   * silently rewritten. Catching it here beats discovering it from an SMTP
   * error after the campaign is already scheduled.
   */
  const fromEmail = watch("fromEmail")?.trim().toLowerCase();
  const smtpUser = watch("smtpUser")?.trim().toLowerCase();
  const identityMismatch =
    Boolean(fromEmail) &&
    Boolean(smtpUser) &&
    smtpUser.includes("@") &&
    fromEmail !== smtpUser;

  const applyPreset = (next: Preset) => {
    setPreset(next);
    setValue("label", next.name === "Custom" ? "" : next.name);
    setValue("smtpHost", next.host);
    setValue("smtpPort", next.port);
    setValue("hourlyLimit", next.hourlyLimit);
    setValue("minDelayMs", next.minDelayMs);
  };

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Stop the page scrolling behind the overlay.
  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);


  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      // Port 465 is implicit TLS; 587 is STARTTLS, which nodemailer expects
      // with secure=false.
      const smtpSecure = Number(values.smtpPort) === 465;

      /**
       * Google presents an App Password as four space-separated groups
       * ("abcd efgh ijkl mnop") and most people paste exactly that, but the
       * secret is the sixteen characters without the spaces. Sent verbatim it
       * fails authentication, and the resulting SMTP error says nothing about
       * whitespace - so the shape is matched precisely and only then collapsed.
       * A password that merely contains spaces is left alone, since a custom
       * provider may legitimately use them.
       */
      const smtpPassword = /^(\S{4}\s+){3}\S{4}$/.test(values.smtpPassword)
        ? values.smtpPassword.replace(/\s+/g, "")
        : values.smtpPassword;

      await api.senders.create({ ...values, smtpPassword, smtpSecure });

      toast.success(
        "Mailbox added",
        "Now press Verify SMTP on the card to confirm the credentials authenticate.",
      );
      reset();
      onCreated();
      onClose();
    } catch (err) {
      toast.error(
        "Could not add mailbox",
        err instanceof ApiError ? err.message : "Unexpected error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Portal>
      <AnimatePresence>
        {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[150] flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-md dark:bg-black/65"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 14 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Add an SMTP mailbox"
            className="liquid-glass liquid-glass-strong max-h-[88vh] w-full max-w-3xl no-scrollbar overflow-y-auto p-6 sm:p-8"
          >
            <div className="mb-5 flex flex-col items-center text-center">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-2xl border"
                style={{
                  color: themeColor,
                  borderColor: `${themeColor}44`,
                  backgroundColor: `${themeColor}14`,
                }}
              >
                <Server className="h-5 w-5" />
              </div>
              <h2 className="mt-3 font-serif text-lg font-bold text-zinc-900 dark:text-white">
                Add an SMTP mailbox
              </h2>
              <p className="mt-1.5 max-w-sm font-sans text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Unlike Ethereal, a real SMTP mailbox actually delivers. Mail sent through it
                reaches the recipient&apos;s inbox.
              </p>
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute right-5 top-5 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Provider presets */}
            <div className="mb-5 flex flex-wrap justify-center gap-2">
              {PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyPreset(item)}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-[11px] font-bold transition-all",
                    preset.id === item.id
                      ? "text-white shadow-md"
                      : "border-black/10 text-zinc-500 hover:text-zinc-900 dark:border-white/10 dark:hover:text-white",
                  )}
                  style={
                    preset.id === item.id
                      ? { backgroundColor: themeColor, borderColor: themeColor }
                      : undefined
                  }
                >
                  {item.name}
                </button>
              ))}
            </div>

            <div className="mx-auto mb-5 max-w-2xl rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 text-center">
              <Info className="mx-auto mb-2 h-4 w-4 text-sky-400" />
              <div className="min-w-0">
                <p className="font-sans text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {preset.note}
                </p>
                {preset.helpUrl && (
                  <a
                    href={preset.helpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center justify-center gap-1 font-sans text-[11px] font-bold text-sky-400 hover:underline"
                  >
                    {preset.helpLabel} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
              {/* Two semantic groups side by side: who the mail claims to be
                  from, and how we connect to send it. Stacking all eight
                  fields in one column made the dialog a narrow scroll. */}
              <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
                <div className="space-y-4">
                  <h3 className="text-center font-sans text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                    Identity
                  </h3>

                  <Field label="Label" htmlFor="label" error={errors.label?.message} center>
                    <Input id="label" placeholder="My Gmail" {...register("label")} />
                  </Field>

                  <Field
                    label="From name"
                    htmlFor="fromName"
                    error={errors.fromName?.message}
                    center
                  >
                    <Input id="fromName" placeholder="Sayandip Jana" {...register("fromName")} />
                  </Field>

                  <Field
                    label="From address"
                    htmlFor="fromEmail"
                    hint="must match the account"
                    error={errors.fromEmail?.message}
                    center
                  >
                    <Input
                      id="fromEmail"
                      type="email"
                      placeholder="you@gmail.com"
                      autoComplete="off"
                      {...register("fromEmail")}
                    />
                  </Field>
                </div>

                <div className="space-y-4">
                  <h3 className="text-center font-sans text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                    Connection
                  </h3>

                  <div className="grid gap-3 grid-cols-[1fr_96px]">
                    <Field
                      label="SMTP host"
                      htmlFor="smtpHost"
                      error={errors.smtpHost?.message}
                      center
                    >
                      <Input id="smtpHost" placeholder="smtp.gmail.com" {...register("smtpHost")} />
                    </Field>
                    <Field label="Port" htmlFor="smtpPort" error={errors.smtpPort?.message} center>
                      <Input
                        id="smtpPort"
                        type="number"
                        className="text-center"
                        {...register("smtpPort")}
                      />
                    </Field>
                  </div>

                  <Field
                    label="Username"
                    htmlFor="smtpUser"
                    error={errors.smtpUser?.message}
                    center
                  >
                    <Input
                      id="smtpUser"
                      placeholder="you@gmail.com"
                      autoComplete="off"
                      {...register("smtpUser")}
                    />
                  </Field>

                  <Field
                    label="Password"
                    htmlFor="smtpPassword"
                    hint="app password"
                    error={errors.smtpPassword?.message}
                    center
                  >
                    <Input
                      id="smtpPassword"
                      type="password"
                      placeholder="16-character app password"
                      autoComplete="new-password"
                      {...register("smtpPassword")}
                    />
                  </Field>
                </div>
              </div>

              {/* Throughput spans the full width - it applies to the mailbox as
                  a whole, not to either group above. */}
              <div className="border-t border-black/10 pt-4 dark:border-white/10">
                <h3 className="mb-3 text-center font-sans text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                  Throughput
                </h3>
                <div className="mx-auto grid max-w-md gap-4 sm:grid-cols-2">
                  <Field
                    label="Cap per window"
                    htmlFor="hourlyLimit"
                    error={errors.hourlyLimit?.message}
                    center
                  >
                    <Input
                      id="hourlyLimit"
                      type="number"
                      className="text-center"
                      {...register("hourlyLimit")}
                    />
                  </Field>
                  <Field
                    label="Min gap"
                    htmlFor="minDelayMs"
                    hint="ms"
                    error={errors.minDelayMs?.message}
                    center
                  >
                    <Input
                      id="minDelayMs"
                      type="number"
                      className="text-center"
                      {...register("minDelayMs")}
                    />
                  </Field>
                </div>
              </div>

              {identityMismatch && (
                <div className="mx-auto max-w-xl rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-center">
                  <p className="font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-rose-400">
                    From address does not match the account
                  </p>
                  <p className="mt-1.5 font-sans text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                    You are authenticating as{" "}
                    <strong className="font-semibold">{smtpUser}</strong> but sending as{" "}
                    <strong className="font-semibold">{fromEmail}</strong>. Most providers reject
                    that. The From address is your own account - the person you are writing to goes
                    in Compose, under Recipients.
                  </p>
                  <button
                    type="button"
                    onClick={() => setValue("fromEmail", smtpUser, { shouldValidate: true })}
                    className="mt-2 font-sans text-[11px] font-bold text-rose-400 hover:underline"
                  >
                    Use {smtpUser} as the From address
                  </button>
                </div>
              )}

              <p className="mx-auto max-w-xl rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-center font-sans text-[11px] leading-relaxed text-amber-300">
                This credential is stored unencrypted in your local database. Use an app password
                you can revoke, never your account password.
              </p>

              <div className="flex justify-center gap-3">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={submitting}
                  icon={<ShieldCheck className="h-4 w-4" />}
                >
                  Add mailbox
                </Button>
              </div>
            </form>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  );
}
