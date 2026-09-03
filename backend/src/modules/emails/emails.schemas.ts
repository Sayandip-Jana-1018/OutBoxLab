import { z } from 'zod';

export const emailIdParam = z.object({
  id: z.string().uuid('Invalid email id'),
});

export const EMAIL_STATUSES = [
  'SCHEDULED',
  'PROCESSING',
  'DEFERRED',
  'SENT',
  'FAILED',
  'CANCELLED',
] as const;

/**
 * `view` is a convenience grouping used by the two dashboard tables:
 *   pending -> everything still owed a delivery attempt
 *   history -> everything that has finished, one way or another
 * An explicit `status` list always wins over `view`.
 */
export const listEmailsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  view: z.enum(['all', 'pending', 'history']).default('all'),
  status: z
    .union([z.enum(EMAIL_STATUSES), z.array(z.enum(EMAIL_STATUSES))])
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      return Array.isArray(value) ? value : [value];
    }),
  campaignId: z.string().uuid().optional(),
  senderId: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['sendAt', 'createdAt', 'relevance']).default('sendAt'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const rescheduleEmailSchema = z.object({
  sendAt: z.coerce.date(),
});

export type ListEmailsQuery = z.infer<typeof listEmailsQuery>;
export type RescheduleEmailInput = z.infer<typeof rescheduleEmailSchema>;
