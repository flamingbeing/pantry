// The pantry on a phone (390px), on the phone's own pantry (IndexedDB), no sign-in: the first open, adding from the
// catalogue, open one / Used 1 / Undo, Use soon, the shopping list (tick, Put away), sample items, binning an expired
// thing, Say or type, the Items list, Settings and the guide, the backup file, the version lines, and the app and its data
// offline through the service worker. Each test brings its own server (so its own service worker and storage) and makes
// its own data. Run: npx playwright test app-pantry
import fs from 'node:fs';
import { test, expect } from './fixtures.mjs';
import { open, go, hash, toast, undo, sheetOpen, ymdPlus, welcomeSheet, card, welcomeDecided, live, itemNamed, shot, TAB,
  sectionOf, addSoy, sampleItems, WELCOMED } from './app-helpers.mjs';

const home = page => TAB(page, '#/').click();

test('first open: the welcome once per phone, the Getting started list, the empty screens', async ({ phone, axe }) => {
  const page = await open(phone, 'first');
  await expect(welcomeSheet(page)).toBeVisible();
  await card(page, 'Welcome to the pantry');
  await expect(welcomeSheet(page).locator('.pa-dot'), 'two cards for someone new').toHaveCount(2);
  await shot(page, 'w0-first-open');
  await welcomeSheet(page).locator('.ui-sheet-head [data-pa-close]', { hasText: 'Skip' }).click();
  await expect(welcomeSheet(page), 'Skip closes it').toHaveCount(0);
  expect(hash(page), 'and stays on Home').toBe('#/');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pantry:welcomed')), 'Skip remembers it').toBe('true');
  await page.reload();
  await expect(page.locator('.ui-large-title')).toBeVisible();
  await welcomeDecided(page);
  await expect(welcomeSheet(page), 'the welcome does not come back after a reload').toHaveCount(0);
  // a first-time user gets the Getting started checklist on Home; hiding it puts it away (Settings can bring it back)
  await expect(page.locator('#h-tour'), 'first open: Getting started on Home').toHaveCount(1);
  await page.click('[data-act="tour-hide"]');
  await expect(page.locator('#h-tour'), 'Hide this list hides it').toHaveCount(0);
  await expect(page.locator('.ui-empty-title', { hasText: 'Nothing here yet' }), 'empty pantry says so').toBeVisible();
  await expect(page.locator('.ui-empty a[href="#/guide"]'), 'empty Home links to the guide').toBeVisible();
  await go(page, '#/shop');
  await expect(sectionOf(page, 'h-shop').locator('.ui-section-foot'), 'an empty shopping list says how things get there').toContainText('come here by themselves');
  await go(page, '#/settings');
  if (await page.locator('[data-act="signin"]').count()) await expect(sectionOf(page, 'h-family').locator('.ui-section-foot'), 'signed out: one line on why to sign in').toHaveText(/^Sign in to share/);
  await home(page);
  await expect(page.locator('.ui-tab[aria-current="page"]'), 'Pantry tab current').toHaveAttribute('href', '#/');
  await axe(page, 'empty home');
  await shot(page, '01-empty');
});

test('add from the Singapore catalogue: the form fills, the item opens', async ({ phone, axe }) => {
  const page = await open(phone, 'add', undefined, { init: WELCOMED });
  await page.click('[data-act="go-add"]:visible');
  await expect.poll(() => hash(page), 'Add opens the add screen').toBe('#/add');
  await expect(page.locator('.ui-tabbar'), 'a task swaps the tab bar for a toolbar').toBeHidden();
  await expect(page.locator('#pa-toolbar')).toBeVisible();
  await page.fill('#pa-find', 'kikkoman soy');
  await page.locator('#pa-sugg [data-act="sugg"]').first().click();
  await expect(page.locator('#pa-form [name="name"]'), 'catalogue fills the name').toHaveValue('Light soy sauce');
  await expect(page.locator('#pa-form [name="brand"]'), 'and the brand').toHaveValue('Kikkoman');
  await expect(page.locator('#pa-form [name="openDays"]'), 'and keeps-once-opened days').toHaveValue('90');
  await page.click('#pa-qty [data-step="1"]');
  await expect(page.locator('#pa-qty input'), 'stepper adds one').toHaveValue('2');
  await page.click('.pa-dates [data-act="date"]:has-text("1 year")');
  await expect(page.locator('#pa-form [name="expiry"]'), 'quick date fills the date').toHaveValue(ymdPlus(365));
  await axe(page, 'add form');
  await shot(page, '02-add', true);
  await page.click('#pa-save');
  await expect.poll(() => hash(page), 'saving opens the item').toMatch(/^#\/item\//);
  await expect(page.locator('h1'), 'item title').toHaveText('Light soy sauce');
  await expect(page.locator('#h-stock .pa-num'), 'two in stock').toHaveText('2');
});

test('an item: open one, Used 1 and Undo, Buy online links, Bought more, the shopping list, back', async ({ phone, axe }) => {
  const page = await open(phone, 'item', undefined, { init: WELCOMED });
  await addSoy(page);
  await page.locator('[data-act="open"]').first().click();
  await expect(toast(page), 'open says so').toContainText('Opened 1 Light soy sauce');
  await expect(page.locator('.pa-batch .pa-row-title', { hasText: '1 opened' }), 'an opened batch appears').toHaveCount(1);
  await page.locator('.pa-batch', { hasText: '1 opened' }).locator('[data-act="use"]').click();
  await expect(page.locator('#h-stock .pa-num'), 'Used 1 takes one out').toHaveText('1');
  await undo(page);
  await expect(page.locator('#h-stock .pa-num'), 'Undo puts it back').toHaveText('2');
  // Buy online: one search link per shop, opening in a new tab
  const links = page.locator('section[aria-labelledby="h-online"] a.ui-row');
  await expect(links, 'four shop links').toHaveCount(4);
  const shops = await page.$$eval('section[aria-labelledby="h-online"] a.ui-row', as => as.map(a => [a.querySelector('.pa-row-title').textContent, a.href, a.target]));
  expect(shops.map(x => x[0]).join('|'), 'four shop links').toBe('Search FairPrice|Search Sheng Siong|Search Cold Storage|Search Shopee');
  expect(shops.every(x => x[2] === '_blank') && /^https:\/\/shopee\.sg\/search\?keyword=Kikkoman/.test(shops[3][1]) && /^https:\/\/coldstorage\.com\.sg\/search\?q=/.test(shops[2][1]), 'shop links search for the item').toBe(true);
  await axe(page, 'item');
  await shot(page, '03-item', true);

  // Bought more sheet: back closes it and stays on the item
  const itemHash = hash(page);
  await page.click('[data-act="bought"]');
  await expect(sheetOpen(page), 'Bought more opens a sheet').toHaveCount(1);
  await axe(page, 'bought sheet');
  await shot(page, '04-bought');
  await page.goBack();
  await expect(sheetOpen(page), 'back closes the sheet').toHaveCount(0);
  expect(hash(page), 'and stays on the item').toBe(itemHash);

  // add to the shopping list from the item
  await page.click('[data-act="to-list"]');
  await expect(page.locator('[data-act="to-list"]'), 'item shows it is on the list').toContainText('On the shopping list');

  // back from the item returns to where Add was opened from (Home)
  await page.goBack();
  await expect.poll(() => hash(page), 'back from the item returns to Home (the add screen was replaced)').toBe('#/');
});

test('Use soon on Home, an empty name is refused in words, Cancel goes back', async ({ phone }) => {
  const page = await open(phone, 'soon', undefined, { init: WELCOMED });
  await page.click('[data-act="go-add"]:visible');
  await page.fill('#pa-form [name="name"]', 'Baby spinach');
  await page.selectOption('#pa-form [name="category"]', 'Fresh produce');
  await page.selectOption('#pa-form [name="location"]', 'Fridge');
  await page.fill('#pa-form [name="expiry"]', ymdPlus(2));
  await page.click('#pa-save');
  await expect.poll(() => hash(page)).toMatch(/^#\/item\//);
  await home(page);
  const row = sectionOf(page, 'h-use-soon').locator('.ui-row', { hasText: 'Baby spinach' });
  await expect(row, 'expiring item under Use soon').toHaveCount(1);
  await expect(page.locator('.ui-row', { hasText: 'Baby spinach' }).locator('.ui-badge[data-tone="warn"]'), 'with an in 2 days badge').toHaveText('in 2 days');
  // an empty name is refused in words
  await page.click('[data-act="go-add"]:visible');
  await page.click('#pa-save');
  await expect(page.locator('#pa-name-err'), 'empty name shows an error').toBeVisible();
  await page.click('[data-act="back"]');
  await expect.poll(() => hash(page), 'Cancel goes back').toBe('#/');
});

test('shopping: add a line by hand, grouped by aisle; tick -> In the trolley -> Put away, Undo, remove', async ({ phone, axe }) => {
  const page = await open(phone, 'shop', undefined, { init: WELCOMED });
  await addSoy(page);
  await page.click('[data-act="to-list"]');
  await expect(page.locator('[data-act="to-list"]')).toContainText('On the shopping list');
  await TAB(page, '#/shop').click();
  await page.fill('#pa-shop-text', 'Bananas');
  await page.click('#pa-shop-add button[type=submit]');
  await expect(page.locator('#pa-shop .pa-row-title', { hasText: 'Bananas' }), 'a line added by hand').toHaveCount(1);
  await expect(page.locator('#pa-shop .pa-aisle'), 'lines grouped by aisle, in the catalogue’s order').toHaveText(['Sauces & condiments', 'Fresh produce']);
  await page.locator('#pa-shop label', { hasText: 'Kikkoman Light soy sauce' }).locator('input').click();
  await expect(page.locator('#pa-shop-done label.is-done', { hasText: 'Light soy sauce' }), 'a ticked line goes in the trolley, struck through').toHaveCount(1);
  await expect(sheetOpen(page), 'ticking asks nothing').toHaveCount(0);
  await expect(page.locator('[data-act="put-away"]'), 'Put away counts the ticked lines').toHaveText('Put away 1 thing');
  await expect(page.locator('#pa-wa-going'), 'Going shopping now opens WhatsApp with a message').toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=Going%20shopping%20now/);
  await page.locator('#pa-shop label', { hasText: 'Bananas' }).locator('input').click();
  await expect(page.locator('#pa-shop-done label.is-done'), 'two in the trolley').toHaveCount(2);
  await expect(page.locator('#pa-wa-going'), 'nothing left to buy: no Going shopping').toHaveCount(0);
  await page.click('[data-act="put-away"]');
  const pa = sheetOpen(page);
  await expect(pa.locator('.pa-sheet-title'), 'Put away opens one sheet').toHaveText('Put away');
  await expect(pa.locator('.pa-pa'), 'with a row per ticked line').toHaveCount(2);
  await expect(pa.locator('.pa-pa', { hasText: 'Bananas' }), 'a typed line becomes a new item from the catalogue').toContainText('New item · Fresh produce');
  await expect(pa.locator('.pa-pa', { hasText: 'Bananas' }).locator('[name="expiry"]'), 'with a guessed date').toHaveValue(ymdPlus(5));
  await pa.locator('.pa-pa', { hasText: 'Light soy sauce' }).locator('[name="qty"]').fill('2');
  await axe(page, 'put away sheet');
  await shot(page, '05a-put-away');
  const n0 = await live(page);
  await page.click('#pa-pa-go');
  await expect(sheetOpen(page), 'the sheet closes').toHaveCount(0);
  await expect(toast(page), 'both put away').toContainText('Put away 2 things');
  await expect.poll(() => live(page), 'bananas are a new item').toBe(n0 + 1);
  await expect(page.locator('#pa-shop-done'), 'put-away lines leave the list').toHaveCount(0);
  await expect(page.locator('#pa-shop .pa-row-title', { hasText: 'Bananas' })).toHaveCount(0);
  await expect.poll(async () => (await itemNamed(page, 'Light soy sauce')).batches.reduce((n, b) => n + b.qty, 0), 'two more soy sauce in stock').toBe(4);
  await undo(page);
  await expect.poll(() => live(page), 'Undo takes it all back').toBe(n0);
  await expect(page.locator('#pa-shop-done label.is-done')).toHaveCount(2);
  await page.click('[data-act="put-away"]');
  await sheetOpen(page).locator('.pa-pa', { hasText: 'Light soy sauce' }).locator('input[type=checkbox]').uncheck();
  await expect(page.locator('#pa-pa-go'), 'unticking leaves one out').toHaveText('Put away 1 thing');
  await page.click('#pa-pa-go');
  await expect(page.locator('#pa-shop-done label.is-done', { hasText: 'Light soy sauce' }), 'the unticked one stays in the trolley').toHaveCount(1);
  // remove a line, then Undo
  await page.click('#pa-shop-done [data-act="shop-del"][aria-label="Remove Kikkoman Light soy sauce"]');
  await expect(page.locator('#pa-shop-done'), 'bin removes a line').toHaveCount(0);
  await undo(page);
  await expect(page.locator('#pa-shop-done .pa-row-title', { hasText: 'Light soy sauce' }), 'Undo brings it back').toHaveCount(1);
  await axe(page, 'shopping');
  await shot(page, '05-shop', true);
});

test('sample items, and binning the expired bread counts as expired', async ({ phone, axe }) => {
  const page = await open(phone, 'sample', undefined, { init: WELCOMED });
  await sampleItems(page);
  await expect(sectionOf(page, 'h-expired').locator('.ui-row', { hasText: 'Wholemeal bread' }), 'expired sample under Expired').toHaveCount(1);
  await axe(page, 'home');
  await shot(page, '06-home', true);
  await sectionOf(page, 'h-expired').locator('a.ui-row', { hasText: 'Wholemeal bread' }).click();
  await page.locator('[data-act="toss"]').first().click();
  await expect(toast(page), 'binning past its date says expired').toContainText('(expired)');
  await expect(sectionOf(page, 'h-history'), 'history says expired').toContainText('Expired, thrown away');
  await page.click('.pa-back');
  await expect(sectionOf(page, 'h-month'), 'This month counts used before expiry').toContainText('Used before expiry');
});

test('Say or type: a sentence becomes items to confirm, and Undo', async ({ phone, axe }) => {
  const page = await open(phone, 'say', undefined, { init: WELCOMED });
  await sampleItems(page);
  await page.click('#bar-trail [data-act="quick"]');
  await expect(sheetOpen(page).locator('.pa-sheet-title'), 'the mic opens Say or type').toHaveText('Say or type');
  await page.fill('#pa-quick-text', '2 Meiji milk in the fridge expires 25 Oct, salmon fillet freezer in 3 months and 3 tins of sardines');
  await expect(page.locator('#pa-quick-list li'), 'three things heard').toHaveCount(3);
  await page.locator('#pa-quick-list input').nth(2).uncheck();
  await expect(page.locator('#pa-quick-go'), 'unticking one leaves it out').toHaveText('Add 2 items');
  await axe(page, 'say or type');
  await shot(page, '06b-quick');
  const before = await live(page);
  await page.click('#pa-quick-go');
  await expect(toast(page), 'adds them').toContainText('Added 2 items');
  await expect.poll(() => live(page), 'milk adds to the one at home, salmon is new').toBe(before + 1);
  await undo(page);
  await expect.poll(() => live(page), 'Undo takes them back out').toBe(before);
});

test('Items: search, place chips, sort; an item opened from the list goes back to Items', async ({ phone, axe }) => {
  const page = await open(phone, 'items', undefined, { init: WELCOMED });
  await sampleItems(page);
  await TAB(page, '#/items').click();
  await page.fill('#pa-q', 'kaya');
  await expect(page.locator('#pa-items-list .ui-row'), 'search finds one').toHaveCount(1);
  await page.click('[data-act="q-clear"]');
  await page.click('[data-act="place"][data-v="Fridge"]');
  await expect(page.locator('#pa-items-list .ui-row-sub', { hasText: 'Kitchen cabinet' }), 'place chip filters').toHaveCount(0);
  await page.click('.pa-seg:has(input[value="category"])');
  await expect.poll(() => page.locator('#pa-items-list .ui-section').count(), 'category sort groups the list').toBeGreaterThan(1);
  await page.click('[data-act="place"][data-v=""]');
  await axe(page, 'items');
  await shot(page, '07-items', true);
  await page.locator('#pa-items-list a.ui-row', { hasText: 'Kaya' }).click();
  await expect(page.locator('.pa-back span'), 'back button names Items').toHaveText('Items');
  await page.click('.pa-back');
  await expect.poll(() => hash(page), 'back button returns to Items').toBe('#/items');
});

test('Settings: Use soon, the guide and its back button, the welcome again', async ({ phone }) => {
  const page = await open(phone, 'settings', undefined, { init: WELCOMED });
  await TAB(page, '#/settings').click();
  await expect.poll(() => hash(page)).toBe('#/settings');
  await page.click('[data-act="soon"][data-v="7"]');
  await expect(page.locator('[data-act="soon"][data-v="7"]'), 'Use soon can be 1 week').toHaveAttribute('aria-pressed', 'true');
  await expect(sectionOf(page, 'h-help'), 'Settings has a Help section').toContainText('How to use the pantry');
  await page.click('#main a[href="#/guide"]');
  await expect.poll(() => hash(page)).toBe('#/guide');
  await expect(page.locator('h1'), 'the guide opens from Settings').toHaveText('How to use the pantry');
  await expect(page.locator('.pa-back span'), 'its back button names Settings').toHaveText('Settings');
  await expect(page.locator('.ui-tab[aria-current="page"]'), 'Settings stays the current tab').toHaveAttribute('href', '#/settings');
  await expect(page.locator('#main .ui-section'), 'seven guide sections').toHaveCount(7);
  await page.goBack();
  await expect.poll(() => hash(page), 'back returns to Settings').toBe('#/settings');
  await page.click('#main a[href="#/guide"]');
  await expect.poll(() => hash(page)).toBe('#/guide');
  await page.click('.pa-back');
  await expect.poll(() => hash(page), 'the back button returns to Settings').toBe('#/settings');
  // show the welcome again from Settings: back closes it
  await page.click('[data-act="welcome"]');
  await card(page, 'Welcome to the pantry');
  await page.goBack();
  await expect(welcomeSheet(page), 'back closes the welcome').toHaveCount(0);
  expect(hash(page)).toBe('#/settings');
});

test('the backup file holds items, history and the shopping list', async ({ phone }) => {
  const page = await open(phone, 'backup', undefined, { init: WELCOMED });
  await addSoy(page);
  await sampleItems(page);
  await TAB(page, '#/shop').click();
  await page.fill('#pa-shop-text', 'Bananas');
  await page.click('#pa-shop-add button[type=submit]');
  await expect(page.locator('#pa-shop .pa-row-title', { hasText: 'Bananas' })).toHaveCount(1);
  await go(page, '#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="backup"]')]);
  const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  expect(backup.app).toBe('pantry');
  expect(backup.items.length, 'items').toBeGreaterThanOrEqual(14);
  expect(backup.events.length, 'history').toBeGreaterThan(10);
  expect(backup.shop.filter(m => !m.removedAt).length, 'the list').toBe(1);
});

test('the version lines; no signal says so and keeps the caches', async ({ phone, axe, server }) => {
  const page = await open(phone, 'version', '/pantry/#/settings', { init: WELCOMED, sw: true });
  // the service worker has installed by now: reload so it controls the page, then the version lines show
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.locator('.ui-large-title')).toBeVisible();
  const text = page.locator('#pa-version .pa-version-text');
  await expect(text).toBeVisible();
  await expect(text, 'version line from the running worker').toHaveText(/^App version (v\d+|\d{4}-\d{2}-\d{2} \([0-9a-f]{8}\))$/);
  // runtime caches (pantry-rt-*) sit beside the shell cache: the line still names the version, never one of them
  expect((await page.evaluate(() => caches.keys())).some(k => k.startsWith('pantry-rt-')), 'a runtime cache exists').toBe(true);
  await expect(text).not.toHaveText(/rt-/);
  await expect(page.locator('#pa-version .pa-version-btn'), 'get-latest button').toHaveText('Not updating? Get the latest version');
  expect(await page.evaluate(() => document.querySelector('#main').lastElementChild.id), 'version lines come last').toBe('pa-version');
  await axe(page, 'settings');
  await shot(page, '08-settings', true);
  // no signal: says so, keeps the caches
  server.swOffline = true;
  await page.click('#pa-version .pa-version-btn');
  await expect(page.locator('#pa-version .pa-version-msg')).toHaveText(/No signal|could not be reached/);
  expect((await page.evaluate(() => caches.keys())).some(k => k.startsWith('pantry-')), 'no signal leaves the cache').toBe(true);
  server.swOffline = false;
});

test('offline: the app and its data still open through the service worker', async ({ phone }) => {
  const page = await open(phone, 'offline', undefined, { init: WELCOMED, sw: true });
  await page.click('[data-act="go-add"]:visible');
  await page.fill('#pa-form [name="name"]', 'Baby spinach');
  await page.click('#pa-save');
  await expect.poll(() => hash(page)).toMatch(/^#\/item\//);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.locator('.ui-large-title')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page').toBe(true);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.locator('.ui-large-title')).toBeVisible();
  await go(page, '#/items');
  await expect(page.locator('#pa-items-list .ui-row', { hasText: 'Baby spinach' }), 'offline reload shows the pantry').toHaveCount(1);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.ui-tabbar')).position), 'offline: the kit styles load from the cache').toBe('fixed');
  // the kit comes from another address: its sprite is put in the page, so tab and row icons draw (also offline)
  await page.locator('.pa-sprite symbol').first().waitFor({ state: 'attached' });
  await expect.poll(() => page.evaluate(() => {
    const w = [...document.querySelectorAll('.ui-tabbar use, #main use')].filter(u => u.closest('svg').getClientRects().length).map(u => u.getBBox().width);
    return w.length >= 5 && w.every(x => x > 0);
  }), 'offline: icons draw').toBe(true);
  await page.context().setOffline(false);
});
