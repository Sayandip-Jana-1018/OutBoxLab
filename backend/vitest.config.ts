import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    // Redis-backed suites use unique per-test sender ids, but running whole
    // files in separate processes keeps each one's ioredis singleton isolated
    // and makes teardown deterministic.
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    reporters: 'default',
  },
});
