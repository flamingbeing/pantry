// Family sharing against the local Firebase emulators (fake accounts, demo-pantry project; never the live one):
// one person starts the pantry and adds another, both see each other's changes, an outsider sees nothing, the owner
// can't be removed, and signing out goes back to the phone's own pantry. Photos: members read and write photos/<id>,
// outsiders can't; thumbnails over 12 KB and photos over 150 KB are refused; no item may gain or change an old-style
// `photo` (keeping or removing one is fine); and an old-style item in the family pantry is moved by the app itself.
// Places: settings/places for members only (that id and fields only, at most 40 names of 1-40 characters), and a
// rename on one phone shows on the other, items included. Names: settings/people for members only (that id, exactly
// id/names/updatedAt, at most 20 names of 1-40 characters on one line, keyed by emails); a name given on one phone
// shows on the other, and signs that person's changes.
// Run: pantry/test/run-sync.sh
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';
import { placeId as Lgp } from '../js/places.js';
import { stallProxy } from './proxy.mjs';
import * as Ord from '../js/order.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright/index.mjs');

const srv = await serve();
const browser = await chromium.launch();
const url = srv.url + '/pantry/?emulator';
const errors = [];
const settle = p => p.waitForTimeout(400);
async function person(email, base = url, { init = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(email + ': ' + e.message));
  if (process.env.DEBUG) page.on('console', m => console.log(email, m.type(), m.text()));
  await page.goto(base + '#/settings');
  await page.waitForFunction(() => window.__pantry?.signIn);
  await page.evaluate(e => window.__pantry.signIn(e), email);
  await page.locator('#main', { hasText: email }).waitFor();
  return page;
}
// The emulator's admin door ("Bearer owner" skips the rules): seeds what today's rules no longer let anyone write.
const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085'}/v1/projects/demo-pantry/databases/(default)/documents/`;
const val = v => v === null ? { nullValue: null } : typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) }
  : typeof v === 'boolean' ? { booleanValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : { mapValue: { fields: fields(v) } };
const fields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));
const unval = v => 'stringValue' in v ? v.stringValue : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? v.doubleValue : 'nullValue' in v ? null : 'arrayValue' in v ? (v.arrayValue.values || []).map(unval) : 'mapValue' in v ? unfields(v.mapValue.fields || {}) : undefined;
const unfields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, unval(v)]));
const admin = {
  async put(path, o) { const r = await fetch(FS + path, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: fields(o) }) }); assert.ok(r.ok, 'seed ' + path); },
  async list(path) { const r = await fetch(FS + path + '?pageSize=100', { headers: { Authorization: 'Bearer owner' } }); const j = r.ok ? await r.json() : {}; return (j.documents || []).map(d => unfields(d.fields || {})); },
  async del(path) { const r = await fetch(FS + path, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } }); assert.ok(r.ok, 'delete ' + path); },
  async get(path) { const r = await fetch(FS + path, { headers: { Authorization: 'Bearer owner' } }); return r.ok ? unfields((await r.json()).fields || {}) : null; },
};

// axe on the screens Sync now and "Your pantry changed" add (when axe-core is installed: AXE_PATH, or npm install --no-save axe-core)
const AXE = (() => {
  try { return fs.readFileSync(process.env.AXE_PATH || createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8'); } catch { return null; }
})();
async function axe(page, what) {
  if (!AXE) return;
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }))
    .violations.map(x => `${x.id} (${x.impact}): ${x.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`));
  assert.equal(v.length, 0, `${what}: axe violations\n  ${v.join('\n  ')}`);
}
const SYNC_REFUSED = list => list.length;
const go = async (p, h) => { await p.evaluate(x => { location.hash = x; }, h); await settle(p); };
const sub = (p, name) => p.locator('#pa-items-list .ha-row', { hasText: name }).locator('.ha-row-sub');
try {
  const mum = await person('mum@example.com');
  await mum.click('[data-act="hh-create"]');
  await mum.locator('#main .ha-row-title', { hasText: 'Our pantry' }).waitFor();
  await mum.fill('#pa-member-email', 'Dad@Example.com');
  await mum.click('#pa-member-add button[type=submit]');
  await mum.locator('#main .ha-row-title', { hasText: 'dad@example.com' }).waitFor();
  // an invite from Mum's own mail app: the toast offers it, and Dad's contact sheet keeps it for later
  await mum.locator('.ha-toast-action', { hasText: 'Email invite' }).waitFor();
  await mum.click('[data-act="person"][data-v="dad@example.com"]'); await settle(mum);
  const card = mum.locator('dialog.ha-sheet[open]');
  assert.equal(await card.locator('.ha-sheet-title').textContent(), 'Family member');
  assert.equal(await card.locator('[data-pp="remove"]').count(), 1, 'Stop sharing on someone else');
  const invite = await card.locator('a', { hasText: 'Email an invite' }).getAttribute('href');
  assert.match(invite, /^mailto:dad%40example\.com\?subject=Our%20family%20pantry&body=/);
  assert.match(decodeURIComponent(invite), /Continue with Google \(or Use email instead\), using this email address \(dad@example\.com\)/);
  // name him: the list shows the name with the email underneath
  await mum.fill('#pa-person-name', '  Dad  ');
  await card.locator('button[type=submit]').click(); await settle(mum);
  await mum.locator('[data-act="person"][data-v="dad@example.com"] .ha-row-title', { hasText: 'Dad' }).waitFor();
  assert.match(await mum.locator('[data-act="person"][data-v="dad@example.com"] .ha-row-sub').textContent(), /dad@example\.com/);
  // the owner's own card: no Stop sharing
  await mum.click('[data-act="person"][data-v="mum@example.com"]'); await settle(mum);
  assert.equal(await mum.locator('dialog.ha-sheet[open] [data-pp="remove"]').count(), 0, 'the owner can’t be removed');
  await mum.click('dialog.ha-sheet[open] [data-ha-close]'); await settle(mum);
  assert.equal(await mum.inputValue('#pa-member-email'), '');
  await mum.click('[data-act="sample"]');
  await settle(mum);

  const dad = await person('dad@example.com');
  await dad.locator('#main .ha-row-title', { hasText: 'Our pantry' }).waitFor();
  // the name reached Dad's phone too, and his changes now carry it
  await dad.locator('[data-act="person"][data-v="dad@example.com"] .ha-row-title', { hasText: 'Dad' }).waitFor();
  await go(dad, '#/items');
  await dad.locator('#pa-items-list .ha-row', { hasText: 'Kaya' }).waitFor();
  // dad uses up the kaya; mum's screen follows
  await go(mum, '#/items');
  await sub(mum, 'Kaya').filter({ hasText: '1 left' }).waitFor();
  await dad.locator('#pa-items-list a.ha-row', { hasText: 'Kaya' }).click(); await settle(dad);
  await dad.locator('[data-act="use"]').first().click(); await settle(dad);
  await sub(mum, 'Kaya').filter({ hasText: 'None left' }).waitFor();
  // and the history says who
  const kaya = await mum.evaluate(() => [...window.__pantry.S.items.values()].find(i => i.name === 'Kaya').id);
  await go(mum, '#/item/' + kaya);
  await mum.locator('#main .ha-row-sub', { hasText: 'Dad' }).first().waitFor();

  // an outsider is not in any pantry and can't read or join this one
  const stranger = await person('stranger@example.com');
  await stranger.locator('[data-act="hh-create"]').waitFor();
  const hid = await mum.evaluate(() => window.__pantry.S.household.id);
  const denied = await stranger.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore();
    const out = [];
    for (const p of [['households', hid], ['households', hid, 'items', 'x']]) {
      try { await F.getDoc(F.doc(db, ...p)); out.push('read'); } catch (e) { out.push(e.code); }
    }
    try { await F.getDocs(F.collection(db, 'households', hid, 'items')); out.push('listed'); } catch (e) { out.push(e.code); }
    try { await F.updateDoc(F.doc(db, 'households', hid), { members: ['stranger@example.com', 'mum@example.com'] }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.setDoc(F.doc(db, 'households', 'fake'), { name: 'x', owner: 'mum@example.com', members: ['mum@example.com', 'stranger@example.com'] }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.setDoc(F.doc(db, 'households', hid, 'items', 'evil'), { id: 'evil', name: 'x' }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.getDoc(F.doc(db, 'households', hid, 'settings', 'people')); out.push('read'); } catch (e) { out.push(e.code); }
    try { await F.setDoc(F.doc(db, 'households', hid, 'settings', 'people'), { id: 'people', names: { 'stranger@example.com': 'x' }, updatedAt: 'x' }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.deleteDoc(F.doc(db, 'households', hid, 'settings', 'people')); out.push('deleted'); } catch (e) { out.push(e.code); }
    return out;
  }, hid);
  assert.deepEqual(denied, Array(9).fill('permission-denied'), 'outsider denied: ' + denied.join(', '));
  // names: only settings/people, exactly id/names/updatedAt, at most 20 names of 1-40 characters on one line, keyed by emails
  const peopleRules = await dad.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), d = id => F.doc(db, 'households', hid, 'settings', id);
    const out = {};
    const tryIt = async (name, fn) => { try { await fn(); out[name] = 'ok'; } catch (e) { out[name] = e.code; } };
    const doc = names => ({ id: 'people', names, updatedAt: 'x' });
    const many = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}@example.com`, String(i).padEnd(40, 'x')]));
    await tryIt('20 names of 40 characters', () => F.setDoc(d('people'), doc(many(20))));
    await tryIt('read', async () => { if (!(await F.getDoc(d('people'))).exists()) throw { code: 'missing' }; });
    await tryIt('no names', () => F.setDoc(d('people'), doc({})));
    await tryIt('21 names', () => F.setDoc(d('people'), doc(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}@example.com`, 'x'])))));
    await tryIt('a 41-character name', () => F.setDoc(d('people'), doc({ 'a@example.com': 'A', 'b@example.com': 'x'.repeat(41) })));
    await tryIt('an empty name', () => F.setDoc(d('people'), doc({ 'a@example.com': '' })));
    await tryIt('a name with a newline', () => F.setDoc(d('people'), doc({ 'a@example.com': 'Ah\nMei' })));
    await tryIt('a number', () => F.setDoc(d('people'), doc({ 'a@example.com': 3 })));
    await tryIt('a key that is not an email', () => F.setDoc(d('people'), doc({ 'Mum': 'Mum' })));
    await tryIt('not a map', () => F.setDoc(d('people'), doc(['Mum'])));
    await tryIt('another field', () => F.setDoc(d('people'), { ...doc({ 'a@example.com': 'A' }), colour: 'red' }));
    await tryIt('no updatedAt', () => F.setDoc(d('people'), { id: 'people', names: { 'a@example.com': 'A' } }));
    await tryIt('a mismatched id field', () => F.setDoc(d('people'), { id: 'places', names: {}, updatedAt: 'x' }));
    await tryIt('another id', () => F.setDoc(d('theme'), { id: 'people', names: {}, updatedAt: 'x' }));
    await tryIt('back to Dad', () => F.setDoc(d('people'), doc({ 'dad@example.com': 'Dad' })));
    return out;
  }, hid);
  assert.deepEqual(peopleRules, {
    '20 names of 40 characters': 'ok', read: 'ok', 'no names': 'ok', '21 names': 'permission-denied', 'a 41-character name': 'permission-denied',
    'an empty name': 'permission-denied', 'a name with a newline': 'permission-denied', 'a number': 'permission-denied',
    'a key that is not an email': 'permission-denied', 'not a map': 'permission-denied', 'another field': 'permission-denied',
    'no updatedAt': 'permission-denied', 'a mismatched id field': 'permission-denied', 'another id': 'permission-denied', 'back to Dad': 'ok',
  }, 'people rules');
  // dad can't remove the owner, or hand the pantry to himself
  const ownerKept = await dad.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const out = [];
    try { await F.updateDoc(F.doc(F.getFirestore(), 'households', hid), { members: ['dad@example.com'] }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.updateDoc(F.doc(F.getFirestore(), 'households', hid), { owner: 'dad@example.com' }); out.push('wrote'); } catch (e) { out.push(e.code); }
    return out;
  }, hid);
  assert.deepEqual(ownerKept, ['permission-denied', 'permission-denied']);

  // ---- photos: thumbnails on items, photos in photos/{id}, size caps, old-style photos ----
  const rules = await mum.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), d = (...p) => F.doc(db, 'households', hid, ...p);
    const out = {};
    const tryIt = async (name, fn) => { try { await fn(); out[name] = 'ok'; } catch (e) { out[name] = e.code; } };
    const item = (id, extra = {}) => ({ id, name: 'Rules ' + id, batches: [], ...extra });
    await tryIt('photo write', () => F.setDoc(d('photos', 'p1'), { id: 'p1', data: 'data:image/jpeg;base64,' + 'A'.repeat(100000), updatedAt: 'x' }));
    await tryIt('photo read', async () => { if (!(await F.getDoc(d('photos', 'p1'))).exists()) throw { code: 'missing' }; });
    await tryIt('photo over 150 KB', () => F.setDoc(d('photos', 'p2'), { id: 'p2', data: 'data:image/jpeg;base64,' + 'A'.repeat(153600) }));
    await tryIt('photo extra field', () => F.setDoc(d('photos', 'p3'), { id: 'p3', data: 'data:x', name: 'x' }));
    await tryIt('thumb 10 KB', () => F.setDoc(d('items', 't1'), item('t1', { thumb: 'data:image/jpeg;base64,' + 'A'.repeat(10000), hasPhoto: true })));
    await tryIt('thumb over 12 KB', () => F.setDoc(d('items', 't2'), item('t2', { thumb: 'A'.repeat(12289) })));
    await tryIt('new item with a photo', () => F.setDoc(d('items', 't3'), item('t3', { photo: 'data:image/jpeg;base64,AAAA' })));
    await tryIt('new item with an empty photo', () => F.setDoc(d('items', 't4'), item('t4', { photo: '' })));
    await tryIt('item gains a photo', () => F.setDoc(d('items', 't1'), item('t1', { photo: 'data:image/jpeg;base64,AAAA' })));
    await tryIt('item gains a photo (merge)', () => F.updateDoc(d('items', 't4'), { photo: 'data:image/jpeg;base64,AAAA' }));
    return out;
  }, hid);
  assert.deepEqual(rules, {
    'photo write': 'ok', 'photo read': 'ok', 'photo over 150 KB': 'permission-denied', 'photo extra field': 'permission-denied',
    'thumb 10 KB': 'ok', 'thumb over 12 KB': 'permission-denied', 'new item with a photo': 'permission-denied',
    'new item with an empty photo': 'ok', 'item gains a photo': 'permission-denied', 'item gains a photo (merge)': 'permission-denied',
  });
  // an old-style item (seeded past the rules; its picture can't be read, so the app leaves it alone): it can still be
  // edited with its photo unchanged, its photo can't be changed, and it can be removed
  const OLD = 'data:image/jpeg;base64,' + 'B'.repeat(200000);
  await admin.put(`households/${hid}/items/old1`, { id: 'old1', name: 'Old one', batches: [], photo: OLD });
  await settle(mum);
  const old = await mum.evaluate(async ([hid, OLD]) => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const ref = F.doc(F.getFirestore(), 'households', hid, 'items', 'old1');
    const out = [];
    for (const data of [{ id: 'old1', name: 'Old one, renamed', batches: [], photo: OLD }, { id: 'old1', name: 'x', batches: [], photo: OLD + 'C' }, { id: 'old1', name: 'Old one, renamed', batches: [] }]) {
      try { await F.setDoc(ref, data); out.push('ok'); } catch (e) { out.push(e.code); }
    }
    return out;
  }, [hid, OLD]);
  assert.deepEqual(old, ['ok', 'permission-denied', 'ok'], 'old-style photo: kept, changed, removed');
  // an outsider can't read, list or write photos
  const outsider = await stranger.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), out = [];
    try { await F.getDoc(F.doc(db, 'households', hid, 'photos', 'p1')); out.push('read'); } catch (e) { out.push(e.code); }
    try { await F.getDocs(F.collection(db, 'households', hid, 'photos')); out.push('listed'); } catch (e) { out.push(e.code); }
    try { await F.setDoc(F.doc(db, 'households', hid, 'photos', 'p9'), { id: 'p9', data: 'data:x' }); out.push('wrote'); } catch (e) { out.push(e.code); }
    return out;
  }, hid);
  assert.deepEqual(outsider, Array(3).fill('permission-denied'), 'outsider and photos: ' + outsider.join(', '));
  // the app moves a real old-style photo by itself: photo first, then the item keeps only a thumbnail
  const real = await mum.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 480; c.height = 360; const g = c.getContext('2d');
    g.fillStyle = '#c33'; g.fillRect(0, 0, 480, 360); g.fillStyle = '#fff'; g.fillRect(60, 60, 200, 120);
    return c.toDataURL('image/jpeg', 0.72);
  });
  await admin.put(`households/${hid}/items/old2`, { id: 'old2', name: 'Old photo', batches: [], photo: real, createdBy: 'mum' });
  let moved = null;
  for (let i = 0; i < 40 && !(moved && moved.hasPhoto && !('photo' in moved)); i++) { await settle(mum); moved = await admin.get(`households/${hid}/items/old2`); }
  assert.ok(moved && moved.hasPhoto === true && !('photo' in moved) && moved.thumb.startsWith('data:image/jpeg') && moved.thumb.length <= 12288, 'the old item now holds a thumbnail only');
  assert.equal(moved.name, 'Old photo');
  assert.equal((await admin.get(`households/${hid}/photos/old2`))?.data, real, 'its photo moved to photos/old2 unchanged');
  // and the family sees it: dad's list shows the thumbnail, his item screen the photo
  await go(dad, '#/items');
  await dad.waitForFunction(t => [...document.querySelectorAll('#pa-items-list img.ha-row-thumb')].some(i => i.getAttribute('src') === t), moved.thumb);
  await go(dad, '#/item/old2');
  await dad.waitForFunction(d => document.querySelector('#pa-hero')?.src === d, real);
  // deleting an item in the app hides it (a marker) and keeps its photo until the sweep purges it after 30 days
  await dad.click('[data-act="delete"]'); await settle(dad); await settle(dad);
  assert.equal(typeof (await admin.get(`households/${hid}/items/old2`)).removedAt, 'string', 'deleting the item marks it');
  assert.equal((await admin.get(`households/${hid}/photos/old2`))?.data, real, 'its photo stays until it is purged');

  // ---- places: settings/places is members-only, only that id, only id/list/updatedAt, at most 40 names of 1-40 characters ----
  const placeRules = await mum.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), d = id => F.doc(db, 'households', hid, 'settings', id);
    const out = {};
    const tryIt = async (name, fn) => { try { await fn(); out[name] = 'ok'; } catch (e) { out[name] = e.code; } };
    const doc = list => ({ id: 'places', list, updatedAt: 'x' });
    await tryIt('40 places of 40 characters', () => F.setDoc(d('places'), doc(Array.from({ length: 40 }, (_, i) => String(i).padEnd(40, 'x')))));
    await tryIt('read', async () => { if (!(await F.getDoc(d('places'))).exists()) throw { code: 'missing' }; });
    await tryIt('41 places', () => F.setDoc(d('places'), doc(Array.from({ length: 41 }, (_, i) => 'P' + i))));
    await tryIt('a 41-character name', () => F.setDoc(d('places'), doc(['Fridge', 'x'.repeat(41)])));
    await tryIt('a long name at the end', () => F.setDoc(d('places'), doc([...Array.from({ length: 39 }, (_, i) => 'P' + i), 'x'.repeat(41)])));
    await tryIt('an empty name', () => F.setDoc(d('places'), doc(['Fridge', ''])));
    await tryIt('a name with a newline', () => F.setDoc(d('places'), doc(['x'.repeat(30) + '\n' + 'x'.repeat(30)])));
    await tryIt('a number', () => F.setDoc(d('places'), doc(['Fridge', 3])));
    await tryIt('no places', () => F.setDoc(d('places'), doc([])));
    await tryIt('not a list', () => F.setDoc(d('places'), doc('Fridge')));
    await tryIt('another field', () => F.setDoc(d('places'), { ...doc(['Fridge']), colour: 'red' }));
    await tryIt('another id', () => F.setDoc(d('theme'), { id: 'places', list: ['Fridge'], updatedAt: 'x' }));
    await tryIt('a mismatched id field', () => F.setDoc(d('places'), { id: 'theme', list: ['Fridge'], updatedAt: 'x' }));
    return out;
  }, hid);
  assert.deepEqual(placeRules, {
    '40 places of 40 characters': 'ok', read: 'ok', '41 places': 'permission-denied', 'a 41-character name': 'permission-denied',
    'a long name at the end': 'permission-denied', 'an empty name': 'permission-denied', 'a name with a newline': 'permission-denied', 'a number': 'permission-denied',
    'no places': 'permission-denied', 'not a list': 'permission-denied', 'another field': 'permission-denied',
    'another id': 'permission-denied', 'a mismatched id field': 'permission-denied',
  });
  const outsiderPlaces = await stranger.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), out = [];
    try { await F.getDoc(F.doc(db, 'households', hid, 'settings', 'places')); out.push('read'); } catch (e) { out.push(e.code); }
    try { await F.setDoc(F.doc(db, 'households', hid, 'settings', 'places'), { id: 'places', list: ['Mine'], updatedAt: 'x' }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.deleteDoc(F.doc(db, 'households', hid, 'settings', 'places')); out.push('deleted'); } catch (e) { out.push(e.code); }
    return out;
  }, hid);
  assert.deepEqual(outsiderPlaces, Array(3).fill('permission-denied'), 'outsider and places: ' + outsiderPlaces.join(', '));
  // back to a real list, then mum renames a place in the app and dad's phone follows (list and items)
  await mum.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    await F.deleteDoc(F.doc(F.getFirestore(), 'households', hid, 'settings', 'places'));
  }, hid);
  await settle(mum); await settle(dad);
  await go(mum, '#/places');
  await mum.locator('[data-act="place-open"][data-v="Fridge"]').click(); await settle(mum);
  await mum.fill('#pa-pl-name', 'Kitchen fridge');
  await mum.locator('#pa-pl-form button[type=submit]').click(); await settle(mum);
  await go(dad, '#/places');
  await dad.locator('[data-act="place-open"][data-v="Kitchen fridge"]').waitFor();
  assert.equal(await dad.locator('[data-act="place-open"][data-v="Fridge"]').count(), 0, 'dad sees the rename');
  const dadSees = await dad.evaluate(() => [...window.__pantry.S.items.values()].filter(i => /fridge/i.test(i.location || '')).map(i => i.location));
  assert.ok(dadSees.length && dadSees.every(l => l === 'Kitchen fridge'), 'and his items moved with it: ' + dadSees.join(', '));
  // (PR-C: every place is a document of its own; the first change wrote the defaults as documents, and the rename is one field)
  const placeDocs = (await admin.list(`households/${hid}/places`)).sort((a, b) => a.order - b.order);
  assert.deepEqual(placeDocs.map(d => d.name).slice(0, 3), ['Kitchen cabinet', 'Kitchen fridge', 'Level 1 fridge'], 'the defaults became place documents, the rename kept its position');
  assert.equal(placeDocs.length, 11, 'one document each, none twice');
  assert.deepEqual(Object.keys(placeDocs[1]).sort(), ['id', 'name', 'order', 'updatedAt']);
  assert.equal(placeDocs[0].updatedAt, '1970-01-01T00:00:00.000Z', 'an untouched one still carries the migration time');
  assert.notEqual(placeDocs[1].updatedAt, '1970-01-01T00:00:00.000Z', 'the renamed one has a real time');
  assert.equal(await admin.get(`households/${hid}/settings/places`), null, 'the app no longer writes the old single list');

  // ---- names never hide anyone (owner report: after saving a name "the list of my family members disappeared") ----
  // three members on three phones each name themselves; after every save and after a reload each phone still lists
  // all three, with the right names
  const listed = p => p.$$eval('#main [data-act="person"]', bs => bs.map(b => b.dataset.v));
  const everyone = ['mum@example.com', 'dad@example.com', 'gran@example.com'];
  await go(mum, '#/settings');
  await mum.fill('#pa-member-email', 'Gran@Example.com');
  await mum.click('#pa-member-add button[type=submit]');
  await mum.locator('#main [data-act="person"][data-v="gran@example.com"]').waitFor();
  const gran = await person('gran@example.com');
  await gran.locator('#main [data-act="person"][data-v="mum@example.com"]').waitFor();
  const nameSelf = async (p, email, n) => {
    await p.click(`#main [data-act="person"][data-v="${email}"]`); await settle(p);
    await p.fill('#pa-person-name', n);
    await p.locator('dialog.ha-sheet[open] button[type=submit]').click(); await settle(p);
    await p.locator('.ha-toast', { hasText: `Saved: ${n}` }).waitFor();
  };
  await nameSelf(mum, 'mum@example.com', 'Jun');
  assert.deepEqual(await listed(mum), everyone, 'mum still lists everyone right after saving her own name');
  await go(dad, '#/settings');
  await nameSelf(dad, 'dad@example.com', 'Dad');
  await nameSelf(gran, 'gran@example.com', 'Gran');
  const rowsOf = p => p.$$eval('#main [data-act="person"]', bs => bs.map(b => `${b.dataset.v}=${b.querySelector('.ha-row-title').textContent}`));
  for (const [who, p] of [['mum', mum], ['dad', dad], ['gran', gran]]) {
    await go(p, '#/settings');
    await p.waitForFunction(() => document.querySelectorAll('#main [data-act="person"][data-v="gran@example.com"] .ha-row-title')[0]?.textContent === 'Gran');
    assert.deepEqual(await rowsOf(p), ['mum@example.com=Jun', 'dad@example.com=Dad', 'gran@example.com=Gran'], `${who} lists everyone with names`);
    await p.reload();
    await p.waitForFunction(() => window.__pantry?.S.household?.members?.length === 3);
    await go(p, '#/settings');
    await p.waitForFunction(() => document.querySelector('#main [data-act="person"][data-v="gran@example.com"] .ha-row-title')?.textContent === 'Gran');
    assert.deepEqual(await listed(p), everyone, `${who} lists everyone after a reload`);
  }
  // a second, one-person pantry for Mum (what a second "Start our family pantry" leaves behind) that sorts first must
  // not hide the family: the phone keeps its own, and starting a pantry again opens the existing one
  await admin.put('households/0000stray', { name: 'Our pantry', owner: 'mum@example.com', members: ['mum@example.com'] });
  await mum.reload();
  await mum.waitForFunction(() => window.__pantry?.S.household);
  await go(mum, '#/settings');
  assert.equal(await mum.evaluate(() => window.__pantry.S.household.id), hid, 'a stray pantry did not take over');
  assert.deepEqual(await listed(mum), everyone, 'mum still lists everyone with a stray pantry around');
  await mum.evaluate(() => { localStorage.removeItem('pantry:household'); });
  await mum.reload();
  await mum.waitForFunction(() => window.__pantry?.S.household);
  assert.equal(await mum.evaluate(() => window.__pantry.S.household.id), hid, 'with nothing remembered, the pantry with the most people wins');
  await admin.del('households/0000stray');

  if (process.env.SHOTS) { await go(mum, '#/settings'); await mum.screenshot({ path: process.env.SHOTS + '/m06-family-after-names.png' }); }

  // ---- names and places are fields and documents: nothing one phone saved is lost by another (PR-C) ----
  const FSJS = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
  const net = (p, on) => p.evaluate(async ([on, u]) => { const F = await import(u); const db = F.getFirestore(); await (on ? F.enableNetwork(db) : F.disableNetwork(db)); }, [on, FSJS]);
  const drain = p => p.evaluate(async u => { const F = await import(u); await F.waitForPendingWrites(F.getFirestore()); }, FSJS);
  const act = (p, name, ...args) => p.evaluate(([n, a]) => window.__pantry.act[n](...a), [name, args]);
  const serverNames = async () => (await admin.get(`households/${hid}/settings/people`)).names;
  const serverPlaces = async () => (await admin.list(`households/${hid}/places`)).sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));
  const liveNames = async () => (await serverPlaces()).filter(d => !d.removedAt).map(d => d.name);
  const shownPlaces = p => p.evaluate(() => window.__pantry.places());
  const same = async (what, want) => {   // the server and both phones show the live places in this order
    for (let i = 0; i < 30; i++) { await drain(mum); await drain(dad); if (JSON.stringify(await liveNames()) === JSON.stringify(want) && JSON.stringify(await shownPlaces(mum)) === JSON.stringify(want) && JSON.stringify(await shownPlaces(dad)) === JSON.stringify(want)) return; await mum.waitForTimeout(250); }
    assert.deepEqual({ server: await liveNames(), mum: await shownPlaces(mum), dad: await shownPlaces(dad) }, { server: want, mum: want, dad: want }, what);
  };
  const serverPlaceId = name => admin.list(`households/${hid}/places`).then(l => l.find(d => d.name === name)?.id);
  await admin.put(`households/${hid}/settings/people`, { id: 'people', names: { 'mum@example.com': 'Jun', 'dad@example.com': 'Dad', 'gran@example.com': 'Gran' }, updatedAt: 'x' });
  await settle(mum); await settle(dad);

  // names 1. both name themselves at once: both kept, and Gran's name too
  await Promise.all([act(mum, 'namePerson', 'mum@example.com', 'Mummy'), act(dad, 'namePerson', 'dad@example.com', 'Daddy')]);
  await drain(mum); await drain(dad);
  assert.deepEqual(await serverNames(), { 'mum@example.com': 'Mummy', 'dad@example.com': 'Daddy', 'gran@example.com': 'Gran' }, 'both names kept, the third untouched');
  // names 2. the same with Dad offline: his name goes up when the signal returns, Mum's was already there
  await net(dad, false);
  await act(dad, 'namePerson', 'dad@example.com', 'Dad again');
  await act(mum, 'namePerson', 'mum@example.com', 'Mum again'); await drain(mum);
  assert.equal((await serverNames())['mum@example.com'], 'Mum again'); assert.equal((await serverNames())['dad@example.com'], 'Daddy', 'Dad’s is still waiting');
  await net(dad, true); await drain(dad);
  assert.deepEqual(await serverNames(), { 'mum@example.com': 'Mum again', 'dad@example.com': 'Dad again', 'gran@example.com': 'Gran' }, 'offline name kept, Mum’s too');
  for (const p of [mum, dad]) await p.waitForFunction(() => window.__pantry.S.settings.get('people').names['dad@example.com'] === 'Dad again' && window.__pantry.S.settings.get('people').names['mum@example.com'] === 'Mum again');
  // names 3. one phone writes the field of a person whose email has dots (a FieldPath update, not a dotted string)
  await act(mum, 'namePerson', 'ann.lee@example.com', 'Ann'); await drain(mum);
  assert.equal((await serverNames())['ann.lee@example.com'], 'Ann', 'a dotted email is one field');
  await act(mum, 'namePerson', 'ann.lee@example.com', ''); await drain(mum);
  assert.ok(!('ann.lee@example.com' in await serverNames()) && (await serverNames())['dad@example.com'] === 'Dad again', 'cleared by itself');
  assert.deepEqual(Object.keys(await admin.get(`households/${hid}/settings/people`)).sort(), ['id', 'names', 'updatedAt']);
  // names 4. Mum names Gran while Dad, offline, stops sharing with her: Gran's name goes, the other names stay
  await go(dad, '#/settings');
  await net(dad, false);
  await dad.click('#main [data-act="person"][data-v="gran@example.com"]'); await settle(dad);
  await dad.click('dialog.ha-sheet[open] [data-pp="remove"]'); await settle(dad);
  await dad.locator('dialog[open] button', { hasText: /^Stop sharing$/ }).last().click();   // (the app waits for the server: it can't, offline)
  await act(mum, 'namePerson', 'gran@example.com', 'Granny'); await drain(mum);
  assert.equal((await serverNames())['gran@example.com'], 'Granny', 'Mum’s save arrived while Dad was offline');
  await net(dad, true);
  for (let i = 0; i < 40 && 'gran@example.com' in (await serverNames()); i++) await dad.waitForTimeout(250);
  assert.ok(!('gran@example.com' in await serverNames()), 'Gran’s name went with her');
  assert.ok(!(await admin.get(`households/${hid}`)).members.includes('gran@example.com'), 'and she is out of the family');
  assert.deepEqual(await serverNames(), { 'mum@example.com': 'Mum again', 'dad@example.com': 'Dad again' }, 'the others stay');
  await dad.locator('.ha-toast', { hasText: 'Stopped sharing' }).waitFor();
  await admin.put(`households/${hid}/settings/people`, { id: 'people', names: { 'mum@example.com': 'Jun', 'dad@example.com': 'Dad' }, updatedAt: 'x' });
  for (const p of [mum, dad]) await p.waitForFunction(() => window.__pantry.S.settings.get('people').names['mum@example.com'] === 'Jun');

  // places 1. both add a place at once, one of them offline: both kept, each once, in the same order on both phones
  const before = await liveNames();
  await net(dad, false);
  await act(dad, 'addPlace', 'Shelf B');
  await act(mum, 'addPlace', 'Shelf A'); await drain(mum);
  await net(dad, true); await drain(dad);
  await same('two places added at once', [...before, 'Shelf A', 'Shelf B']);
  assert.equal((await serverPlaces()).filter(d => /^Shelf/.test(d.name)).length, 2);
  // places 2. a rename on one phone while the other reorders the same place (offline): both kept
  const idA = await serverPlaceId('Shelf A'), idB = await serverPlaceId('Shelf B');
  await net(dad, false);
  await act(dad, 'reorderPlace', idB, -1);   // Shelf B above Shelf A: one field of one document
  await act(mum, 'renamePlace', idB, 'Shelf Bee'); await drain(mum);
  await net(dad, true); await drain(dad);
  await same('a rename and a reorder of the same place', [...before, 'Shelf Bee', 'Shelf A']);
  const bDoc = (await serverPlaces()).find(d => d.id === idB);
  assert.equal(bDoc.name, 'Shelf Bee'); assert.ok(bDoc.order < (await serverPlaces()).find(d => d.id === idA).order, 'renamed and moved');
  assert.deepEqual(Object.keys(bDoc).sort(), ['id', 'name', 'order', 'updatedAt']);
  // places 3. one phone removes a place while the other, offline, renames it: it stays hidden, and Restore shows the new name
  await net(dad, false);
  await act(dad, 'renamePlace', idA, 'Shelf Ay');
  await act(mum, 'removePlace', idA); await drain(mum);
  await net(dad, true); await drain(dad);
  await same('removed while renamed elsewhere', [...before, 'Shelf Bee']);
  const aDoc = (await serverPlaces()).find(d => d.id === idA);
  assert.ok(aDoc.removedAt && aDoc.name === 'Shelf Ay', 'hidden, with the rename kept');
  await go(mum, '#/removed');
  await mum.locator('#pa-removed-places .ha-row', { hasText: 'Shelf Ay' }).waitFor();
  await mum.locator('#pa-removed-places .ha-row', { hasText: 'Shelf Ay' }).locator('[data-act="restore"]').click(); await settle(mum);
  await same('restored with the rename', [...before, 'Shelf Bee', 'Shelf Ay']);
  assert.ok(!(await serverPlaces()).find(d => d.id === idA).removedAt, 'markers cleared');
  // a restored place isn't brought back twice, and a removed one nobody restored never comes back
  await act(dad, 'removePlace', idA); await drain(dad);
  await act(mum, 'renamePlace', idA, 'Shelf Ay 2'); await drain(mum);
  await same('removed, then renamed', [...before, 'Shelf Bee']);
  // places 4. one phone renames a place (the app moves every item in it) while the other, offline, adds an item under the old name
  await go(mum, '#/places');
  await mum.locator('[data-act="place-open"][data-v="Shelf Bee"]').click(); await settle(mum);
  await mum.fill('#pa-pl-name', 'Shelf Cee'); await mum.locator('#pa-pl-form button[type=submit]').click(); await settle(mum);
  // (Dad's phone hasn't heard yet: he is offline and adds an item kept in "Level 1 freezer", which Mum renames at the same time)
  await net(dad, false);
  await go(dad, '#/add');
  await dad.fill('#pa-form [name="name"]', 'Late ice cream');
  await dad.selectOption('#pa-form [name="location"]', 'Level 1 freezer');
  await dad.click('#pa-save'); await settle(dad);
  await go(mum, '#/places');
  await mum.locator('[data-act="place-open"][data-v="Level 1 freezer"]').click(); await settle(mum);
  await mum.fill('#pa-pl-name', 'Cellar freezer'); await mum.locator('#pa-pl-form button[type=submit]').click(); await settle(mum);
  await drain(mum);
  await net(dad, true); await drain(dad);
  await same('the rename', [...before.map(n => n === 'Level 1 freezer' ? 'Cellar freezer' : n), 'Shelf Cee']);
  const late = (await admin.list(`households/${hid}/items`)).find(i => i.name === 'Late ice cream');
  assert.equal(late.location, 'Level 1 freezer', 'the item added under the old name kept it (nothing moved it)');
  for (const p of [mum, dad]) {
    await go(p, '#/places');
    await p.locator('#pa-places-other [data-act="place-open"][data-v="Level 1 freezer"]').waitFor();   // "Not in your list": the item is still found
    assert.equal(await p.locator('#pa-places-other .ha-row', { hasText: 'Level 1 freezer' }).locator('.ha-row-value').textContent().then(t => t.replace(/\D+/g, '')), '1');
  }
  // and the way out of "Not in your list": move its items to the renamed place
  await mum.locator('#pa-places-other [data-act="place-open"][data-v="Level 1 freezer"]').click(); await settle(mum);
  await mum.locator('dialog.ha-sheet[open] [data-pl="remove"]').click(); await settle(mum);
  await mum.selectOption('#pa-mv-to', 'Cellar freezer'); await mum.locator('#pa-mv-go').click(); await settle(mum); await drain(mum);
  assert.equal((await admin.list(`households/${hid}/items`)).find(i => i.name === 'Late ice cream').location, 'Cellar freezer');
  // the old phones keep writing the single list: the rules take it; new phones ignore it
  const oldPhone = await dad.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    try { await F.setDoc(F.doc(F.getFirestore(), 'households', hid, 'settings', 'places'), { id: 'places', list: ['Old phone fridge', 'Old phone shed'], updatedAt: 'x' }); return 'ok'; } catch (e) { return e.code; }
  }, hid);
  assert.equal(oldPhone, 'ok', 'an older phone’s write of settings/places is accepted by the rules');
  await settle(mum); await settle(dad);
  assert.ok(!(await shownPlaces(mum)).includes('Old phone fridge') && !(await shownPlaces(dad)).includes('Old phone shed'), 'new phones ignore it');
  await same('after the old phone wrote', [...before.map(n => n === 'Level 1 freezer' ? 'Cellar freezer' : n), 'Shelf Cee']);
  await mum.evaluate(async hid => { const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'); await F.deleteDoc(F.doc(F.getFirestore(), 'households', hid, 'settings', 'places')); }, hid);
  assert.equal(await mum.evaluate(() => window.__pantry.S.refused.length) + await dad.evaluate(() => window.__pantry.S.refused.length), 0, 'nothing refused');

  // places 5. two phones migrate from the old single list at once, one of them offline and behind: no duplicates, and
  // what the first one changed is not overwritten when the second's copy of the old list arrives
  await admin.put('households/migH', { name: 'Our pantry', owner: 'mig1@example.com', members: ['mig1@example.com', 'mig2@example.com'], createdAt: '2026-10-16T00:00:00.000Z' });
  await admin.put('households/migH/settings/places', { id: 'places', list: ['Fridge', 'Freezer', 'Store room'], updatedAt: 'x' });
  const mig1 = await person('mig1@example.com'), mig2 = await person('mig2@example.com');
  for (const p of [mig1, mig2]) await p.waitForFunction(() => window.__pantry.S.household?.id === 'migH');
  for (const p of [mig1, mig2]) assert.deepEqual(await shownPlaces(p), ['Fridge', 'Freezer', 'Store room'], 'an old list is shown as it is');
  assert.equal((await admin.list('households/migH/places')).length, 0, 'nothing written just by looking');
  await net(mig2, false);
  await act(mig2, 'reorderPlace', Lgp('Freezer'), -1);   // Freezer to the top (the first change: it writes the documents)
  await act(mig2, 'addPlace', 'Shed');
  await act(mig1, 'renamePlace', Lgp('Fridge'), 'Big fridge'); await drain(mig1);   // mig1 is first: documents, then a rename
  assert.equal((await admin.list('households/migH/places')).length, 3, 'mig1 made the three documents');
  await net(mig2, true); await drain(mig2);
  for (let i = 0; i < 30; i++) { if ((await admin.list('households/migH/places')).length === 4) break; await mig1.waitForTimeout(250); }
  const mp = (await admin.list('households/migH/places')).sort((a, b) => a.order - b.order);
  assert.deepEqual(mp.map(d => d.name), ['Freezer', 'Big fridge', 'Store room', 'Shed'], 'both changes kept; the rename was not overwritten by the late copy of the old list');
  assert.equal(new Set(mp.map(d => d.id)).size, 4, 'no document twice');
  for (const p of [mig1, mig2]) { await p.waitForFunction(() => window.__pantry.places().join() === 'Freezer,Big fridge,Store room,Shed'); assert.equal(await p.evaluate(() => window.__pantry.S.refused.length), 0, 'nothing refused'); }
  // and the same at once, both online: the same documents, no duplicates
  await admin.put('households/migI', { name: 'Our pantry', owner: 'mig3@example.com', members: ['mig3@example.com', 'mig4@example.com'], createdAt: '2026-10-16T00:00:00.000Z' });
  const mig3 = await person('mig3@example.com'), mig4 = await person('mig4@example.com');
  for (const p of [mig3, mig4]) await p.waitForFunction(() => window.__pantry.S.household?.id === 'migI');
  await Promise.all([act(mig3, 'addPlace', 'Pantry shelf'), act(mig4, 'addPlace', 'Garage')]);
  for (const p of [mig3, mig4]) await drain(p);
  const ip = await admin.list('households/migI/places');
  assert.equal(ip.length, 11 + 2, 'the eleven defaults once, plus the two new places');
  assert.equal(new Set(ip.map(d => d.name.toLowerCase())).size, 13, 'no duplicates');
  for (const p of [mig3, mig4]) await p.waitForFunction(() => window.__pantry.places().length === 13);

  // ---- the rules for places and names ----
  const placeRules2 = await mum.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), d = id => F.doc(db, 'households', hid, 'places', id);
    const out = {};
    const tryIt = async (name, fn) => { try { await fn(); out[name] = 'ok'; } catch (e) { out[name] = e.code; } };
    const P = (id, extra = {}) => ({ id, name: 'Rules ' + id, order: 1, updatedAt: '2026-10-16T01:00:00.000Z', ...extra });
    const SEED = '1970-01-01T00:00:00.000Z';
    await tryIt('a place', () => F.setDoc(d('r1'), P('r1')));
    await tryIt('read', async () => { if (!(await F.getDoc(d('r1'))).exists()) throw { code: 'missing' }; });
    await tryIt('list', async () => { await F.getDocs(F.collection(db, 'households', hid, 'places')); });
    await tryIt('a fractional order', () => F.setDoc(d('r2'), P('r2', { order: 1.5 })));
    await tryIt('a negative order', () => F.setDoc(d('r3'), P('r3', { order: -3 })));
    await tryIt('a name of 40 characters', () => F.setDoc(d('r4'), P('r4', { name: 'x'.repeat(40) })));
    await tryIt('a name of 41 characters', () => F.setDoc(d('r5'), P('r5', { name: 'x'.repeat(41) })));
    await tryIt('an empty name', () => F.setDoc(d('r6'), P('r6', { name: '' })));
    await tryIt('a name with a new line', () => F.setDoc(d('r7'), P('r7', { name: 'two\nlines' })));
    await tryIt('a number for a name', () => F.setDoc(d('r8'), P('r8', { name: 3 })));
    await tryIt('a text order', () => F.setDoc(d('r9'), P('r9', { order: '1' })));
    await tryIt('no order', () => { const x = P('r10'); delete x.order; return F.setDoc(d('r10'), x); });
    await tryIt('no updatedAt', () => { const x = P('r11'); delete x.updatedAt; return F.setDoc(d('r11'), x); });
    await tryIt('another field', () => F.setDoc(d('r12'), P('r12', { colour: 'red' })));
    await tryIt('an id that is not the document id', () => F.setDoc(d('r13'), P('other')));
    await tryIt('a document id with a dot', () => F.setDoc(d('r.14'), P('r.14')));
    await tryIt('a document id of 40 characters', () => F.setDoc(d('i'.repeat(40)), P('i'.repeat(40), { name: 'long id' })));
    await tryIt('a document id of 41 characters', () => F.setDoc(d('i'.repeat(41)), P('i'.repeat(41), { name: 'longer id' })));
    await tryIt('removedAt and removedBy', () => F.setDoc(d('r15'), P('r15', { removedAt: '2026-10-16T01:00:00.000Z', removedBy: 'Mum' })));
    await tryIt('a removedAt that is not a time', () => F.setDoc(d('r16'), P('r16', { removedAt: 'yesterday' })));
    await tryIt('a removedAt of null', () => F.setDoc(d('r17'), P('r17', { removedAt: null })));
    await tryIt('a removedBy over 40 characters', () => F.setDoc(d('r18'), P('r18', { removedAt: '2026-10-16T01:00:00.000Z', removedBy: 'x'.repeat(41) })));
    await tryIt('a freezer kind', () => F.setDoc(d('r19'), P('r19', { kind: 'freezer' })));
    await tryIt('an unknown kind', () => F.setDoc(d('r20'), P('r20', { kind: 'garage' })));
    // changes by field: the rules judge the place as it will be
    await tryIt('a rename by field', () => F.updateDoc(d('r1'), { name: 'Renamed', updatedAt: '2026-10-16T02:00:00.000Z' }));
    await tryIt('a move by field', () => F.updateDoc(d('r1'), { order: 0.75, updatedAt: '2026-10-16T02:00:00.000Z' }));
    await tryIt('a removal by field', () => F.updateDoc(d('r1'), { removedAt: '2026-10-16T03:00:00.000Z', removedBy: 'Mum', updatedAt: '2026-10-16T03:00:00.000Z' }));
    await tryIt('a restore by field', () => F.updateDoc(d('r1'), { removedAt: F.deleteField(), removedBy: F.deleteField(), updatedAt: '2026-10-16T04:00:00.000Z' }));
    await tryIt('an empty name by field', () => F.updateDoc(d('r1'), { name: '' }));
    await tryIt('an unknown field by field', () => F.updateDoc(d('r1'), { colour: 'red' }));
    await tryIt('a kind by field', () => F.updateDoc(d('r19'), { kind: 'fridge', updatedAt: '2026-10-16T02:00:00.000Z' }));
    await tryIt('the kind removed by field', () => F.updateDoc(d('r19'), { kind: F.deleteField(), updatedAt: '2026-10-16T03:00:00.000Z' }));
    await tryIt('the name field removed', () => F.updateDoc(d('r1'), { name: F.deleteField() }));
    await tryIt('a field change of a place that isn’t there', () => F.updateDoc(d('nothere'), { name: 'x' }));
    // documents made from the old list carry the migration time: only new, or exactly as they are
    await tryIt('a migration document, new', () => F.setDoc(d('s1'), P('s1', { updatedAt: SEED })));
    await tryIt('the same again (another phone migrating)', () => F.setDoc(d('s1'), P('s1', { updatedAt: SEED })));
    await tryIt('the migration time with another name', () => F.setDoc(d('s1'), P('s1', { name: 'Other', updatedAt: SEED })));
    await tryIt('a rename of it by field', () => F.updateDoc(d('s1'), { name: 'Renamed s1', updatedAt: '2026-10-16T02:00:00.000Z' }));
    await tryIt('a late migration copy over the rename', () => F.setDoc(d('s1'), P('s1', { updatedAt: SEED })));
    await tryIt('a late migration copy over a removal', async () => { await F.setDoc(d('s2'), P('s2', { updatedAt: SEED })); await F.updateDoc(d('s2'), { removedAt: '2026-10-16T03:00:00.000Z', removedBy: 'Mum', updatedAt: '2026-10-16T03:00:00.000Z' }); await F.setDoc(d('s2'), P('s2', { updatedAt: SEED })); });
    await tryIt('delete', () => F.deleteDoc(d('r2')));
    return out;
  }, hid);
  const OK = 'ok', NO = 'permission-denied';
  assert.deepEqual(placeRules2, {
    'a place': OK, read: OK, list: OK, 'a fractional order': OK, 'a negative order': OK, 'a name of 40 characters': OK, 'a name of 41 characters': NO, 'an empty name': NO,
    'a name with a new line': NO, 'a number for a name': NO, 'a text order': NO, 'no order': NO, 'no updatedAt': NO, 'another field': NO,
    'an id that is not the document id': NO, 'a document id with a dot': NO, 'a document id of 40 characters': OK, 'a document id of 41 characters': NO,
    'removedAt and removedBy': OK, 'a removedAt that is not a time': NO, 'a removedAt of null': NO, 'a removedBy over 40 characters': NO,
    'a freezer kind': OK, 'an unknown kind': NO, 'a kind by field': OK, 'the kind removed by field': OK,
    'a rename by field': OK, 'a move by field': OK, 'a removal by field': OK, 'a restore by field': OK, 'an empty name by field': NO, 'an unknown field by field': NO,
    'the name field removed': NO, 'a field change of a place that isn’t there': NO,   // (an update has no document to build on: refused, not "not found")
   
    'a migration document, new': OK, 'the same again (another phone migrating)': OK, 'the migration time with another name': NO, 'a rename of it by field': OK,
    'a late migration copy over the rename': NO, 'a late migration copy over a removal': NO, delete: OK,
  }, 'place rules: ' + JSON.stringify(placeRules2));
  const outsiderP = await stranger.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), d = id => F.doc(db, 'households', hid, 'places', id), out = [];
    try { await F.getDoc(d('r1')); out.push('read'); } catch (e) { out.push(e.code); }
    try { await F.getDocs(F.collection(db, 'households', hid, 'places')); out.push('listed'); } catch (e) { out.push(e.code); }
    try { await F.setDoc(d('evil'), { id: 'evil', name: 'x', order: 1, updatedAt: 'x' }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.updateDoc(d('r1'), { name: 'x' }); out.push('updated'); } catch (e) { out.push(e.code); }
    try { await F.deleteDoc(d('r1')); out.push('deleted'); } catch (e) { out.push(e.code); }
    try { await F.updateDoc(F.doc(db, 'households', hid, 'settings', 'people'), new F.FieldPath('names', 'stranger@example.com'), 'x', 'updatedAt', 'x'); out.push('named'); } catch (e) { out.push(e.code); }
    return out;
  }, hid);
  assert.deepEqual(outsiderP, Array(6).fill(NO), 'outsider and places and names: ' + outsiderP.join(', '));
  // names by field: the rules judge the names as they will be
  const nameRules2 = await mum.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), ref = F.doc(db, 'households', hid, 'settings', 'people'), FP = (...s) => new F.FieldPath(...s);
    const out = {};
    const tryIt = async (name, fn) => { try { await fn(); out[name] = 'ok'; } catch (e) { out[name] = e.code; } };
    const reset = names => F.setDoc(ref, { id: 'people', names, updatedAt: 'x' });
    await reset({ 'mum@example.com': 'Jun' });
    await tryIt('a name by field', () => F.updateDoc(ref, FP('names', 'new.person@example.com'), 'Newbie', 'updatedAt', 'y'));
    await tryIt('a name cleared by field', () => F.updateDoc(ref, FP('names', 'new.person@example.com'), F.deleteField(), 'updatedAt', 'z'));
    await tryIt('the last name cleared', () => F.updateDoc(ref, FP('names', 'mum@example.com'), F.deleteField(), 'updatedAt', 'z'));
    await tryIt('a name by field again (an empty map is fine)', () => F.updateDoc(ref, FP('names', 'mum@example.com'), 'Jun', 'updatedAt', 'z'));
    await tryIt('a 41-character name', () => F.updateDoc(ref, FP('names', 'a@example.com'), 'x'.repeat(41), 'updatedAt', 'y'));
    await tryIt('an empty name', () => F.updateDoc(ref, FP('names', 'a@example.com'), '', 'updatedAt', 'y'));
    await tryIt('a name with a new line', () => F.updateDoc(ref, FP('names', 'a@example.com'), 'Ah\nMei', 'updatedAt', 'y'));
    await tryIt('a number', () => F.updateDoc(ref, FP('names', 'a@example.com'), 3, 'updatedAt', 'y'));
    await tryIt('a key that is not an email', () => F.updateDoc(ref, FP('names', 'Mum'), 'Mum', 'updatedAt', 'y'));
    await tryIt('an unknown field', () => F.updateDoc(ref, { colour: 'red' }));
    await tryIt('the id changed', () => F.updateDoc(ref, { id: 'places' }));
    await tryIt('updatedAt removed', () => F.updateDoc(ref, { updatedAt: F.deleteField() }));
    await tryIt('names removed', () => F.updateDoc(ref, { names: F.deleteField() }));
    await reset(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}@example.com`, 'n'])));
    await tryIt('the 21st name by field', () => F.updateDoc(ref, FP('names', 'p20@example.com'), 'n', 'updatedAt', 'y'));
    await tryIt('the 20th renamed by field', () => F.updateDoc(ref, FP('names', 'p19@example.com'), 'renamed', 'updatedAt', 'y'));
    await tryIt('one cleared and one added in one write', () => F.updateDoc(ref, FP('names', 'p0@example.com'), F.deleteField(), FP('names', 'p20@example.com'), 'n', 'updatedAt', 'y'));
    await F.deleteDoc(ref);
    await tryIt('the first name, by a merge (no document yet)', () => F.setDoc(ref, { id: 'people', updatedAt: 'y', names: { 'a.b@example.com': 'Ann' } }, { merge: true }));
    await tryIt('a name by merge on top', () => F.setDoc(ref, { updatedAt: 'z', names: { 'c@example.com': 'Cee' } }, { merge: true }));
    await tryIt('a bad name by merge', () => F.setDoc(ref, { updatedAt: 'z', names: { 'c@example.com': 'x'.repeat(41) } }, { merge: true }));
    await tryIt('a field change with no document', async () => { await F.deleteDoc(ref); await F.updateDoc(ref, FP('names', 'a@example.com'), 'x', 'updatedAt', 'y'); });
    await reset({ 'mum@example.com': 'Jun', 'dad@example.com': 'Dad' });
    return out;
  }, hid);
  assert.deepEqual(nameRules2, {
    'a name by field': OK, 'a name cleared by field': OK, 'the last name cleared': OK, 'a name by field again (an empty map is fine)': OK,
    'a 41-character name': NO, 'an empty name': NO, 'a name with a new line': NO, 'a number': NO, 'a key that is not an email': NO,
    'an unknown field': NO, 'the id changed': NO, 'updatedAt removed': NO, 'names removed': NO,
    'the 21st name by field': NO, 'the 20th renamed by field': OK, 'one cleared and one added in one write': OK,
    'the first name, by a merge (no document yet)': OK, 'a name by merge on top': OK, 'a bad name by merge': NO, 'a field change with no document': NO,
  }, 'names rules: ' + JSON.stringify(nameRules2));
  await settle(mum); await settle(dad);
  assert.deepEqual(await serverNames(), { 'mum@example.com': 'Jun', 'dad@example.com': 'Dad' });
  for (const d of await admin.list(`households/${hid}/places`)) if (/^(r\d+|r\.14|i{40}|s\d)$/.test(d.id)) await admin.del(`households/${hid}/places/${d.id}`);   // the rules cases' own documents

  // ---- stock changes are instructions: two phones never overwrite each other (online or not) ----
  const rawItem = id => admin.get(`households/${hid}/items/${id}`);
  const rawQty = async id => Object.fromEntries(Object.entries((await rawItem(id)).batches).map(([k, v]) => [k, v.qty]));
  const has = (p, id) => p.waitForFunction(id => window.__pantry.S.items.has(id), id);
  const shown = (p, id) => p.evaluate(id => Object.fromEntries(window.__pantry.S.items.get(id).batches.map(b => [b.id, b.qty])), id);
  const both = async (id, want, what) => {   // the server and both phones agree
    let got;
    for (let i = 0; i < 25; i++) {   // a refused conversion is applied again by the app a moment after the refusal
      await drain(mum); await drain(dad);
      got = await rawQty(id);
      if (JSON.stringify(got) === JSON.stringify(want)) break;
      await mum.waitForTimeout(300);
    }
    assert.deepEqual(got, want, what + ' (server)');
    for (const [who, p] of [['mum', mum], ['dad', dad]]) { await p.waitForFunction(([id, w]) => JSON.stringify(Object.fromEntries(window.__pantry.S.items.get(id).batches.map(b => [b.id, Math.max(0, b.qty)]))) === w, [id, JSON.stringify(Object.fromEntries(Object.entries(want).map(([k, v]) => [k, Math.max(0, v)])))]); }
  };
  const base = { category: 'Sauces & condiments', location: 'Fridge', brand: '', size: '', barcode: '', lowAt: 0, openDays: null, createdAt: '2026-10-16T00:00:00.000Z', createdBy: 'Mum' };
  await admin.put(`households/${hid}/items/soy`, { id: 'soy', name: 'Soy', ...base, batches: { ba: { qty: 5, expiry: '2027-01-01', openedAt: null, addedAt: '2026-10-01' }, bb: { qty: 2, expiry: '2027-06-01', openedAt: null, addedAt: '2026-10-02' } } });
  await has(mum, 'soy'); await has(dad, 'soy');
  // 1. both use one of the same batch at once: two uses, not one
  await Promise.all([act(mum, 'use', 'soy'), act(dad, 'use', 'soy')]);
  await both('soy', { ba: 3, bb: 2 }, 'both phones used one: 5 - 2');
  // 2. dad has no signal and uses one; mum uses one; dad's phone says it is waiting; then the signal returns: both count
  await net(dad, false);
  await act(dad, 'use', 'soy', 'ba');
  await go(dad, '#/');
  await dad.locator('.pa-sync', { hasText: 'Waiting for signal (1 change)' }).waitFor();
  if (process.env.SHOTS) await dad.screenshot({ path: process.env.SHOTS + '/s02-waiting.png' });
  await act(mum, 'use', 'soy', 'ba'); await drain(mum);
  assert.deepEqual(await rawQty('soy'), { ba: 2, bb: 2 }, 'the server has only mum’s use while dad is offline');
  await net(dad, true);
  await both('soy', { ba: 1, bb: 2 }, 'dad came back: 3 - 2');
  await dad.locator('.pa-sync', { hasText: 'Saved' }).waitFor();
  if (process.env.SHOTS) await dad.screenshot({ path: process.env.SHOTS + '/s01-saved.png' });
  // 3. one phone adds a batch while the other uses from another: both kept
  await Promise.all([act(mum, 'add', 'soy', 3, '2027-03-03', 'bnew'), act(dad, 'use', 'soy', 'bb')]);
  await both('soy', { ba: 1, bb: 1, bnew: 3 }, 'an added batch and a use from another batch');
  // 4. Edit: dad opens the form, mum uses one meanwhile, dad saves a new name: the stock keeps mum's use
  await go(dad, '#/edit/soy');
  await dad.fill('#pa-form [name="name"]', 'Soy sauce');
  await act(mum, 'use', 'soy', 'bnew'); await drain(mum);
  await dad.waitForFunction(() => window.__pantry.S.items.get('soy').batches.find(b => b.id === 'bnew').qty === 2);
  await dad.click('#pa-save'); await settle(dad);
  await both('soy', { ba: 1, bb: 1, bnew: 2 }, 'a form saved after another phone used one');
  assert.equal((await rawItem('soy')).name, 'Soy sauce');
  // ... and the same offline: dad renames with no signal, mum uses one, dad reconnects: the new name and mum's use
  await go(dad, '#/edit/soy'); await net(dad, false);
  await dad.fill('#pa-form [name="name"]', 'Light soy sauce'); await dad.click('#pa-save'); await settle(dad);
  await act(mum, 'use', 'soy', 'bnew'); await drain(mum);
  await net(dad, true);
  await both('soy', { ba: 1, bb: 1, bnew: 1 }, 'an offline rename and a use');
  assert.equal((await rawItem('soy')).name, 'Light soy sauce');
  await mum.waitForFunction(() => window.__pantry.S.items.get('soy').name === 'Light soy sauce');
  // 5. Undo after another phone changed the item gives back only this phone's change
  const used = await act(mum, 'use', 'soy', 'bb');   // bb 1 -> 0
  await act(dad, 'use', 'soy', 'ba'); await drain(dad);   // ba 1 -> 0
  await act(mum, 'undo'); await drain(mum);
  await both('soy', { ba: 0, bb: 1, bnew: 1 }, 'undo gave back mum’s unit only');
  assert.deepEqual(Object.keys(used.ops.inc), ['batches.bb.qty']);
  // 6. an old-style item (an array): both phones read it; the first change converts it, with ids both phones agree on
  const Lg = await import('../js/logic.js');
  await admin.put(`households/${hid}/items/old`, { id: 'old', name: 'Old', ...base, batches: [{ id: 'x1', qty: 2, expiry: '2027-01-01' }, { qty: 1, expiry: null }] });
  await has(mum, 'old'); await has(dad, 'old');
  const legacy = Lg.legacyBatchId('old', 1);
  assert.deepEqual(await shown(mum, 'old'), { x1: 2, [legacy]: 1 }); assert.deepEqual(await shown(dad, 'old'), { x1: 2, [legacy]: 1 });
  await act(mum, 'use', 'old'); await drain(mum);
  const conv = await rawItem('old');
  assert.ok(!Array.isArray(conv.batches), 'the first change turned it into a map');
  assert.deepEqual(Object.fromEntries(Object.entries(conv.batches).map(([k, v]) => [k, v.qty])), { x1: 1, [legacy]: 1 }, 'ids kept and derived, the dated batch used first');
  // another old item, converted by a use on one phone, then (an older phone) written back as an array: readers cope
  await admin.put(`households/${hid}/items/old3`, { id: 'old3', name: 'Old three', ...base, batches: [{ id: 'y1', qty: 4, expiry: '2027-01-01' }] });
  await has(mum, 'old3'); await has(dad, 'old3');
  await act(mum, 'use', 'old3', 'y1');
  await both('old3', { y1: 3 }, 'an old item converted by a use');
  assert.equal(SYNC_REFUSED(await dad.evaluate(() => window.__pantry.S.refused)), 0, 'nothing refused');
  // an older phone writes the array back over a map item: readers cope, and the next change converts it again
  await admin.put(`households/${hid}/items/old3`, { id: 'old3', name: 'Old three', ...base, batches: [{ id: 'y1', qty: 3, expiry: '2027-01-01' }] });
  await dad.waitForFunction(() => window.__pantry.S.items.get('old3')._arr === true);
  assert.deepEqual(await shown(dad, 'old3'), { y1: 3 });
  await act(dad, 'use', 'old3'); await both('old3', { y1: 2 }, 'converted again');
  // 7. a change the server refuses is kept on the phone and says Needs attention, with Retry and Discard
  await admin.put(`households/${hid}/items/gone`, { id: 'gone', name: 'Gone soon', ...base, batches: { g1: { qty: 2, expiry: '2027-01-01' } } });
  await has(dad, 'gone');
  await net(dad, false);
  await admin.del(`households/${hid}/items/gone`);
  await act(dad, 'use', 'gone');
  await net(dad, true);
  await go(dad, '#/');
  await dad.locator('.pa-sync', { hasText: 'Needs attention' }).waitFor();
  assert.equal(await dad.evaluate(() => window.__pantry.S.refused.length), 1);
  assert.equal(await dad.evaluate(() => JSON.parse(localStorage.getItem('pantry:refused')).length), 1, 'kept on the phone');
  await go(dad, '#/settings');
  await dad.locator('#main .pa-refused', { hasText: 'Gone soon' }).waitFor();
  assert.match(await dad.locator('#main .pa-refused').textContent(), /removed on another phone/);
  assert.equal(await dad.locator('[data-act="refused-retry"]').count(), 1); assert.equal(await dad.locator('[data-act="refused-discard"]').count(), 1);
  if (process.env.SHOTS) await dad.screenshot({ path: process.env.SHOTS + '/s03-attention.png' });
  // retry: the item is gone, so there is nothing to change; the entry goes
  await dad.click('[data-act="refused-retry"]'); await settle(dad);
  await dad.locator('.pa-sync', { hasText: 'Saved' }).waitFor();
  assert.equal(await dad.evaluate(() => window.__pantry.S.refused.length), 0);
  assert.equal(await admin.get(`households/${hid}/items/gone`), null, 'a retry never brings a deleted item back');
  // discard
  await admin.put(`households/${hid}/items/gone2`, { id: 'gone2', name: 'Gone too', ...base, batches: { g1: { qty: 2, expiry: '2027-01-01' } } });
  await has(dad, 'gone2'); await net(dad, false);
  await admin.del(`households/${hid}/items/gone2`);
  await act(dad, 'use', 'gone2'); await net(dad, true);
  await dad.locator('.pa-sync', { hasText: 'Needs attention' }).waitFor();
  await dad.click('[data-act="refused-discard"]'); await settle(dad);
  await dad.locator('.pa-sync', { hasText: 'Saved' }).waitFor();
  assert.equal(await dad.evaluate(() => JSON.parse(localStorage.getItem('pantry:refused')).length), 0);
  assert.equal(await admin.get(`households/${hid}/items/gone2`), null);

  // ---- the rules for stock: the map and the array both accepted, anything else refused; history is write-once ----
  const stockRules = await mum.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), d = (...p) => F.doc(db, 'households', hid, ...p);
    const out = {};
    const tryIt = async (name, fn) => { try { await fn(); out[name] = 'ok'; } catch (e) { out[name] = e.code; } };
    const item = (id, batches) => ({ id, name: 'Rules ' + id, ...(batches === undefined ? {} : { batches }) });
    const many = (n, f = i => ({ qty: i, expiry: null })) => Object.fromEntries(Array.from({ length: n }, (_, i) => ['b' + i, f(i)]));
    await tryIt('map', () => F.setDoc(d('items', 'r1'), item('r1', { a: { qty: 2, expiry: '2027-01-01' }, 'b-2_X': { qty: 0, expiry: null }, c: { qty: 1 } })));
    await tryIt('empty map', () => F.setDoc(d('items', 'r2'), item('r2', {})));
    await tryIt('array', () => F.setDoc(d('items', 'r3'), item('r3', [{ id: 'a', qty: 1, expiry: null }])));
    await tryIt('no batches', () => F.setDoc(d('items', 'r4'), item('r4')));
    await tryIt('60 batches', () => F.setDoc(d('items', 'r5'), item('r5', many(60))));
    await tryIt('61 batches', () => F.setDoc(d('items', 'r6'), item('r6', many(61))));
    await tryIt('61 in an array', () => F.setDoc(d('items', 'r7'), item('r7', Array.from({ length: 61 }, (_, i) => ({ id: 'a' + i, qty: 1 })))));
    await tryIt('an id with a dot', () => F.setDoc(d('items', 'r8'), item('r8', { 'a.b': { qty: 1 } })));
    await tryIt('an id with a space', () => F.setDoc(d('items', 'r9'), item('r9', { 'a b': { qty: 1 } })));
    await tryIt('a 41-character id', () => F.setDoc(d('items', 'r10'), item('r10', { ['x'.repeat(41)]: { qty: 1 } })));
    await tryIt('a 40-character id', () => F.setDoc(d('items', 'r11'), item('r11', { ['x'.repeat(40)]: { qty: 1 } })));
    await tryIt('a bad id late in the map', () => F.setDoc(d('items', 'r12'), item('r12', { ...many(30), 'zz zz': { qty: 1 } })));
    await tryIt('qty a string', () => F.setDoc(d('items', 'r13'), item('r13', { a: { qty: '2' } })));
    await tryIt('qty 10000', () => F.setDoc(d('items', 'r14'), item('r14', { a: { qty: 10000 } })));
    await tryIt('qty 9999', () => F.setDoc(d('items', 'r15'), item('r15', { a: { qty: 9999 } })));
    await tryIt('qty -99', () => F.setDoc(d('items', 'r16'), item('r16', { a: { qty: -99 } })));
    await tryIt('qty -100', () => F.setDoc(d('items', 'r17'), item('r17', { a: { qty: -100 } })));
    await tryIt('a bad qty among the first 12', () => F.setDoc(d('items', 'r18'), item('r18', { ...many(5), z: { qty: 'x' } })));
    await tryIt('a bad qty after the first 12 (known limit: not checked)', () => F.setDoc(d('items', 'r18b'), item('r18b', { ...many(30), z: { qty: 'x' } })));
    await tryIt('expiry a number', () => F.setDoc(d('items', 'r19'), item('r19', { a: { qty: 1, expiry: 5 } })));
    await tryIt('a batch that is not a map', () => F.setDoc(d('items', 'r20'), item('r20', { a: 3 })));
    await tryIt('batches a string', () => F.setDoc(d('items', 'r21'), item('r21', 'lots')));
    await tryIt('batches a number', () => F.setDoc(d('items', 'r22'), item('r22', 5)));
    // changes by field: an add, a use, a new batch, a removal, all on a map item
    await tryIt('inc a quantity', () => F.updateDoc(d('items', 'r1'), { 'batches.a.qty': F.increment(-1) }));
    await tryIt('a new batch by fields', () => F.updateDoc(d('items', 'r1'), { 'batches.n1.qty': F.increment(3), 'batches.n1.expiry': '2027-02-02' }));
    await tryIt('remove a batch', () => F.updateDoc(d('items', 'r1'), { 'batches.c': F.deleteField() }));
    await tryIt('inc below the floor', () => F.updateDoc(d('items', 'r1'), { 'batches.b-2_X.qty': F.increment(-100) }));
    await tryIt('inc to the floor', () => F.updateDoc(d('items', 'r1'), { 'batches.b-2_X.qty': F.increment(-99) }));
    await tryIt('a bad id by field', () => F.updateDoc(d('items', 'r1'), { 'batches.bad id.qty': F.increment(1) }));
    // an old array turned into a map by one write (what the app does for an old-style item)
    await tryIt('convert an array', () => F.updateDoc(d('items', 'r3'), { batches: { a: { qty: 1, expiry: null } } }));
    await tryIt('a whole item with an array over a map', () => F.setDoc(d('items', 'r3'), item('r3', [{ id: 'a', qty: 1, expiry: null }])));
    // My order: `order` absent or a number inside plus or minus a million; no limit on other keys of an item
    await tryIt('order a fraction', () => F.setDoc(d('items', 'o1'), { ...item('o1', {}), order: 1.5 }));
    await tryIt('order a string', () => F.setDoc(d('items', 'o2'), { ...item('o2', {}), order: '2' }));
    await tryIt('order null', () => F.setDoc(d('items', 'o3'), { ...item('o3', {}), order: null }));
    await tryIt('order 999999.5', () => F.setDoc(d('items', 'o4'), { ...item('o4', {}), order: 999999.5 }));
    await tryIt('order 1000000', () => F.setDoc(d('items', 'o5'), { ...item('o5', {}), order: 1000000 }));
    await tryIt('order -1000000', () => F.setDoc(d('items', 'o6'), { ...item('o6', {}), order: -1000000 }));
    await tryIt('order -999999', () => F.setDoc(d('items', 'o7'), { ...item('o7', {}), order: -999999 }));
    await tryIt('order NaN', () => F.setDoc(d('items', 'o8'), { ...item('o8', {}), order: NaN }));
    await tryIt('order a map', () => F.setDoc(d('items', 'o9'), { ...item('o9', {}), order: { a: 1 } }));
    await tryIt('order a list', () => F.setDoc(d('items', 'o10'), { ...item('o10', {}), order: [1] }));
    await tryIt('order by field', () => F.updateDoc(d('items', 'o1'), { order: 2.25 }));
    await tryIt('order a string by field', () => F.updateDoc(d('items', 'o1'), { order: 'x' }));
    await tryIt('order too big by field', () => F.updateDoc(d('items', 'o1'), { order: 5000000 }));
    await tryIt('order and a rename in one update', () => F.updateDoc(d('items', 'o1'), { order: 3, name: 'Renamed o1' }));
    await tryIt('order taken off by field', () => F.updateDoc(d('items', 'o1'), { order: F.deleteField() }));
    await tryIt('another key is still fine (no hasOnly on items)', () => F.setDoc(d('items', 'o11'), { ...item('o11', {}), colour: 'red', order: 4 }));
    // history: created once, never edited; deleting a line (Undo) is fine; writing it again exactly as it is is fine
    const e = (id, qty = 1) => ({ id, itemId: 'r1', type: 'use', qty, at: '2026-10-16T00:00:00.000Z', by: 'Mum' });
    await tryIt('event create', () => F.setDoc(d('events', 'ev1'), e('ev1')));
    await tryIt('event rewritten as it is', () => F.setDoc(d('events', 'ev1'), e('ev1')));
    await tryIt('event changed', () => F.setDoc(d('events', 'ev1'), e('ev1', 5)));
    await tryIt('event field changed', () => F.updateDoc(d('events', 'ev1'), { qty: 7 }));
    await tryIt('event field added', () => F.updateDoc(d('events', 'ev1'), { note: 'x' }));
    await tryIt('event delete', () => F.deleteDoc(d('events', 'ev1')));
    await tryIt('event create again', () => F.setDoc(d('events', 'ev1'), e('ev1')));
    await tryIt('shop line create and change', async () => { await F.setDoc(d('shop', 'sl1'), { id: 'sl1', name: 'Milk', done: false }); await F.updateDoc(d('shop', 'sl1'), { done: true }); });
    return out;
  }, hid);
  assert.deepEqual(stockRules, {
    map: 'ok', 'empty map': 'ok', array: 'ok', 'no batches': 'ok', '60 batches': 'ok', '61 batches': 'permission-denied', '61 in an array': 'permission-denied',
    'an id with a dot': 'permission-denied', 'an id with a space': 'permission-denied', 'a 41-character id': 'permission-denied', 'a 40-character id': 'ok',
    'a bad id late in the map': 'permission-denied', 'qty a string': 'permission-denied', 'qty 10000': 'permission-denied', 'qty 9999': 'ok', 'qty -99': 'ok',
    'qty -100': 'permission-denied', 'a bad qty among the first 12': 'permission-denied', 'a bad qty after the first 12 (known limit: not checked)': 'ok', 'expiry a number': 'permission-denied', 'a batch that is not a map': 'permission-denied',
    'batches a string': 'permission-denied', 'batches a number': 'permission-denied',
    'inc a quantity': 'ok', 'a new batch by fields': 'ok', 'remove a batch': 'ok', 'inc below the floor': 'permission-denied', 'inc to the floor': 'ok', 'a bad id by field': 'permission-denied',
    'convert an array': 'ok', 'a whole item with an array over a map': 'ok',
    'event create': 'ok', 'event rewritten as it is': 'ok', 'event changed': 'permission-denied', 'event field changed': 'permission-denied', 'event field added': 'permission-denied',
    'event delete': 'ok', 'event create again': 'ok', 'shop line create and change': 'ok',
    'order a fraction': 'ok', 'order a string': 'permission-denied', 'order null': 'permission-denied', 'order 999999.5': 'ok', 'order 1000000': 'permission-denied',
    'order -1000000': 'permission-denied', 'order -999999': 'ok', 'order NaN': 'permission-denied', 'order a map': 'permission-denied', 'order a list': 'permission-denied',
    'order by field': 'ok', 'order a string by field': 'permission-denied', 'order too big by field': 'permission-denied', 'order and a rename in one update': 'ok',
    'order taken off by field': 'ok', 'another key is still fine (no hasOnly on items)': 'ok',
  }, 'stock rules');
  const outsiderStock = await stranger.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), out = [];
    try { await F.setDoc(F.doc(db, 'households', hid, 'items', 'x1'), { id: 'x1', name: 'x', batches: { a: { qty: 1 } } }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.updateDoc(F.doc(db, 'households', hid, 'items', 'r1'), { 'batches.a.qty': F.increment(1) }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.setDoc(F.doc(db, 'households', hid, 'events', 'evx'), { id: 'evx', type: 'use' }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.updateDoc(F.doc(db, 'households', hid, 'events', 'ev1'), { qty: 1 }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.deleteDoc(F.doc(db, 'households', hid, 'events', 'ev1')); out.push('deleted'); } catch (e) { out.push(e.code); }
    return out;
  }, hid);
  assert.deepEqual(outsiderStock, Array(5).fill('permission-denied'), 'outsider and stock: ' + outsiderStock.join(', '));
  assert.ok(await admin.get(`households/${hid}/events/ev1`), 'the outsider didn’t delete history');

  // ---- the Items list: a bulk move and a reorder racing another phone: both kept; every phone shows the same order ----
  {
    // a phone hears the other phone's last write a moment after the server has it: wait for it, then the asserts say what differs
    const settle = (ph, fn, arg) => ph.waitForFunction(fn, arg, { timeout: 15000 }).catch(() => {});
    const mk = async (id, name, extra = {}) => { await admin.put(`households/${hid}/items/${id}`, { id, name, ...base, batches: { a: { qty: 5, expiry: '2027-01-01', openedAt: null, addedAt: '2026-10-01' } }, ...extra }); await has(mum, id); await has(dad, id); };
    for (const [id, n] of [['bm1', 'Bulk 1'], ['bm2', 'Bulk 2'], ['bm3', 'Bulk 3']]) await mk(id, n);
    // A moves all three to the Garage in ONE batch while B, with no signal, uses one of them and renames another
    await net(dad, false);
    await act(dad, 'use', 'bm2', 'a'); await act(dad, 'set', 'bm3', 'name', 'Bulk 3 renamed');
    assert.equal(await act(mum, 'bulkMove', ['bm1', 'bm2', 'bm3'], 'Garage'), 3, 'three moved');
    await drain(mum);
    assert.equal((await admin.get(`households/${hid}/items/bm2`)).location, 'Garage', 'the move reached the server while B was offline');
    await net(dad, true); await drain(dad);
    for (const [id, loc, qty, name] of [['bm1', 'Garage', 5, 'Bulk 1'], ['bm2', 'Garage', 4, 'Bulk 2'], ['bm3', 'Garage', 5, 'Bulk 3 renamed']]) {
      const raw = await admin.get(`households/${hid}/items/${id}`);
      assert.equal(raw.location, loc, id + ' place'); assert.equal(raw.batches.a.qty, qty, id + ' stock'); assert.equal(raw.name, name, id + ' name');
      for (const ph of [mum, dad]) await settle(ph, ([i, w]) => { const it = window.__pantry.S.items.get(i); return JSON.stringify([it.location, it.batches[0].qty, it.name]) === w; }, [id, JSON.stringify([loc, qty, name])]);
      for (const ph of [mum, dad]) assert.deepEqual(await ph.evaluate(i => { const it = window.__pantry.S.items.get(i); return [it.location, it.batches[0].qty, it.name]; }, id), [loc, qty, name], id + ' on a phone');
    }
    // two bulk moves of the same item to different places at once: one place wins, on every phone (a field: last write)
    await net(dad, false);
    await act(dad, 'bulkMove', ['bm1'], 'Fridge'); await act(mum, 'bulkMove', ['bm1'], 'Laundry'); await drain(mum);
    await net(dad, true); await drain(dad);
    const won = (await admin.get(`households/${hid}/items/bm1`)).location;
    assert.ok(['Fridge', 'Laundry'].includes(won), 'one of the two places: ' + won);
    for (const ph of [mum, dad]) await settle(ph, w => window.__pantry.S.items.get('bm1').location === w, won);
    for (const ph of [mum, dad]) assert.equal(await ph.evaluate(() => window.__pantry.S.items.get('bm1').location), won, 'both phones agree');

    // My order: a category of four (nothing numbered yet): a move is ONE field; after an item with no number, the category is numbered in one batch
    for (const [id, n] of [['bo1', 'Pet A'], ['bo2', 'Pet B'], ['bo3', 'Pet C'], ['bo4', 'Pet D']]) await mk(id, n, { category: 'Pet' });
    const seq = async () => Ord.sortByOrder((await admin.list(`households/${hid}/items`)).filter(i => /^bo\d$/.test(i.id))).map(i => i.id).join(',');
    const phoneSeq = ph => ph.evaluate(() => [...window.__pantry.S.items.values()].filter(i => /^bo\d$/.test(i.id)).map(i => ({ id: i.id, name: i.name, order: i.order }))).then(l => Ord.sortByOrder(l).map(i => i.id).join(','));
    assert.equal(await seq(), 'bo1,bo2,bo3,bo4');
    const r1 = await act(mum, 'reorder', 'bo4', null);
    assert.equal(r1.renumbered, false); assert.deepEqual(r1.sets, [{ id: 'bo4', order: 1 }], 'to the top of a category with no numbers: ONE field on ONE item');
    await drain(mum); await drain(dad);
    assert.equal(await seq(), 'bo4,bo1,bo2,bo3');
    for (let k = 0; k < 40 && await phoneSeq(dad) !== 'bo4,bo1,bo2,bo3'; k++) await dad.waitForTimeout(250);   // (the listener delivers a moment after the write is acknowledged)
    assert.equal(await phoneSeq(dad), 'bo4,bo1,bo2,bo3', 'the other phone shows it');
    assert.deepEqual((await admin.list(`households/${hid}/items`)).filter(i => /^bo\d$/.test(i.id) && 'order' in i).map(i => i.id), ['bo4'], 'only the moved item has a number');
    const r2 = await act(mum, 'reorder', 'bo3', 'bo4');
    assert.equal(r2.sets.length, 1, 'again ONE field on ONE item'); assert.equal(r2.sets[0].order, 2); assert.equal(r2.renumbered, false);
    await drain(mum);
    const raw3 = await admin.get(`households/${hid}/items/bo3`);
    assert.deepEqual(Object.keys(raw3).filter(k => ['order', 'updatedAt', 'updatedBy'].includes(k)), ['order'], 'only the order field, no stamp');
    // a reorder racing a rename of the same item: both kept
    await net(dad, false);
    await act(dad, 'set', 'bo3', 'name', 'Pet C renamed');
    await act(mum, 'reorder', 'bo3', 'bo2'); await drain(mum);
    await net(dad, true); await drain(dad);
    const raw3b = await admin.get(`households/${hid}/items/bo3`);
    assert.equal(raw3b.name, 'Pet C renamed', 'the rename is kept'); assert.equal(typeof raw3b.order, 'number', 'and so is the move: ' + raw3b.order);
    assert.equal(await seq(), 'bo4,bo1,bo2,bo3', 'moved to just after bo2 (after an item with no number: the category got numbered)');
    // two phones put different items into the same gap at once (possibly the same number): every phone still shows one order
    await net(dad, false);
    await act(dad, 'reorder', 'bo1', 'bo4'); await act(mum, 'reorder', 'bo2', 'bo4'); await drain(mum);
    await net(dad, true); await drain(dad);
    const want = await seq();
    for (let k = 0; k < 40 && (await phoneSeq(mum) !== want || await phoneSeq(dad) !== want); k++) await mum.waitForTimeout(250);   // (the listeners deliver a moment after the writes are acknowledged)
    assert.equal(await phoneSeq(mum), want, 'mum shows the server’s order'); assert.equal(await phoneSeq(dad), want, 'dad shows the server’s order');
    // tidying the numbers (a renumber) keeps the sequence and leaves every number different
    const n = await act(mum, 'renumber', 'Pet'); await drain(mum); await drain(dad);
    assert.ok(n >= 0);
    assert.equal(await seq(), want, 'renumbering never changes the order');
    const orders = (await admin.list(`households/${hid}/items`)).filter(i => /^bo\d$/.test(i.id)).map(i => i.order);
    assert.equal(new Set(orders).size, 4, 'all different after a renumber: ' + orders.join(','));
    assert.equal(await phoneSeq(dad), want);
    for (const ph of [mum, dad]) assert.equal(await ph.evaluate(() => window.__pantry.S.refused.length), 0, 'nothing refused');
  }

  // ---- removing without losing: a delete is a marker, a change that lands on a removed thing never brings it back ----
  const rawAt = path => admin.get(`households/${hid}/${path}`);
  const hiddenOn = (p, id, kind = 'items') => p.waitForFunction(([id, kind]) => !!window.__pantry.S[kind].get(id)?.removedAt, [id, kind]);
  const liveOn = (p, id, kind = 'items') => p.waitForFunction(([id, kind]) => { const x = window.__pantry.S[kind].get(id); return !!x && !x.removedAt; }, [id, kind]);
  const seenIn = (p, name) => p.evaluate(n => [...window.__pantry.S.items.values()].some(i => !i.removedAt && i.name === n), name);
  const quiet = async () => { await drain(mum); await drain(dad); assert.equal(await mum.evaluate(() => window.__pantry.S.refused.length) + await dad.evaluate(() => window.__pantry.S.refused.length), 0, 'nothing refused'); };
  const seedRm = async (id, name = id, extra = {}) => { await admin.put(`households/${hid}/items/${id}`, { id, name, ...base, batches: { a: { qty: 4, expiry: '2027-01-01', openedAt: null, addedAt: '2026-10-01' } }, ...extra }); await has(mum, id); await has(dad, id); };
  // 1. A deletes while B (no signal) uses one: it stays hidden, B's use is in it, B is told, Restore brings it back with the use
  await seedRm('rm1', 'Rice rm');
  await net(dad, false);
  await act(mum, 'remove', 'rm1'); await drain(mum);
  await act(dad, 'use', 'rm1', 'a');   // (dad hasn't heard)
  assert.equal(typeof (await rawAt('items/rm1')).removedAt, 'string', 'the item is still there, marked');
  await net(dad, true);
  await hiddenOn(dad, 'rm1'); await quiet();
  const rm1 = await rawAt('items/rm1');
  assert.equal(rm1.batches.a.qty, 3, 'B’s use landed on the hidden item'); assert.equal(typeof rm1.removedBy, 'string');
  assert.equal(await seenIn(mum, 'Rice rm'), false); assert.equal(await seenIn(dad, 'Rice rm'), false, 'hidden on both phones');
  await go(dad, '#/');
  await dad.locator('#pa-landed').waitFor();
  assert.match(await dad.locator('#pa-landed').textContent(), /Rice rm: this was removed on another phone; find it in Recently removed/);
  assert.equal(await mum.locator('#pa-landed').count(), 0, 'the phone that removed it is not told');
  if (process.env.SHOTS) await dad.screenshot({ path: process.env.SHOTS + '/r02-removed-note-live.png' });
  await dad.click('#pa-landed'); await settle(dad);
  const row1 = dad.locator('#pa-removed .ha-row', { hasText: 'Rice rm' });
  assert.match(await row1.locator('.ha-row-sub').textContent(), /Fridge · Removed by .* · (30|29) days left · Your change is kept/);
  await go(dad, '#/'); assert.equal(await dad.locator('#pa-landed').count(), 0, 'the note goes once Recently removed has been opened');
  await go(dad, '#/removed');
  await dad.locator('#pa-removed .ha-row', { hasText: 'Rice rm' }).locator('[data-act="restore"]').click(); await settle(dad);
  await liveOn(mum, 'rm1'); await quiet();
  const rm1b = await rawAt('items/rm1');
  assert.ok(!('removedAt' in rm1b) && !('removedBy' in rm1b), 'Restore clears both fields'); assert.equal(rm1b.batches.a.qty, 3, 'with the use');
  assert.equal(await seenIn(mum, 'Rice rm'), true, 'and it is back on the other phone');
  // 2. A edits while B deletes: the delete wins visibility, the edit is kept, Restore shows it
  await seedRm('rm2', 'Oats rm');
  await Promise.all([act(mum, 'set', 'rm2', 'name', 'Oats renamed'), act(dad, 'remove', 'rm2')]);
  await quiet(); await hiddenOn(mum, 'rm2'); await hiddenOn(dad, 'rm2');
  assert.equal((await rawAt('items/rm2')).name, 'Oats renamed'); assert.equal(await seenIn(mum, 'Oats renamed'), false);
  await act(mum, 'restore', 'rm2'); await quiet(); await liveOn(dad, 'rm2');
  assert.equal(await seenIn(dad, 'Oats renamed'), true, 'Restore shows the edit');
  // 3. both delete: the same marker twice, nothing refused, one Restore puts it back
  await seedRm('rm3', 'Tea rm');
  await Promise.all([act(mum, 'remove', 'rm3'), act(dad, 'remove', 'rm3')]); await quiet();
  await hiddenOn(mum, 'rm3'); await hiddenOn(dad, 'rm3');
  assert.equal(typeof (await rawAt('items/rm3')).removedAt, 'string');
  await act(dad, 'restore', 'rm3'); await quiet(); await liveOn(mum, 'rm3');
  // 4. Undo of a delete (the toast) is a Restore: another phone's change meanwhile is kept
  await seedRm('rm4', 'Salt rm');
  await go(mum, '#/item/rm4');
  await mum.click('[data-act="delete"]'); await settle(mum);
  await hiddenOn(dad, 'rm4');
  await act(dad, 'use', 'rm4', 'a'); await drain(dad);   // B hasn't been told in time: it uses one on the hidden item
  await mum.locator('.ha-toast-action').click(); await settle(mum); await quiet();
  await liveOn(dad, 'rm4');
  const rm4 = await rawAt('items/rm4');
  assert.ok(!('removedAt' in rm4)); assert.equal(rm4.batches.a.qty, 3, 'Undo kept the other phone’s use');
  // a delete from the item screen keeps its history and photo; Recently removed shows it with the days left
  await go(mum, '#/item/rm4'); await mum.click('[data-act="delete"]'); await settle(mum); await quiet();
  assert.ok(await rawAt('items/rm4'), 'the document is still there');
  await go(mum, '#/settings');
  assert.match(await mum.locator('#h-removed').locator('xpath=..').textContent(), /3 things you can put back/);   // two items and the place removed in the places section above
  // 5. the shopping list: tick vs remove (both orders), two ticks, a new line while another is removed
  const lines = {};
  for (const k of ['l1', 'l2', 'l3', 'l4', 'l5']) { lines[k] = await act(mum, 'addLine', 'Line ' + k); }
  await drain(mum);
  for (const k of Object.keys(lines)) { await liveOn(dad, lines[k], 'shop'); }
  const rl = k => rawAt('shop/' + lines[k]);
  await Promise.all([act(mum, 'tick', lines.l1, true), act(dad, 'removeLine', lines.l1)]); await quiet();   // tick and remove together
  await hiddenOn(mum, lines.l1, 'shop'); await hiddenOn(dad, lines.l1, 'shop');
  assert.equal((await rl('l1')).done, true, 'the tick is kept on the removed line'); assert.equal(typeof (await rl('l1')).removedAt, 'string');
  await act(dad, 'removeLine', lines.l2); await drain(dad); await hiddenOn(mum, lines.l2, 'shop');   // remove, then a tick from a phone that hadn't heard
  await mum.evaluate(id => { window.__pantry.S.shop.set(id, { ...window.__pantry.S.shop.get(id), removedAt: undefined }); }, lines.l2);   // (its copy is a moment old)
  await act(mum, 'tick', lines.l2, true); await quiet();
  assert.equal((await rl('l2')).done, true); assert.equal(typeof (await rl('l2')).removedAt, 'string', 'a tick never brings a removed line back');
  await Promise.all([act(mum, 'tick', lines.l3, true), act(dad, 'tick', lines.l3, true)]); await quiet();   // both tick: fine
  assert.equal((await rl('l3')).done, true); assert.ok(!(await rl('l3')).removedAt);
  const [added] = await Promise.all([act(mum, 'addLine', 'New line while removing'), act(dad, 'removeLine', lines.l4)]);   // a new line and a removal: both kept
  await quiet(); await liveOn(dad, added, 'shop'); await hiddenOn(mum, lines.l4, 'shop');
  assert.equal((await rawAt('shop/' + added)).name, 'New line while removing'); assert.equal(typeof (await rl('l4')).removedAt, 'string');
  // lines with a marker are hidden everywhere (the list, the badge, the share text) and Restore puts them back, ticked as they were
  await go(mum, '#/shop');
  assert.equal(await mum.locator('#main label.ha-row', { hasText: 'Line l1' }).count(), 0, 'a removed line is not on the list');
  assert.equal(await mum.locator('#main label.ha-row', { hasText: 'Line l3' }).count(), 1);
  assert.ok(!(await mum.evaluate(() => document.querySelector('#pa-wa-going')?.href || '')).includes('Line%20l1'), 'nor in the WhatsApp text');
  await go(mum, '#/removed');
  assert.equal(await mum.locator('#pa-removed-lines .ha-row').count(), 3, 'the three removed lines are in Recently removed');
  await mum.locator('#pa-removed-lines .ha-row', { hasText: 'Line l1' }).locator('[data-act="restore"]').click(); await settle(mum); await quiet();
  await liveOn(dad, lines.l1, 'shop');
  assert.ok(!(await rl('l1')).removedAt && (await rl('l1')).done === true, 'Restore keeps the tick');
  // renaming a line is a field too
  await act(dad, 'rename', lines.l5, 'Line five'); await quiet();
  await mum.waitForFunction(id => window.__pantry.S.shop.get(id).name === 'Line five', lines.l5);
  assert.equal((await rl('l5')).name, 'Line five');
  // the line on the screen: Undo of a remove is Restore
  await go(mum, '#/shop');
  await mum.locator('#main label.ha-row', { hasText: 'Line five' }).locator('[data-act="shop-del"]').click(); await settle(mum);
  assert.equal(await mum.locator('#main label.ha-row', { hasText: 'Line five' }).count(), 0);
  if (process.env.SHOTS) await mum.screenshot({ path: process.env.SHOTS + '/r03-shop-live.png' });
  await mum.locator('.ha-toast-action').click(); await settle(mum); await quiet();
  assert.ok(!(await rl('l5')).removedAt, 'Undo cleared the marker'); assert.equal(await mum.locator('#main label.ha-row', { hasText: 'Line five' }).count(), 1);
  // 6. the sweep: only what was removed more than 30 days ago, and a second phone's sweep is harmless
  const oldAt = new Date(Date.now() - 40 * 86400000).toISOString(), recent = new Date(Date.now() - 5 * 86400000).toISOString();
  await seedRm('sw-old', 'Swept', { removedAt: oldAt, removedBy: 'Mum', hasPhoto: true, thumb: 'data:image/jpeg;base64,AAAA' });
  await seedRm('sw-new', 'Not yet', { removedAt: recent, removedBy: 'Mum' });
  await seedRm('sw-live', 'Live one');
  await admin.put(`households/${hid}/photos/sw-old`, { id: 'sw-old', data: 'data:image/jpeg;base64,BBBB', updatedAt: 'x' });
  await admin.put(`households/${hid}/events/sw-ev1`, { id: 'sw-ev1', itemId: 'sw-old', type: 'add', qty: 1, at: oldAt, by: 'Mum' });
  await admin.put(`households/${hid}/events/sw-ev2`, { id: 'sw-ev2', itemId: 'sw-new', type: 'add', qty: 1, at: recent, by: 'Mum' });
  await admin.put(`households/${hid}/shop/sw-oldl`, { id: 'sw-oldl', name: 'Old line', done: true, removedAt: oldAt, removedBy: 'Mum' });
  await admin.put(`households/${hid}/shop/sw-newl`, { id: 'sw-newl', name: 'New line', done: false, removedAt: recent, removedBy: 'Mum' });
  for (const [k, id] of [['items', 'sw-old'], ['items', 'sw-new'], ['shop', 'sw-oldl'], ['shop', 'sw-newl']]) { await mum.waitForFunction(([k, id]) => window.__pantry.S[k].has(id), [k, id]); await dad.waitForFunction(([k, id]) => window.__pantry.S[k].has(id), [k, id]); await mum.waitForFunction(([k, id]) => window.__pantry.S[k].has(id), [k, id]); }
  await dad.waitForFunction(() => window.__pantry.S.events.has('sw-ev1'));
  const [n1, n2] = [await act(mum, 'sweep'), await act(dad, 'sweep')];   // two phones sweep at once (dad hadn't heard it was done)
  assert.equal(n1 + n2 >= 2 && n1 + n2 <= 4, true, `swept ${n1} + ${n2}`);
  await quiet();
  assert.equal(await rawAt('items/sw-old'), null, 'older than 30 days: deleted'); assert.equal(await rawAt('photos/sw-old'), null, 'with its photo');
  assert.equal(await rawAt('events/sw-ev1'), null, 'and its history'); assert.equal(await rawAt('shop/sw-oldl'), null, 'an old removed shopping line too');
  assert.ok(await rawAt('items/sw-new'), 'newer than 30 days: kept'); assert.ok(await rawAt('events/sw-ev2')); assert.ok(await rawAt('shop/sw-newl'));
  assert.ok(await rawAt('items/sw-live'), 'a live item is never swept');
  assert.equal(await act(dad, 'sweep'), 0, 'a third sweep finds nothing');
  // a Restore elsewhere wins over a phone whose copy is old: the sweep checks the server first
  await seedRm('sw-race', 'Race', { removedAt: oldAt, removedBy: 'Mum' });
  await admin.put(`households/${hid}/items/sw-race`, { id: 'sw-race', name: 'Race', ...base, batches: { a: { qty: 4, expiry: '2027-01-01' } } });   // restored on another phone
  await dad.evaluate(id => { const S = window.__pantry.S; S.items.set(id, { ...S.items.get(id), removedAt: new Date(Date.now() - 40 * 86400000).toISOString() }); }, 'sw-race');   // dad's copy still says removed
  assert.equal(await act(dad, 'sweep'), 0, 'not deleted: it was put back');
  assert.ok(await rawAt('items/sw-race'));
  // the sweep runs by itself once a day: lastSweep says when
  await mum.evaluate(() => localStorage.removeItem('pantry:lastSweep'));

  // ---- the rules for removed things and shopping lines ----
  const removedRules = await mum.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), d = (...p) => F.doc(db, 'households', hid, ...p);
    const out = {};
    const tryIt = async (name, fn) => { try { await fn(); out[name] = 'ok'; } catch (e) { out[name] = e.code; } };
    const at = '2026-10-16T01:02:03.000Z';
    const item = (id, extra = {}) => ({ id, name: 'Rules ' + id, batches: {}, ...extra });
    await tryIt('item removed', () => F.setDoc(d('items', 'x1'), item('x1', { removedAt: at, removedBy: 'Dad' })));
    await tryIt('item removed by field', () => F.updateDoc(d('items', 'x1'), { removedAt: '2026-10-17T00:00:00.000Z', removedBy: 'Mum' }));
    await tryIt('item restored', () => F.updateDoc(d('items', 'x1'), { removedAt: F.deleteField(), removedBy: F.deleteField() }));
    await tryIt('item removed by field again', () => F.updateDoc(d('items', 'x1'), { removedAt: at, removedBy: '' }));
    await tryIt('a use on a removed item', () => F.setDoc(d('items', 'x2'), item('x2', { removedAt: at, removedBy: 'Dad', batches: { a: { qty: 2 } } })).then(() => F.updateDoc(d('items', 'x2'), { 'batches.a.qty': F.increment(-1) })));
    await tryIt('removedBy 40 characters', () => F.updateDoc(d('items', 'x1'), { removedBy: 'x'.repeat(40) }));
    await tryIt('removedBy 41 characters', () => F.updateDoc(d('items', 'x1'), { removedBy: 'x'.repeat(41) }));
    await tryIt('removedBy a number', () => F.updateDoc(d('items', 'x1'), { removedBy: 5 }));
    await tryIt('removedBy null', () => F.updateDoc(d('items', 'x1'), { removedBy: null }));
    await tryIt('removedAt a number', () => F.updateDoc(d('items', 'x1'), { removedAt: 1760000000000 }));
    await tryIt('removedAt null', () => F.updateDoc(d('items', 'x1'), { removedAt: null }));
    await tryIt('removedAt not a time', () => F.updateDoc(d('items', 'x1'), { removedAt: 'yesterday' }));
    await tryIt('removedAt 41 characters', () => F.updateDoc(d('items', 'x1'), { removedAt: '2026-10-16T' + '0'.repeat(29) + 'Z' }));
    await tryIt('removedAt a boolean', () => F.setDoc(d('items', 'x3'), item('x3', { removedAt: true })));
    await tryIt('removedAt a map', () => F.setDoc(d('items', 'x4'), item('x4', { removedAt: { a: 1 } })));
    // the item can still be deleted for good (the sweep, merging)
    await tryIt('item deleted for good', () => F.deleteDoc(d('items', 'x2')));
    // shopping lines
    const line = (id, extra = {}) => ({ id, name: 'Milk', done: false, at, by: 'Mum', itemId: null, ...extra });
    await tryIt('line created', () => F.setDoc(d('shop', 'y1'), line('y1')));
    await tryIt('line with an item', () => F.setDoc(d('shop', 'y2'), line('y2', { itemId: 'abc123', doneBy: 'Dad' })));
    await tryIt('line without optional fields (an old phone)', () => F.setDoc(d('shop', 'y3'), { id: 'y3', name: 'Eggs', done: true }));
    await tryIt('line whole again (an old phone)', () => F.setDoc(d('shop', 'y1'), line('y1', { done: true })));
    await tryIt('tick by field', () => F.updateDoc(d('shop', 'y1'), { done: true, doneBy: 'Dad' }));
    await tryIt('rename by field', () => F.updateDoc(d('shop', 'y1'), { name: 'Oat milk' }));
    await tryIt('remove by field', () => F.updateDoc(d('shop', 'y1'), { removedAt: at, removedBy: 'Dad' }));
    await tryIt('restore by field', () => F.updateDoc(d('shop', 'y1'), { removedAt: F.deleteField(), removedBy: F.deleteField() }));
    await tryIt('name 80 characters', () => F.setDoc(d('shop', 'y4'), line('y4', { name: 'x'.repeat(80) })));
    await tryIt('name 81 characters', () => F.setDoc(d('shop', 'y5'), line('y5', { name: 'x'.repeat(81) })));
    await tryIt('name a number', () => F.setDoc(d('shop', 'y6'), line('y6', { name: 5 })));
    await tryIt('no name', () => F.setDoc(d('shop', 'y7'), { id: 'y7', done: false }));
    await tryIt('done a string', () => F.setDoc(d('shop', 'y8'), line('y8', { done: 'yes' })));
    await tryIt('no done', () => F.setDoc(d('shop', 'y9'), { id: 'y9', name: 'x' }));
    await tryIt('an unknown field', () => F.setDoc(d('shop', 'y10'), line('y10', { colour: 'red' })));
    await tryIt('an unknown field by update', () => F.updateDoc(d('shop', 'y1'), { colour: 'red' }));
    await tryIt('the old `text` field', () => F.setDoc(d('shop', 'y11'), { id: 'y11', text: 'Milk', done: false }));
    await tryIt('an id that is not the document’s', () => F.setDoc(d('shop', 'y12'), line('other')));
    await tryIt('itemId a number', () => F.setDoc(d('shop', 'y13'), line('y13', { itemId: 5 })));
    await tryIt('by 201 characters', () => F.setDoc(d('shop', 'y14'), line('y14', { by: 'x'.repeat(201) })));
    await tryIt('name too long by update', () => F.updateDoc(d('shop', 'y1'), { name: 'x'.repeat(81) }));
    await tryIt('done a string by update', () => F.updateDoc(d('shop', 'y1'), { done: 'yes' }));
    await tryIt('line removedBy 41 characters', () => F.updateDoc(d('shop', 'y1'), { removedBy: 'x'.repeat(41) }));
    await tryIt('line removedAt a number', () => F.updateDoc(d('shop', 'y1'), { removedAt: 5 }));
    await tryIt('line removedAt not a time', () => F.updateDoc(d('shop', 'y1'), { removedAt: 'soon' }));
    await tryIt('line deleted for good', () => F.deleteDoc(d('shop', 'y4')));
    return out;
  }, hid);
  const D = 'permission-denied';
  assert.deepEqual(removedRules, {
    'item removed': 'ok', 'item removed by field': 'ok', 'item restored': 'ok', 'item removed by field again': 'ok', 'a use on a removed item': 'ok',
    'removedBy 40 characters': 'ok', 'removedBy 41 characters': D, 'removedBy a number': D, 'removedBy null': D,
    'removedAt a number': D, 'removedAt null': D, 'removedAt not a time': D, 'removedAt 41 characters': D, 'removedAt a boolean': D, 'removedAt a map': D,
    'item deleted for good': 'ok',
    'line created': 'ok', 'line with an item': 'ok', 'line without optional fields (an old phone)': 'ok', 'line whole again (an old phone)': 'ok',
    'tick by field': 'ok', 'rename by field': 'ok', 'remove by field': 'ok', 'restore by field': 'ok', 'name 80 characters': 'ok', 'name 81 characters': D,
    'name a number': D, 'no name': D, 'done a string': D, 'no done': D, 'an unknown field': D, 'an unknown field by update': D, 'the old `text` field': D,
    'an id that is not the document’s': D, 'itemId a number': D, 'by 201 characters': D, 'name too long by update': D, 'done a string by update': D,
    'line removedBy 41 characters': D, 'line removedAt a number': D, 'line removedAt not a time': D, 'line deleted for good': 'ok',
  }, 'removed and shopping line rules');
  const outsiderRemoved = await stranger.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), d = (...p) => F.doc(db, 'households', hid, ...p), out = [];
    const t = async fn => { try { await fn(); out.push('wrote'); } catch (e) { out.push(e.code); } };
    await t(() => F.updateDoc(d('items', 'x1'), { removedAt: '2026-10-16T01:02:03.000Z', removedBy: 'Evil' }));
    await t(() => F.updateDoc(d('items', 'x1'), { removedAt: F.deleteField() }));
    await t(() => F.setDoc(d('shop', 'z1'), { id: 'z1', name: 'x', done: false }));
    await t(() => F.updateDoc(d('shop', 'y1'), { done: true }));
    await t(() => F.updateDoc(d('shop', 'y1'), { removedAt: '2026-10-16T01:02:03.000Z', removedBy: 'Evil' }));
    await t(() => F.deleteDoc(d('shop', 'y1')));
    await t(() => F.deleteDoc(d('items', 'x1')));
    return out;
  }, hid);
  assert.deepEqual(outsiderRemoved, Array(7).fill(D), 'outsider and removed things: ' + outsiderRemoved.join(', '));
  assert.ok(await rawAt('items/x1') && await rawAt('shop/y1'), 'the outsider deleted nothing');

  // ---- merging two pantries for one email (owner: "merge duplicate emails into 1 pantry") ----
  const KINDS5 = ['items', 'events', 'shop', 'photos'];
  const seedPantry = async (id, owner, members, tag, { items = 2, extra = {} } = {}) => {
    await admin.put(`households/${id}`, { name: 'Our pantry', owner, members, createdAt: '2026-10-16T00:00:00.000Z' });
    for (let i = 0; i < items; i++) {
      await admin.put(`households/${id}/items/${tag}i${i}`, { id: `${tag}i${i}`, name: `${tag} item ${i}`, batches: i === 0 ? [{ id: `${tag}q`, qty: 2, expiry: null }] : [], hasPhoto: true, thumb: 'data:image/jpeg;base64,AAAA', ...extra });
      await admin.put(`households/${id}/photos/${tag}i${i}`, { id: `${tag}i${i}`, data: 'data:image/jpeg;base64,BBBB', updatedAt: 'x' });
    }
    await admin.put(`households/${id}/events/${tag}e1`, { id: `${tag}e1`, itemId: `${tag}i0`, type: 'add', at: '2026-10-16T00:00:00.000Z' });
    await admin.put(`households/${id}/shop/${tag}s1`, { id: `${tag}s1`, name: `${tag} milk`, done: false });
    if (tag === 'A') {   // A has place documents (one removed 5 days ago, one removed 40 days ago); the others only the old single list
      const ago = d => new Date(Date.now() - d * 86400000).toISOString();
      for (const [pid, name, order, rm] of [['pAf', 'Fridge', 1], ['pAg', 'Garage', 2], ['pAs', 'Shed', 3, ago(5)], ['pAo', 'Ancient', 4, ago(40)]]) await admin.put(`households/${id}/places/${pid}`, { id: pid, name, order, updatedAt: 'x', ...(rm ? { removedAt: rm, removedBy: 'Dad' } : {}) });
    } else await admin.put(`households/${id}/settings/places`, { id: 'places', list: ['Fridge', 'Cellar'], updatedAt: 'x' });
    await admin.put(`households/${id}/settings/people`, { id: 'people', names: Object.fromEntries(members.map(m => [m, tag + ':' + m.split('@')[0]])), updatedAt: 'x' });
  };
  // two pantries, both started by twin: the bigger one is kept, everything of the other moves in
  await seedPantry('dupA', 'twin@example.com', ['twin@example.com', 'pal1@example.com'], 'A');
  await seedPantry('dupB', 'twin@example.com', ['twin@example.com', 'pal2@example.com', 'pal3@example.com'], 'B', { items: 3 });
  const twin = await person('twin@example.com');
  await twin.locator('#main [data-act="merge-open"]').waitFor();
  assert.equal(await twin.evaluate(() => window.__pantry.S.household.id), 'dupB', 'the bigger one opens');
  await go(twin, '#/');
  await twin.locator('a.pa-alert', { hasText: 'more than one family pantry' }).waitFor();
  await go(twin, '#/settings');
  await twin.click('[data-act="merge-open"]'); await settle(twin);
  const sheet = twin.locator('dialog.ha-sheet[open]');
  assert.equal(await sheet.locator('input[name="pa-keep"]').count(), 2);
  assert.equal(await sheet.locator('input[name="pa-keep"]:checked').getAttribute('value'), 'dupB', 'most people preselected');
  assert.match(await sheet.textContent(), /3 people/);
  assert.match(await sheet.textContent(), /2 people/);
  if (process.env.SHOTS) await twin.screenshot({ path: process.env.SHOTS + '/m07-merge.png' });
  await sheet.locator('[data-pm="go"]').click(); await settle(twin);
  await twin.locator('dialog[open] button', { hasText: /^Merge$/ }).click();
  await twin.locator('.ha-toast', { hasText: 'Merged' }).waitFor();
  await settle(twin);
  assert.equal(await admin.get('households/dupA'), null, 'the other household is gone');
  for (const k of [...KINDS5, 'places', 'settings']) assert.equal((await admin.list(`households/dupA/${k}`)).length, 0, 'dupA ' + k + ' deleted');
  const kept = await admin.get('households/dupB');
  assert.deepEqual(kept.members, ['twin@example.com', 'pal2@example.com', 'pal3@example.com', 'pal1@example.com'], 'members joined');
  assert.equal(kept.owner, 'twin@example.com');
  const counts = {};
  for (const k of KINDS5) counts[k] = (await admin.list(`households/dupB/${k}`)).length;
  assert.deepEqual(counts, { items: 5, events: 2, shop: 2, photos: 5 }, 'everything of both is in the kept pantry');
  // an item still holding the old array of batches arrives in the new shape (the merge copies through the one door)
  const arrived = await admin.get('households/dupB/items/Ai0');
  assert.ok(arrived.batches && !Array.isArray(arrived.batches) && arrived.batches.Aq?.qty === 2, 'the old array became a map: ' + JSON.stringify(arrived.batches));
  // places: B (kept) only had the old list, so its places became documents, then A's new name after them (merged by name)
  const merged = (await admin.list('households/dupB/places')).sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));
  assert.deepEqual(merged.map(d => d.name), ['Fridge', 'Cellar', 'Garage', 'Shed'], 'places merged by name, the kept pantry’s first; a recently removed one comes too, one removed 40 days ago does not');
  assert.deepEqual(merged.map(d => d.order), [1, 2, 3, 3]);
  assert.ok(merged[3].removedAt && merged[3].removedBy === 'Dad', 'with its marker');
  assert.equal(await twin.evaluate(() => window.__pantry.places().join()), 'Fridge,Cellar,Garage', 'and the app shows the live ones');
  const names = (await admin.get('households/dupB/settings/people')).names;
  assert.deepEqual(names, { 'twin@example.com': 'B:twin', 'pal2@example.com': 'B:pal2', 'pal3@example.com': 'B:pal3', 'pal1@example.com': 'A:pal1' }, 'names joined, the kept pantry’s names win');
  assert.equal(await twin.evaluate(() => window.__pantry.S.pantries.length), 1);
  assert.equal(await twin.locator('[data-act="merge-open"]').count(), 0, 'the card is gone');
  assert.equal(await twin.evaluate(() => [...window.__pantry.S.items.values()].length), 5, 'the app shows all five items');
  await twin.reload(); await twin.waitForFunction(() => window.__pantry?.S.household?.id === 'dupB');
  assert.equal(await twin.evaluate(() => window.__pantry.S.pantries.length), 1);

  // someone else's pantry can't be merged away by a member (and the rules say the same)
  await seedPantry('dupC', 'boss@example.com', ['boss@example.com', 'twin2@example.com'], 'C');
  await seedPantry('dupD', 'twin2@example.com', ['twin2@example.com'], 'D');
  const twin2 = await person('twin2@example.com');
  await twin2.locator('#main [data-act="merge-open"]').waitFor();
  await twin2.click('[data-act="merge-open"]'); await settle(twin2);
  const sh2 = twin2.locator('dialog.ha-sheet[open]');
  await sh2.locator('input[name="pa-keep"][value="dupD"]').check(); await settle(twin2);
  assert.match(await sh2.textContent(), /Only whoever started a pantry can merge it away\. Ask C:boss to merge them/);
  assert.equal(await sh2.locator('[data-pm="go"]').isDisabled(), true);
  const denyDelete = await twin2.evaluate(async () => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    try { await F.deleteDoc(F.doc(F.getFirestore(), 'households', 'dupC')); return 'deleted'; } catch (e) { return e.code; }
  });
  assert.equal(denyDelete, 'permission-denied', 'a member who isn’t the owner can’t delete the household');
  assert.ok(await admin.get('households/dupC'), 'still there');
  await sh2.locator('[data-ha-close]').click(); await settle(twin2);

  // a copy that fails deletes nothing: an item the rules refuse (thumbnail over 12 KB) stops the merge
  await seedPantry('dupE', 'twin3@example.com', ['twin3@example.com'], 'E', { extra: { thumb: 'A'.repeat(13000) } });
  await seedPantry('dupF', 'twin3@example.com', ['twin3@example.com', 'x1@example.com'], 'F');
  const twin3 = await person('twin3@example.com');
  await twin3.locator('#main [data-act="merge-open"]').waitFor();
  await twin3.click('[data-act="merge-open"]'); await settle(twin3);
  await twin3.locator('dialog.ha-sheet[open] [data-pm="go"]').click(); await settle(twin3);
  await twin3.locator('dialog[open] button', { hasText: /^Merge$/ }).click();
  await twin3.locator('#pa-merge-msg', { hasText: 'Nothing was lost' }).waitFor();
  assert.ok(await admin.get('households/dupE'), 'the other pantry is still there');
  assert.equal((await admin.list('households/dupE/items')).length, 2, 'and its items');
  assert.equal((await admin.list('households/dupE/photos')).length, 2, 'and its photos');
  assert.ok(await admin.get('households/dupF'));

  // ---- the chip tells the truth; Sync now; the name moves into Family sharing (PR-D) ----
  {
    const proxy = await stallProxy();
    const pUrl = srv.url + `/pantry/?emulator=${proxy.port}:9099`;
    const sy = await person('syncy@example.com', pUrl, { init: () => { try { localStorage.setItem('pantry:name', JSON.stringify('Jun')); } catch { /* */ } } });
    // (a) Settings → You → Your name is gone in a family pantry; before signing in it was there (adopted below)
    if (process.env.PROGRESS) console.log('  chip block a');
    assert.equal(await sy.locator('#pa-name').count(), 1, 'signed in but in no pantry yet: the field is still there');
    await sy.click('[data-act="hh-create"]');
    await sy.locator('#main .ha-row-title', { hasText: 'Our pantry' }).waitFor();
    const shid = await sy.evaluate(() => window.__pantry.S.household.id);
    assert.equal(await sy.locator('#pa-name').count(), 0, 'no “Your name” field in Settings');
    assert.equal(await sy.locator('#h-you').count(), 0, 'no You section');
    // the name this phone had saved became the family's name for it, once
    await sy.waitForFunction(() => window.__pantry.S.settings.get('people')?.names?.['syncy@example.com'] === 'Jun', null, { timeout: 15000 });
    await sy.waitForFunction(() => window.__pantry.S.sync.pending === 0);
    assert.equal((await admin.get(`households/${shid}/settings/people`)).names['syncy@example.com'], 'Jun', 'adopted as the family name');
    assert.deepEqual(await sy.evaluate(() => JSON.parse(localStorage.getItem('pantry:nameAdopted'))), { [shid]: true }, 'adopted once: the flag is kept');
    await sy.locator('[data-act="person"][data-v="syncy@example.com"] .ha-row-title', { hasText: 'Jun' }).waitFor();
    if (process.env.SHOTS) { await sy.evaluate(() => { document.querySelector('.ha-toast')?.classList.remove('is-visible'); scrollTo(0, document.querySelector('section[aria-labelledby="h-family"]').offsetTop - 70); }); await settle(sy); await sy.screenshot({ path: process.env.SHOTS + '/p02-family.png' }); await sy.screenshot({ path: process.env.SHOTS + '/p02-family-full.png', fullPage: true }); }
    // cleared by the family, it is not adopted again, even after a reload
    await act(sy, 'namePerson', 'syncy@example.com', '');
    await sy.waitForFunction(() => window.__pantry.S.sync.pending === 0);
    await sy.reload(); await sy.waitForFunction(() => window.__pantry?.S?.household?.id);
    await settle(sy); await settle(sy);
    assert.equal(await sy.evaluate(() => window.__pantry.S.settings.get('people')?.names?.['syncy@example.com'] ?? ''), '', 'not adopted again');
    // a family that already has a name for the account keeps it: the phone's own name is not adopted over it
    await admin.put(`households/${shid}/settings/people`, { id: 'people', names: { 'syncy2@example.com': 'Ah Mei' }, updatedAt: 'x' });
    await admin.put(`households/${shid}`, { name: 'Our pantry', owner: 'syncy@example.com', members: ['syncy@example.com', 'syncy2@example.com'], createdAt: '2026-10-16T00:00:00.000Z' });
    const sy2 = await person('syncy2@example.com', url, { init: () => { try { localStorage.setItem('pantry:name', JSON.stringify('Someone else')); } catch { /* */ } } });
    await sy2.waitForFunction(() => window.__pantry.S.household?.id);
    await settle(sy2); await settle(sy2);
    assert.equal((await admin.get(`households/${shid}/settings/people`)).names['syncy2@example.com'], 'Ah Mei', 'the family’s name wins');
    assert.equal(await sy2.evaluate(() => (JSON.parse(localStorage.getItem('pantry:nameAdopted')) || {})[window.__pantry.S.household.id]), true);
    // signed out (this phone's own pantry) the field is back
    await go(sy, '#/settings');
    await sy.click('[data-act="signout"]'); await sy.locator('[data-act="signin"]').waitFor();
    assert.equal(await sy.locator('#pa-name').count(), 1, 'the field is back on this phone alone');
    assert.equal(await sy.inputValue('#pa-name'), 'Jun');
    await sy.evaluate(e => window.__pantry.signIn(e), 'syncy@example.com');
    await sy.waitForFunction(() => window.__pantry.S.household?.id);
    await go(sy, '#/settings');
    const base = { category: 'Other', location: 'Fridge', brand: '', size: '', barcode: '', lowAt: 0, openDays: 7, createdAt: '2026-10-16T00:00:00.000Z', createdBy: 'Mum' };
    await admin.put(`households/${shid}/items/sy1`, { id: 'sy1', name: 'Rice', ...base, batches: { b1: { qty: 5, expiry: null } } });
    await sy.waitForFunction(() => window.__pantry.S.items.has('sy1'));

    // (b) the chip tells the truth. The phone's change is acknowledged, but what it listens to is cut off, so the SDK keeps the
    if (process.env.PROGRESS) console.log('  chip block b');
    // document flagged `hasPendingWrites` ("committed mutations") for good: the chip used to read that as "Waiting for signal".
    // (a listener made before the write, as the app's own is: a listener made after it never sees the flag)
    await sy.evaluate(async ([u, hid]) => {
      const F = await import(u), db = F.getFirestore();
      window.__flag = null;
      F.onSnapshot(F.doc(db, 'households', hid, 'items', 'sy1'), { includeMetadataChanges: true }, s => { window.__flag = s.metadata.hasPendingWrites; });
    }, [FSJS, shid]);
    proxy.set({ listen: true });
    await settle(sy);
    await act(sy, 'set', 'sy1', 'notes', 'one');
    await sy.waitForFunction(() => window.__pantry.S.sync.pending === 0, null, { timeout: 8000 });
    await sy.waitForTimeout(1500);
    const flag = await sy.evaluate(() => window.__flag);
    assert.equal(flag, true, 'the premise: the SDK still flags the document as having pending writes after the server acknowledged it, while its listener is cut off');
    await settle(sy); await settle(sy); await sy.waitForTimeout(1200);
    assert.equal(await sy.locator('[data-sync] .ha-badge').first().textContent(), 'Saved', 'acknowledged, so Saved, whatever the listener says');
    assert.equal((await admin.get(`households/${shid}/items/sy1`)).notes, 'one', 'the server has it');
    proxy.set({ listen: false });
    await sy.waitForFunction(() => window.__pantry.S.items.get('sy1')?.notes === 'one');

    // (c) Sync now: the server hears every change but its acknowledgements never arrive: the phone truly cannot tell
    if (process.env.PROGRESS) console.log('  chip block c');
    proxy.set({ write: true });
    await act(sy, 'set', 'sy1', 'name', 'Rice (new)');
    await act(sy, 'namePerson', 'syncy@example.com', 'Jun');
    await act(sy, 'addPlace', 'Shed');
    await sy.waitForFunction(() => window.__pantry.S.sync.pending === 3, null, { timeout: 8000 });
    await sy.locator('[data-sync] .ha-badge--warn', { hasText: 'Waiting for signal (3 changes)' }).waitFor({ timeout: 8000 });
    await go(sy, '#/settings');
    await sy.click('#pa-syncnow');
    await sy.locator('.pa-syncnow-result--waiting', { hasText: 'Still waiting: this phone can’t reach the family right now' }).waitFor({ timeout: 20000 });
    const lines = await sy.locator('.pa-waiting .ha-row-title').allTextContents();
    assert.deepEqual(lines.sort(), ['A change to Rice (new)', 'Added place Shed', 'Name for Jun'], 'each waiting change in words');
    assert.equal(await sy.locator('#pa-heard').count(), 1);
    assert.match(await sy.locator('#pa-heard').textContent(), /^Last heard from the family: (just now|at \d)/, 'last heard from the family');
    assert.equal(await sy.locator('[data-act="sync-cycle"]').count(), 1, 'offers one reconnect');
    await axe(sy, 'Settings: Sync now, still waiting, with the list');
    if (process.env.SHOTS) { await sy.locator('section[aria-labelledby="h-saving"]').scrollIntoViewIfNeeded(); await sy.evaluate(() => scrollTo(0, document.querySelector('section[aria-labelledby="h-saving"]').offsetTop - 70)); await settle(sy); await sy.screenshot({ path: process.env.SHOTS + '/p01-sync-now.png' }); }
    // the server already has all three
    assert.equal((await admin.get(`households/${shid}/items/sy1`)).name, 'Rice (new)');
    // Reconnect and try again: one switch off and on; nothing breaks, and still nothing is heard back
    await sy.click('[data-act="sync-cycle"]');
    await sy.locator('.pa-syncnow-result--waiting').waitFor({ timeout: 30000 });
    await sy.locator('#pa-syncnow .ha-row-title', { hasText: 'Sync now' }).waitFor();
    assert.equal(await sy.locator('[data-act="sync-cycle"]').count(), 0, 'only one reconnect is offered');
    // the acknowledgements arrive: Saved, the list empties
    proxy.set({ write: false });
    await sy.waitForFunction(() => window.__pantry.S.sync.pending === 0, null, { timeout: 20000 });
    await sy.click('#pa-syncnow');
    await sy.locator('.pa-syncnow-result--saved', { hasText: 'Everything is saved' }).waitFor({ timeout: 20000 });
    assert.equal(await sy.locator('.pa-waiting').count(), 0, 'nothing waiting any more');
    assert.equal(await sy.locator('[data-sync] .ha-badge').first().textContent(), 'Saved');
    await axe(sy, 'Settings: Sync now, everything saved');
    // a change the server refuses is Needs attention (not "Everything is saved")
    await sy.evaluate(() => { window.__pantry.S.refused.push({ n: 'x1', hid: window.__pantry.S.household.id, kind: 'items', id: 'sy1', op: 'patch', ops: { set: { a: 1 }, inc: {}, del: [] }, code: 'permission-denied', at: new Date().toISOString(), name: 'Rice' }); });
    await sy.click('#pa-syncnow');
    await sy.locator('.pa-syncnow-result--attention', { hasText: 'Needs attention: the family pantry wouldn’t take one change' }).waitFor({ timeout: 20000 });
    await sy.evaluate(() => { window.__pantry.S.refused = []; });
    await sy.waitForTimeout(100);
    // no console or page errors (the stalled streams and the reconnect included)
    proxy.close();
  }

  // ---- the listener watchdog: a phone whose listen stream died (nothing tells it) hears again within seconds ----
  {
    const proxy = await stallProxy();
    const wUrl = srv.url + `/pantry/?emulator=${proxy.port}:9099`;
    const wa = await person('watcha@example.com', wUrl);   // the phone behind the proxy
    await wa.click('[data-act="hh-create"]');
    await wa.locator('#main .ha-row-title', { hasText: 'Our pantry' }).waitFor();
    const wid = await wa.evaluate(() => window.__pantry.S.household.id);
    await admin.put(`households/${wid}`, { name: 'Our pantry', owner: 'watcha@example.com', members: ['watcha@example.com', 'watchb@example.com'], createdAt: '2026-10-16T00:00:00.000Z' });
    const base2 = { category: 'Other', location: 'Fridge', brand: '', size: '', barcode: '', lowAt: 0, openDays: 7, createdAt: '2026-10-16T00:00:00.000Z', createdBy: 'Mum' };
    for (const id of ['wd1', 'wd2']) await admin.put(`households/${wid}/items/${id}`, { id, name: 'Watch ' + id, ...base2, batches: { a: { qty: 5, expiry: null, openedAt: null, addedAt: '2026-10-01' } } });
    await wa.waitForFunction(() => window.__pantry.S.items.has('wd1') && window.__pantry.S.items.has('wd2'));
    const wb = await person('watchb@example.com');   // the other phone, straight to the emulator
    await wb.waitForFunction(i => window.__pantry.S.household?.id === i, wid);
    await wb.waitForFunction(() => window.__pantry.S.items.has('wd1'));
    const nameOn = (p, id) => p.evaluate(i => window.__pantry.S.items.get(i)?.name, id);
    // (1) the stream dies; the other phone changes an item; this phone hears nothing. It comes back (online): it listens again and catches up
    proxy.set({ dropListen: true });
    await settle(wa);
    await act(wb, 'set', 'wd1', 'name', 'Watch one, renamed by B'); await drain(wb);
    await wa.waitForTimeout(12000);   // (long enough for "nothing heard for 10 s" to be true)
    assert.equal(await nameOn(wa, 'wd1'), 'Watch wd1', 'a dead stream: the phone does not hear the change');
    assert.equal(await wa.evaluate(() => window.__pantry.S.sync.relistens), 0, 'and has not listened again yet (a quiet household is not a sign)');
    proxy.set({ dropListen: false });
    const t0 = Date.now();
    await wa.evaluate(() => dispatchEvent(new Event('online')));
    await wa.waitForFunction(() => window.__pantry.S.items.get('wd1')?.name === 'Watch one, renamed by B', null, { timeout: 15000 });
    assert.ok(Date.now() - t0 < 15000, 'caught up within 15 s');
    assert.equal(await wa.evaluate(() => window.__pantry.S.sync.relistens), 1, 'by listening again, once');
    // after listening again it keeps hearing: another change arrives without any nudge
    await act(wb, 'set', 'wd1', 'name', 'Watch one, again'); await drain(wb);
    await wa.waitForFunction(() => window.__pantry.S.items.get('wd1')?.name === 'Watch one, again', null, { timeout: 10000 });
    // not twice in a row: the throttle holds a second nudge for 30 s
    await wa.evaluate(() => dispatchEvent(new Event('online')));
    await wa.waitForTimeout(500);
    assert.equal(await wa.evaluate(() => window.__pantry.S.sync.relistens), 1, 'at most one re-listen every 30 s');
    // (2) a document still flagged pending long after its write was acknowledged: no event needed. The stream dies, this phone writes
    // (the write is acknowledged on its own stream), the other phone changes another item; within about 15 s it listens again by itself
    await wa.waitForTimeout(31000);   // (past the throttle)
    proxy.set({ dropListen: true });
    await settle(wa);
    await act(wa, 'set', 'wd2', 'notes', 'from A');
    await wa.waitForFunction(() => window.__pantry.S.sync.pending === 0, null, { timeout: 8000 });
    await act(wb, 'set', 'wd1', 'name', 'Watch one, third'); await drain(wb);
    proxy.set({ dropListen: false });
    const t1 = Date.now();
    await wa.waitForFunction(() => window.__pantry.S.items.get('wd1')?.name === 'Watch one, third', null, { timeout: 25000 });
    assert.ok(Date.now() - t1 < 22000, 'caught up on its own: ' + (Date.now() - t1) + ' ms');
    const acts = await wa.evaluate(() => [window.__pantry.S.sync.relistens, window.__pantry.S.sync.cycles]);
    assert.ok(acts[0] + acts[1] >= 2, 'the watchdog acted again by itself (listened again, or restarted the connection): ' + JSON.stringify(acts));
    assert.equal((await admin.get(`households/${wid}/items/wd2`)).notes, 'from A', 'its own change is on the server');
    assert.equal(await wa.evaluate(() => window.__pantry.S.refused.length), 0);
    // the chip says Saved throughout
    assert.equal(await wa.evaluate(() => window.__pantry.S.sync.pending), 0);
    proxy.close();
  }

  // ---- a pantry that goes away under an open phone (the owner merges or deletes it; evidence: 16 Oct, rules errors when a phone
  // resumed on a deleted household) ----
  {
    const iso = '2026-10-16T00:00:00.000Z';
    await seedPantry('goneX', 'losta@example.com', ['losta@example.com', 'lostb@example.com', 'lostc@example.com'], 'GX');   // the bigger one opens first
    await admin.put('households/goneY', { name: 'Our other pantry', owner: 'lostb@example.com', members: ['lostb@example.com'], createdAt: iso });
    await admin.put('households/goneY/items/gy1', { id: 'gy1', name: 'Survivor rice', batches: { y1: { qty: 3, expiry: null } } });
    const lostB = await person('lostb@example.com');
    const bErrors = [];
    lostB.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) bErrors.push(m.text()); });
    const bRules = [];   // any console line (warnings too, e.g. the network restart) naming a rules refusal, except the one deliberate warning below
    lostB.on('console', m => { if (/permission-denied|insufficient permissions|missing or insufficient/i.test(m.text()) && m.text() !== 'household permission-denied') bRules.push(m.type() + ': ' + m.text()); });
    assert.equal(await lostB.evaluate(() => window.__pantry.S.household.id), 'goneX', 'B opens the bigger pantry');
    await go(lostB, '#/items');
    await lostB.locator('#pa-items-list .ha-row', { hasText: 'GX item 0' }).waitFor();
    await lostB.evaluate(() => { window.__sameDocument = true; });
    const lostA = await person('losta@example.com');
    assert.equal(await lostA.evaluate(() => window.__pantry.S.household.id), 'goneX');
    // A, the owner, merges it away (the same call the merge sheet makes last)
    await lostA.evaluate(() => window.__pantry.S.cloud.removeHousehold('goneX'));
    await lostB.waitForFunction(() => window.__pantry.S.household?.id === 'goneY', null, { timeout: 30000 });
    await lostB.locator('#pa-items-list .ha-row', { hasText: 'Survivor rice' }).waitFor();
    assert.equal(await lostB.locator('#pa-items-list .ha-row', { hasText: 'GX item' }).count(), 0, 'the deleted pantry’s items are gone from the list');
    assert.equal(await lostB.evaluate(() => window.__sameDocument === true), true, 'no reload');
    assert.equal(await lostB.evaluate(() => window.__pantry.S.mode), 'cloud');
    await lostB.locator('.ha-toast', { hasText: 'Your pantry changed' }).waitFor();
    // the old listeners are stopped: nothing changes the screen after, and a change made now reaches the surviving pantry
    await act(lostB, 'set', 'gy1', 'notes', 'after the switch');
    await lostB.waitForFunction(() => window.__pantry.S.refused.length === 0 && window.__pantry.S.sync.pending === 0);
    assert.equal((await admin.get('households/goneY/items/gy1')).notes, 'after the switch', 'writes go to the surviving pantry');
    assert.equal(await lostB.evaluate(() => window.__pantry.S.syncError), false, 'no "changes didn’t reach" banner');
    assert.deepEqual(bErrors, [], 'no console errors on the phone that was left behind: ' + bErrors.join(' | '));
    assert.deepEqual(bRules, [], 'no rules errors from the items, places or other listeners after the household was deleted (watchHousehold’s own one-line warning is how the app notices and leaves): ' + bRules.join(' | '));

    // nothing left: a plain "Your pantry changed" with Try again, never a new pantry started on its own
    await admin.put('households/goneZ', { name: 'Our pantry', owner: 'lostd@example.com', members: ['lostd@example.com', 'loste@example.com'], createdAt: iso });
    const lostE = await person('loste@example.com');
    const eErrors = [];
    lostE.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) eErrors.push(m.text()); });
    assert.equal(await lostE.evaluate(() => window.__pantry.S.household.id), 'goneZ');
    const lostD = await person('lostd@example.com');
    await lostD.evaluate(() => window.__pantry.S.cloud.removeHousehold('goneZ'));
    await lostE.locator('#pa-lost, [data-act="hh-check"]').first().waitFor({ timeout: 30000 });
    await go(lostE, '#/');
    await lostE.locator('#pa-lost', { hasText: 'Your pantry changed' }).waitFor();
    await axe(lostE, 'Home: Your pantry changed');
    assert.equal(await lostE.evaluate(() => window.__pantry.S.mode), 'local');
    assert.equal(await lostE.evaluate(() => window.__pantry.S.household), null);
    await go(lostE, '#/settings');
    await lostE.locator('#main .ha-row-title', { hasText: 'Your pantry changed' }).waitFor();
    await axe(lostE, 'Settings: Your pantry changed');
    assert.equal(await lostE.locator('[data-act="hh-check"]').count(), 1, 'a Try again');
    assert.equal((await admin.list('households')).filter(h => h.owner === 'loste@example.com').length, 0, 'nothing was started for them');
    await lostE.click('[data-act="hh-check"]');
    await lostE.locator('.ha-toast', { hasText: 'Not added yet' }).waitFor();
    assert.equal(await lostE.evaluate(() => window.__pantry.S.household), null, 'still nothing to open');
    await admin.put('households/goneW', { name: 'Our pantry', owner: 'lostd@example.com', members: ['lostd@example.com', 'loste@example.com'], createdAt: iso });
    await lostE.click('[data-act="hh-check"]');
    await lostE.waitForFunction(() => window.__pantry.S.household?.id === 'goneW', null, { timeout: 30000 });
    assert.equal(await lostE.evaluate(() => window.__pantry.S.lost), null, 'the notice goes once a pantry is found');
    assert.deepEqual(eErrors, [], 'no console errors: ' + eErrors.join(' | '));
  }

  // ---- no signal: "can't tell" is never "no pantry", and nothing is created offline ----
  const owned = async email => (await admin.list('households')).filter(h => h.owner === email).length;
  await admin.put('households/offH', { name: 'Our pantry', owner: 'off@example.com', members: ['off@example.com'], createdAt: '2026-10-16T00:00:00.000Z' });
  const offCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await offCtx.route(/:8085\//, r => r.abort());   // the family pantry's server can't be reached
  const off = await offCtx.newPage();
  off.on('pageerror', e => errors.push('off: ' + e.message));
  await off.goto(url + '#/settings');
  await off.waitForFunction(() => window.__pantry?.signIn);
  await off.evaluate(e => window.__pantry.signIn(e), 'off@example.com');
  await off.locator('#main', { hasText: "Can’t check right now" }).waitFor({ timeout: 60000 });
  assert.equal(await off.locator('[data-act="hh-create"]').count(), 0, 'offline: no Start our family pantry');
  assert.equal(await off.locator('[data-act="hh-check"]').count(), 1, 'a Try again instead');
  assert.equal(await owned('off@example.com'), 1, 'nothing was created');
  await off.click('[data-act="hh-check"]');
  await off.locator('.ha-toast').waitFor();
  assert.equal(await off.locator('[data-act="hh-create"]').count(), 0, 'still offline: still no Start');
  await offCtx.unroute(/:8085\//);
  await off.click('[data-act="hh-check"]');
  await off.waitForFunction(() => window.__pantry.S.household?.id === 'offH', null, { timeout: 30000 });
  assert.equal(await owned('off@example.com'), 1, 'online again: the existing pantry opened, no second one');
  // a double tap on Start our family pantry makes one pantry, not two
  const quick = await person('quick@example.com');
  await quick.locator('[data-act="hh-create"]').dblclick();
  await quick.locator('#main .ha-row-title', { hasText: 'Our pantry' }).waitFor();
  await settle(quick);
  assert.equal(await owned('quick@example.com'), 1, 'one pantry after a double tap');

  // mum signs out: back to this phone's own (empty) pantry
  await go(mum, '#/settings');
  await mum.click('[data-act="signout"]');
  await mum.locator('[data-act="signin"]').waitFor();
  await go(mum, '#/');
  assert.equal(await mum.locator('.ha-large-sub').textContent(), 'Saved on this phone');
  assert.deepEqual(errors, []);
  console.log('pantry sync e2e: ok');
} finally {
  await browser.close();
  srv.close();
}
