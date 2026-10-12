import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against their own database (tavolina_e2e) and their own ports, so they
 * never touch the demo data or a running `npm run dev`.
 */
const API_PORT = 4110;
const STAFF_PORT = 5190;
export const E2E_DATABASE = 'tavolina_e2e';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${STAFF_PORT}`,
    locale: 'sq-AL',
    timezoneId: 'Europe/Tirane',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
  ],
  webServer: [
    {
      command: 'node --import tsx ../../e2e/prepare-db.ts && node --import tsx src/server.ts',
      cwd: 'apps/api',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        API_PORT: String(API_PORT),
        MYSQL_DATABASE: E2E_DATABASE,
        CORS_ORIGINS: `http://localhost:${STAFF_PORT}`,
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `node ../../node_modules/vite/bin/vite.js --port ${STAFF_PORT} --strictPort`,
      cwd: 'apps/staff',
      url: `http://localhost:${STAFF_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_PORT: String(API_PORT), STAFF_PORT: String(STAFF_PORT) },
    },
  ],
});
