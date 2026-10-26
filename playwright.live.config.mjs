// Playwright config for the live sign-in smoke test: npx playwright test -c playwright.live.config.mjs
// Separate from playwright.config.mjs (the emulator specs, "Pantry checks"). Runs against the deployed site with the
// test user from PANTRY_TEST_EMAIL / PANTRY_TEST_PASSWORD; that user is in no household and reads and writes no app data.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'pantry/test/live-smoke',
  testMatch: '*.spec.mjs',
  workers: 1,
  retries: 1,   // one retry for a network blip; a second failure is real
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.PANTRY_LIVE_URL || 'https://pantry.flamingbeing.com',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
