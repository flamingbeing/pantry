// Playwright Test for the pantry's browser tests: npx playwright test   (pantry/NOTES.md, "How to test")
// Every test brings its own static server (a fresh origin, so no service worker or storage carries over) and its own
// made-up accounts and household ids, so tests run in any order, side by side. The emulator specs share one local
// Firebase emulator (demo-pantry project, fake accounts; never the live project), started here unless one is running.
// PW_NO_EMULATOR=1 skips starting it (for the specs that don't need it). If an old emulator is still running without
// Auth, stop it first (pkill -f cloud-firestore-emulator).
import { defineConfig } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'pantry/test/specs',
  testMatch: '*.spec.mjs',
  fullyParallel: true,
  workers: 4,
  retries: 0,   // a flake is a bug to fix, not a retry
  forbidOnly: CI,
  globalSetup: './pantry/test/specs/global-setup.mjs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['github'], ['list']] : 'list',
  use: {
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.PW_NO_EMULATOR ? undefined : {
    command: 'npx -y firebase-tools@13.29.1 emulators:start --only firestore,auth --project demo-pantry',
    cwd: 'pantry',
    url: 'http://127.0.0.1:9099',
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },   // firebase stops its emulators itself; a kill leaves Java running
  },
});
