// Merging duplicate family pantries (js/merge.js): plain node.
import assert from 'node:assert/strict';
import { unionMembers, plan, mergeSettings, legacyPlaces, carryOver, MAX_MEMBERS } from '../js/merge.js';
import { mergeInto } from '../js/places.js';
import { peopleDoc, namesOf } from '../js/people.js';

// members: kept first, no repeats, any case
assert.deepEqual(unionMembers(['a@x.com', 'b@x.com'], [['B@x.com', 'c@x.com'], ['c@x.com', ' d@x.com ']]).members, ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
const many = n => Array.from({ length: n }, (_, i) => `p${i}@x.com`);
assert.equal(unionMembers(many(15), [many(25).slice(10)]).over, true, '25 people in all');
assert.equal(unionMembers(many(20), [many(20)]).over, false, 'the same 20 people');
assert.equal(unionMembers(many(12), [many(25).slice(12)]).members.length, MAX_MEMBERS);

// who may merge: only the owner of every pantry being deleted
const H = (id, owner, members) => ({ id, owner, members });
const mine = H('a', 'me@x.com', ['me@x.com']), big = H('b', 'me@x.com', ['me@x.com', 'x@x.com', 'y@x.com']), theirs = H('c', 'mum@x.com', ['mum@x.com', 'me@x.com']);
let p = plan([mine, big], 'b', 'ME@x.com');
assert.ok(p.canMerge && p.others.length === 1 && p.keep.id === 'b' && p.members.length === 3);
p = plan([mine, theirs], 'a', 'me@x.com');
assert.ok(!p.canMerge && p.notMine[0].id === 'c', 'can’t delete someone else’s pantry');
p = plan([mine, theirs], 'c', 'me@x.com');
assert.ok(p.canMerge, 'keeping theirs and deleting mine is fine');
assert.ok(!plan([mine], 'a', 'me@x.com').canMerge, 'nothing to merge');
assert.ok(!plan([H('a', 'me@x.com', many(15).concat('me@x.com')), H('b', 'me@x.com', many(30).slice(15).concat('me@x.com'))], 'a', 'me@x.com').canMerge, 'over 20 people');

// settings: names joined (kept wins), only what changes (places are documents now: below)
const keepDocs = [peopleDoc({ 'a@x.com': 'Mum' })];
const otherDocs = [peopleDoc({ 'a@x.com': 'Old', 'b@x.com': 'Dad', 'gone@x.com': 'Gone' })];
const out = mergeSettings(keepDocs, otherDocs, ['a@x.com', 'b@x.com']);
assert.deepEqual(out.map(d => d.id), ['people']);
assert.deepEqual(namesOf(out[0]), { 'a@x.com': 'Mum', 'b@x.com': 'Dad' });
assert.deepEqual(mergeSettings(keepDocs, [peopleDoc({ 'a@x.com': 'Other' })], ['a@x.com']), [], 'nothing new, nothing written');
assert.deepEqual(mergeSettings([], otherDocs, ['b@x.com']).map(d => d.id), ['people'], 'the kept pantry had none');
assert.deepEqual(mergeSettings(keepDocs, [], ['a@x.com']), []);
assert.deepEqual(mergeSettings([{ id: 'places', list: ['Fridge'], updatedAt: 'x' }], [{ id: 'places', list: ['Shed'], updatedAt: 'x' }], []), [], 'the old single list is not a setting to merge any more');

// places: one document each; the other pantry's merged by name into the kept one's, theirs after; old lists count too
const D = (id, name, order, extra = {}) => ({ id, name, order, updatedAt: 'x', ...extra });
const old = list => ({ id: 'places', list, updatedAt: 'x' });
assert.equal(legacyPlaces([peopleDoc({}), old(['Fridge'])]).list[0], 'Fridge'); assert.equal(legacyPlaces([peopleDoc({})]), null);
const docsA = mergeInto({ docs: [D('a', 'Fridge', 1), D('b', 'Pantry', 2)], legacy: null }, { docs: [D('c', 'Pantry', 1), D('d', 'Garage', 2)], legacy: null }, 'T');
assert.deepEqual(docsA.map(d => [d.name, d.order]), [['Garage', 3]], 'kept first, only the new name written');
const docsB = mergeInto({ docs: [], legacy: old(['Fridge', 'Pantry']) }, { docs: [], legacy: old(['Pantry', 'Garage']) }, 'T');
assert.deepEqual(docsB.map(d => d.name), ['Fridge', 'Pantry', 'Garage'], 'both only had the old list: the kept one’s become documents, then Garage');
assert.equal(mergeInto({ docs: [], legacy: old(['Fridge', 'Pantry']) }, { docs: [], legacy: old(['Pantry', 'Garage']) }, 'T')[0].id, docsB[0].id, 'ids are the same every time, so running the merge again writes the same documents');
// a place removed more than 30 days ago isn't carried; a recent removal is (with its marker)
const ago = d => new Date(Date.now() - d * 86400000).toISOString();
const lists = carryOver({ items: [], shop: [], events: [], photos: [], places: [D('o', 'Old', 1, { removedAt: ago(40) }), D('n', 'New', 2, { removedAt: ago(5), removedBy: 'Dad' }), D('l', 'Live', 3)] });
assert.deepEqual(lists.places.map(p => p.id), ['n', 'l']);
console.log('merge: ok');
