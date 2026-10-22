// Names for the family (js/people.js): plain node.
import assert from 'node:assert/strict';
import * as PP from '../js/people.js';
import * as L from '../js/logic.js';

assert.equal(PP.cleanName('  Ah   Mei\n '), 'Ah Mei');
assert.equal(PP.cleanName('x'.repeat(50)).length, PP.NAME_MAX);
assert.deepEqual(PP.namesOf(null), {});
assert.deepEqual(PP.namesOf({ names: ['x'] }), {});
assert.deepEqual(PP.namesOf({ names: { 'Mum@Example.com': ' Mum ', 'x@y.z': 3, 'e@f.g': '  ' } }), { 'mum@example.com': 'Mum' });
assert.deepEqual(PP.setName({ 'a@b.c': 'A' }, 'D@E.F', ' Dad '), { 'a@b.c': 'A', 'd@e.f': 'Dad' });
assert.deepEqual(PP.setName({ 'a@b.c': 'A' }, 'a@b.c', ''), {}, 'an empty name removes it');
assert.deepEqual(PP.keepMembers({ 'a@b.c': 'A', 'gone@b.c': 'G' }, ['a@b.c']), { 'a@b.c': 'A' });
const doc = PP.peopleDoc({ 'a@b.c': 'A' }, 'now');
assert.deepEqual(doc, { id: 'people', names: { 'a@b.c': 'A' }, updatedAt: 'now' });
assert.ok(PP.isPeopleDoc(doc) && !PP.isPeopleDoc({ id: 'places', list: [] }) && !PP.isPeopleDoc({ id: 'people', names: [] }));
// how someone shows: the family's name for an email, else what was saved (older changes are signed with a name)
assert.equal(PP.label({ 'a@b.c': 'Mum' }, 'A@B.C'), 'Mum');
assert.equal(PP.label({ 'a@b.c': 'Mum' }, 'Dad'), 'Dad');
assert.equal(PP.label({}, ''), '');
// one person's name as an instruction: a keyed field (the email's dots are never a path), not the whole map
const nop = PP.nameOps('Dad.Smith@Example.COM', '  Dad  ', { at: 'T' });
assert.deepEqual(nop, { set: { updatedAt: 'T' }, inc: {}, del: [], keyed: { names: { set: { 'dad.smith@example.com': 'Dad' }, del: [] } } });
assert.deepEqual(PP.nameOps('a@b.c', '  ', { at: 'T' }).keyed.names, { set: {}, del: ['a@b.c'] }, 'an empty name clears that one field');
assert.deepEqual(PP.nameOps('a@b.c', 'A', { at: 'T', orphans: ['gone@b.c', 'A@b.c'] }).keyed.names, { set: { 'a@b.c': 'A' }, del: ['gone@b.c'] }, 'names of people who left can go in the same write; never this one');
assert.ok(L.opsValid(nop) && !L.opsEmpty(nop));
// the instruction does the same to the names map on every backend (applyFieldOps), keeping everyone else's names
const pdoc = PP.peopleDoc({ 'mum@example.com': 'Mum', 'x.y@example.com': 'Ex' }, 'old');
let res = L.applyFieldOps(pdoc, PP.nameOps('dad@example.com', 'Dad', { at: 'new' }));
assert.deepEqual(res.names, { 'mum@example.com': 'Mum', 'x.y@example.com': 'Ex', 'dad@example.com': 'Dad' }); assert.equal(res.updatedAt, 'new'); assert.equal(pdoc.names['dad@example.com'], undefined, 'never changes the one given');
res = L.applyFieldOps(res, PP.nameOps('x.y@example.com', '', { at: 'newer' }));
assert.deepEqual(res.names, { 'mum@example.com': 'Mum', 'dad@example.com': 'Dad' }, 'a dotted email is cleared as one key');
assert.deepEqual(L.applyFieldOps({ id: 'people' }, PP.nameOps('a@b.c', 'A', { at: 'T' })), { id: 'people', updatedAt: 'T', names: { 'a@b.c': 'A' } }, 'a document with no names yet');
// two phones' instructions on one document, in either order, keep both people's names; and one naming while another removes someone
const a = PP.nameOps('a@b.c', 'Ann', { at: '1' }), b = PP.nameOps('b@b.c', 'Bob', { at: '2' });
assert.deepEqual(L.applyFieldOps(L.applyFieldOps(pdoc, a), b).names, L.applyFieldOps(L.applyFieldOps(pdoc, b), a).names);
assert.deepEqual(Object.keys(L.applyFieldOps(L.applyFieldOps(pdoc, a), b).names).sort(), ['a@b.c', 'b@b.c', 'mum@example.com', 'x.y@example.com']);
const gone = L.applyFieldOps(L.applyFieldOps(pdoc, PP.nameOps('x.y@example.com', '', { at: '3' })), a);
assert.deepEqual(gone.names, { 'mum@example.com': 'Mum', 'a@b.c': 'Ann' }, 'a removed member’s name is gone, the others kept');
// merging instructions: keyed fields combine
const mo = L.mergeOps(a, b, { set: { id: 'people' } });
assert.deepEqual(mo.keyed.names.set, { 'a@b.c': 'Ann', 'b@b.c': 'Bob' }); assert.equal(mo.set.id, 'people');
assert.ok(L.opsValid(mo) && !L.opsValid(L.mergeOps(a, { set: { 'names.x': 1 }, inc: {}, del: [] })), 'a path into the same map is an overlap');
assert.ok(!L.opsValid({ set: {}, inc: {}, del: [], keyed: { names: { set: { 'a@b.c': 'x' }, del: ['a@b.c'] } } }), 'set and clear of one key at once');
assert.ok(L.opsEmpty({ set: {}, inc: {}, del: [], keyed: { names: { set: {}, del: [] } } }) && L.opsEmpty(L.mergeOps(null)));
// room for one more name: the names of people who left make way, only when the 20 are full
const full = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}@x.com`, 'n']));
assert.deepEqual(PP.orphanNames(full, ['p0@x.com'], 'new@x.com').length, 19);
assert.deepEqual(PP.orphanNames({ 'a@b.c': 'A' }, [], 'new@x.com'), [], 'room: nothing dropped');
assert.deepEqual(PP.orphanNames(full, [], 'p3@x.com'), [], 'renaming someone who has a name needs no room');
console.log('people tests: ok');
