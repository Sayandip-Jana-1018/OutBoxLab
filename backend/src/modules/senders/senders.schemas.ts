import { z } from 'zod';

export const senderIdParam = z.object({
  id: z.string().uuid('Invalid sender id'),
});

export const createSenderSchema = z.object({
  label: z.string().trim().min(2).max(60),
  fromName: z.string().trim().min(2).max(80),
  fromEmail: z.string().trim().toLowerCase().email(),
  smtpHost: z.string().trim().min(1),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
  smtpUser: z.string().trim().min(1),
  smtpPassword: z.string().min(1),
  smtpSecure: z.boolean().default(false),
  hourlyLimit: z.coerce.number().int().min(1).max(100_000).optional(),
  minDelayMs: z.coerce.number().int().min(0).max(3_600_000).optional(),
});

export const createEtherealSenderSchema = z.object({
  label: z.string().trim().min(2).max(60).default('Ethereal mailbox'),
  hourlyLimit: z.coerce.number().int().min(1).max(100_000).optional(),
  minDelayMs: z.coerce.number().int().min(0).max(3_600_000).optional(),
});

export const updateSenderSchema = z
  .object({
    label: z.string().trim().min(2).max(60).optional(),
    fromName: z.string().trim().min(2).max(80).optional(),
    hourlyLimit: z.coerce.number().int().min(1).max(100_000).optional(),
    minDelayMs: z.coerce.number().int().min(0).max(3_600_000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export type CreateSenderInput = z.infer<typeof createSenderSchema>;
export type CreateEtherealSenderInput = z.infer<typeof createEtherealSenderSchema>;
export type UpdateSenderInput = z.infer<typeof updateSenderSchema>;
