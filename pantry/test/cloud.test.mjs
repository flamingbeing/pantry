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
// Firestore 10.14.1 crashed on enableNetwork while the network was already enabled, so every enableNetwork in js/ must follow
// a disableNetwork in the same block (cloud.js's one restart, cycleNet, does disable, wait, enable).
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
  assert.ok(seen >= 1, 'the check found the enableNetwork call in js/ (cloud.js cycleNet)');
}
// app-sync's merge for every kind (mergeSaves): saves applied to the SERVER's copy inside the transaction, as Firestore's
// setDoc (a whole document) and updateDoc (field updates) did
{
  const { applyPairs, mergeSaves } = await import('../js/cloud.js');
  const items = mergeSaves('items'), shop = mergeSaves('shop'), places = mergeSaves('places'), settings = mergeSaves('settings');
  const server = { id: 'i1', name: 'Kaya', batches: { b1: { qty: 2, expiry: '2026-11-01' } }, updatedAt: '2026-10-20T00:00:00.000Z' };
  const use = { set: {}, inc: { 'batches.b1.qty': -1 }, del: [] };
  // two phones each use one from the same copy: the server counts both (never one overwriting the other)
  const once = items(server, null, { id: 'i1' }, [{ patch: use }]);
  const twice = items(once, null, { id: 'i1' }, [{ patch: use }]);
  assert.equal(once.batches.b1.qty, 1); assert.equal(twice.batches.b1.qty, 0);
  assert.equal(twice.batches.b1.expiry, '2026-11-01', 'a spent batch keeps its fields, as an update did');
  // a field set on one phone and another field on the other: both kept
  const a = items(server, null, { id: 'i1' }, [{ patch: { set: { name: 'Kaya jam' }, inc: {}, del: [] } }]);
  const b = items(a, null, { id: 'i1' }, [{ patch: { set: { location: 'Fridge' }, inc: {}, del: [] } }]);
  assert.equal(b.name, 'Kaya jam'); assert.equal(b.location, 'Fridge');
  // a failed save's ops carried into the next one are applied in order
  assert.equal(items(server, null, null, [{ patch: use }, { patch: use }]).batches.b1.qty, 0);
  // an old-style array item is converted from the server's copy (another phone's batch survives)
  const arr = { id: 'i2', name: 'Rice', batches: [{ id: 'x1', qty: 1 }, { id: 'x2', qty: 3 }] };
  const conv = items(arr, null, { id: 'i2' }, [{ patch: { set: {}, inc: { 'batches.x1.qty': 1 }, del: [] } }]);
  assert.deepEqual(conv.batches, { x1: { qty: 2 }, x2: { qty: 3 } });
  // a whole document replaces what is there (setDoc); no copy on the server: the save makes it
  assert.deepEqual(items(server, { id: 'i1', name: 'New', batches: [{ id: 'n1', qty: 1 }], _arr: false }, null, [{ put: true }]).batches, { n1: { qty: 1 } });
  assert.equal(shop(null, { id: 's1', name: 'Milk', done: false }, null, undefined).name, 'Milk');
  // a change by field to a line no phone has seen: made from the fields (a set-with-merge did the same)
  assert.deepEqual(shop(null, { id: 's2' }, null, [{ patch: { set: { name: 'Eggs', done: false }, inc: {}, del: [] } }]), { id: 's2', name: 'Eggs', done: false });
  // a keyed change (a person's name: the email's dots never split the path)
  const people = settings({ id: 'people', names: { 'dad@x.com': 'Dad' } }, null, { id: 'people' }, [{ patch: { set: {}, inc: {}, del: [], keyed: { names: { set: { 'mum@x.com': 'Mum' } } } } }]);
  assert.deepEqual(people.names, { 'dad@x.com': 'Dad', 'mum@x.com': 'Mum' });
  // a place made from the old list never overwrites one that is there (renamed meanwhile); made when it isn't
  const renamed = { id: 'p1', name: 'Big fridge', order: 1, updatedAt: '2026-10-21T00:00:00.000Z' };
  assert.deepEqual(places(renamed, { id: 'p1', name: 'Fridge', order: 1, updatedAt: '1970-01-01T00:00:00.000Z' }, null, [{ put: true }]), renamed);
  assert.equal(places(null, { id: 'p1', name: 'Fridge', order: 1, updatedAt: '1970-01-01T00:00:00.000Z' }, null, [{ put: true }]).name, 'Fridge');
  // a whole document made on a known copy (base: the HELD kinds) keeps what changed elsewhere meanwhile and this phone left
  // as it was: a removal, another field, another batch (an answered held conflict is saved this way, on the copy it met)
  const was = { id: 'p2', name: 'Shed', order: 2 };
  const gone = { ...was, removedAt: '2026-10-25T01:00:00.000Z', removedBy: 'Mum', name: 'Garden shed' };
  assert.deepEqual(places(gone, { ...was, order: 1 }, was, [{ put: true }]), { ...gone, order: 1 }, 'removed and renamed there, moved here: all three');
  assert.deepEqual(places(gone, { ...was, name: 'Store' }, was, [{ put: true }]).name, 'Store', 'the same field changed on both: this phone\'s (app-sync holds it)');
  const two = items({ ...server, batches: { b1: { qty: 2 }, b2: { qty: 5 } } }, { id: 'i1', name: 'Kaya', batches: [{ id: 'b1', qty: 1 }] }, { id: 'i1', name: 'Kaya', batches: { b1: { qty: 2 } } }, [{ put: true }]);
  assert.deepEqual(two.batches, { b1: { qty: 1 }, b2: { qty: 5 } }, 'a batch added elsewhere stays');
  assert.equal('removedAt' in places({ ...was, removedAt: 'x' }, was, { ...was, removedAt: 'x' }, [{ put: true }]), false, 'put back here (removedAt gone): gone');
  // a save's stamp moving on from the server's is app-sync's own rule now (0.4.0: the adapter's default stamp, taken inside
  // the commit transaction; sync-stamps.spec.mjs runs it against the emulator): the app keeps no stamp function of its own,
  // and no retry of `aborted` (the write queue treats it as transient)
  const cloudSrc = (await import('node:fs')).readFileSync(new URL('../js/cloud.js', import.meta.url), 'utf8');
  assert.equal((await import('../js/cloud.js')).stampAfter, undefined, 'stampAfter is gone');
  assert.ok(!/\bstamp:\s*doc\s*=>/.test(cloudSrc) && !/stampAfter/.test(cloudSrc), 'the adapter gets no stamp function of its own');
  assert.ok(!/code\s*===\s*'aborted'/.test(cloudSrc), 'no retry of aborted: the queue does it');
  assert.ok(/const SYNC = 'https:\/\/core\.anawj\.com\/sync\/0\.7\.3\/index\.js'/.test(cloudSrc), 'app-sync 0.7.3, exact pin');
  assert.equal(items(server, { id: 'i1', name: 'N', batches: [] }, null, [{ put: true }]).updatedAt, server.updatedAt, 'a whole document keeps the server stamp');
  // held conflicts (app-sync 0.7.1): who and when, changed on both sides since base, keep the server's value (so the clash
  // check, which holds only where the merge takes this phone's value over another's, never asks about them); the change
  // itself still lands, and with no change elsewhere (or no base) this phone's name is written as before
  {
    const base = { id: 'i1', name: 'Rice', batches: { b1: { qty: 3 } }, updatedBy: 'Mum' };
    const server = { ...base, batches: { b1: { qty: 2 } }, updatedBy: 'Dad', updatedAt: '2026-10-25T08:00:00.000Z' };
    const use = [{ patch: { set: { updatedBy: 'Me' }, inc: { 'batches.b1.qty': -1 }, del: [] } }];
    const both = items(server, { id: 'i1' }, base, use);
    assert.equal(both.updatedBy, 'Dad', 'updatedBy changed on both sides: the server\'s stays');
    assert.equal(both.batches.b1.qty, 1, 'both uses count');
    assert.equal(items(base, { id: 'i1' }, base, use).updatedBy, 'Me', 'nothing changed elsewhere: this phone\'s name');
    assert.equal(items(server, { id: 'i1' }, null, use).updatedBy, 'Me', 'no base (not held): as before');
    const lineBase = { id: 'l1', name: 'Milk', done: false };
    const lineServer = { ...lineBase, done: true, doneBy: 'Dad', removedAt: '2026-10-25T08:00:00.000Z', removedBy: 'Dad' };
    const tick = [{ patch: { set: { done: true, doneBy: 'Me' }, inc: {}, del: [] } }];
    assert.deepEqual([shop(lineServer, { id: 'l1' }, lineBase, tick).doneBy, shop(lineServer, { id: 'l1' }, lineBase, tick).done], ['Dad', true], 'both ticked: no clash about who');
    const rm = [{ patch: L.removeOps('Me', '2026-10-25T09:00:00.000Z') }];
    const removedTwice = shop(lineServer, { id: 'l1' }, lineBase, rm);
    assert.deepEqual([removedTwice.removedAt, removedTwice.removedBy], [lineServer.removedAt, 'Dad'], 'removed on both phones: the first removal stays');
    const restored = { ...lineBase, done: false };   // put back elsewhere while this phone removed it: a real clash, left to the check
    assert.equal(shop(restored, { id: 'l1' }, { ...lineBase, removedAt: 'x', removedBy: 'Dad' }, rm).removedAt, '2026-10-25T09:00:00.000Z');
  }
  // this phone's name in the popup, from the browser
  const { deviceName, HELD } = await import('../js/cloud.js');
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'iPhone');
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari'), 'Android phone');
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Windows computer');
  assert.equal(deviceName(''), 'Computer');
  assert.deepEqual(HELD, ['items', 'shop', 'places'], 'history, photos and settings stay as they were');
  assert.match(cloudSrc, /held: Object\.fromEntries\(HELD\.map\(k => \[k, true\]\)\), edits: '_edits'/, 'held kinds named, with _edits');
  // field updates as the server does them
  assert.deepEqual(applyPairs({ a: { b: 1 }, n: 'x' }, [[['a', 'b'], { __inc: 2 }], [['n'], { __inc: 1 }], [['a', 'c'], { __del: true }]]), { a: { b: 3 }, n: 1 });
}
console.log('pantry cloud ops: ok');
