// What the Firestore rules allow and refuse, asked by real phones signed in as made-up people (local emulators, demo-pantry;
// never the live project). Each test has its own family, so they run in any order and side by side.
//   - an outsider reads and writes nothing; a member can't remove the owner or take the pantry
//   - settings/people (names): that id, exactly id/names/updatedAt, at most 20 names of 1-40 characters on one line, keyed by
//     emails; and the same judged by field (what the app writes)
//   - settings/places (the old single list, still taken from older phones) and places/{id} (one document each)
// Run: npx playwright test sync-rules
import { test, expect } from './fixtures.mjs';
import { person, seedFamily, inFamily, OK, NO } from './sync-lib.mjs';

async function members(phone, fsAdmin, uid) {
  const mumE = `mum-${uid}@example.com`, dadE = `dad-${uid}@example.com`, hid = 'hh-' + uid;
  await seedFamily(fsAdmin, hid, [mumE, dadE]);
  return { mumE, dadE, hid };
}

test('an outsider can’t read or write a family’s pantry, and Dad can’t remove the owner or take the pantry', async ({ phone, fsAdmin, uid }) => {
  const { dadE, mumE, hid } = await members(phone, fsAdmin, uid);
  const dad = await person(phone, dadE, 'dad');
  const stranger = await person(phone, `stranger-${uid}@example.com`, 'stranger');
  await inFamily(dad, hid);
  await expect(stranger.locator('[data-act="hh-create"]')).toBeVisible();
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
  expect(denied, 'outsider denied: ' + denied.join(', ')).toEqual(Array(9).fill('permission-denied'));
  const ownerKept = await dad.evaluate(async hid => {
    const F = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const out = [];
    try { await F.updateDoc(F.doc(F.getFirestore(), 'households', hid), { members: ['dad@example.com'] }); out.push('wrote'); } catch (e) { out.push(e.code); }
    try { await F.updateDoc(F.doc(F.getFirestore(), 'households', hid), { owner: 'dad@example.com' }); out.push('wrote'); } catch (e) { out.push(e.code); }
    return out;
  }, hid);
  expect(ownerKept).toEqual(['permission-denied', 'permission-denied']);
});

test('names (settings/people): the rules for the whole document', async ({ phone, fsAdmin, uid }) => {
  const { dadE, hid } = await members(phone, fsAdmin, uid);
  const dad = await person(phone, dadE, 'dad');
  await inFamily(dad, hid);
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
  expect(peopleRules).toEqual({
    '20 names of 40 characters': 'ok', read: 'ok', 'no names': 'ok', '21 names': 'permission-denied', 'a 41-character name': 'permission-denied',
    'an empty name': 'permission-denied', 'a name with a newline': 'permission-denied', 'a number': 'permission-denied',
    'a key that is not an email': 'permission-denied', 'not a map': 'permission-denied', 'another field': 'permission-denied',
    'no updatedAt': 'permission-denied', 'a mismatched id field': 'permission-denied', 'another id': 'permission-denied', 'back to Dad': 'ok',
  });
});

test('names by field: the rules judge the names as they will be', async ({ phone, fsAdmin, uid }) => {
  const { mumE, hid } = await members(phone, fsAdmin, uid);
  const mum = await person(phone, mumE, 'mum');
  await inFamily(mum, hid);
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
  expect(nameRules2).toEqual({
    'a name by field': OK, 'a name cleared by field': OK, 'the last name cleared': OK, 'a name by field again (an empty map is fine)': OK,
    'a 41-character name': NO, 'an empty name': NO, 'a name with a new line': NO, 'a number': NO, 'a key that is not an email': NO,
    'an unknown field': NO, 'the id changed': NO, 'updatedAt removed': NO, 'names removed': NO,
    'the 21st name by field': NO, 'the 20th renamed by field': OK, 'one cleared and one added in one write': OK,
    'the first name, by a merge (no document yet)': OK, 'a name by merge on top': OK, 'a bad name by merge': NO, 'a field change with no document': NO,
  });
  expect((await fsAdmin.get(`households/${hid}/settings/people`)).names).toEqual({ 'mum@example.com': 'Jun', 'dad@example.com': 'Dad' });
});

test('places, the old single list (settings/places): members only, at most 40 names of 1-40 characters', async ({ phone, fsAdmin, uid }) => {
  const { mumE, hid } = await members(phone, fsAdmin, uid);
  const mum = await person(phone, mumE, 'mum');
  const stranger = await person(phone, `stranger-${uid}@example.com`, 'stranger');
  await inFamily(mum, hid);
  await expect(stranger.locator('[data-act=\"hh-create\"]')).toBeVisible();   // (signed in and settled before it probes)
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
  expect(placeRules).toEqual({
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
  expect(outsiderPlaces, 'outsider and places: ' + outsiderPlaces.join(', ')).toEqual(Array(3).fill('permission-denied'));
});

test('places (one document each): the rules for fields, ids, removal, migration copies and outsiders', async ({ phone, fsAdmin, uid }) => {
  const { mumE, hid } = await members(phone, fsAdmin, uid);
  const mum = await person(phone, mumE, 'mum');
  const stranger = await person(phone, `stranger-${uid}@example.com`, 'stranger');
  await inFamily(mum, hid);
  await expect(stranger.locator('[data-act=\"hh-create\"]')).toBeVisible();   // (signed in and settled before it probes)
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
  expect(placeRules2).toEqual({
    'a place': OK, read: OK, list: OK, 'a fractional order': OK, 'a negative order': OK, 'a name of 40 characters': OK, 'a name of 41 characters': NO, 'an empty name': NO,
    'a name with a new line': NO, 'a number for a name': NO, 'a text order': NO, 'no order': NO, 'no updatedAt': NO, 'another field': NO,
    'an id that is not the document id': NO, 'a document id with a dot': NO, 'a document id of 40 characters': OK, 'a document id of 41 characters': NO,
    'removedAt and removedBy': OK, 'a removedAt that is not a time': NO, 'a removedAt of null': NO, 'a removedBy over 40 characters': NO,
    'a freezer kind': OK, 'an unknown kind': NO, 'a kind by field': OK, 'the kind removed by field': OK,
    'a rename by field': OK, 'a move by field': OK, 'a removal by field': OK, 'a restore by field': OK, 'an empty name by field': NO, 'an unknown field by field': NO,
    'the name field removed': NO, 'a field change of a place that isn’t there': NO,   // (an update has no document to build on: refused, not "not found")
   
    'a migration document, new': OK, 'the same again (another phone migrating)': OK, 'the migration time with another name': NO, 'a rename of it by field': OK,
    'a late migration copy over the rename': NO, 'a late migration copy over a removal': NO, delete: OK,
  });
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
  expect(outsiderP, 'outsider and places and names: ' + outsiderP.join(', ')).toEqual(Array(6).fill(NO));
});
