import bcrypt from 'bcryptjs';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { createEtherealAccount } from '../services/mailer';

/**
 * Seeds the demo account so a reviewer can sign in and see a working mailbox
 * immediately, with no registration step and no SMTP credentials of their own.
 *
 * Idempotent: safe to run repeatedly.
 */
async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(env.DEMO_PASSWORD, 12);

  const user = await prisma.user.upsert({
    where: { email: env.DEMO_EMAIL },
    update: { passwordHash, name: env.DEMO_NAME },
    create: {
      email: env.DEMO_EMAIL,
      name: env.DEMO_NAME,
      passwordHash,
      avatarUrl: `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(env.DEMO_EMAIL)}`,
    },
  });

  logger.info({ email: user.email }, 'Demo user ready');

  const existingSenders = await prisma.sender.count({ where: { userId: user.id } });

  if (existingSenders > 0) {
    logger.info({ count: existingSenders }, 'Sender mailboxes already present; skipping');
  } else {
    // Two mailboxes with different budgets: the first is tuned so the hourly
    // cap is easy to hit during a demo, the second is a realistic default.
    const [demoAccount, bulkAccount] = await Promise.all([
      createEtherealAccount(),
      createEtherealAccount(),
    ]);

    await prisma.sender.createMany({
      data: [
        {
          userId: user.id,
          label: 'Demo mailbox (cap 5)',
          fromName: 'OutboxLab Demo',
          fromEmail: demoAccount.user,
          provider: 'ETHEREAL',
          smtpHost: demoAccount.host,
          smtpPort: demoAccount.port,
          smtpUser: demoAccount.user,
          smtpPassword: demoAccount.password,
          smtpSecure: demoAccount.secure,
          previewBase: demoAccount.previewBase,
          hourlyLimit: 5,
          minDelayMs: 1000,
          lastVerified: new Date(),
        },
        {
          userId: user.id,
          label: 'Bulk mailbox (cap 100)',
          fromName: 'OutboxLab Bulk',
          fromEmail: bulkAccount.user,
          provider: 'ETHEREAL',
          smtpHost: bulkAccount.host,
          smtpPort: bulkAccount.port,
          smtpUser: bulkAccount.user,
          smtpPassword: bulkAccount.password,
          smtpSecure: bulkAccount.secure,
          previewBase: bulkAccount.previewBase,
          hourlyLimit: 100,
          minDelayMs: env.DEFAULT_MIN_DELAY_MS,
          lastVerified: new Date(),
        },
      ],
    });

    logger.info('Provisioned 2 Ethereal sender mailboxes');
  }

  logger.info(
    `\n  Seed complete.\n  Sign in with:  ${env.DEMO_EMAIL} / ${env.DEMO_PASSWORD}\n`,
  );
}

main()
  .catch((error: Error) => {
    logger.error({ err: error.message }, 'Seed failed');
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
