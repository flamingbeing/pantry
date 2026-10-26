// Live sign-in smoke test (playwright.live.config.mjs; workflow "Live smoke"). Signs the test user in through the
// app's own email + password sheet on the deployed site and checks the signed-in shell. The test user is in no household
// and Firestore refuses it every read, so this never touches app data and writes nothing. Skips without the secrets.
// Run: PANTRY_TEST_EMAIL=... PANTRY_TEST_PASSWORD=... npx playwright test -c playwright.live.config.mjs
import { test, expect } from '@playwright/test';

const email = process.env.PANTRY_TEST_EMAIL;
const password = process.env.PANTRY_TEST_PASSWORD;

test.skip(!email || !password, 'PANTRY_TEST_EMAIL / PANTRY_TEST_PASSWORD not set');

test('the test user signs in on the live site: signed-in shell, no household, no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  // Firestore refusing the no-household user is expected (403 / permission-denied), so that one is not an error here
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource|permission-denied|Missing or insufficient permissions/i.test(m.text())) errors.push(`console: ${m.text()}`);
  });

  await page.goto('/pantry/#/settings');
  await page.locator('[data-act="email-open"]').click();
  const sheet = page.locator('dialog.ha-sheet[open]');
  await expect(sheet.locator('.ha-sheet-title')).toHaveText('Sign in with email');
  await page.fill('#pa-em-email', email);
  await sheet.locator('[data-pe="pw"]').click();
  await page.fill('#pa-em-pass', password);
  await sheet.locator('button[type=submit]').click();
  await expect(sheet).toHaveCount(0);

  // signed in: the sign-in card is gone and the account's address is shown, with no family data and no way to a pantry
  const main = page.locator('#main');
  await expect(main).toContainText(email, { ignoreCase: true });
  await expect(page.locator('[data-act="signin"]')).toHaveCount(0);
  await expect(page.locator('[data-act="signout"]').first()).toBeVisible();
  await expect(main).not.toContainText(/Our pantry|Start our family pantry/);

  // a reload keeps the session (Firebase Auth persists it), still no household
  await page.reload();
  await expect(main).toContainText(email, { ignoreCase: true });
  await expect(page.locator('[data-act="signin"]')).toHaveCount(0);

  expect(errors, 'console and page errors').toEqual([]);
});
