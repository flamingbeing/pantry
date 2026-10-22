// My order (js/order.js): midpoints, append, prepend, collisions, renumbering, tie-breaks, items without a number.
import assert from 'node:assert/strict';
import { orderBetween, noRoom, renumber, planMove, compareOrder, sortByOrder, hasOrder, positionOf, stepTarget, ORDER_LIMIT, MIN_GAP } from '../js/order.js';

const it = (id, order, name = id) => (order === undefined ? { id, name } : { id, name, order });
const ids = l => l.map(x => x.id).join('');
// what a list looks like after the writes of a plan
const apply = (list, plan) => list.map(x => { const s = plan.sets.find(y => y.id === x.id); return s ? { ...x, order: s.order } : x; });

// ---- the numbers ----
assert.equal(orderBetween(1, 2), 1.5, 'between: the midpoint');
assert.equal(orderBetween(1, 1.5), 1.25);
assert.equal(orderBetween(5, undefined), 6, 'append: last + 1');
assert.equal(orderBetween(5, null), 6);
assert.equal(orderBetween(undefined, 5), 4, 'prepend: first - 1');
assert.equal(orderBetween(undefined, undefined), 1, 'nothing there: 1');
assert.equal(orderBetween(-3, 3), 0);
assert.equal(noRoom(1, 1), true, 'the same number: no room');
assert.equal(noRoom(2, 1), true, 'wrong way round: no room');
assert.equal(noRoom(1, 1 + MIN_GAP / 2), true, 'too close to tell apart');
assert.equal(noRoom(1, 2), false); assert.equal(noRoom(undefined, 2), false); assert.equal(noRoom(1, undefined), false);
assert.equal(hasOrder({ order: 1.5 }), true); assert.equal(hasOrder({ order: '2' }), false); assert.equal(hasOrder({ order: NaN }), false);
assert.equal(hasOrder({ order: ORDER_LIMIT }), false, 'outside the rules’ limit counts as no order'); assert.equal(hasOrder({}), false); assert.equal(hasOrder(null), false);

// ---- sorting: numbers first, then those without, ties by name then id ----
assert.equal(ids(sortByOrder([it('c', 3), it('a'), it('b', 1), it('d')])), 'bcad', 'ordered first, unordered after by name');
assert.equal(ids(sortByOrder([it('z', 2, 'Beta'), it('y', 2, 'Alpha'), it('x', 2, 'Alpha')])), 'xyz', 'ties: name, then id');
assert.equal(compareOrder(it('a', 1), it('a', 1)), 0);
assert.equal(ids(sortByOrder([it('p', '9'), it('q', 1)])), 'qp', 'a string order is not an order');

// ---- one field for one move ----
let L = [it('a', 1), it('b', 2), it('c', 3), it('d', 4)];
let p = planMove(L, 'd', 'a');
assert.deepEqual(p, { sets: [{ id: 'd', order: 1.5 }], renumbered: false, to: 1 }, 'between a and b: ONE field on ONE item');
assert.equal(ids(sortByOrder(apply(L, p))), 'adbc');
p = planMove(L, 'a', 'd');
assert.deepEqual(p.sets, [{ id: 'a', order: 5 }], 'to the end: last + 1'); assert.equal(p.renumbered, false);
p = planMove(L, 'd', null);
assert.deepEqual(p.sets, [{ id: 'd', order: 0 }], 'to the top: first - 1'); assert.equal(ids(sortByOrder(apply(L, p))), 'dabc');
p = planMove(L, 'b', 'b'); assert.deepEqual(p.sets, [], 'after itself: nothing');
p = planMove(L, 'b', 'a'); assert.deepEqual(p.sets, [], 'to where it is: nothing to write');
p = planMove(L, 'b', 'zzz'); assert.deepEqual(p.sets, [{ id: 'b', order: 5 }], 'an unknown anchor means the end');
assert.deepEqual(planMove(L, 'nope', null), { sets: [], renumbered: false, to: -1 });

// repeated moves into the same gap halve it each time, one field each, until there is no room
let M = [it('a', 1), it('b', 2), it('x', 10)];
let renumbers = 0, writes = 0;
for (let k = 0; k < 60; k++) {
  const plan = planMove(M, 'x', 'a');           // always right after a, before whatever is next
  M = apply(M, plan); writes += plan.sets.length;
  if (plan.renumbered) renumbers++;
  // and put it back at the end, so the gap after a keeps being halved by b…
  M = apply(M, planMove(M, 'b', 'x'));
  M = apply(M, planMove(M, 'b', 'a'));
}
assert.ok(renumbers >= 1, 'a gap halved enough times gets renumbered: ' + renumbers);
assert.ok(M.every(x => hasOrder(x)), 'every number stays a plain number inside the rules’ limit');
assert.equal(new Set(M.map(x => x.order)).size, M.length, 'all distinct after the run');

// ---- no room: the same number, or too close ----
L = [it('a', 1), it('b', 1), it('c', 2)];
p = planMove(L, 'c', 'a');   // sorted a, b, c (tie by name); put c after a: neighbours a(1) and b(1) have no room
assert.equal(p.renumbered, true, 'equal neighbours: renumber the group');
assert.equal(ids(sortByOrder(apply(L, p))), 'acb', 'in the order wanted');
assert.deepEqual(sortByOrder(apply(L, p)).map(x => x.order), [1, 2, 3], '1, 2, 3');
L = [it('a', 1), it('b', 1 + MIN_GAP / 10), it('c', 5)];
p = planMove(L, 'c', 'a'); assert.equal(p.renumbered, true, 'too close: renumber');
// the numbers get too big: renumber instead of growing to the rules’ limit
L = [it('a', 899999), it('b', 899999.5)];
p = planMove(L, 'a', 'b'); assert.equal(p.renumbered, true, 'near the limit: renumber'); assert.deepEqual(p.sets.map(x => x.order).sort(), [1, 2]);

// ---- items without a number ----
L = [it('a'), it('b'), it('c'), it('d')];   // nothing numbered yet (every item at first): sorted by name
p = planMove(L, 'd', 'a');
assert.equal(p.renumbered, true, 'first reorder in a group: everything gets a number once');
assert.equal(ids(sortByOrder(apply(L, p))), 'adbc'); assert.deepEqual(sortByOrder(apply(L, p)).map(x => x.order), [1, 2, 3, 4]);
p = planMove(L, 'a', 'd'); assert.equal(ids(sortByOrder(apply(L, p))), 'bcda');
p = planMove(L, 'c', null); assert.equal(ids(sortByOrder(apply(L, p))), 'cabd');
// ordered ones with new, unnumbered items after them
L = [it('a', 1), it('b', 2), it('n1'), it('n2')];
assert.equal(ids(sortByOrder(L)), 'abn1n2'.replace('n1', 'n1'), 'new items land at the bottom');
p = planMove(L, 'n2', 'b'); assert.deepEqual(p.sets, [{ id: 'n2', order: 3 }], 'right after the last ordered one: one field'); assert.equal(ids(sortByOrder(apply(L, p))), 'abn2n1'.replace('n2n1', 'n2n1'));
p = planMove(L, 'a', 'n1'); assert.equal(p.renumbered, true, 'after an unnumbered item: all numbered'); assert.equal(ids(sortByOrder(apply(L, p))), 'bn1an2');
p = planMove(L, 'a', null); assert.deepEqual(p.sets, [], 'already first');
p = planMove(L, 'b', null); assert.deepEqual(p.sets, [{ id: 'b', order: 0 }]);
assert.equal(renumber([{ id: 'a', order: 1 }, { id: 'b', order: 5 }, { id: 'c' }]).map(x => x.id).join(''), 'bc', 'renumber lists only what changes');
assert.deepEqual(renumber([{ id: 'a', order: 1 }, { id: 'b', order: 2 }]), []);

// ---- every plan keeps every other item where it was (the sequence is the plan's, nothing else moves) ----
for (let seed = 1; seed <= 200; seed++) {
  let r = seed * 7919; const rnd = n => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r % n; };
  let G = Array.from({ length: 2 + rnd(7) }, (_, i) => (rnd(3) ? it('i' + i, rnd(4) + (rnd(2) ? 0.5 : 0)) : it('i' + i, undefined, 'N' + rnd(5))));
  for (let step = 0; step < 12; step++) {
    const id = G[rnd(G.length)].id, sorted = sortByOrder(G), rest = sorted.filter(x => x.id !== id);
    const after = rnd(rest.length + 1) === 0 ? null : rest[rnd(rest.length)].id;
    const plan = planMove(G, id, after);
    const want = (() => { const i = after == null ? 0 : rest.findIndex(x => x.id === after) + 1; return [...rest.slice(0, i), sorted.find(x => x.id === id), ...rest.slice(i)].map(x => x.id).join(''); })();
    G = apply(G, plan);
    const got = ids(sortByOrder(G));
    assert.equal(got, want, `seed ${seed} step ${step}: ${got} should be ${want}`);
    assert.ok(plan.sets.length <= 1 || plan.renumbered, 'many writes only when renumbering');
    assert.ok(G.every(x => !hasOrder(x) || Math.abs(x.order) < ORDER_LIMIT));
    if (plan.renumbered) assert.equal(new Set(G.map(x => x.order)).size, G.length, 'distinct after a renumber');
  }
}

// ---- position and steps (Move up / Move down) ----
L = [it('a', 1), it('b', 2), it('c', 3)];
assert.deepEqual(positionOf(L, 'b'), { index: 1, count: 3 });
assert.equal(stepTarget(L, 'b', -1), null, 'up from second: to the top');
assert.equal(stepTarget(L, 'b', 1), 'c', 'down from second: after c');
assert.equal(stepTarget(L, 'a', -1), undefined, 'already first'); assert.equal(stepTarget(L, 'c', 1), undefined, 'already last');
assert.equal(stepTarget(L, 'c', -1), 'a'); assert.equal(stepTarget(L, 'a', 1), 'b');
p = planMove(L, 'a', stepTarget(L, 'a', 1)); assert.equal(ids(sortByOrder(apply(L, p))), 'bac');
console.log('pantry order: ok');
