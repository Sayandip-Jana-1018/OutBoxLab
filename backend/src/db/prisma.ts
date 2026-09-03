import { PrismaClient } from '@prisma/client';
import { env, isProduction } from '../config/env';
import { subLogger } from '../lib/logger';

const log = subLogger('prisma');

/**
 * Single Prisma client per process. Cached on `globalThis` so `tsx watch`
 * hot-reloads do not leak a new connection pool on every file save.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction
      ? [{ emit: 'event', level: 'error' }]
      : [
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ],
  });

prisma.$on('error' as never, (event: unknown) => {
  log.error({ event }, 'Prisma error');
});

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
}
