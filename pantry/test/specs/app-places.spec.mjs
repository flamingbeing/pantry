// Places (Settings → Places): the household's own list, in the demo: the defaults with counts, add, rename with Undo, the
// kind of a place, reorder, remove (items asking where they go), places an item uses that aren't in the list, Say or
// type knowing the places, and 200% text and narrow phones. Run: npx playwright test app-places
import { test, expect } from './fixtures.mjs';
import { BASE, open, go, hash, undo, sheetOpen, noSideways, sheetFits, barApart, bigText, shot, idOf } from './app-helpers.mjs';

const DEFAULTS = ['Kitchen cabinet', 'Fridge', 'Level 1 fridge', 'Freezer', 'Level 1 freezer', 'Store room', 'Basement store', 'Bathroom', 'Laundry', 'Medicine box', 'Other'];
const state = page => page.evaluate(() => ({ list: window.__pantry.places(), items: [...window.__pantry.S.items.values()].filter(i => !i.removedAt).map(i => ({ id: i.id, name: i.name, location: i.location })) }));
const list = page => page.evaluate(() => window.__pantry.places());
const rows = page => page.locator('#pa-places .pa-row-title');
const countOf = (page, name) => page.locator('#pa-places .ui-row, #pa-places-other .ui-row').filter({ has: page.locator('.pa-row-title', { hasText: new RegExp(`^${name}$`) }) }).locator('.ui-row-value').textContent().then(t => t.replace(/\D+/g, ''));
const openPlace = async (page, name) => { await page.locator(`[data-act="place-open"][data-v="${name}"]`).click(); await expect(sheetOpen(page)).toBeVisible(); };
const kindOf = (page, n) => page.evaluate(x => [...window.__pantry.S.places.values()].find(p => p.name === x && !p.removedAt)?.kind, n);
const placeOptions = page => page.locator('#pa-form [name="location"] option').allTextContents();
async function demoPlaces(phone, name, opts) {
  const page = await open(phone, name, BASE + '?demo', opts);
  await go(page, '#/settings');
  await page.click('#main a[href="#/places"]');
  await expect.poll(() => hash(page)).toBe('#/places');
  return page;
}
// a new place on the Places screen, at the end of the list
async function addPlace(page, name) {
  await page.fill('#pa-place-name', name);
  await page.press('#pa-place-name', 'Enter');
  await expect(rows(page).last()).toHaveText(name);
}

test('Places opens from Settings with the defaults and their counts', async ({ phone, axe }) => {
  const page = await open(phone, 'places', BASE + '?demo');
  await go(page, '#/settings');
  await expect(page.locator('#h-places'), 'Settings has Where things are kept').toHaveCount(1);
  await page.click('#main a[href="#/places"]');
  await expect.poll(() => hash(page)).toBe('#/places');
  await expect(page.locator('h1'), 'Places opens from Settings').toHaveText('Places');
  await expect(page.locator('.pa-back span'), 'its back button names Settings').toHaveText('Settings');
  await expect(page.locator('.ui-tab[aria-current="page"]'), 'Settings stays the tab').toHaveAttribute('href', '#/settings');
  await expect(rows(page), 'the default places, the owner’s three included').toHaveText(DEFAULTS);
  const st = await state(page);
  for (const p of ['Fridge', 'Level 1 freezer', 'Basement store', 'Bathroom']) {
    await expect.poll(() => countOf(page, p), `${p}: its item count`).toBe(String(st.items.filter(i => i.location === p).length));
  }
  expect(await countOf(page, 'Level 1 freezer') === '1' && await countOf(page, 'Basement store') === '1', 'the demo keeps one thing on Level 1 freezer and one in Basement store').toBe(true);
  await axe(page, 'places');
  await shot(page, 'places', true);
});

test('add a place: tidy name, no duplicates (any case), not empty; then use it in Add', async ({ phone, axe }) => {
  const page = await demoPlaces(phone, 'add place');
  await page.click('#pa-place-add button[type=submit]');
  await expect(page.locator('#pa-place-err'), 'an empty name is refused').toBeVisible();
  await expect(page.locator('#pa-place-name')).toHaveAttribute('aria-invalid', 'true');
  await page.fill('#pa-place-name', ' FRIDGE ');
  await page.click('#pa-place-add button[type=submit]');
  await expect(page.locator('#pa-place-err'), 'a duplicate (any case) is refused').toContainText('Fridge is already in your list');
  await expect(page.locator('#pa-place-name'), 'names stop at 40 characters').toHaveAttribute('maxlength', '40');
  await page.fill('#pa-place-name', '  Level 2   fridge ');
  await page.press('#pa-place-name', 'Enter');
  await expect(rows(page).last(), 'a new place goes at the end, tidied').toHaveText('Level 2 fridge');
  await expect(page.locator('#pa-place-err')).toBeHidden();
  await expect.poll(() => list(page), 'and is saved as the household’s list').toEqual([...DEFAULTS, 'Level 2 fridge']);
  await axe(page, 'places with an error cleared');
  // use it in Add
  await go(page, '#/add');
  await expect.poll(async () => { const o = await placeOptions(page); return o.at(-1) === 'Level 2 fridge' && o.includes('Level 1 freezer') && o.includes('Basement store'); }, 'Kept in offers the list').toBe(true);
  await page.fill('#pa-form [name="name"]', 'Homemade sambal');
  await page.selectOption('#pa-form [name="location"]', 'Level 2 fridge');
  await page.click('#pa-save');
  await expect.poll(async () => (await state(page)).items.find(i => i.name === 'Homemade sambal')?.location, 'an item added in the new place').toBe('Level 2 fridge');
  await go(page, '#/places');
  await expect.poll(() => countOf(page, 'Level 2 fridge'), 'its count shows on Places').toBe('1');
});

test('rename a place: its items move with it, Undo; the kind of a place', async ({ phone, axe }) => {
  const page = await demoPlaces(phone, 'rename');
  await addPlace(page, 'Level 2 fridge');
  const fridgeIds = (await state(page)).items.filter(i => i.location === 'Fridge').map(i => i.id);
  expect(fridgeIds.length, 'several things in the Fridge').toBeGreaterThanOrEqual(3);
  const sheet = sheetOpen(page);
  await openPlace(page, 'Fridge');
  await expect(sheet.locator('.pa-sheet-title')).toHaveText('Fridge');
  await expect(sheet.locator('#pa-pl-pos'), 'a place opens in a sheet with its position').toHaveText('2 of 12 in your list');
  await axe(page, 'place sheet');
  await shot(page, 'place-sheet');
  await page.fill('#pa-pl-name', 'level 1 FRIDGE');
  await sheet.locator('#pa-pl-form button[type=submit]').click();
  await expect(sheet.locator('#pa-pl-err'), 'renaming to another place’s name is refused').toContainText('Level 1 fridge is already in your list');
  await page.fill('#pa-pl-name', 'Kitchen fridge');
  await sheet.locator('#pa-pl-form button[type=submit]').click();
  await expect(sheet, 'the sheet closes').toHaveCount(0);
  await expect.poll(async () => { const n = await state(page); return n.list[1] === 'Kitchen fridge' && !n.list.includes('Fridge'); }, 'renamed in place in the list').toBe(true);
  await expect.poll(async () => { const n = await state(page); return fridgeIds.every(id => n.items.find(i => i.id === id).location === 'Kitchen fridge') && !n.items.some(i => i.location === 'Fridge'); }, 'every item in it moved with the new name').toBe(true);
  expect(hash(page)).toBe('#/places');
  await expect(rows(page).nth(1), 'the list shows the new name').toHaveText('Kitchen fridge');
  await undo(page);
  await expect.poll(async () => { const n = await state(page); return n.list[1] === 'Fridge' && fridgeIds.every(id => n.items.find(i => i.id === id).location === 'Fridge'); }, 'Undo puts the name and the items back').toBe(true);

  // the kind of a place: guessed from the name, set in its sheet (one field of its document)
  await openPlace(page, 'Level 2 fridge');
  await expect(sheet.locator('input[name="pa-pl-kind"]:checked')).toHaveValue('fridge');
  await expect(sheet.locator('#pa-pl-kind-note'), 'a fridge by its name, guessed').toHaveText(/^Guessed from the name\./);
  await sheet.locator('.pa-pl-kind label', { hasText: 'Freezer' }).click();
  await expect.poll(() => kindOf(page, 'Level 2 fridge'), 'set to Freezer: saved on the place').toBe('freezer');
  await expect(sheet.locator('#pa-pl-kind-note'), 'no longer a guess').not.toHaveText(/^Guessed/);
  await axe(page, 'place kind');
  await sheet.locator('.pa-pl-kind label', { hasText: 'Fridge' }).click();
  await expect.poll(() => kindOf(page, 'Level 2 fridge'), 'and back').toBe('fridge');
  await sheet.locator('[data-pa-close]').first().click();
  await expect(sheet).toHaveCount(0);
  await go(page, '#/items');
  await expect(page.locator('[data-act="place"][data-v="Fridge"]'), 'Items filters by the place').toHaveCount(1);
});

test('reorder a place: up and down move it one place, the pickers follow', async ({ phone }) => {
  const page = await demoPlaces(phone, 'reorder');
  await addPlace(page, 'Level 2 fridge');
  // the Items filter offers a place that has something in it
  await go(page, '#/add');
  await page.fill('#pa-form [name="name"]', 'Homemade sambal');
  await page.selectOption('#pa-form [name="location"]', 'Level 2 fridge');
  await page.click('#pa-save');
  await expect.poll(() => hash(page)).toMatch(/^#\/item\//);
  await go(page, '#/places');
  const sheet = sheetOpen(page);
  await openPlace(page, 'Level 2 fridge');
  await expect(sheet.locator('[data-pl="down"]'), 'the last one cannot move down').toBeDisabled();
  await expect(sheet.locator('[data-pl="up"]'), 'the last one can only move up').toBeEnabled();
  const box = await sheet.locator('[data-pl="up"]').boundingBox();
  expect(box.height >= 44 && box.width >= 44, `move buttons are at least 44px (${Math.round(box.width)}x${Math.round(box.height)})`).toBe(true);
  await expect(sheet.locator('[data-pl="up"]'), 'move buttons say which place').toHaveAttribute('aria-label', 'Move up, Level 2 fridge');
  for (let i = 1; i <= 9; i++) {
    await sheet.locator('[data-pl="up"]').click();
    await expect(sheet.locator('#pa-pl-pos')).toHaveText(`${12 - i} of 12 in your list`);
  }
  await page.goBack();
  await expect(sheet, 'back closes the place sheet').toHaveCount(0);
  expect(hash(page)).toBe('#/places');
  await expect(rows(page), 'the list shows the new order').toHaveText(['Kitchen cabinet', 'Fridge', 'Level 2 fridge', 'Level 1 fridge', 'Freezer', 'Level 1 freezer', 'Store room', 'Basement store', 'Bathroom', 'Laundry', 'Medicine box', 'Other']);
  await go(page, '#/add');
  await expect.poll(async () => (await placeOptions(page)).slice(0, 3).join(', '), 'and so does Kept in').toBe('Kitchen cabinet, Fridge, Level 2 fridge');
  await go(page, '#/items');
  await expect.poll(async () => {
    const chips = await page.locator('[data-act="place"]').evaluateAll(b => b.map(x => x.dataset.v).filter(Boolean));
    return chips.indexOf('Level 2 fridge') < chips.indexOf('Level 1 freezer') && chips.indexOf('Fridge') < chips.indexOf('Level 2 fridge') && chips.includes('Level 2 fridge');
  }, 'and the Items filter').toBe(true);
});

test('remove a place: with items it asks where they go; empty ones go at once; Undo either way', async ({ phone, axe }) => {
  const page = await demoPlaces(phone, 'remove');
  const sheet = sheetOpen(page);
  await openPlace(page, 'Basement store');
  await sheet.locator('[data-pl="remove"]').click();
  await expect(sheet.locator('.pa-sheet-title'), 'removing a place with items asks where they go').toHaveText('Remove Basement store');
  expect(await sheet.locator('#pa-mv-to option').allTextContents(), 'not back into itself').not.toContain('Basement store');
  await axe(page, 'remove a place with items');
  await shot(page, 'place-remove-with-items');
  await page.goBack();
  await expect(sheet, 'back cancels').toHaveCount(0);
  expect((await state(page)).list, 'nothing removed').toContain('Basement store');
  await openPlace(page, 'Basement store');
  await sheet.locator('[data-pl="remove"]').click();
  await expect(sheet.locator('.pa-sheet-title')).toHaveText('Remove Basement store');
  const moving = (await state(page)).items.filter(i => i.location === 'Basement store').map(i => i.id);
  const listBefore = (await state(page)).list;
  await page.selectOption('#pa-mv-to', 'Store room');
  await sheet.locator('#pa-mv-go').click();
  await expect.poll(async () => { const n = await state(page); return !n.list.includes('Basement store') && moving.every(id => n.items.find(i => i.id === id).location === 'Store room') && !n.items.some(i => i.location === 'Basement store'); }, 'removed, and its items moved to Store room').toBe(true);
  await undo(page);
  await expect.poll(async () => { const n = await state(page); return JSON.stringify(n.list) === JSON.stringify(listBefore) && moving.every(id => n.items.find(i => i.id === id).location === 'Basement store'); }, 'Undo brings the place and its items back').toBe(true);
  await openPlace(page, 'Bathroom');
  await sheet.locator('[data-pl="remove"]').click();
  await expect(sheet, 'an empty place goes at once').toHaveCount(0);
  await expect.poll(async () => !(await list(page)).includes('Bathroom')).toBe(true);
  await expect(rows(page).filter({ hasText: /^Bathroom$/ })).toHaveCount(0);
  expect(await page.evaluate(() => [...window.__pantry.S.places.values()].some(p => p.name === 'Bathroom' && typeof p.removedAt === 'string')), 'removing a place is a marker, the document stays').toBe(true);
  await undo(page);
  await expect.poll(async () => (await list(page)).includes('Bathroom'), 'Undo puts the place back where it was').toBe(true);
  await expect(rows(page).filter({ hasText: /^Bathroom$/ })).toHaveCount(1);
  await openPlace(page, 'Bathroom');
  await sheet.locator('[data-pl="remove"]').click();
  await expect(sheet).toHaveCount(0);
  await go(page, '#/removed');
  await expect(page.locator('#pa-removed-places'), 'a removed place waits in Recently removed').toContainText(/Bathroom.*Place/);
});

test('a place an item uses that isn’t in the list is still shown everywhere, and can be added', async ({ phone }) => {
  const page = await demoPlaces(phone, 'shed');
  const sid = await idOf(page, 'Kaya');
  await page.evaluate(id => { const S = window.__pantry.S; S.items.set(id, { ...S.items.get(id), location: 'Shed' }); }, sid);
  await go(page, '#/settings'); await go(page, '#/places');
  await expect(page.locator('#h-places-other'), 'Not in your list shows Shed').toHaveCount(1);
  await expect.poll(() => countOf(page, 'Shed'), 'with its count').toBe('1');
  await go(page, '#/edit/' + sid);
  await expect(page.locator('#pa-form [name="location"]')).toHaveValue('Shed');
  await expect(page.locator('#pa-form optgroup[label="Not in your list"] option', { hasText: 'Shed' }), 'the item keeps Shed, shown as not in your list').toHaveCount(1);
  await go(page, '#/items');
  await expect(page.locator('[data-act="place"][data-v="Shed"]'), 'and Items can filter by it').toHaveCount(1);
  await go(page, '#/places');
  await openPlace(page, 'Shed');
  await sheetOpen(page).locator('[data-pl="list"]').click();
  await expect.poll(async () => (await list(page)).at(-1), 'Add to your list').toBe('Shed');
  await expect(page.locator('#h-places-other')).toHaveCount(0);
});

test('Places at 200% text: no sideways scroll, the bar apart, the place sheet fits', async ({ phone }) => {
  const page = await demoPlaces(phone, 'places big');
  await noSideways(page, 'places 390');
  await bigText(page);
  await noSideways(page, 'places 200%'); await barApart(page, 'places 200%');
  await openPlace(page, 'Fridge');
  await sheetFits(page, 'place sheet at 200%');
});

test('Say or type knows the household’s places', async ({ phone }) => {
  const page = await demoPlaces(phone, 'say places');
  await addPlace(page, 'Level 2 fridge');
  await go(page, '#/');
  await page.click('[data-act="quick"]');
  await page.fill('#pa-quick-text', '2 jars of jam in the level 2 fridge and tissue in the basement');
  const said = page.locator('#pa-quick-list .ui-row-sub');
  await expect(said.nth(0), 'Say or type finds Level 2 fridge').toContainText('Level 2 fridge');
  await expect(said.nth(1), 'and the basement').toContainText('Basement store');
});

for (const [w, h] of [[360, 780], [320, 640]]) {
  test(`Places at ${w}px: no sideways scroll, axe clean, the place sheet fits`, async ({ phone, axe }) => {
    const page = await demoPlaces(phone, `places ${w}`, { width: w, height: h });
    await noSideways(page, `places ${w}`); await axe(page, `places ${w}`);
    await openPlace(page, 'Level 1 freezer');
    await sheetFits(page, `place sheet ${w}`);
  });
}
