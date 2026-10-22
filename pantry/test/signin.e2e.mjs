// Signing in besides Google, against the local Firebase emulators (fake accounts, demo-pantry; never the live project):
//   - an emailed sign-in link (saved address, and a link opened where the address wasn't saved), then used twice
//   - email and password: Create account (weak password refused), the "Check your email" state with no family data
//     until the emailed link is tapped, "I've verified", Send it again, Sign in, a wrong password, Forgot password
// The Auth emulator keeps every emailed code at /emulator/v1/projects/demo-pantry/oobCodes; the test reads them there
// and "taps" the links.
// Run: pantry/test/run-sync.sh   (SHOTS=<dir> saves screenshots; AXE_PATH=<axe.min.js> adds an accessibility check)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');

const SHOTS = process.env.SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const AXE = process.env.AXE_PATH && fs.existsSync(process.env.AXE_PATH) ? fs.readFileSync(process.env.AXE_PATH, 'utf8') : null;
const srv = await serve();
const browser = await chromium.launch();
const url = srv.url + '/pantry/?emulator';
const errors = [];
const settle = p => p.waitForTimeout(450);
const shot = (p, name) => SHOTS ? p.screenshot({ path: path.join(SHOTS, name + '.png') }) : null;
const axe = async (p, what) => {
  if (!AXE) return;
  await p.evaluate(s => { if (!window.axe) (0, eval)(s); }, AXE);
  const r = await p.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] }));
  assert.deepEqual(r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(' | ')), [], 'axe: ' + what);
};

const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085'}/v1/projects/demo-pantry/databases/(default)/documents/`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
const val = v => typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : { mapValue: { fields: fields(v) } };
const fields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));
const seed = async (p, o) => { const r = await fetch(FS + p, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: fields(o) }) }); assert.ok(r.ok, 'seed ' + p); };
const codes = async (email, type) => (await (await fetch(`${AUTH}/emulator/v1/projects/demo-pantry/oobCodes`)).json()).oobCodes
  .filter(c => c.email === email && c.requestType === type);
// "tap" a link in an email: the emulator applies it (verify email, reset password) and sends the person on
const tap = async c => { const r = await fetch(c.oobLink, { redirect: 'manual' }); assert.ok(r.status < 400, 'tapped ' + c.requestType); };

async function phone(name, { signedOut = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(name + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
  return page;
}
const openSettings = async p => { await p.goto(url + '#/settings'); await p.waitForFunction(() => window.__pantry?.S && window.__pantry.signIn); await settle(p); };
const sheetOpen = p => p.locator('dialog.ha-sheet[open]');
const err = p => sheetOpen(p).locator('#pa-em-err');

try {
  // a family pantry with one item, for the three made-up email accounts
  await seed('households/hh-email', { name: 'Our pantry', owner: 'owner@example.com', members: ['owner@example.com', 'pw@example.com', 'link@example.com'], createdAt: '2026-10-16T00:00:00.000Z' });
  await seed('households/hh-email/items/secret', { id: 'secret', name: 'Secret kaya', batches: [] });

  // ---- the sign-in card: Google first, email as the quiet second way ----
  const a = await phone('pw');
  await openSettings(a);
  assert.equal((await a.locator('[data-act="signin"] .ha-row-title').textContent()).trim(), 'Continue with Google');
  const quiet = a.locator('[data-act="email-open"]');
  assert.equal((await quiet.textContent()).trim(), 'Use email instead');
  await shot(a, 'm01-signin');
  await axe(a, 'sign-in card');
  await quiet.click(); await settle(a);
  assert.equal(await sheetOpen(a).locator('.ha-sheet-title').textContent(), 'Sign in with email');
  assert.equal(await sheetOpen(a).locator('[data-pe="link"]').textContent(), 'Email me a sign-in link');
  assert.equal(await sheetOpen(a).locator('[data-pe="pw"]').textContent(), 'Use a password');
  await shot(a, 'm02-email-sheet');
  await axe(a, 'email sheet');

  // nothing typed: plain words, nothing raw
  await sheetOpen(a).locator('[data-pe="link"]').click();
  await err(a).waitFor({ state: 'visible' });
  assert.equal((await err(a).textContent()).trim(), 'Type your email address first.');
  await a.fill('#pa-em-email', 'not an email');
  await sheetOpen(a).locator('[data-pe="link"]').click();
  await a.waitForFunction(() => /look like an email/.test(document.querySelector('#pa-em-err')?.textContent || ''));

  // ---- password: Create account ----
  await a.fill('#pa-em-email', 'PW@example.com');
  await sheetOpen(a).locator('[data-pe="pw"]').click(); await settle(a);
  assert.equal(await a.inputValue('#pa-em-email'), 'PW@example.com', 'the email carries over');
  await shot(a, 'm04-password');
  await axe(a, 'password step');
  await a.fill('#pa-em-pass', 'short');
  await sheetOpen(a).locator('[data-pe="create"]').click();
  await a.waitForFunction(() => /at least 8 characters/.test(document.querySelector('#pa-em-err')?.textContent || ''));
  await a.fill('#pa-em-pass', 'goodpass123');
  await sheetOpen(a).locator('[data-pe="create"]').click();
  await a.locator('#main [data-act="verified"]').waitFor();
  await settle(a);
  assert.equal(await sheetOpen(a).count(), 0, 'the sheet closed');
  // unverified: the verify state, no family data, never "signed in"
  const pend = () => a.evaluate(() => { const S = window.__pantry.S; return { user: S.user, pending: S.pending?.email, household: S.household?.id || null, items: S.items.size, mode: S.mode }; });
  assert.deepEqual(await pend(), { user: null, pending: 'pw@example.com', household: null, items: 0, mode: 'local' });
  const main = await a.locator('#main').textContent();
  assert.match(main, /Check your email/);
  assert.match(main, /pw@example\.com/);
  assert.doesNotMatch(main, /Secret kaya|Our pantry/);
  assert.equal(await a.locator('[data-act="hh-create"], [data-act="signout"]:not(:has-text("Use a different email"))').count(), 0, 'no way to start a family pantry before verifying');
  await shot(a, 'm05-verify');
  await axe(a, 'verify state');
  assert.equal((await codes('pw@example.com', 'VERIFY_EMAIL')).length, 1, 'a verification email was sent');
  // a reload while unverified stays in the same state
  await a.reload(); await a.waitForFunction(() => window.__pantry?.S); await a.locator('#main [data-act="verified"]').waitFor();
  assert.equal((await pend()).household, null);
  // "I've verified" too early: asked to tap the link first
  await a.click('[data-act="verified"]');
  await a.locator('.ha-toast', { hasText: 'Not yet' }).waitFor();
  assert.equal((await pend()).household, null);
  // Send it again
  await a.click('[data-act="verify-resend"]');
  await a.locator('.ha-toast', { hasText: 'Sent again' }).waitFor();
  const verifyCodes = await codes('pw@example.com', 'VERIFY_EMAIL');
  assert.equal(verifyCodes.length, 2, 'sent again');
  // tap the link, come back, "I've verified": the family pantry opens
  await tap(verifyCodes[verifyCodes.length - 1]);
  await a.click('[data-act="verified"]');
  await a.waitForFunction(() => window.__pantry.S.household?.id === 'hh-email');
  await a.waitForFunction(() => [...window.__pantry.S.items.values()].some(i => i.name === 'Secret kaya'));
  assert.deepEqual(await pend().then(x => [x.user.email, x.user.verified, x.pending, x.mode]), ['pw@example.com', true, undefined, 'cloud']);

  // ---- sign out, then Sign in with the password: wrong, then right ----
  await a.click('[data-act="signout"]'); await a.locator('[data-act="email-open"]').waitFor();
  await a.click('[data-act="email-open"]'); await settle(a);
  await a.fill('#pa-em-email', 'pw@example.com');
  await sheetOpen(a).locator('[data-pe="pw"]').click();
  await a.fill('#pa-em-pass', 'not-the-password');
  await sheetOpen(a).locator('button[type=submit]').click();
  await a.waitForFunction(() => /don’t match/.test(document.querySelector('#pa-em-err')?.textContent || ''));
  assert.doesNotMatch(await err(a).textContent(), /auth\/|Firebase/);
  assert.equal((await pend()).user, null);
  // an account that doesn't exist: plain words too
  await a.fill('#pa-em-email', 'nobody@example.com');
  await a.fill('#pa-em-pass', 'whatever123');
  await sheetOpen(a).locator('button[type=submit]').click();
  await a.waitForFunction(() => /no account with that email|don’t match/.test(document.querySelector('#pa-em-err')?.textContent || ''));
  // Forgot password sends a reset link
  await a.fill('#pa-em-email', 'pw@example.com');
  await sheetOpen(a).locator('[data-pe="forgot"]').click();
  await sheetOpen(a).locator('.pa-em-title', { hasText: 'Check your email' }).waitFor();
  assert.equal((await codes('pw@example.com', 'PASSWORD_RESET')).length, 1, 'a reset email was sent');
  await sheetOpen(a).locator('[data-pe="pw"]').click(); await settle(a);
  await a.fill('#pa-em-pass', 'goodpass123');
  await a.press('#pa-em-pass', 'Enter');
  await a.waitForFunction(() => window.__pantry.S.household?.id === 'hh-email').catch(async e => { console.log(await a.evaluate(() => JSON.stringify({ err: document.querySelector('#pa-em-err')?.textContent, sheet: !!document.querySelector('dialog[open]'), user: window.__pantry.S.user, pend: window.__pantry.S.pending }))); throw e; });
  assert.equal(await sheetOpen(a).count(), 0);

  // ---- email link: asked for here, opened here ----
  const b = await phone('link');
  await openSettings(b);
  await b.click('[data-act="email-open"]'); await settle(b);
  await b.fill('#pa-em-email', 'Link@Example.com');
  await b.press('#pa-em-email', 'Enter');
  await sheetOpen(b).locator('.pa-em-title', { hasText: 'Check your email' }).waitFor();
  const sent = await sheetOpen(b).locator('.pa-em-note').textContent();
  assert.match(sent, /link@example\.com/);
  assert.match(sent, /iPhone/); assert.match(sent, /Safari/); assert.match(sent, /use a password instead/);
  await shot(b, 'm03-link-sent');
  await axe(b, 'link sent');
  assert.equal(await b.evaluate(() => JSON.parse(localStorage.getItem('pantry:emailForSignIn'))), 'link@example.com');
  let [signin] = await codes('link@example.com', 'EMAIL_SIGNIN');
  assert.ok(signin, 'a sign-in link was sent');
  const linkQuery = c => new URL(c.oobLink).searchParams;
  const open = async (p, c, hash = '#/settings') => {
    const q = linkQuery(c);
    await p.goto(`${url}&apiKey=${q.get('apiKey')}&oobCode=${q.get('oobCode')}&mode=signIn&lang=en${hash}`);
    await p.waitForFunction(() => window.__pantry?.S);
  };
  await open(b, signin);
  await b.waitForFunction(() => window.__pantry.S.household?.id === 'hh-email');
  assert.equal(await b.evaluate(() => window.__pantry.S.user.email), 'link@example.com');
  assert.equal(new URL(b.url()).search, '?emulator', 'the link’s query comes off the address: ' + b.url());
  assert.equal(await b.evaluate(() => localStorage.getItem('pantry:emailForSignIn')), null, 'the saved address is cleared');
  // the same link again: used already; plain words, and the address is clean
  await b.click('[data-act="signout"]'); await b.locator('[data-act="email-open"]').waitFor();
  await open(b, signin);
  await sheetOpen(b).locator('.ha-sheet-title', { hasText: 'Finish signing in' }).waitFor();   // nothing saved any more: asks
  await b.fill('#pa-em-email', 'link@example.com');
  await b.press('#pa-em-email', 'Enter');
  await b.locator('.ha-toast', { hasText: /expired or was already used|isn’t valid any more/ }).waitFor();
  assert.equal(await b.evaluate(() => window.__pantry.S.user), null);
  assert.equal(new URL(b.url()).search, '?emulator');

  // ---- email link opened somewhere the address wasn't saved (Safari instead of the home-screen app) ----
  await b.click('[data-act="email-open"]'); await settle(b);
  await b.fill('#pa-em-email', 'link@example.com');
  await b.press('#pa-em-email', 'Enter');
  await sheetOpen(b).locator('.pa-em-title').waitFor();
  const all = await codes('link@example.com', 'EMAIL_SIGNIN');
  const c = await phone('other');
  await open(c, all[all.length - 1]);
  await sheetOpen(c).locator('.ha-sheet-title', { hasText: 'Finish signing in' }).waitFor();
  await settle(c);
  assert.match(new URL(c.url()).search, /oobCode/, 'the link stays until it is used');
  await axe(c, 'confirm email');
  await c.fill('#pa-em-email', 'someone.else@example.com');
  await c.press('#pa-em-email', 'Enter');
  await c.waitForFunction(() => /isn’t the email the link was sent to/.test(document.querySelector('#pa-em-err')?.textContent || ''));
  assert.equal(await c.evaluate(() => window.__pantry.S.user), null);
  await c.fill('#pa-em-email', 'link@example.com');
  await c.press('#pa-em-email', 'Enter');
  await c.waitForFunction(() => window.__pantry.S.household?.id === 'hh-email');
  assert.equal(await sheetOpen(c).count(), 0);
  assert.equal(new URL(c.url()).search, '?emulator');

  // an outsider who signs in by email sees no family: not in any pantry
  const d = await phone('outsider');
  await openSettings(d);
  await d.click('[data-act="email-open"]'); await settle(d);
  await d.fill('#pa-em-email', 'outsider@example.com');
  await sheetOpen(d).locator('[data-pe="pw"]').click();
  await d.fill('#pa-em-pass', 'goodpass123');
  await sheetOpen(d).locator('[data-pe="create"]').click();
  await d.locator('#main [data-act="verified"]').waitFor();
  const [vc] = await codes('outsider@example.com', 'VERIFY_EMAIL');
  await tap(vc);
  await d.click('[data-act="verified"]');
  await d.locator('#main [data-act="hh-create"]').waitFor();
  assert.equal(await d.evaluate(() => window.__pantry.S.items.size), 0);

  assert.deepEqual(errors, []);
  console.log('pantry sign-in e2e: ok');
} finally {
  await browser.close();
  srv.close();
}
