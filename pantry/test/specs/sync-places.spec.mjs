// Places on two or more phones (local emulators, fake accounts; never the live project): every place is a document of its
// own, so a rename on one phone shows on the other (items included), and two phones adding, renaming, moving or removing at
// once (one of them offline) keep everything each did, once, in the same order on every phone. Phones that start from the old
// single list migrate without duplicates. Each test has its own family. Run: npx playwright test sync-places
import { test, expect } from './fixtures.mjs';
import { person, pair, seedFamily, inFamily, go, net, drain, act, refused, shownPlaces, FSJS, BASE_ITEM } from './sync-lib.mjs';
import { placeId } from '../../js/places.js';

const sortPlaces = l => l.sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));
const placeDocs = (fsAdmin, hid) => fsAdmin.list(`households/${hid}/places`).then(sortPlaces);
// the server and both phones show the live places in this order
async function same(fsAdmin, hid, [mum, dad], what, want) {
  await expect.poll(async () => {
    await drain(mum); await drain(dad);
    return { server: (await placeDocs(fsAdmin, hid)).filter(d => !d.removedAt).map(d => d.name), mum: await shownPlaces(mum), dad: await shownPlaces(dad) };
  }, { message: what, timeout: 20_000 }).toEqual({ server: want, mum: want, dad: want });
}
// mum adds the two shelves (as documents) and both phones show them
async function shelves(fsAdmin, hid, phones, names) {
  const ids = [];
  for (const n of names) ids.push(await act(phones[0], 'addPlace', n));
  await drain(phones[0]);
  return ids;
}

test('a rename on one phone shows on the other: the list, the items in it, and the defaults become documents', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, hid } = await pair(phone, fsAdmin, uid);
  await fsAdmin.put(`households/${hid}/items/milk`, { id: 'milk', name: 'Milk', ...BASE_ITEM, batches: {} });
  await expect.poll(() => dad.evaluate(() => window.__pantry.S.items.has('milk'))).toBe(true);
  await go(mum, '#/places');
  await mum.locator('[data-act="place-open"][data-v="Fridge"]').click();
  await mum.fill('#pa-pl-name', 'Kitchen fridge');
  await mum.locator('#pa-pl-form button[type=submit]').click();
  await go(dad, '#/places');
  await dad.locator('[data-act="place-open"][data-v="Kitchen fridge"]').waitFor();
  await expect(dad.locator('[data-act="place-open"][data-v="Fridge"]'), 'dad sees the rename').toHaveCount(0);
  await expect.poll(() => dad.evaluate(() => [...window.__pantry.S.items.values()].filter(i => /fridge/i.test(i.location || '')).map(i => i.location)), { message: 'and his items moved with it' }).toEqual(['Kitchen fridge']);
  // (PR-C: every place is a document of its own; the first change wrote the defaults as documents, and the rename is one field)
  // (Dad can show the new name from the moved item, under "Not in your list", before the place document lands)
  await expect.poll(async () => (await placeDocs(fsAdmin, hid)).map(d => d.name).slice(0, 3), { message: 'the defaults became place documents, the rename kept its position' }).toEqual(['Kitchen cabinet', 'Kitchen fridge', 'Level 1 fridge']);
  const docs = await placeDocs(fsAdmin, hid);
  expect(docs.length, 'one document each, none twice').toBe(11);
  expect(Object.keys(docs[1]).sort()).toEqual(['_saves', 'id', 'name', 'order', 'serverAt', 'updatedAt']);
  // (app-sync stamps every save as it reaches the server, the migration's too, so other phones' delta listeners hear it;
  // the server still never lets a copy made from the old list overwrite a place: cloud.js mergeSaves)
  expect(docs[0].updatedAt, 'an untouched one has a real time too').not.toBe('1970-01-01T00:00:00.000Z');
  expect(docs[1].updatedAt, 'the renamed one has a real time').not.toBe('1970-01-01T00:00:00.000Z');
  expect(await fsAdmin.get(`households/${hid}/settings/places`), 'the app no longer writes the old single list').toBeNull();
});

test('two phones add a place at once, one of them offline: both kept, each once, in the same order', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, hid } = await pair(phone, fsAdmin, uid);
  const before = await shownPlaces(mum);
  await net(dad, false);
  await act(dad, 'addPlace', 'Shelf B');
  await act(mum, 'addPlace', 'Shelf A'); await drain(mum);
  await net(dad, true); await drain(dad);
  await same(fsAdmin, hid, [mum, dad], 'two places added at once', [...before, 'Shelf A', 'Shelf B']);
  expect((await placeDocs(fsAdmin, hid)).filter(d => /^Shelf/.test(d.name)).length).toBe(2);
});

test('a rename on one phone while the other reorders the same place (offline): both kept', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, hid } = await pair(phone, fsAdmin, uid);
  const before = await shownPlaces(mum);
  const [idA, idB] = await shelves(fsAdmin, hid, [mum], ['Shelf A', 'Shelf B']);
  await same(fsAdmin, hid, [mum, dad], 'two shelves', [...before, 'Shelf A', 'Shelf B']);
  await net(dad, false);
  await act(dad, 'reorderPlace', idB, -1);   // Shelf B above Shelf A: one field of one document
  await act(mum, 'renamePlace', idB, 'Shelf Bee'); await drain(mum);
  await net(dad, true); await drain(dad);
  await same(fsAdmin, hid, [mum, dad], 'a rename and a reorder of the same place', [...before, 'Shelf Bee', 'Shelf A']);
  const docs = await placeDocs(fsAdmin, hid);
  const bDoc = docs.find(d => d.id === idB);
  expect(bDoc.name).toBe('Shelf Bee'); expect(bDoc.order, 'renamed and moved').toBeLessThan(docs.find(d => d.id === idA).order);
  expect(Object.keys(bDoc).sort()).toEqual(['_saves', 'id', 'name', 'order', 'serverAt', 'updatedAt']);
});

test('one phone removes a place while the other, offline, renames it: it stays hidden, Restore shows the new name, and a removed one never comes back', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, hid } = await pair(phone, fsAdmin, uid);
  const before = await shownPlaces(mum);
  const [idA] = await shelves(fsAdmin, hid, [mum], ['Shelf A']);
  await same(fsAdmin, hid, [mum, dad], 'a shelf', [...before, 'Shelf A']);
  await net(dad, false);
  await act(dad, 'renamePlace', idA, 'Shelf Ay');
  await act(mum, 'removePlace', idA); await drain(mum);
  await net(dad, true); await drain(dad);
  await same(fsAdmin, hid, [mum, dad], 'removed while renamed elsewhere', before);
  const aDoc = (await placeDocs(fsAdmin, hid)).find(d => d.id === idA);
  expect(aDoc.removedAt && aDoc.name === 'Shelf Ay', 'hidden, with the rename kept').toBeTruthy();
  await go(mum, '#/removed');
  const row = mum.locator('#pa-removed-places .ui-row', { hasText: 'Shelf Ay' });
  await row.locator('[data-act="restore"]').click();
  await same(fsAdmin, hid, [mum, dad], 'restored with the rename', [...before, 'Shelf Ay']);
  expect((await placeDocs(fsAdmin, hid)).find(d => d.id === idA).removedAt, 'markers cleared').toBeUndefined();
  // a restored place isn't brought back twice, and a removed one nobody restored never comes back
  await act(dad, 'removePlace', idA); await drain(dad);
  await act(mum, 'renamePlace', idA, 'Shelf Ay 2'); await drain(mum);
  await same(fsAdmin, hid, [mum, dad], 'removed, then renamed', before);
});

test('a rename moves the items in the place; an item added offline under the old name keeps it, shows under "Not in your list", and moves out from there', async ({ phone, fsAdmin, uid }) => {
  const { mum, dad, hid } = await pair(phone, fsAdmin, uid);
  const before = await shownPlaces(mum);
  await shelves(fsAdmin, hid, [mum], ['Shelf Bee']);
  await same(fsAdmin, hid, [mum, dad], 'a shelf', [...before, 'Shelf Bee']);
  await go(mum, '#/places');
  await mum.locator('[data-act="place-open"][data-v="Shelf Bee"]').click();
  await mum.fill('#pa-pl-name', 'Shelf Cee'); await mum.locator('#pa-pl-form button[type=submit]').click();
  await same(fsAdmin, hid, [mum, dad], 'the shelf renamed', [...before, 'Shelf Cee']);
  // (Dad's phone is offline and adds an item kept in "Level 1 freezer", which Mum renames at the same time)
  await net(dad, false);
  await go(dad, '#/add');
  await dad.fill('#pa-form [name="name"]', 'Late ice cream');
  await dad.selectOption('#pa-form [name="location"]', 'Level 1 freezer');
  await dad.click('#pa-save');
  await dad.waitForFunction(() => [...window.__pantry.S.items.values()].some(i => i.name === 'Late ice cream'));
  await go(mum, '#/places');
  await mum.locator('[data-act="place-open"][data-v="Level 1 freezer"]').click();
  await mum.fill('#pa-pl-name', 'Cellar freezer'); await mum.locator('#pa-pl-form button[type=submit]').click();
  await drain(mum);
  await net(dad, true); await drain(dad);
  const after = [...before.map(n => n === 'Level 1 freezer' ? 'Cellar freezer' : n), 'Shelf Cee'];
  await same(fsAdmin, hid, [mum, dad], 'the rename', after);
  await expect.poll(async () => (await fsAdmin.list(`households/${hid}/items`)).find(i => i.name === 'Late ice cream')?.location, { message: 'the item added under the old name kept it (nothing moved it)' }).toBe('Level 1 freezer');
  for (const p of [mum, dad]) {
    await go(p, '#/places');
    await expect(p.locator('#pa-places-other [data-act="place-open"][data-v="Level 1 freezer"]'), '"Not in your list": the item is still found').toBeVisible();
    await expect(p.locator('#pa-places-other .ui-row', { hasText: 'Level 1 freezer' }).locator('.ui-row-value')).toHaveText(/^\D*1\D*$/);
  }
  // and the way out of "Not in your list": move its items to the renamed place
  await mum.locator('#pa-places-other [data-act="place-open"][data-v="Level 1 freezer"]').click();
  await mum.locator('dialog.ui-sheet[open] [data-pl="remove"]').click();
  await mum.selectOption('#pa-mv-to', 'Cellar freezer'); await mum.locator('#pa-mv-go').click(); await drain(mum);
  await expect.poll(async () => (await fsAdmin.list(`households/${hid}/items`)).find(i => i.name === 'Late ice cream').location).toBe('Cellar freezer');
  // the old phones keep writing the single list: the rules take it; new phones ignore it
  const oldPhone = await dad.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
    try { await F.setDoc(F.doc(F.getFirestore(), 'households', hid, 'settings', 'places'), { id: 'places', list: ['Old phone fridge', 'Old phone shed'], updatedAt: String(Math.random()) }); return 'ok'; } catch (e) { return e.code; }
  }, hid);
  expect(oldPhone, 'an older phone’s write of settings/places is accepted by the rules').toBe('ok');
  await mum.waitForFunction(() => window.__pantry.S.settings.get('places')?.list?.includes('Old phone fridge'));   // (heard, and ignored)
  await dad.waitForFunction(() => window.__pantry.S.settings.get('places')?.list?.includes('Old phone shed'));
  expect(await shownPlaces(mum)).not.toContain('Old phone fridge'); expect(await shownPlaces(dad)).not.toContain('Old phone shed');
  await same(fsAdmin, hid, [mum, dad], 'after the old phone wrote', after);
  await mum.evaluate(async hid => { const F = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'); await F.deleteDoc(F.doc(F.getFirestore(), 'households', hid, 'settings', 'places')); }, hid);
  expect(await refused(mum) + await refused(dad), 'nothing refused').toBe(0);
});

// places 5. two phones migrate from the old single list at once, one of them offline and behind: no duplicates, and
// what the first one changed is not overwritten when the second's copy of the old list arrives
test('two phones migrate from the old single list, one offline and behind: both changes kept, no duplicates, nothing overwritten', async ({ phone, fsAdmin, uid }) => {
  const e1 = `mig1-${uid}@example.com`, e2 = `mig2-${uid}@example.com`, hid = 'migH-' + uid;
  await seedFamily(fsAdmin, hid, [e1, e2]);
  await fsAdmin.put(`households/${hid}/settings/places`, { id: 'places', list: ['Fridge', 'Freezer', 'Store room'], updatedAt: String(Math.random()) });
  const mig1 = await person(phone, e1, 'mig1'), mig2 = await person(phone, e2, 'mig2');
  await inFamily(mig1, hid); await inFamily(mig2, hid);
  for (const p of [mig1, mig2]) await expect.poll(() => shownPlaces(p), { message: 'an old list is shown as it is' }).toEqual(['Fridge', 'Freezer', 'Store room']);
  expect((await fsAdmin.list(`households/${hid}/places`)).length, 'nothing written just by looking').toBe(0);
  await net(mig2, false);
  await act(mig2, 'reorderPlace', placeId('Freezer'), -1);   // Freezer to the top (the first change: it writes the documents)
  await act(mig2, 'addPlace', 'Shed');
  await act(mig1, 'renamePlace', placeId('Fridge'), 'Big fridge'); await drain(mig1);   // mig1 is first: documents, then a rename
  await expect.poll(async () => (await fsAdmin.list(`households/${hid}/places`)).length, { message: 'mig1 made the three documents' }).toBe(3);
  await net(mig2, true); await drain(mig2);
  await expect.poll(async () => (await fsAdmin.list(`households/${hid}/places`)).length).toBe(4);
  const mp = await placeDocs(fsAdmin, hid);
  expect(mp.map(d => d.name), 'both changes kept; the rename was not overwritten by the late copy of the old list').toEqual(['Freezer', 'Big fridge', 'Store room', 'Shed']);
  expect(new Set(mp.map(d => d.id)).size, 'no document twice').toBe(4);
  for (const p of [mig1, mig2]) { await p.waitForFunction(() => window.__pantry.places().join() === 'Freezer,Big fridge,Store room,Shed'); expect(await refused(p), 'nothing refused').toBe(0); }
});

test('two phones start the defaults at once, both online: the same documents, no duplicates', async ({ phone, fsAdmin, uid }) => {
  const e3 = `mig3-${uid}@example.com`, e4 = `mig4-${uid}@example.com`, hid = 'migI-' + uid;
  await seedFamily(fsAdmin, hid, [e3, e4]);
  const mig3 = await person(phone, e3, 'mig3'), mig4 = await person(phone, e4, 'mig4');
  await inFamily(mig3, hid); await inFamily(mig4, hid);
  await Promise.all([act(mig3, 'addPlace', 'Pantry shelf'), act(mig4, 'addPlace', 'Garage')]);
  for (const p of [mig3, mig4]) await drain(p);
  await expect.poll(async () => (await fsAdmin.list(`households/${hid}/places`)).length, { message: 'the eleven defaults once, plus the two new places' }).toBe(11 + 2);
  const ip = await fsAdmin.list(`households/${hid}/places`);
  expect(new Set(ip.map(d => d.name.toLowerCase())).size, 'no duplicates').toBe(13);
  for (const p of [mig3, mig4]) await p.waitForFunction(() => window.__pantry.places().length === 13);
});
