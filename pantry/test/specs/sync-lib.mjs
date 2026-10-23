// Shared by the sync*.spec.mjs and multidevice.spec.mjs: signing in a made-up person, seeding a family, and the SDK's
// network switch, send queue and field-level actions (window.__pantry.act: the functions the buttons call).
import { expect } from './fixtures.mjs';

export const FSJS = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
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
export const net = (p, on) => p.evaluate(async ([on, u]) => { const F = await import(u); const db = F.getFirestore(); await (on ? F.enableNetwork(db) : F.disableNetwork(db)); }, [on, FSJS]);
export const drain = p => p.evaluate(async u => { const F = await import(u); await F.waitForPendingWrites(F.getFirestore()); }, FSJS);
export const act = (p, name, ...args) => p.evaluate(([n, a]) => window.__pantry.act[n](...a), [name, args]);
export const refused = p => p.evaluate(() => window.__pantry.S.refused.length);
export const shownPlaces = p => p.evaluate(() => window.__pantry.places());
// run a block of Firestore calls on a phone (as that person: the rules judge them); fn gets the SDK, the db and arg
export const asPhone = (p, fn, arg) => p.evaluate(async ([src, arg, u]) => { const F = await import(u); return (0, eval)('(' + src + ')')(F, F.getFirestore(), arg); }, [fn.toString(), arg, FSJS]);
