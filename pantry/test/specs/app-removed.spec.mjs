// Recently removed (Settings → Recently removed): the demo has two removed items and a removed place; 30 days; Restore;
// deleting puts an item there. Run: npx playwright test app-removed
import { test, expect } from './fixtures.mjs';
import { BASE, open, go, hash, toast, shot } from './app-helpers.mjs';

test('Recently removed: what can be put back, Restore, and a deleted item waits 30 days', async ({ phone, axe }) => {
  const page = await open(phone, 'removed', BASE + '?demo');
  await go(page, '#/items');
  await expect(page.locator('#pa-items-list .ha-row', { hasText: /Chilli sauce|Spring onions/ }), 'removed items are not in Items').toHaveCount(0);
  expect(await page.locator('#main').evaluate(m => !/Chilli sauce|Spring onions/.test(m.textContent)), 'nor anywhere on Items').toBe(true);
  await go(page, '#/settings');
  await expect(page.locator('#h-removed').locator('xpath=..'), 'Settings says what can be put back').toContainText(/3 things you can put back/);
  await page.click('#main a[href="#/removed"]');
  await expect.poll(() => hash(page)).toBe('#/removed');
  await expect(page.locator('h1'), 'Recently removed opens from Settings').toHaveText('Recently removed');
  await expect(page.locator('.ha-back span'), 'its back button names Settings').toHaveText('Settings');
  const rows = page.locator('#pa-removed .ha-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0), 'name, place, who removed it, days left').toHaveText(/Spring onions.*Fridge · Removed by Mum · 2[89] days left/);
  await expect(rows.nth(1), 'name, place, who removed it, days left').toHaveText(/Chilli sauce.*Kitchen cabinet · Removed by Dad · 3 days left/);
  await expect(page.locator('#pa-removed img'), 'no thumbnails on removed items').toHaveCount(0);
  const prow = page.locator('#pa-removed-places .ha-row');
  await expect(prow, 'a removed place is there too').toHaveCount(1);
  await expect(prow, 'with who removed it and the days left').toHaveText(/Garage shelf.*Place · Removed by Dad · 2[67] days left/);
  expect(await page.evaluate(() => window.__pantry.places()), 'and it is not in the list of places').not.toContain('Garage shelf');
  await axe(page, 'recently removed');
  await shot(page, 'r01-recently-removed');
  await page.locator('#pa-removed .ha-row', { hasText: 'Chilli sauce' }).locator('[data-act="restore"]').click();
  await expect(rows, 'Restore takes it off the list').toHaveCount(1);
  await expect(toast(page)).toContainText(/Chilli sauce is back/);
  await go(page, '#/items');
  await expect(page.locator('#pa-items-list .ha-row', { hasText: 'Chilli sauce' }), 'and it is back in Items').toHaveCount(1);
  await go(page, '#/removed');
  await page.locator('#pa-removed .ha-row', { hasText: 'Spring onions' }).locator('[data-act="restore"]').click();
  await expect(rows).toHaveCount(0);
  await page.locator('#pa-removed-places .ha-row', { hasText: 'Garage shelf' }).locator('[data-act="restore"]').click();
  await expect(toast(page)).toContainText(/Garage shelf is back/);
  await expect.poll(async () => (await page.evaluate(() => window.__pantry.places())).at(-1), 'Restore brings a place back to the end of the list').toBe('Garage shelf');
  await expect(page.locator('#main'), 'the empty state says so').toContainText(/Nothing removed/);
  await axe(page, 'recently removed (empty)');
  await shot(page, 'r01b-removed-empty');
  // deleting an item puts it there, with 30 days
  await go(page, '#/items');
  await page.locator('#pa-items-list a.ha-row', { hasText: 'Kaya' }).click();
  await page.click('[data-act="delete"]');
  await go(page, '#/removed');
  await expect(page.locator('#pa-removed'), 'a deleted item waits there for 30 days').toContainText(/Kaya.*30 days left/);
  await expect(page.locator('#h-removed-items .ha-num'), 'with its count').toHaveText('1');
  // the guide says so
  await go(page, '#/guide');
  await expect(page.locator('#main'), 'the guide mentions Recently removed').toContainText('Recently removed');
});
