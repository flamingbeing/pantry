// Shared by the sync*.spec.mjs and multidevice.spec.mjs: signing in a made-up person, seeding a family, and the SDK's
// network switch, send queue and field-level actions (window.__pantry.act: the functions the buttons call).
import { expect } from './fixtures.mjs';

export const FSJS = 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
export const OK = 'ok', NO = 'permission-denied';
export const BASE_ITEM = { category: 'Sauces & condiments', location: 'Fridge', brand: '', size: '', barcode: '', lowAt: 0, openDays: null, createdAt: '2026-10-16T00:00:00.000Z', createdBy: 'Mum' };

// a phone signed in as this made-up person (the emulator's fake sign-in), on the settings screen
export async function person(phone, email, name = email.split('@')[0]) {
  const p = await phone(name, { url: '/pantry/?emulator#/settings' });
  await p.waitForFunction(() => window.__pantry?.signIn);
  // (a sign-in sent while the page is still starting can be lost: ask again until the screen shows this person)
  await expect(async () => {
    await p.evaluate(e => window.__pantry.signIn(e), email);
    await expect(p.locator('#main')).toContainText(email, { timeout: 4000 });
  }).toPass({ timeout: 30_000 });
  return p;
}
// (and the family has answered once: a phone that goes offline or is probed before its first answer can trip the SDK's internal assertion)
export const inFamily = (p, hid) => p.waitForFunction(h => window.__pantry.S.household?.id === h && window.__pantry.S.sync.lastServerAt > 0, hid);
export const go = (p, hash) => p.evaluate(h => { location.hash = h; }, hash);
// a family pantry seeded past the UI: members[0] is the owner
export async function seedFamily(fsAdmin, hid, members) {
  await fsAdmin.put(`households/${hid}`, { name: 'Our pantry', owner: members[0], members, createdAt: '2026-10-16T00:00:00.000Z' });
}
// two phones (Mum and Dad) in a seeded family of their own: emails and household id carry this test's uid
export async function pair(phone, fsAdmin, uid, extraMembers = []) {
  const mumE = `mum-${uid}@example.com`, dadE = `dad-${uid}@example.com`, hid = 'hh-' + uid;
  await seedFamily(fsAdmin, hid, [mumE, dadE, ...extraMembers]);
  const mum = await person(phone, mumE, 'mum'), dad = await person(phone, dadE, 'dad');
  await inFamily(mum, hid); await inFamily(dad, hid);
  return { mum, dad, mumE, dadE, hid };
}
// the SDK's network switch, and (saves go through app-sync's outbox) sending what waits at once when back, as 'online' does
// (the phone's whole connection too: a transaction, which every save is now, doesn't wait for the SDK's network switch)
export async function net(p, on) {
  const sdk = on => p.evaluate(async ([on, u]) => { const F = await import(u); const db = F.getFirestore(); await (on ? F.enableNetwork(db) : F.disableNetwork(db)); if (on) window.__pantry.kick?.(); }, [on, FSJS]);
  if (!on) await sdk(false);
  await p.context().setOffline(!on);
  if (on) await sdk(true);
}
// every save this phone made has reached the server (the outbox and the SDK's own queue)
export const drain = p => p.evaluate(async () => { for (let i = 0; i < 30; i++) if (await window.__pantry.synced(1000)) return; throw new Error('saves still waiting'); });
export const act = (p, name, ...args) => p.evaluate(([n, a]) => window.__pantry.act[n](...a), [name, args]);
export const refused = p => p.evaluate(() => window.__pantry.S.refused.length);
export const shownPlaces = p => p.evaluate(() => window.__pantry.places());
// run a block of Firestore calls on a phone (as that person: the rules judge them); fn gets the SDK, the db and arg
export const asPhone = (p, fn, arg) => p.evaluate(async ([src, arg, u]) => { const F = await import(u); return (0, eval)('(' + src + ')')(F, F.getFirestore(), arg); }, [fn.toString(), arg, FSJS]);

// Held conflicts (app-sync 0.7.1). `settle`: nothing of this phone's is being sent (held saves wait for a person, so they
// don't count). `answerHeld`: answer every change this phone holds through its popup, as a person would: choose(view) ->
// 'mine' | 'theirs' | 'each' (then pick(path) per field). -> what was chosen: [{ kind, id, deleted, fields: [{ path, value }] }],
// so a test can check the server now has exactly that.
export const settle = p => p.evaluate(async () => {
  // (saves queued behind a held one wait with it: the answer carries them; `before` is a save from an older version)
  const free = () => { const held = new Set(window.__pantry.held().map(c => c.kind + ':' + c.id)); return window.__pantry.S.sync.list.filter(x => !held.has(x.kind + ':' + x.id)).length; };
  for (let i = 0; i < 60; i++) { if (await window.__pantry.synced(500)) return; if (window.__pantry.S.sync.pending === 0 || window.__pantry.held().length && !free()) return; }
  throw new Error('saves still being sent: ' + JSON.stringify({ pending: window.__pantry.S.sync.pending, held: window.__pantry.S.sync.held, list: window.__pantry.S.sync.list }));
});
export async function answerHeld(p, choose, pick = () => 'mine') {
  const out = [];
  for (let n = 0; n < 40; n++) {
    const list = await p.evaluate(() => window.__pantry.held());
    if (!list.length) return out;
    const sheet = p.locator('[data-held-key]');
    if (!(await sheet.count())) await p.evaluate(k => window.__pantry.openHeld(k), list[0].key);
    await sheet.first().waitFor({ timeout: 5000 });
    const key = await sheet.first().getAttribute('data-held-key');
    const view = await p.evaluate(k => window.__pantry.describeHeld(k), key);
    if (!view) { await p.waitForTimeout(200); continue; }
    let c = choose(view);
    const whole = view.deleted.mine || view.deleted.theirs || !view.fields.length;
    if (c === 'each' && (whole || view.fields.length < 2)) c = whole ? 'mine' : pick(view.fields[0].path);
    const side = path => c === 'each' ? pick(path) : c;
    if (c === 'each') for (const [i, f] of view.fields.entries()) await p.locator(`input[name="f${i}"][value="${pick(f.path)}"]`).check();
    await p.locator(`[data-held="${c}"]`).click();
    await p.locator(`[data-held-key="${key}"]`).waitFor({ state: 'detached', timeout: 10000 });
    out.push({ kind: view.kind, id: view.id, choice: c, deleted: whole ? (c === 'mine' ? view.deleted.mine : view.deleted.theirs) : false,
      fields: view.fields.map(f => ({ path: f.path, side: side(f.path), value: f[side(f.path)].value })) });
  }
  throw new Error('held conflicts never ended');
}
// a value in a document by its path as the conflict popup names fields (app-sync 0.7.4: a backslash before each '.' or
// backslash inside a key, so names.<email> has its email's dots escaped)
const keysOf = path => path.match(/(?:\\.|[^.])+/g).map(k => k.replace(/\\(.)/g, '$1'));
export const valueAt = (doc, path) => keysOf(path).reduce((v, k) => v && typeof v === 'object' ? v[k] : undefined, doc);
