import { defineConfig } from 'vitest/config';

// Files share the persona accounts, so they run one at a time; each file resets the
// personas' couples, invites and entitlements in beforeAll (helpers.resetWorld).
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    globalSetup: ['./global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
