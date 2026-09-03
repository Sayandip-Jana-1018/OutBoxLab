import type { User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id attached by `requestContext`, echoed in the response. */
      id: string;
      /** Populated by the `requireAuth` middleware. */
      user?: Pick<User, 'id' | 'email' | 'name' | 'avatarUrl'>;
    }
  }
}

export {};
