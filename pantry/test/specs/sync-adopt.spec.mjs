// What the app does with app-sync 0.4.0 / update 0.2.0 (local emulators, fake accounts; never the live project): the
// adapter's own stamp moves updatedAt forward, and signing out wipes the phone's copy in app-sync's order.
// Each test has its own family. Run: npx playwright test sync-adopt
import { test, expect, FS } from './fixtures.mjs';
import { pair, drain, act, refused, net, BASE_ITEM } from './sync-lib.mjs';

const stampOf = async path => {
  const r = await fetch(FS + path, { headers: { Authorization: 'Bearer owner' } });
  return r.ok ? (await r.json()).fields?.updatedAt?.stringValue ?? null : null;
};

test('a save from a phone whose clock is behind still moves updatedAt forward (the adapter’s stamp)', async ({ phone, fsAdmin, uid }) => {
  const { mum, hid } = await pair(phone, fsAdmin, uid);
  const ahead = new Date(Date.now() + 3600e3).toISOString();   // another phone's clock an hour ahead wrote last
  await fsAdmin.put(`households/${hid}/items/jam`, { id: 'jam', name: 'Jam', ...BASE_ITEM, batches: {}, updatedAt: ahead });
  await expect.poll(() => mum.evaluate(() => window.__pantry.S.items.has('jam'))).toBe(true);
  await act(mum, 'set', 'jam', 'brand', 'New');
  await drain(mum);
  const after = await stampOf(`households/${hid}/items/jam`);
  expect(Date.parse(after), 'later than the stamp it replaced').toBeGreaterThan(Date.parse(ahead));
  expect(await refused(mum)).toBe(0);
});

test('signing out leaves nothing of the family on the phone (copies, outbox) and no change is sent after it', async ({ phone, fsAdmin, uid }) => {
  const { mum, hid } = await pair(phone, fsAdmin, uid);
  await fsAdmin.put(`households/${hid}/items/milk`, { id: 'milk', name: 'Milk', ...BASE_ITEM, batches: {} });
  await expect.poll(() => mum.evaluate(() => window.__pantry.S.items.has('milk'))).toBe(true);
  await act(mum, 'add', 'milk', 2);
  await drain(mum);
  const held = () => mum.evaluate(async () => {
    let n = 0;
    for (const d of await indexedDB.databases()) {
      if (!/^pantry-(sync|outbox)/.test(d.name || '')) continue;
      const db = await new Promise((ok, no) => { const r = indexedDB.open(d.name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
      for (const name of db.objectStoreNames) n += await new Promise(ok => { const r = db.transaction(name).objectStore(name).count(); r.onsuccess = () => ok(r.result); r.onerror = () => ok(0); });
      db.close();
    }
    return n;
  });
  expect(await held(), 'copies are kept on the phone while signed in').toBeGreaterThan(0);
  await mum.evaluate(() => { location.hash = '#/settings'; });
  await mum.click('[data-act="signout"]');
  await expect.poll(() => mum.evaluate(() => window.__pantry.S.mode)).toBe('local');
  await expect.poll(held, { message: 'the family’s copies and the outbox are gone' }).toBe(0);
  expect(await fsAdmin.get(`households/${hid}`)).toBeTruthy();   // the family itself is untouched
});

test('“Sign out anyway” with a change still unsent signs out and drops it, as the dialog says', async ({ phone, fsAdmin, uid }) => {
  const { mum, hid } = await pair(phone, fsAdmin, uid);
  await fsAdmin.put(`households/${hid}/items/milk`, { id: 'milk', name: 'Milk', ...BASE_ITEM, batches: {} });
  await expect.poll(() => mum.evaluate(() => window.__pantry.S.items.has('milk'))).toBe(true);
  await net(mum, false);
  await act(mum, 'set', 'milk', 'brand', 'Unsent');
  await expect.poll(() => mum.evaluate(() => window.__pantry.S.sync.pending)).toBeGreaterThan(0);
  await mum.evaluate(() => { location.hash = '#/settings'; });
  await mum.click('[data-act="signout"]');
  const ask = mum.locator('dialog[open]', { hasText: 'Sign out now?' });
  await expect(ask).toBeVisible({ timeout: 15_000 });
  await ask.locator('button', { hasText: 'Sign out anyway' }).click();
  await expect.poll(() => mum.evaluate(() => window.__pantry.S.mode), { timeout: 20_000 }).toBe('local');
  await net(mum, true);
  await mum.waitForTimeout(1500);   // (a save left in the outbox would be sent now)
  expect((await fsAdmin.get(`households/${hid}/items/milk`))?.brand ?? '', 'the dropped change never reached the family').not.toBe('Unsent');
});
