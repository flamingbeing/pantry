// Sync now's pure parts (js/sync.js): each waiting change in words, "Last heard from the family", and what Sync now says.
import assert from 'node:assert/strict';
import { describeWaiting, heardText, syncNowResult, syncState } from '../js/sync.js';

const ctx = { itemName: id => ({ i1: 'Rice' }[id] || ''), lineName: id => ({ l1: 'Milk' }[id] || ''), placeName: id => ({ p1: 'Garage' }[id] || ''), personName: e => ({ 'jun@example.com': 'Jun' }[e] || e) };
const ops = (o = {}) => ({ set: {}, inc: {}, del: [], ...o });
const d = (kind, id, op, o) => describeWaiting({ kind, id, op, ...(o ? { ops: o } : {}) }, ctx);

assert.equal(d('items', 'i1', 'patch', ops({ inc: { 'batches.b1.qty': -1 }, set: { updatedAt: 'x' } })), 'Used one Rice');
assert.equal(d('items', 'i1', 'patch', ops({ inc: { 'batches.b1.qty': -3 } })), 'Used 3 Rice');
assert.equal(d('items', 'i1', 'patch', ops({ inc: { 'batches.b1.qty': 2 } })), 'Added 2 Rice');
assert.equal(d('items', 'i1', 'patch', ops({ inc: { 'batches.b1.qty': -1, 'batches.b2.qty': 1 } })), 'A change to Rice', 'opening one: nothing taken out in all');
assert.equal(d('items', 'i1', 'patch', ops({ set: { removedAt: '2026-10-16T00:00:00.000Z', removedBy: 'Mum' } })), 'Removed Rice');
assert.equal(d('items', 'i1', 'patch', ops({ del: ['removedAt', 'removedBy'] })), 'Put back Rice');
assert.equal(d('items', 'i1', 'patch', ops({ set: { level: 'low' } })), 'Rice: marked low');
assert.equal(d('items', 'i1', 'patch', ops({ set: { location: 'Garage' } })), 'Moved Rice to Garage');
assert.equal(d('items', 'i1', 'patch', ops({ set: { order: 2.5, updatedAt: 'x' } })), 'Moved Rice in the list');
assert.equal(d('items', 'i1', 'patch', ops({ set: { notes: 'x' } })), 'A change to Rice');
assert.equal(d('items', 'gone', 'patch', ops({ set: { notes: 'x' } })), 'A change to an item');
assert.equal(describeWaiting({ kind: 'items', id: 'n', op: 'put', name: 'Oats' }, ctx), 'Added Oats');
assert.match(d('items', 'i1', 'before'), /^A change to Rice \(saved before the app was closed\)/);
assert.equal(d('shop', 'l1', 'patch', ops({ set: { done: true } })), 'Ticked: Milk');
assert.equal(d('shop', 'l1', 'patch', ops({ set: { done: false } })), 'Unticked: Milk');
assert.equal(d('shop', 'l1', 'patch', ops({ set: { removedAt: 'x' } })), 'Removed from the list: Milk');
assert.equal(describeWaiting({ kind: 'shop', id: 'l9', op: 'put', name: 'Eggs' }, ctx), 'Added to the list: Eggs');
assert.equal(describeWaiting({ kind: 'places', id: 'n', op: 'put', name: 'Shed' }, ctx), 'Added place Shed');
assert.equal(d('places', 'p1', 'patch', ops({ set: { name: 'Carport' } })), 'Renamed place to Carport');
assert.equal(d('places', 'p1', 'patch', ops({ set: { order: 1.5 } })), 'Moved place Garage');
assert.equal(d('places', 'p1', 'patch', ops({ set: { removedAt: 'x' } })), 'Removed place Garage');
assert.equal(d('settings', 'people', 'patch', { ...ops(), keyed: { names: { set: { 'jun@example.com': 'Jun' }, del: [] } } }), 'Name for Jun');
assert.equal(d('settings', 'people', 'patch', { ...ops(), keyed: { names: { set: {}, del: ['kid@example.com'] } } }), 'Name for kid@example.com');
assert.equal(d('settings', 'people', 'before'), 'A change to the family’s settings');
assert.equal(describeWaiting({ kind: 'other', id: 'x' }), 'A change');

// last heard
const T = new Date(2026, 9, 16, 15, 42).getTime();
assert.equal(heardText(0), 'Not yet since the app opened');
assert.equal(heardText(T, T + 30000), 'just now');
assert.equal(heardText(T, T + 3 * 3600000), 'at 3:42 pm');
assert.equal(heardText(T, T + 2 * 86400000), '16 Oct, 3:42 pm');

// what Sync now says
assert.deepEqual(syncNowResult({ ok: true }), { kind: 'saved', text: 'Everything is saved' });
assert.equal(syncNowResult({ ok: false, cycled: false }, { pending: 1 }).kind, 'waiting');
assert.match(syncNowResult({ ok: false, cycled: false }, { pending: 1 }).text, /^Still waiting: this phone can’t reach the family right now\. The change is kept on this phone/);
assert.equal(syncNowResult({ ok: false, cycled: false }).offer, true, 'the first try offers a reconnect');
assert.equal(syncNowResult({ ok: false, cycled: true }).offer, false, 'the second does not');
assert.match(syncNowResult({ ok: true }, { refused: 2 }).text, /^Needs attention: the family pantry wouldn’t take 2 changes/);
assert.equal(syncNowResult({ ok: true }, { refused: 1 }).kind, 'attention', 'a refused change is never "Everything is saved"');

// the chip: unchanged rules (pending counts only what the server hasn't acknowledged: cloud.js)
assert.equal(syncState({ pending: 2, waited: 3000 }).text, 'Waiting for signal (2 changes)');
assert.equal(syncState({ pending: 2, waited: 100 }).kind, 'saved', 'a normal save confirms in well under 1.5 s');
console.log('pantry sync now: ok');
