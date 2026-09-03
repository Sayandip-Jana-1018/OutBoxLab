"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Upload,
  Sparkles,
  Send,
  FileText,
  AlertCircle,
  CheckCircle2,
  Users,
  Clock,
  Gauge,
  Eye,
  Plus,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useThemeColor } from "@/context/theme-context";
import { PageHeader } from "@/components/ui/page-header";
import { Button, Field, Input, Textarea, Skeleton } from "@/components/ui/primitives";
import {
  extractTemplateVars,
  formatDateTime,
  formatDuration,
  formatNumber,
  parseCsv,
  renderTemplate,
  type ParsedCsv,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ScheduleForecast, Sender } from "@/lib/types";

interface Recipient {
  email: string;
  vars: Record<string, string>;
}

const SAMPLE_CSV = `email,name,company
ada@example.com,Ada,Analytical Engines
grace@example.com,Grace,Compiler Co
alan@example.com,Alan,Bletchley Labs`;

export default function ComposePage() {
  const router = useRouter();
  const toast = useToast();
  const { themeColor } = useThemeColor();

  const [senders, setSenders] = React.useState<Sender[]>([]);
  const [loadingSenders, setLoadingSenders] = React.useState(true);
  const [provisioning, setProvisioning] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const [senderId, setSenderId] = React.useState("");
  const [name, setName] = React.useState("");
  const [subject, setSubject] = React.useState("Hello {{name}}, a quick note");
  const [body, setBody] = React.useState(
    "Hi {{name}},\n\nThis message was scheduled by OutboxLab and delivered by a background worker.\n\nBest,\nThe OutboxLab team",
  );

  const [recipients, setRecipients] = React.useState<Recipient[]>([]);
  const [csvReport, setCsvReport] = React.useState<ParsedCsv | null>(null);
  const [manualEmail, setManualEmail] = React.useState("");
  const [dragging, setDragging] = React.useState(false);

  const [startAt, setStartAt] = React.useState("");
  const [delayMs, setDelayMs] = React.useState(2000);
  const [hourlyLimit, setHourlyLimit] = React.useState<number | "">("");

  /** Ethereal mailboxes can be generated without limit, so the picker shows a
   * fixed number and collapses the rest behind a toggle - otherwise the list
   * grows unbounded and the page loses its symmetry. */
  const [showAllSenders, setShowAllSenders] = React.useState(false);
  const VISIBLE_SENDERS = 6;

  const [forecast, setForecast] = React.useState<ScheduleForecast | null>(null);
  const [forecasting, setForecasting] = React.useState(false);

  const selectedSender = senders.find((s) => s.id === senderId) ?? null;

  // --- Load mailboxes ------------------------------------------------------
  const loadSenders = React.useCallback(async () => {
    try {
      const { senders } = await api.senders.list();
      setSenders(senders);
      setSenderId((current) => current || senders.find((s) => s.isActive)?.id || "");
    } catch {
      toast.error("Could not load mailboxes");
    } finally {
      setLoadingSenders(false);
    }
    // toast is stable from context
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    void loadSenders();
  }, [loadSenders]);

  // Default the campaign cap to the selected mailbox's own cap.
  React.useEffect(() => {
    if (selectedSender && hourlyLimit === "") setHourlyLimit(selectedSender.hourlyLimit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSender?.id]);

  const provisionEthereal = async () => {
    setProvisioning(true);
    try {
      const { sender } = await api.senders.createEthereal("Ethereal mailbox");
      toast.success("Mailbox ready", `Provisioned ${sender.fromEmail}`);
      await loadSenders();
      setSenderId(sender.id);
    } catch (err) {
      toast.error(
        "Could not provision mailbox",
        err instanceof ApiError ? err.message : "Unexpected error",
      );
    } finally {
      setProvisioning(false);
    }
  };

  // --- CSV -----------------------------------------------------------------
  const ingestCsv = React.useCallback(
    (text: string) => {
      const report = parseCsv(text);
      setCsvReport(report);

      if (report.valid.length === 0) {
        toast.error(
          "No valid recipients",
          report.addressColumn
            ? "Every row failed validation."
            : "The CSV needs a column named email, to, address or recipient.",
        );
        return;
      }

      setRecipients(report.valid);
      toast.success(
        `${report.valid.length} recipient${report.valid.length === 1 ? "" : "s"} loaded`,
        report.invalid.length || report.duplicates.length
          ? `${report.invalid.length} invalid, ${report.duplicates.length} duplicate removed`
          : undefined,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onFile = (file: File) => {
    if (!file.name.match(/\.(csv|txt)$/i)) {
      toast.error("Unsupported file", "Drop a .csv file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => ingestCsv(String(reader.result ?? ""));
    reader.onerror = () => toast.error("Could not read that file");
    reader.readAsText(file);
  };

  const addManual = () => {
    const email = manualEmail.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(email)) {
      toast.error("Invalid email", email);
      return;
    }
    if (recipients.some((r) => r.email === email)) {
      toast.info("Already added", email);
      return;
    }
    setRecipients((prev) => [...prev, { email, vars: {} }]);
    setManualEmail("");
  };

  // --- Template variables --------------------------------------------------
  const usedVars = React.useMemo(
    () => [...new Set([...extractTemplateVars(subject), ...extractTemplateVars(body)])],
    [subject, body],
  );
  const availableVars = React.useMemo(() => {
    const set = new Set<string>(["email"]);
    recipients.forEach((r) => Object.keys(r.vars).forEach((k) => set.add(k)));
    return [...set];
  }, [recipients]);
  const missingVars = usedVars.filter((v) => !availableVars.includes(v));

  const previewRecipient = recipients[0];
  const previewVars = previewRecipient
    ? { ...previewRecipient.vars, email: previewRecipient.email }
    : { name: "Ada", email: "ada@example.com", company: "Analytical Engines" };

  // --- Schedule forecast ---------------------------------------------------
  React.useEffect(() => {
    if (recipients.length === 0 || !selectedSender || hourlyLimit === "") {
      setForecast(null);
      return;
    }

    setForecasting(true);
    const timer = setTimeout(async () => {
      try {
        const result = await api.campaigns.preview({
          recipientCount: recipients.length,
          hourlyLimit: Number(hourlyLimit),
          delayBetweenEmailsMs: delayMs,
          minDelayMs: selectedSender.minDelayMs,
          startAt: startAt ? new Date(startAt).toISOString() : undefined,
        });
        setForecast(result);
      } catch {
        setForecast(null);
      } finally {
        setForecasting(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [recipients.length, selectedSender, hourlyLimit, delayMs, startAt]);

  // --- Submit --------------------------------------------------------------
  const canSubmit =
    senderId && name.trim().length >= 2 && subject.trim() && body.trim() && recipients.length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await api.campaigns.create({
        name: name.trim(),
        senderId,
        subjectTemplate: subject,
        bodyTemplate: body,
        startAt: startAt ? new Date(startAt).toISOString() : undefined,
        delayBetweenEmailsMs: delayMs,
        hourlyLimit: hourlyLimit === "" ? undefined : Number(hourlyLimit),
        recipients: recipients.map((r) => ({ email: r.email, vars: r.vars })),
      });

      toast.success(
        `Scheduled ${formatNumber(result.scheduled)} emails`,
        `First send ${formatDateTime(result.firstSendAt)}`,
      );
      router.push(`/dashboard/campaigns/${result.campaign.id}`);
    } catch (err) {
      toast.error(
        "Could not schedule campaign",
        err instanceof ApiError ? err.message : "Unexpected error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="New campaign"
        title="Compose"
        description="Build a campaign, drop in recipients, and see exactly when each email will land - including the throttling the mailbox cap will cause - before you commit."
      />

      <div className="space-y-6">
        {/* Row 1 - the mailbox picker spans the full width, since it is
            the choice every section below depends on. */}
          {/* Mailbox */}
          <section className="liquid-glass p-6">
            <div className="mb-5 flex flex-col items-center gap-3">
              <h2 className="flex items-center justify-center gap-2 font-serif text-base font-bold text-zinc-900 dark:text-white">
                <Users className="h-4 w-4" style={{ color: themeColor }} />
                Sending mailbox
              </h2>
              <Button
                size="sm"
                variant="outline"
                loading={provisioning}
                onClick={provisionEthereal}
                icon={<Sparkles className="h-3.5 w-3.5" />}
              >
                Generate Ethereal mailbox
              </Button>
            </div>

            {loadingSenders ? (
              <Skeleton className="h-20 w-full" />
            ) : senders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/15 p-6 text-center dark:border-white/15">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  No mailboxes yet
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Generate a sandboxed Ethereal mailbox - no SMTP credentials needed.
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-3">
                {(showAllSenders ? senders : senders.slice(0, VISIBLE_SENDERS)).map((sender) => {
                  const active = sender.id === senderId;
                  return (
                    <button
                      key={sender.id}
                      onClick={() => setSenderId(sender.id)}
                      disabled={!sender.isActive}
                      className={cn(
                        "w-full rounded-2xl border p-4 text-center transition-all disabled:opacity-50 sm:w-[262px]",
                        active
                          ? "shadow-md"
                          : "border-black/10 bg-black/[0.02] hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/5",
                      )}
                      style={
                        active
                          ? { borderColor: themeColor, backgroundColor: `${themeColor}12` }
                          : undefined
                      }
                    >
                      <div className="flex items-center justify-center gap-2">
                        <span className="truncate text-sm font-semibold text-zinc-900 dark:text-white">
                          {sender.label}
                        </span>
                        {active && (
                          <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: themeColor }} />
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">{sender.fromEmail}</p>
                      <p className="mt-2 text-[11px] text-zinc-500">
                        Cap {sender.hourlyLimit}/window &middot; {sender.minDelayMs}ms gap &middot;{" "}
                        {sender.quota.remaining} left
                      </p>
                    </button>
                  );
                })}
              </div>
            )}

            {senders.length > VISIBLE_SENDERS && (
              <div className="mt-4 flex justify-center">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowAllSenders((v) => !v)}
                >
                  {showAllSenders
                    ? "Show fewer"
                    : `Show all ${senders.length} mailboxes`}
                </Button>
              </div>
            )}
          </section>

        {/* Row 2 - what you write, beside what it will look like. */}
        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          {/* Message */}
          <section className="liquid-glass h-full space-y-5 p-6">
            <h2 className="flex items-center justify-center gap-2 font-serif text-base font-bold text-zinc-900 dark:text-white">
              <FileText className="h-4 w-4" style={{ color: themeColor }} />
              Message
            </h2>

            <Field label="Campaign name" htmlFor="campaign-name" center>
              <Input
                id="campaign-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="October product update"
              />
            </Field>

            <Field label="Subject" htmlFor="subject" center>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Hello {{name}}"
              />
            </Field>

            <Field label="Body" htmlFor="body" hint="plain text, {{variables}} supported" center>
              <Textarea
                id="body"
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>

            {/* Variable chips */}
            {availableVars.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-zinc-500">Available:</span>
                {availableVars.map((v) => (
                  <button
                    key={v}
                    onClick={() => setBody((b) => `${b}{{${v}}}`)}
                    className="rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition-colors hover:opacity-80"
                    style={{
                      borderColor: `${themeColor}44`,
                      backgroundColor: `${themeColor}12`,
                      color: themeColor,
                    }}
                    title={`Insert {{${v}}} into the body`}
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            )}

            {missingVars.length > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  <strong>{missingVars.join(", ")}</strong> {missingVars.length === 1 ? "is" : "are"}{" "}
                  used in the template but not present in your recipient data. Missing values render
                  as empty text.
                </p>
              </div>
            )}
          </section>

          {/* Live preview */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="liquid-glass h-full p-6"
          >
            <h2 className="mb-4 flex items-center justify-center gap-2 font-serif text-base font-bold text-zinc-900 dark:text-white">
              <Eye className="h-4 w-4" style={{ color: themeColor }} />
              Live preview
            </h2>
            <div className="liquid-well w-full p-5 text-left">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                To
              </p>
              <p className="mb-3 truncate text-sm font-medium text-zinc-900 dark:text-white">
                {previewRecipient?.email ?? "ada@example.com"}
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Subject
              </p>
              <p className="mb-3 break-words text-sm font-semibold text-zinc-900 dark:text-white">
                {renderTemplate(subject, previewVars) || (
                  <span className="text-zinc-400">(empty)</span>
                )}
              </p>
              <div className="h-px bg-black/10 dark:bg-white/10" />
              <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                {renderTemplate(body, previewVars)}
              </pre>
            </div>
            {!previewRecipient && (
              <p className="mt-2 text-[11px] text-zinc-500">
                Showing sample data. Add recipients to preview a real one.
              </p>
            )}
          </motion.section>
        </div>

        {/* Row 3 - how fast it goes out, beside who it goes to. */}
        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          {/* Timing */}
          <section className="liquid-glass h-full space-y-5 p-6">
            <h2 className="flex items-center justify-center gap-2 font-serif text-base font-bold text-zinc-900 dark:text-white">
              <Clock className="h-4 w-4" style={{ color: themeColor }} />
              Timing &amp; throughput
            </h2>

            {/* Start time gets its own row: a datetime input is far wider than
                a number field, and squeezing all three across made every label
                wrap onto two lines. */}
            <div className="liquid-well p-4">
              <label
                htmlFor="start-at"
                className="block text-center font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500"
              >
                Start at
              </label>
              <Input
                id="start-at"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="mt-2 text-center"
              />
              <p className="mt-2 text-center font-sans text-[10px] text-zinc-400">
                Leave blank to start immediately
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="liquid-well p-4">
                <label
                  htmlFor="delay"
                  className="block text-center font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500"
                >
                  Gap
                </label>
                <div className="relative mt-2">
                  <Input
                    id="delay"
                    type="number"
                    min={0}
                    step={500}
                    value={delayMs}
                    onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value)))}
                    className="pr-10 text-center font-serif text-lg font-bold"
                  />
                  <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-sans text-[10px] font-semibold text-zinc-400">
                    ms
                  </span>
                </div>
                <p className="mt-2 text-center font-sans text-[10px] text-zinc-400">
                  Between two sends
                </p>
              </div>

              <div className="liquid-well p-4">
                <label
                  htmlFor="cap"
                  className="block text-center font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500"
                >
                  Cap
                </label>
                <Input
                  id="cap"
                  type="number"
                  min={1}
                  value={hourlyLimit}
                  onChange={(e) =>
                    setHourlyLimit(e.target.value === "" ? "" : Math.max(1, Number(e.target.value)))
                  }
                  className="mt-2 text-center font-serif text-lg font-bold"
                />
                <p className="mt-2 text-center font-sans text-[10px] text-zinc-400">
                  Per mailbox, per window
                </p>
              </div>
            </div>

            {selectedSender && delayMs < selectedSender.minDelayMs && (
              <p
                className="rounded-xl border px-3 py-2.5 text-center font-sans text-[11px] leading-relaxed"
                style={{
                  color: "#fbbf24",
                  borderColor: "#fbbf2444",
                  backgroundColor: "#fbbf2414",
                }}
              >
                This mailbox enforces a minimum {selectedSender.minDelayMs}ms gap, so the schedule
                will be laid out at {selectedSender.minDelayMs}ms.
              </p>
            )}
          </section>

          {/* Recipients */}
          <section className="liquid-glass h-full space-y-5 p-6">
            <div className="flex flex-col items-center gap-3">
              <h2 className="flex items-center justify-center gap-2 font-serif text-base font-bold text-zinc-900 dark:text-white">
                <Users className="h-4 w-4" style={{ color: themeColor }} />
                Recipients
                {recipients.length > 0 && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                    style={{ backgroundColor: `${themeColor}20`, color: themeColor }}
                  >
                    {formatNumber(recipients.length)}
                  </span>
                )}
              </h2>
              {recipients.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRecipients([]);
                    setCsvReport(null);
                  }}
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                >
                  Clear
                </Button>
              )}
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) onFile(file);
              }}
              className={cn(
                "rounded-2xl border-2 border-dashed p-6 text-center transition-colors",
                dragging
                  ? "border-solid"
                  : "border-black/15 dark:border-white/15",
              )}
              style={dragging ? { borderColor: themeColor, backgroundColor: `${themeColor}10` } : undefined}
            >
              <Upload className="mx-auto h-6 w-6 text-zinc-400" />
              <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                Drop a CSV here
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Needs an <code className="font-mono">email</code> column. Every other column becomes
                a <code className="font-mono">{"{{variable}}"}</code>.
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <label>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onFile(file);
                      e.target.value = "";
                    }}
                  />
                  <span className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-black/15 bg-white/60 px-3 text-xs font-semibold text-zinc-800 transition-colors hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10">
                    Browse files
                  </span>
                </label>
                <Button size="sm" variant="ghost" onClick={() => ingestCsv(SAMPLE_CSV)}>
                  Use sample data
                </Button>
              </div>
            </div>

            {/* CSV report */}
            {csvReport && (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
                  <p className="text-lg font-bold text-emerald-400">{csvReport.valid.length}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/80">
                    Valid
                  </p>
                </div>
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-center">
                  <p className="text-lg font-bold text-rose-400">{csvReport.invalid.length}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-400/80">
                    Invalid
                  </p>
                </div>
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-center">
                  <p className="text-lg font-bold text-amber-400">{csvReport.duplicates.length}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">
                    Duplicates
                  </p>
                </div>
              </div>
            )}

            {/* Manual add */}
            <div className="flex gap-2">
              <Input
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addManual();
                  }
                }}
                placeholder="Or add one address at a time"
                aria-label="Add a single recipient"
              />
              <Button variant="outline" onClick={addManual} icon={<Plus className="h-4 w-4" />}>
                Add
              </Button>
            </div>

            {/* Recipient preview list */}
            {recipients.length > 0 && (
              <div className="max-h-44 w-full overflow-y-auto rounded-2xl border border-black/10 dark:border-white/10">
                <table className="w-full text-left text-xs">
                  <tbody className="divide-y divide-black/5 dark:divide-white/5">
                    {recipients.slice(0, 50).map((r, i) => (
                      <tr key={r.email}>
                        <td className="px-3 py-2 font-mono text-zinc-400">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-zinc-800 dark:text-zinc-100">
                          {r.email}
                        </td>
                        <td className="px-3 py-2 text-zinc-500">
                          {Object.entries(r.vars)
                            .filter(([, v]) => v)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(", ")}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() =>
                              setRecipients((prev) => prev.filter((x) => x.email !== r.email))
                            }
                            className="rounded p-1 text-zinc-400 hover:text-rose-500"
                            aria-label={`Remove ${r.email}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {recipients.length > 50 && (
                  <p className="border-t border-black/5 px-3 py-2 text-center text-[11px] text-zinc-500 dark:border-white/5">
                    + {formatNumber(recipients.length - 50)} more
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Row 4 - the resulting schedule, beside the commit button. */}
        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          {/* Forecast */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="liquid-glass h-full p-6"
          >
            <h2 className="mb-4 flex items-center justify-center gap-2 font-serif text-base font-bold text-zinc-900 dark:text-white">
              <Gauge className="h-4 w-4" style={{ color: themeColor }} />
              Projected schedule
            </h2>

            {forecasting ? (
              <Skeleton className="h-32 w-full" />
            ) : !forecast ? (
              <p className="py-6 text-center text-xs text-zinc-500">
                Pick a mailbox and add recipients to see when each email will land.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="liquid-well p-4 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Duration
                    </p>
                    <p className="mt-0.5 text-sm font-bold text-zinc-900 dark:text-white">
                      {formatDuration(forecast.estimatedDurationMs)}
                    </p>
                  </div>
                  <div className="liquid-well p-4 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Will be throttled
                    </p>
                    <p
                      className="mt-0.5 text-sm font-bold"
                      style={{ color: forecast.deferredCount > 0 ? "#fb923c" : undefined }}
                    >
                      {formatNumber(forecast.deferredCount)}
                    </p>
                  </div>
                </div>

                <div className="liquid-well p-4 text-xs">
                  <div className="flex justify-between py-0.5">
                    <span className="text-zinc-500">First send</span>
                    <span className="font-medium text-zinc-900 dark:text-white">
                      {formatDateTime(forecast.firstSendAt)}
                    </span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-zinc-500">Last send</span>
                    <span className="font-medium text-zinc-900 dark:text-white">
                      {formatDateTime(forecast.lastSendAt)}
                    </span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-zinc-500">Windows needed</span>
                    <span className="font-medium text-zinc-900 dark:text-white">
                      {forecast.windowsRequired}
                    </span>
                  </div>
                </div>

                {/* First few sends */}
                <div className="max-h-40 w-full overflow-y-auto rounded-2xl border border-black/10 dark:border-white/10">
                  {forecast.entries.slice(0, 25).map((entry) => (
                    <div
                      key={entry.index}
                      className="flex items-center justify-between border-b border-black/5 px-3 py-1.5 text-[11px] last:border-0 dark:border-white/5"
                    >
                      <span className="font-mono text-zinc-400">#{entry.index + 1}</span>
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {formatDateTime(entry.projectedAt)}
                      </span>
                      {entry.deferred ? (
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                          style={{ backgroundColor: "#fb923c22", color: "#fb923c" }}
                        >
                          deferred
                        </span>
                      ) : (
                        <span className="text-[10px] text-emerald-400">on time</span>
                      )}
                    </div>
                  ))}
                </div>

                <p className="text-[10px] leading-relaxed text-zinc-500">{forecast.note}</p>
              </div>
            )}
          </motion.section>

          {/* Submit */}
          <div className="liquid-glass flex h-full flex-col items-center justify-center p-8">
            <Button
              size="lg"
              className="w-full"
              loading={submitting}
              disabled={!canSubmit}
              onClick={submit}
              icon={<Send className="h-4 w-4" />}
            >
              {recipients.length > 0
                ? `Schedule ${formatNumber(recipients.length)} email${recipients.length === 1 ? "" : "s"}`
                : "Schedule campaign"}
            </Button>
            {!canSubmit && (
              <p className="mt-2 text-center text-[11px] text-zinc-500">
                {!senderId
                  ? "Pick a mailbox to continue"
                  : name.trim().length < 2
                    ? "Give the campaign a name"
                    : recipients.length === 0
                      ? "Add at least one recipient"
                      : "Fill in the subject and body"}
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
