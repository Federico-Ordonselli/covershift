import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

/**
 * E2E against the real local stack: Supabase (db, auth, kong), the built API from dist,
 * and the production web build served by `vite preview` under the real CSP.
 * One worker: the suite shares the seeded database.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: CI,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: '../api',
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm exec vite preview',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
