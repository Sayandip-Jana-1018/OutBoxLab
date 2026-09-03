import Redis, { type RedisOptions } from 'ioredis';
import { env } from '../config/env';
import { subLogger } from './logger';

const log = subLogger('redis');

/**
 * BullMQ requires `maxRetriesPerRequest: null` on its connection, otherwise
 * blocking commands (BRPOPLPUSH etc.) are aborted mid-flight and jobs get
 * silently stalled. We therefore keep two connection profiles.
 */
export const bullConnectionOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
};

function createClient(name: string, options: RedisOptions = {}): Redis {
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: false,
    connectionName: `outboxlab:${name}`,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    ...options,
  });

  client.on('error', (error: Error) => {
    log.error({ err: error.message, client: name }, 'Redis connection error');
  });
  client.on('ready', () => {
    log.debug({ client: name }, 'Redis connection ready');
  });

  return client;
}

/**
 * General-purpose command client: rate-limit counters, pacer reservations,
 * runtime config and event publishing.
 */
export const redis = createClient('commands');

/**
 * Connection handed to BullMQ's Queue/Worker instances.
 */
export const bullRedis = createClient('bullmq', bullConnectionOptions);

/**
 * A connection in subscriber mode cannot issue normal commands, so the SSE bus
 * gets its own dedicated client.
 */
export function createSubscriber(): Redis {
  return createClient('subscriber');
}

/** Namespaced key builder so every OutboxLab key is greppable in Redis. */
export const key = {
  rateLimit: (senderId: string, windowIndex: number) => `obl:rl:${senderId}:${windowIndex}`,
  pacer: (senderId: string) => `obl:pacer:${senderId}`,
  config: (name: string) => `obl:config:${name}`,
  eventChannel: (userId: string) => `obl:events:${userId}`,
  metrics: (name: string) => `obl:metrics:${name}`,
} as const;

export async function pingRedis(): Promise<boolean> {
  try {
    const reply = await redis.ping();
    return reply === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), bullRedis.quit()]);
}
