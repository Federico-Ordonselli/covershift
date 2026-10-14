import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * README screenshots: same stack, seed and fixtures as the e2e suite (so they also run
 * under the CSP guard), different test dir. `pnpm --filter @covershift/web screenshots`
 * rewrites docs/screenshots/*.png.
 */
export default defineConfig({
  ...base,
  testDir: 'screenshots',
  reporter: 'list',
  use: {
    ...base.use,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-GB',
  },
});
