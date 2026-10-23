// Shared helpers for the app*.spec.mjs files (the phone browser tests that used to be e2e.mjs). Not a spec itself.
// Every wait is on something the page shows or does (web-first assertions, expect.poll); nothing sleeps.
import fs from 'node:fs';
import path from 'node:path';
import { expect } from './fixtures.mjs';

export const BASE = '/pantry/';
export const MOBILE = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
// a phone that has seen the welcome and has the Getting started list switched off, so a test starts at the screen it is about
export const WELCOMED = () => { try { localStorage.setItem('pantry:welcomed', 'true'); localStorage.setItem('pantry:tour', '"off"'); } catch { /* none */ } };
// a fake camera and barcode reader: the reader "sees" whatever the test puts in window.__scanCode
export const FAKE_CAMERA = () => {
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
// the phone's speech-to-text: "hears" window.__said, then ends (twice, as some browsers do)
export const FAKE_SPEECH = () => {
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() { setTimeout(() => { this.onresult?.({ results: [Object.assign([{ transcript: window.__said || '' }], { isFinal: true })] }); setTimeout(() => { this.onend?.(); this.onend?.(); }, 50); }, 100); }
    stop() { this.onend?.(); }
  };
};
export const SHOTS = process.env.SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
export const shot = async (page, name, full = false) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full }); };

// open the app on a phone of this size (390x844 unless told) and wait for the first screen
// The service worker stays out of it unless a test is about it ({ sw: true }): on a phone's first visit the worker installs
// and takes over the page, and the app reloads itself once when that happens (the controllerchange handler in app.js), at
// a moment no test can predict, with the history entry of an open sheet carried over to the new page. With sw: true an
// init script notes whether each document began under the worker, and open() waits for one that did, so the test never
// clicks into a page that is about to reload.
const UNDER_WORKER = 'window.__swAtStart = !!navigator.serviceWorker?.controller;';
export async function open(phone, name, url = BASE, { width = 390, height = 844, init, sw = false, ...opts } = {}) {
  const page = await phone(name, {
    url, viewport: { width, height }, ...MOBILE, serviceWorkers: sw ? 'allow' : 'block',
    init: { content: `${[].concat(init || []).map(f => `(${f})();`).join('')}${UNDER_WORKER}` }, ...opts,
  });
  if (sw) await page.waitForFunction(() => window.__swAtStart === true);
  await expect(page.locator('.ha-large-title').first()).toBeVisible();
  return page;
}
// finite animations (sheets, toasts, view transitions) have run out
export const quiet = page => page.evaluate(() => Promise.all(document.getAnimations()
  .filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
export const hash = page => new URL(page.url()).hash;
export const go = async (page, h) => {
  await page.evaluate(x => { location.hash = x; }, h);
  await expect.poll(() => hash(page)).toBe(h);
  await expect(page.locator('#main')).toBeVisible();
  await quiet(page);
};
export const toast = page => page.locator('.ha-toast.is-visible');
export const undo = async page => { await toast(page).locator('.ha-toast-action').click(); };
export const sheetOpen = page => page.locator('dialog.ha-sheet[open]');
export const ymdPlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
// the app has decided about the welcome by now: it runs on a 300 ms timer set as the app starts, and a timer set after
// that one, with the same delay, fires after it
export async function welcomeDecided(page) {
  await page.waitForFunction(() => !!window.__pantry?.S);
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
}

// ---- the welcome ----
export const welcomeSheet = page => page.locator('dialog.ha-sheet.pa-wsheet[open]');
export const card = (page, title) => expect(welcomeSheet(page).locator('.pa-wtitle')).toHaveText(new RegExp(`^(Step \\d+ of \\d+: )?${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
export const nextCard = page => welcomeSheet(page).locator('[data-pa-w="next"]').click();

// ---- the pantry's own state ----
export const live = page => page.evaluate(() => [...window.__pantry.S.items.values()].filter(i => !i.removedAt).length);
export const itemNamed = (page, name) => page.evaluate(n => [...window.__pantry.S.items.values()].find(i => i.name === n) || null, name);
export const idOf = (page, name) => page.evaluate(n => [...window.__pantry.S.items.values()].find(i => i.name === n)?.id, name);
export const itemById = (page, id) => page.evaluate(i => window.__pantry.S.items.get(i) || null, id);
export const qtyOf = (page, id) => page.evaluate(i => window.__pantry.S.items.get(i).batches.reduce((n, b) => n + b.qty, 0), id);

// ---- layout checks ----
export async function noSideways(page, what) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
  expect(r.sw, `${what}: no sideways scroll (scrollWidth ${r.sw} > ${r.w})`).toBeLessThanOrEqual(r.w);
}
export async function sheetFits(page, what) {
  const r = await sheetOpen(page).evaluate(d => ({ sw: d.querySelector('.ha-sheet-body').scrollWidth, cw: d.querySelector('.ha-sheet-body').clientWidth }));
  expect(r.sw, `${what}: no sideways scroll in the sheet`).toBeLessThanOrEqual(r.cw);
}
export const bigText = (page, on = true) => page.evaluate(on => { document.documentElement.style.fontSize = on ? '212.5%' : ''; }, on);
// the top bar's lead, title and trail never overlap (and the back button keeps a 44px target and its name)
export async function barApart(page, what) {
  const r = await page.evaluate(() => {
    const box = e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
    const title = document.querySelector('.ha-bar-title');
    const parts = [...document.querySelectorAll('.ha-bar-lead > *, .ha-bar-trail > *')].filter(e => e.getClientRects().length)
      .map(e => ({ side: e.closest('.ha-bar-lead') ? 'lead' : 'trail', ...box(e) }));
    const back = document.querySelector('.ha-back');
    return { title: title && title.textContent.trim() ? box(title) : null, parts, back: back && { ...box(back), name: back.textContent.trim() } };
  });
  const hit = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
  for (const p of r.parts) if (r.title) expect(hit(p, r.title), `${what}: bar ${p.side} (${Math.round(p.l)}-${Math.round(p.r)}) overlaps the title (${Math.round(r.title.l)}-${Math.round(r.title.r)})`).toBe(false);
  const lead = r.parts.filter(p => p.side === 'lead'), trail = r.parts.filter(p => p.side === 'trail');
  for (const a of lead) for (const b of trail) expect(hit(a, b), `${what}: bar lead overlaps the trail`).toBe(false);
  if (r.back) {
    expect(r.back.w >= 43.5 && r.back.h >= 43.5 && !!r.back.name, `${what}: back button keeps a 44px target and its name (${Math.round(r.back.w)}x${Math.round(r.back.h)} "${r.back.name}")`).toBe(true);
  }
}

// ---- screens ----
export const TAB = (page, h) => page.locator(`.ha-tabbar a[href="${h}"]`);
// Add (catalogue) -> Light soy sauce x2, a year; leaves the phone on the new item's screen
export async function addSoy(page) {
  await page.click('.ha-tab--action');
  await expect.poll(() => hash(page)).toBe('#/add');
  await page.fill('#pa-find', 'kikkoman soy');
  await page.locator('#pa-sugg [data-act="sugg"]').first().click();
  await expect(page.locator('#pa-form [name="name"]')).toHaveValue('Light soy sauce');
  await page.click('#pa-qty [data-step="1"]');
  await expect(page.locator('#pa-qty output')).toHaveText('2');
  await page.click('.pa-dates [data-act="date"]:has-text("1 year")');
  await expect(page.locator('#pa-form [name="expiry"]')).toHaveValue(ymdPlus(365));
  await page.click('#pa-save');
  await expect.poll(() => hash(page)).toMatch(/^#\/item\//);
  await expect(page.locator('h1')).toHaveText('Light soy sauce');
}
// the sample items from Settings (a pantry of about fourteen things), then back on Home
export async function sampleItems(page) {
  await go(page, '#/settings');
  await page.click('[data-act="sample"]');
  await expect(toast(page)).toContainText('sample items');
  await TAB(page, '#/').click();
  await expect.poll(() => hash(page)).toBe('#/');
}
// the section a heading id belongs to
export const sectionOf = (page, id) => page.locator(`#${id}`).locator('xpath=..');
