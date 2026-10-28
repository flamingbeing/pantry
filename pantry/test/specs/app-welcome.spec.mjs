// The welcome (once per phone, never in plain ?demo), every card, "Add my first item"/"Pick what you have", the installed
// and invited versions, and the welcome and the guide at 390, 360 and 320px and at 200% text: no sideways scroll, axe clean,
// the top bar's parts apart. Run: npx playwright test app-welcome
import { test, expect } from './fixtures.mjs';
import { BASE, open, go, hash, sheetOpen, welcomeSheet, card, nextCard, welcomeDecided, noSideways, sheetFits, barApart, bigText, shot, quiet } from './app-helpers.mjs';

test('plain ?demo shows no welcome', async ({ phone }) => {
  const page = await open(phone, 'demo', BASE + '?demo');
  await welcomeDecided(page);
  await expect(welcomeSheet(page)).toHaveCount(0);
});

test('the welcome in the demo (?welcome): every card, Back, Close, Pick what you have', async ({ phone, axe }) => {
  const page = await open(phone, 'cards', BASE + '?demo&welcome');
  await expect(welcomeSheet(page)).toBeVisible();
  await card(page, 'Welcome to the pantry');
  await expect(welcomeSheet(page).locator('[data-pa-w="prev"]'), 'no Back on the first card').toBeHidden();
  await axe(page, 'welcome card 1');
  await shot(page, 'w1-intro');
  await nextCard(page);
  await card(page, 'Fill it in a minute');
  await expect(welcomeSheet(page).locator('.pa-dot').nth(1), 'dot 2 is current').toHaveClass(/is-current/);
  await expect(welcomeSheet(page).locator('.pa-wtitle'), 'card 2: focus moves to its title').toBeFocused();
  await axe(page, 'welcome card 2');
  await shot(page, 'w2-fill');
  await expect(welcomeSheet(page).locator('[data-pa-w="next"]'), 'no Next on the last card').toHaveCount(0);
  await expect(welcomeSheet(page).locator('.ui-sheet-head [data-pa-close]'), 'the last card says Close, not Skip').toHaveText('Close');
  await welcomeSheet(page).locator('[data-pa-w="prev"]').click();
  await card(page, 'Welcome to the pantry');   // Back shows the previous card
  await nextCard(page);
  await expect(welcomeSheet(page).locator('[data-pa-w="done"]'), 'a quiet Look around first').toHaveText('Look around first');
  await welcomeSheet(page).locator('[data-pa-w="start"]').click();
  await expect(sheetOpen(page).locator('.pa-sheet-title'), 'Pick what you have opens the quick start').toHaveText('What do you have?');
  expect(await page.evaluate(() => localStorage.getItem('pantry:welcomed')), 'the demo saves no flag').toBeNull();
});

test('installed (opened from the home screen): no home-screen card', async ({ phone }) => {
  const page = await open(phone, 'installed', BASE + '?demo&welcome', { init: () => Object.defineProperty(navigator, 'standalone', { get: () => true }) });
  await expect(welcomeSheet(page)).toBeVisible();
  await expect(welcomeSheet(page).locator('.pa-dot'), 'installed: two cards').toHaveCount(2);
  await nextCard(page);
  await card(page, 'Fill it in a minute');   // installed: straight to filling it in
});

test('opened from an invite (the link ends #/settings): short, ends at Sign in, on the Settings screen', async ({ phone, axe }) => {
  const page = await open(phone, 'invite', BASE + '?demo&welcome#/settings');
  await expect(welcomeSheet(page)).toBeVisible();
  await card(page, 'Welcome to the family pantry');   // invite: says they were added
  await expect(welcomeSheet(page).locator('.pa-dot'), 'invite: three cards').toHaveCount(3);
  await nextCard(page);
  await nextCard(page);
  await card(page, 'Sign in to join');
  await axe(page, 'welcome invite');
  await shot(page, 'w5-invite-signin');
  await welcomeSheet(page).locator('[data-pa-w="signin"]').click();
  await expect(welcomeSheet(page), 'Go to sign in closes it').toHaveCount(0);
  expect(hash(page), 'and leaves them on Settings').toBe('#/settings');
});

for (const [w, h] of [[390, 844], [360, 780], [320, 640]]) {
  test(`the welcome and the guide at ${w}px: no sideways scroll, axe clean, the bar stays apart`, async ({ phone, axe }) => {
    const page = await open(phone, `welcome ${w}`, BASE + '?demo&welcome', { width: w, height: h });
    await expect(welcomeSheet(page)).toBeVisible();
    await card(page, 'Welcome to the pantry');
    for (let i = 1; i <= 2; i++) {
      await noSideways(page, `welcome ${w} card ${i}`);
      if (w !== 390) await axe(page, `welcome ${w} card ${i}`);
      if (i < 2) { await nextCard(page); await card(page, 'Fill it in a minute'); }
    }
    await welcomeSheet(page).locator('[data-pa-w="done"]').click();
    await expect(welcomeSheet(page), `welcome ${w}: Look around first closes it`).toHaveCount(0);
    expect(hash(page)).toBe('#/');
    await go(page, '#/guide');
    await noSideways(page, `guide ${w}`);
    await axe(page, `guide ${w}`);
    // the bar ("Pantry" back, "How to use it") stays apart, at normal and 200% text
    await page.evaluate(() => scrollTo(0, 900)); await quiet(page);
    await barApart(page, `guide ${w} bar`);
    await bigText(page);
    await barApart(page, `guide ${w} bar at 200% text`);
    if (w === 390) await shot(page, 'g0-guide-bar-200pc');
    await bigText(page, false);
    await page.evaluate(() => scrollTo(0, 0));
    if (w === 390) {
      await shot(page, 'g1-guide-top');
      await page.evaluate(() => scrollTo(0, 900)); await shot(page, 'g2-guide-scrolled');
      await page.evaluate(() => scrollTo(0, 2000)); await shot(page, 'g3-guide-more');
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await shot(page, 'g4-guide-end');
      // the guide's own "Show the welcome again"
      await page.click('[data-act="welcome"]');
      await expect(welcomeSheet(page), 'the guide can show the welcome again').toHaveCount(1);
      await page.goBack();
      await expect(welcomeSheet(page)).toHaveCount(0);
      expect(hash(page), 'closing it stays on the guide').toBe('#/guide');
      // 200% text
      await bigText(page);
      await noSideways(page, 'guide 200%');
      await page.click('[data-act="welcome"]');
      await expect(welcomeSheet(page)).toBeVisible();
      for (let i = 1; i <= 2; i++) {
        await noSideways(page, `welcome 200% card ${i}`);
        await sheetFits(page, `welcome 200% card ${i}`);
        if (i === 2) await shot(page, 'w6-200pc');
        if (i < 2) { await nextCard(page); await card(page, 'Fill it in a minute'); }
      }
    }
  });
}
