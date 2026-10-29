// Back with tabs, as Android apps do it (app-ui's tabBack): tab changes add at most one Back step, Back on another tab
// goes to the first tab, Back there leaves the app, and a screen pushed over a tab still closes first.
// Run: npx playwright test app-back
import { test, expect } from './fixtures.mjs';
import { BASE, MOBILE, WELCOMED, hash, quiet, idOf } from './app-helpers.mjs';

const tab = async (page, h) => {
  await page.locator(`.ui-tabbar a[href="${h}"]`).click();
  await expect.poll(() => hash(page)).toBe(h);
  await expect(page.locator(`.ui-tabbar a[href="${h}"]`)).toHaveAttribute('aria-current', 'page');
  await quiet(page);
};
const back = async (page, h) => {
  await page.goBack();
  await expect.poll(() => hash(page)).toBe(h);
  await quiet(page);
};
// a page before the app, so leaving it shows up as being back there
async function openAfterAnother(phone, name) {
  const page = await phone(name, { url: BASE + 'icons/icon.svg', ...MOBILE, serviceWorkers: 'block', init: { content: `(${WELCOMED})();` } });
  await page.goto(BASE + '?demo');
  await expect(page.locator('.ui-large-title').first()).toBeVisible();
  return page;
}
const len = page => page.evaluate(() => history.length);

test('tabs add at most one Back step; Back goes to the first tab, then leaves', async ({ phone }) => {
  const page = await openAfterAnother(phone, 'back tabs');
  expect(hash(page)).toBe('#/');
  const start = await len(page);
  for (const h of ['#/items', '#/shop', '#/settings', '#/items']) await tab(page, h);
  expect(await len(page), 'one entry for all the tab changes').toBeLessThanOrEqual(start + 1);
  await back(page, '#/');
  await expect(page.locator('.ui-tabbar a[href="#/"]')).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect.poll(() => new URL(page.url()).pathname, 'Back on the first tab leaves').toBe(BASE + 'icons/icon.svg');
});

test('a tap on the first tab takes the tab entry away; a pushed screen still closes first', async ({ phone }) => {
  const page = await openAfterAnother(phone, 'back pushed');
  const start = await len(page);
  await tab(page, '#/shop');
  await tab(page, '#/');
  await tab(page, '#/items');
  expect(await len(page)).toBeLessThanOrEqual(start + 1);
  const id = await idOf(page, 'Light soy sauce');
  await page.locator(`a[href="#/item/${id}"]`).first().click();
  await expect.poll(() => hash(page)).toBe('#/item/' + id);
  await back(page, '#/items');
  // a tab tap from a pushed screen takes it away too, so Back is still one step to the first tab
  await page.locator(`a[href="#/item/${id}"]`).first().click();
  await expect.poll(() => hash(page)).toBe('#/item/' + id);
  await tab(page, '#/settings');
  await back(page, '#/');
  await page.goBack();
  await expect.poll(() => new URL(page.url()).pathname).toBe(BASE + 'icons/icon.svg');
});
