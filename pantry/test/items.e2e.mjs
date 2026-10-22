// The Items list on a phone (390px, touch): node pantry/test/items.e2e.mjs   (SHOTS=<dir> also saves screenshots)
// Demo mode (made-up items in memory), the real kit and the real app code, with REAL touch input (Chrome's
// Input.dispatchTouchEvent, so pointer events, scrolling and the click after a tap behave as on a phone):
//   - selecting: the Select button, a press and hold (500 ms triggers; 10 px of movement cancels; a vertical scroll doesn't
//     start one; the click after the hold doesn't open the row; a buzz where the phone allows it and none with reduced motion),
//     checkboxes (tap, Space, Enter), Select all / none / Done, "Select these N" under a heading, Back and Escape leave it,
//     leaving the screen ends it, items filtered out stay selected and are counted;
//   - the three actions (Move to…, Shopping list, Delete): one batch and one toast with Undo that leaves alone what changed since;
//   - Group by place: headings with counts that fold, and the default sort unchanged;
//   - the grip on every row (a real 44px button): dragging one item or a whole selection onto a place heading or chip (a ghost lifted
//     above the finger, the target lit, a label saying where it lands, Escape cancels, its own place is ignored, auto-scroll at the
//     edges), My order (reorder in a category: one number on one item; the first reorder numbers the category), and the keyboard and
//     screen-reader ways (arrow keys on the grip, its sheet with Move up, Move down and Move to…);
//   - Bulk edit (#/bulk): filters, Select all matching, every field Unchanged, Review (N items will change, skips, warnings, before and
//     after), Save one batch with one Undo, conversions that keep the stock, dates shifted or set, the shopping list, delete;
//   - axe on every state added here.
// Needs Playwright (PLAYWRIGHT_PATH) and axe-core (AXE_PATH, or node_modules/axe-core found from the repo or cwd).
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = process.env.SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
function findAxe() {
  if (process.env.AXE_PATH) return process.env.AXE_PATH;
  for (const base of [ROOT, process.cwd()]) {
    try { return createRequire(path.join(base, 'noop.js')).resolve('axe-core/axe.min.js'); } catch { /* next */ }
  }
  throw new Error('axe-core not found: npm install --no-save axe-core (or set AXE_PATH)');
}
const AXE = fs.readFileSync(findAxe(), 'utf8');

const srv = await serve();
const BASE = srv.url + '/pantry/';
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const settle = page => page.waitForTimeout(450);
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

// A phone on the demo pantry. `buzz` records navigator.vibrate calls (an Android user agent, as haHaptic wants).
async function open(url = BASE + '?demo#/items', opts = {}) {
  const { height = 844, ...rest } = opts;
  const ctx = await browser.newContext({ viewport: { width: 390, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: ANDROID, ...rest });
  await ctx.addInitScript(() => { window.__buzz = []; navigator.vibrate = ms => { window.__buzz.push(ms); return true; }; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  await page.locator('.ha-large-title').first().waitFor();
  await settle(page);
  const cdp = await ctx.newCDPSession(page);
  const t = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
  return { ctx, page, errors, touch: t };
}
async function axe(page, what) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }))
    .violations.map(x => `${x.id} (${x.impact}): ${x.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `${what}: axe violations\n  ${v.join('\n  ')}`);
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const hash = page => new URL(page.url()).hash;
const rowBox = async (page, name) => (await page.locator('#pa-items-list li', { hasText: name }).first().locator('.pa-item').boundingBox());
const count = page => page.locator('#pa-selcount').textContent();
const selecting = page => page.locator('#pa-selbar').count().then(n => n === 1);
const names = page => page.evaluate(() => [...document.querySelectorAll('#pa-items-list .ha-row-title')].map(e => e.textContent));
const itemNamed = (page, name) => page.evaluate(n => { const it = [...window.__pantry.S.items.values()].find(i => i.name === n); return it && { id: it.id, location: it.location, removed: !!it.removedAt }; }, name);
const stateOf = page => page.evaluate(() => ({ on: window.__pantry.S.sel.on, n: window.__pantry.S.sel.ids.size, h: location.hash }));
const toast = page => page.locator('.ha-toast.is-visible');

try {
  // ---------- the list as it is (default sort and look unchanged), the sort fits ----------
  {
    const { ctx, page, errors } = await open();
    ok(await page.locator('input[name="pa-sort"]:checked').getAttribute('value') === 'expiry', 'the default sort is still Use by');
    eq(await page.locator('.ha-segmented .ha-seg span').allTextContents(), ['Use by', 'Name', 'Category', 'Place'], 'no My order choice');
    ok(await page.locator('.pa-within').count() === 0, 'the second choice is hidden');
    const seg = await page.evaluate(() => { const f = document.querySelector('.ha-segmented'); return { sw: f.scrollWidth, cw: f.clientWidth, spans: [...f.querySelectorAll('.ha-seg span')].map(s => ({ w: s.getBoundingClientRect().width, sw: s.scrollWidth, cw: s.clientWidth })) }; });
    ok(seg.sw <= seg.cw && seg.spans.every(s => s.sw <= s.cw), 'the sort labels fit at 390px: ' + JSON.stringify(seg));
    ok(await page.locator('#pa-items-list .pa-item').count() === 13, 'thirteen items');
    ok(await page.locator('#pa-items-list a.pa-item[href^="#/item/"]').count() === 13, 'rows are links, as before');
    ok(await page.locator('#pa-sel-toggle').isVisible(), 'a Select button above the list');
    ok(!(await selecting(page)), 'no selection bar yet');
    await shot(page, 'i00-items');
    await ctx.close();
    ok(errors.length === 0, 'no errors: ' + errors.join(' | '));
  }

  // ---------- selecting by button: checkboxes, bar, Select all / none / Done, Escape and Back ----------
  {
    const { ctx, page, errors } = await open();
    await page.click('#pa-sel-toggle'); await settle(page);
    ok(await selecting(page), 'the selection bar is up');
    eq(await count(page), 'None selected');
    ok(await page.locator('#pa-items-list input.pa-sel').count() === 13, 'a real checkbox on every row');
    ok(await page.locator('#pa-items-list a.pa-item').count() === 0, 'rows are not links while selecting');
    ok(await page.locator('#pa-sel-toggle').count() === 0, 'the Select button is gone');
    const bar = await page.locator('#pa-selbar').boundingBox(), tab = await page.locator('.ha-tabbar').boundingBox();
    ok(Math.abs(bar.y + bar.height - tab.y) <= 1.5, `the bar sits right above the tab bar (bar bottom ${Math.round(bar.y + bar.height)}, tab top ${Math.round(tab.y)})`);
    ok(await page.locator('[data-act="sel-move"]').getAttribute('aria-disabled') === 'true', 'actions are off with nothing selected');
    // each checkbox has a name (its row's words)
    const cbName = await page.locator('#pa-items-list li').first().locator('label.pa-item').textContent();
    ok(/\w/.test(cbName), 'a checkbox is named by its row');
    // tap a row: it ticks and does not navigate
    const h0 = hash(page);
    await page.locator('#pa-items-list li', { hasText: 'Kaya' }).locator('.pa-item').tap(); await settle(page);
    eq(await count(page), '1 selected'); eq(hash(page), h0, 'tapping a row does not open it');
    ok(await page.locator('#pa-items-list li', { hasText: 'Kaya' }).locator('input').isChecked(), 'the row is ticked');
    ok(await page.locator('[data-act="sel-move"]').getAttribute('aria-disabled') === 'false', 'actions are on');
    // keyboard: Space and Enter toggle
    await page.locator('#pa-items-list li', { hasText: 'Fresh milk' }).locator('input').focus();
    await page.keyboard.press('Space'); eq(await count(page), '2 selected');
    await page.keyboard.press('Enter'); eq(await count(page), '1 selected', 'Enter unticks (Space ticked it)');
    await page.keyboard.press('Enter'); eq(await count(page), '2 selected');
    ok(await page.evaluate(() => document.activeElement.matches('input.pa-sel')), 'focus stays on the checkbox');
    await shot(page, 'p03-select');
    // select all is the whole result; select none keeps selecting
    await page.click('[data-act="sel-all"]'); eq(await count(page), '13 selected');
    ok((await page.locator('#pa-items-list input:checked').count()) === 13);
    await page.click('[data-act="sel-none"]'); eq(await count(page), 'None selected'); ok(await selecting(page), 'Select none keeps selecting');
    // a filter: Select all means the whole filtered result; items filtered out stay selected and are counted
    await page.click('[data-act="place"][data-v="Fridge"]'); await settle(page);
    const fridge = await page.locator('#pa-items-list .pa-item').count();
    await page.click('[data-act="sel-all"]'); eq(await count(page), `${fridge} selected`);
    await page.click('[data-act="place"][data-v=""]'); await settle(page);
    eq(await count(page), `${fridge} selected`, 'the selection is kept when the filter changes');
    await page.fill('#pa-q', 'zzzz'); await settle(page);
    eq(await count(page), `${fridge} selected (${fridge} not shown)`, 'items the filter hides are counted, not forgotten');
    await page.fill('#pa-q', ''); await settle(page);
    await page.click('[data-act="sel-none"]');
    // Done leaves selecting, on the same screen and without a dead history entry
    const depth0 = await page.evaluate(() => history.length);
    await page.click('[data-act="sel-done"]'); await settle(page);
    ok(!(await selecting(page)) && hash(page) === '#/items', 'Done leaves select mode');
    ok(await page.locator('#pa-items-list a.pa-item').count() === 13, 'rows are links again');
    // Escape leaves it
    await page.click('#pa-sel-toggle'); await settle(page);
    await page.keyboard.press('Escape'); await settle(page);
    ok(!(await selecting(page)) && hash(page) === '#/items', 'Escape leaves select mode');
    // Back leaves it (and stays on Items)
    await page.click('#pa-sel-toggle'); await settle(page);
    ok(await selecting(page));
    await page.goBack(); await settle(page);
    ok(!(await selecting(page)) && hash(page) === '#/items', 'Back leaves select mode and stays on Items: ' + hash(page));
    // leaving the screen ends it, and the next Back does not land on a dead entry
    await page.click('#pa-sel-toggle'); await settle(page);
    await page.click('.ha-tab[href="#/shop"]'); await settle(page);
    ok(hash(page) === '#/shop' && !(await selecting(page)), 'another tab ends it');
    await page.goBack(); await settle(page);
    ok(hash(page) !== '#/shop', 'Back from there goes somewhere real: ' + hash(page));
    ok(!(await selecting(page)), 'and select mode does not come back');
    await ctx.close();
    ok(errors.length === 0, 'no errors: ' + errors.join(' | '));
  }

  // ---------- a press and hold, with real touch ----------
  {
    const { ctx, page, errors, touch } = await open(BASE + '?demo#/items', { height: 560 });
    const center = async name => { const b = await rowBox(page, name); return { x: b.x + b.width * 0.45, y: b.y + b.height / 2 }; };
    // 500 ms triggers: held, then lifted: selecting, that row ticked, no navigation, a buzz
    let c = await center('Kaya');
    await touch('touchStart', c.x, c.y);
    await page.waitForTimeout(250);
    ok(await page.locator('#pa-items-list li', { hasText: 'Kaya' }).locator('.pa-item.is-holding').count() === 1, 'a row being held shows it');
    ok(!(await selecting(page)), 'not yet at 250 ms');
    await page.waitForTimeout(450);
    ok(await selecting(page), 'a hold of 700 ms started selecting (before the finger lifted)');
    await touch('touchEnd');
    await settle(page);
    eq(await stateOf(page), { on: true, n: 1, h: '#/items' }, 'one row ticked, and the click after the hold did not open the row');
    ok(await page.locator('#pa-items-list li', { hasText: 'Kaya' }).locator('input').isChecked(), 'it is the row that was held');
    eq(await page.evaluate(() => window.__buzz.length), 1, 'one buzz');
    ok((await page.locator('#pa-selcount').textContent()) === '1 selected');
    await shot(page, 'i01-after-hold');
    await page.click('[data-act="sel-done"]'); await settle(page);

    // 499 ms is not a hold: a tap that lasts 300 ms still opens the row
    c = await center('Fresh milk');
    await touch('touchStart', c.x, c.y); await page.waitForTimeout(300); await touch('touchEnd'); await settle(page);
    ok(/^#\/item\//.test(hash(page)) && !(await selecting(page)), 'a slow tap opens the item: ' + hash(page));
    await page.goBack(); await settle(page);
    ok(hash(page) === '#/items');

    // 10 px of sideways movement cancels
    c = await center('Kaya');
    await touch('touchStart', c.x, c.y); await touch('touchMove', c.x + 14, c.y); await page.waitForTimeout(700); await touch('touchEnd'); await settle(page);
    ok(!(await selecting(page)), 'a 14 px movement cancels the hold');
    if (hash(page) !== '#/items') { await page.goBack(); await settle(page); }   // (still inside the browser's tap slop, so lifting the finger was a tap: the row opened)
    // 9 px of wobble does not
    c = await center('Kaya');
    await touch('touchStart', c.x, c.y); await touch('touchMove', c.x + 8, c.y); await page.waitForTimeout(700);
    ok(await selecting(page), '8 px of wobble is still a hold');
    await touch('touchEnd'); await settle(page);
    await page.click('[data-act="sel-done"]'); await settle(page);

    // a vertical scroll never starts one, and the page scrolls
    const y0 = await page.evaluate(() => scrollY);
    c = await center('Fresh milk');
    await touch('touchStart', c.x, c.y);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', c.x, c.y - i * 18); await page.waitForTimeout(60); }
    await page.waitForTimeout(500);
    ok(!(await selecting(page)), 'a scroll does not start selecting');
    await touch('touchEnd'); await settle(page);
    ok((await page.evaluate(() => scrollY)) > y0 + 40, 'the page scrolled');
    ok(!(await selecting(page)) && hash(page) === '#/items', 'and nothing opened');
    await page.evaluate(() => scrollTo(0, 0));

    // a hold on the Select-time grips, buttons and the search box does nothing (only the grip, buttons and inputs are guarded)
    const q = await page.locator('#pa-q').boundingBox();
    await touch('touchStart', q.x + 40, q.y + q.height / 2); await page.waitForTimeout(700); await touch('touchEnd'); await settle(page);
    ok(!(await selecting(page)), 'holding the search box does not start selecting');
    await ctx.close();
    ok(errors.length === 0, 'no errors: ' + errors.join(' | '));
  }

  // ---------- reduced motion: no buzz, no animation ----------
  {
    const { ctx, page, errors, touch } = await open(BASE + '?demo#/items', { reducedMotion: 'reduce' });
    const b = await rowBox(page, 'Kaya');
    await touch('touchStart', b.x + 60, b.y + b.height / 2); await page.waitForTimeout(700); await touch('touchEnd'); await settle(page);
    ok(await selecting(page), 'the hold still works');
    eq(await page.evaluate(() => window.__buzz.length), 0, 'no buzz with reduced motion');
    await page.click('[data-act="sel-done"]'); await page.locator('.ha-seg', { hasText: 'Place' }).click(); await settle(page);
    const tr = await page.evaluate(() => getComputedStyle(document.querySelector('.pa-fold-icon')).transitionDuration);
    ok(parseFloat(tr) <= 0.001, 'no transition on the fold chevron with reduced motion (the kit zeroes them): ' + tr);
    await ctx.close();
    ok(errors.length === 0, 'no errors: ' + errors.join(' | '));
  }

  // ---------- Group by place: headings with counts that fold; selecting under a heading ----------
  {
    const { ctx, page, errors } = await open();
    await page.locator('.ha-seg', { hasText: 'Place' }).click(); await settle(page);
    const heads = await page.locator('.pa-grouphead').evaluateAll(hs => hs.map(h => ({ name: h.querySelector('.pa-fold-name').textContent, n: h.querySelector('.ha-num').textContent })));
    ok(heads.length >= 5, 'a heading for each place that has items: ' + JSON.stringify(heads));
    const fridge = heads.find(h => h.name === 'Fridge');
    ok(fridge && Number(fridge.n) === 4, 'Fridge has four, shown as a count: ' + JSON.stringify(fridge));
    ok(await page.locator('section[data-place="Fridge"] .pa-item').count() === 4, 'its four rows are under it');
    eq(await page.locator('input[name="pa-sort"]:checked').getAttribute('value'), 'place');
    // fold
    const fb = page.locator('section[data-place="Fridge"] .pa-fold');
    eq(await fb.getAttribute('aria-expanded'), 'true');
    await fb.click(); await settle(page);
    eq(await page.locator('section[data-place="Fridge"] .pa-fold').getAttribute('aria-expanded'), 'false');
    ok(await page.locator('section[data-place="Fridge"] .pa-item').count() === 0, 'folded: the rows are hidden');
    ok(await page.evaluate(() => document.activeElement?.matches?.('.pa-fold')), 'focus stays on the heading button');
    eq(await page.evaluate(() => JSON.parse(localStorage.getItem('pantry:folded'))), ['place:Fridge'], 'the fold is kept on this phone');
    await page.reload(); await page.locator('.ha-large-title').waitFor(); await settle(page);
    eq(await page.locator('section[data-place="Fridge"] .pa-fold').getAttribute('aria-expanded'), 'false', 'and after a reload');
    // select these N
    await page.click('#pa-sel-toggle'); await settle(page);
    await page.click('section[data-place="Kitchen cabinet"] [data-act="sel-group"]'); await settle(page);
    const kc = await page.locator('section[data-place="Kitchen cabinet"] .pa-item').count();
    eq(await count(page), `${kc} selected`, '“Select these N” ticks that heading');
    eq((await page.locator('section[data-place="Kitchen cabinet"] [data-act="sel-group"]').textContent()), `Unselect these ${kc}`);
    // a folded heading's items can be selected too
    await page.click('section[data-place="Fridge"] [data-act="sel-group"]');
    eq(await count(page), `${kc + 4} selected`, 'a folded heading selects its hidden rows too');
    await page.click('section[data-place="Kitchen cabinet"] [data-act="sel-group"]');
    eq(await count(page), '4 selected', 'tapping it again unticks them');
    await settle(page);
    await shot(page, 'p04-group-place');
    await axe(page, 'Items: group by place, selecting');
    await page.click('[data-act="sel-done"]'); await settle(page);
    await axe(page, 'Items: group by place');
    // category grouping keeps its headings (and has Select these N too)
    await page.locator('.ha-seg', { hasText: 'Category' }).click(); await settle(page);
    ok(await page.locator('.pa-grouphead').count() >= 6, 'category headings');
    ok(await page.locator('.pa-fold').count() === 0, 'category headings do not fold');
    await ctx.close();
    ok(errors.length === 0, 'no errors: ' + errors.join(' | '));
  }

  // ---------- the three actions, each one batch and one toast with Undo ----------
  {
    const { ctx, page, errors } = await open(BASE + '?demo#/items');
    const pick = async list => { await page.click('#pa-sel-toggle'); await settle(page); for (const n of list) await page.locator('#pa-items-list li', { hasText: n }).locator('.pa-item').tap(); };
    // Move to…
    await pick(['Kaya', 'Fresh milk', 'Laundry liquid']);
    await page.click('[data-act="sel-move"]'); await settle(page);
    const sheet = page.locator('dialog.ha-sheet[open]');
    ok(await sheet.locator('.ha-sheet-title').textContent() === 'Move 3 items', 'the sheet names how many');
    ok(await sheet.locator('input[name="pa-moveto"]').count() >= 11, 'every place is offered');
    ok(await sheet.locator('#pa-moveto-go').getAttribute('aria-disabled') === 'true', 'the button waits for a choice');
    await axe(page, 'Move to… sheet');
    await shot(page, 'i02-move-sheet');
    await sheet.locator('label', { hasText: 'Basement store' }).click();
    eq(await sheet.locator('#pa-moveto-go').textContent(), 'Move 3 items to Basement store');
    await sheet.locator('#pa-moveto-go').click(); await settle(page);
    ok(!(await selecting(page)), 'the actions end selecting');
    for (const n of ['Kaya', 'Fresh milk', 'Laundry liquid']) eq((await itemNamed(page, n)).location, 'Basement store', n + ' moved');
    ok(/3 items moved to Basement store/.test(await toast(page).textContent()), 'one toast says so: ' + await toast(page).textContent());
    // someone changed Fresh milk since (it was moved elsewhere on another phone): Undo leaves it
    await page.evaluate(() => { const it = [...window.__pantry.S.items.values()].find(i => i.name === 'Fresh milk'); window.__pantry.S.items.set(it.id, { ...it, location: 'Freezer' }); });
    await page.locator('.ha-toast-action').click(); await settle(page);
    eq((await itemNamed(page, 'Kaya')).location, 'Fridge', 'Undo put Kaya back'); eq((await itemNamed(page, 'Laundry liquid')).location, 'Laundry');
    eq((await itemNamed(page, 'Fresh milk')).location, 'Freezer', 'Fresh milk, changed since, is left as it is');
    ok(/1 changed since, left as it is/.test(await toast(page).textContent()), 'and it says so: ' + await toast(page).textContent());
    // put it back for the next steps
    await page.evaluate(() => { const it = [...window.__pantry.S.items.values()].find(i => i.name === 'Fresh milk'); window.__pantry.S.items.set(it.id, { ...it, location: 'Fridge' }); });

    // Shopping list
    await page.goto(BASE + '?demo#/items'); await page.locator('.ha-large-title').waitFor(); await settle(page);
    const before = await page.evaluate(() => [...window.__pantry.S.shop.values()].length);
    await pick(['Kaya', 'Eggs (10)']);
    await page.click('[data-act="sel-list"]'); await settle(page);
    eq(await page.evaluate(() => [...window.__pantry.S.shop.values()].length), before + 2, 'two lines');
    ok(/2 items on the shopping list/.test(await toast(page).textContent()));
    await page.locator('.ha-toast-action').click(); await settle(page);
    eq(await page.evaluate(() => [...window.__pantry.S.shop.values()].filter(m => !m.removedAt).length), before, 'Undo took both lines off');
    await pick(['Kaya']); await page.click('[data-act="sel-list"]'); await settle(page);
    await pick(['Kaya', 'Eggs (10)']); await page.click('[data-act="sel-list"]'); await settle(page);
    ok(/1 item on the shopping list \(1 already there\)/.test(await toast(page).textContent()), 'one was already there: ' + await toast(page).textContent());

    // Delete, then Undo; and in Recently removed meanwhile
    await page.goto(BASE + '?demo#/items'); await page.locator('.ha-large-title').waitFor(); await settle(page);
    await pick(['Wholemeal bread', 'Milo powder']);
    await page.click('[data-act="sel-delete"]'); await settle(page);
    ok(/2 items deleted/.test(await toast(page).textContent()));
    ok(!(await names(page)).some(n => /Wholemeal|Milo/.test(n)), 'they are gone from the list');
    eq((await itemNamed(page, 'Milo powder')).removed, true, 'a marker, not a delete (Recently removed has them)');
    await page.locator('.ha-toast-action').click(); await settle(page);
    ok((await names(page)).some(n => /Milo/.test(n)) && (await names(page)).some(n => /Wholemeal/.test(n)), 'Undo brought them back');
    eq((await itemNamed(page, 'Milo powder')).removed, false);
    await ctx.close();
    ok(errors.length === 0, 'no errors: ' + errors.join(' | '));
  }

  // ---------- state survives a change from another phone; what disappears drops out ----------
  {
    const { ctx, page, errors } = await open();
    await page.click('#pa-sel-toggle'); await settle(page);
    await page.locator('#pa-items-list li', { hasText: 'Kaya' }).locator('.pa-item').tap();
    await page.locator('#pa-items-list li', { hasText: 'Eggs' }).locator('.pa-item').tap();
    eq(await count(page), '2 selected');
    // another phone changes Fresh milk (a remote change redraws the list) and removes Eggs
    await page.evaluate(() => {
      const S = window.__pantry.S, milk = [...S.items.values()].find(i => i.name === 'Fresh milk'), eggs = [...S.items.values()].find(i => i.name === 'Eggs (10)');
      S.items.set(milk.id, { ...milk, name: 'Fresh milk 2 L' }); S.items.set(eggs.id, { ...eggs, removedAt: new Date().toISOString(), removedBy: 'Dad' });
      window.__pantry.redraw();   // what the app does when another phone's change arrives
    });
    await settle(page);
    ok(await selecting(page), 'still selecting after a change from another phone');
    eq(await count(page), '1 selected', 'what was removed on the other phone dropped out of the selection');
    ok(await page.locator('#pa-items-list li', { hasText: 'Kaya' }).locator('input').isChecked(), 'the rest stays ticked');
    ok((await names(page)).includes('Fresh milk 2 L'), 'and the change shows');
    ok(!(await names(page)).includes('Eggs (10)'), 'the removed item is gone from the list');
    await ctx.close();
    ok(errors.length === 0, 'no errors: ' + errors.join(' | '));
  }

  // ---------- the grip: a real button on every row; dragging by it, with real touch ----------
  {
    const { ctx, page, errors, touch } = await open(BASE + '?demo#/items', { height: 2000 });   // (tall, so every row and heading is on screen)
    ok(await page.locator('#pa-items-list .pa-grip').count() === 13, 'a grip on every row');
    const g = await page.locator('#pa-items-list li', { hasText: 'Kaya' }).locator('.pa-grip').boundingBox();
    ok(g.width >= 43.5 && g.height >= 43.5, `a 44px target (${g.width}x${g.height})`);
    eq(await page.locator('#pa-items-list li', { hasText: 'Kaya' }).locator('.pa-grip').getAttribute('aria-label'), 'Reorder or move Kaya');
    ok(await page.locator('#pa-items-list li', { hasText: 'Kaya' }).locator('button.pa-grip').count() === 1, 'a real button');
    ok(await page.locator('#pa-items-list a.pa-item .pa-grip').count() === 0, 'not inside the row’s link');
    eq(await page.locator('.pa-grip').first().evaluate(e => getComputedStyle(e).touchAction), 'none', 'touch-action: none on the grip');
    await axe(page, 'Items with grips');
    await page.locator('.ha-seg', { hasText: 'Place' }).click(); await settle(page);
    const center = async name => { const b = await page.locator('#pa-items-list li', { hasText: name }).first().locator('.pa-grip').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const headBox = async place => (await page.locator(`section[data-place="${place}"] .pa-grouphead`).boundingBox());
    const moveTo = async (from, to, steps = 8, wait = 25) => { for (let i = 1; i <= steps; i++) { await touch('touchMove', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await page.waitForTimeout(wait); } };

    // 1. one item onto a heading
    let c = await center('Kaya');
    await page.evaluate(() => { window.__buzz = []; });
    await touch('touchStart', c.x, c.y);
    await touch('touchMove', c.x, c.y + 4); await page.waitForTimeout(30);
    ok(await page.locator('.pa-ghost').count() === 0, 'a 4 px wobble is not yet a drag');
    let hb = await headBox('Basement store');
    await moveTo(c, { x: 150, y: hb.y + hb.height / 2 });
    ok(await page.locator('.pa-ghost').count() === 1, 'a ghost follows the finger');
    ok(await page.locator('section[data-place="Basement store"].pa-drop').count() === 1, 'the heading under it is lit');
    eq(await page.locator('.pa-ghost-tip').textContent(), 'Move to Basement store', 'a label says where it will land');
    ok(await page.locator('.pa-ghost').evaluate(e => e.getAttribute('aria-hidden')) === 'true', 'the ghost is hidden from screen readers');
    const gb = await page.locator('.pa-ghost').boundingBox();
    ok(gb.y + gb.height <= hb.y + hb.height / 2, 'the ghost is lifted above the finger so it is not hidden by it');
    ok((await page.evaluate(() => window.__buzz.length)) >= 1, 'a tick on reaching the heading');
    await shot(page, 'p05-drag');
    await touch('touchEnd'); await settle(page);
    ok(await page.locator('.pa-ghost').count() === 0 && await page.locator('.pa-drop').count() === 0, 'ghost and highlight gone');
    eq((await itemNamed(page, 'Kaya')).location, 'Basement store', 'Kaya moved');
    ok(/Kaya moved to Basement store/.test(await toast(page).textContent()), 'one toast: ' + await toast(page).textContent());
    await page.locator('.ha-toast-action').click(); await settle(page);
    eq((await itemNamed(page, 'Kaya')).location, 'Fridge', 'Undo');
    eq(hash(page), '#/items', 'no navigation');

    // 2. its own heading is ignored; so is dropping on nothing
    c = await center('Kaya'); hb = await headBox('Fridge');
    await touch('touchStart', c.x, c.y); await moveTo(c, { x: 150, y: hb.y + hb.height / 2 });
    eq(await page.locator('.pa-ghost-tip').textContent(), 'Already in Fridge');
    ok(await page.locator('.pa-drop').count() === 0, 'its own heading is not lit');
    await touch('touchEnd'); await settle(page);
    eq((await itemNamed(page, 'Kaya')).location, 'Fridge'); ok(!(await toast(page).count()) || !/moved/.test(await toast(page).textContent().catch(() => '')), 'no move');
    c = await center('Kaya');
    await touch('touchStart', c.x, c.y); await moveTo(c, { x: 150, y: 60 }); // over the bar and title: nothing to drop on
    ok(/Drop on a place/.test(await page.locator('.pa-ghost-tip').textContent()), 'the label says what to do');
    await touch('touchEnd'); await settle(page);
    eq((await itemNamed(page, 'Kaya')).location, 'Fridge', 'dropped on nothing: nothing happens');

    // 3. Escape cancels
    c = await center('Kaya'); hb = await headBox('Basement store');
    await touch('touchStart', c.x, c.y); await moveTo(c, { x: 150, y: hb.y + hb.height / 2 });
    ok(await page.locator('section[data-place="Basement store"].pa-drop').count() === 1);
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    ok(await page.locator('.pa-ghost').count() === 0 && await page.locator('.pa-drop').count() === 0, 'Escape puts everything back');
    await touch('touchEnd'); await settle(page);
    eq((await itemNamed(page, 'Kaya')).location, 'Fridge', 'and nothing moved'); ok(await selecting(page) === false);

    // 4. a selection of three, by the grip of a ticked row
    await page.click('#pa-sel-toggle'); await settle(page);
    for (const n of ['Kaya', 'Fresh milk', 'Eggs (10)']) await page.locator('#pa-items-list li', { hasText: n }).locator('.pa-item').tap();
    eq(await count(page), '3 selected');
    c = await center('Fresh milk'); hb = await headBox('Kitchen cabinet');
    await touch('touchStart', c.x, c.y); await moveTo(c, { x: 150, y: hb.y + hb.height / 2 });
    eq(await page.locator('.pa-ghost-card').textContent(), '3 items', 'the ghost says 3 items');
    eq(await page.locator('.pa-ghost-tip').textContent(), 'Move 3 items to Kitchen cabinet');
    await touch('touchEnd'); await settle(page);
    for (const n of ['Kaya', 'Fresh milk', 'Eggs (10)']) eq((await itemNamed(page, n)).location, 'Kitchen cabinet', n);
    ok(!(await selecting(page)), 'selecting ends after the drop');
    ok(/3 items moved to Kitchen cabinet/.test(await toast(page).textContent()), await toast(page).textContent());
    await page.locator('.ha-toast-action').click(); await settle(page);
    eq((await itemNamed(page, 'Eggs (10)')).location, 'Fridge', 'one Undo for the batch');
    // while selecting, the grip of a row that is NOT ticked drags only that row
    await page.click('#pa-sel-toggle'); await settle(page);
    await page.locator('#pa-items-list li', { hasText: 'Kaya' }).locator('.pa-item').tap();
    c = await center('Eggs (10)'); hb = await headBox('Kitchen cabinet');
    await touch('touchStart', c.x, c.y); await moveTo(c, { x: 150, y: hb.y + hb.height / 2 });
    eq(await page.locator('.pa-ghost-tip').textContent(), 'Move to Kitchen cabinet', 'an unticked row drags alone');
    await touch('touchEnd'); await settle(page);
    eq((await itemNamed(page, 'Eggs (10)')).location, 'Kitchen cabinet'); eq((await itemNamed(page, 'Kaya')).location, 'Fridge', 'the ticked one stayed');
    await page.locator('.ha-toast-action').click(); await settle(page);
    await ctx.close();
    ok(errors.length === 0, 'no errors: ' + errors.join(' | '));
  }

  // ---------- drag onto a place chip (any sort), by touch and by mouse; auto-scroll at the edges ----------
  {
    const { ctx, page, errors, touch } = await open(BASE + '?demo#/items', { height: 1500 });
    const grip = async name => { const b = await page.locator('#pa-items-list li', { hasText: name }).first().locator('.pa-grip').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    // a chip is a target in the default sort too
    let c = await grip('Laundry liquid');
    const chip = await page.locator('.ha-chip[data-place="Fridge"]').boundingBox();
    await touch('touchStart', c.x, c.y);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', c.x + (chip.x + chip.width / 2 - c.x) * i / 10, c.y + (chip.y + chip.height / 2 - c.y) * i / 10); await page.waitForTimeout(25); }
    ok(await page.locator('.ha-chip.pa-drop').count() === 1, 'the place chip is lit');
    eq(await page.locator('.pa-ghost-tip').textContent(), 'Move to Fridge');
    await touch('touchEnd'); await settle(page);
    eq((await itemNamed(page, 'Laundry liquid')).location, 'Fridge', 'moved by dropping on a chip');
    await page.locator('.ha-toast-action').click(); await settle(page);
    // the same with a mouse
    c = await grip('Laundry liquid');
    const chip2 = await page.locator('.ha-chip[data-place="Kitchen cabinet"]').boundingBox();
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + 5, c.y + 3); await page.mouse.move(chip2.x + chip2.width / 2, chip2.y + chip2.height / 2, { steps: 10 });
    ok(await page.locator('.pa-ghost').count() === 1, 'a mouse drags too');
    await page.mouse.up(); await settle(page);
    eq((await itemNamed(page, 'Laundry liquid')).location, 'Kitchen cabinet', 'moved by a mouse');
    await page.locator('.ha-toast-action').click(); await settle(page);
    // a tap on the grip opens its sheet and does not drag
    await page.locator('#pa-items-list li', { hasText: 'Kaya' }).locator('.pa-grip').tap(); await settle(page);
    ok(await page.locator('dialog.ha-sheet[open]').count() === 1, 'a tap on the grip opens the Move sheet');
    ok(await page.locator('dialog.ha-sheet[open] [data-g="up"]').count() === 0, 'no Move up outside My order');
    ok(await page.locator('dialog.ha-sheet[open] [data-g="to"]').count() === 1, 'Move to… is there');
    await page.locator('dialog.ha-sheet[open] [data-ha-close]').click(); await settle(page);

    await ctx.close();
    ok(errors.length === 0, 'no errors: ' + errors.join(' | '));
  }

  // ---------- auto-scroll at the edges of a short screen ----------
  {
    const { ctx, page, errors, touch } = await open(BASE + '?demo#/items', { height: 560 });
    const grip = async name => { const b = await page.locator('#pa-items-list li', { hasText: name }).first().locator('.pa-grip').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    let c;
    await page.evaluate(() => scrollTo(0, 0)); await settle(page);
    c = await grip('Wholemeal bread');
    await touch('touchStart', c.x, c.y);
    const bottom = await page.evaluate(() => document.querySelector('.ha-tabbar').getBoundingClientRect().top);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', c.x, c.y + (bottom - 20 - c.y) * i / 8); await page.waitForTimeout(25); }
    const s0 = await page.evaluate(() => scrollY);
    await page.waitForTimeout(700);
    const s1 = await page.evaluate(() => scrollY);
    ok(s1 > s0 + 60, `holding near the bottom edge scrolls the page (${s0} -> ${s1})`);
    ok(await page.locator('.pa-ghost').count() === 1, 'the drag goes on while it scrolls');
    for (let i = 1; i <= 6; i++) { await touch('touchMove', c.x, bottom - 20 - (bottom - 25) * i / 6); await page.waitForTimeout(25); }
    await page.waitForTimeout(700);
    ok((await page.evaluate(() => scrollY)) < s1 - 40, 'and near the top it scrolls back');
    await touch('touchEnd'); await settle(page);
    ok(!/moved/.test(await toast(page).textContent().catch(() => '')), 'nothing was dropped');
    await ctx.close();
    ok(errors.length === 0, 'no errors: ' + errors.join(' | '));
  }

  // ---------- reduced motion: a drag still works, with no buzz and a still ghost ----------
  {
    const { ctx, page, errors, touch } = await open(BASE + '?demo#/items', { height: 1500, reducedMotion: 'reduce' });
    await page.locator('.ha-seg', { hasText: 'Place' }).click(); await settle(page);
    const g = await page.locator('#pa-items-list li', { hasText: 'Kaya' }).locator('.pa-grip').boundingBox(), hb = await page.locator('section[data-place="Basement store"] .pa-grouphead').boundingBox();
    const c = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
    await touch('touchStart', c.x, c.y);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', c.x + (150 - c.x) * i / 8, c.y + (hb.y + 20 - c.y) * i / 8); await page.waitForTimeout(25); }
    ok(await page.locator('.pa-ghost').count() === 1);
    eq(await page.evaluate(() => window.__buzz.length), 0, 'no tick with reduced motion');
    const tr = await page.locator('.pa-ghost').evaluate(e => getComputedStyle(e).transitionDuration);
    ok(parseFloat(tr) <= 0.001, 'the ghost has no animation: ' + tr);
    await touch('touchEnd'); await settle(page);
    eq((await itemNamed(page, 'Kaya')).location, 'Basement store');
    await ctx.close();
    ok(errors.length === 0, 'no errors: ' + errors.join(' | '));
  }

  // ---------- Bulk edit: pick, choose (every field Unchanged), Review, Save one batch, one Undo ----------
  {
    const { ctx, page, errors } = await open(BASE + '?demo#/items', { height: 3200 });   // (the whole screen on view: the fixed tab bar never sits over a row, which axe's target-size check would count)
    const ymdPlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
    const bulkCount = () => page.locator('#pa-bcount').textContent();
    const itemOf = name => page.evaluate(n => { const it = [...window.__pantry.S.items.values()].find(i => i.name === n); return it && { location: it.location, category: it.category, measure: it.measure || null, level: it.level || null, removed: !!it.removedAt, exp: it.batches.map(b => b.expiry), qty: it.batches.map(b => b.qty) }; }, name);
    const openBulk = async () => { await page.goto(BASE + '?demo#/items'); await page.locator('.ha-large-title').waitFor(); await settle(page); await page.click('[data-act="bulk-open"]'); await settle(page); };
    await openBulk();
    eq(hash(page), '#/bulk'); ok(await page.locator('.ha-back').isVisible(), 'a back button to Items');
    eq(await bulkCount(), 'None selected');
    ok(await page.locator('#pa-bulk-list input.pa-bsel').count() === 13, 'a checkbox row for every item');
    for (const id of ['place', 'category', 'mode', 'expiry', 'list', 'bin']) eq(await page.locator(`#pa-bk-${id}`).inputValue(), '', `${id} starts Unchanged`);
    eq(await page.locator('#pa-bk-place option:checked').textContent(), 'Unchanged');
    // filters: search, a place chip, a category; Select all matching is the whole result
    await page.fill('#pa-bq', 'sauce'); await settle(page);
    eq(await page.locator('#pa-bulk-list .pa-item').count(), 3, 'search narrows the list');
    await page.click('[data-act="bk-all"]'); eq(await bulkCount(), '3 selected');
    await page.fill('#pa-bq', ''); await settle(page);
    eq(await bulkCount(), '3 selected', 'the selection is kept when the list changes');
    await page.fill('#pa-bq', 'zzz'); await settle(page);
    eq(await bulkCount(), '3 selected (3 not shown)'); await page.fill('#pa-bq', ''); await settle(page);
    await page.click('[data-act="bk-none"]'); eq(await bulkCount(), 'None selected');
    await page.click('[data-act="bk-place"][data-v="Fridge"]'); await settle(page);
    eq(await page.locator('#pa-bulk-list .pa-item').count(), 4);
    await page.selectOption('#pa-bk-cat', 'Dairy & eggs'); await settle(page);
    eq(await page.locator('#pa-bulk-list .pa-item').count(), 2, 'place and category together');
    await page.click('[data-act="bk-all"]'); eq(await bulkCount(), '2 selected');
    await page.selectOption('#pa-bk-cat', ''); await page.click('[data-act="bk-place"][data-v=""]'); await settle(page);
    await page.click('[data-act="bk-none"]');
    // Review needs items and a choice
    await page.click('[data-act="bk-review"]'); ok(/Select some items first/.test(await toast(page).textContent()));
    await page.locator('#pa-bulk-list li', { hasText: 'Kaya' }).locator('.pa-item').tap();
    await page.locator('#pa-bulk-list li', { hasText: 'Fresh milk' }).locator('.pa-item').tap();
    await page.locator('#pa-bulk-list li', { hasText: 'Eggs (10)' }).locator('.pa-item').tap();
    eq(await bulkCount(), '3 selected');
    await page.click('[data-act="bk-review"]'); ok(/Choose what to change first/.test(await toast(page).textContent()), 'nothing chosen yet');
    await page.selectOption('#pa-bk-place', 'set');
    await page.click('[data-act="bk-review"]'); ok(/Choose the place/.test(await toast(page).textContent()), 'an incomplete choice says what is missing');
    await page.selectOption('#pa-bk-place-to', 'Basement store');
    await page.selectOption('#pa-bk-category', 'set'); await page.selectOption('#pa-bk-category-to', 'Other');
    await shot(page, 'p07-bulk');
    await axe(page, 'Bulk edit');
    await page.click('[data-act="bk-review"]'); await settle(page);
    eq(await page.locator('.ha-large-sub').textContent(), '3 items will change');
    eq(await page.locator('.ha-list').first().locator('.ha-row-title').allTextContents(), ['Place: move to Basement store', 'Category: change to Other']);
    ok(await page.locator('.pa-warn', { hasText: 'replaces what these items have now' }).count() === 1, 'warns it replaces');
    eq(await page.locator('section[aria-labelledby="h-bk-samples"] li').count(), 3, 'up to three before and after');
    ok(/Fridge/.test(await page.locator('section[aria-labelledby="h-bk-samples"] li').first().textContent()) && /Basement store/.test(await page.locator('section[aria-labelledby="h-bk-samples"] li').first().textContent()), 'before then after');
    eq(await page.evaluate(() => document.activeElement.id), 'pa-bulk-h', 'focus moves to the heading of the step');
    await shot(page, 'p08-bulk-review');
    await axe(page, 'Bulk edit: Review');
    // Back keeps the choices
    await page.click('[data-act="bk-back"]'); await settle(page);
    eq(await page.locator('#pa-bk-place-to').inputValue(), 'Basement store', 'Back keeps what was chosen'); eq(await bulkCount(), '3 selected');
    await page.click('[data-act="bk-review"]'); await settle(page);
    // Save: ONE batch, ONE toast, back on Items
    await page.click('[data-act="bk-save"]'); await settle(page);
    eq(hash(page), '#/items'); ok(/3 items changed/.test(await toast(page).textContent()), await toast(page).textContent());
    for (const n of ['Kaya', 'Fresh milk', 'Eggs (10)']) { const o = await itemOf(n); eq([o.location, o.category], ['Basement store', 'Other'], n); }
    // someone moved Fresh milk since: Undo leaves it and says so
    await page.evaluate(() => { const it = [...window.__pantry.S.items.values()].find(i => i.name === 'Fresh milk'); window.__pantry.S.items.set(it.id, { ...it, location: 'Freezer' }); });
    await page.locator('.ha-toast-action').click(); await settle(page);
    eq([(await itemOf('Kaya')).location, (await itemOf('Kaya')).category], ['Fridge', 'Breakfast & spreads'], 'Undo put Kaya back');
    eq((await itemOf('Fresh milk')).location, 'Freezer', 'the one changed since is left');
    ok(/1 changed since, left as it is/.test(await toast(page).textContent()), await toast(page).textContent());

    // best-before: shift by days; items with no stock are skipped and counted
    await openBulk();
    await page.click('[data-act="bk-all"]');
    await page.selectOption('#pa-bk-expiry', 'shift'); await page.fill('#pa-bk-days', '10');
    const milkBefore = (await itemOf('Fresh milk')).exp[0];
    await page.click('[data-act="bk-review"]'); await settle(page);
    ok(/skipped for best-before: nothing in stock/.test(await page.locator('.ha-panel').allTextContents().then(a => a.join('|'))), 'items with nothing in stock are skipped, and it says so');
    ok(!(await page.locator('.pa-warn').count()), 'shifting a date replaces nothing: no warning');
    await page.click('[data-act="bk-save"]'); await settle(page);
    eq((await itemOf('Fresh milk')).exp[0], ymdPlus(13), 'ten days later (milk was 3 days out)');
    await page.locator('.ha-toast-action').click(); await settle(page);
    eq((await itemOf('Fresh milk')).exp[0], milkBefore, 'Undo');
    // a set date, and tracking mode with its warning, together
    await openBulk();
    await page.locator('#pa-bulk-list li', { hasText: 'Sardines' }).locator('.pa-item').tap();
    await page.selectOption('#pa-bk-mode', 'level');
    await page.selectOption('#pa-bk-expiry', 'set'); await page.fill('#pa-bk-date', '2027-05-05');
    await page.click('[data-act="bk-review"]'); await settle(page);
    ok(/1 item will stop counting/.test(await page.locator('.pa-warn').first().textContent()), 'converting to Plenty, low, out warns that counts are hidden');
    ok(/kept as Plenty, Low, Out, so no dates/.test(await page.locator('.ha-panel').allTextContents().then(a => a.join('|'))), 'and its date is skipped');
    await page.click('[data-act="bk-save"]'); await settle(page);
    let sd = await itemOf('Sardines in tomato sauce'); eq([sd.measure, sd.level, sd.qty], ['level', 'plenty', [4]], 'converted; the stock is kept, hidden');
    await page.locator('.ha-toast-action').click(); await settle(page);
    sd = await itemOf('Sardines in tomato sauce'); eq([sd.measure, sd.level, sd.qty], [null, null, [4]], 'Undo is exact');
    // shopping list, and what was already there
    await openBulk();
    await page.locator('#pa-bulk-list li', { hasText: 'Kaya' }).locator('.pa-item').tap(); await page.locator('#pa-bulk-list li', { hasText: 'Eggs (10)' }).locator('.pa-item').tap();
    await page.selectOption('#pa-bk-list', 'add');
    const lines0 = await page.evaluate(() => [...window.__pantry.S.shop.values()].filter(m => !m.removedAt).length);
    await page.click('[data-act="bk-review"]'); await settle(page); await page.click('[data-act="bk-save"]'); await settle(page);
    eq(await page.evaluate(() => [...window.__pantry.S.shop.values()].filter(m => !m.removedAt).length), lines0 + 2);
    await page.locator('.ha-toast-action').click(); await settle(page);
    eq(await page.evaluate(() => [...window.__pantry.S.shop.values()].filter(m => !m.removedAt).length), lines0, 'Undo takes the lines off');
    // delete
    await openBulk();
    await page.locator('#pa-bulk-list li', { hasText: 'Milo' }).locator('.pa-item').tap();
    await page.selectOption('#pa-bk-bin', 'del'); ok(/Delete is done on its own/.test(await page.locator('#pa-bulk-changes').textContent()));
    await page.click('[data-act="bk-review"]'); await settle(page);
    eq(await page.locator('.ha-large-sub').textContent(), '1 item will be deleted'); eq(await page.locator('[data-act="bk-save"]').textContent(), 'Delete 1 item');
    await page.click('[data-act="bk-save"]'); await settle(page);
    eq((await itemOf('Milo powder')).removed, true);
    await page.locator('.ha-toast-action').click(); await settle(page);
    eq((await itemOf('Milo powder')).removed, false, 'Undo restores it');
    // from the selection bar: the ticked items come along
    await page.goto(BASE + '?demo#/items'); await page.locator('.ha-large-title').waitFor(); await settle(page);
    await page.click('#pa-sel-toggle'); await settle(page);
    await page.locator('#pa-items-list li', { hasText: 'Kaya' }).locator('.pa-item').tap(); await page.locator('#pa-items-list li', { hasText: 'Fresh milk' }).locator('.pa-item').tap();
    await page.click('[data-act="bulk-open"]'); await settle(page);
    eq(hash(page), '#/bulk'); eq(await bulkCount(), '2 selected', 'the selection came with it');
    await page.goBack(); await settle(page);
    ok(hash(page) === '#/items' && !(await selecting(page)), 'Back from Bulk edit lands on Items: ' + hash(page));
    await ctx.close();
    ok(errors.length === 0, 'no errors: ' + errors.join(' | '));
  }

  console.log(`pantry items e2e: ok (${checks} checks)`);
} finally {
  await browser.close();
  srv.close();
}
