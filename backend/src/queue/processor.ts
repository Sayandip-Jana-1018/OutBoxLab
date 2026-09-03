import { DelayedError, type Job } from 'bullmq';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { subLogger } from '../lib/logger';
import { redis, key } from '../lib/redis';
import { describeWindow } from '../lib/clock';
import { recordEmailEvent, publishToUser } from '../services/events';
import { sendEmail } from '../services/mailer';
import type { EmailJobData } from './queues';
import { consumeRateLimit, refundRateLimit } from './rateLimiter';
import { reserveSendSlot } from './pacer';

const log = subLogger('worker');

/** How long a job parks itself while its campaign is paused. */
const PAUSE_PARK_MS = 15_000;

export type ProcessOutcome =
  | { result: 'sent'; previewUrl: string | null }
  | { result: 'skipped'; reason: string };

async function bumpMetric(name: string): Promise<void> {
  try {
    await redis.incr(key.metrics(name));
  } catch {
    // Metrics are best-effort and must never affect delivery.
  }
}

/**
 * Park a job until a given instant *without* consuming a retry attempt.
 *
 * `moveToDelayed` + `DelayedError` is the BullMQ-sanctioned way to say "not
 * now, ask me again later". Crucially it is not a failure: `attemptsMade` is
 * untouched, so an email throttled 50 times still has its full retry budget
 * available for genuine SMTP errors. Marking rate-limited jobs as failed - the
 * naive approach - would exhaust `attempts` and permanently drop mail that was
 * never actually broken.
 */
async function parkJob(job: Job<EmailJobData>, untilMs: number, token?: string): Promise<never> {
  if (!token) {
    // Without a token BullMQ cannot transfer ownership back to the delayed set.
    // Throwing a plain error lets the normal retry/backoff path handle it.
    throw new Error('Cannot defer job: worker token unavailable');
  }
  await job.moveToDelayed(untilMs, token);
  throw new DelayedError();
}

/**
 * Process one send job.
 *
 * Order of operations is deliberate: **pace first, then check quota.**
 *
 * If the quota were consumed first and the job were then paced into the next
 * window, the send would be counted against a window it never sent in - the
 * counter would over-report the current window and under-use the next one.
 * Reserving the pacing slot first means the quota is always checked against
 * the window the email will genuinely be sent in. The cost is a harmless idle
 * gap when a paced job then turns out to be over quota.
 */
export async function processEmailJob(
  job: Job<EmailJobData>,
  token?: string,
): Promise<ProcessOutcome> {
  const { emailId } = job.data;

  const email = await prisma.scheduledEmail.findUnique({
    where: { id: emailId },
    include: {
      sender: true,
      campaign: { select: { id: true, status: true } },
    },
  });

  // ---------------------------------------------------------------------
  // 1. Idempotency and cancellation guards.
  //
  // Postgres is the authority. A job may legitimately arrive for an email
  // that was already delivered (duplicate reconciliation, Redis replay) or
  // that the user cancelled after it entered the active set. Both are
  // no-ops, not errors.
  // ---------------------------------------------------------------------
  if (!email) {
    log.warn({ emailId }, 'No database row for job; dropping');
    return { result: 'skipped', reason: 'row-missing' };
  }

  if (email.status === 'SENT') {
    log.debug({ emailId }, 'Email already sent; skipping duplicate delivery');
    return { result: 'skipped', reason: 'already-sent' };
  }

  if (email.status === 'CANCELLED') {
    log.debug({ emailId }, 'Email cancelled; skipping');
    return { result: 'skipped', reason: 'cancelled' };
  }

  // A paused campaign parks its jobs instead of dropping them, so resuming is
  // instant and nothing needs to be re-created.
  if (email.campaign && email.campaign.status === 'PAUSED') {
    log.debug({ emailId, campaignId: email.campaign.id }, 'Campaign paused; parking job');
    await parkJob(job, Date.now() + PAUSE_PARK_MS, token);
  }

  const { sender } = email;

  await prisma.scheduledEmail.update({
    where: { id: emailId },
    data: { status: 'PROCESSING' },
  });

  await recordEmailEvent({
    emailId,
    userId: email.userId,
    campaignId: email.campaignId,
    senderId: email.senderId,
    type: 'PICKED_UP',
    status: 'PROCESSING',
    message: `Claimed by worker (attempt ${job.attemptsMade + 1})`,
  });

  // ---------------------------------------------------------------------
  // 2. Pacing: enforce the minimum gap between two sends from this mailbox.
  // ---------------------------------------------------------------------
  const alreadyHoldsSlot =
    typeof job.data.reservedSlotMs === 'number' && Date.now() >= job.data.reservedSlotMs;

  if (!alreadyHoldsSlot) {
    const reservation = await reserveSendSlot(sender.id, sender.minDelayMs);

    if (!reservation.immediate) {
      // Remember the reservation so the next pass uses this slot instead of
      // booking another one further out (which would drift forever).
      await job.updateData({ ...job.data, reservedSlotMs: reservation.slotMs });

      await prisma.scheduledEmail.update({
        where: { id: emailId },
        data: { status: 'DEFERRED', deferredCount: { increment: 1 } },
      });

      await recordEmailEvent({
        emailId,
        userId: email.userId,
        campaignId: email.campaignId,
        senderId: email.senderId,
        type: 'DEFERRED_PACING',
        status: 'DEFERRED',
        message: `Paced: waiting ${reservation.waitMs}ms to keep ${sender.minDelayMs}ms between sends from "${sender.label}"`,
        payload: { slotMs: reservation.slotMs, waitMs: reservation.waitMs },
      });

      await bumpMetric('deferred_pacing');
      log.info(
        { emailId, senderId: sender.id, waitMs: reservation.waitMs },
        'Deferred for pacing',
      );

      await parkJob(job, reservation.slotMs, token);
    }
  }

  // ---------------------------------------------------------------------
  // 3. Quota: at most `hourlyLimit` sends per window for this sender.
  // ---------------------------------------------------------------------
  const decision = await consumeRateLimit(sender.id, email.hourlyLimit);

  if (!decision.allowed) {
    // The slot has already elapsed; the next pass must book a fresh one.
    const { reservedSlotMs: _drop, ...dataWithoutSlot } = job.data;
    await job.updateData(dataWithoutSlot);

    await prisma.scheduledEmail.update({
      where: { id: emailId },
      data: { status: 'DEFERRED', deferredCount: { increment: 1 } },
    });

    const retryAt = new Date(decision.retryAtMs);
    await recordEmailEvent({
      emailId,
      userId: email.userId,
      campaignId: email.campaignId,
      senderId: email.senderId,
      type: 'DEFERRED_RATE_LIMIT',
      status: 'DEFERRED',
      message: `Sender "${sender.label}" reached its cap of ${decision.limit} per ${describeWindow(decision.windowMs)}. Retrying at ${retryAt.toISOString()}`,
      payload: {
        count: decision.count,
        limit: decision.limit,
        windowMs: decision.windowMs,
        retryAt: retryAt.toISOString(),
      },
    });

    await bumpMetric('deferred_rate_limit');
    log.warn(
      {
        emailId,
        senderId: sender.id,
        count: decision.count,
        limit: decision.limit,
        window: describeWindow(decision.windowMs),
        retryAt: retryAt.toISOString(),
      },
      'Rate limit reached; deferring to next window',
    );

    await parkJob(job, decision.retryAtMs, token);
  }

  // ---------------------------------------------------------------------
  // 4. Deliver.
  // ---------------------------------------------------------------------
  try {
    const result = await sendEmail({
      sender,
      to: email.to,
      subject: email.subject,
      body: email.body,
    });

    const sentAt = new Date();
    await prisma.scheduledEmail.update({
      where: { id: emailId },
      data: {
        status: 'SENT',
        sentAt,
        messageId: result.messageId,
        previewUrl: result.previewUrl,
        attempts: { increment: 1 },
        lastError: null,
      },
    });

    await recordEmailEvent({
      emailId,
      userId: email.userId,
      campaignId: email.campaignId,
      senderId: email.senderId,
      type: 'SENT',
      status: 'SENT',
      message: `Delivered to ${email.to}`,
      payload: {
        messageId: result.messageId,
        previewUrl: result.previewUrl,
        quotaUsed: decision.count,
        quotaLimit: decision.limit,
      },
    });

    await bumpMetric('sent');
    await maybeCompleteCampaign(email.campaignId, email.userId);

    log.info(
      { emailId, to: email.to, quota: `${decision.count}/${decision.limit}` },
      'Email sent',
    );

    return { result: 'sent', previewUrl: result.previewUrl };
  } catch (error) {
    const message = (error as Error).message || 'SMTP delivery failed';

    // The send did not happen, so the consumed quota slot is given back.
    // Without this refund a flapping SMTP host would silently eat a sender's
    // entire hourly allowance without delivering anything.
    await refundRateLimit(sender.id);

    const attemptsSoFar = job.attemptsMade + 1;
    const exhausted = attemptsSoFar >= env.MAX_JOB_ATTEMPTS;

    await prisma.scheduledEmail.update({
      where: { id: emailId },
      data: {
        status: exhausted ? 'FAILED' : 'SCHEDULED',
        attempts: { increment: 1 },
        lastError: message.slice(0, 500),
      },
    });

    await recordEmailEvent({
      emailId,
      userId: email.userId,
      campaignId: email.campaignId,
      senderId: email.senderId,
      type: exhausted ? 'FAILED' : 'RETRY_SCHEDULED',
      status: exhausted ? 'FAILED' : 'SCHEDULED',
      message: exhausted
        ? `Giving up after ${attemptsSoFar} attempts: ${message}`
        : `Attempt ${attemptsSoFar} failed, retrying with backoff: ${message}`,
      payload: { attempts: attemptsSoFar, maxAttempts: env.MAX_JOB_ATTEMPTS },
    });

    await bumpMetric(exhausted ? 'failed' : 'retried');
    log.error({ emailId, err: message, attempts: attemptsSoFar, exhausted }, 'Send failed');

    // Rethrow so BullMQ applies exponential backoff (or finalises the failure).
    throw error;
  }
}

/**
 * Flip a campaign to COMPLETED once no email of its is still in flight, and
 * push a progress update to the dashboard.
 */
async function maybeCompleteCampaign(
  campaignId: string | null,
  userId: string,
): Promise<void> {
  if (!campaignId) return;

  const [pending, sent, total] = await Promise.all([
    prisma.scheduledEmail.count({
      where: { campaignId, status: { in: ['SCHEDULED', 'PROCESSING', 'DEFERRED'] } },
    }),
    prisma.scheduledEmail.count({ where: { campaignId, status: 'SENT' } }),
    prisma.scheduledEmail.count({ where: { campaignId } }),
  ]);

  await publishToUser(userId, {
    type: 'campaign.progress',
    campaignId,
    sent,
    total,
    at: new Date().toISOString(),
  });

  if (pending === 0) {
    await prisma.campaign.updateMany({
      where: { id: campaignId, status: { in: ['SCHEDULED', 'RUNNING'] } },
      data: { status: 'COMPLETED' },
    });
  } else {
    await prisma.campaign.updateMany({
      where: { id: campaignId, status: 'SCHEDULED' },
      data: { status: 'RUNNING' },
    });
  }
}
