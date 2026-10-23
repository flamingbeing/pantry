// Shared fixtures for the pantry specs (playwright.config.mjs). Each test gets:
//   server   its own static server (serve.mjs): a fresh origin, srv.swOffline and srv.hits are this test's alone
//   uid      a short id unique to this test and repeat; put it in every email, household and item id the test makes
//   phone    phone(name, { url, init, ...contextOptions }) opens a 390px phone; page errors fail the test at the end
//   axe      axe(page, what, tags?) after finite animations settle; no violations allowed
//   fsAdmin  the Firestore emulator's admin door (put, get, list, del; skips the rules)
//   oob      the Auth emulator's emailed codes: oob.codes(email, type), oob.tap(code)
// Local emulators only (demo-pantry); never the live project.
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { serve } from '../serve.mjs';

export { expect };

const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
export const FS = `http://${FS_HOST}/v1/projects/demo-pantry/databases/(default)/documents/`;
const AUTH = `http://${AUTH_HOST}`;

const val = v => v === null ? { nullValue: null } : typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) }
  : typeof v === 'boolean' ? { booleanValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : { mapValue: { fields: fields(v) } };
const fields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));
const unval = v => 'stringValue' in v ? v.stringValue : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? v.doubleValue : 'nullValue' in v ? null : 'arrayValue' in v ? (v.arrayValue.values || []).map(unval) : 'mapValue' in v ? unfields(v.mapValue.fields || {}) : undefined;
const unfields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, unval(v)]));
const owner = { Authorization: 'Bearer owner' };
export const fsAdmin = {
  async put(path, o) { const r = await fetch(FS + path, { method: 'PATCH', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify({ fields: fields(o) }) }); expect(r.ok, 'seed ' + path).toBe(true); },
  async get(path) { const r = await fetch(FS + path, { headers: owner }); return r.ok ? unfields((await r.json()).fields || {}) : null; },
  async list(path) { const r = await fetch(FS + path + '?pageSize=300', { headers: owner }); const j = r.ok ? await r.json() : {}; return (j.documents || []).map(d => unfields(d.fields || {})); },
  async del(path) { const r = await fetch(FS + path, { method: 'DELETE', headers: owner }); expect(r.ok, 'delete ' + path).toBe(true); },
};
export const oob = {
  async codes(email, type) {
    const j = await (await fetch(`${AUTH}/emulator/v1/projects/demo-pantry/oobCodes`)).json();
    return (j.oobCodes || []).filter(c => c.email === email && c.requestType === type);
  },
  // "tap" a link in an email: the emulator applies it (verify email, reset password)
  async tap(c) { const r = await fetch(c.oobLink, { redirect: 'manual' }); expect(r.status, 'tapped ' + c.requestType).toBeLessThan(400); },
};

export async function axe(page, what, tags = AXE_TAGS) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
  // a toast or sheet still fading reads as low contrast: let running (finite) animations finish first, 3 s at most
  await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().filter(x => x.effect?.getComputedTiming().iterations !== Infinity).map(x => x.finished.catch(() => {}))), new Promise(r => setTimeout(r, 3000))]));
  const v = await page.evaluate(async t => (await window.axe.run(document, { runOnly: t }))
    .violations.map(x => `${x.id} (${x.impact}): ${x.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`), tags);
  expect(v, `${what}: axe violations`).toEqual([]);
}

export const test = base.extend({
  server: async ({}, use) => { const srv = await serve(); await use(srv); srv.close(); },
  uid: async ({}, use, info) => {
    await use(`${info.workerIndex}${info.repeatEachIndex}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toLowerCase());
  },
  phone: async ({ browser, server }, use) => {
    const ctxs = [], errors = [];
    await use(async (name, { url, init, ...opts } = {}) => {
      const ctx = await browser.newContext({ baseURL: server.url, viewport: { width: 390, height: 844 }, ...opts });
      ctxs.push(ctx);
      if (init) await ctx.addInitScript(init);
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
      page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
      if (url) await page.goto(url);
      return page;
    });
    await Promise.all(ctxs.map(c => c.close()));
    expect(errors, 'page errors').toEqual([]);
  },
  axe: async ({}, use) => use(axe),
  fsAdmin: async ({}, use) => use(fsAdmin),
  oob: async ({}, use) => use(oob),
});
