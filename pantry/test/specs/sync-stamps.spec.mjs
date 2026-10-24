// The server's own stamp (app-sync 0.3.0, stampMode 'server'; local emulators, fake accounts; never the live project):
// every save also writes `serverAt`, set by the server, beside `updatedAt`; the app's records never carry it; the rules
// take only the server's time as a stamp, and still take the saves of older app versions (none, or their plain copy of
// one), until the backfill and a second rules change. Each test has its own family. Run: npx playwright test sync-stamps
import { test, expect, FS } from './fixtures.mjs';
import { pair, drain, act, refused, asPhone, BASE_ITEM } from './sync-lib.mjs';

// the stored stamp as the server has it: its type ('timestamp', 'map', 'none', ...) and time (fsAdmin reads plain values only)
async function stampOf(path) {
  const r = await fetch(FS + path, { headers: { Authorization: 'Bearer owner' } });
  const f = r.ok ? (await r.json()).fields || {} : {}, v = f.serverAt;
  return { updatedAt: f.updatedAt?.stringValue ?? null, type: v ? Object.keys(v)[0].replace('Value', '') : 'none', ms: v?.timestampValue ? Date.parse(v.timestampValue) : null };
}
const near = (ms, t0) => ms !== null && ms >= t0 - 5000 && ms <= Date.now() + 5000;

test('a save carries the server’s stamp beside updatedAt, and neither phone’s records hold it', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, hid } = await pair(phone, fsAdmin, uid);
  await fsAdmin.put(`households/${hid}/items/milk`, { id: 'milk', name: 'Milk', ...BASE_ITEM, batches: {} });
  await expect.poll(() => mum.evaluate(() => window.__pantry.S.items.has('milk'))).toBe(true);
  expect((await stampOf(`households/${hid}/items/milk`)).type, 'seeded as an older version would: no stamp').toBe('none');
  const t0 = Date.now();
  await act(mum, 'add', 'milk', 2);
  const line = await act(mum, 'addLine', 'Bread');
  const place = await act(mum, 'addPlace', 'Garage shelf');
  await drain(mum);
  for (const p of ['items/milk', `shop/${line}`, `places/${place}`]) {
    const s = await stampOf(`households/${hid}/${p}`);
    expect(s.type, p + ': serverAt is a timestamp').toBe('timestamp');
    expect(near(s.ms, t0), p + ': the server’s time of the save').toBe(true);
    expect(s.updatedAt, p + ': updatedAt stays an ISO time').toMatch(/^\d{4}-\d\d-\d\dT/);
  }
  await expect.poll(() => dad.evaluate(() => window.__pantry.S.items.get('milk')?.batches?.length || 0), { message: 'dad hears the change' }).toBeGreaterThan(0);
  for (const p of [mum, dad]) {
    const held = await p.evaluate(() => [...window.__pantry.S.items.values(), ...window.__pantry.S.shop.values()].filter(r => 'serverAt' in r || '_saves' in r).length);
    expect(held, 'no record in the app carries the engine’s fields').toBe(0);
  }
  expect(await refused(mum)).toBe(0);
});

test('the rules: only the server’s time is a stamp; older versions’ saves (none, or a plain copy) still go through', async ({ phone, fsAdmin, uid }) => {
  const { mum, hid } = await pair(phone, fsAdmin, uid);
  const out = await asPhone(mum, async (F, db, hid) => {
    const r = {}, d = id => F.doc(db, 'households', hid, 'shop', id);
    const line = (id, extra) => ({ id, name: 'Bread', done: false, updatedAt: new Date(Date.now() + Math.floor(Math.random() * 1e6)).toISOString(), ...extra });
    const tryIt = async (name, fn) => { try { await fn(); r[name] = 'ok'; } catch (e) { r[name] = e.code; } };
    await tryIt('server time', () => F.setDoc(d('a'), line('a', { serverAt: F.serverTimestamp() })));
    await tryIt('a time made up on the phone', () => F.setDoc(d('b'), line('b', { serverAt: F.Timestamp.fromMillis(Date.now() + 3600e3) })));
    await tryIt('an earlier stamp kept on a change', async () => { const s = await F.getDocFromServer(d('a')); await F.setDoc(d('a'), { ...line('a'), serverAt: s.get('serverAt') }); });
    await tryIt('none (an older version)', () => F.setDoc(d('c'), line('c')));
    await tryIt('a plain copy (an older version’s JSON of one)', () => F.setDoc(d('a'), line('a', { serverAt: { seconds: 1, nanoseconds: 0 } })));
    await tryIt('a number', () => F.setDoc(d('e'), line('e', { serverAt: Date.now() })));
    await tryIt('history line resent with a new stamp', async () => {
      const e = F.doc(db, 'households', hid, 'events', 'ev1'), ev = { id: 'ev1', itemId: 'x', type: 'use', at: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z' };
      await F.setDoc(e, { ...ev, serverAt: F.serverTimestamp() });
      await F.setDoc(e, { ...ev, updatedAt: '2026-10-24T00:00:01.000Z', serverAt: F.serverTimestamp() });
    });
    await tryIt('photo', () => F.setDoc(F.doc(db, 'households', hid, 'photos', 'p1'), { id: 'p1', data: 'x', updatedAt: '2026-10-24T00:00:00.000Z', serverAt: F.serverTimestamp() }));
    return r;
  }, hid);
  expect(out).toEqual({
    'server time': 'ok', 'a time made up on the phone': 'permission-denied', 'an earlier stamp kept on a change': 'permission-denied',
    'none (an older version)': 'ok', 'a plain copy (an older version’s JSON of one)': 'ok', 'a number': 'permission-denied',
    'history line resent with a new stamp': 'ok', photo: 'ok',
  });
});

test('an older app version (app-sync 0.2.0) still saves over a stamped document, and the next new save stamps it again', async ({ phone, fsAdmin, uid }) => {
  const { mum, hid } = await pair(phone, fsAdmin, uid);
  await fsAdmin.put(`households/${hid}/items/jam`, { id: 'jam', name: 'Jam', ...BASE_ITEM, batches: {} });
  await expect.poll(() => mum.evaluate(() => window.__pantry.S.items.has('jam'))).toBe(true);
  await act(mum, 'set', 'jam', 'brand', 'New');
  await drain(mum);
  expect((await stampOf(`households/${hid}/items/jam`)).type).toBe('timestamp');
  // the old engine's merged save, as the live app before this one sends it (its JSON copy of the server's document)
  const old = await asPhone(mum, async (F, db, hid) => {
    const AS = await import('https://core.anawj.com/sync/0.2.0/index.js');
    const fs = AS.createFirestoreBackend({ sdk: async () => ({ F, db }), path: (h, k) => ['households', h, k], time: 'iso', mark: '_saves', merge: { items: true } });
    try { await fs.commit(hid, 'items', { id: 'jam', name: 'Jam (old phone)' }, null, { key: 'old-1' }); return 'ok'; } catch (e) { return e.code || e.message; }
  }, hid);
  expect(old, 'the older version’s save is accepted').toBe('ok');
  expect((await stampOf(`households/${hid}/items/jam`)).type, 'it wrote back its plain copy').toBe('map');
  expect((await fsAdmin.get(`households/${hid}/items/jam`)).name).toBe('Jam (old phone)');
  await expect.poll(() => mum.evaluate(() => window.__pantry.S.items.get('jam')?.name), { message: 'and the new phone hears it (by updatedAt)' }).toBe('Jam (old phone)');
  const t0 = Date.now();
  await act(mum, 'set', 'jam', 'brand', 'Newer');
  await drain(mum);
  const again = await stampOf(`households/${hid}/items/jam`);
  expect(again.type).toBe('timestamp');
  expect(near(again.ms, t0)).toBe(true);
  expect(await refused(mum)).toBe(0);
});

test('writing many at once (a backup restored, a pantry merged) stamps each with the server’s time, never a copied stamp', async ({ phone, fsAdmin, uid }) => {
  const { mum, hid } = await pair(phone, fsAdmin, uid);
  const t0 = Date.now();
  await mum.evaluate(() => window.__pantry.S.backend.putMany('items', [
    { id: 'a1', name: 'Rice', category: 'Pantry', location: 'Fridge', batches: [], serverAt: { seconds: 1, nanoseconds: 0 }, updatedAt: '2020-01-01T00:00:00.000Z' },
    { id: 'a2', name: 'Oats', category: 'Pantry', location: 'Fridge', batches: [] },
  ]));
  for (const id of ['a1', 'a2']) {
    const s = await stampOf(`households/${hid}/items/${id}`);
    expect(s.type, id).toBe('timestamp');
    expect(near(s.ms, t0), id + ': stamped now').toBe(true);
  }
});
