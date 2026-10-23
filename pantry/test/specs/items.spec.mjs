// The Items list on a phone (390px, touch), in demo mode (made-up items in memory), the real kit and the real app code, with
// REAL touch input (Chrome's Input.dispatchTouchEvent over CDP, so pointer events, scrolling and the click after a tap behave
// as on a phone). No emulator needed (PW_NO_EMULATOR=1). Run: npx playwright test items
//   - the list as it is: default sort, labels that fit, rows are links
//   - selecting: the Select button, checkboxes (tap, Space, Enter), Select all / none / Done, filters, Back and Escape and
//     another tab leave it
//   - a press and hold (500 ms triggers; 10 px of movement cancels; a vertical scroll doesn't start one; the click after the
//     hold doesn't open the row; a buzz where the phone allows it and none with reduced motion). The page clock is faked for
//     these, so the 500 ms is run by the test and no wall-clock waiting is involved
//   - Group by place: headings with counts that fold, "Select these N"; Category headings
//   - the three actions (Move to…, Shopping list, Delete): one batch and one toast with Undo that leaves alone what changed since
//   - the grip on every row (a real 44px button): dragging one item or a whole selection onto a place heading or chip (a ghost
//     above the finger, the target lit, a label saying where it lands, Escape cancels, its own place is ignored, auto-scroll at
//     the edges), by touch and by mouse
//   - Bulk edit (#/bulk): filters, Select all matching, every field Unchanged, Review, Save one batch with one Undo, conversions
//     that keep the stock, dates shifted or set, the shopping list, delete
//   - axe on every state added here
// Every test opens its own phone on its own server (a fresh in-memory demo pantry), so none relies on another.
import { test, expect } from './fixtures.mjs';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const ITEMS = '/pantry/?demo#/items';

// A phone on the demo pantry, with real touch. `window.__buzz` records navigator.vibrate calls (an Android user agent, as
// haHaptic wants). Returns the page and `touch(type, x, y)`, one CDP session for this page.
// Service workers are blocked: on a fresh origin the app's worker installs, takes control and reloads the page once (a new
// version asks for that), which would land in the middle of a test. Nothing here is about the offline copy.
async function open(phone, { url = ITEMS, height = 844, ...opts } = {}) {
  const page = await phone('items', {
    url, serviceWorkers: 'block', viewport: { width: 390, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: ANDROID, ...opts,
    init: () => { window.__buzz = []; navigator.vibrate = ms => { window.__buzz.push(ms); return true; }; },
  });
  await ready(page);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
  return { page, touch };
}
// the Items list is drawn: title, all thirteen made-up rows
const ready = async page => {
  await expect(page.locator('.ha-large-title').first()).toBeVisible();
  await expect(page.locator('#pa-items-list li')).toHaveCount(13);
};
const row = (page, name) => page.locator('#pa-items-list li', { hasText: name });
const hash = page => new URL(page.url()).hash;
const bar = page => page.locator('#pa-selbar');
const count = page => page.locator('#pa-selcount');
const toast = page => page.locator('.ha-toast.is-visible');
const undo = page => page.locator('.ha-toast-action');
const names = page => page.evaluate(() => [...document.querySelectorAll('#pa-items-list .ha-row-title')].map(e => e.textContent));
const itemNamed = (page, name) => page.evaluate(n => { const it = [...window.__pantry.S.items.values()].find(i => i.name === n); return it && { id: it.id, location: it.location, removed: !!it.removedAt }; }, name);
const locationOf = (page, name) => itemNamed(page, name).then(i => i?.location);
const stateOf = page => page.evaluate(() => ({ on: window.__pantry.S.sel.on, n: window.__pantry.S.sel.ids.size, h: location.hash }));
const shopLines = (page, live = true) => page.evaluate(live => [...window.__pantry.S.shop.values()].filter(m => !live || !m.removedAt).length, live);
const edit = (page, name, patch) => page.evaluate(([n, p]) => { const it = [...window.__pantry.S.items.values()].find(i => i.name === n); window.__pantry.S.items.set(it.id, { ...it, ...p }); }, [name, patch]);
const buzzes = page => page.evaluate(() => window.__buzz.length);
const sheet = page => page.locator('dialog.ha-sheet[open]');
// a row's centre in the viewport (45% across, clear of the grip), or its grip's centre
const rowPoint = async (page, name) => { const b = await row(page, name).first().locator('.pa-item').boundingBox(); return { x: b.x + b.width * 0.45, y: b.y + b.height / 2 }; };
// A box once its layout has stopped moving (the same place for three animation frames in a row): a list that is still
// settling after a regroup or a redraw would put a measured heading somewhere else by the time the finger gets there.
const steady = loc => loc.evaluate(el => new Promise(done => {
  let last = '', same = 0;
  const look = () => {
    const r = el.getBoundingClientRect(), now = [r.x, r.y, r.width, r.height].join();
    same = now === last ? same + 1 : 0; last = now;
    if (same >= 3) done({ x: r.x, y: r.y, width: r.width, height: r.height }); else requestAnimationFrame(look);
  };
  look();
}));
const gripPoint = async (page, name) => { const b = await steady(row(page, name).first().locator('.pa-grip')); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const headBox = (page, place) => steady(page.locator(`section[data-place="${place}"] .pa-grouphead`));
const place = (page, label) => page.locator('.ha-seg', { hasText: label }).click();

async function startSelecting(page) {
  await page.click('#pa-sel-toggle');
  await expect(bar(page)).toBeVisible();
}
async function pick(page, list) {
  await startSelecting(page);
  for (const n of list) await row(page, n).locator('.pa-item').tap();
  await expect(count(page)).toHaveText(`${list.length} selected`);
}
const selecting = async (page, on = true) => expect(bar(page)).toHaveCount(on ? 1 : 0);

// ---------- the list as it is (default sort and look unchanged), the sort fits ----------
test('the list as it is: default sort, labels that fit, rows are links', async ({ phone, axe }) => {
  const { page } = await open(phone);
  await expect(page.locator('input[name="pa-sort"]:checked')).toHaveAttribute('value', 'expiry');
  await expect(page.locator('.ha-segmented .ha-seg span'), 'no My order choice').toHaveText(['Use by', 'Name', 'Category', 'Place']);
  await expect(page.locator('.pa-within'), 'the second choice is hidden').toHaveCount(0);
  const seg = await page.evaluate(() => { const f = document.querySelector('.ha-segmented'); return { sw: f.scrollWidth, cw: f.clientWidth, spans: [...f.querySelectorAll('.ha-seg span')].map(s => ({ w: s.getBoundingClientRect().width, sw: s.scrollWidth, cw: s.clientWidth })) }; });
  expect(seg.sw <= seg.cw && seg.spans.every(s => s.sw <= s.cw), 'the sort labels fit at 390px: ' + JSON.stringify(seg)).toBe(true);
  await expect(page.locator('#pa-items-list .pa-item')).toHaveCount(13);
  await expect(page.locator('#pa-items-list a.pa-item[href^="#/item/"]'), 'rows are links, as before').toHaveCount(13);
  await expect(page.locator('#pa-sel-toggle'), 'a Select button above the list').toBeVisible();
  await expect(bar(page), 'no selection bar yet').toHaveCount(0);
  await axe(page, 'Items');
});

// ---------- selecting by button: checkboxes, bar, Select all / none, filters ----------
test('selecting by button: checkboxes by tap, Space and Enter; Select all and none', async ({ phone }) => {
  const { page } = await open(phone);
  await startSelecting(page);
  await expect(count(page)).toHaveText('None selected');
  await expect(page.locator('#pa-items-list input.pa-sel'), 'a real checkbox on every row').toHaveCount(13);
  await expect(page.locator('#pa-items-list a.pa-item'), 'rows are not links while selecting').toHaveCount(0);
  await expect(page.locator('#pa-sel-toggle'), 'the Select button is gone').toHaveCount(0);
  await expect(page.locator('.ha-tabbar')).toBeVisible();
  await expect.poll(async () => {
    const b = await bar(page).boundingBox(), t = await page.locator('.ha-tabbar').boundingBox();
    return Math.abs(b.y + b.height - t.y) <= 1.5;
  }, { message: 'the bar sits right above the tab bar' }).toBe(true);
  await expect(page.locator('[data-act="sel-move"]'), 'actions are off with nothing selected').toHaveAttribute('aria-disabled', 'true');
  expect(await row(page, '').first().locator('label.pa-item').textContent(), 'a checkbox is named by its row').toMatch(/\w/);
  // tap a row: it ticks and does not navigate
  const h0 = hash(page);
  await row(page, 'Kaya').locator('.pa-item').tap();
  await expect(count(page)).toHaveText('1 selected');
  expect(hash(page), 'tapping a row does not open it').toBe(h0);
  await expect(row(page, 'Kaya').locator('input'), 'the row is ticked').toBeChecked();
  await expect(page.locator('[data-act="sel-move"]'), 'actions are on').toHaveAttribute('aria-disabled', 'false');
  // keyboard: Space and Enter toggle
  await row(page, 'Fresh milk').locator('input').focus();
  await page.keyboard.press('Space');
  await expect(count(page)).toHaveText('2 selected');
  await page.keyboard.press('Enter');
  await expect(count(page), 'Enter unticks (Space ticked it)').toHaveText('1 selected');
  await page.keyboard.press('Enter');
  await expect(count(page)).toHaveText('2 selected');
  expect(await page.evaluate(() => document.activeElement.matches('input.pa-sel')), 'focus stays on the checkbox').toBe(true);
  // select all is the whole result; select none keeps selecting
  await page.click('[data-act="sel-all"]');
  await expect(count(page)).toHaveText('13 selected');
  await expect(page.locator('#pa-items-list input:checked')).toHaveCount(13);
  await page.click('[data-act="sel-none"]');
  await expect(count(page)).toHaveText('None selected');
  await selecting(page);
});

test('selecting: Select all means the filtered result; what a filter hides stays selected and is counted', async ({ phone }) => {
  const { page } = await open(phone);
  await startSelecting(page);
  await page.click('[data-act="place"][data-v="Fridge"]');
  await expect(page.locator('[data-act="place"][data-v="Fridge"]')).toHaveAttribute('aria-pressed', 'true');
  const fridge = await page.locator('#pa-items-list .pa-item').count();
  expect(fridge).toBeLessThan(13);
  await page.click('[data-act="sel-all"]');
  await expect(count(page)).toHaveText(`${fridge} selected`);
  await page.click('[data-act="place"][data-v=""]');
  await expect(page.locator('#pa-items-list .pa-item')).toHaveCount(13);
  await expect(count(page), 'the selection is kept when the filter changes').toHaveText(`${fridge} selected`);
  await page.fill('#pa-q', 'zzzz');
  await expect(page.locator('#pa-items-list .pa-item')).toHaveCount(0);
  await expect(count(page), 'items the filter hides are counted, not forgotten').toHaveText(`${fridge} selected (${fridge} not shown)`);
  await page.fill('#pa-q', '');
  await expect(page.locator('#pa-items-list .pa-item')).toHaveCount(13);
});

test('Done and Escape leave select mode on the same screen', async ({ phone }) => {
  const { page } = await open(phone);
  await startSelecting(page);
  await page.click('[data-act="sel-done"]');
  await selecting(page, false);
  expect(hash(page), 'Done leaves select mode without a dead history entry').toBe('#/items');
  await expect(page.locator('#pa-items-list a.pa-item'), 'rows are links again').toHaveCount(13);
  await startSelecting(page);
  await page.keyboard.press('Escape');
  await selecting(page, false);
  expect(hash(page), 'Escape leaves select mode').toBe('#/items');
});

test('Back leaves select mode and stays on Items', async ({ phone }) => {
  const { page } = await open(phone);
  await startSelecting(page);
  await page.goBack();
  await selecting(page, false);
  await expect(page.locator('#pa-sel-toggle')).toBeVisible();
  expect(hash(page), 'Back stays on Items').toBe('#/items');
});

test('another tab ends select mode, and Back from there does not land on a dead entry', async ({ phone }) => {
  const { page } = await open(phone);
  await startSelecting(page);
  await page.click('.ha-tab[href="#/shop"]');
  await expect.poll(() => hash(page)).toBe('#/shop');
  await selecting(page, false);
  await page.goBack();
  await expect.poll(() => hash(page), 'Back from there goes somewhere real').not.toBe('#/shop');
  await selecting(page, false);
});

// ---------- a press and hold, with real touch ----------
// The page clock is faked and paused: the 500 ms hold timer only runs when the test says so (clock.runFor), however slow the
// machine is. The finger and the page's scrolling are still real.
async function held(phone, opts = {}) {
  const o = await open(phone, { height: 560, ...opts });
  await o.page.clock.install();
  await o.page.clock.pauseAt(new Date(Date.now() + 5_000));
  return o;
}

test('hold: 500 ms starts selecting that row, with a buzz, and the click after it does not open the row', async ({ phone }) => {
  const { page, touch } = await held(phone);
  const c = await rowPoint(page, 'Kaya');
  await touch('touchStart', c.x, c.y);
  await page.clock.runFor(250);
  await expect(row(page, 'Kaya').locator('.pa-item.is-holding'), 'a row being held shows it').toHaveCount(1);
  await selecting(page, false);   // not yet at 250 ms
  await page.clock.runFor(450);
  await selecting(page);          // a hold of 700 ms started selecting, before the finger lifted
  await touch('touchEnd');
  await expect.poll(() => stateOf(page), { message: 'one row ticked, and the click after the hold did not open the row' }).toEqual({ on: true, n: 1, h: '#/items' });
  await expect(row(page, 'Kaya').locator('input'), 'it is the row that was held').toBeChecked();
  expect(await buzzes(page), 'one buzz').toBe(1);
  await expect(count(page)).toHaveText('1 selected');
});

test('hold: a tap that lasts 300 ms still opens the item', async ({ phone }) => {
  const { page, touch } = await held(phone);
  const c = await rowPoint(page, 'Fresh milk');
  await touch('touchStart', c.x, c.y);
  await page.clock.runFor(300);
  await touch('touchEnd');
  await expect.poll(() => hash(page), { message: 'a slow tap opens the item' }).toMatch(/^#\/item\//);
  await selecting(page, false);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/items');
});

test('hold: 14 px of sideways movement cancels it', async ({ phone }) => {
  const { page, touch } = await held(phone);
  const c = await rowPoint(page, 'Kaya');
  await touch('touchStart', c.x, c.y);
  await touch('touchMove', c.x + 14, c.y);
  await expect(row(page, 'Kaya').locator('.pa-item.is-holding'), 'the hold is called off').toHaveCount(0);
  await page.clock.runFor(700);
  await selecting(page, false);
  await touch('touchEnd');   // (still inside the browser's tap slop, so lifting the finger may be a tap: the row opens)
  await selecting(page, false);
  expect(await buzzes(page)).toBe(0);
});

test('hold: 8 px of wobble is still a hold', async ({ phone }) => {
  const { page, touch } = await held(phone);
  const c = await rowPoint(page, 'Kaya');
  await touch('touchStart', c.x, c.y);
  await touch('touchMove', c.x + 8, c.y);
  await page.clock.runFor(700);
  await selecting(page);
  await touch('touchEnd');
  await expect(count(page)).toHaveText('1 selected');
  expect(hash(page)).toBe('#/items');
});

test('hold: a vertical scroll never starts selecting, and the page scrolls', async ({ phone }) => {
  const { page, touch } = await held(phone);
  const y0 = await page.evaluate(() => scrollY);
  const c = await rowPoint(page, 'Fresh milk');
  await touch('touchStart', c.x, c.y);
  for (let i = 1; i <= 10; i++) await touch('touchMove', c.x, c.y - i * 18);
  await page.clock.runFor(600);
  await selecting(page, false);
  await touch('touchEnd');
  await expect.poll(() => page.evaluate(() => scrollY), { message: 'the page scrolled' }).toBeGreaterThan(y0 + 40);
  await selecting(page, false);
  expect(hash(page), 'and nothing opened').toBe('#/items');
});

test('hold: on the search box nothing starts selecting', async ({ phone }) => {
  const { page, touch } = await held(phone);
  const q = await page.locator('#pa-q').boundingBox();
  await touch('touchStart', q.x + 40, q.y + q.height / 2);
  await page.clock.runFor(700);
  await touch('touchEnd');
  await selecting(page, false);
});

test('reduced motion: the hold still works, with no buzz and no fold animation', async ({ phone }) => {
  const { page, touch } = await held(phone, { height: 844, reducedMotion: 'reduce' });
  const b = await rowPoint(page, 'Kaya');
  await touch('touchStart', b.x, b.y);
  await page.clock.runFor(700);
  await selecting(page);
  await touch('touchEnd');
  expect(await buzzes(page), 'no buzz with reduced motion').toBe(0);
  await page.click('[data-act="sel-done"]');
  await place(page, 'Place');
  await expect(page.locator('.pa-fold-icon').first()).toBeAttached();
  const tr = await page.evaluate(() => getComputedStyle(document.querySelector('.pa-fold-icon')).transitionDuration);
  expect(parseFloat(tr), 'no transition on the fold chevron with reduced motion (the kit zeroes them): ' + tr).toBeLessThanOrEqual(0.001);
});

// ---------- Group by place: headings with counts that fold; selecting under a heading ----------
test('Group by place: a heading per place with its count; Fridge folds, and stays folded after a reload', async ({ phone }) => {
  const { page } = await open(phone);
  await place(page, 'Place');
  await expect(page.locator('input[name="pa-sort"]:checked')).toHaveAttribute('value', 'place');
  const heads = await page.locator('.pa-grouphead').evaluateAll(hs => hs.map(h => ({ name: h.querySelector('.pa-fold-name').textContent, n: h.querySelector('.ha-num').textContent })));
  expect(heads.length, 'a heading for each place that has items: ' + JSON.stringify(heads)).toBeGreaterThanOrEqual(5);
  const fridge = heads.find(h => h.name === 'Fridge');
  expect(fridge && Number(fridge.n), 'Fridge has four, shown as a count').toBe(4);
  await expect(page.locator('section[data-place="Fridge"] .pa-item'), 'its four rows are under it').toHaveCount(4);
  const fb = page.locator('section[data-place="Fridge"] .pa-fold');
  await expect(fb).toHaveAttribute('aria-expanded', 'true');
  await fb.click();
  await expect(page.locator('section[data-place="Fridge"] .pa-fold')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('section[data-place="Fridge"] .pa-item'), 'folded: the rows are hidden').toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.matches?.('.pa-fold')), 'focus stays on the heading button').toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pantry:folded'))), 'the fold is kept on this phone').toEqual(['place:Fridge']);
  await page.reload();
  await expect(page.locator('.ha-large-title').first()).toBeVisible();
  await expect(page.locator('section[data-place="Fridge"] .pa-fold'), 'and after a reload').toHaveAttribute('aria-expanded', 'false');
});

test('Group by place: “Select these N” under a heading, folded headings too; axe', async ({ phone, axe }) => {
  const { page } = await open(phone);
  await place(page, 'Place');
  await page.click('section[data-place="Fridge"] .pa-fold');
  await expect(page.locator('section[data-place="Fridge"] .pa-item')).toHaveCount(0);
  await startSelecting(page);
  await page.click('section[data-place="Kitchen cabinet"] [data-act="sel-group"]');
  const kc = await page.locator('section[data-place="Kitchen cabinet"] .pa-item').count();
  await expect(count(page), '“Select these N” ticks that heading').toHaveText(`${kc} selected`);
  await expect(page.locator('section[data-place="Kitchen cabinet"] [data-act="sel-group"]')).toHaveText(`Unselect these ${kc}`);
  // a folded heading's items can be selected too
  await page.click('section[data-place="Fridge"] [data-act="sel-group"]');
  await expect(count(page), 'a folded heading selects its hidden rows too').toHaveText(`${kc + 4} selected`);
  await page.click('section[data-place="Kitchen cabinet"] [data-act="sel-group"]');
  await expect(count(page), 'tapping it again unticks them').toHaveText('4 selected');
  await axe(page, 'Items: group by place, selecting');
  await page.click('[data-act="sel-done"]');
  await selecting(page, false);
  await axe(page, 'Items: group by place');
});

test('Category grouping keeps its headings and they do not fold', async ({ phone }) => {
  const { page } = await open(phone);
  await place(page, 'Category');
  await expect(page.locator('input[name="pa-sort"]:checked')).toHaveAttribute('value', 'category');
  expect(await page.locator('.pa-grouphead').count(), 'category headings').toBeGreaterThanOrEqual(6);
  await expect(page.locator('.pa-fold'), 'category headings do not fold').toHaveCount(0);
});

// ---------- the three actions, each one batch and one toast with Undo ----------
test('Move to…: one batch, one toast; Undo leaves alone what changed since', async ({ phone, axe }) => {
  const { page } = await open(phone);
  await pick(page, ['Kaya', 'Fresh milk', 'Laundry liquid']);
  await page.click('[data-act="sel-move"]');
  await expect(sheet(page).locator('.ha-sheet-title')).toHaveText('Move 3 items');
  expect(await sheet(page).locator('input[name="pa-moveto"]').count(), 'every place is offered').toBeGreaterThanOrEqual(11);
  await expect(sheet(page).locator('#pa-moveto-go'), 'the button waits for a choice').toHaveAttribute('aria-disabled', 'true');
  await axe(page, 'Move to… sheet');
  await sheet(page).locator('label', { hasText: 'Basement store' }).click();
  await expect(sheet(page).locator('#pa-moveto-go')).toHaveText('Move 3 items to Basement store');
  await sheet(page).locator('#pa-moveto-go').click();
  await selecting(page, false);
  for (const n of ['Kaya', 'Fresh milk', 'Laundry liquid']) await expect.poll(() => locationOf(page, n), { message: n + ' moved' }).toBe('Basement store');
  await expect(toast(page), 'one toast says so').toContainText('3 items moved to Basement store');
  // someone changed Fresh milk since (it was moved elsewhere on another phone): Undo leaves it
  await edit(page, 'Fresh milk', { location: 'Freezer' });
  await undo(page).click();
  await expect.poll(() => locationOf(page, 'Kaya'), { message: 'Undo put Kaya back' }).toBe('Fridge');
  expect(await locationOf(page, 'Laundry liquid')).toBe('Laundry');
  expect(await locationOf(page, 'Fresh milk'), 'Fresh milk, changed since, is left as it is').toBe('Freezer');
  await expect(toast(page), 'and it says so').toContainText('1 changed since, left as it is');
});

test('Shopping list: one batch, Undo takes both lines off, and what is already there is counted', async ({ phone }) => {
  const { page } = await open(phone);
  const before = await shopLines(page, false);
  await pick(page, ['Kaya', 'Eggs (10)']);
  await page.click('[data-act="sel-list"]');
  await expect.poll(() => shopLines(page, false), { message: 'two lines' }).toBe(before + 2);
  await expect(toast(page)).toContainText('2 items on the shopping list');
  await undo(page).click();
  await expect.poll(() => shopLines(page), { message: 'Undo took both lines off' }).toBe(before);
  await pick(page, ['Kaya']);
  await page.click('[data-act="sel-list"]');
  await expect(toast(page)).toContainText('1 item on the shopping list');
  await expect.poll(() => shopLines(page)).toBe(before + 1);
  await pick(page, ['Kaya', 'Eggs (10)']);
  await page.click('[data-act="sel-list"]');
  await expect(toast(page), 'one was already there').toContainText('1 item on the shopping list (1 already there)');
});

test('Delete: a marker, not a delete; Undo brings the items back', async ({ phone }) => {
  const { page } = await open(phone);
  await pick(page, ['Wholemeal bread', 'Milo powder']);
  await page.click('[data-act="sel-delete"]');
  await expect(toast(page)).toContainText('2 items deleted');
  await expect.poll(async () => (await names(page)).some(n => /Wholemeal|Milo/.test(n)), { message: 'they are gone from the list' }).toBe(false);
  expect((await itemNamed(page, 'Milo powder')).removed, 'a marker, not a delete (Recently removed has them)').toBe(true);
  await undo(page).click();
  await expect.poll(async () => { const n = await names(page); return n.some(x => /Milo/.test(x)) && n.some(x => /Wholemeal/.test(x)); }, { message: 'Undo brought them back' }).toBe(true);
  expect((await itemNamed(page, 'Milo powder')).removed).toBe(false);
});

// ---------- state survives a change from another phone; what disappears drops out ----------
test('a change from another phone keeps the selection; what was removed drops out of it', async ({ phone }) => {
  const { page } = await open(phone);
  await pick(page, ['Kaya', 'Eggs']);
  // another phone changes Fresh milk (a remote change redraws the list) and removes Eggs
  await page.evaluate(() => {
    const S = window.__pantry.S, milk = [...S.items.values()].find(i => i.name === 'Fresh milk'), eggs = [...S.items.values()].find(i => i.name === 'Eggs (10)');
    S.items.set(milk.id, { ...milk, name: 'Fresh milk 2 L' }); S.items.set(eggs.id, { ...eggs, removedAt: new Date().toISOString(), removedBy: 'Dad' });
    window.__pantry.redraw();   // what the app does when another phone's change arrives
  });
  await expect(count(page), 'what was removed on the other phone dropped out of the selection').toHaveText('1 selected');
  await selecting(page);
  await expect(row(page, 'Kaya').locator('input'), 'the rest stays ticked').toBeChecked();
  await expect.poll(() => names(page), { message: 'the change shows, the removed item is gone' }).toContain('Fresh milk 2 L');
  expect(await names(page)).not.toContain('Eggs (10)');
});

// ---------- the grip: a real button on every row; dragging by it, with real touch ----------
// (a tall screen, so every row and heading is on screen)
async function dragTo(touch, from, to, steps = 8) {
  for (let i = 1; i <= steps; i++) await touch('touchMove', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
}
const ghost = page => page.locator('.pa-ghost');
const tip = page => page.locator('.pa-ghost-tip');

test('the grip: a 44px real button on every row, outside the row link; axe', async ({ phone, axe }) => {
  const { page } = await open(phone, { height: 2000 });
  await expect(page.locator('#pa-items-list .pa-grip'), 'a grip on every row').toHaveCount(13);
  const g = await row(page, 'Kaya').locator('.pa-grip').boundingBox();
  expect(g.width >= 43.5 && g.height >= 43.5, `a 44px target (${g.width}x${g.height})`).toBe(true);
  await expect(row(page, 'Kaya').locator('.pa-grip')).toHaveAttribute('aria-label', 'Reorder or move Kaya');
  await expect(row(page, 'Kaya').locator('button.pa-grip'), 'a real button').toHaveCount(1);
  await expect(page.locator('#pa-items-list a.pa-item .pa-grip'), 'not inside the row’s link').toHaveCount(0);
  expect(await page.locator('.pa-grip').first().evaluate(e => getComputedStyle(e).touchAction), 'touch-action: none on the grip').toBe('none');
  await axe(page, 'Items with grips');
});

test('drag one item onto a heading: a ghost, the heading lit, a label; the drop moves it and Undo puts it back', async ({ phone }) => {
  const { page, touch } = await open(phone, { height: 2000 });
  await place(page, 'Place');
  await expect(page.locator('section[data-place="Kitchen cabinet"] .pa-grouphead')).toBeVisible();
  const c = await gripPoint(page, 'Kaya');
  await touch('touchStart', c.x, c.y);
  await touch('touchMove', c.x, c.y + 4);
  await expect(ghost(page), 'a 4 px wobble is not yet a drag').toHaveCount(0);
  const hb = await headBox(page, 'Kitchen cabinet');
  await dragTo(touch, c, { x: 150, y: hb.y + hb.height / 2 });
  await expect(ghost(page), 'a ghost follows the finger').toHaveCount(1);
  await expect(page.locator('section[data-place="Kitchen cabinet"].pa-drop'), 'the heading under it is lit').toHaveCount(1);
  await expect(tip(page), 'a label says where it will land').toHaveText('Move to Kitchen cabinet');
  await expect(ghost(page), 'the ghost is hidden from screen readers').toHaveAttribute('aria-hidden', 'true');
  const gb = await ghost(page).boundingBox();
  expect(gb.y + gb.height, 'the ghost is lifted above the finger so it is not hidden by it').toBeLessThanOrEqual(hb.y + hb.height / 2);
  expect(await buzzes(page), 'a tick on reaching the heading').toBeGreaterThanOrEqual(1);
  await touch('touchEnd');
  await expect(ghost(page)).toHaveCount(0);
  await expect(page.locator('.pa-drop'), 'ghost and highlight gone').toHaveCount(0);
  await expect.poll(() => locationOf(page, 'Kaya'), { message: 'Kaya moved' }).toBe('Kitchen cabinet');
  await expect(toast(page), 'one toast').toContainText('Kaya moved to Kitchen cabinet');
  await undo(page).click();
  await expect.poll(() => locationOf(page, 'Kaya'), { message: 'Undo' }).toBe('Fridge');
  expect(hash(page), 'no navigation').toBe('#/items');
});

test('drag: its own heading is ignored, and so is dropping on nothing', async ({ phone }) => {
  const { page, touch } = await open(phone, { height: 2000 });
  await place(page, 'Place');
  await expect(page.locator('section[data-place="Fridge"] .pa-grouphead')).toBeVisible();
  let c = await gripPoint(page, 'Kaya');
  const hb = await headBox(page, 'Fridge');
  await touch('touchStart', c.x, c.y);
  await dragTo(touch, c, { x: 150, y: hb.y + hb.height / 2 });
  await expect(tip(page)).toHaveText('Already in Fridge');
  await expect(page.locator('.pa-drop'), 'its own heading is not lit').toHaveCount(0);
  await touch('touchEnd');
  await expect(ghost(page)).toHaveCount(0);
  expect(await locationOf(page, 'Kaya')).toBe('Fridge');
  await expect(toast(page), 'no move').toHaveCount(0);
  // over the bar and title: nothing to drop on
  c = await gripPoint(page, 'Kaya');
  await touch('touchStart', c.x, c.y);
  await dragTo(touch, c, { x: 150, y: 60 });
  await expect(tip(page), 'the label says what to do').toContainText('Drop on a place');
  await touch('touchEnd');
  await expect(ghost(page)).toHaveCount(0);
  expect(await locationOf(page, 'Kaya'), 'dropped on nothing: nothing happens').toBe('Fridge');
  await expect(toast(page)).toHaveCount(0);
});

test('drag: Escape puts everything back and nothing moves', async ({ phone }) => {
  const { page, touch } = await open(phone, { height: 2000 });
  await place(page, 'Place');
  await expect(page.locator('section[data-place="Kitchen cabinet"] .pa-grouphead')).toBeVisible();
  const c = await gripPoint(page, 'Kaya');
  const hb = await headBox(page, 'Kitchen cabinet');
  await touch('touchStart', c.x, c.y);
  await dragTo(touch, c, { x: 150, y: hb.y + hb.height / 2 });
  await expect(page.locator('section[data-place="Kitchen cabinet"].pa-drop')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(ghost(page)).toHaveCount(0);
  await expect(page.locator('.pa-drop'), 'Escape puts everything back').toHaveCount(0);
  await touch('touchEnd');
  await selecting(page, false);
  expect(await locationOf(page, 'Kaya'), 'and nothing moved').toBe('Fridge');
  await expect(toast(page)).toHaveCount(0);
});

test('drag a selection of three by the grip of a ticked row: one batch, one Undo', async ({ phone }) => {
  const { page, touch } = await open(phone, { height: 2000 });
  await place(page, 'Place');
  await expect(page.locator('section[data-place="Kitchen cabinet"] .pa-grouphead')).toBeVisible();
  await pick(page, ['Kaya', 'Fresh milk', 'Eggs (10)']);
  const c = await gripPoint(page, 'Fresh milk');
  const hb = await headBox(page, 'Kitchen cabinet');
  await touch('touchStart', c.x, c.y);
  await dragTo(touch, c, { x: 150, y: hb.y + hb.height / 2 });
  await expect(page.locator('.pa-ghost-card'), 'the ghost says 3 items').toHaveText('3 items');
  await expect(tip(page)).toHaveText('Move 3 items to Kitchen cabinet');
  await touch('touchEnd');
  for (const n of ['Kaya', 'Fresh milk', 'Eggs (10)']) await expect.poll(() => locationOf(page, n), { message: n }).toBe('Kitchen cabinet');
  await selecting(page, false);
  await expect(toast(page)).toContainText('3 items moved to Kitchen cabinet');
  await undo(page).click();
  await expect.poll(() => locationOf(page, 'Eggs (10)'), { message: 'one Undo for the batch' }).toBe('Fridge');
  expect(await locationOf(page, 'Kaya')).toBe('Fridge');
});

test('drag while selecting: the grip of a row that is not ticked drags only that row', async ({ phone }) => {
  const { page, touch } = await open(phone, { height: 2000 });
  await place(page, 'Place');
  await expect(page.locator('section[data-place="Kitchen cabinet"] .pa-grouphead')).toBeVisible();
  await pick(page, ['Kaya']);
  const c = await gripPoint(page, 'Eggs (10)');
  const hb = await headBox(page, 'Kitchen cabinet');
  await touch('touchStart', c.x, c.y);
  await dragTo(touch, c, { x: 150, y: hb.y + hb.height / 2 });
  await expect(tip(page), 'an unticked row drags alone').toHaveText('Move to Kitchen cabinet');
  await touch('touchEnd');
  await expect.poll(() => locationOf(page, 'Eggs (10)')).toBe('Kitchen cabinet');
  expect(await locationOf(page, 'Kaya'), 'the ticked one stayed').toBe('Fridge');
});

// ---------- drag onto a place chip (any sort), by touch and by mouse ----------
test('drag onto a place chip in the default sort, by touch', async ({ phone }) => {
  const { page, touch } = await open(phone, { height: 1500 });
  const c = await gripPoint(page, 'Laundry liquid');
  const chip = await page.locator('.ha-chip[data-place="Fridge"]').boundingBox();
  await touch('touchStart', c.x, c.y);
  await dragTo(touch, c, { x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 }, 10);
  await expect(page.locator('.ha-chip.pa-drop'), 'the place chip is lit').toHaveCount(1);
  await expect(tip(page)).toHaveText('Move to Fridge');
  await touch('touchEnd');
  await expect.poll(() => locationOf(page, 'Laundry liquid'), { message: 'moved by dropping on a chip' }).toBe('Fridge');
});

test('drag onto a place chip with a mouse', async ({ phone }) => {
  const { page } = await open(phone, { height: 1500 });
  const c = await gripPoint(page, 'Laundry liquid');
  const chip = await page.locator('.ha-chip[data-place="Kitchen cabinet"]').boundingBox();
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 5, c.y + 3);
  await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2, { steps: 10 });
  await expect(ghost(page), 'a mouse drags too').toHaveCount(1);
  await page.mouse.up();
  await expect.poll(() => locationOf(page, 'Laundry liquid'), { message: 'moved by a mouse' }).toBe('Kitchen cabinet');
});

test('a tap on the grip opens its Move sheet and does not drag', async ({ phone }) => {
  const { page } = await open(phone, { height: 1500 });
  await row(page, 'Kaya').locator('.pa-grip').tap();
  await expect(sheet(page), 'a tap on the grip opens the Move sheet').toHaveCount(1);
  await expect(sheet(page).locator('[data-g="up"]'), 'no Move up outside My order').toHaveCount(0);
  await expect(sheet(page).locator('[data-g="to"]'), 'Move to… is there').toHaveCount(1);
  await sheet(page).locator('[data-ha-close]').click();
  await expect(sheet(page)).toHaveCount(0);
});

// ---------- auto-scroll at the edges of a short screen ----------
test('auto-scroll: a drag near the bottom edge scrolls the page, near the top it scrolls back', async ({ phone }) => {
  const { page, touch } = await open(phone, { height: 560 });
  const c = await gripPoint(page, 'Wholemeal bread');
  await touch('touchStart', c.x, c.y);
  const bottom = await page.evaluate(() => document.querySelector('.ha-tabbar').getBoundingClientRect().top);
  await dragTo(touch, c, { x: c.x, y: bottom - 20 });
  await expect(ghost(page)).toHaveCount(1);
  const s0 = await page.evaluate(() => scrollY);
  await expect.poll(() => page.evaluate(() => scrollY), { message: 'holding near the bottom edge scrolls the page' }).toBeGreaterThan(s0 + 60);
  await expect(ghost(page), 'the drag goes on while it scrolls').toHaveCount(1);
  const s1 = await page.evaluate(() => scrollY);
  for (let i = 1; i <= 6; i++) await touch('touchMove', c.x, bottom - 20 - (bottom - 25) * i / 6);
  await expect.poll(() => page.evaluate(() => scrollY), { message: 'and near the top it scrolls back' }).toBeLessThan(s1 - 40);
  await touch('touchEnd');
  await expect(ghost(page)).toHaveCount(0);
  await expect(toast(page), 'nothing was dropped').toHaveCount(0);
});

// ---------- reduced motion: a drag still works, with no buzz and a still ghost ----------
test('reduced motion: a drag still works, with no tick and a still ghost', async ({ phone }) => {
  const { page, touch } = await open(phone, { height: 1500, reducedMotion: 'reduce' });
  await place(page, 'Place');   // (the target is a heading well away from the screen's edges: held near one, the page would auto-scroll under the finger)
  await expect(page.locator('section[data-place="Kitchen cabinet"] .pa-grouphead')).toBeVisible();
  const c = await gripPoint(page, 'Kaya');
  const hb = await headBox(page, 'Kitchen cabinet');
  await touch('touchStart', c.x, c.y);
  await dragTo(touch, c, { x: 150, y: hb.y + hb.height / 2 });
  await expect(ghost(page)).toHaveCount(1);
  await expect(page.locator('section[data-place="Kitchen cabinet"].pa-drop'), 'the heading is lit').toHaveCount(1);
  expect(await buzzes(page), 'no tick with reduced motion').toBe(0);
  const tr = await ghost(page).evaluate(e => getComputedStyle(e).transitionDuration);
  expect(parseFloat(tr), 'the ghost has no animation: ' + tr).toBeLessThanOrEqual(0.001);
  await touch('touchEnd');
  await expect.poll(() => locationOf(page, 'Kaya')).toBe('Kitchen cabinet');
});

// ---------- Bulk edit: pick, choose (every field Unchanged), Review, Save one batch, one Undo ----------
// (a tall screen: the fixed tab bar never sits over a row, which axe's target-size check would count)
const ymdPlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const bulkCount = page => page.locator('#pa-bcount');
const bulkRow = (page, name) => page.locator('#pa-bulk-list li', { hasText: name }).locator('.pa-item');
const itemOf = (page, name) => page.evaluate(n => { const it = [...window.__pantry.S.items.values()].find(i => i.name === n); return it && { location: it.location, category: it.category, measure: it.measure || null, level: it.level || null, removed: !!it.removedAt, exp: it.batches.map(b => b.expiry), qty: it.batches.map(b => b.qty) }; }, name);
const panels = page => page.locator('.ha-panel').allTextContents().then(a => a.join('|'));
async function openBulk(phone) {
  const o = await open(phone, { height: 3200 });
  await o.page.click('[data-act="bulk-open"]');
  await expect(o.page.locator('#pa-bulk-list input.pa-bsel')).toHaveCount(13);
  return o;
}
async function review(page) {
  await page.click('[data-act="bk-review"]');
  await expect(page.locator('[data-act="bk-save"]')).toBeVisible();
}
async function save(page) {
  await page.click('[data-act="bk-save"]');
  await expect.poll(() => hash(page)).toBe('#/items');
}

test('Bulk edit: every field starts Unchanged; filters and Select all matching', async ({ phone }) => {
  const { page } = await openBulk(phone);
  expect(hash(page)).toBe('#/bulk');
  await expect(page.locator('.ha-back'), 'a back button to Items').toBeVisible();
  await expect(bulkCount(page)).toHaveText('None selected');
  for (const id of ['place', 'category', 'mode', 'expiry', 'list', 'bin']) await expect(page.locator(`#pa-bk-${id}`), `${id} starts Unchanged`).toHaveValue('');
  await expect(page.locator('#pa-bk-place option:checked')).toHaveText('Unchanged');
  // filters: search, a place chip, a category; Select all matching is the whole result
  await page.fill('#pa-bq', 'sauce');
  await expect(page.locator('#pa-bulk-list .pa-item'), 'search narrows the list').toHaveCount(3);
  await page.click('[data-act="bk-all"]');
  await expect(bulkCount(page)).toHaveText('3 selected');
  await page.fill('#pa-bq', '');
  await expect(page.locator('#pa-bulk-list .pa-item')).toHaveCount(13);
  await expect(bulkCount(page), 'the selection is kept when the list changes').toHaveText('3 selected');
  await page.fill('#pa-bq', 'zzz');
  await expect(bulkCount(page)).toHaveText('3 selected (3 not shown)');
  await page.fill('#pa-bq', '');
  await expect(page.locator('#pa-bulk-list .pa-item')).toHaveCount(13);
  await page.click('[data-act="bk-none"]');
  await expect(bulkCount(page)).toHaveText('None selected');
  await page.click('[data-act="bk-place"][data-v="Fridge"]');
  await expect(page.locator('#pa-bulk-list .pa-item')).toHaveCount(4);
  await page.selectOption('#pa-bk-cat', 'Dairy & eggs');
  await expect(page.locator('#pa-bulk-list .pa-item'), 'place and category together').toHaveCount(2);
  await page.click('[data-act="bk-all"]');
  await expect(bulkCount(page)).toHaveText('2 selected');
});

test('Bulk edit: Review needs items and a complete choice, says what is missing, then Back keeps the choices', async ({ phone, axe }) => {
  const { page } = await openBulk(phone);
  await page.click('[data-act="bk-review"]');
  await expect(toast(page)).toContainText('Select some items first');
  for (const n of ['Kaya', 'Fresh milk', 'Eggs (10)']) await bulkRow(page, n).tap();
  await expect(bulkCount(page)).toHaveText('3 selected');
  await page.click('[data-act="bk-review"]');
  await expect(toast(page), 'nothing chosen yet').toContainText('Choose what to change first');
  await page.selectOption('#pa-bk-place', 'set');
  await page.click('[data-act="bk-review"]');
  await expect(toast(page), 'an incomplete choice says what is missing').toContainText('Choose the place');
  await page.selectOption('#pa-bk-place-to', 'Basement store');
  await page.selectOption('#pa-bk-category', 'set');
  await page.selectOption('#pa-bk-category-to', 'Other');
  await axe(page, 'Bulk edit');
  await review(page);
  await expect(page.locator('.ha-large-sub')).toHaveText('3 items will change');
  await expect(page.locator('.ha-list').first().locator('.ha-row-title')).toHaveText(['Place: move to Basement store', 'Category: change to Other']);
  await expect(page.locator('.pa-warn', { hasText: 'replaces what these items have now' }), 'warns it replaces').toHaveCount(1);
  const samples = page.locator('section[aria-labelledby="h-bk-samples"] li');
  await expect(samples, 'up to three before and after').toHaveCount(3);
  await expect(samples.first(), 'before then after').toContainText(/Fridge[\s\S]*Basement store/);
  await expect(page.locator('#pa-bulk-h'), 'focus moves to the heading of the step').toBeFocused();
  await axe(page, 'Bulk edit: Review');
  await page.click('[data-act="bk-back"]');
  await expect(page.locator('#pa-bk-place-to'), 'Back keeps what was chosen').toHaveValue('Basement store');
  await expect(bulkCount(page)).toHaveText('3 selected');
});

test('Bulk edit: Save is one batch and one toast; Undo leaves alone what changed since', async ({ phone }) => {
  const { page } = await openBulk(phone);
  for (const n of ['Kaya', 'Fresh milk', 'Eggs (10)']) await bulkRow(page, n).tap();
  await page.selectOption('#pa-bk-place', 'set');
  await page.selectOption('#pa-bk-place-to', 'Basement store');
  await page.selectOption('#pa-bk-category', 'set');
  await page.selectOption('#pa-bk-category-to', 'Other');
  await review(page);
  await save(page);
  await expect(toast(page)).toContainText('3 items changed');
  for (const n of ['Kaya', 'Fresh milk', 'Eggs (10)']) {
    const o = await itemOf(page, n);
    expect([o.location, o.category], n).toEqual(['Basement store', 'Other']);
  }
  // someone moved Fresh milk since: Undo leaves it and says so
  await edit(page, 'Fresh milk', { location: 'Freezer' });
  await undo(page).click();
  await expect.poll(async () => { const k = await itemOf(page, 'Kaya'); return [k.location, k.category]; }, { message: 'Undo put Kaya back' }).toEqual(['Fridge', 'Breakfast & spreads']);
  expect((await itemOf(page, 'Fresh milk')).location, 'the one changed since is left').toBe('Freezer');
  await expect(toast(page)).toContainText('1 changed since, left as it is');
});

test('Bulk edit: best-before shifted by days; items with no stock are skipped and counted; Undo', async ({ phone }) => {
  const { page } = await openBulk(phone);
  await page.click('[data-act="bk-all"]');
  await page.selectOption('#pa-bk-expiry', 'shift');
  await page.fill('#pa-bk-days', '10');
  const milkBefore = (await itemOf(page, 'Fresh milk')).exp[0];
  await review(page);
  expect(await panels(page), 'items with nothing in stock are skipped, and it says so').toMatch(/skipped for best-before: nothing in stock/);
  await expect(page.locator('.pa-warn'), 'shifting a date replaces nothing: no warning').toHaveCount(0);
  await save(page);
  await expect.poll(async () => (await itemOf(page, 'Fresh milk')).exp[0], { message: 'ten days later (milk was 3 days out)' }).toBe(ymdPlus(13));
  await undo(page).click();
  await expect.poll(async () => (await itemOf(page, 'Fresh milk')).exp[0], { message: 'Undo' }).toBe(milkBefore);
});

test('Bulk edit: a set date and tracking mode together warn; the stock is kept and Undo is exact', async ({ phone }) => {
  const { page } = await openBulk(phone);
  await bulkRow(page, 'Sardines').tap();
  await page.selectOption('#pa-bk-mode', 'level');
  await page.selectOption('#pa-bk-expiry', 'set');
  await page.fill('#pa-bk-date', '2027-05-05');
  await review(page);
  await expect(page.locator('.pa-warn').first(), 'converting to Plenty, low, out warns that counts are hidden').toContainText('1 item will stop counting');
  expect(await panels(page), 'and its date is skipped').toMatch(/kept as Plenty, Low, Out, so no dates/);
  await save(page);
  await expect.poll(async () => { const s = await itemOf(page, 'Sardines in tomato sauce'); return [s.measure, s.level, s.qty]; }, { message: 'converted; the stock is kept, hidden' }).toEqual(['level', 'plenty', [4]]);
  await undo(page).click();
  await expect.poll(async () => { const s = await itemOf(page, 'Sardines in tomato sauce'); return [s.measure, s.level, s.qty]; }, { message: 'Undo is exact' }).toEqual([null, null, [4]]);
});

test('Bulk edit: onto the shopping list; Undo takes the lines off', async ({ phone }) => {
  const { page } = await openBulk(phone);
  for (const n of ['Kaya', 'Eggs (10)']) await bulkRow(page, n).tap();
  await page.selectOption('#pa-bk-list', 'add');
  const lines0 = await shopLines(page);
  await review(page);
  await save(page);
  await expect.poll(() => shopLines(page)).toBe(lines0 + 2);
  await undo(page).click();
  await expect.poll(() => shopLines(page), { message: 'Undo takes the lines off' }).toBe(lines0);
});

test('Bulk edit: delete is reviewed on its own; Undo restores the item', async ({ phone }) => {
  const { page } = await openBulk(phone);
  await bulkRow(page, 'Milo').tap();
  await page.selectOption('#pa-bk-bin', 'del');
  await expect(page.locator('#pa-bulk-changes')).toContainText('Delete is done on its own');
  await review(page);
  await expect(page.locator('.ha-large-sub')).toHaveText('1 item will be deleted');
  await expect(page.locator('[data-act="bk-save"]')).toHaveText('Delete 1 item');
  await save(page);
  await expect.poll(async () => (await itemOf(page, 'Milo powder')).removed).toBe(true);
  await undo(page).click();
  await expect.poll(async () => (await itemOf(page, 'Milo powder')).removed, { message: 'Undo restores it' }).toBe(false);
});

test('Bulk edit from the selection bar: the ticked items come along, and Back lands on Items', async ({ phone }) => {
  const { page } = await open(phone, { height: 3200 });
  await pick(page, ['Kaya', 'Fresh milk']);
  await page.click('[data-act="bulk-open"]');
  await expect.poll(() => hash(page)).toBe('#/bulk');
  await expect(bulkCount(page), 'the selection came with it').toHaveText('2 selected');
  await page.goBack();
  await expect.poll(() => hash(page), { message: 'Back from Bulk edit lands on Items' }).toBe('#/items');
  await selecting(page, false);
});
