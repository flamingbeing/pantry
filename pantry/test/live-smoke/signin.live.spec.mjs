// Live sign-in smoke test (app-devkit live-smoke workflow "Live smoke"). Signs the test user in through the
// app's own email + password sheet on the deployed site and checks the signed-in shell. The test user is in no household
// and Firestore refuses it every read, so this never touches app data and writes nothing. Skips without the secrets.
// Run: LIVE_URL=https://pantry.flamingbeing.com LIVE_SPEC=pantry/test/live-smoke LIVE_TEST_EMAIL=... LIVE_TEST_PASSWORD=...
//   npx playwright test -c .devkit/playwright/live.config.mjs   (CI: the app-devkit live-smoke workflow)
import { test, expect } from '@playwright/test';
import { liveUser, watchConsole } from '../../../.devkit/playwright/live.mjs';

const { email, password } = liveUser();

test.skip(!email || !password, 'no test user (LIVE_TEST_EMAIL / LIVE_TEST_PASSWORD)');

test('the test user signs in on the live site: signed-in shell, no household, no console errors', async ({ page }) => {
  const errors = watchConsole(page);   // Firestore refusing the no-household user is expected, so it is ignored

  await page.goto('/pantry/#/settings');
  await page.locator('[data-act="email-open"]').click();
  const sheet = page.locator('dialog.ha-sheet[open]');
  await expect(sheet.locator('.ha-sheet-title')).toHaveText('Sign in with email');
  await page.fill('#pa-em-email', email);
  await sheet.locator('[data-pe="pw"]').click();
  await page.fill('#pa-em-pass', password);
  await sheet.locator('button[type=submit]').click();
  await expect(sheet).toHaveCount(0);

  // signed in: the sign-in card is gone and the account's address is shown, in no family pantry and with no family data
  // (the app offers "Start our family pantry" to a signed-in account with none; the test never taps it)
  const main = page.locator('#main');
  await expect(main).toContainText(email, { ignoreCase: true });
  await expect(page.locator('[data-act="signin"]')).toHaveCount(0);
  await expect(page.locator('[data-act="signout"]').first()).toBeVisible();
  await expect(main).toContainText(/Not in a family pantry yet|Can.t check right now/);
  await expect(main).not.toContainText(/Check your email|Our pantry/);

  // a reload keeps the session (Firebase Auth persists it), still no household
  await page.reload();
  await expect(main).toContainText(email, { ignoreCase: true });
  await expect(page.locator('[data-act="signin"]')).toHaveCount(0);

  expect(errors, 'console and page errors').toEqual([]);
});
