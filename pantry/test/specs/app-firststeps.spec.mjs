// First steps on a fresh phone: the quick start ("What do you have?") and the Getting started checklist with its Show me
// buttons, and nothing new for someone already using the app. Run: npx playwright test app-firststeps
import { test, expect } from './fixtures.mjs';
import { open, go, hash, toast, sheetOpen, welcomeSheet, card, nextCard, welcomeDecided, live, itemNamed, shot, TAB } from './app-helpers.mjs';

test('the quick start and the Getting started checklist', async ({ phone, axe }) => {
  const page = await open(phone, 'steps');
  await expect(welcomeSheet(page)).toBeVisible();
  await nextCard(page);
  await card(page, 'Fill it in a minute');
  await welcomeSheet(page).locator('[data-pa-w="start"]').click();
  const sheet = sheetOpen(page);
  const chips = sheet.locator('.pa-start-chips .ha-chip');
  await expect(chips.nth(19)).toBeVisible();
  expect(await chips.count(), 'the quick start offers everyday things').toBeGreaterThanOrEqual(20);
  for (const n of ['Fresh milk', 'Eggs', 'Thai hom mali rice', 'Bathroom tissue']) await sheet.locator('.pa-start-chips .ha-chip', { hasText: n }).first().click();
  await expect(page.locator('#pa-start-go'), 'the button counts the picks').toHaveText('Add 4 items');
  await axe(page, 'quick start');
  await shot(page, 't1-quick-start');
  await page.click('#pa-start-go');
  await expect(toast(page), 'adds them').toContainText('Added 4 items');
  await expect.poll(() => live(page), 'four items in the pantry').toBe(4);
  const milk = await itemNamed(page, 'Fresh milk');
  expect(milk.batches[0].expiry && milk.location === 'Fridge', 'with a rough date and its usual place').toBeTruthy();
  const count = page.locator('#h-tour .ha-num');
  const total = await page.locator('#h-tour').locator('xpath=..').locator('.pa-tour-row').count();
  await expect(count, 'the checklist ticks "Add what you have"').toHaveText(`1 of ${total}`);
  await axe(page, 'home with the checklist');
  await shot(page, 't2-checklist', true);
  // Show me: Used 1 is pointed at on an item
  await page.click('[data-act="tour-show"][data-task="use"]');
  await expect.poll(() => hash(page), 'Show me opens an item').toMatch(/^#\/item\//);
  await expect(page.locator('[data-act="use"].pa-spot'), 'and rings Used 1').toHaveCount(1);
  await shot(page, 't3-show-me');
  await page.locator('[data-act="use"]').first().click();
  await page.click('.ha-back');
  await expect(count, 'Used 1 ticks it').toHaveText(`2 of ${total}`);
  // the shopping list, the home-screen tip, and Say or type
  await page.click('[data-act="tour-show"][data-task="shop"]');
  await expect.poll(() => hash(page), 'Show me opens the shopping list').toBe('#/shop');
  await TAB(page, '#/').click();
  await page.click('[data-act="tour-show"][data-task="install"]');
  await expect(sheetOpen(page).locator('.ha-sheet-title'), 'the home-screen steps').toHaveText('On your home screen');
  await page.click('dialog.ha-sheet[open] [data-ha-close]');
  await expect(sheetOpen(page)).toHaveCount(0);
  await page.click('[data-act="tour-show"][data-task="say"]');
  await page.fill('#pa-quick-text', 'kaya in the fridge');
  await expect(page.locator('#pa-quick-list li')).toHaveCount(1);
  await page.click('#pa-quick-go');
  await expect(count, 'shopping, home screen and Say or type tick').toHaveText(`5 of ${total}`);
  if (total === 6) {
    await page.click('[data-act="tour-show"][data-task="family"]');
    await expect.poll(() => hash(page), 'Show me for the family opens Settings').toBe('#/settings');
    await expect(page.locator('.pa-spot'), 'and rings the sign-in button').toHaveCount(1);
  }
  // hide it, then bring it back from Settings
  await go(page, '#/');
  await page.click('[data-act="tour-hide"]');
  await expect(page.locator('#h-tour')).toHaveCount(0);
  await go(page, '#/settings');
  await page.click('[data-act="tour-on"]');
  await expect.poll(() => hash(page)).toBe('#/');
  await expect(page.locator('#h-tour'), 'Settings brings the checklist back').toHaveCount(1);
});

test('an existing family (a phone that has seen the welcome): no checklist appears', async ({ phone }) => {
  const page = await open(phone, 'existing', undefined, { init: () => { localStorage.setItem('pantry:welcomed', 'true'); } });
  await welcomeDecided(page);
  await expect(page.locator('#h-tour'), 'no checklist for someone already using it').toHaveCount(0);
});
