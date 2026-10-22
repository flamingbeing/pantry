// Unit tests for the two shapes of batches and for changes as instructions (js/logic.js, js/sync.js):
// node pantry/test/ops.test.mjs
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import * as SY from '../js/sync.js';

const T = '2026-10-16';
const qtys = it => Object.fromEntries(L.normalizeItem(it).batches.map(b => [b.id, b.qty]));

// ---- normalizeItem: the array and the map, one shape out ----
const arr = { id: 'milk', name: 'Milk', batches: [{ id: 'a', qty: 2, expiry: '2026-11-01' }, { qty: 1, expiry: null }, { id: 'a', qty: 3 }] };
const map = { id: 'milk', name: 'Milk', batches: { b2: { qty: 1, expiry: '2026-12-01' }, b1: { qty: 4, expiry: null } } };
const na = L.normalizeItem(arr), nm = L.normalizeItem(map);
assert.equal(na._arr, true); assert.equal(nm._arr, false);
assert.deepEqual(na.batches.map(b => b.id), ['a', L.legacyBatchId('milk', 1), L.legacyBatchId('milk', 2)], 'own ids kept; missing and repeated ids derived from the item id and index');
assert.deepEqual(nm.batches.map(b => [b.id, b.qty]), [['b1', 4], ['b2', 1]], 'a map lists in key order, ids from the keys');
// two phones converting the same old item agree on every id
assert.deepEqual(L.normalizeItem(JSON.parse(JSON.stringify(arr))).batches.map(b => b.id), na.batches.map(b => b.id));
assert.notEqual(L.legacyBatchId('milk', 1), L.legacyBatchId('rice', 1), 'derived from the item id too');
assert.ok(L.goodBatchId(L.legacyBatchId('x'.repeat(200), 99)), 'always a valid id');
// idempotent, and no batches at all is fine
assert.deepEqual(L.normalizeItem(na), na);
assert.deepEqual(L.normalizeItem({ id: 'x' }).batches, []);
assert.deepEqual(L.normalizeItem({ id: 'x', batches: null }).batches, []);
// garbage in, nothing broken out: bad ids and entries are skipped, quantities clamped
const junk = L.normalizeItem({ id: 'j', batches: { 'a.b': { qty: 1 }, ok: { qty: 'x' }, neg: { qty: -3 }, big: { qty: 1e9 }, nul: null } });
assert.deepEqual(junk.batches.map(b => [b.id, b.qty]), [['big', 9999], ['neg', 0], ['ok', 0]]);
assert.equal(L.totalQty({ id: 'n', batches: [{ id: 'a', qty: -2 }, { id: 'b', qty: 3 }] }), 3, 'stock never shows below 0');
assert.equal(L.totalQty(map), 5, 'stock of a raw map item');
assert.equal(L.fefo(map).length, 2);

// ---- toStored / plainItem ----
const st = L.toStored(na);
assert.ok(!Array.isArray(st.batches) && !('_arr' in st));
assert.deepEqual(Object.keys(st.batches), ['a', L.legacyBatchId('milk', 1), L.legacyBatchId('milk', 2)]);
assert.ok(!('id' in st.batches.a) && st.batches.a.qty === 2);
assert.deepEqual(L.toStored({ id: 'z', batches: [{ id: 'q', qty: 0 }] }).batches, {}, 'a spent batch is not written');
assert.deepEqual(qtys(L.toStored(na)), qtys(na), 'round trip');
assert.ok(Array.isArray(L.plainItem(nm).batches) && !('_arr' in L.plainItem(nm)), 'backups keep arrays');
assert.deepEqual(L.parseBackup(JSON.stringify(L.backup({ items: [nm] }))).items[0].batches.map(b => b.id), ['b1', 'b2'], 'a backup of a map item reads back');
assert.equal(L.parseBackup(JSON.stringify({ app: 'pantry', items: [map] })).items[0].batches.length, 2, 'a backup file holding the map shape reads too');

// ---- applyOps ----
const it = L.normalizeItem({ id: 'i', name: 'Soy', location: 'Fridge', batches: { a: { qty: 3, expiry: '2027-01-01' }, b: { qty: 1, expiry: null } } });
let o = { set: { location: 'Pantry', 'batches.a.expiry': '2027-02-02' }, inc: { 'batches.b.qty': -1, 'batches.n.qty': 2 }, del: [] };
let r = L.applyOps(it, o);
assert.equal(r.location, 'Pantry'); assert.equal(it.location, 'Fridge', 'never changes the item given');
assert.deepEqual(qtys(r), { a: 3, b: 0, n: 2 }, 'inc adds, and creates a batch it names');
assert.equal(r.batches.find(b => b.id === 'a').expiry, '2027-02-02');
assert.equal(r._arr, false);
// del a batch, del a field of one, del an item field
r = L.applyOps(it, { set: {}, inc: {}, del: ['batches.b', 'batches.a.expiry', 'location'] });
assert.deepEqual(r.batches.map(b => b.id), ['a']); assert.ok(!('expiry' in r.batches[0])); assert.ok(!('location' in r));
// a whole batch set
r = L.applyOps(it, { set: { 'batches.z': { qty: 5, expiry: null } }, inc: {}, del: [] });
assert.equal(qtys(r).z, 5);
// below zero shows as 0, comes back with the next add
r = L.applyOps(it, { set: {}, inc: { 'batches.b.qty': -4 }, del: [] });
assert.equal(qtys(r).b, 0); assert.equal(L.totalQty(r), 3);
// the same ops from an old-style array item
r = L.applyOps(arr, { set: {}, inc: { [`batches.a.qty`]: -1 }, del: [] });
assert.equal(qtys(r).a, 1);
// ops are valid only when no two paths overlap
assert.ok(L.opsValid(o)); assert.ok(!L.opsValid({ set: { batches: {} }, inc: { 'batches.a.qty': 1 }, del: [] })); assert.ok(!L.opsValid({ set: { 'a.b': 1, 'a.b': 2 }, inc: { 'a.b': 1 }, del: [] }));
assert.deepEqual(L.mergeOps({ set: { a: 1 }, inc: { 'batches.x.qty': 1 }, del: [] }, null, { set: { b: 2 }, inc: {}, del: ['c'] }), { set: { a: 1, b: 2 }, inc: { 'batches.x.qty': 1 }, del: ['c'] });

// ---- the stock changes are instructions ----
const milk = L.normalizeItem({ id: 'm', name: 'Milk', openDays: 5, location: 'Fridge', batches: { a: { qty: 2, expiry: '2026-10-20', addedAt: '2026-10-10' }, b: { qty: 3, expiry: '2026-12-01', addedAt: '2026-10-11' } } });
let u = L.takeOut(milk, { qty: 3, today: T });
assert.deepEqual(u.ops.inc, { 'batches.a.qty': -2, 'batches.b.qty': -1 }, 'first expiring first, each batch by inc');
assert.deepEqual(u.ops.set, {}); assert.equal(u.event.qty, 3);
assert.deepEqual(qtys(u.item), { a: 0, b: 2 });
assert.ok(L.opsValid(u.ops));
assert.equal(L.takeOut(L.normalizeItem({ id: 'e', batches: {} }), {}).event, null);
assert.ok(L.opsEmpty(L.takeOut(L.normalizeItem({ id: 'e', batches: {} }), {}).ops));
// two phones each use one of the same batch: two `inc -1`, and the server adds them
const one = L.takeOut(milk, { batchId: 'b', today: T }).ops;
const both = L.applyOps(L.applyOps(milk, one), one);
assert.equal(qtys(both).b, 1, 'both uses count (3 - 2)');
// add stock: a new batch, set field by field and one inc
u = L.addStock(milk, { qty: 4, expiry: '2027-01-01', id: 'n1', at: '2026-10-16T01:00:00Z' });
assert.deepEqual(u.ops.inc, { 'batches.n1.qty': 4 });
assert.equal(u.ops.set['batches.n1.expiry'], '2027-01-01'); assert.equal(u.ops.set['batches.n1.addedAt'], '2026-10-16');
assert.equal(L.totalQty(u.item), 9);
// open one: the source batch loses one, a batch of the day gains one, so two phones opening add up
u = L.openOne(milk, { today: T, batchId: 'a' });
assert.equal(u.ops.inc['batches.a.qty'], -1); const oid = Object.keys(u.ops.inc).find(k => k !== 'batches.a.qty').split('.')[1];
assert.ok(L.goodBatchId(oid) && oid === 'a-o20261016');
assert.equal(u.ops.set[`batches.${oid}.openedAt`], T); assert.equal(u.ops.set[`batches.${oid}.expiry`], '2026-10-20');
const twice = L.applyOps(u.item, u.ops);
assert.equal(qtys(twice)[oid], 2, 'two phones opening from one batch on one day make two opened');
assert.equal(qtys(twice).a, 0, '...and stock never shows below 0');
// freeze and thaw set fields, never the batch
u = L.freezeBatch(milk, { batchId: 'b', days: 365, place: 'Freezer', today: T });
assert.deepEqual(Object.keys(u.ops.set).sort(), ['batches.b.expiry', 'batches.b.frozenAt', 'batches.b.packExpiry', 'batches.b.packPlace', 'batches.b.thawedAt']); assert.deepEqual(u.ops.inc, {});
assert.equal(u.item.location, 'Fridge', 'batch a is still unfrozen: the item stays');
// level
u = L.setLevel({ id: 's', measure: 'level', batches: [] }, { level: 'low' });
assert.deepEqual(u.ops.set, { level: 'low' });
// spent batches stay (hidden at 0) until an item has piled up 40; then the next add tidies them all
const spent = L.normalizeItem({ id: 'sp', batches: { old: { qty: 0, addedAt: '2026-01-01' }, fresh: { qty: 0, addedAt: '2026-10-15' }, live: { qty: 2, addedAt: '2026-01-01' } } });
assert.deepEqual(L.spentBatches(spent), []);
assert.deepEqual(L.addStock(spent, { qty: 1, id: 'n' }).ops.del, []);
const pile = L.normalizeItem({ id: 'p', batches: { ...Object.fromEntries(Array.from({ length: 39 }, (_, i) => [`s${i}`, { qty: 0, addedAt: '2026-10-15' }])), live: { qty: 2 } } });
assert.equal(L.spentBatches(pile).length, 39, 'a pile of 40 is all tidied, the live one stays');
assert.ok(!L.spentBatches(pile).includes('batches.live'));
assert.equal(L.addStock(pile, { qty: 1, id: 'n' }).ops.del.length, 39);
// the rules allow 60 batches: stock written on a long-lived item never grows past that
assert.equal(L.MAX_BATCHES, 60);

// ---- undo is the inverse instructions ----
u = L.takeOut(milk, { qty: 2, today: T });
let inv = L.invertOps(u.ops, milk, u.item);
assert.deepEqual(inv.inc, { 'batches.a.qty': 2 }); assert.deepEqual(L.applyOps(u.item, inv).batches.map(b => b.qty), milk.batches.map(b => b.qty));
// someone else used one meanwhile: undo gives back only ours
const elsewhere = L.applyOps(u.item, L.takeOut(u.item, { batchId: 'b', today: T }).ops);
assert.deepEqual(qtys(L.applyOps(elsewhere, inv)), { a: 2, b: 2 }, 'their use stays');
// a set is put back only when nobody changed it since
const solo = L.normalizeItem({ ...milk, batches: { b: { qty: 3, expiry: '2026-12-01', addedAt: '2026-10-11' } } });   // all of it frozen: the item moves too
u = L.freezeBatch(solo, { batchId: 'b', place: 'Freezer', today: T });
inv = L.invertOps(u.ops, solo, u.item);
assert.equal(inv.set.location, 'Fridge'); assert.equal(inv.set['batches.b.expiry'], '2026-12-01');
assert.equal(inv.set['batches.b.thawedAt'], undefined, 'a field that was missing is removed again');
assert.ok(inv.del.includes('batches.b.frozenAt') || inv.set['batches.b.frozenAt'] === undefined);
const moved = L.applyOps(u.item, { set: { location: 'Shelf' }, inc: {}, del: [] });
inv = L.invertOps(u.ops, solo, moved);
assert.ok(!('location' in inv.set), 'someone moved it since: Undo leaves their place');
assert.equal(inv.set['batches.b.expiry'], '2026-12-01');
// a batch this change made is emptied by its inc, not deleted
u = L.addStock(milk, { qty: 2, id: 'n2' });
inv = L.invertOps(u.ops, milk, u.item);
assert.deepEqual(inv, { set: {}, inc: { 'batches.n2.qty': -2 }, del: [] });
assert.equal(L.totalQty(L.applyOps(L.applyOps(u.item, L.takeOut(u.item, { batchId: 'n2' }).ops), inv)), 5, 'undo of an add after someone used from it keeps their use');
// the stamps are never put back
assert.deepEqual(L.invertOps({ set: { updatedAt: 'x', updatedBy: 'y' }, inc: {}, del: [] }, milk), L.emptyOps());
// a deleted field comes back
inv = L.invertOps({ set: {}, inc: {}, del: ['location'] }, milk, L.applyOps(milk, { set: {}, inc: {}, del: ['location'] }));
assert.deepEqual(inv.set, { location: 'Fridge' });

// ---- the chip and the refused list ----
assert.deepEqual(SY.syncState({}), { kind: 'saved', text: 'Saved' });
assert.deepEqual(SY.syncState({ pending: 2, cache: true }), { kind: 'waiting', text: 'Waiting for signal (2 changes)' });
assert.equal(SY.syncState({ pending: 1, offline: true }).text, 'Waiting for signal (1 change)');
assert.equal(SY.syncState({ pending: 1 }).kind, 'saved', 'a normal save is confirmed before it is worth a chip');
assert.equal(SY.syncState({ pending: 1, waited: 2000 }).kind, 'waiting');
assert.deepEqual(SY.syncState({ pending: 3, refused: 1 }), { kind: 'attention', text: 'Needs attention' }, 'attention comes first');
assert.equal(SY.syncState({ refused: 2 }).text, 'Needs attention (2)');
assert.match(SY.refusedReason('permission-denied'), /may not be in the pantry/);
assert.match(SY.refusedReason('not-found'), /removed on another phone/);
assert.match(SY.refusedReason('weird'), /didn’t take it/);
assert.equal(SY.describeRefused({ kind: 'items', op: 'patch', id: 'x', name: 'Milk' }), 'A change to Milk');
assert.equal(SY.describeRefused({ kind: 'items', op: 'del', id: 'x', name: 'Milk' }), 'Removing Milk');
assert.equal(SY.describeRefused({ kind: 'shop', op: 'put', id: 'x' }), 'Saving a shopping list line');
let list = [];
for (let i = 0; i < 40; i++) list = SY.addRefused(list, { n: 'r' + i, hid: i % 2 ? 'h1' : 'h2' });
assert.equal(list.length, SY.MAX_REFUSED); assert.equal(list.at(-1).n, 'r39'); assert.equal(list[0].n, 'r10');
assert.equal(SY.refusedFor(list, 'h1').length, 15);
assert.equal(SY.dropRefused(list, 'r39').length, SY.MAX_REFUSED - 1);
assert.ok(SY.addRefused([], { n: 'big', obj: 'x'.repeat(300000) }).length === 1, 'one oversized record is still kept alone');
assert.ok(SY.keepable({ kind: 'items' }) && !SY.keepable({ kind: 'photos' }) && !SY.keepable(null));
console.log('pantry ops: ok');
