// Demo mode (?demo, memory only), every screen at 390, 360 and 320px: no sideways scroll, axe clean, the top bar's parts
// apart (also at 200% text), and edit / delete with Undo. Run: npx playwright test app-demo
import { test, expect } from './fixtures.mjs';
import { BASE, open, go, hash, undo, noSideways, barApart, bigText, shot, idOf } from './app-helpers.mjs';

const screens = id => ['#/', '#/items', '#/item/' + id, '#/add', '#/edit/' + id, '#/shop', '#/settings', '#/guide'];
const demo = async (phone, name, width, height) => {
  const page = await open(phone, name, BASE + '?demo', { width, height });
  await expect(page.locator('.ha-large-sub'), 'says it is a demo').toContainText('Demo');
  expect(await page.evaluate(() => window.__pantry.S.mode), 'memory only').toBe('demo');
  return page;
};

for (const [w, h] of [[390, 844], [360, 780], [320, 640]]) {
  test(`demo at ${w}px: every screen has no sideways scroll${w !== 390 ? ' and is axe clean' : ''}`, async ({ phone, axe }) => {
    const page = await demo(phone, `demo ${w}`, w, h);
    const id = await idOf(page, 'Light soy sauce');
    for (const hsh of screens(id)) {
      await go(page, hsh);
      await noSideways(page, `demo ${w} ${hsh}`);
      if (w !== 390) await axe(page, `demo ${w} ${hsh}`);
      if (w === 320) await shot(page, `320-${hsh.replace(/[#/]+/g, '-').replace(/^-|-$/g, '') || 'home'}`);
    }
  });
}

test('demo at 320px, 200% text: the bar never overlaps on any screen', async ({ phone }) => {
  const page = await demo(phone, 'demo 320 big', 320, 640);
  const id = await idOf(page, 'Light soy sauce');
  await bigText(page);
  for (const hsh of screens(id)) {
    await go(page, hsh);
    await page.evaluate(() => scrollTo(0, 900));
    await barApart(page, `demo 320 200% ${hsh}`);
  }
});

test('demo at 390px: edit saves and returns; delete with Undo', async ({ phone }) => {
  const page = await demo(phone, 'demo edit', 390, 844);
  const id = await idOf(page, 'Light soy sauce');
  await go(page, '#/item/' + id);
  await page.click('[data-act="edit"]');
  await page.fill('#pa-form [name="name"]', 'Light soy sauce (big)');
  await page.click('#pa-save');
  await expect(page.locator('h1'), 'edit saves and returns').toHaveText('Light soy sauce (big)');
  expect(hash(page)).toBe('#/item/' + id);
  // delete with Undo
  await page.click('[data-act="delete"]');
  const gone = () => page.evaluate(i => { const it = window.__pantry.S.items.get(i); return !it || !!it.removedAt; }, id);
  await expect.poll(gone, 'delete removes it (a marker; it is hidden everywhere)').toBe(true);
  await undo(page);
  await expect.poll(gone, 'Undo restores it').toBe(false);
});

test('demo at 390px, 200% text: still no sideways scroll, the bar stays apart', async ({ phone }) => {
  const page = await demo(phone, 'demo 390 big', 390, 844);
  const id = await idOf(page, 'Light soy sauce');
  await bigText(page);
  for (const hsh of screens(id)) { await go(page, hsh); await noSideways(page, `demo 200% ${hsh}`); await barApart(page, `demo 200% ${hsh}`); }
});
