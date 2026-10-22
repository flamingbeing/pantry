// Bulk edit's rules (js/bulk-items.js): what each choice does to an item as instructions, what is skipped and warned, and that Undo
// (logic.js invertOps) puts back exactly what was changed, for batches of moves, conversions, date changes and deletes.
import assert from 'node:assert/strict';
import * as B from '../js/bulk-items.js';
import * as L from '../js/logic.js';

const T = '2026-10-16';
const item = (id, f = {}, batches = [{ id: 'b1', qty: 2, expiry: '2026-12-01' }]) => L.normalizeItem({ id, name: id.toUpperCase(), location: 'Fridge', category: 'Dairy & eggs', lowAt: 1, batches, ...f });
const staple = (id, level = 'plenty') => item(id, { measure: 'level', level }, []);
const ch = o => ({ ...B.none(), ...o });

// ---- nothing chosen / incomplete ----
assert.equal(B.isEmpty(B.none()), true); assert.equal(B.isEmpty(ch({ list: true })), false);
assert.equal(B.missing(ch({ place: { to: '' } })), 'Choose the place');
assert.equal(B.missing(ch({ category: { to: '' } })), 'Choose the category');
assert.equal(B.missing(ch({ expiry: { kind: 'shift', days: 0, dir: 'later' } })), 'Type how many days (1 or more)');
assert.equal(B.missing(ch({ expiry: { kind: 'shift', days: 'x', dir: 'later' } })), 'Type how many days (1 or more)');
assert.equal(B.missing(ch({ expiry: { kind: 'set', date: '' } })), 'Choose the date');
assert.equal(B.missing(ch({ place: { to: 'Garage' }, expiry: { kind: 'set', date: '2027-01-01' } })), '');
assert.equal(B.overwrites(ch({ list: true })), false, 'adding to the list replaces nothing'); assert.equal(B.overwrites(ch({ expiry: { kind: 'shift', days: 3, dir: 'later' } })), false);
assert.equal(B.overwrites(ch({ place: { to: 'Garage' } })), true); assert.equal(B.overwrites(ch({ expiry: { kind: 'set', date: T } })), true);

// ---- place and category ----
let a = item('a'), p = B.planItem(a, ch({ place: { to: '  Garage ' }, category: { to: 'Pet' } }));
assert.deepEqual(p.ops.set, { location: 'Garage', category: 'Pet' });
assert.equal(L.opsEmpty(B.planItem(a, ch({ place: { to: 'Fridge' } })).ops), true, 'already there: nothing');

// ---- best-before: shift, set, skips ----
const two = item('t', {}, [{ id: 'x', qty: 1, expiry: '2026-12-30' }, { id: 'y', qty: 2, expiry: '2027-01-05' }, { id: 'z', qty: 0, expiry: '2026-11-01' }, { id: 'n', qty: 1, expiry: null }]);
p = B.planItem(two, ch({ expiry: { kind: 'shift', days: 3, dir: 'later' } }));
assert.deepEqual(p.ops.set, { 'batches.x.expiry': '2027-01-02', 'batches.y.expiry': '2027-01-08' }, 'every dated batch with stock moves by N days; spent and undated ones are left');
p = B.planItem(two, ch({ expiry: { kind: 'shift', days: 10, dir: 'earlier' } }));
assert.deepEqual(p.ops.set, { 'batches.x.expiry': '2026-12-20', 'batches.y.expiry': '2026-12-26' });
p = B.planItem(two, ch({ expiry: { kind: 'set', date: '2027-03-01' } }));
assert.deepEqual(Object.keys(p.ops.set).sort(), ['batches.n.expiry', 'batches.x.expiry', 'batches.y.expiry'], 'a set date goes on every batch with stock (the undated one too)');
assert.deepEqual(B.planItem(item('e', {}, []), ch({ expiry: { kind: 'set', date: T } })).skip, ['noBatches']);
assert.deepEqual(B.planItem(item('e', {}, [{ id: 'q', qty: 0, expiry: '2026-12-01' }]), ch({ expiry: { kind: 'shift', days: 1, dir: 'later' } })).skip, ['noBatches'], 'only spent batches: nothing in stock');
assert.deepEqual(B.planItem(item('d', {}, [{ id: 'q', qty: 1, expiry: null }]), ch({ expiry: { kind: 'shift', days: 1, dir: 'later' } })).skip, ['noDates']);
assert.deepEqual(B.planItem(staple('s'), ch({ expiry: { kind: 'set', date: T } })).skip, ['level'], 'a Plenty/Low/Out item has no dates');
assert.deepEqual(B.planItem(item('same', {}, [{ id: 'q', qty: 1, expiry: '2027-03-01' }]), ch({ expiry: { kind: 'set', date: '2027-03-01' } })).ops.set, {}, 'already that date');

// ---- how it is kept track of ----
p = B.planItem(item('c1', { lowAt: 3 }, [{ id: 'q', qty: 2 }]), ch({ mode: 'level' }));
assert.deepEqual(p.ops.set, { measure: 'level', level: 'low' }, 'at or under its "on the list when down to" number: Low'); assert.deepEqual(p.notes, ['hidesCounts']);
assert.equal(B.planItem(item('c2', { lowAt: 1 }, [{ id: 'q', qty: 5 }]), ch({ mode: 'level' })).ops.set.level, 'plenty');
assert.equal(B.planItem(item('c3', {}, []), ch({ mode: 'level' })).ops.set.level, 'out'); assert.deepEqual(B.planItem(item('c3', {}, []), ch({ mode: 'level' })).notes, [], 'nothing hidden when there was no stock');
assert.equal(L.opsEmpty(B.planItem(staple('s'), ch({ mode: 'level' })).ops), true, 'already Plenty/Low/Out');
p = B.planItem(staple('s', 'low'), ch({ mode: 'count' }));
assert.deepEqual(p.ops.del, ['measure', 'level']); assert.deepEqual(p.notes, ['noStock'], 'a staple with no stock counted shows None left: warned');
assert.deepEqual(B.planItem(item('k', { measure: 'level', level: 'plenty' }, [{ id: 'q', qty: 4 }]), ch({ mode: 'count' })).notes, [], 'its old batches come back');
assert.equal(L.opsEmpty(B.planItem(item('plain'), ch({ mode: 'count' })).ops), true);
// converting and a date in one go: the converted item has no dates
assert.deepEqual(B.planItem(item('m'), ch({ mode: 'level', expiry: { kind: 'set', date: T } })).skip, ['level']);

// ---- shopping list and delete ----
assert.equal(B.planItem(a, ch({ list: true }), { onList: () => false }).list, true);
p = B.planItem(a, ch({ list: true }), { onList: id => id === 'a' }); assert.equal(p.list, false); assert.deepEqual(p.skip, ['onList']);
p = B.planItem(a, ch({ bin: true, place: { to: 'Garage' }, list: true }), { by: 'Mum' });
assert.deepEqual(Object.keys(p.ops.set).sort(), ['removedAt', 'removedBy'], 'delete is applied alone'); assert.equal(p.list, false); assert.equal(p.ops.set.removedBy, 'Mum');

// ---- a whole plan ----
const items = [item('p1'), item('p2', { location: 'Garage' }), staple('p3'), item('p4', {}, [])];
let r = B.plan(items, ch({ place: { to: 'Garage' }, expiry: { kind: 'set', date: '2027-02-02' } }));
assert.equal(r.total, 4); assert.equal(r.pairs.length, 4, 'p2 is already there but its date changes; the staple and the empty one move');
assert.deepEqual(r.skipped, { level: 1, noBatches: 1 });
assert.equal(r.changing, 4); assert.equal(r.unchanged, 0);
assert.match(B.headline(r), /^4 items will change$/);
const notes = B.reviewNotes(r, ch({ place: { to: 'Garage' }, expiry: { kind: 'set', date: '2027-02-02' } })).map(x => x.text);
assert.ok(notes.some(t => /1 item skipped for best-before: kept as Plenty, Low, Out/.test(t)) && notes.some(t => /nothing in stock/.test(t)) && notes.some(t => /replaces what these items have now/.test(t)), notes.join(' | '));
r = B.plan(items, ch({ list: true }), { onList: id => id === 'p1' });
assert.equal(r.addToList.length, 3); assert.equal(r.pairs.length, 0); assert.equal(r.changing, 3); assert.equal(r.skipped.onList, 1);
r = B.plan(items, ch({ mode: 'level' }));
assert.deepEqual(r.notes, { hidesCounts: 2 }, 'p1 and p2 had stock; the empty one had none to hide'); assert.equal(r.unchanged, 1, 'the staple is already');
assert.ok(B.reviewNotes(r, ch({ mode: 'level' })).some(x => x.kind === 'warn' && /2 items will stop counting/.test(x.text)));
r = B.plan(items, ch({ bin: true }));
assert.equal(r.deleting, true); assert.match(B.headline(r), /^4 items will be deleted$/);
assert.deepEqual(B.changeLines(ch({ bin: true }), r), ['Delete: 4 items go to Recently removed (30 days to put them back)']);
assert.deepEqual(B.changeLines(ch({ place: { to: 'Garage' }, mode: 'level', expiry: { kind: 'shift', days: 2, dir: 'earlier' }, list: true }), r),
  ['Place: move to Garage', 'Kept track of: Plenty, Low, Out', 'Best-before: 2 days earlier', 'Shopping list: add']);
// samples: before and after
const one = B.plan([item('s1')], ch({ place: { to: 'Garage' } })).pairs[0];
assert.equal(B.summary(one.before), 'S1 · Fridge · Dairy & eggs · 2 left · use by 2026-12-01'); assert.equal(B.summary(one.after), 'S1 · Garage · Dairy & eggs · 2 left · use by 2026-12-01');
assert.equal(B.summary(staple('s9', 'low')), 'S9 · Fridge · Dairy & eggs · Low');

// ---- Undo round trips: put back exactly what was changed, and leave what someone changed since ----
const apply = (it, ops) => L.applyOps(it, ops);
const undo = (pairs, now) => pairs.map(x => { const n = now.find(i => i.id === x.id); return { id: x.id, inv: L.invertOps(x.ops, x.before, n) }; });
const strip = it => { const { updatedAt, updatedBy, _arr, ...rest } = L.normalizeItem(it); rest.batches = [...rest.batches].sort((x, y) => (x.id < y.id ? -1 : 1)); return JSON.parse(JSON.stringify(rest)); };
for (const c of [ch({ place: { to: 'Garage' } }), ch({ category: { to: 'Pet' } }), ch({ mode: 'level' }), ch({ expiry: { kind: 'shift', days: 7, dir: 'later' } }),
  ch({ expiry: { kind: 'set', date: '2027-05-05' } }), ch({ place: { to: 'Garage' }, category: { to: 'Pet' }, mode: 'level' }), ch({ bin: true })]) {
  const pool = [item('u1'), item('u2', { location: 'Garage' }), two, staple('u3', 'low'), item('u4', { lowAt: 5 }, [{ id: 'q', qty: 3, expiry: '2026-11-11' }])];
  const r2 = B.plan(pool, c, { by: 'Mum' });
  const after = pool.map(it => { const x = r2.pairs.find(y => y.id === it.id); return x ? apply(it, x.ops) : it; });
  const back = undo(r2.pairs, after);
  const restored = after.map(it => { const b = back.find(y => y.id === it.id); return b ? apply(it, b.inv) : it; });
  pool.forEach((orig, i) => assert.deepEqual(strip(restored[i]), strip(orig), `Undo of ${JSON.stringify(c)} puts ${orig.id} back exactly`));
}
// and the conversion back and forth keeps the stock: counting -> level -> counting
{
  const o = item('rt', { lowAt: 0 }, [{ id: 'q', qty: 4, expiry: '2026-12-12' }]);
  const l = apply(o, B.planItem(o, ch({ mode: 'level' })).ops);
  assert.equal(L.isStaple(l), true); assert.equal(l.level, 'plenty'); assert.equal(l.batches[0].qty, 4, 'the stock is still there, hidden');
  const c2 = apply(l, B.planItem(l, ch({ mode: 'count' })).ops);
  assert.equal(L.isStaple(c2), false); assert.equal(L.totalQty(c2), 4, 'and back again'); assert.equal(c2.batches[0].expiry, '2026-12-12');
}
// someone changed it since: that field is left, the rest is put back
{
  const pool = [item('w1'), item('w2')];
  const r3 = B.plan(pool, ch({ place: { to: 'Garage' } }));
  const now = r3.pairs.map(x => apply(x.item, x.ops));
  now[1] = { ...now[1], location: 'Freezer' };   // another phone moved w2 again
  const back = undo(r3.pairs, now);
  assert.equal(L.opsEmpty(back[0].inv), false); assert.equal(L.opsEmpty(back[1].inv), true, 'w2 is left where the other phone put it');
}
console.log('pantry bulk-items: ok');
