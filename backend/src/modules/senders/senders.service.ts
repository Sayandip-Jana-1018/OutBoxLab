import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { badRequest, notFound } from '../../lib/errors';
import { createEtherealAccount, verifySender } from '../../services/mailer';
import { peekRateLimit } from '../../queue/rateLimiter';
import { peekSendSlot } from '../../queue/pacer';
import type {
  CreateEtherealSenderInput,
  CreateSenderInput,
  UpdateSenderInput,
} from './senders.schemas';

/**
 * SMTP passwords are never returned to the client. Every read path goes
 * through this projection so a credential cannot leak by accident when a new
 * endpoint is added later.
 */
const senderSelect = {
  id: true,
  label: true,
  fromName: true,
  fromEmail: true,
  provider: true,
  smtpHost: true,
  smtpPort: true,
  smtpUser: true,
  smtpSecure: true,
  hourlyLimit: true,
  minDelayMs: true,
  isActive: true,
  lastVerified: true,
  previewBase: true,
  createdAt: true,
} as const;

export async function listSenders(userId: string) {
  const senders = await prisma.sender.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: senderSelect,
  });

  // Attach live quota usage so the dashboard can show each mailbox's headroom
  // without a second round of requests.
  return Promise.all(
    senders.map(async (sender) => {
      const [quota, nextSlot] = await Promise.all([
        peekRateLimit(sender.id, sender.hourlyLimit),
        peekSendSlot(sender.id),
      ]);

      return {
        ...sender,
        quota: {
          used: quota.count,
          limit: quota.limit,
          remaining: quota.remaining,
          windowMs: quota.windowMs,
          resetsAt: new Date(quota.retryAtMs).toISOString(),
        },
        nextSendSlotAt: nextSlot ? new Date(nextSlot).toISOString() : null,
      };
    }),
  );
}

export async function getSenderOrThrow(userId: string, senderId: string) {
  const sender = await prisma.sender.findFirst({
    where: { id: senderId, userId },
  });
  if (!sender) throw notFound('Sender');
  return sender;
}

export async function createSender(userId: string, input: CreateSenderInput) {
  return prisma.sender.create({
    data: {
      userId,
      label: input.label,
      fromName: input.fromName,
      fromEmail: input.fromEmail,
      provider: 'SMTP',
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpUser: input.smtpUser,
      smtpPassword: input.smtpPassword,
      smtpSecure: input.smtpSecure,
      hourlyLimit: input.hourlyLimit ?? env.DEFAULT_HOURLY_LIMIT,
      minDelayMs: input.minDelayMs ?? env.DEFAULT_MIN_DELAY_MS,
    },
    select: senderSelect,
  });
}

/**
 * One-click mailbox provisioning.
 *
 * This is the endpoint that makes the project self-contained: a reviewer with
 * no SMTP credentials can create a working sender and watch real messages land
 * in a real (sandboxed) inbox with a shareable preview link.
 */
export async function createEtherealSender(
  userId: string,
  input: CreateEtherealSenderInput,
) {
  const account = await createEtherealAccount();

  return prisma.sender.create({
    data: {
      userId,
      label: input.label,
      fromName: 'OutboxLab',
      fromEmail: account.user,
      provider: 'ETHEREAL',
      smtpHost: account.host,
      smtpPort: account.port,
      smtpUser: account.user,
      smtpPassword: account.password,
      smtpSecure: account.secure,
      previewBase: account.previewBase,
      hourlyLimit: input.hourlyLimit ?? env.DEFAULT_HOURLY_LIMIT,
      minDelayMs: input.minDelayMs ?? env.DEFAULT_MIN_DELAY_MS,
      lastVerified: new Date(),
    },
    select: senderSelect,
  });
}

export async function updateSender(
  userId: string,
  senderId: string,
  input: UpdateSenderInput,
) {
  await getSenderOrThrow(userId, senderId);

  return prisma.sender.update({
    where: { id: senderId },
    data: input,
    select: senderSelect,
  });
}

export async function deleteSender(userId: string, senderId: string) {
  await getSenderOrThrow(userId, senderId);

  // Refuse to orphan work that is still in flight; the cascade would delete
  // rows that the queue still holds jobs for.
  const inFlight = await prisma.scheduledEmail.count({
    where: {
      senderId,
      status: { in: ['SCHEDULED', 'PROCESSING', 'DEFERRED'] },
    },
  });

  if (inFlight > 0) {
    throw badRequest(
      `This mailbox still has ${inFlight} email(s) in flight. Cancel them first, or deactivate the mailbox instead of deleting it.`,
    );
  }

  await prisma.sender.delete({ where: { id: senderId } });
}

export async function verifySenderCredentials(userId: string, senderId: string) {
  const sender = await getSenderOrThrow(userId, senderId);
  const ok = await verifySender(sender);

  if (ok) {
    await prisma.sender.update({
      where: { id: senderId },
      data: { lastVerified: new Date() },
    });
  }

  return { verified: ok };
}
