import { z } from 'zod';

export const campaignIdParam = z.object({
  id: z.string().uuid('Invalid campaign id'),
});

const varValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const recipientSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  vars: z.record(varValue).default({}),
});

export const createCampaignSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    senderId: z.string().uuid('Pick a sender mailbox'),
    subjectTemplate: z.string().trim().min(1).max(300),
    bodyTemplate: z.string().trim().min(1).max(20_000),

    /** Defaults to "now" so the quickest path is a single click. */
    startAt: z.coerce.date().optional(),

    /** Minimum spacing applied when laying out the schedule. */
    delayBetweenEmailsMs: z.coerce.number().int().min(0).max(24 * 3_600_000).default(0),

    /** Per-sender cap for this campaign; falls back to the sender's own cap. */
    hourlyLimit: z.coerce.number().int().min(1).max(100_000).optional(),

    /** Structured recipients (used by the dashboard). */
    recipients: z.array(recipientSchema).max(50_000).optional(),

    /**
     * Raw CSV text (used from Postman / curl). Must contain a header row with
     * an address column named email, to, address or recipient; every other
     * column becomes a template variable for that row.
     */
    csv: z.string().max(5_000_000).optional(),
  })
  .refine((value) => Boolean(value.recipients?.length) || Boolean(value.csv?.trim()), {
    message: 'Provide either a recipients array or CSV text',
    path: ['recipients'],
  });

export const listCampaignsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum(['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED'])
    .optional(),
});

export const previewScheduleSchema = z.object({
  startAt: z.coerce.date().optional(),
  delayBetweenEmailsMs: z.coerce.number().int().min(0).max(24 * 3_600_000).default(0),
  hourlyLimit: z.coerce.number().int().min(1).max(100_000),
  recipientCount: z.coerce.number().int().min(1).max(50_000),
  minDelayMs: z.coerce.number().int().min(0).max(3_600_000).default(0),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuery>;
export type PreviewScheduleInput = z.infer<typeof previewScheduleSchema>;
