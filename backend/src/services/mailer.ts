import nodemailer, { type Transporter } from 'nodemailer';
import type { Sender } from '@prisma/client';
import { subLogger } from '../lib/logger';
import { toHtmlEmail } from './template';

const log = subLogger('mailer');

export interface EtherealAccount {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  previewBase: string;
}

/**
 * Provision a throwaway Ethereal mailbox on demand.
 *
 * This is why OutboxLab needs no email credentials to evaluate: the dashboard
 * can mint a working SMTP inbox in one click, and every delivered message gets
 * a public preview URL. Ethereal accepts and stores mail but never delivers it
 * onward, which is exactly the isolation you want for a scheduler demo.
 */
export async function createEtherealAccount(): Promise<EtherealAccount> {
  const account = await nodemailer.createTestAccount();
  log.info({ user: account.user }, 'Provisioned Ethereal mailbox');

  return {
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    user: account.user,
    password: account.pass,
    previewBase: 'https://ethereal.email/message/',
  };
}

/**
 * Transports are pooled per credential set. Building a fresh transport for
 * every message would open a new TCP + TLS session per email, which becomes
 * the dominant cost under a burst and defeats the point of pacing.
 */
const transports = new Map<string, Transporter>();

type SenderCredentials = Pick<
  Sender,
  'id' | 'smtpHost' | 'smtpPort' | 'smtpUser' | 'smtpPassword' | 'smtpSecure'
>;

function transportFor(sender: SenderCredentials): Transporter {
  const cacheKey = `${sender.id}:${sender.smtpHost}:${sender.smtpPort}:${sender.smtpUser}`;
  const existing = transports.get(cacheKey);
  if (existing) return existing;

  const transport = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpSecure,
    auth: { user: sender.smtpUser, pass: sender.smtpPassword },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  transports.set(cacheKey, transport);
  return transport;
}

export interface SendEmailInput {
  sender: Pick<
    Sender,
    | 'id'
    | 'fromName'
    | 'fromEmail'
    | 'smtpHost'
    | 'smtpPort'
    | 'smtpUser'
    | 'smtpPassword'
    | 'smtpSecure'
    | 'previewBase'
  >;
  to: string;
  subject: string;
  body: string;
}

export interface SendEmailResult {
  messageId: string;
  previewUrl: string | null;
  acceptedCount: number;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const transport = transportFor(input.sender);

  const info = await transport.sendMail({
    from: { name: input.sender.fromName, address: input.sender.fromEmail },
    to: input.to,
    subject: input.subject,
    text: input.body,
    html: toHtmlEmail(input.subject, input.body),
  });

  // nodemailer exposes the Ethereal preview link for test accounts; fall back
  // to composing it from the message id when the helper returns nothing.
  let previewUrl = (nodemailer.getTestMessageUrl(info) || null) as string | null;
  if (!previewUrl && input.sender.previewBase && info.messageId) {
    previewUrl = `${input.sender.previewBase}${info.messageId.replace(/[<>]/g, '')}`;
  }

  return {
    messageId: info.messageId ?? '',
    previewUrl,
    acceptedCount: Array.isArray(info.accepted) ? info.accepted.length : 0,
  };
}

/** Confirm a sender's SMTP credentials actually authenticate. */
export async function verifySender(sender: SenderCredentials): Promise<boolean> {
  try {
    await transportFor(sender).verify();
    return true;
  } catch (error) {
    log.warn({ err: (error as Error).message, senderId: sender.id }, 'SMTP verification failed');
    return false;
  }
}

/** Close pooled connections on shutdown. */
export function closeTransports(): void {
  for (const transport of transports.values()) {
    transport.close();
  }
  transports.clear();
}
