// Unit tests for js/places.js (the household's list of places): node pantry/test/places.test.mjs
import assert from 'node:assert/strict';
import * as P from '../js/places.js';
import { LOCATIONS, CATALOGUE } from '../js/catalogue.js';
import { parseQuick } from '../js/quick.js';

// the defaults: the catalogue's places, with the owner's three next to their kind
assert.deepEqual(P.DEFAULT_PLACES, ['Kitchen cabinet', 'Fridge', 'Level 1 fridge', 'Freezer', 'Level 1 freezer', 'Store room', 'Basement store', 'Bathroom', 'Laundry', 'Medicine box', 'Other']);
for (const l of LOCATIONS) assert.ok(P.DEFAULT_PLACES.includes(l), l);
P.DEFAULT_PLACES.push('x'); P.DEFAULT_PLACES.pop();
// the old single list (settings/places): its valid names, or null
assert.deepEqual(P.legacyNames({ id: 'places', list: ['Fridge', 3, '  ', 'Shed'] }), ['Fridge', 'Shed']);
assert.equal(P.legacyNames(null), null); assert.equal(P.legacyNames({ id: 'places', list: [] }), null); assert.equal(P.legacyNames({ list: 'x' }), null);

// tidy names, and why a name can't be used
assert.equal(P.cleanPlace('  Level   2  fridge '), 'Level 2 fridge');
assert.equal(P.cleanPlace('x'.repeat(50)).length, 40);
const list = ['Fridge', 'Freezer', 'Store room'];
assert.equal(P.placeProblem(list, '  '), 'Type a name for the place.');
assert.equal(P.placeProblem(list, 'fridge'), 'Fridge is already in your list.', 'no duplicates, ignoring case');
assert.equal(P.placeProblem(list, ' FREEZER '), 'Freezer is already in your list.');
assert.equal(P.placeProblem(list, 'x'.repeat(41)), 'Keep it to 40 characters.');
assert.equal(P.placeProblem(list, 'x'.repeat(40)), '');
assert.equal(P.placeProblem(list, 'Level 2 fridge'), '');
assert.equal(P.placeProblem(list, 'FRIDGE', 'Fridge'), '', 'renaming may change only the case');
assert.equal(P.placeProblem(list, 'Freezer', 'Fridge'), 'Freezer is already in your list.');
assert.equal(P.placeProblem(Array.from({ length: 40 }, (_, i) => 'P' + i), 'One more'), 'You can have up to 40 places.');

// renaming or removing moves every item kept there (and only those), never changing the originals
const items = [{ id: 'a', location: 'Fridge' }, { id: 'b', location: 'Freezer' }, { id: 'c', location: 'Fridge' }, { id: 'd', location: 'Shed' }];
assert.deepEqual(P.moveItems(items, 'Fridge', 'Level 1 fridge'), [{ id: 'a', location: 'Level 1 fridge' }, { id: 'c', location: 'Level 1 fridge' }]);
assert.equal(items[0].location, 'Fridge');
assert.deepEqual([...P.placeCounts(items)], [['Fridge', 2], ['Freezer', 1], ['Shed', 1]]);

// places items use that aren't in the list are still offered, after the list ("not in your list")
assert.deepEqual(P.allPlaces(list, items), { listed: list, unlisted: ['Shed'] });
assert.deepEqual(P.allPlaces(list, [...items, { location: 'shed' }, { location: '' }], 'Bathroom'), { listed: list, unlisted: ['Shed', 'Bathroom'] });
assert.deepEqual(P.allPlaces(list, [], 'fridge').unlisted, [], 'the same place in another case is not a new one');

// ---- one document a place: placeEntries normalizes ----
const D = (id, name, order, extra = {}) => ({ id, name, order, updatedAt: 'T', ...extra });
const names = e => e.map(x => x.name);
// no documents: the old list if there is one, else the defaults, as virtual entries (orders 1, 2, 3, ...)
let e = P.placeEntries([], { id: 'places', list: ['Fridge', 'Shed', 'fridge'] });
assert.deepEqual(names(e), ['Fridge', 'Shed'], 'the old list, repeats (any case) once');
assert.ok(e.every(x => x.virtual) && e.map(x => x.order).join() === '1,2');
assert.deepEqual(names(P.placeEntries([], null)), P.DEFAULT_PLACES, 'nothing at all: the defaults');
assert.deepEqual(names(P.placeEntries(undefined, undefined)), P.DEFAULT_PLACES);
assert.notEqual(names(P.placeEntries([], null)), P.DEFAULT_PLACES, 'a copy, never the shared defaults');
// documents win over the old list, by order then name then id; the old list is ignored once there are documents
e = P.placeEntries([D('b', 'Zed', 2), D('a', 'Alpha', 2), D('c', 'First', 1), D('d', 'Last', 10)], { id: 'places', list: ['Old'] });
assert.deepEqual(names(e), ['First', 'Alpha', 'Zed', 'Last'], 'live places sorted by order, then name');
assert.ok(e.every(x => !x.virtual));
// removed ones are hidden; malformed ones ignored; the same name twice (any case) shows once and remembers the other id
e = P.placeEntries([D('a', 'Fridge', 1), D('b', 'Shed', 2, { removedAt: '2026-10-01T00:00:00.000Z', removedBy: 'Dad' }), { id: 'x', name: 3, order: 1 }, { id: 'y', name: 'No order' }, D('c', 'FRIDGE', 3), D('d', 'Bath', 4)], null);
assert.deepEqual(names(e), ['Fridge', 'Bath']); assert.deepEqual(e[0].dupes, ['c'], 'a hidden twin: removing the place removes it too');
// every place removed (two phones removed the last two at once): the defaults show, never an empty app
assert.deepEqual(names(P.placeEntries([D('a', 'Fridge', 1, { removedAt: '2026-10-01T00:00:00.000Z' })], null)), P.DEFAULT_PLACES);
// two phones adding at once (the same order): both kept, by name
assert.deepEqual(names(P.placeEntries([D('a', 'Fridge', 1), D('r1', 'Shed', 2), D('r2', 'Garage', 2)], null)), ['Fridge', 'Garage', 'Shed']);

// ---- deterministic ids and the migration documents ----
assert.equal(P.placeId('Level 1 fridge'), P.placeId('  LEVEL   1 Fridge '), 'the same name, the same id, on every phone');
assert.notEqual(P.placeId("Mum's room"), P.placeId('Mums room'), 'the hash tells punctuation apart');
for (const n of ['Fridge', 'x'.repeat(40), '!!!', 'Café ☕', "Mum's room"]) assert.match(P.placeId(n), /^[A-Za-z0-9_-]{1,40}$/, n);
assert.match(P.placeId('!!!'), /^p-x-/, 'a name with no letters still gets an id');
const virt = P.placeEntries([], { id: 'places', list: ['Fridge', 'Shed'] });
assert.deepEqual(virt.map(x => P.seedDoc(x)), [{ id: P.placeId('Fridge'), name: 'Fridge', order: 1, updatedAt: P.SEED_AT }, { id: P.placeId('Shed'), name: 'Shed', order: 2, updatedAt: P.SEED_AT }]);
assert.deepEqual(P.placeEntries([], { id: 'places', list: ['Fridge', 'Shed'] }).map(x => P.seedDoc(x)), virt.map(x => P.seedDoc(x)), 'two phones migrating at once write the same documents');
assert.ok(P.SEED_AT < '2000', 'older than any real change');
// a new place: after the highest order, any fractions included
assert.equal(P.nextOrder([]), 1); assert.equal(P.nextOrder([{ order: 1 }, { order: 2.5 }]), 3);
assert.deepEqual(P.newPlaceDoc('  Level 2   fridge ', 4, 'abc', 'T'), { id: 'abc', name: 'Level 2 fridge', order: 4, updatedAt: 'T' });

// ---- moving: one document, the midpoint ----
const E = orders => orders.map((o, i) => ({ id: 'e' + i, name: 'N' + i, order: o }));
assert.deepEqual(P.reorder(E([1, 2, 3]), 'e2', -1), [{ id: 'e2', order: 1.5 }], 'up: between its new neighbours, one change');
assert.deepEqual(P.reorder(E([1, 2, 3]), 'e0', 1), [{ id: 'e0', order: 2.5 }], 'down: between 2 and 3');
assert.deepEqual(P.reorder(E([1, 2, 3]), 'e1', -1), [{ id: 'e1', order: 0 }], 'to the top: one before the first');
assert.deepEqual(P.reorder(E([1, 2, 3]), 'e1', 1), [{ id: 'e1', order: 4 }], 'to the bottom: one after the last');
assert.deepEqual(P.reorder(E([1, 2, 3]), 'e0', -1), [], 'the top stays the top');
assert.deepEqual(P.reorder(E([1, 2, 3]), 'e2', 1), []); assert.deepEqual(P.reorder(E([1, 2, 3]), 'nope', 1), []);
// repeated moves squeeze the gap: the place always lands where asked, and when the gap gets tiny the places are renumbered
let g = E([1, 2, 3]), renumbered = 0;
const apply = (list, m) => list.map(x => ({ ...x, order: m.find(y => y.id === x.id)?.order ?? x.order })).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
for (let i = 0; i < 80; i++) {
  const mover = g[2].id, want = [g[0].id, g[2].id, g[1].id];
  const m = P.reorder(g, mover, -1);
  if (m.length > 1) renumbered++;
  g = apply(g, m);
  assert.deepEqual(g.map(x => x.id), want, 'step ' + i + ': the place lands one step up');
  assert.ok(new Set(g.map(x => x.order)).size === 3, 'orders stay different');
  const n = P.reorder(g, g[2].id, -1); g = apply(g, n); if (n.length > 1) renumbered++;
}
assert.ok(renumbered > 0 && renumbered < 20, 'renumbered now and then, not every time (' + renumbered + ')');
const squeezed = E([1, 1 + 1e-7, 2]);   // no room between the first two
let m = P.reorder(squeezed, 'e2', -1);
assert.ok(m.every(x => Number.isInteger(x.order)), 'no room: renumbered 1, 2, 3, only what changes (' + JSON.stringify(m) + ')');
const after = squeezed.map(x => ({ ...x, order: m.find(y => y.id === x.id)?.order ?? x.order })).sort((a, b) => a.order - b.order);
assert.deepEqual(after.map(x => x.id), ['e0', 'e2', 'e1'], 'and the place did move');
m = P.reorder(E([1, 1, 1]), 'e2', -1);   // equal orders (two phones added at once)
assert.ok(m.length >= 2 && new Set(m.map(x => x.order)).size === m.length, 'equal neighbours renumber');

// ---- merging two sets of places by name (copy up, restore, merging pantries) ----
const set = (docs, legacy = null) => ({ docs, legacy });
const AT = '2026-10-16T00:00:00.000Z';
// the base has documents: only the new names, after its own
let w = P.mergeInto(set([D('a', 'Fridge', 1), D('b', 'Pantry', 2)]), set([], { id: 'places', list: ['pantry', 'Garage'] }), AT);
assert.deepEqual(w, [{ id: P.placeId('Garage'), name: 'Garage', order: 3, updatedAt: AT }]);
// the base only has the old list: it becomes documents first (SEED_AT), then the new names
w = P.mergeInto(set([], { id: 'places', list: ['Fridge', 'Pantry'] }), set([D('x', 'Garage', 1)]), AT);
assert.deepEqual(w.map(d => [d.name, d.order, d.updatedAt]), [['Fridge', 1, P.SEED_AT], ['Pantry', 2, P.SEED_AT], ['Garage', 3, AT]]);
// the base said nothing (the defaults): the incoming list is all it gets
w = P.mergeInto(set([]), set([D('x', 'Garage', 1), D('y', 'Shed', 2)]), AT);
assert.deepEqual(w.map(d => [d.name, d.order]), [['Garage', 1], ['Shed', 2]]);
// nothing new, nothing written; nothing said by the incoming side, nothing written
assert.deepEqual(P.mergeInto(set([D('a', 'Fridge', 1)]), set([D('z', 'FRIDGE', 5)]), AT), []);
assert.deepEqual(P.mergeInto(set([D('a', 'Fridge', 1)]), set([]), AT), []);
// removed places come across with their markers (only if the base doesn't have them or a live one of that name)
const rm = D('r', 'Shed', 4, { removedAt: '2026-10-10T00:00:00.000Z', removedBy: 'Dad' });
assert.deepEqual(P.mergeInto(set([D('a', 'Fridge', 1)]), set([D('a2', 'Fridge', 1), rm]), AT), [rm]);
assert.deepEqual(P.mergeInto(set([D('a', 'Fridge', 1), D('s', 'Shed', 2)]), set([rm]), AT), [], 'a live Shed is there already');
assert.deepEqual(P.mergeInto(set([D('a', 'Fridge', 1), { ...rm }]), set([rm]), AT), [], 'the base has that removed place');
// the cap of 40
const full = Array.from({ length: 39 }, (_, i) => D('f' + i, 'P' + i, i + 1));
assert.deepEqual(P.mergeInto(set(full), set([D('n1', 'New one', 1), D('n2', 'New two', 2)]), AT).map(d => d.name), ['New one'], 'room for one more');
assert.ok(!P.isPlacesDoc({ id: 'places', list: [] }) && P.isPlacesDoc({ id: 'places', list: ['a'] }));
// the old list's check (a backup's settings) and well-formed place documents
for (const bad of [null, { id: 'x', list: ['a'] }, { id: 'places', list: [] }, { id: 'places', list: ['a', 1] }, { id: 'places', list: 'a' }]) assert.ok(!P.isPlacesDoc(bad), JSON.stringify(bad));
assert.ok(P.isPlaceDoc(D('a', 'Fridge', 1.5)) && !P.isPlaceDoc(D('a', '  ', 1)) && !P.isPlaceDoc({ id: 'a', name: 'x', order: '1' }) && !P.isPlaceDoc({ name: 'x', order: 1 }) && !P.isPlaceDoc(D('a', 'x', NaN)));

// Say or type matches the household's own places, multi-word ones included
const o = { today: '2026-10-16', catalogue: CATALOGUE };
const at = (s, places) => parseQuick(s, { ...o, places })[0].location;
assert.equal(at('2 Meiji milk in the level 1 fridge expires 25 Oct'), 'Level 1 fridge');
assert.equal(at('ice cream in the level one freezer'), 'Level 1 freezer', 'a number said as a word');
assert.equal(at('tissue in the basement'), 'Basement store', '"basement" is enough for Basement store');
assert.equal(at('tissue basement store'), 'Basement store');
assert.equal(at('milk in the fridge'), 'Fridge', 'plain fridge stays Fridge');
assert.equal(at('milk in the fridge', ['Level 1 fridge', 'Cupboard']), 'Level 1 fridge', 'no plain Fridge: the household’s fridge');
assert.equal(at('kaya in the cupboard', ['Cupboard', 'Fridge']), 'Cupboard', 'its own name wins over the everyday word');
assert.equal(at('rice in mum’s room', [...P.DEFAULT_PLACES, "Mum's room"]), "Mum's room", 'a curly apostrophe too');
assert.equal(at("rice in mum's room", [...P.DEFAULT_PLACES, "Mum's room"]), "Mum's room");
assert.equal(at('rice in the garage', [...P.DEFAULT_PLACES, 'Garage shelf']), 'Garage shelf', 'a custom place without its kind word');
const q = parseQuick('3 tins of sardines in the basement', o)[0];
assert.deepEqual([q.qty, q.name, q.location], [3, 'Sardines in tomato sauce', 'Basement store'], 'the place words are not part of the name');
console.log('pantry places: ok');
