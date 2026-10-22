// Browser test of the pantry on a phone: node pantry/test/e2e.mjs   (SHOTS=<dir> also saves screenshots)
// Serves the repo root (the app at /pantry/; the kit comes from its live address, https://design.flamingbeing.com/v1/) and checks, at 390px:
// add from the catalogue, open one, Used 1 + Undo, expiry on Home, the shopping list (tick -> Bought more sheet),
// sample items, back returns from an item and closes sheets, version lines, backup JSON, demo mode, offline reload
// through the service worker; the welcome on first open (Skip, Next through every card, Add my first item, once per
// phone, never in plain ?demo, no home-screen card when installed, the short invite version) and the guide screen;
// barcode look-ups (three databases routed to fake answers, a fake camera; the unknown-barcode sheet);
// photos (a thumbnail on the item, the photo in photos/<id> read when the item opens, remove, delete, backup, an
// old-style item moved by itself; prints the measured sizes); places (Settings → Places: the defaults with counts,
// add, rename with Undo, reorder, remove with items asking where they go, not-in-your-list places, Say or type);
// names for the family, Since you last looked, guessed dates, Freeze and Thaw, Leftovers, the shopping list (aisles, Buy
// again, the mic, Going shopping, Put away), Plenty / Low / Out and Scan many (demo, faked camera and speech);
// and at 390, 360 and 320px: no sideways scroll and axe clean on every screen, the welcome and the guide.
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
const settle = page => page.waitForTimeout(450);   // sheets, toasts and view transitions

async function open(width, height, url = BASE, opts = {}) {
  const { init, ...rest } = opts;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, ...rest });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  await page.locator('.ha-large-title').first().waitFor();
  await settle(page);
  return { ctx, page, errors };
}
async function noSideways(page, what) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
  ok(r.sw <= r.w, `${what}: no sideways scroll (scrollWidth ${r.sw} > ${r.w})`);
}
async function axe(page, what) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
  // a toast still fading in or out reads as low contrast: let running (finite) animations finish first, 3 s at most
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().filter(x => x.effect?.getComputedTiming().iterations !== Infinity).map(x => x.finished.catch(() => {}))), new Promise(r => setTimeout(r, 3000))]));
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }))
    .violations.map(x => `${x.id} (${x.impact}): ${x.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`));
  ok(v.length === 0, `${what}: axe violations\n  ${v.join('\n  ')}`);
}
// the top bar's lead, title and trail never overlap (and the back button keeps a 44px target and its name)
async function barApart(page, what) {
  const r = await page.evaluate(() => {
    const box = e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
    const title = document.querySelector('.ha-bar-title');
    const parts = [...document.querySelectorAll('.ha-bar-lead > *, .ha-bar-trail > *')].filter(e => e.getClientRects().length)
      .map(e => ({ side: e.closest('.ha-bar-lead') ? 'lead' : 'trail', ...box(e) }));
    const back = document.querySelector('.ha-back');
    return { title: title && title.textContent.trim() ? box(title) : null, parts, back: back && { ...box(back), name: back.textContent.trim() } };
  });
  const hit = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
  for (const p of r.parts) if (r.title) ok(!hit(p, r.title), `${what}: bar ${p.side} (${Math.round(p.l)}-${Math.round(p.r)}) overlaps the title (${Math.round(r.title.l)}-${Math.round(r.title.r)})`);
  const lead = r.parts.filter(p => p.side === 'lead'), trail = r.parts.filter(p => p.side === 'trail');
  for (const a of lead) for (const b of trail) ok(!hit(a, b), `${what}: bar lead overlaps the trail`);
  if (r.back) ok(r.back.w >= 43.5 && r.back.h >= 43.5 && r.back.name, `${what}: back button keeps a 44px target and its name (${Math.round(r.back.w)}x${Math.round(r.back.h)} "${r.back.name}")`);
}
const shot = async (page, name, full = false) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full }); };
const hash = page => new URL(page.url()).hash;
const go = async (page, h) => { await page.evaluate(x => { location.hash = x; }, h); await settle(page); };
const toast = page => page.locator('.ha-toast.is-visible');
const welcomeSheet = page => page.locator('dialog.ha-sheet.pa-wsheet[open]');
const cardTitle = async page => (await welcomeSheet(page).locator('.pa-wtitle').textContent()).replace(/^Step \d+ of \d+: /, '');
const waitWelcome = page => welcomeSheet(page).waitFor({ timeout: 3000 }).then(() => settle(page));
// after a button that closes the welcome: wait until it has gone (a slow runner can take longer than settle())
const welcomeGone = page => welcomeSheet(page).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
const ymdPlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };

try {
  // ---------- the main walk-through, on this phone's own pantry (IndexedDB) ----------
  {
    const { ctx, page, errors } = await open(390, 844);
    // first open: the welcome, once per phone
    await waitWelcome(page);
    ok(await cardTitle(page) === 'Welcome to the pantry', 'first open shows the welcome');
    ok(await welcomeSheet(page).locator('.pa-dot').count() === 2, 'two cards for someone new');
    await shot(page, 'w0-first-open');
    await welcomeSheet(page).locator('.ha-sheet-head [data-ha-close]', { hasText: 'Skip' }).click(); await settle(page);
    ok(await welcomeSheet(page).count() === 0 && hash(page) === '#/', 'Skip closes it and stays on Home');
    ok(await page.evaluate(() => localStorage.getItem('pantry:welcomed')) === 'true', 'Skip remembers it');
    await page.reload(); await page.locator('.ha-large-title').waitFor(); await page.waitForTimeout(900);
    ok(await welcomeSheet(page).count() === 0, 'the welcome does not come back after a reload');
    // a first-time user gets the Getting started checklist on Home; hiding it puts it away (Settings can bring it back)
    ok(await page.locator('#h-tour').count() === 1, 'first open: Getting started on Home');
    await page.click('[data-act="tour-hide"]'); await settle(page);
    ok(await page.locator('#h-tour').count() === 0, 'Hide this list hides it');
    ok(await page.locator('.ha-empty-title', { hasText: 'Nothing here yet' }).isVisible(), 'empty pantry says so');
    ok(await page.locator('.ha-empty a[href="#/guide"]').isVisible(), 'empty Home links to the guide');
    await go(page, '#/shop');
    ok((await page.locator('#h-shop').locator('xpath=..').locator('.ha-section-footer').textContent()).includes('come here by themselves'), 'an empty shopping list says how things get there');
    await go(page, '#/settings');
    if (await page.locator('[data-act="signin"]').count()) ok((await page.locator('#h-family').locator('xpath=..').locator('.ha-section-footer').textContent()).startsWith('Sign in to share'), 'signed out: one line on why to sign in');
    await page.click('.ha-tabbar a[href="#/"]'); await settle(page);
    ok(await page.locator('.ha-tab[aria-current="page"]').getAttribute('href') === '#/', 'Pantry tab current');
    await axe(page, 'empty home');
    await shot(page, '01-empty');

    // add from the Singapore catalogue
    await page.click('.ha-tab--action'); await settle(page);
    ok(hash(page) === '#/add', 'Add opens the add screen');
    ok(await page.locator('.ha-tabbar').isHidden() && await page.locator('#pa-toolbar').isVisible(), 'a task swaps the tab bar for a toolbar');
    await page.fill('#pa-find', 'kikkoman soy');
    await page.locator('#pa-sugg [data-act="sugg"]').first().click(); await settle(page);
    ok(await page.inputValue('#pa-form [name="name"]') === 'Light soy sauce', 'catalogue fills the name');
    ok(await page.inputValue('#pa-form [name="brand"]') === 'Kikkoman', 'and the brand');
    ok(await page.inputValue('#pa-form [name="openDays"]') === '90', 'and keeps-once-opened days');
    await page.click('#pa-qty [data-step="1"]');
    ok(await page.locator('#pa-qty output').textContent() === '2', 'stepper adds one');
    await page.click('.pa-dates [data-act="date"]:has-text("1 year")');
    ok(await page.inputValue('#pa-form [name="expiry"]') === ymdPlus(365), 'quick date fills the date');
    await axe(page, 'add form');
    await shot(page, '02-add', true);
    await page.click('#pa-save'); await settle(page);
    ok(/^#\/item\//.test(hash(page)), 'saving opens the item');
    ok(await page.locator('h1').textContent() === 'Light soy sauce', 'item title');
    ok(await page.locator('#h-stock .ha-num').textContent() === '2', 'two in stock');

    // open one, then Used 1 and Undo
    await page.locator('[data-act="open"]').first().click(); await settle(page);
    ok((await toast(page).textContent()).includes('Opened 1 Light soy sauce'), 'open says so');
    ok(await page.locator('.pa-batch .ha-row-title', { hasText: '1 opened' }).count() === 1, 'an opened batch appears');
    await page.locator('.pa-batch', { hasText: '1 opened' }).locator('[data-act="use"]').click(); await settle(page);
    ok(await page.locator('#h-stock .ha-num').textContent() === '1', 'Used 1 takes one out');
    await toast(page).locator('.ha-toast-action').click(); await settle(page);
    ok(await page.locator('#h-stock .ha-num').textContent() === '2', 'Undo puts it back');
    // Buy online: one search link per shop, opening in a new tab
    const shops = await page.$$eval('section[aria-labelledby="h-online"] a.ha-row', as => as.map(a => [a.querySelector('.ha-row-title').textContent, a.href, a.target]));
    ok(shops.map(x => x[0]).join('|') === 'Search FairPrice|Search Sheng Siong|Search Cold Storage|Search Shopee', 'four shop links');
    ok(shops.every(x => x[2] === '_blank') && /^https:\/\/shopee\.sg\/search\?keyword=Kikkoman/.test(shops[3][1]) && /^https:\/\/coldstorage\.com\.sg\/search\?q=/.test(shops[2][1]), 'shop links search for the item');
    await axe(page, 'item');
    await shot(page, '03-item', true);

    // Bought more sheet: back closes it and stays on the item
    const itemHash = hash(page);
    await page.click('[data-act="bought"]'); await settle(page);
    ok(await page.locator('dialog.ha-sheet[open]').count() === 1, 'Bought more opens a sheet');
    await axe(page, 'bought sheet');
    await shot(page, '04-bought');
    await page.goBack(); await settle(page);
    ok(await page.locator('dialog.ha-sheet[open]').count() === 0 && hash(page) === itemHash, 'back closes the sheet, stays on the item');

    // add to the shopping list from the item
    await page.click('[data-act="to-list"]'); await settle(page);
    ok(await page.locator('[data-act="to-list"]').textContent().then(t => t.includes('On the shopping list')), 'item shows it is on the list');

    // back from the item returns to where Add was opened from (Home)
    await page.goBack(); await settle(page);
    ok(hash(page) === '#/', 'back from the item returns to Home (the add screen was replaced)');

    // something that expires in 2 days shows under Use soon on Home
    await page.click('.ha-tab--action'); await settle(page);
    await page.fill('#pa-form [name="name"]', 'Baby spinach');
    await page.selectOption('#pa-form [name="category"]', 'Fresh produce');
    await page.selectOption('#pa-form [name="location"]', 'Fridge');
    await page.fill('#pa-form [name="expiry"]', ymdPlus(2));
    await page.click('#pa-save'); await settle(page);
    await page.click('.ha-tabbar a[href="#/"]'); await settle(page);
    ok(await page.locator('#h-use-soon').locator('xpath=..').locator('.ha-row', { hasText: 'Baby spinach' }).count() === 1, 'expiring item under Use soon');
    ok(await page.locator('.ha-row', { hasText: 'Baby spinach' }).locator('.ha-badge--warn').textContent() === 'in 2 days', 'with an in 2 days badge');
    // an empty name is refused in words
    await page.click('.ha-tab--action'); await settle(page);
    await page.click('#pa-save');
    ok(await page.locator('#pa-name-err').isVisible(), 'empty name shows an error');
    await page.click('[data-act="back"]'); await settle(page);
    ok(hash(page) === '#/', 'Cancel goes back');

    // shopping: add a line by hand, grouped by aisle; tick the pantry item and the bananas -> In the trolley -> Put away
    await page.click('.ha-tabbar a[href="#/shop"]'); await settle(page);
    await page.fill('#pa-shop-text', 'Bananas');
    await page.click('#pa-shop-add button[type=submit]'); await settle(page);
    ok(await page.locator('#pa-shop .ha-row-title', { hasText: 'Bananas' }).count() === 1, 'a line added by hand');
    ok((await page.locator('#pa-shop .pa-aisle').allTextContents()).join('|') === 'Sauces & condiments|Fresh produce', 'lines grouped by aisle, in the catalogue’s order');
    await page.locator('#pa-shop label', { hasText: 'Kikkoman Light soy sauce' }).locator('input').click(); await settle(page);
    ok(await page.locator('dialog.ha-sheet[open]').count() === 0, 'ticking asks nothing');
    ok(await page.locator('#pa-shop-done label.is-done', { hasText: 'Light soy sauce' }).count() === 1, 'a ticked line goes in the trolley, struck through');
    ok(await page.locator('[data-act="put-away"]').textContent() === 'Put away 1 thing', 'Put away counts the ticked lines');
    ok(/^https:\/\/wa\.me\/\?text=Going%20shopping%20now/.test(await page.locator('#pa-wa-going').getAttribute('href')), 'Going shopping now opens WhatsApp with a message');
    await page.locator('#pa-shop label', { hasText: 'Bananas' }).locator('input').click(); await settle(page);
    ok(await page.locator('#pa-shop-done label.is-done').count() === 2, 'two in the trolley');
    ok(await page.locator('#pa-wa-going').count() === 0, 'nothing left to buy: no Going shopping');
    await page.click('[data-act="put-away"]'); await settle(page);
    const pa = page.locator('dialog.ha-sheet[open]');
    ok(await pa.locator('.ha-sheet-title').textContent() === 'Put away', 'Put away opens one sheet');
    ok(await pa.locator('.pa-pa').count() === 2, 'with a row per ticked line');
    ok((await pa.locator('.pa-pa', { hasText: 'Bananas' }).innerText()).includes('New item · Fresh produce'), 'a typed line becomes a new item from the catalogue');
    ok(await pa.locator('.pa-pa', { hasText: 'Bananas' }).locator('[name="expiry"]').inputValue() === ymdPlus(5), 'with a guessed date');
    await pa.locator('.pa-pa', { hasText: 'Light soy sauce' }).locator('[name="qty"]').fill('2');
    await axe(page, 'put away sheet');
    await shot(page, '05a-put-away');
    const n0 = await page.evaluate(() => [...window.__pantry.S.items.values()].filter(i => !i.removedAt).length);
    await page.click('#pa-pa-go'); await settle(page);
    ok(await page.locator('dialog.ha-sheet[open]').count() === 0, 'the sheet closes');
    ok((await toast(page).textContent()).includes('Put away 2 things'), 'both put away');
    ok(await page.evaluate(() => [...window.__pantry.S.items.values()].filter(i => !i.removedAt).length) === n0 + 1, 'bananas are a new item');
    ok(await page.locator('#pa-shop-done').count() === 0 && await page.locator('#pa-shop .ha-row-title', { hasText: 'Bananas' }).count() === 0, 'put-away lines leave the list');
    const soy = await page.evaluate(() => [...window.__pantry.S.items.values()].find(i => i.name === 'Light soy sauce'));
    ok(soy.batches.reduce((n, b) => n + b.qty, 0) === 4, 'two more soy sauce in stock');
    await toast(page).locator('.ha-toast-action').click(); await settle(page);
    ok(await page.evaluate(() => [...window.__pantry.S.items.values()].filter(i => !i.removedAt).length) === n0 && await page.locator('#pa-shop-done label.is-done').count() === 2, 'Undo takes it all back');
    await page.click('[data-act="put-away"]'); await settle(page);
    await page.locator('dialog.ha-sheet[open] .pa-pa', { hasText: 'Light soy sauce' }).locator('input[type=checkbox]').uncheck();
    ok(await page.locator('#pa-pa-go').textContent() === 'Put away 1 thing', 'unticking leaves one out');
    await page.click('#pa-pa-go'); await settle(page);
    ok(await page.locator('#pa-shop-done label.is-done', { hasText: 'Light soy sauce' }).count() === 1, 'the unticked one stays in the trolley');
    // remove a line, then Undo
    await page.click('#pa-shop-done [data-act="shop-del"][aria-label="Remove Kikkoman Light soy sauce"]'); await settle(page);
    ok(await page.locator('#pa-shop-done').count() === 0, 'bin removes a line');
    await toast(page).locator('.ha-toast-action').click(); await settle(page);
    ok(await page.locator('#pa-shop-done .ha-row-title', { hasText: 'Light soy sauce' }).count() === 1, 'Undo brings it back');
    await axe(page, 'shopping');
    await shot(page, '05-shop', true);

    // sample items, and the expired one on Home
    await page.click('.ha-tabbar a[href="#/settings"]'); await settle(page);
    await page.click('[data-act="sample"]'); await settle(page);
    ok((await toast(page).textContent()).includes('sample items'), 'sample items added');
    await page.click('.ha-tabbar a[href="#/"]'); await settle(page);
    ok(await page.locator('#h-expired').locator('xpath=..').locator('.ha-row', { hasText: 'Wholemeal bread' }).count() === 1, 'expired sample under Expired');
    await axe(page, 'home');
    await shot(page, '06-home', true);

    // binning the expired bread counts as expired
    await page.locator('#h-expired').locator('xpath=..').locator('a.ha-row', { hasText: 'Wholemeal bread' }).click(); await settle(page);
    await page.locator('[data-act="toss"]').first().click(); await settle(page);
    ok((await toast(page).textContent()).includes('(expired)'), 'binning past its date says expired');
    ok((await page.locator('#h-history').locator('xpath=..').innerText()).includes('Expired, thrown away'), 'history says expired');
    await page.click('.ha-back'); await settle(page);
    ok((await page.locator('#h-month').locator('xpath=..').innerText()).includes('Used before expiry'), 'This month counts used before expiry');

    // Say or type: a sentence becomes items to confirm
    await page.click('#bar-trail [data-act="quick"]'); await settle(page);
    ok(await page.locator('dialog.ha-sheet[open] .ha-sheet-title').textContent() === 'Say or type', 'the mic opens Say or type');
    await page.fill('#pa-quick-text', '2 Meiji milk in the fridge expires 25 Oct, salmon fillet freezer in 3 months and 3 tins of sardines');
    await settle(page);
    ok(await page.locator('#pa-quick-list li').count() === 3, 'three things heard');
    await page.locator('#pa-quick-list input').nth(2).uncheck();
    ok(await page.locator('#pa-quick-go').textContent() === 'Add 2 items', 'unticking one leaves it out');
    await axe(page, 'say or type');
    await shot(page, '06b-quick');
    const before = await page.evaluate(() => [...window.__pantry.S.items.values()].filter(i => !i.removedAt).length);
    await page.click('#pa-quick-go'); await settle(page);
    ok((await toast(page).textContent()).includes('Added 2 items'), 'adds them');
    ok(await page.evaluate(() => [...window.__pantry.S.items.values()].filter(i => !i.removedAt).length) === before + 1, 'milk adds to the one at home, salmon is new');
    await toast(page).locator('.ha-toast-action').click(); await settle(page);
    ok(await page.evaluate(() => [...window.__pantry.S.items.values()].filter(i => !i.removedAt).length) === before, 'Undo takes them back out');

    // items: search, place chips, sort
    await page.click('.ha-tabbar a[href="#/items"]'); await settle(page);
    await page.fill('#pa-q', 'kaya');
    ok(await page.locator('#pa-items-list .ha-row').count() === 1, 'search finds one');
    await page.click('[data-act="q-clear"]');
    await page.click('[data-act="place"][data-v="Fridge"]');
    ok(await page.locator('#pa-items-list .ha-row-sub', { hasText: 'Kitchen cabinet' }).count() === 0, 'place chip filters');
    await page.click('.ha-seg:has(input[value="category"])');
    ok(await page.locator('#pa-items-list .ha-section').count() > 1, 'category sort groups the list');
    await page.click('[data-act="place"][data-v=""]');
    await axe(page, 'items');
    await shot(page, '07-items', true);
    // open an item from the list, back returns to Items
    await page.locator('#pa-items-list a.ha-row', { hasText: 'Kaya' }).click(); await settle(page);
    ok(await page.locator('.ha-back span').textContent() === 'Items', 'back button names Items');
    await page.click('.ha-back'); await settle(page);
    ok(hash(page) === '#/items', 'back button returns to Items');

    // settings: backup JSON, version lines
    await page.click('.ha-tabbar a[href="#/settings"]'); await settle(page);
    await page.click('[data-act="soon"][data-v="7"]'); await settle(page);
    ok(await page.locator('[data-act="soon"][data-v="7"]').getAttribute('aria-pressed') === 'true', 'Use soon can be 1 week');
    ok((await page.locator('#h-help').locator('xpath=..').innerText()).includes('How to use the pantry'), 'Settings has a Help section');
    await page.click('#main a[href="#/guide"]'); await settle(page);
    ok(hash(page) === '#/guide' && (await page.locator('h1').textContent()) === 'How to use the pantry', 'the guide opens from Settings');
    ok(await page.locator('.ha-back span').textContent() === 'Settings', 'its back button names Settings');
    ok(await page.locator('.ha-tab[aria-current="page"]').getAttribute('href') === '#/settings', 'Settings stays the current tab');
    ok(await page.locator('#main .ha-section').count() === 7, 'seven guide sections');
    await page.goBack(); await settle(page);
    ok(hash(page) === '#/settings', 'back returns to Settings');
    await page.click('#main a[href="#/guide"]'); await settle(page);
    await page.click('.ha-back'); await settle(page);
    ok(hash(page) === '#/settings', 'the back button returns to Settings');
    // show the welcome again from Settings: back closes it
    await page.click('[data-act="welcome"]'); await waitWelcome(page);
    ok(await cardTitle(page) === 'Welcome to the pantry', 'Show the welcome again opens it');
    await page.goBack(); await settle(page);
    ok(await welcomeSheet(page).count() === 0 && hash(page) === '#/settings', 'back closes the welcome');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="backup"]')]);
    const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    ok(backup.app === 'pantry' && backup.items.length >= 14 && backup.events.length > 10 && backup.shop.filter(m => !m.removedAt).length === 1, 'backup holds items, history and the list');
    // the service worker has installed by now: reload so it controls the page, then the version lines show
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); await page.locator('.ha-large-title').waitFor(); await settle(page);
    await page.waitForFunction(() => !document.querySelector('#pa-version .ha-version-text')?.hidden);
    ok(/^App version (v\d+|\d{4}-\d{2}-\d{2} \([0-9a-f]{8}\))$/.test(await page.locator('#pa-version .ha-version-text').textContent()), 'version line from the cache name');
    ok(await page.locator('#pa-version .ha-version-btn').textContent() === 'Not updating? Get the latest version', 'get-latest button');
    ok(await page.evaluate(() => document.querySelector('#main').lastElementChild.id) === 'pa-version', 'version lines come last');
    await axe(page, 'settings');
    await shot(page, '08-settings', true);
    // no signal: says so, keeps the caches
    srv.swOffline = true;
    await page.click('#pa-version .ha-version-btn');
    await page.waitForFunction(() => /No signal|could not be reached/.test(document.querySelector('#pa-version .ha-version-msg').textContent));
    ok((await page.evaluate(() => caches.keys())).some(k => k.startsWith('pantry-')), 'no signal leaves the cache');
    srv.swOffline = false;

    // offline: the app and its data still open
    ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page');
    await ctx.setOffline(true);
    await page.reload(); await page.locator('.ha-large-title').waitFor(); await settle(page);
    await go(page, '#/items');
    if (process.env.DEBUG) console.log(await page.locator('#main').innerText());
    ok(await page.locator('#pa-items-list .ha-row', { hasText: 'Baby spinach' }).count() === 1, 'offline reload shows the pantry');
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.ha-tabbar')).position) === 'fixed', 'offline: the kit styles load from the cache');
    // the kit comes from another address: its sprite is put in the page, so tab and row icons draw (also offline)
    await page.locator('[data-ha-sprite] symbol').first().waitFor({ state: 'attached' });
    const iconWidths = await page.evaluate(() => [...document.querySelectorAll('.ha-tabbar use, .ha-main use')].filter(u => u.closest('svg').getClientRects().length).map(u => u.getBBox().width));
    ok(iconWidths.length >= 5 && iconWidths.every(w => w > 0), `offline: icons draw (${iconWidths.join(', ')})`);
    await ctx.setOffline(false);

    ok(errors.length === 0, `console errors: ${errors.join('; ')}`);
    await ctx.close();
    console.log('  walk-through: ok');
  }

  // ---------- the welcome in the demo (only with ?welcome): every card, Add my first item ----------
  {
    const { ctx, page, errors } = await open(390, 844, BASE + '?demo');
    await page.waitForTimeout(900);
    ok(await welcomeSheet(page).count() === 0, 'plain ?demo shows no welcome');
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(390, 844, BASE + '?demo&welcome');
    await waitWelcome(page);
    const titles = [await cardTitle(page)];
    ok(await welcomeSheet(page).locator('[data-pa-w="prev"]').isHidden(), 'no Back on the first card');
    await axe(page, 'welcome card 1');
    await shot(page, 'w1-intro');
    await welcomeSheet(page).locator('[data-pa-w="next"]').click(); await settle(page);
    titles.push(await cardTitle(page));
    ok(await welcomeSheet(page).locator('.pa-dot').nth(1).evaluate(d => d.classList.contains('is-current')), 'dot 2 is current');
    ok(await page.evaluate(() => document.activeElement?.classList.contains('pa-wtitle')), 'card 2: focus moves to its title');
    await axe(page, 'welcome card 2');
    await shot(page, 'w2-fill');
    ok(JSON.stringify(titles) === JSON.stringify(['Welcome to the pantry', 'Fill it in a minute']), `cards in order: ${titles}`);
    ok(await welcomeSheet(page).locator('[data-pa-w="next"]').count() === 0, 'no Next on the last card');
    ok(await welcomeSheet(page).locator('.ha-sheet-head [data-ha-close]').textContent() === 'Close', 'the last card says Close, not Skip');
    await welcomeSheet(page).locator('[data-pa-w="prev"]').click(); await settle(page);
    ok(await cardTitle(page) === 'Welcome to the pantry', 'Back shows the previous card');
    await welcomeSheet(page).locator('[data-pa-w="next"]').click(); await settle(page);
    ok(await welcomeSheet(page).locator('[data-pa-w="done"]').textContent() === 'Look around first', 'a quiet Look around first');
    await welcomeSheet(page).locator('[data-pa-w="start"]').click(); await settle(page);
    ok(await page.locator('dialog.ha-sheet[open] .ha-sheet-title').textContent() === 'What do you have?', 'Pick what you have opens the quick start');
    ok(await page.evaluate(() => localStorage.getItem('pantry:welcomed')) === null, 'the demo saves no flag');
    ok(errors.length === 0, `welcome: console errors ${errors.join('; ')}`);
    await ctx.close();
  }
  {
    // installed (opened from the home screen): no home-screen card
    const { ctx, page } = await open(390, 844, BASE + '?demo&welcome', { init: () => Object.defineProperty(navigator, 'standalone', { get: () => true }) });
    await waitWelcome(page);
    ok(await welcomeSheet(page).locator('.pa-dot').count() === 2, 'installed: two cards');
    await welcomeSheet(page).locator('[data-pa-w="next"]').click(); await settle(page);
    ok(await cardTitle(page) === 'Fill it in a minute', 'installed: straight to filling it in');
    await ctx.close();
  }
  {
    // opened from an invite (the link ends #/settings): short, ends at Sign in, on the Settings screen
    const { ctx, page } = await open(390, 844, BASE + '?demo&welcome#/settings');
    await waitWelcome(page);
    ok(await cardTitle(page) === 'Welcome to the family pantry', 'invite: says they were added');
    ok(await welcomeSheet(page).locator('.pa-dot').count() === 3, 'invite: three cards');
    for (let i = 0; i < 2; i++) { await welcomeSheet(page).locator('[data-pa-w="next"]').click(); await settle(page); }
    ok(await cardTitle(page) === 'Sign in to join', 'invite: ends at Sign in');
    await axe(page, 'welcome invite');
    await shot(page, 'w5-invite-signin');
    await welcomeSheet(page).locator('[data-pa-w="signin"]').click(); await welcomeGone(page); await settle(page);
    ok(hash(page) === '#/settings' && await welcomeSheet(page).count() === 0, 'Go to sign in leaves them on Settings');
    await ctx.close();
  }
  // the welcome and the guide at 390, 360 and 320, and at 200% text
  for (const [w, h] of [[390, 844], [360, 780], [320, 640]]) {
    const { ctx, page, errors } = await open(w, h, BASE + '?demo&welcome');
    await waitWelcome(page);
    for (let i = 1; i <= 2; i++) {
      await noSideways(page, `welcome ${w} card ${i}`);
      if (w !== 390) await axe(page, `welcome ${w} card ${i}`);
      if (i < 2) { await welcomeSheet(page).locator('[data-pa-w="next"]').click(); await settle(page); }
    }
    await welcomeSheet(page).locator('[data-pa-w="done"]').click(); await welcomeGone(page); await settle(page);
    ok(await welcomeSheet(page).count() === 0 && hash(page) === '#/', `welcome ${w}: Look around first closes it`);
    await go(page, '#/guide');
    await noSideways(page, `guide ${w}`);
    await axe(page, `guide ${w}`);
    // the bar ("Pantry" back, "How to use it") stays apart, at normal and 200% text
    await page.evaluate(() => scrollTo(0, 900)); await settle(page);
    await barApart(page, `guide ${w} bar`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '212.5%'; }); await settle(page);
    await barApart(page, `guide ${w} bar at 200% text`);
    if (w === 390) await shot(page, 'g0-guide-bar-200pc');
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; scrollTo(0, 0); }); await settle(page);
    if (w === 390) {
      await shot(page, 'g1-guide-top');
      await page.evaluate(() => scrollTo(0, 900)); await settle(page);
      await shot(page, 'g2-guide-scrolled');
      await page.evaluate(() => scrollTo(0, 2000)); await settle(page);
      await shot(page, 'g3-guide-more');
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await settle(page);
      await shot(page, 'g4-guide-end');
      // the guide's own "Show the welcome again"
      await page.click('[data-act="welcome"]'); await waitWelcome(page);
      ok(await welcomeSheet(page).count() === 1, 'the guide can show the welcome again');
      await page.goBack(); await settle(page);
      ok(hash(page) === '#/guide', 'closing it stays on the guide');
      // 200% text
      await page.evaluate(() => { document.documentElement.style.fontSize = '212.5%'; });
      await noSideways(page, 'guide 200%');
      await page.click('[data-act="welcome"]'); await waitWelcome(page);
      for (let i = 1; i <= 2; i++) {
        await noSideways(page, `welcome 200% card ${i}`);
        const r = await welcomeSheet(page).evaluate(d => ({ sw: d.querySelector('.ha-sheet-body').scrollWidth, cw: d.querySelector('.ha-sheet-body').clientWidth }));
        ok(r.sw <= r.cw, `welcome 200% card ${i}: no sideways scroll in the sheet`);
        if (i === 2) await shot(page, 'w6-200pc');
        if (i < 2) { await welcomeSheet(page).locator('[data-pa-w="next"]').click(); await settle(page); }
      }
    }
    ok(errors.length === 0, `welcome and guide ${w}: console errors ${errors.join('; ')}`);
    await ctx.close();
    console.log(`  welcome and guide ${w}: ok`);
  }

  // ---------- first steps: the quick start and the Getting started checklist, on a fresh phone ----------
  {
    const { ctx, page, errors } = await open(390, 844);
    await waitWelcome(page);
    await welcomeSheet(page).locator('[data-pa-w="next"]').click(); await settle(page);
    await welcomeSheet(page).locator('[data-pa-w="start"]').click(); await settle(page);
    const sheet = page.locator('dialog.ha-sheet[open]');
    // the quick start opens after the welcome closes; on a slow runner that can take longer than settle()
    await sheet.locator('.pa-start-chips .ha-chip').nth(19).waitFor({ timeout: 5000 }).catch(() => {});
    ok(await sheet.locator('.pa-start-chips .ha-chip').count() >= 20, 'the quick start offers everyday things');
    for (const n of ['Fresh milk', 'Eggs', 'Thai hom mali rice', 'Bathroom tissue']) await sheet.locator('.pa-start-chips .ha-chip', { hasText: n }).first().click();
    ok(await page.locator('#pa-start-go').textContent() === 'Add 4 items', 'the button counts the picks');
    await axe(page, 'quick start');
    await shot(page, 't1-quick-start');
    await page.click('#pa-start-go'); await settle(page);
    ok((await toast(page).textContent()).includes('Added 4 items'), 'adds them');
    ok(await page.evaluate(() => [...window.__pantry.S.items.values()].filter(i => !i.removedAt).length) === 4, 'four items in the pantry');
    const milk = await page.evaluate(() => [...window.__pantry.S.items.values()].find(i => i.name === 'Fresh milk'));
    ok(milk.batches[0].expiry && milk.location === 'Fridge', 'with a rough date and its usual place');
    const count = async () => (await page.locator('#h-tour .ha-num').textContent()).trim();
    const total = await page.locator('#h-tour').locator('xpath=..').locator('.pa-tour-row').count();
    ok(await count() === `1 of ${total}`, `the checklist ticks "Add what you have" (${await count()})`);
    await axe(page, 'home with the checklist');
    await shot(page, 't2-checklist', true);
    // Show me: Used 1 is pointed at on an item
    await page.click('[data-act="tour-show"][data-task="use"]'); await settle(page);
    ok(/^#\/item\//.test(hash(page)), 'Show me opens an item');
    await page.waitForSelector('.pa-spot');
    ok(await page.locator('[data-act="use"].pa-spot').count() === 1, 'and rings Used 1');
    await shot(page, 't3-show-me');
    await page.locator('[data-act="use"]').first().click(); await settle(page);
    await page.click('.ha-back'); await settle(page);
    ok(await count() === `2 of ${total}`, 'Used 1 ticks it');
    // the shopping list, the home-screen tip, and Say or type
    await page.click('[data-act="tour-show"][data-task="shop"]'); await settle(page);
    ok(hash(page) === '#/shop', 'Show me opens the shopping list');
    await page.click('.ha-tabbar a[href="#/"]'); await settle(page);
    await page.click('[data-act="tour-show"][data-task="install"]'); await settle(page);
    ok(await page.locator('dialog.ha-sheet[open] .ha-sheet-title').textContent() === 'On your home screen', 'the home-screen steps');
    await page.click('dialog.ha-sheet[open] [data-ha-close]'); await settle(page);
    await page.click('[data-act="tour-show"][data-task="say"]'); await settle(page);
    await page.fill('#pa-quick-text', 'kaya in the fridge');
    await settle(page);
    await page.click('#pa-quick-go'); await settle(page);
    ok(await count() === `5 of ${total}`, `shopping, home screen and Say or type tick (${await count()})`);
    if (total === 6) {
      await page.click('[data-act="tour-show"][data-task="family"]'); await settle(page);
      ok(hash(page) === '#/settings', 'Show me for the family opens Settings');
      await page.waitForSelector('.pa-spot');
      ok(await page.locator('.pa-spot').count() === 1, 'and rings the sign-in button');
    }
    // hide it, then bring it back from Settings
    await go(page, '#/');
    await page.click('[data-act="tour-hide"]'); await settle(page);
    await go(page, '#/settings');
    await page.click('[data-act="tour-on"]'); await settle(page);
    ok(hash(page) === '#/' && await page.locator('#h-tour').count() === 1, 'Settings brings the checklist back');
    ok(errors.length === 0, `first steps: console errors ${errors.join('; ')}`);
    await ctx.close();
    console.log('  first steps: ok');
  }
  // an existing family (items already on the phone, from before the checklist): nothing new shows
  {
    const { ctx, page } = await open(390, 844, BASE, { init: () => { localStorage.setItem('pantry:welcomed', 'true'); } });
    await page.waitForTimeout(700);
    ok(await page.locator('#h-tour').count() === 0, 'no checklist for someone already using it');
    await ctx.close();
  }

  // ---------- demo mode, every screen at 390, 360 and 320 ----------
  for (const [w, h] of [[390, 844], [360, 780], [320, 640]]) {
    const { ctx, page, errors } = await open(w, h, BASE + '?demo');
    ok((await page.locator('.ha-large-sub').textContent()).includes('Demo'), `demo ${w}: says it is a demo`);
    ok(await page.evaluate(() => window.__pantry.S.mode) === 'demo', `demo ${w}: memory only`);
    const itemId = await page.evaluate(() => [...window.__pantry.S.items.values()].find(i => i.name === 'Light soy sauce').id);
    for (const hsh of ['#/', '#/items', '#/item/' + itemId, '#/add', '#/edit/' + itemId, '#/shop', '#/settings', '#/guide']) {
      await go(page, hsh);
      await noSideways(page, `demo ${w} ${hsh}`);
      if (w !== 390) await axe(page, `demo ${w} ${hsh}`);
      if (w === 320 && SHOTS) await shot(page, `320-${hsh.replace(/[#/]+/g, '-').replace(/^-|-$/g, '') || 'home'}`);
    }
    if (w === 320) {
      // 200% text at the narrowest width: the bar never overlaps on any screen
      await page.evaluate(() => { document.documentElement.style.fontSize = '212.5%'; });
      for (const hsh of ['#/', '#/items', '#/item/' + itemId, '#/add', '#/edit/' + itemId, '#/shop', '#/settings', '#/guide']) {
        await go(page, hsh); await page.evaluate(() => scrollTo(0, 900)); await settle(page);
        await barApart(page, `demo 320 200% ${hsh}`);
      }
    }
    if (w === 390) {
      // edit: change the name, save goes back to the item
      await go(page, '#/item/' + itemId);
      await page.click('[data-act="edit"]'); await settle(page);
      await page.fill('#pa-form [name="name"]', 'Light soy sauce (big)');
      await page.click('#pa-save'); await settle(page);
      ok(hash(page) === '#/item/' + itemId && (await page.locator('h1').textContent()) === 'Light soy sauce (big)', 'edit saves and returns');
      // delete with Undo
      await page.click('[data-act="delete"]'); await settle(page);
      const gone = id => page.evaluate(id => { const it = window.__pantry.S.items.get(id); return !it || !!it.removedAt; }, id);
      ok(await gone(itemId), 'delete removes it (a marker; it is hidden everywhere)');
      await toast(page).locator('.ha-toast-action').click(); await settle(page);
      ok(!(await gone(itemId)), 'Undo restores it');
      // 200% text: still no sideways scroll
      await page.evaluate(() => { document.documentElement.style.fontSize = '212.5%'; });
      for (const hsh of ['#/', '#/items', '#/item/' + itemId, '#/add', '#/edit/' + itemId, '#/shop', '#/settings', '#/guide']) { await go(page, hsh); await noSideways(page, `demo 200% ${hsh}`); await barApart(page, `demo 200% ${hsh}`); }
    }
    ok(errors.length === 0, `demo ${w}: console errors ${errors.join('; ')}`);
    await ctx.close();
    console.log(`  demo ${w}: ok`);
  }

  // ---------- Recently removed: Settings → Recently removed (demo has two removed items and a removed place; 30 days; Restore) ----------
  {
    const { ctx, page, errors } = await open(390, 844, BASE + '?demo');
    await go(page, '#/items');
    ok(await page.locator('#pa-items-list .ha-row', { hasText: /Chilli sauce|Spring onions/ }).count() === 0, 'removed items are not in Items');
    ok(await page.locator('#main').evaluate(m => !/Chilli sauce|Spring onions/.test(m.textContent)), 'nor anywhere on Items');
    await go(page, '#/settings');
    ok(/3 things you can put back/.test(await page.locator('#h-removed').locator('xpath=..').textContent()), 'Settings says what can be put back');
    await page.click('#main a[href="#/removed"]'); await settle(page);
    ok(hash(page) === '#/removed' && await page.locator('h1').textContent() === 'Recently removed', 'Recently removed opens from Settings');
    ok(await page.locator('.ha-back span').textContent() === 'Settings', 'its back button names Settings');
    const rows = await page.locator('#pa-removed .ha-row').allTextContents();
    ok(rows.length === 2 && /Spring onions.*Fridge · Removed by Mum · 2[89] days left/.test(rows[0]) && /Chilli sauce.*Kitchen cabinet · Removed by Dad · 3 days left/.test(rows[1]), 'name, place, who removed it, days left: ' + rows.join(' | '));
    ok(await page.locator('#pa-removed img').count() === 0, 'no thumbnails on removed items');
    const prow = await page.locator('#pa-removed-places .ha-row').allTextContents();
    ok(prow.length === 1 && /Garage shelf.*Place · Removed by Dad · 2[67] days left/.test(prow[0]), 'a removed place is there too, with who removed it and the days left: ' + prow.join(' | '));
    ok(!(await page.evaluate(() => window.__pantry.places())).includes('Garage shelf'), 'and it is not in the list of places');
    await axe(page, 'recently removed');
    await shot(page, 'r01-recently-removed');
    await page.locator('#pa-removed .ha-row', { hasText: 'Chilli sauce' }).locator('[data-act="restore"]').click(); await settle(page);
    ok(await page.locator('#pa-removed .ha-row').count() === 1 && /Chilli sauce is back/.test(await toast(page).textContent()), 'Restore takes it off the list');
    await go(page, '#/items');
    ok(await page.locator('#pa-items-list .ha-row', { hasText: 'Chilli sauce' }).count() === 1, 'and it is back in Items');
    await go(page, '#/removed');
    await page.locator('#pa-removed .ha-row', { hasText: 'Spring onions' }).locator('[data-act="restore"]').click(); await settle(page);
    await page.locator('#pa-removed-places .ha-row', { hasText: 'Garage shelf' }).locator('[data-act="restore"]').click(); await settle(page);
    ok(/Garage shelf is back/.test(await toast(page).textContent()) && (await page.evaluate(() => window.__pantry.places())).at(-1) === 'Garage shelf', 'Restore brings a place back to the end of the list');
    ok(/Nothing removed/.test(await page.locator('#main').textContent()), 'the empty state says so');
    await axe(page, 'recently removed (empty)');
    await shot(page, 'r01b-removed-empty');
    // deleting an item puts it there, with 30 days; Undo from the toast is a Restore
    await go(page, '#/items');
    await page.locator('#pa-items-list a.ha-row', { hasText: 'Kaya' }).click(); await settle(page);
    await page.click('[data-act="delete"]'); await settle(page);
    await go(page, '#/removed');
    ok(/Kaya.*30 days left/.test(await page.locator('#pa-removed').textContent()), 'a deleted item waits there for 30 days');
    ok(await page.locator('#h-removed-items .ha-num').textContent() === '1', 'with its count');
    // the guide says so
    await go(page, '#/guide');
    ok((await page.locator('#main').textContent()).includes('Recently removed'), 'the guide mentions Recently removed');
    ok(errors.length === 0, `removed: console errors ${errors.join('; ')}`);
    await ctx.close();
    console.log('  recently removed: ok');
  }

  // ---------- places: Settings → Places (the household's own list; demo) ----------
  {
    const { ctx, page, errors } = await open(390, 844, BASE + '?demo');
    const S = () => page.evaluate(() => ({ list: window.__pantry.places(), items: [...window.__pantry.S.items.values()].filter(i => !i.removedAt).map(i => ({ id: i.id, name: i.name, location: i.location })) }));
    const rows = () => page.locator('#pa-places .ha-row-title').allTextContents();
    const count = async name => (await page.locator('#pa-places .ha-row, #pa-places-other .ha-row').filter({ has: page.locator('.ha-row-title', { hasText: new RegExp(`^${name}$`) }) }).locator('.ha-row-value').textContent()).replace(/\D+/g, '');
    const sheet = page.locator('dialog.ha-sheet[open]');
    const openPlace = async name => { await page.locator(`[data-act="place-open"][data-v="${name}"]`).click(); await settle(page); };
    await go(page, '#/settings');
    ok(await page.locator('#h-places').count() === 1, 'Settings has Where things are kept');
    await page.click('#main a[href="#/places"]'); await settle(page);
    ok(hash(page) === '#/places' && await page.locator('h1').textContent() === 'Places', 'Places opens from Settings');
    ok(await page.locator('.ha-back span').textContent() === 'Settings' && await page.locator('.ha-tab[aria-current="page"]').getAttribute('href') === '#/settings', 'its back button names Settings, Settings stays the tab');
    const defaults = ['Kitchen cabinet', 'Fridge', 'Level 1 fridge', 'Freezer', 'Level 1 freezer', 'Store room', 'Basement store', 'Bathroom', 'Laundry', 'Medicine box', 'Other'];
    ok(JSON.stringify(await rows()) === JSON.stringify(defaults), 'the default places, the owner’s three included: ' + (await rows()).join(', '));
    const st = await S();
    for (const p of ['Fridge', 'Level 1 freezer', 'Basement store', 'Bathroom']) {
      ok(await count(p) === String(st.items.filter(i => i.location === p).length), `${p}: its item count`);
    }
    ok(await count('Level 1 freezer') === '1' && await count('Basement store') === '1', 'the demo keeps one thing on Level 1 freezer and one in Basement store');
    await axe(page, 'places');
    if (SHOTS) await shot(page, 'places', true);

    // add a place: tidy name, no duplicates (any case), not empty
    await page.click('#pa-place-add button[type=submit]');
    ok(await page.locator('#pa-place-err').isVisible() && await page.getAttribute('#pa-place-name', 'aria-invalid') === 'true', 'an empty name is refused');
    await page.fill('#pa-place-name', ' FRIDGE ');
    await page.click('#pa-place-add button[type=submit]');
    ok((await page.locator('#pa-place-err').textContent()).includes('Fridge is already in your list'), 'a duplicate (any case) is refused');
    ok(await page.getAttribute('#pa-place-name', 'maxlength') === '40', 'names stop at 40 characters');
    await page.fill('#pa-place-name', '  Level 2   fridge ');
    await page.press('#pa-place-name', 'Enter'); await settle(page);
    ok((await rows()).at(-1) === 'Level 2 fridge' && await page.locator('#pa-place-err').isHidden(), 'a new place goes at the end, tidied');
    ok(JSON.stringify((await S()).list) === JSON.stringify([...defaults, 'Level 2 fridge']), 'and is saved as the household’s list');
    await axe(page, 'places with an error cleared');

    // use it in Add
    await go(page, '#/add');
    const opts = await page.locator('#pa-form [name="location"] option').allTextContents();
    ok(opts.at(-1) === 'Level 2 fridge' && opts.includes('Level 1 freezer') && opts.includes('Basement store'), 'Kept in offers the list: ' + opts.join(', '));
    await page.fill('#pa-form [name="name"]', 'Homemade sambal');
    await page.selectOption('#pa-form [name="location"]', 'Level 2 fridge');
    await page.click('#pa-save'); await settle(page);
    ok((await S()).items.find(i => i.name === 'Homemade sambal')?.location === 'Level 2 fridge', 'an item added in the new place');
    await go(page, '#/places');
    ok(await count('Level 2 fridge') === '1', 'its count shows on Places');

    // rename: the sheet, every item moves with it, Undo
    const fridgeIds = (await S()).items.filter(i => i.location === 'Fridge').map(i => i.id);
    ok(fridgeIds.length >= 3, 'several things in the Fridge');
    await openPlace('Fridge');
    ok(await sheet.locator('.ha-sheet-title').textContent() === 'Fridge' && await sheet.locator('#pa-pl-pos').textContent() === '2 of 12 in your list', 'a place opens in a sheet with its position');
    await axe(page, 'place sheet');
    if (SHOTS) await shot(page, 'place-sheet');
    await page.fill('#pa-pl-name', 'level 1 FRIDGE');
    await sheet.locator('#pa-pl-form button[type=submit]').click();
    ok((await sheet.locator('#pa-pl-err').textContent()).includes('Level 1 fridge is already in your list'), 'renaming to another place’s name is refused');
    await page.fill('#pa-pl-name', 'Kitchen fridge');
    await sheet.locator('#pa-pl-form button[type=submit]').click(); await settle(page);
    let now = await S();
    ok(now.list[1] === 'Kitchen fridge' && !now.list.includes('Fridge'), 'renamed in place in the list');
    ok(fridgeIds.every(id => now.items.find(i => i.id === id).location === 'Kitchen fridge') && !now.items.some(i => i.location === 'Fridge'), 'every item in it moved with the new name');
    ok(await sheet.count() === 0 && hash(page) === '#/places' && (await rows())[1] === 'Kitchen fridge', 'the sheet closes and the list shows the new name');
    await toast(page).locator('.ha-toast-action').click(); await settle(page);
    now = await S();
    ok(now.list[1] === 'Fridge' && fridgeIds.every(id => now.items.find(i => i.id === id).location === 'Fridge'), 'Undo puts the name and the items back');
    // the kind of a place: guessed from the name, set in its sheet (one field of its document)
    await go(page, '#/places');
    await openPlace('Level 2 fridge');
    ok(await sheet.locator('input[name="pa-pl-kind"]:checked').inputValue() === 'fridge' && (await sheet.locator('#pa-pl-kind-note').textContent()).startsWith('Guessed from the name.'), 'a fridge by its name, guessed');
    await sheet.locator('.pa-pl-kind label', { hasText: 'Freezer' }).click(); await settle(page);
    const kindOf = n => page.evaluate(x => [...window.__pantry.S.places.values()].find(p => p.name === x && !p.removedAt)?.kind, n);
    ok(await kindOf('Level 2 fridge') === 'freezer' && !(await sheet.locator('#pa-pl-kind-note').textContent()).startsWith('Guessed'), 'set to Freezer: saved on the place, no longer a guess');
    await axe(page, 'place kind');
    await sheet.locator('.pa-pl-kind label', { hasText: 'Fridge' }).click(); await settle(page);
    ok(await kindOf('Level 2 fridge') === 'fridge', 'and back');
    await sheet.locator('[data-ha-close]').first().click(); await settle(page);
    await go(page, '#/items');
    ok(await page.locator('[data-act="place"][data-v="Fridge"]').count() === 1, 'Items filters by the place');

    // reorder: up and down move it one place, the picker follows
    await go(page, '#/places');
    await openPlace('Level 2 fridge');
    ok(await sheet.locator('[data-pl="down"]').isDisabled() && await sheet.locator('[data-pl="up"]').isEnabled(), 'the last one can only move up');
    const box = await sheet.locator('[data-pl="up"]').boundingBox();
    ok(box.height >= 44 && box.width >= 44, `move buttons are at least 44px (${Math.round(box.width)}x${Math.round(box.height)})`);
    ok(await sheet.locator('[data-pl="up"]').getAttribute('aria-label') === 'Move up, Level 2 fridge', 'move buttons say which place');
    for (let i = 0; i < 9; i++) await sheet.locator('[data-pl="up"]').click();
    ok(await sheet.locator('#pa-pl-pos').textContent() === '3 of 12 in your list', 'nine steps up: third');
    await page.goBack(); await settle(page);
    ok(await sheet.count() === 0 && hash(page) === '#/places', 'back closes the place sheet');
    ok((await rows()).slice(0, 4).join(', ') === 'Kitchen cabinet, Fridge, Level 2 fridge, Level 1 fridge', 'the list shows the new order');
    await go(page, '#/add');
    ok((await page.locator('#pa-form [name="location"] option').allTextContents()).slice(0, 3).join(', ') === 'Kitchen cabinet, Fridge, Level 2 fridge', 'and so does Kept in');
    await go(page, '#/items');
    const chips = await page.locator('[data-act="place"]').evaluateAll(b => b.map(x => x.dataset.v).filter(Boolean));
    ok(chips.indexOf('Level 2 fridge') < chips.indexOf('Level 1 freezer') && chips.indexOf('Fridge') < chips.indexOf('Level 2 fridge'), 'and the Items filter: ' + chips.join(', '));

    // remove: with items, it asks where they go first; without, at once; Undo either way
    await go(page, '#/places');
    await openPlace('Basement store');
    await sheet.locator('[data-pl="remove"]').click(); await settle(page);
    ok(await sheet.locator('.ha-sheet-title').textContent() === 'Remove Basement store', 'removing a place with items asks where they go');
    ok(!(await sheet.locator('#pa-mv-to option').allTextContents()).includes('Basement store'), 'not back into itself');
    await axe(page, 'remove a place with items');
    if (SHOTS) await shot(page, 'place-remove-with-items');
    await page.goBack(); await settle(page);
    ok(await sheet.count() === 0 && (await S()).list.includes('Basement store'), 'back cancels: nothing removed');
    await openPlace('Basement store');
    await sheet.locator('[data-pl="remove"]').click(); await settle(page);
    const moving = (await S()).items.filter(i => i.location === 'Basement store').map(i => i.id);
    const listBefore = (await S()).list;
    await page.selectOption('#pa-mv-to', 'Store room');
    await sheet.locator('#pa-mv-go').click(); await settle(page);
    now = await S();
    ok(!now.list.includes('Basement store') && moving.every(id => now.items.find(i => i.id === id).location === 'Store room') && !now.items.some(i => i.location === 'Basement store'), 'removed, and its items moved to Store room');
    await toast(page).locator('.ha-toast-action').click(); await settle(page);
    now = await S();
    ok(JSON.stringify(now.list) === JSON.stringify(listBefore) && moving.every(id => now.items.find(i => i.id === id).location === 'Basement store'), 'Undo brings the place and its items back');
    await openPlace('Bathroom');
    await sheet.locator('[data-pl="remove"]').click(); await settle(page);
    ok(await sheet.count() === 0 && !(await S()).list.includes('Bathroom') && !(await rows()).includes('Bathroom'), 'an empty place goes at once');
    ok(await page.evaluate(() => [...window.__pantry.S.places.values()].some(p => p.name === 'Bathroom' && typeof p.removedAt === 'string')), 'removing a place is a marker, the document stays');
    await toast(page).locator('.ha-toast-action').click(); await settle(page);
    ok((await S()).list.includes('Bathroom') && (await rows()).includes('Bathroom'), 'Undo puts the place back where it was');
    await openPlace('Bathroom');
    await sheet.locator('[data-pl="remove"]').click(); await settle(page);
    await go(page, '#/removed');
    ok(/Bathroom.*Place/.test(await page.locator('#pa-removed-places').textContent()), 'a removed place waits in Recently removed');
    await go(page, '#/places');

    // a place an item uses that isn't in the list (a family member's older phone, a backup): still shown everywhere
    const sid = (await S()).items.find(i => i.name === 'Kaya').id;
    await page.evaluate(id => { const S = window.__pantry.S; S.items.set(id, { ...S.items.get(id), location: 'Shed' }); }, sid);
    await go(page, '#/settings'); await go(page, '#/places');
    ok(await page.locator('#h-places-other').count() === 1 && await count('Shed') === '1', 'Not in your list shows Shed with its count');
    await go(page, '#/edit/' + sid);
    ok(await page.inputValue('#pa-form [name="location"]') === 'Shed' && await page.locator('#pa-form optgroup[label="Not in your list"] option', { hasText: 'Shed' }).count() === 1, 'the item keeps Shed, shown as not in your list');
    await go(page, '#/items');
    ok(await page.locator('[data-act="place"][data-v="Shed"]').count() === 1, 'and Items can filter by it');
    await go(page, '#/places');
    await openPlace('Shed');
    await sheet.locator('[data-pl="list"]').click(); await settle(page);
    ok((await S()).list.at(-1) === 'Shed' && await page.locator('#h-places-other').count() === 0, 'Add to your list');
    await noSideways(page, 'places 390');
    await page.evaluate(() => { document.documentElement.style.fontSize = '212.5%'; }); await settle(page);
    await noSideways(page, 'places 200%'); await barApart(page, 'places 200%');
    await openPlace('Fridge');
    const r = await sheet.evaluate(d => ({ sw: d.querySelector('.ha-sheet-body').scrollWidth, cw: d.querySelector('.ha-sheet-body').clientWidth }));
    ok(r.sw <= r.cw, 'place sheet at 200%: no sideways scroll');
    await page.goBack(); await settle(page);
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; }); await settle(page);

    // Say or type knows the household's places
    await go(page, '#/');
    await page.click('[data-act="quick"]'); await settle(page);
    await page.fill('#pa-quick-text', '2 jars of jam in the level 2 fridge and tissue in the basement');
    const said = await page.locator('#pa-quick-list .ha-row-sub').allTextContents();
    ok(said[0].includes('Level 2 fridge') && said[1].includes('Basement store'), 'Say or type finds Level 2 fridge and the basement: ' + said.join(' | '));
    await page.goBack(); await settle(page);

    for (const [w, h] of [[360, 780], [320, 640]]) {
      await page.setViewportSize({ width: w, height: h });
      await go(page, '#/places');
      await noSideways(page, `places ${w}`); await axe(page, `places ${w}`);
      await openPlace('Level 1 freezer');
      const r2 = await sheet.evaluate(d => ({ sw: d.querySelector('.ha-sheet-body').scrollWidth, cw: d.querySelector('.ha-sheet-body').clientWidth }));
      ok(r2.sw <= r2.cw, `place sheet ${w}: no sideways scroll`);
      await page.goBack(); await settle(page);
    }
    ok(errors.length === 0, `places: console errors ${errors.join('; ')}`);
    await ctx.close();
    console.log('  places: ok');
  }

  // ---------- photos: a tiny thumbnail on the item, the photo itself read only when the item opens (this phone) ----------
  {
    const init = () => { try { localStorage.setItem('pantry:welcomed', 'true'); localStorage.setItem('pantry:tour', '"off"'); } catch { /* none */ } };
    const { ctx, page, errors } = await open(390, 844, BASE, { init });
    // a photo-like test picture (colours, shapes, text, a little grain), or pure noise for the worst case
    const picture = (w, h, noise = false) => page.evaluate(async ([w, h, noise]) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#c0392b'); gr.addColorStop(0.5, '#f1c40f'); gr.addColorStop(1, '#2c3e50');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) { g.fillStyle = `hsl(${rnd() * 360},60%,${30 + rnd() * 40}%)`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 20 + rnd() * w / 6, 0, 7); g.fill(); }
      g.font = `bold ${Math.round(h / 8)}px sans-serif`; g.fillStyle = '#fff'; g.fillText('SOY SAUCE 500 ml', w * 0.1, h * 0.55);
      const img = g.getImageData(0, 0, w, h), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const n = noise ? 0 : (rnd() - 0.5) * 24; for (let k = 0; k < 3; k++) d[i + k] = noise ? rnd() * 255 : d[i + k] + n; }
      g.putImageData(img, 0, 0);
      const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
      return [...new Uint8Array(await b.arrayBuffer())];
    }, [w, h, noise]).then(a => Buffer.from(a));
    const idb = (key, val) => page.evaluate(([k, v]) => new Promise((res, rej) => {
      const r = indexedDB.open('pantry');
      r.onsuccess = () => {
        const t = r.result.transaction('docs', v === undefined ? 'readonly' : 'readwrite'), st = t.objectStore('docs');
        const q = v === undefined ? st.get(k) : st.put(v, k);
        t.oncomplete = () => { r.result.close(); res(v === undefined ? q.result ?? null : null); };
        t.onerror = () => rej(t.error);
      };
    }), [key, val]);
    const item = id => page.evaluate(id => window.__pantry.S.items.get(id) || null, id);

    // an item saved before 16 Oct 2026, with the whole photo inside it, moves to a thumbnail + photos/<id> by itself
    const legacy = await page.evaluate(async () => {
      const { pictures } = await import('/pantry/js/photo.js');
      const c = document.createElement('canvas'); c.width = 640; c.height = 480; const g = c.getContext('2d');
      g.fillStyle = '#2a7'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#fff'; g.fillRect(100, 100, 300, 200);
      const b = await new Promise(r => c.toBlob(r, 'image/png'));
      return (await pictures(b)).photo;
    });
    await idb('items/legacy1', { id: 'legacy1', name: 'Old photo item', brand: '', size: '', category: 'Other', location: 'Kitchen cabinet', openDays: null, lowAt: 0, barcode: '', photo: legacy, batches: [], createdAt: '2026-10-01T00:00:00Z' });
    await page.reload(); await page.locator('.ha-large-title').waitFor();
    await page.waitForFunction(() => { const i = window.__pantry.S.items.get('legacy1'); return i && !('photo' in i) && i.hasPhoto; }, null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const migrated = await idb('items/legacy1'), legacyDoc = await idb('photos/legacy1');
    ok(migrated && !('photo' in migrated) && migrated.hasPhoto === true && migrated.thumb.startsWith('data:image/jpeg') && migrated.thumb.length <= 12288, 'old photo moved: the saved item keeps only a thumbnail');
    ok(legacyDoc?.data === legacy, 'and its photo, unchanged, is in photos/<id>');
    ok(migrated.name === 'Old photo item' && migrated.updatedBy === undefined, 'nothing else about the item changed');

    // add an item with a camera picture
    const jpeg = await picture(1600, 1200);
    await go(page, '#/add');
    await page.fill('#pa-form [name="name"]', 'Photo test sauce');
    await page.setInputFiles('#pa-photo-file', { name: 'camera.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await page.locator('.pa-photo img').waitFor();
    ok(await page.locator('[data-act="photo-del"]').isVisible(), 'the form offers Remove photo');
    await page.click('#pa-save'); await settle(page);
    const id = hash(page).split('/')[2];
    const added = await item(id), doc = await idb('photos/' + id);
    ok(added.hasPhoto === true && !('photo' in added) && added.thumb.startsWith('data:image/jpeg'), 'the item holds a thumbnail, not the photo');
    ok(doc && doc.id === id && doc.data.startsWith('data:image/jpeg') && doc.data.length > added.thumb.length * 3, 'the photo is saved on its own');
    const dims = await page.evaluate(async ([a, b]) => {
      const size = src => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = src; });
      return [await size(a), await size(b)];
    }, [added.thumb, doc.data]);
    ok(dims[0][0] === 96 && dims[0][1] === 72 && dims[1][0] === 480 && dims[1][1] === 360, `thumbnail 96x72, photo 480x360 (${dims.join(' / ')})`);
    await page.waitForFunction(d => document.querySelector('#pa-hero')?.src === d, doc.data);
    ok(true, 'the item screen shows the photo');
    await axe(page, 'item with a photo');
    await noSideways(page, 'item with a photo');
    await shot(page, '30-item-photo');
    // lists use the thumbnail
    await go(page, '#/items');
    ok(await page.locator('#pa-items-list a.ha-row', { hasText: 'Photo test sauce' }).locator('img.ha-row-thumb').getAttribute('src') === added.thumb, 'the list shows the thumbnail');
    ok(await page.locator('#pa-items-list a.ha-row', { hasText: 'Old photo item' }).locator('img.ha-row-thumb').getAttribute('src') === migrated.thumb, 'and the moved item its thumbnail');
    await go(page, '#/');
    ok(await page.evaluate(() => [...document.querySelectorAll('img')].every(i => !i.src.startsWith('data:') || i.src.length <= 12288)), 'Home has no full photos');

    // a fresh start reads the photo only when the item opens
    await page.reload(); await page.locator('.ha-large-title').waitFor(); await settle(page);
    ok(await page.evaluate(() => window.__pantry.S.pics.size) === 0, 'nothing but thumbnails loaded at start');
    await go(page, '#/item/' + id);
    await page.waitForFunction(d => document.querySelector('#pa-hero')?.src === d, doc.data);
    ok(await page.evaluate(id => window.__pantry.S.pics.get(id)?.data?.length, id) === doc.data.length, 'opening the item fetched its photo');

    // remove the photo: both go
    await page.click('[data-act="edit"]'); await settle(page);
    ok(await page.locator('.pa-photo img').getAttribute('src') === added.thumb, 'edit shows the thumbnail');
    await page.click('[data-act="photo-del"]'); await settle(page);
    await page.click('#pa-save'); await settle(page);
    const bare = await item(id);
    ok(!bare.thumb && !bare.hasPhoto && !('photo' in bare), 'Remove photo clears the thumbnail');
    ok(await idb('photos/' + id) === null, 'and deletes the photo');
    ok(await page.locator('#pa-hero').count() === 0, 'the item shows no picture');

    // a new photo again, then delete the item: its photo goes too, and Undo brings both back
    await page.click('[data-act="edit"]'); await settle(page);
    await page.setInputFiles('#pa-photo-file', { name: 'camera.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await page.locator('.pa-photo img').waitFor();
    await page.click('#pa-save'); await settle(page);
    const again = await idb('photos/' + id);
    ok(again?.data?.startsWith('data:image/jpeg'), 'a new photo is saved');
    await page.click('[data-act="delete"]'); await settle(page);
    ok((await idb('items/' + id))?.removedAt && (await idb('photos/' + id))?.data === again.data, 'deleting the item hides it and keeps its photo (until it is purged after 30 days)');
    await toast(page).locator('.ha-toast-action').click(); await settle(page);
    ok(!(await idb('items/' + id))?.removedAt && (await idb('photos/' + id))?.data === again.data && (await idb('items/' + id))?.hasPhoto, 'Undo brings the item back, photo and all');

    // the backup holds the photos
    await go(page, '#/settings');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="backup"]')]);
    const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    ok(backup.photos?.some(p => p.id === 'legacy1' && p.data === legacy), 'the backup includes the photos (a removed item’s photo too, until it is purged)');
    ok(backup.items.find(i => i.id === 'legacy1')?.thumb === migrated.thumb, 'and the items their thumbnails');

    // sizes, for the record: a photo-like camera picture and pure noise (the worst case)
    const noise = await picture(1600, 1200, true);
    const sizes = await page.evaluate(async bufs => {
      const { pictures } = await import('/pantry/js/photo.js');
      const out = [];
      for (const b of bufs) { const p = await pictures(new Blob([new Uint8Array(b)], { type: 'image/jpeg' })); out.push([p.thumb.length, p.photo.length]); }
      return out;
    }, [[...jpeg], [...noise]]);
    ok(sizes.every(([t, p]) => t <= 12288 && p <= 153600), 'every picture fits the rules');
    console.log(`  photo sizes (data URL bytes): camera-like 1600x1200 JPEG (${jpeg.length} B) -> thumb ${added.thumb.length}, photo ${doc.data.length}; noise (${noise.length} B) -> thumb ${sizes[1][0]}, photo ${sizes[1][1]}; old item -> thumb ${migrated.thumb.length}`);

    ok(errors.length === 0, `photos: console errors ${errors.join('; ')}`);
    await ctx.close();
    console.log('  photos: ok');
  }

  // ---------- barcode look-ups: three databases, and naming an unknown barcode (demo, no real camera or network) ----------
  {
    // a fake camera and barcode reader: the reader "sees" whatever the test puts in window.__scanCode
    const init = () => {
      window.__scanCode = null;
      globalThis.BarcodeDetector = class {
        static async getSupportedFormats() { return ['ean_13']; }
        async detect() { const c = window.__scanCode; window.__scanCode = null; return c ? [{ rawValue: c }] : []; }
      };
      navigator.mediaDevices.getUserMedia = async () => {
        const c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').fillRect(0, 0, 16, 16);
        return c.captureStream();
      };
    };
    const { ctx, page, errors } = await open(390, 844, BASE + '?demo', { init });
    const HOUSEHOLD = '1111111111116', UNKNOWN = '2222222222222', UNKNOWN2 = '3333333333333';
    const asked = [];
    const answer = (host, hits) => ctx.route(`https://${host}/**`, route => {
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

    // a household-products hit fills the name and guesses the category and place
    await go(page, '#/add');
    await scan(HOUSEHOLD);
    await page.waitForFunction(() => document.querySelector('#pa-form [name="name"]')?.value === 'Laundry liquid test', null, { timeout: 8000 }); await settle(page);
    ok(asked.some(a => a.startsWith('world.openfoodfacts.org')) && asked.some(a => a.startsWith('world.openproductsfacts.org')) && asked.some(a => a.startsWith('world.openbeautyfacts.org')), 'all three databases asked');
    ok(await page.inputValue('#pa-form [name="brand"]') === 'Testbrand' && await page.inputValue('#pa-form [name="size"]') === '3 L', 'products database fills brand and size');
    ok(await page.inputValue('#pa-form [name="category"]') === 'Laundry & cleaning' && await page.inputValue('#pa-form [name="location"]') === 'Store room', 'and guesses Laundry & cleaning, Store room');
    ok(await page.inputValue('#pa-form [name="barcode"]') === HOUSEHOLD, 'the barcode is kept');
    // a category already chosen is not overridden
    await go(page, '#/'); await go(page, '#/add');
    await page.selectOption('#pa-form [name="category"]', 'Pet');
    await scan(HOUSEHOLD);
    await page.waitForFunction(() => document.querySelector('#pa-form [name="name"]')?.value === 'Laundry liquid test', null, { timeout: 8000 }); await settle(page);
    ok(await page.inputValue('#pa-form [name="category"]') === 'Pet' && await page.inputValue('#pa-form [name="location"]') === 'Store room', 'a chosen category stays; the place is still guessed');

    // an unknown barcode opens the sheet, search field focused, barcode already in the form
    await go(page, '#/'); await go(page, '#/add');
    await scan(UNKNOWN);
    await unknown.waitFor({ timeout: 8000 }); await settle(page);
    ok(await unknown.locator('.ha-sheet-title').textContent() === 'We don’t know this barcode yet', 'unknown barcode: the sheet says so');
    ok(await page.evaluate(() => document.activeElement?.id) === 'pa-unk-find', 'the search field has focus');
    ok((await unknown.locator('.pa-unk-code').textContent()) === UNKNOWN, 'the sheet shows the barcode');
    ok(await page.inputValue('#pa-form [name="barcode"]') === UNKNOWN, 'the barcode is already in the form');
    ok(await unknown.locator('#pa-unk-list').isHidden(), 'no list before typing');
    const targets = await unknown.locator('.ha-row, .ha-sheet-head button').evaluateAll(els => els.filter(e => e.getClientRects().length).map(e => e.getBoundingClientRect().height));
    ok(targets.every(h => h >= 43.5), `sheet targets are 44px (${targets.join(', ')})`);
    await axe(page, 'unknown barcode sheet');
    await noSideways(page, 'unknown barcode sheet');
    await shot(page, '20-unknown-barcode');
    // back closes it and stays on Add with the barcode
    await page.goBack(); await settle(page);
    ok(await unknown.count() === 0 && hash(page) === '#/add', 'back closes the sheet and stays on Add');
    ok(await page.inputValue('#pa-form [name="barcode"]') === UNKNOWN, 'the barcode stays after closing');

    // picking a catalogue product fills the form with the barcode
    await scan(UNKNOWN);
    await unknown.waitFor({ timeout: 8000 }); await settle(page);
    await page.fill('#pa-unk-find', 'laundry liquid');
    await unknown.locator('#pa-unk-list [data-act="unk-cat"]').first().waitFor();
    const subs = await unknown.locator('#pa-unk-list .ha-row-sub').allTextContents();
    ok(subs.filter(t => t.startsWith('Dynamo')).length === 1 && await unknown.locator('#pa-unk-list [data-act="unk-mine"] .ha-row-sub').first().textContent().then(t => t.startsWith('Dynamo')), 'a product already in the pantry is offered once, as the pantry item');
    await axe(page, 'unknown barcode sheet with a search');
    await noSideways(page, 'unknown barcode sheet with a search');
    await shot(page, '21-unknown-barcode-search');
    await page.fill('#pa-unk-find', 'breeze');
    await unknown.locator('#pa-unk-list [data-act="unk-cat"]').first().click(); await settle(page);
    ok(await unknown.count() === 0 && hash(page) === '#/add', 'picking closes the sheet, still on Add');
    ok(await page.inputValue('#pa-form [name="name"]') === 'Laundry liquid' && await page.inputValue('#pa-form [name="brand"]') === 'Breeze', 'the catalogue product fills name and brand');
    ok(await page.inputValue('#pa-form [name="size"]') === '3.6 kg' && await page.inputValue('#pa-form [name="category"]') === 'Laundry & cleaning' && await page.inputValue('#pa-form [name="location"]') === 'Laundry', 'and size, category and place');
    ok(await page.inputValue('#pa-form [name="barcode"]') === UNKNOWN, 'with the barcode attached');

    // Type a new name: closes and focuses Name, starting with what was typed
    await go(page, '#/'); await go(page, '#/add');
    await scan(UNKNOWN2);
    await unknown.waitFor({ timeout: 8000 }); await settle(page);
    await page.fill('#pa-unk-find', 'Grandma’s chilli oil');
    await unknown.locator('[data-act="unk-new"]').click(); await settle(page);
    ok(await unknown.count() === 0 && await page.evaluate(() => document.activeElement?.name) === 'name', 'Type a new name focuses Name');
    ok(await page.inputValue('#pa-form [name="name"]') === 'Grandma’s chilli oil' && await page.inputValue('#pa-form [name="barcode"]') === UNKNOWN2, 'it starts with the search text and keeps the barcode');

    // picking an item already in the pantry attaches the barcode to it and opens Bought more
    await go(page, '#/'); await go(page, '#/add');
    await scan(UNKNOWN2);
    await unknown.waitFor({ timeout: 8000 }); await settle(page);
    await page.fill('#pa-unk-find', 'kaya');
    await unknown.locator('#pa-unk-list [data-act="unk-mine"]').first().click(); await settle(page);
    const kaya = await page.evaluate(() => [...window.__pantry.S.items.values()].find(i => i.name === 'Kaya'));
    ok(kaya.barcode === UNKNOWN2, 'the barcode is saved on the pantry item');
    ok(hash(page) === '#/item/' + kaya.id && await page.locator('dialog.ha-sheet[open] .ha-sheet-title').textContent() === 'Bought more', 'its item opens with Bought more');
    await page.goBack(); await settle(page);
    ok(hash(page) === '#/item/' + kaya.id && await page.locator('dialog.ha-sheet[open]').count() === 0, 'back closes Bought more');
    // and scanning it again finds it straight away (no look-up)
    const before = asked.length;
    await go(page, '#/add');
    await scan(UNKNOWN2);
    await page.locator('dialog.ha-sheet[open] .ha-sheet-title', { hasText: 'Bought more' }).waitFor({ timeout: 8000 }); await settle(page);
    ok(hash(page) === '#/item/' + kaya.id && asked.length === before, 'the next scan finds the item without asking online');

    ok(errors.length === 0, `barcode: console errors ${errors.join('; ')}`);
    await ctx.close();
    console.log('  barcode look-ups: ok');
  }

  // ---------- 16 Oct 2026 features (demo): names, since you last looked, guessed dates, freeze and thaw, leftovers,
  // the shopping list (aisles, Buy again, mic, Going shopping), Plenty / Low / Out, scan many ----------
  {
    const init = () => {
      window.__scanCode = null;
      globalThis.BarcodeDetector = class {
        static async getSupportedFormats() { return ['ean_13']; }
        async detect() { const c = window.__scanCode; window.__scanCode = null; return c ? [{ rawValue: c }] : []; }
      };
      navigator.mediaDevices.getUserMedia = async () => {
        const c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').fillRect(0, 0, 16, 16);
        return c.captureStream();
      };
      // the phone's speech-to-text: "hears" window.__said, then ends (twice, as some browsers do)
      window.SpeechRecognition = window.webkitSpeechRecognition = class {
        start() { setTimeout(() => { this.onresult?.({ results: [Object.assign([{ transcript: window.__said || '' }], { isFinal: true })] }); setTimeout(() => { this.onend?.(); this.onend?.(); }, 50); }, 100); }
        stop() { this.onend?.(); }
      };
    };
    const { ctx, page, errors } = await open(390, 844, BASE + '?demo', { init });
    const S = (fn, arg) => page.evaluate(fn, arg);
    const idOf = name => S(n => [...window.__pantry.S.items.values()].find(i => i.name === n)?.id, name);

    // Home: since you last looked (Dad's last few days in the demo), and "use this week" on WhatsApp
    const since = page.locator('#h-since').locator('xpath=..');
    ok(await since.locator('.ha-row-title').count() === 3, 'Since you last looked: three things Dad did');
    ok((await since.innerText()).includes('Dad threw away Wholemeal bread') && (await since.innerText()).includes('Dad bought Eggs (10)'), 'in words, with names');
    const wa = await page.locator('#pa-wa-week').getAttribute('href');
    ok(wa.startsWith('https://wa.me/?text=') && decodeURIComponent(wa.split('text=')[1]).startsWith('Use this week\n- Meiji Fresh milk, by '), 'use this week as a WhatsApp message');
    ok(await page.locator('#pa-wa-week').getAttribute('target') === '_blank', 'opens WhatsApp in a new tab');
    await axe(page, 'home with since you last looked');
    await shot(page, 'n01-home-since');
    await page.click('[data-act="since-ok"]'); await settle(page);
    ok(await page.locator('#h-since').count() === 0, 'Got it clears it');

    // names: the family list shows names with the email underneath; a contact sheet per person
    await go(page, '#/settings');
    const fam = page.locator('#h-family').locator('xpath=..');
    ok(await fam.locator('[data-act="person"][data-v="dad@example.com"] .ha-row-title').textContent() === 'Dad', 'a named member shows the name');
    ok((await fam.locator('[data-act="person"][data-v="dad@example.com"] .ha-row-sub').textContent()).includes('dad@example.com'), 'with the email under it');
    ok(await fam.locator('[data-act="person"][data-v="grandma@example.com"] .ha-row-title').textContent() === 'grandma@example.com', 'no name: the email');
    await axe(page, 'settings with the family');
    await shot(page, 'n02-family-list');
    await page.click('[data-act="person"][data-v="grandma@example.com"]'); await settle(page);
    const person = page.locator('dialog.ha-sheet[open]');
    ok(await person.locator('.ha-sheet-title').textContent() === 'Family member', 'the contact sheet');
    ok((await person.locator('a', { hasText: 'Email an invite' }).getAttribute('href')).startsWith('mailto:grandma%40example.com'), 'Email an invite');
    ok(await person.locator('[data-pp="remove"]').count() === 1, 'Stop sharing for someone else');
    await page.fill('#pa-person-name', '  Grandma   Lim ');
    await axe(page, 'contact sheet');
    await shot(page, 'n03-contact-sheet');
    await person.locator('button[type=submit]').click(); await settle(page);
    ok(await fam.locator('[data-act="person"][data-v="grandma@example.com"] .ha-row-title').textContent() === 'Grandma Lim', 'the name shows in the list');
    ok(await S(() => window.__pantry.S.settings.get('people').names['grandma@example.com']) === 'Grandma Lim', 'saved in settings/people');
    await page.click('[data-act="person"][data-v="mum@example.com"]'); await settle(page);
    ok(await page.locator('dialog.ha-sheet[open] [data-pp="remove"]').count() === 0 && await page.locator('dialog.ha-sheet[open] a', { hasText: 'Email an invite' }).count() === 0, 'your own sheet: no invite, no Stop sharing');
    await page.goBack(); await settle(page);
    await page.click('[data-act="person"][data-v="grandma@example.com"]'); await settle(page);
    await page.click('dialog.ha-sheet[open] [data-pp="remove"]'); await settle(page);
    await page.locator('dialog.ha-sheet[open] .ha-btn--danger', { hasText: 'Stop sharing' }).click(); await settle(page); await settle(page);
    ok(await fam.locator('[data-act="person"][data-v="grandma@example.com"]').count() === 0, 'Stop sharing removes her');
    ok(await S(() => !('grandma@example.com' in window.__pantry.S.settings.get('people').names)), 'and her name');

    // Add: picking a product guesses its best-before date, as a selected chip
    await go(page, '#/add');
    await page.fill('#pa-find', 'magnolia fresh milk');
    await page.locator('#pa-sugg [data-act="sugg"]').first().click(); await settle(page);
    ok(await page.inputValue('#pa-form [name="expiry"]') === ymdPlus(7), 'fresh milk: a week, guessed');
    ok(await page.locator('.pa-guess').getAttribute('aria-pressed') === 'true' && await page.locator('.pa-guess').textContent() === 'About 1 week', 'shown as a selected About 1 week chip');
    ok((await page.locator('.pa-guess-hint').textContent()).includes('a guess'), 'said to be a guess');
    await page.selectOption('#pa-form [name="location"]', 'Freezer'); await settle(page);
    ok(await page.inputValue('#pa-form [name="expiry"]') === ymdPlus(365), 'in the freezer it keeps a year');
    await page.selectOption('#pa-form [name="location"]', 'Fridge'); await settle(page);
    await page.fill('#pa-form [name="expiry"]', ymdPlus(10));
    await page.selectOption('#pa-form [name="category"]', 'Drinks'); await settle(page);
    ok(await page.inputValue('#pa-form [name="expiry"]') === ymdPlus(10), 'a date someone typed stays');
    await page.selectOption('#pa-form [name="category"]', 'Dairy & eggs'); await settle(page);
    await page.click('.pa-guess'); await settle(page);
    await page.locator('#h-f-stock').scrollIntoViewIfNeeded();
    await axe(page, 'add with a guessed date');
    await shot(page, 'n04-add-guess');
    await page.click('[data-act="back"]'); await settle(page);

    // Freeze and Thaw on a batch
    const milk = await idOf('Fresh milk');
    await go(page, '#/item/' + milk);
    // two freezers in the demo: Freeze asks which (one unit: no "how many")
    await page.click('[data-act="freeze"]'); await settle(page);
    const cold = page.locator('dialog.ha-sheet[open]');
    ok(await cold.locator('#pa-cold-qty').count() === 0 && (await cold.locator('input[name="pa-cold"]').evaluateAll(l => l.map(i => i.value))).join() === 'Freezer,Level 1 freezer', 'Freeze asks which freezer');
    await axe(page, 'freeze sheet');
    await cold.locator('#pa-cold-go').click(); await settle(page);
    ok((await toast(page).textContent()).startsWith('1 frozen: moved to Freezer, keeps till'), 'Freeze says where and till when');
    let m = await S(id => window.__pantry.S.items.get(id), milk);
    const packDate = m.batches[0].packExpiry;
    ok(m.location === 'Freezer' && m.batches[0].frozenAt === ymdPlus(0) && m.batches[0].expiry === ymdPlus(365) && m.batches[0].packPlace === 'Fridge', 'frozen: in the freezer, a year, frozen today, the packaging date kept');
    ok(await page.locator('.pa-batch .ha-row-title').first().textContent() === '1 frozen' && (await page.locator('.pa-batch .ha-row-sub').first().textContent()).startsWith('Frozen '), 'the batch says frozen, and when');
    await axe(page, 'item frozen');
    await shot(page, 'n05-item-frozen');
    await page.click('[data-act="thaw"]'); await settle(page);
    ok((await cold.locator('input[name="pa-cold"]').evaluateAll(l => l.map(i => i.value))).join() === 'Fridge,Level 1 fridge', 'Thaw asks which fridge');
    await cold.locator('#pa-cold-go').click(); await settle(page);
    m = await S(id => window.__pantry.S.items.get(id), milk);
    ok(m.location === 'Fridge' && !m.batches[0].frozenAt && m.batches[0].expiry === ymdPlus(3), 'thawed: back in the fridge, three days');
    ok((await page.locator('#h-history').locator('xpath=..').innerText()).includes('Thawed'), 'the history says thawed');
    await shot(page, 'n06-item-thawed');
    await toast(page).locator('.ha-toast-action').click(); await settle(page);
    ok(await S(id => window.__pantry.S.items.get(id).location, milk) === 'Freezer', 'Undo puts it back in the freezer');
    // frozen by mistake: Not frozen puts back the packaging date and the fridge
    await page.click('[data-act="unfreeze"]'); await settle(page);
    m = await S(id => window.__pantry.S.items.get(id), milk);
    ok(m.location === 'Fridge' && !m.batches[0].frozenAt && !m.batches[0].thawedAt && m.batches[0].expiry === packDate && !('packExpiry' in m.batches[0]), 'Not frozen: the packaging date and the fridge are back');
    ok((await toast(page).textContent()).startsWith('Not frozen: use by'), 'and says so');
    ok(await page.locator('[data-act="unfreeze"]').count() === 0, 'no Not frozen once it isn’t');
    // moving it into a freezer freezes it, out again thaws it
    const moveByForm = async to => { await go(page, '#/edit/' + milk); await page.selectOption('#pa-form [name="location"]', to); await page.click('#pa-save'); await settle(page); };
    await moveByForm('Level 1 freezer');
    m = await S(id => window.__pantry.S.items.get(id), milk);
    ok(m.location === 'Level 1 freezer' && m.batches[0].frozenAt === ymdPlus(0) && m.batches[0].expiry === ymdPlus(365), 'moved into a freezer: frozen, a year');
    ok((await toast(page).textContent()) === 'Saved: 1 frozen (keeps a year)', 'Save says it froze');
    await moveByForm('Fridge');
    m = await S(id => window.__pantry.S.items.get(id), milk);
    ok(!m.batches[0].frozenAt && m.batches[0].thawedAt === ymdPlus(0) && m.batches[0].expiry === ymdPlus(3), 'moved out: thawed, three days');
    ok(await page.locator('[data-act="unfreeze"]').count() === 0, 'thawed for real: no Not frozen (thawed food keeps its 3 days)');
    // thawing some of a batch (frozen goods in a freezer): how many, and the rest stays frozen
    const dump = await idOf('Frozen dumplings');
    await go(page, '#/item/' + dump);
    const db = (await S(id => window.__pantry.S.items.get(id), dump)).batches[0];
    await page.click(`[data-act="thaw"][data-b="${db.id}"]`); await settle(page);
    ok(await cold.locator('#pa-cold-qty output').textContent() === '2' && await cold.locator('#pa-cold-where').isVisible(), 'how many starts at all of them, with the fridges');
    await cold.locator('#pa-cold-qty [data-step="-1"]').click();
    ok(await cold.locator('#pa-cold-where').isHidden() && (await cold.locator('#pa-cold-note').textContent()) === 'The rest stays in Level 1 freezer.', 'one of two: no place to pick, the rest stays');
    await axe(page, 'thaw some');
    await cold.locator('#pa-cold-go').click(); await settle(page);
    const d2 = await S(id => window.__pantry.S.items.get(id), dump);
    ok(d2.location === 'Level 1 freezer' && d2.batches.some(b => b.id === db.id && b.qty === 1) && d2.batches.some(b => b.thawedAt === ymdPlus(0) && b.qty === 1 && b.expiry === ymdPlus(3)), 'split: one thawed, one still frozen');
    ok(await page.locator('.pa-batch .ha-row-title').evaluateAll(l => l.map(x => x.textContent).sort().join()) === '1 frozen,1 in stock', 'the rows say which');
    await toast(page).locator('.ha-toast-action').click(); await settle(page);
        await go(page, '#/item/' + await idOf('Laundry liquid'));
    ok(await page.locator('[data-act="freeze"]').count() === 0, 'no Freeze for laundry liquid');

    // Leftovers: a name, the fridge, three days
    await go(page, '#/');
    await page.click('.pa-quickrow [data-act="leftovers"]'); await settle(page);
    const left = page.locator('dialog.ha-sheet[open]');
    ok(await left.locator('.ha-sheet-title').textContent() === 'Leftovers' && await left.locator('[name="location"]').inputValue() === 'Fridge', 'Leftovers: the fridge already chosen');
    await left.locator('.ha-sheet-foot .ha-btn--primary').click();
    ok(await page.locator('#pa-left-err').isVisible(), 'a name is needed');
    await page.fill('#pa-left-name', 'Chicken curry');
    await axe(page, 'leftovers sheet');
    await shot(page, 'n07-leftovers');
    await left.locator('.ha-sheet-foot .ha-btn--primary').click(); await settle(page);
    const curry = await S(() => [...window.__pantry.S.items.values()].find(i => i.name === 'Chicken curry'));
    ok(curry && curry.category === 'Leftovers' && curry.location === 'Fridge' && curry.noRestock && curry.batches[0].expiry === ymdPlus(3), 'in the fridge, use within 3 days, never on the list');
    ok(await page.locator('#h-use-soon').locator('xpath=..').locator('.ha-row', { hasText: 'Chicken curry' }).count() === 1, 'under Use soon');

    // Plenty / Low / Out for a staple
    const rice = await idOf('Thai hom mali rice');
    await go(page, '#/edit/' + rice);
    await page.click('.pa-track .ha-seg:has(input[value="level"])'); await settle(page);
    await page.click('#pa-save'); await settle(page);
    ok(await page.locator('.pa-level').count() === 1 && await page.locator('.pa-level input[value="plenty"]').isChecked(), 'a staple shows Plenty / Low / Out');
    ok(await page.locator('[data-act="bought"]').count() === 0 && await page.locator('#h-stock .ha-num').count() === 0, 'no count, no Bought more');
    await page.click('.pa-level .ha-seg:has(input[value="low"])'); await settle(page);
    ok((await toast(page).textContent()).includes('low, on the shopping list'), 'Low puts it on the list');
    ok(await S(id => [...window.__pantry.S.shop.values()].some(x => x.itemId === id && !x.done && !x.removedAt), rice), 'a line on the list');
    ok((await page.locator('#h-history').locator('xpath=..').innerText()).includes('Marked low'), 'the history says Marked low');
    await axe(page, 'staple item');
    await shot(page, 'n08-staple');
    await toast(page).locator('.ha-toast-action').click(); await settle(page);
    ok(await S(id => !window.__pantry.S.items.get(id).level || window.__pantry.S.items.get(id).level === 'plenty', rice) && await S(id => ![...window.__pantry.S.shop.values()].some(x => x.itemId === id && !x.removedAt), rice), 'Undo: plenty again, off the list');
    await page.click('.pa-level .ha-seg:has(input[value="out"])'); await settle(page);
    await go(page, '#/items');
    ok((await page.locator('#pa-items-list .ha-row', { hasText: 'Thai hom mali rice' }).locator('.ha-row-sub').textContent()).startsWith('Out'), 'Items says Out');

    // the shopping list: aisles, Buy again, the mic, Going shopping
    await go(page, '#/shop');
    ok(await page.locator('.pa-again .ha-chip').count() >= 2, 'Buy again chips');
    const again = (await page.locator('.pa-again .ha-chip').first().textContent()).trim();
    await page.locator('.pa-again .ha-chip').first().click(); await settle(page);
    ok(await page.locator('#pa-shop .ha-row-title', { hasText: again }).count() === 1, 'a Buy again chip adds it');
    ok(await page.locator('.pa-again .ha-chip', { hasText: again }).count() === 0, 'and leaves the chips');
    await page.evaluate(() => { window.__said = 'bananas, cream crackers and dishwashing liquid'; });
    await page.click('#pa-shop-mic'); await page.waitForTimeout(700); await settle(page);
    ok((await toast(page).textContent()).includes('Added 3 things to the list'), 'the mic adds each thing said, once');
    const aisles = await page.locator('#pa-shop .pa-aisle').allTextContents();
    ok(aisles.includes('Fresh produce') && aisles.includes('Snacks') && aisles.includes('Laundry & cleaning'), 'grouped by aisle: ' + aisles.join(', '));
    ok(aisles.indexOf('Snacks') < aisles.indexOf('Laundry & cleaning'), 'in the catalogue’s order');
    const going = decodeURIComponent((await page.locator('#pa-wa-going').getAttribute('href')).split('text=')[1]);
    ok(going.startsWith('Going shopping now. Anything to add?\n\nShopping list\n- ') && going.includes('Bananas'), 'Going shopping now: the list as a WhatsApp message');
    await page.evaluate(() => scrollTo(0, 0));
    await axe(page, 'shopping, grouped');
    await shot(page, 'n09-shop', true);
    await page.locator('#pa-shop label', { hasText: 'Bananas' }).locator('input').click(); await settle(page);
    await page.locator('#pa-shop label', { hasText: 'Thai hom mali rice' }).locator('input').click(); await settle(page);
    await page.click('[data-act="put-away"]'); await settle(page);
    ok((await page.locator('dialog.ha-sheet[open] .pa-pa', { hasText: 'Thai hom mali rice' }).innerText()).includes('Back to plenty'), 'Put away: a staple goes back to plenty');
    await shot(page, 'n10-put-away');
    await page.click('#pa-pa-go'); await settle(page);
    ok(await S(id => window.__pantry.S.items.get(id).level, rice) === 'plenty', 'rice: plenty again');

    // scan many: Bought, Used up, Add to list, and a barcode not in the pantry
    await S(() => { const S = window.__pantry.S; for (const [n, c] of [['Kaya', '4900000000011'], ['Fresh milk', '4900000000028']]) { const it = [...S.items.values()].find(i => i.name === n); S.items.set(it.id, { ...it, barcode: c }); } });
    const kaya = await idOf('Kaya');
    const kayaQty = () => S(id => window.__pantry.S.items.get(id).batches.reduce((n, b) => n + b.qty, 0), kaya);
    const q0 = await kayaQty();
    await go(page, '#/');
    await page.click('.pa-quickrow [data-act="scan-many"]'); await settle(page);
    const sm = page.locator('dialog.ha-sheet[open]');
    ok(await sm.locator('.ha-sheet-title').textContent() === 'Scan many' && await sm.locator('[name="pa-sm-mode"][value="add"]').isChecked(), 'Scan many opens on Bought');
    const scanOne = async c => { await page.evaluate(x => { window.__scanCode = x; }, c); await page.waitForTimeout(700); };
    await scanOne('4900000000011'); await scanOne('4900000000028');
    await page.waitForTimeout(2600); await scanOne('4900000000011');
    await scanOne('5555555555555');
    ok(await kayaQty() === q0 + 2, 'two kaya bought (each scan once)');
    ok(await sm.locator('#pa-sm-n').textContent() === '4', 'the tally counts four scans');
    ok((await sm.locator('#pa-sm-tally').innerText()).includes('× 2') && await sm.locator('[data-sm-new="5555555555555"]').count() === 1, 'kaya × 2, and the new barcode waits with Add it');
    await sm.locator('.ha-seg:has(input[value="use"])').click();
    await scanOne('4900000000011');
    ok(await kayaQty() === q0 + 1, 'Used up takes one out');
    await sm.locator('.ha-seg:has(input[value="list"])').click();
    await scanOne('4900000000028');
    ok(await S(() => [...window.__pantry.S.shop.values()].some(x => x.name.includes('Fresh milk') && !x.done && !x.removedAt)), 'Add to list puts it on the list');
    await axe(page, 'scan many');
    await noSideways(page, 'scan many');
    await shot(page, 'n11-scan-many');
    await sm.locator('.ha-sheet-foot [data-ha-close]').click(); await settle(page);
    ok((await toast(page).textContent()).includes('Saved 5 scans'), 'Done: one toast for every scan (the new barcode waits)');
    await toast(page).locator('.ha-toast-action').click(); await settle(page);
    ok(await kayaQty() === q0 && await S(() => ![...window.__pantry.S.shop.values()].some(x => x.name.includes('Fresh milk') && !x.done && !x.removedAt)), 'one Undo takes every scan back');

    // the new screens at 320px: no sideways scroll
    await page.setViewportSize({ width: 320, height: 640 });
    for (const h of ['#/', '#/shop', '#/settings', '#/item/' + rice, '#/item/' + milk]) { await go(page, h); await noSideways(page, `320 ${h}`); }
    await go(page, '#/shop');
    await page.locator('#pa-shop label').first().locator('input').click(); await settle(page);
    await page.click('[data-act="put-away"]'); await settle(page);
    await noSideways(page, '320 put away');
    const r = await page.locator('dialog.ha-sheet[open]').evaluate(d => ({ sw: d.querySelector('.ha-sheet-body').scrollWidth, cw: d.querySelector('.ha-sheet-body').clientWidth }));
    ok(r.sw <= r.cw, '320 put away: no sideways scroll in the sheet');
    await axe(page, '320 put away');

    ok(errors.length === 0, `new features: console errors ${errors.join('; ')}`);
    await ctx.close();
    console.log('  names, since, guesses, freeze, leftovers, shopping, staples, scan many: ok');
  }
  console.log(`pantry e2e: ok (${checks} checks)`);
} finally {
  await browser.close();
  srv.close();
}
