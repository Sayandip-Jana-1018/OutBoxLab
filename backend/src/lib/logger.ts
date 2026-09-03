import pino from 'pino';
import { env, isProduction } from '../config/env';

/**
 * Structured logging. Pretty-printed and colourised in development so the
 * scheduler's decisions are readable live during a demo; raw NDJSON in
 * production so logs stay machine-parseable.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined, // drop pid/hostname noise
  redact: {
    paths: [
      'password',
      'passwordHash',
      'smtpPassword',
      'req.headers.cookie',
      'req.headers.authorization',
    ],
    censor: '[redacted]',
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'hostname,pid',
            messageFormat: '{msg}',
          },
        },
      }),
});

/** Child logger tagged with a subsystem name, e.g. `worker`, `reconciler`. */
export function subLogger(scope: string) {
  return logger.child({ scope });
}
