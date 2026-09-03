import type { EmailEventType, EmailStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { redis, key, createSubscriber } from '../lib/redis';
import { subLogger } from '../lib/logger';

const log = subLogger('events');

/**
 * Realtime fan-out.
 *
 * The API process serves the SSE stream but the *worker* is a separate process,
 * so it cannot write to those HTTP responses directly. Redis pub/sub bridges
 * the two: the worker publishes to a per-user channel, every API instance
 * subscribed on behalf of a connected browser relays the payload downstream.
 *
 * This is what removes polling from the dashboard entirely - and it scales to
 * multiple API replicas without sticky sessions.
 */

export type RealtimeEvent =
  | {
      type: 'email.status';
      emailId: string;
      campaignId: string | null;
      senderId: string;
      status: EmailStatus;
      event: EmailEventType;
      message?: string;
      at: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: 'campaign.progress';
      campaignId: string;
      sent: number;
      total: number;
      at: string;
    }
  | { type: 'system.window'; windowMs: number; at: string }
  | { type: 'ping'; at: string };

export async function publishToUser(userId: string, event: RealtimeEvent): Promise<void> {
  try {
    await redis.publish(key.eventChannel(userId), JSON.stringify(event));
  } catch (error) {
    // Realtime is a convenience layer: never let a pub/sub failure break a send.
    log.warn({ err: (error as Error).message, userId }, 'Failed to publish realtime event');
  }
}

export interface RecordEventInput {
  emailId: string;
  userId: string;
  campaignId?: string | null;
  senderId: string;
  type: EmailEventType;
  status: EmailStatus;
  message?: string;
  payload?: Record<string, unknown>;
}

/**
 * Append to the durable audit trail *and* notify listeners.
 *
 * Persisting first means the per-email timeline in the UI is complete even for
 * events that happened while nobody was watching - the SSE stream is an
 * accelerator, not the system of record.
 */
export async function recordEmailEvent(input: RecordEventInput): Promise<void> {
  const now = new Date();

  try {
    await prisma.emailEvent.create({
      data: {
        emailId: input.emailId,
        type: input.type,
        message: input.message ?? null,
        payload: (input.payload ?? {}) as object,
        createdAt: now,
      },
    });
  } catch (error) {
    log.warn(
      { err: (error as Error).message, emailId: input.emailId },
      'Failed to persist email event',
    );
  }

  await publishToUser(input.userId, {
    type: 'email.status',
    emailId: input.emailId,
    campaignId: input.campaignId ?? null,
    senderId: input.senderId,
    status: input.status,
    event: input.type,
    message: input.message,
    payload: input.payload,
    at: now.toISOString(),
  });
}

/**
 * Subscribe to one user's realtime channel.
 * Returns an unsubscribe function; the caller owns the lifecycle (the SSE
 * handler ties it to the request's `close` event).
 */
export function subscribeToUser(
  userId: string,
  onEvent: (event: RealtimeEvent) => void,
): () => Promise<void> {
  const subscriber = createSubscriber();
  const channel = key.eventChannel(userId);

  void subscriber.subscribe(channel).catch((error: Error) => {
    log.error({ err: error.message, userId }, 'Failed to subscribe to realtime channel');
  });

  subscriber.on('message', (_channel: string, message: string) => {
    try {
      onEvent(JSON.parse(message) as RealtimeEvent);
    } catch {
      log.warn({ userId }, 'Discarded malformed realtime payload');
    }
  });

  return async () => {
    try {
      await subscriber.unsubscribe(channel);
    } finally {
      subscriber.disconnect();
    }
  };
}
