// Barcode look-ups in the demo, with no real camera or network: three product databases routed to made-up answers, a fake
// camera that "sees" what the test puts in window.__scanCode, and naming an unknown barcode. Run: npx playwright test app-barcode
import { test, expect } from './fixtures.mjs';
import { BASE, open, go, hash, sheetOpen, noSideways, shot, FAKE_CAMERA } from './app-helpers.mjs';

const HOUSEHOLD = '1111111111116', UNKNOWN = '2222222222222', UNKNOWN2 = '3333333333333';
const field = (page, n) => page.locator(`#pa-form [name="${n}"]`);

async function scanner(phone, name) {
  const page = await open(phone, name, BASE + '?demo', { init: FAKE_CAMERA });
  const asked = [];
  const answer = (host, hits) => page.context().route(`https://${host}/**`, route => {
    const code = (new URL(route.request().url()).pathname.match(/product\/(\d+)\.json/) || [])[1];
    asked.push(`${host} ${code}`);
    if (hits[code]) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ status: 1, product: hits[code] }) });
    if (host.includes('beauty')) return route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: 'oops' });
    return route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"status":0}' });
  });
  await answer('world.openfoodfacts.org', {});
  await answer('world.openproductsfacts.org', { [HOUSEHOLD]: { product_name: 'Laundry liquid test', brands: 'Testbrand', quantity: '3 L' } });
  await answer('world.openbeautyfacts.org', {});
  const scan = async code => {
    await page.evaluate(c => { window.__scanCode = c; }, code);
    await page.click('[data-act="scan"]');
  };
  const unknown = page.locator('dialog.ha-sheet[open]', { has: page.locator('#pa-unk-find') });
  return { page, asked, scan, unknown };
}

test('a household-products hit fills the name and guesses the category and place; a chosen category stays', async ({ phone }) => {
  const { page, asked, scan } = await scanner(phone, 'household');
  await go(page, '#/add');
  await scan(HOUSEHOLD);
  await expect(field(page, 'name')).toHaveValue('Laundry liquid test');
  await expect.poll(() => ['world.openfoodfacts.org', 'world.openproductsfacts.org', 'world.openbeautyfacts.org'].every(h => asked.some(a => a.startsWith(h))), 'all three databases asked').toBe(true);
  await expect(field(page, 'brand'), 'products database fills brand').toHaveValue('Testbrand');
  await expect(field(page, 'size'), 'and size').toHaveValue('3 L');
  await expect(field(page, 'category'), 'and guesses Laundry & cleaning').toHaveValue('Laundry & cleaning');
  await expect(field(page, 'location'), 'and Store room').toHaveValue('Store room');
  await expect(field(page, 'barcode'), 'the barcode is kept').toHaveValue(HOUSEHOLD);
  // a category already chosen is not overridden
  await go(page, '#/'); await go(page, '#/add');
  await page.selectOption('#pa-form [name="category"]', 'Pet');
  await scan(HOUSEHOLD);
  await expect(field(page, 'name')).toHaveValue('Laundry liquid test');
  await expect(field(page, 'category'), 'a chosen category stays').toHaveValue('Pet');
  await expect(field(page, 'location'), 'the place is still guessed').toHaveValue('Store room');
});

test('an unknown barcode opens the sheet: search field focused, barcode already in the form, back closes it', async ({ phone, axe }) => {
  const { page, scan, unknown } = await scanner(phone, 'unknown');
  await go(page, '#/add');
  await scan(UNKNOWN);
  await expect(unknown).toBeVisible();
  await expect(unknown.locator('.ha-sheet-title'), 'unknown barcode: the sheet says so').toHaveText('We don’t know this barcode yet');
  await expect(page.locator('#pa-unk-find'), 'the search field has focus').toBeFocused();
  await expect(unknown.locator('.pa-unk-code'), 'the sheet shows the barcode').toHaveText(UNKNOWN);
  await expect(field(page, 'barcode'), 'the barcode is already in the form').toHaveValue(UNKNOWN);
  await expect(unknown.locator('#pa-unk-list'), 'no list before typing').toBeHidden();
  const targets = await unknown.locator('.ha-row, .ha-sheet-head button').evaluateAll(els => els.filter(e => e.getClientRects().length).map(e => e.getBoundingClientRect().height));
  expect(targets.every(h => h >= 43.5), `sheet targets are 44px (${targets.join(', ')})`).toBe(true);
  await axe(page, 'unknown barcode sheet');
  await noSideways(page, 'unknown barcode sheet');
  await shot(page, '20-unknown-barcode');
  // back closes it and stays on Add with the barcode
  await page.goBack();
  await expect(unknown, 'back closes the sheet').toHaveCount(0);
  expect(hash(page), 'and stays on Add').toBe('#/add');
  await expect(field(page, 'barcode'), 'the barcode stays after closing').toHaveValue(UNKNOWN);
});

test('picking a catalogue product fills the form and attaches the barcode', async ({ phone, axe }) => {
  const { page, scan, unknown } = await scanner(phone, 'catalogue');
  await go(page, '#/add');
  await scan(UNKNOWN);
  await expect(unknown).toBeVisible();
  await page.fill('#pa-unk-find', 'laundry liquid');
  await expect(unknown.locator('#pa-unk-list [data-act="unk-cat"]').first()).toBeVisible();
  await expect.poll(async () => {
    const subs = await unknown.locator('#pa-unk-list .ha-row-sub').allTextContents();
    return subs.filter(t => t.startsWith('Dynamo')).length === 1 && (await unknown.locator('#pa-unk-list [data-act="unk-mine"] .ha-row-sub').first().textContent()).startsWith('Dynamo');
  }, 'a product already in the pantry is offered once, as the pantry item').toBe(true);
  await axe(page, 'unknown barcode sheet with a search');
  await noSideways(page, 'unknown barcode sheet with a search');
  await shot(page, '21-unknown-barcode-search');
  await page.fill('#pa-unk-find', 'breeze');
  await unknown.locator('#pa-unk-list [data-act="unk-cat"]', { hasText: 'Breeze' }).first().click();
  await expect(unknown, 'picking closes the sheet').toHaveCount(0);
  expect(hash(page), 'still on Add').toBe('#/add');
  await expect(field(page, 'name'), 'the catalogue product fills name').toHaveValue('Laundry liquid');
  await expect(field(page, 'brand'), 'and brand').toHaveValue('Breeze');
  await expect(field(page, 'size'), 'and size').toHaveValue('3.6 kg');
  await expect(field(page, 'category'), 'and category').toHaveValue('Laundry & cleaning');
  await expect(field(page, 'location'), 'and place').toHaveValue('Laundry');
  await expect(field(page, 'barcode'), 'with the barcode attached').toHaveValue(UNKNOWN);
});

test('Type a new name closes the sheet and focuses Name, starting with what was typed', async ({ phone }) => {
  const { page, scan, unknown } = await scanner(phone, 'new name');
  await go(page, '#/add');
  await scan(UNKNOWN2);
  await expect(unknown).toBeVisible();
  await page.fill('#pa-unk-find', 'Grandma’s chilli oil');
  await unknown.locator('[data-act="unk-new"]').click();
  await expect(unknown).toHaveCount(0);
  await expect(field(page, 'name'), 'Type a new name focuses Name').toBeFocused();
  await expect(field(page, 'name'), 'it starts with the search text').toHaveValue('Grandma’s chilli oil');
  await expect(field(page, 'barcode'), 'and keeps the barcode').toHaveValue(UNKNOWN2);
});

test('picking an item already in the pantry attaches the barcode and opens Bought more; the next scan finds it without asking', async ({ phone }) => {
  const { page, asked, scan, unknown } = await scanner(phone, 'mine');
  await go(page, '#/add');
  await scan(UNKNOWN2);
  await expect(unknown).toBeVisible();
  await page.fill('#pa-unk-find', 'kaya');
  await unknown.locator('#pa-unk-list [data-act="unk-mine"]', { hasText: 'Kaya' }).first().click();
  const kaya = await page.evaluate(() => [...window.__pantry.S.items.values()].find(i => i.name === 'Kaya'));
  expect(kaya.barcode, 'the barcode is saved on the pantry item').toBe(UNKNOWN2);
  await expect.poll(() => hash(page)).toBe('#/item/' + kaya.id);
  await expect(sheetOpen(page).locator('.ha-sheet-title'), 'its item opens with Bought more').toHaveText('Bought more');
  await page.goBack();
  await expect(sheetOpen(page), 'back closes Bought more').toHaveCount(0);
  expect(hash(page)).toBe('#/item/' + kaya.id);
  // and scanning it again finds it straight away (no look-up)
  const before = asked.length;
  await go(page, '#/add');
  await scan(UNKNOWN2);
  await expect(sheetOpen(page).locator('.ha-sheet-title', { hasText: 'Bought more' })).toBeVisible();
  expect(hash(page)).toBe('#/item/' + kaya.id);
  expect(asked.length, 'the next scan finds the item without asking online').toBe(before);
});
