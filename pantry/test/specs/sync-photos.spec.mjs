// Photos in the family pantry (local emulators, fake accounts; never the live project): members read and write
// photos/<id>, outsiders can't; thumbnails over 12 KB and photos over 150 KB are refused; no item may gain or change an
// old-style `photo` (keeping or removing one is fine); and an old-style item is moved by the app itself.
// Run: npx playwright test sync-photos
import { test, expect } from './fixtures.mjs';
import { person, pair, go, inFamily, seedFamily } from './sync-lib.mjs';

test('photo rules: sizes, extra fields, old-style photos kept but never changed, outsiders refused', async ({ phone, fsAdmin, uid }) => {
  const mumE = `mum-${uid}@example.com`, hid = 'hh-' + uid;
  await seedFamily(fsAdmin, hid, [mumE]);
  const mum = await person(phone, mumE, 'mum');
  const stranger = await person(phone, `stranger-${uid}@example.com`, 'stranger');
  await inFamily(mum, hid);
  await expect(stranger.locator('[data-act="hh-create"]')).toBeVisible();   // (signed in and settled before it probes)
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
  expect(rules).toEqual({
    'photo write': 'ok', 'photo read': 'ok', 'photo over 150 KB': 'permission-denied', 'photo extra field': 'permission-denied',
    'thumb 10 KB': 'ok', 'thumb over 12 KB': 'permission-denied', 'new item with a photo': 'permission-denied',
    'new item with an empty photo': 'ok', 'item gains a photo': 'permission-denied', 'item gains a photo (merge)': 'permission-denied',
  });
  // an old-style item (seeded past the rules; its picture can't be read, so the app leaves it alone): it can still be
  // edited with its photo unchanged, its photo can't be changed, and it can be removed
  const OLD = 'data:image/jpeg;base64,' + 'B'.repeat(200000);
  await fsAdmin.put(`households/${hid}/items/old1`, { id: 'old1', name: 'Old one', batches: [], photo: OLD });
  await mum.waitForFunction(() => window.__pantry.S.items.has('old1'));
  const old = await mum.evaluate(async ([hid, OLD]) => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const ref = F.doc(F.getFirestore(), 'households', hid, 'items', 'old1');
    const out = [];
    for (const data of [{ id: 'old1', name: 'Old one, renamed', batches: [], photo: OLD }, { id: 'old1', name: 'x', batches: [], photo: OLD + 'C' }, { id: 'old1', name: 'Old one, renamed', batches: [] }]) {
      try { await F.setDoc(ref, data); out.push('ok'); } catch (e) { out.push(e.code); }
    }
    return out;
  }, [hid, OLD]);
  expect(old, 'old-style photo: kept, changed, removed').toEqual(['ok', 'permission-denied', 'ok']);
  // an outsider can't read, list or write photos
  const outsider = await stranger.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const db = F.getFirestore(), out = [];
    try { await F.getDoc(F.doc(db, 'households', hid, 'photos', 'p1')); out.push('read'); } catch (e) { out.push(e.code); }
    try { await F.getDocs(F.collection(db, 'households', hid, 'photos')); out.push('listed'); } catch (e) { out.push(e.code); }
    try { await F.setDoc(F.doc(db, 'households', hid, 'photos', 'p9'), { id: 'p9', data: 'data:x' }); out.push('wrote'); } catch (e) { out.push(e.code); }
    return out;
  }, hid);
  expect(outsider, 'outsider and photos: ' + outsider.join(', ')).toEqual(Array(3).fill('permission-denied'));
});

test('the app moves an old-style photo by itself: a thumbnail on the item, the photo in photos/<id>, and deleting keeps the photo', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, mumE, hid } = await pair(phone, fsAdmin, uid);
  const real = await mum.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 480; c.height = 360; const g = c.getContext('2d');
    g.fillStyle = '#c33'; g.fillRect(0, 0, 480, 360); g.fillStyle = '#fff'; g.fillRect(60, 60, 200, 120);
    return c.toDataURL('image/jpeg', 0.72);
  });
  await fsAdmin.put(`households/${hid}/items/old2`, { id: 'old2', name: 'Old photo', batches: [], photo: real, createdBy: mumE });
  // the app moves it: photo first, then the item keeps only a thumbnail
  await expect.poll(async () => { const m = await fsAdmin.get(`households/${hid}/items/old2`); return !!(m && m.hasPhoto && !('photo' in m)); }, { timeout: 30_000, message: 'the old item now holds a thumbnail only' }).toBe(true);
  const moved = await fsAdmin.get(`households/${hid}/items/old2`);
  expect(moved.thumb.startsWith('data:image/jpeg') && moved.thumb.length <= 12288).toBe(true);
  expect(moved.name).toBe('Old photo');
  expect((await fsAdmin.get(`households/${hid}/photos/old2`))?.data, 'its photo moved to photos/old2 unchanged').toBe(real);
  // and the family sees it: dad's list shows the thumbnail, his item screen the photo
  await go(dad, '#/items');
  await dad.waitForFunction(t => [...document.querySelectorAll('#pa-items-list img.ha-row-thumb')].some(i => i.getAttribute('src') === t), moved.thumb);
  await go(dad, '#/item/old2');
  await dad.waitForFunction(d => document.querySelector('#pa-hero')?.src === d, real);
  // deleting an item in the app hides it (a marker) and keeps its photo until the sweep purges it after 30 days
  await dad.click('[data-act="delete"]');
  await expect.poll(async () => typeof (await fsAdmin.get(`households/${hid}/items/old2`)).removedAt, { message: 'deleting the item marks it' }).toBe('string');
  expect((await fsAdmin.get(`households/${hid}/photos/old2`))?.data, 'its photo stays until it is purged').toBe(real);
});
