// Restoring a backup, copying this phone's pantry up and the sweep's deletes go through app-sync's outbox like every
// other save (local emulators, fake accounts; never the live project): made with no signal they are kept on the phone,
// counted as waiting, and reach the family when it is back, stamped by the adapter (updatedAt now, serverAt).
// Each test has its own family. Run: npx playwright test sync-restore
import { test, expect, FS } from './fixtures.mjs';
import { pair, seedFamily, inFamily, net, drain, act, go, refused, BASE_ITEM } from './sync-lib.mjs';

const raw = async path => {
  const r = await fetch(FS + path, { headers: { Authorization: 'Bearer owner' } });
  return r.ok ? (await r.json()).fields || {} : null;
};
const pending = p => p.evaluate(() => window.__pantry.S.cloud.pending());
const OLD = '2026-01-01T00:00:00.000Z';
const backup = uid => JSON.stringify({
  app: 'pantry',
  items: [
    { id: 'rs-jam-' + uid, name: 'Restored jam', ...BASE_ITEM, batches: [{ id: 'b1', qty: 2, expiry: '2027-03-01' }], hasPhoto: true, thumb: 'data:image/jpeg;base64,AAAA', updatedAt: OLD },
    { id: 'rs-tea-' + uid, name: 'Restored tea', ...BASE_ITEM, batches: [{ id: 'b2', qty: 1, expiry: '' }], updatedAt: OLD },
  ],
  events: [{ id: 'rs-ev-' + uid, itemId: 'rs-jam-' + uid, type: 'add', qty: 2, at: OLD, by: 'Mum' }],
  shop: [{ id: 'rs-line-' + uid, name: 'Restored line', done: false, updatedAt: OLD }],
  photos: [{ id: 'rs-jam-' + uid, data: 'data:image/jpeg;base64,BBBB', updatedAt: OLD }],
});

test('a backup restored with no signal waits in the outbox and reaches the family, stamped, when signal is back', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, hid } = await pair(phone, fsAdmin, uid);
  await go(mum, '#/settings');
  await net(mum, false);
  const t0 = Date.now();
  await mum.setInputFiles('#pa-restore', { name: 'pantry-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup(uid)) });
  await expect(mum.locator('.toast')).toContainText('Restored 2 items');
  // kept on this phone and counted: two items and a line (history and photos ride along, uncounted)
  await expect.poll(() => pending(mum), { message: 'the restore waits in the outbox' }).toBeGreaterThanOrEqual(3);
  expect(await raw(`households/${hid}/items/rs-jam-${uid}`), 'nothing reached the server offline').toBeNull();
  await net(mum, true);
  await drain(mum);
  for (const path of [`items/rs-jam-${uid}`, `items/rs-tea-${uid}`, `events/rs-ev-${uid}`, `shop/rs-line-${uid}`, `photos/rs-jam-${uid}`]) {
    const f = await raw(`households/${hid}/${path}`);
    expect(f, path + ' reached the family').toBeTruthy();
    expect(Date.parse(f.updatedAt.stringValue), path + ' stamped now, not the backup’s time').toBeGreaterThanOrEqual(t0 - 1000);
    expect(f.serverAt?.timestampValue, path + ' has the server’s stamp').toBeTruthy();
  }
  expect((await fsAdmin.get(`households/${hid}/items/rs-jam-${uid}`)).batches.b1.qty, 'the batches as a map').toBe(2);
  await expect.poll(() => dad.evaluate(id => window.__pantry.S.items.has(id), 'rs-tea-' + uid), { message: 'the other phone hears it' }).toBe(true);
  expect(await refused(mum)).toBe(0);
  expect(await pending(mum)).toBe(0);
});

test('copying this phone’s own pantry up goes through the outbox (no signal: kept, then sent)', async ({ phone, fsAdmin, uid }) => {
  const mumE = `mum-${uid}@example.com`, hid = 'hh-' + uid, id = 'cu-rice-' + uid;
  await seedFamily(fsAdmin, hid, [mumE]);
  const mum = await phone('mum', { url: '/pantry/?emulator#/settings' });
  await mum.waitForFunction(() => window.__pantry?.signIn && window.__pantry.S.local);
  // something in this phone's own pantry, from before it signed in
  await mum.evaluate(async id => { await window.__pantry.S.local.put('items', { id, name: 'Phone rice', category: 'Rice & grains', location: 'Pantry', batches: [{ id: 'r1', qty: 3, expiry: '' }], updatedAt: '2026-01-01T00:00:00.000Z' }); }, id);
  await expect(async () => {
    await mum.evaluate(e => window.__pantry.signIn(e), mumE);
    await expect(mum.locator('#main')).toContainText(mumE, { timeout: 4000 });
  }).toPass({ timeout: 30_000 });
  await inFamily(mum, hid);
  await expect.poll(() => mum.evaluate(() => window.__pantry.S.localCount)).toBe(1);
  await go(mum, '#/settings');
  await expect(mum.locator('[data-act="copy-up"]')).toBeVisible();
  await net(mum, false);
  await mum.click('[data-act="copy-up"]');
  await expect(mum.locator('.toast')).toContainText('Copied 1 item');
  await expect.poll(() => pending(mum), { message: 'the copy waits in the outbox' }).toBeGreaterThanOrEqual(1);
  await net(mum, true);
  await drain(mum);
  const f = await raw(`households/${hid}/items/${id}`);
  expect(f?.serverAt?.timestampValue, 'reached the family, stamped').toBeTruthy();
  expect(await refused(mum)).toBe(0);
});

test('the sweep’s deletes of a purged item’s history and photo wait in the outbox when signal drops after the purge', async ({ phone, fsAdmin, uid }) => {
  const { mum, hid } = await pair(phone, fsAdmin, uid);
  const oldAt = new Date(Date.now() - 35 * 86400000).toISOString();
  await fsAdmin.put(`households/${hid}/items/sw-${uid}`, { id: `sw-${uid}`, name: 'Swept', ...BASE_ITEM, batches: {}, removedAt: oldAt, removedBy: 'Mum', hasPhoto: true, thumb: 'data:image/jpeg;base64,AAAA', updatedAt: oldAt });
  await fsAdmin.put(`households/${hid}/photos/sw-${uid}`, { id: `sw-${uid}`, data: 'data:image/jpeg;base64,BBBB', updatedAt: oldAt });
  await fsAdmin.put(`households/${hid}/events/swe-${uid}`, { id: `swe-${uid}`, itemId: `sw-${uid}`, type: 'add', qty: 1, at: oldAt, by: 'Mum', updatedAt: oldAt });
  await mum.waitForFunction(id => window.__pantry.S.items.has(id) && window.__pantry.S.events.has('swe-' + id.slice(3)), `sw-${uid}`);
  // signal drops right after the purge's transaction (the whole connection: a transaction doesn't wait for the SDK's switch)
  await mum.evaluate(() => {
    const B = window.__pantry.S.backend, purge = B.purge.bind(B);
    B.purge = async (...a) => { const r = await purge(...a); window.__purged = true; await new Promise(go => { window.__goOn = go; }); return r; };
  });
  const swept = act(mum, 'sweep');
  await mum.waitForFunction(() => window.__purged === true && window.__goOn);
  await net(mum, false);
  await mum.evaluate(() => window.__goOn());
  expect(await swept, 'the item is purged').toBe(1);
  expect(await raw(`households/${hid}/items/sw-${uid}`)).toBeNull();
  expect(await pending(mum), 'its photo and history deletes are kept on the phone').toBeGreaterThanOrEqual(2);
  await net(mum, true);
  await drain(mum);
  expect(await raw(`households/${hid}/photos/sw-${uid}`), 'photo gone').toBeNull();
  expect(await raw(`households/${hid}/events/swe-${uid}`), 'history gone').toBeNull();
  expect(await refused(mum)).toBe(0);
});
