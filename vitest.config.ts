import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          environment: 'node',
        },
      },
      {
        test: {
          name: 'print-bridge',
          root: './apps/print-bridge',
          environment: 'node',
        },
      },
      {
        test: {
          name: 'api',
          root: './apps/api',
          environment: 'node',
          env: {
            NODE_ENV: 'test',
            BCRYPT_COST: '4',
            JWT_ACCESS_SECRET: 'test-only-secret-0123456789abcdef0123456789',
            // Keep test uploads out of the real uploads folder.
            UPLOADS_DIR: path.join(os.tmpdir(), 'tavolina-test-uploads'),
          },
          // Migrates the test database once before all API suites.
          globalSetup: ['./src/test/global-setup.ts'],
          setupFiles: ['./src/test/setup.ts'],
          // API suites share one test database; run files one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
