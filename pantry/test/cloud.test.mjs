// How a change becomes Firestore field updates (js/cloud.js updatePairs / updateArgs / nest), with a stand-in for the SDK:
// node pantry/test/cloud.test.mjs
import assert from 'node:assert/strict';
import { updatePairs, updateArgs, nest } from '../js/cloud.js';
import * as L from '../js/logic.js';
import * as PP from '../js/people.js';

class FieldPath { constructor(...segments) { this.segments = segments; } }
const F = { FieldPath, increment: n => ({ inc: n }), deleteField: () => ({ del: true }) };
const segs = args => args.filter((_, i) => i % 2 === 0).map(p => p.segments);

// an item's change: dotted paths become field paths; a set, an increment, a removal
const ops = { set: { location: 'Pantry', 'batches.a.expiry': '2027-01-01' }, inc: { 'batches.b.qty': -1 }, del: ['batches.c'] };
const args = updateArgs(F, null, ops);
assert.ok(args.filter((_, i) => i % 2 === 0).every(p => p instanceof FieldPath), 'every field is a FieldPath, never a dotted string');
assert.deepEqual(segs(args), [['location'], ['batches', 'a', 'expiry'], ['batches', 'b', 'qty'], ['batches', 'c']]);
assert.deepEqual(args.filter((_, i) => i % 2 === 1), ['Pantry', '2027-01-01', { inc: -1 }, { del: true }]);

// a name: ONE field, names + the whole email (its dots are not a path); clearing is deleteField on that field
const set = updateArgs(F, null, PP.nameOps('dad.smith@example.com', 'Dad', { at: 'T' }));
assert.deepEqual(segs(set), [['updatedAt'], ['names', 'dad.smith@example.com']], 'the email stays one segment');
assert.deepEqual(set.filter((_, i) => i % 2 === 1), ['T', 'Dad']);
const clear = updateArgs(F, null, PP.nameOps('dad.smith@example.com', '', { at: 'T' }));
assert.deepEqual(segs(clear), [['updatedAt'], ['names', 'dad.smith@example.com']]);
assert.deepEqual(clear[3], { del: true });
// several keyed changes at once (a name and the names of people who left)
const many = updatePairs(F, null, PP.nameOps('a@b.c', 'A', { at: 'T', orphans: ['gone.one@b.c'] }));
assert.deepEqual(many.map(([p]) => p), [['updatedAt'], ['names', 'a@b.c'], ['names', 'gone.one@b.c']]);

// a document this phone doesn't have yet is made by a merge of nested maps (the email is a key, not split)
assert.deepEqual(nest(updatePairs(F, null, L.mergeOps(PP.nameOps('a.b@c.d', 'Ann', { at: 'T' }), { set: { id: 'people' } }))), { id: 'people', updatedAt: 'T', names: { 'a.b@c.d': 'Ann' } });
assert.deepEqual(nest(updatePairs(F, null, { set: { 'batches.x.qty': 1, location: 'A' }, inc: {}, del: [] })), { batches: { x: { qty: 1 } }, location: 'A' });
assert.deepEqual(nest(updatePairs(F, null, PP.nameOps('a@b.c', '', { at: 'T' }))).names['a@b.c'], { del: true });

// a place: its fields
assert.deepEqual(segs(updateArgs(F, null, { set: { name: 'Big fridge', order: 1.5, updatedAt: 'T' }, inc: {}, del: [] })), [['name'], ['order'], ['updatedAt']]);
assert.deepEqual(segs(updateArgs(F, null, L.restoreOps())), [['removedAt'], ['removedBy']]);

// an old-style array item is still converted by one write (batches as a map), the rest as usual
const arr = L.normalizeItem({ id: 'o', name: 'Old', batches: [{ id: 'x1', qty: 2 }] });
const conv = updatePairs(F, arr, { set: { name: 'New' }, inc: { 'batches.x1.qty': -1 }, del: [] });
assert.deepEqual(conv.map(([p]) => p), [['batches'], ['name']]);
assert.deepEqual(conv[0][1], { x1: { qty: 1 } });

// overlapping paths are refused before anything is sent
assert.throws(() => updatePairs(F, null, { set: { a: 1 }, inc: { 'a.b': 1 }, del: [] }), /overlap/);
assert.throws(() => updatePairs(F, null, L.mergeOps(PP.nameOps('a@b.c', 'A'), { set: { names: {} } })), /overlap/);
// Firestore 10.14.1 crashes on enableNetwork while the network is already enabled, so every enableNetwork in js/ must follow
// a disableNetwork in the same block (the restarts in cloud.js do disable, wait, enable).
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../js/', import.meta.url);
  let seen = 0;
  for (const f of readdirSync(dir).filter(n => n.endsWith('.js'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/enableNetwork\(/g)) {
      seen++;
      let depth = 0, start = 0;
      for (let i = m.index - 1; i >= 0; i--) {   // back to the `{` that opens the enclosing block
        if (src[i] === '}') depth++;
        else if (src[i] === '{') { if (depth === 0) { start = i; break; } depth--; }
      }
      assert.match(src.slice(start, m.index), /disableNetwork\(/, `${f}: enableNetwork at offset ${m.index} has no disableNetwork before it in its block`);
    }
  }
  assert.ok(seen >= 2, 'the check found the enableNetwork calls in js/ (cloud.js has two restarts)');
}
console.log('pantry cloud ops: ok');
