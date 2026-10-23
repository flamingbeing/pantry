// Signing in besides Google, against the local Firebase emulators (fake accounts, demo-pantry; never the live project):
//   - an emailed sign-in link (saved address, and a link opened where the address wasn't saved), then used twice
//   - email and password: Create account (weak password refused), the "Check your email" state with no family data
//     until the emailed link is tapped, "I've verified", Send it again, Sign in, a wrong password, Forgot password
// The Auth emulator keeps every emailed code; oob.codes reads them and oob.tap "taps" the links. Each test makes its own
// accounts and family pantry (uid), so the tests run in any order and side by side.
// Run: npx playwright test signin
import { test, expect } from './fixtures.mjs';

const TAGS = ['wcag2a', 'wcag2aa'];
const sheet = p => p.locator('dialog.ha-sheet[open]');
const err = p => sheet(p).locator('#pa-em-err');
const S = p => p.evaluate(() => { const s = window.__pantry.S; return { user: s.user, pending: s.pending?.email, household: s.household?.id || null, items: s.items.size, mode: s.mode }; });
const inFamily = (p, hid) => p.waitForFunction(h => window.__pantry.S.household?.id === h, hid);

async function settings(phone, name) {
  const p = await phone(name, { url: '/pantry/?emulator#/settings' });
  await p.waitForFunction(() => window.__pantry?.S && window.__pantry.signIn);
  await expect(p.locator('[data-act="email-open"]')).toBeVisible();
  return p;
}
async function openEmailSheet(p) {
  await p.locator('[data-act="email-open"]').click();
  await expect(sheet(p).locator('.ha-sheet-title')).toBeVisible();
}
// a family pantry with one item, for this test's own made-up accounts
async function family(fsAdmin, uid, members) {
  const hid = 'hh-' + uid;
  await fsAdmin.put(`households/${hid}`, { name: 'Our pantry', owner: `owner-${uid}@example.com`, members: [`owner-${uid}@example.com`, ...members], createdAt: '2026-10-16T00:00:00.000Z' });
  await fsAdmin.put(`households/${hid}/items/secret`, { id: 'secret', name: 'Secret kaya', batches: [] });
  return hid;
}
// open an emailed sign-in link on this phone
async function openLink(p, c, hash = '#/settings') {
  const q = new URL(c.oobLink).searchParams;
  await p.goto(`/pantry/?emulator&apiKey=${q.get('apiKey')}&oobCode=${q.get('oobCode')}&mode=signIn&lang=en${hash}`);
  await p.waitForFunction(() => window.__pantry?.S);
}

test('the sign-in card: Google first, email as the quiet second way, plain words for bad input', async ({ phone, axe }) => {
  const a = await settings(phone, 'card');
  await expect(a.locator('[data-act="signin"] .ha-row-title')).toHaveText('Continue with Google');
  await expect(a.locator('[data-act="email-open"]')).toHaveText('Use email instead');
  await axe(a, 'sign-in card', TAGS);
  await openEmailSheet(a);
  await expect(sheet(a).locator('.ha-sheet-title')).toHaveText('Sign in with email');
  await expect(sheet(a).locator('[data-pe="link"]')).toHaveText('Email me a sign-in link');
  await expect(sheet(a).locator('[data-pe="pw"]')).toHaveText('Use a password');
  await axe(a, 'email sheet', TAGS);
  // nothing typed, then not an email
  await sheet(a).locator('[data-pe="link"]').click();
  await expect(err(a)).toHaveText('Type your email address first.');
  await a.fill('#pa-em-email', 'not an email');
  await sheet(a).locator('[data-pe="link"]').click();
  await expect(err(a)).toContainText('look like an email');
});

test('password: create account, verify by email, sign out and in, wrong password, forgot password', async ({ phone, axe, fsAdmin, oob, uid }) => {
  const email = `pw-${uid}@example.com`;
  const hid = await family(fsAdmin, uid, [email]);
  const a = await settings(phone, 'pw');
  await openEmailSheet(a);
  await a.fill('#pa-em-email', `PW-${uid}@example.com`);
  await sheet(a).locator('[data-pe="pw"]').click();
  await expect(a.locator('#pa-em-pass')).toBeVisible();
  await expect(a.locator('#pa-em-email'), 'the email carries over').toHaveValue(`PW-${uid}@example.com`);
  await axe(a, 'password step', TAGS);
  await a.fill('#pa-em-pass', 'short');
  await sheet(a).locator('[data-pe="create"]').click();
  await expect(err(a)).toContainText('at least 8 characters');
  await a.fill('#pa-em-pass', 'goodpass123');
  await sheet(a).locator('[data-pe="create"]').click();
  await expect(a.locator('#main [data-act="verified"]')).toBeVisible();
  await expect(sheet(a), 'the sheet closed').toHaveCount(0);

  // unverified: the verify state, no family data, never "signed in"
  expect(await S(a)).toEqual({ user: null, pending: email, household: null, items: 0, mode: 'local' });
  await expect(a.locator('#main')).toContainText('Check your email');
  await expect(a.locator('#main')).toContainText(email);
  await expect(a.locator('#main')).not.toContainText(/Secret kaya|Our pantry/);
  await expect(a.locator('[data-act="hh-create"], [data-act="signout"]:not(:has-text("Use a different email"))'), 'no way to start a family pantry before verifying').toHaveCount(0);
  await axe(a, 'verify state', TAGS);
  await expect.poll(async () => (await oob.codes(email, 'VERIFY_EMAIL')).length, { message: 'a verification email was sent' }).toBe(1);
  // a reload while unverified stays in the same state
  await a.reload();
  await expect(a.locator('#main [data-act="verified"]')).toBeVisible();
  expect((await S(a)).household).toBeNull();
  // "I've verified" too early: asked to tap the link first
  await a.click('[data-act="verified"]');
  await expect(a.locator('.ha-toast', { hasText: 'Not yet' })).toBeVisible();
  expect((await S(a)).household).toBeNull();
  // Send it again
  await a.click('[data-act="verify-resend"]');
  await expect(a.locator('.ha-toast', { hasText: 'Sent again' })).toBeVisible();
  await expect.poll(async () => (await oob.codes(email, 'VERIFY_EMAIL')).length, { message: 'sent again' }).toBe(2);
  // tap the link, come back, "I've verified": the family pantry opens
  await oob.tap((await oob.codes(email, 'VERIFY_EMAIL')).at(-1));
  await a.click('[data-act="verified"]');
  await inFamily(a, hid);
  await a.waitForFunction(() => [...window.__pantry.S.items.values()].some(i => i.name === 'Secret kaya'));
  const s = await S(a);
  expect([s.user.email, s.user.verified, s.pending, s.mode]).toEqual([email, true, undefined, 'cloud']);

  // sign out, then Sign in with the password: wrong, then right
  await a.click('[data-act="signout"]');
  await openEmailSheet(a);
  await a.fill('#pa-em-email', email);
  await sheet(a).locator('[data-pe="pw"]').click();
  await a.fill('#pa-em-pass', 'not-the-password');
  await sheet(a).locator('button[type=submit]').click();
  await expect(err(a)).toContainText('don’t match');
  await expect(err(a)).not.toContainText(/auth\/|Firebase/);
  expect((await S(a)).user).toBeNull();
  // an account that doesn't exist: plain words too
  await a.fill('#pa-em-email', `nobody-${uid}@example.com`);
  await a.fill('#pa-em-pass', 'whatever123');
  await sheet(a).locator('button[type=submit]').click();
  await expect(err(a)).toContainText(/no account with that email|don’t match/);
  // Forgot password sends a reset link
  await a.fill('#pa-em-email', email);
  await sheet(a).locator('[data-pe="forgot"]').click();
  await expect(sheet(a).locator('.pa-em-title', { hasText: 'Check your email' })).toBeVisible();
  await expect.poll(async () => (await oob.codes(email, 'PASSWORD_RESET')).length, { message: 'a reset email was sent' }).toBe(1);
  await sheet(a).locator('[data-pe="pw"]').click();
  await a.fill('#pa-em-pass', 'goodpass123');
  await a.press('#pa-em-pass', 'Enter');
  await inFamily(a, hid);
  await expect(sheet(a)).toHaveCount(0);
});

test('email link: asked for here, opened here, then used a second time', async ({ phone, axe, fsAdmin, oob, uid }) => {
  const email = `link-${uid}@example.com`;
  const hid = await family(fsAdmin, uid, [email]);
  const b = await settings(phone, 'link');
  await openEmailSheet(b);
  await b.fill('#pa-em-email', `Link-${uid}@Example.com`);
  await b.press('#pa-em-email', 'Enter');
  const note = sheet(b).locator('.pa-em-note');
  await expect(sheet(b).locator('.pa-em-title', { hasText: 'Check your email' })).toBeVisible();
  await expect(note).toContainText(email);
  for (const w of ['iPhone', 'Safari', 'use a password instead']) await expect(note).toContainText(w);
  await axe(b, 'link sent', TAGS);
  expect(await b.evaluate(() => JSON.parse(localStorage.getItem('pantry:emailForSignIn')))).toBe(email);
  await expect.poll(async () => (await oob.codes(email, 'EMAIL_SIGNIN')).length, { message: 'a sign-in link was sent' }).toBe(1);
  const [signin] = await oob.codes(email, 'EMAIL_SIGNIN');
  await openLink(b, signin);
  await inFamily(b, hid);
  expect(await b.evaluate(() => window.__pantry.S.user.email)).toBe(email);
  await expect.poll(() => new URL(b.url()).search, { message: 'the link’s query comes off the address' }).toBe('?emulator');
  expect(await b.evaluate(() => localStorage.getItem('pantry:emailForSignIn')), 'the saved address is cleared').toBeNull();

  // the same link again: used already; plain words, and the address is clean
  await b.click('[data-act="signout"]');
  await expect(b.locator('[data-act="email-open"]')).toBeVisible();
  await openLink(b, signin);
  await expect(sheet(b).locator('.ha-sheet-title', { hasText: 'Finish signing in' })).toBeVisible();   // nothing saved any more: asks
  await b.fill('#pa-em-email', email);
  await b.press('#pa-em-email', 'Enter');
  await expect(b.locator('.ha-toast', { hasText: /expired or was already used|isn’t valid any more/ })).toBeVisible();
  expect(await b.evaluate(() => window.__pantry.S.user)).toBeNull();
  await expect.poll(() => new URL(b.url()).search).toBe('?emulator');
});

test('email link opened where the address wasn’t saved (Safari instead of the home-screen app)', async ({ phone, axe, fsAdmin, oob, uid }) => {
  const email = `away-${uid}@example.com`;
  const hid = await family(fsAdmin, uid, [email]);
  const b = await settings(phone, 'asks');
  await openEmailSheet(b);
  await b.fill('#pa-em-email', email);
  await b.press('#pa-em-email', 'Enter');
  await expect(sheet(b).locator('.pa-em-title')).toBeVisible();
  await expect.poll(async () => (await oob.codes(email, 'EMAIL_SIGNIN')).length).toBe(1);
  const [link] = await oob.codes(email, 'EMAIL_SIGNIN');
  const c = await phone('other');
  await openLink(c, link);
  await expect(sheet(c).locator('.ha-sheet-title', { hasText: 'Finish signing in' })).toBeVisible();
  expect(new URL(c.url()).search, 'the link stays until it is used').toMatch(/oobCode/);
  await axe(c, 'confirm email', TAGS);
  await c.fill('#pa-em-email', `someone.else-${uid}@example.com`);
  await c.press('#pa-em-email', 'Enter');
  await expect(err(c)).toContainText('isn’t the email the link was sent to');
  expect(await c.evaluate(() => window.__pantry.S.user)).toBeNull();
  await c.fill('#pa-em-email', email);
  await c.press('#pa-em-email', 'Enter');
  await inFamily(c, hid);
  await expect(sheet(c)).toHaveCount(0);
  await expect.poll(() => new URL(c.url()).search).toBe('?emulator');
});

test('an outsider who signs in by email sees no family', async ({ phone, oob, uid }) => {
  const email = `outsider-${uid}@example.com`;
  const d = await settings(phone, 'outsider');
  await openEmailSheet(d);
  await d.fill('#pa-em-email', email);
  await sheet(d).locator('[data-pe="pw"]').click();
  await d.fill('#pa-em-pass', 'goodpass123');
  await sheet(d).locator('[data-pe="create"]').click();
  await expect(d.locator('#main [data-act="verified"]')).toBeVisible();
  await expect.poll(async () => (await oob.codes(email, 'VERIFY_EMAIL')).length).toBe(1);
  await oob.tap((await oob.codes(email, 'VERIFY_EMAIL'))[0]);
  await d.click('[data-act="verified"]');
  await expect(d.locator('#main [data-act="hh-create"]')).toBeVisible();
  expect(await d.evaluate(() => window.__pantry.S.items.size)).toBe(0);
});
