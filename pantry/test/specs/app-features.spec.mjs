// Features from 16 Oct 2026, in the demo: Since you last looked, names for the family, guessed dates, Freeze and Thaw,
// Leftovers, Plenty / Low / Out for staples, the shopping list (Buy again, the mic, aisles, Going shopping, Put away), Scan
// many, and the new screens at 320px. Faked camera and speech. Run: npx playwright test app-features
import { test, expect } from './fixtures.mjs';
import { BASE, open, go, hash, toast, undo, sheetOpen, ymdPlus, noSideways, sheetFits, shot, idOf, itemById, itemNamed, qtyOf, sectionOf,
  FAKE_CAMERA, FAKE_SPEECH } from './app-helpers.mjs';

const demo = (phone, name) => open(phone, name, BASE + '?demo', { init: [FAKE_CAMERA, FAKE_SPEECH] });
const until = (fn, msg) => expect.poll(fn, { message: msg }).toBe(true);
const radios = sheet => sheet.locator('input[name="pa-cold"]').evaluateAll(l => l.map(i => i.value)).then(v => v.join());
const onList = (page, test) => page.evaluate(`(() => [...window.__pantry.S.shop.values()].some(x => ${test}))()`);
// a staple: Plenty / Low / Out instead of a count
async function makeStaple(page, id) {
  await go(page, '#/edit/' + id);
  await page.click('.pa-track .pa-seg:has(input[value="level"])');
  await page.click('#pa-save');
  await expect(page.locator('.pa-level input[value="plenty"]'), 'a staple shows Plenty / Low / Out').toBeChecked();
}

test('Home: Since you last looked, and "use this week" as a WhatsApp message', async ({ phone, axe }) => {
  const page = await demo(phone, 'since');
  const since = sectionOf(page, 'h-since');
  await expect(since.locator('.pa-row-title'), 'Since you last looked: three things Dad did').toHaveCount(3);
  await expect(since, 'in words, with names').toContainText('Dad threw away Wholemeal bread');
  await expect(since).toContainText('Dad bought Eggs (10)');
  const wa = await page.locator('#pa-wa-week').getAttribute('href');
  expect(wa.startsWith('https://wa.me/?text=') && decodeURIComponent(wa.split('text=')[1]).startsWith('Use this week\n- Meiji Fresh milk, by '), 'use this week as a WhatsApp message').toBe(true);
  await expect(page.locator('#pa-wa-week'), 'opens WhatsApp in a new tab').toHaveAttribute('target', '_blank');
  await axe(page, 'home with since you last looked');
  await shot(page, 'n01-home-since');
  await page.click('[data-act="since-ok"]');
  await expect(page.locator('#h-since'), 'Got it clears it').toHaveCount(0);
});

test('names for the family: the list, a contact sheet per person, Stop sharing', async ({ phone, axe }) => {
  const page = await demo(phone, 'names');
  await go(page, '#/settings');
  const fam = sectionOf(page, 'h-family');
  const row = who => fam.locator(`[data-act="person"][data-v="${who}"]`);
  await expect(row('dad@example.com').locator('.pa-row-title'), 'a named member shows the name').toHaveText('Dad');
  await expect(row('dad@example.com').locator('.ui-row-sub'), 'with the email under it').toContainText('dad@example.com');
  await expect(row('grandma@example.com').locator('.pa-row-title'), 'no name: the email').toHaveText('grandma@example.com');
  await axe(page, 'settings with the family');
  await shot(page, 'n02-family-list');
  await row('grandma@example.com').click();
  const person = sheetOpen(page);
  await expect(person.locator('.pa-sheet-title'), 'the contact sheet').toHaveText('Family member');
  expect(await person.locator('a', { hasText: 'Email an invite' }).getAttribute('href'), 'Email an invite').toMatch(/^mailto:grandma%40example\.com/);
  await expect(person.locator('[data-pp="remove"]'), 'Stop sharing for someone else').toHaveCount(1);
  await page.fill('#pa-person-name', '  Grandma   Lim ');
  await axe(page, 'contact sheet');
  await shot(page, 'n03-contact-sheet');
  await person.locator('button[type=submit]').click();
  await expect(row('grandma@example.com').locator('.pa-row-title'), 'the name shows in the list').toHaveText('Grandma Lim');
  await until(() => page.evaluate(() => window.__pantry.S.settings.get('people').names['grandma@example.com'] === 'Grandma Lim'), 'saved in settings/people');
  await row('mum@example.com').click();
  await expect(sheetOpen(page).locator('.pa-sheet-title')).toHaveText('Mum');
  await expect(sheetOpen(page).locator('[data-pp="remove"]'), 'your own sheet: no Stop sharing').toHaveCount(0);
  await expect(sheetOpen(page).locator('a', { hasText: 'Email an invite' }), 'no invite').toHaveCount(0);
  await page.goBack();
  await expect(sheetOpen(page)).toHaveCount(0);
  await row('grandma@example.com').click();
  await page.click('dialog.ui-sheet[open] [data-pp="remove"]');
  await page.locator('dialog.modal[open] .ui-danger', { hasText: 'Stop sharing' }).click();
  await expect(row('grandma@example.com'), 'Stop sharing removes her').toHaveCount(0);
  await until(() => page.evaluate(() => !('grandma@example.com' in window.__pantry.S.settings.get('people').names)), 'and her name');
});

test('Add: picking a product guesses its best-before date, as a selected chip', async ({ phone, axe }) => {
  const page = await demo(phone, 'guess');
  await go(page, '#/add');
  const expiry = page.locator('#pa-form [name="expiry"]');
  await page.fill('#pa-find', 'magnolia fresh milk');
  await page.locator('#pa-sugg [data-act="sugg"]').first().click();
  await expect(expiry, 'fresh milk: a week, guessed').toHaveValue(ymdPlus(7));
  await expect(page.locator('.pa-guess')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.pa-guess'), 'shown as a selected About 1 week chip').toHaveText('About 1 week');
  await expect(page.locator('.pa-guess-hint'), 'said to be a guess').toContainText('a guess');
  await page.selectOption('#pa-form [name="location"]', 'Freezer');
  await expect(expiry, 'in the freezer it keeps a year').toHaveValue(ymdPlus(365));
  await page.selectOption('#pa-form [name="location"]', 'Fridge');
  await page.fill('#pa-form [name="expiry"]', ymdPlus(10));
  await page.selectOption('#pa-form [name="category"]', 'Drinks');
  await expect(expiry, 'a date someone typed stays').toHaveValue(ymdPlus(10));
  await page.selectOption('#pa-form [name="category"]', 'Dairy & eggs');
  await page.click('.pa-guess');
  await page.locator('#h-f-stock').scrollIntoViewIfNeeded();
  await axe(page, 'add with a guessed date');
  await shot(page, 'n04-add-guess');
  await page.click('[data-act="back"]');
  await expect.poll(() => hash(page)).toBe('#/');
});

test('Freeze and Thaw on a batch: which freezer, till when, Undo, Not frozen, moving by the form, thawing some', async ({ phone, axe }) => {
  const page = await demo(phone, 'freeze');
  const milk = await idOf(page, 'Fresh milk');
  const m = () => itemById(page, milk);
  await go(page, '#/item/' + milk);
  // two freezers in the demo: Freeze asks which (one unit: no "how many")
  await page.click('[data-act="freeze"]');
  const cold = sheetOpen(page);
  await expect(cold.locator('input[name="pa-cold"]').first()).toBeVisible();
  await expect(cold.locator('#pa-cold-qty')).toHaveCount(0);
  expect(await radios(cold), 'Freeze asks which freezer').toBe('Freezer,Level 1 freezer');
  await axe(page, 'freeze sheet');
  await cold.locator('#pa-cold-go').click();
  await expect(toast(page), 'Freeze says where and till when').toHaveText(/^1 frozen: moved to Freezer, keeps till/);
  await until(async () => { const x = await m(); return x.location === 'Freezer' && x.batches[0].frozenAt === ymdPlus(0) && x.batches[0].expiry === ymdPlus(365) && x.batches[0].packPlace === 'Fridge'; }, 'frozen: in the freezer, a year, frozen today, the packaging date kept');
  const packDate = (await m()).batches[0].packExpiry;
  await expect(page.locator('.pa-batch .pa-row-title').first(), 'the batch says frozen').toHaveText('1 frozen');
  await expect(page.locator('.pa-batch .ui-row-sub').first(), 'and when').toHaveText(/^Frozen /);
  await axe(page, 'item frozen');
  await shot(page, 'n05-item-frozen');
  await page.click('[data-act="thaw"]');
  await expect(cold.locator('input[name="pa-cold"]').first()).toBeVisible();
  expect(await radios(cold), 'Thaw asks which fridge').toBe('Fridge,Level 1 fridge');
  await cold.locator('#pa-cold-go').click();
  await until(async () => { const x = await m(); return x.location === 'Fridge' && !x.batches[0].frozenAt && x.batches[0].expiry === ymdPlus(3); }, 'thawed: back in the fridge, three days');
  await expect(sectionOf(page, 'h-history'), 'the history says thawed').toContainText('Thawed');
  await shot(page, 'n06-item-thawed');
  await undo(page);
  await until(async () => (await m()).location === 'Freezer', 'Undo puts it back in the freezer');
  // frozen by mistake: Not frozen puts back the packaging date and the fridge
  await page.click('[data-act="unfreeze"]');
  await until(async () => { const x = await m(); return x.location === 'Fridge' && !x.batches[0].frozenAt && !x.batches[0].thawedAt && x.batches[0].expiry === packDate && !('packExpiry' in x.batches[0]); }, 'Not frozen: the packaging date and the fridge are back');
  await expect(toast(page), 'and says so').toHaveText(/^Not frozen: use by/);
  await expect(page.locator('[data-act="unfreeze"]'), 'no Not frozen once it isn’t').toHaveCount(0);
  // moving it into a freezer freezes it, out again thaws it
  const moveByForm = async to => { await go(page, '#/edit/' + milk); await page.selectOption('#pa-form [name="location"]', to); await page.click('#pa-save'); };
  await moveByForm('Level 1 freezer');
  await until(async () => { const x = await m(); return x.location === 'Level 1 freezer' && x.batches[0].frozenAt === ymdPlus(0) && x.batches[0].expiry === ymdPlus(365); }, 'moved into a freezer: frozen, a year');
  await expect(toast(page), 'Save says it froze').toHaveText('Saved: 1 frozen (keeps a year)');
  await moveByForm('Fridge');
  await until(async () => { const x = await m(); return !x.batches[0].frozenAt && x.batches[0].thawedAt === ymdPlus(0) && x.batches[0].expiry === ymdPlus(3); }, 'moved out: thawed, three days');
  await expect(page.locator('[data-act="unfreeze"]'), 'thawed for real: no Not frozen (thawed food keeps its 3 days)').toHaveCount(0);
  // thawing some of a batch (frozen goods in a freezer): how many, and the rest stays frozen
  const dump = await idOf(page, 'Frozen dumplings');
  await go(page, '#/item/' + dump);
  const db = (await itemById(page, dump)).batches[0];
  await page.click(`[data-act="thaw"][data-b="${db.id}"]`);
  await expect(cold.locator('#pa-cold-qty input'), 'how many starts at all of them').toHaveValue('2');
  await expect(cold.locator('#pa-cold-where'), 'with the fridges').toBeVisible();
  await cold.locator('#pa-cold-qty [data-step="-1"]').click();
  await expect(cold.locator('#pa-cold-where'), 'one of two: no place to pick').toBeHidden();
  await expect(cold.locator('#pa-cold-note'), 'the rest stays').toHaveText('The rest stays in Level 1 freezer.');
  await axe(page, 'thaw some');
  await cold.locator('#pa-cold-go').click();
  await until(async () => { const d = await itemById(page, dump); return d.location === 'Level 1 freezer' && d.batches.some(b => b.id === db.id && b.qty === 1) && d.batches.some(b => b.thawedAt === ymdPlus(0) && b.qty === 1 && b.expiry === ymdPlus(3)); }, 'split: one thawed, one still frozen');
  await expect.poll(async () => (await page.locator('.pa-batch .pa-row-title').allTextContents()).sort().join(), 'the rows say which').toBe('1 frozen,1 in stock');
  await undo(page);
  await go(page, '#/item/' + await idOf(page, 'Laundry liquid'));
  await expect(page.locator('[data-act="freeze"]'), 'no Freeze for laundry liquid').toHaveCount(0);
});

test('Leftovers: a name, the fridge, three days, never on the list', async ({ phone, axe }) => {
  const page = await demo(phone, 'leftovers');
  await page.click('.pa-quickrow [data-act="leftovers"]');
  const left = sheetOpen(page);
  await expect(left.locator('.pa-sheet-title')).toHaveText('Leftovers');
  await expect(left.locator('[name="location"]'), 'Leftovers: the fridge already chosen').toHaveValue('Fridge');
  await left.locator('.pa-sheet-foot .ui-primary').click();
  await expect(page.locator('#pa-left-err'), 'a name is needed').toBeVisible();
  await page.fill('#pa-left-name', 'Chicken curry');
  await axe(page, 'leftovers sheet');
  await shot(page, 'n07-leftovers');
  await left.locator('.pa-sheet-foot .ui-primary').click();
  await until(async () => { const c = await itemNamed(page, 'Chicken curry'); return !!c && c.category === 'Leftovers' && c.location === 'Fridge' && !!c.noRestock && c.batches[0].expiry === ymdPlus(3); }, 'in the fridge, use within 3 days, never on the list');
  await expect(sectionOf(page, 'h-use-soon').locator('.ui-row', { hasText: 'Chicken curry' }), 'under Use soon').toHaveCount(1);
});

test('a staple shows Plenty / Low / Out: Low puts it on the list, Undo, Out', async ({ phone, axe }) => {
  const page = await demo(phone, 'staple');
  const rice = await idOf(page, 'Thai hom mali rice');
  await makeStaple(page, rice);
  await expect(page.locator('[data-act="bought"]'), 'no Bought more').toHaveCount(0);
  await expect(page.locator('#h-stock .pa-num'), 'no count').toHaveCount(0);
  await page.click('.pa-level .pa-seg:has(input[value="low"])');
  await expect(toast(page), 'Low puts it on the list').toContainText('low, on the shopping list');
  await until(() => page.evaluate(id => [...window.__pantry.S.shop.values()].some(x => x.itemId === id && !x.done && !x.removedAt), rice), 'a line on the list');
  await expect(sectionOf(page, 'h-history'), 'the history says Marked low').toContainText('Marked low');
  await axe(page, 'staple item');
  await shot(page, 'n08-staple');
  await undo(page);
  await until(async () => await page.evaluate(id => !window.__pantry.S.items.get(id).level || window.__pantry.S.items.get(id).level === 'plenty', rice)
    && await page.evaluate(id => ![...window.__pantry.S.shop.values()].some(x => x.itemId === id && !x.removedAt), rice), 'Undo: plenty again, off the list');
  await page.click('.pa-level .pa-seg:has(input[value="out"])');
  await go(page, '#/items');
  await expect(page.locator('#pa-items-list .ui-row', { hasText: 'Thai hom mali rice' }).locator('.ui-row-sub'), 'Items says Out').toHaveText(/^Out/);
});

test('the shopping list: Buy again, the mic, aisles, Going shopping, Put away takes a staple back to plenty', async ({ phone, axe }) => {
  const page = await demo(phone, 'list');
  const rice = await idOf(page, 'Thai hom mali rice');
  await makeStaple(page, rice);
  await page.click('.pa-level .pa-seg:has(input[value="out"])');
  await until(() => page.evaluate(id => [...window.__pantry.S.shop.values()].some(x => x.itemId === id && !x.done && !x.removedAt), rice), 'out puts it on the list');
  await go(page, '#/shop');
  const chips = page.locator('.pa-again .ui-chip');
  await expect.poll(() => chips.count(), 'Buy again chips').toBeGreaterThanOrEqual(2);
  const again = (await chips.first().textContent()).trim();
  await chips.first().click();
  await expect(page.locator('#pa-shop .pa-row-title', { hasText: again }), 'a Buy again chip adds it').toHaveCount(1);
  await expect(page.locator('.pa-again .ui-chip', { hasText: again }), 'and leaves the chips').toHaveCount(0);
  await page.evaluate(() => { window.__said = 'bananas, cream crackers and dishwashing liquid'; });
  await page.click('#pa-shop-mic');
  await expect(toast(page), 'the mic adds each thing said, once').toContainText('Added 3 things to the list');
  const aisles = page.locator('#pa-shop .pa-aisle');
  await expect.poll(async () => { const a = await aisles.allTextContents(); return a.includes('Fresh produce') && a.includes('Snacks') && a.includes('Laundry & cleaning'); }, 'grouped by aisle').toBe(true);
  const a = await aisles.allTextContents();
  expect(a.indexOf('Snacks') < a.indexOf('Laundry & cleaning'), 'in the catalogue’s order').toBe(true);
  const going = decodeURIComponent((await page.locator('#pa-wa-going').getAttribute('href')).split('text=')[1]);
  expect(going.startsWith('Going shopping now. Anything to add?\n\nShopping list\n- ') && going.includes('Bananas'), 'Going shopping now: the list as a WhatsApp message').toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await axe(page, 'shopping, grouped');
  await shot(page, 'n09-shop', true);
  await page.locator('#pa-shop label', { hasText: 'Bananas' }).locator('input').click();
  await expect(page.locator('#pa-shop-done label.is-done', { hasText: 'Bananas' })).toHaveCount(1);
  await page.locator('#pa-shop label', { hasText: 'Thai hom mali rice' }).locator('input').click();
  await expect(page.locator('#pa-shop-done label.is-done', { hasText: 'Thai hom mali rice' })).toHaveCount(1);
  await page.click('[data-act="put-away"]');
  await expect(sheetOpen(page).locator('.pa-pa', { hasText: 'Thai hom mali rice' }), 'Put away: a staple goes back to plenty').toContainText('Back to plenty');
  await shot(page, 'n10-put-away');
  await page.click('#pa-pa-go');
  await until(async () => (await itemById(page, rice)).level === 'plenty', 'rice: plenty again');
});

test('Scan many: Bought, Used up, Add to list, a barcode not in the pantry, one Undo for every scan', async ({ phone, axe }) => {
  const page = await demo(phone, 'scan many');
  await page.evaluate(() => { const S = window.__pantry.S; for (const [n, c] of [['Kaya', '4900000000011'], ['Fresh milk', '4900000000028']]) { const it = [...S.items.values()].find(i => i.name === n); S.items.set(it.id, { ...it, barcode: c }); } });
  const kaya = await idOf(page, 'Kaya');
  const q0 = await qtyOf(page, kaya);
  await go(page, '#/');
  await page.click('.pa-quickrow [data-act="scan-many"]');
  const sm = sheetOpen(page);
  await expect(sm.locator('.pa-sheet-title')).toHaveText('Scan many');
  await expect(sm.locator('[name="pa-sm-mode"][value="add"]'), 'Scan many opens on Bought').toBeChecked();
  // the fake reader takes the code on its next look; wait until it has
  const scanOne = async c => { await page.evaluate(x => { window.__scanCode = x; }, c); await page.waitForFunction(() => window.__scanCode === null); };
  await scanOne('4900000000011'); await scanOne('4900000000028');
  await scanOne('4900000000011');
  await scanOne('5555555555555');
  await expect.poll(() => qtyOf(page, kaya), 'two kaya bought (each scan once)').toBe(q0 + 2);
  await expect(sm.locator('#pa-sm-n'), 'the tally counts four scans').toHaveText('4');
  await expect(sm.locator('#pa-sm-tally'), 'kaya × 2').toContainText('× 2');
  await expect(sm.locator('[data-sm-new="5555555555555"]'), 'and the new barcode waits with Add it').toHaveCount(1);
  await sm.locator('.pa-seg:has(input[value="use"])').click();
  await scanOne('4900000000011');
  await expect.poll(() => qtyOf(page, kaya), 'Used up takes one out').toBe(q0 + 1);
  await sm.locator('.pa-seg:has(input[value="list"])').click();
  await scanOne('4900000000028');
  await until(() => onList(page, `x.name.includes('Fresh milk') && !x.done && !x.removedAt`), 'Add to list puts it on the list');
  await axe(page, 'scan many');
  await noSideways(page, 'scan many');
  await shot(page, 'n11-scan-many');
  await sm.locator('.pa-sheet-foot [data-pa-close]').click();
  await expect(toast(page), 'Done: one toast for every scan (the new barcode waits)').toContainText('Saved 5 scans');
  await undo(page);
  await until(async () => (await qtyOf(page, kaya)) === q0 && !(await onList(page, `x.name.includes('Fresh milk') && !x.done && !x.removedAt`)), 'one Undo takes every scan back');
});

test('the new screens at 320px: no sideways scroll, Put away fits', async ({ phone, axe }) => {
  const page = await open(phone, 'narrow', BASE + '?demo', { width: 320, height: 640 });
  const rice = await idOf(page, 'Thai hom mali rice'), milk = await idOf(page, 'Fresh milk');
  for (const h of ['#/', '#/shop', '#/settings', '#/item/' + rice, '#/item/' + milk]) { await go(page, h); await noSideways(page, `320 ${h}`); }
  await go(page, '#/shop');
  await page.fill('#pa-shop-text', 'Bananas');
  await page.click('#pa-shop-add button[type=submit]');
  await page.locator('#pa-shop label', { hasText: 'Bananas' }).locator('input').click();
  await expect(page.locator('#pa-shop-done label.is-done')).toHaveCount(1);
  await page.click('[data-act="put-away"]');
  await expect(sheetOpen(page)).toBeVisible();
  await noSideways(page, '320 put away');
  await sheetFits(page, '320 put away');
  await axe(page, '320 put away');
});
