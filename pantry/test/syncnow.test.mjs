// Sync now's pure parts (js/sync.js): what the sync button's tap says, and the button's state and count.
import assert from 'node:assert/strict';
import { syncNowResult, syncState } from '../js/sync.js';

// what Sync now says
assert.deepEqual(syncNowResult({ ok: true }), { kind: 'saved', text: 'Everything is saved' });
assert.equal(syncNowResult({ ok: false, cycled: false }, { pending: 1 }).kind, 'waiting');
assert.match(syncNowResult({ ok: false, cycled: false }, { pending: 1 }).text, /^Still waiting: this phone can’t reach the family right now\. The change is kept on this phone/);
assert.equal(syncNowResult({ ok: false, cycled: false }).offer, true, 'the first try offers a reconnect');
assert.equal(syncNowResult({ ok: false, cycled: true }).offer, false, 'the second does not');
assert.match(syncNowResult({ ok: true }, { refused: 2 }).text, /^Needs attention: the family pantry wouldn’t take 2 changes/);
assert.equal(syncNowResult({ ok: true }, { refused: 1 }).kind, 'attention', 'a refused change is never "Everything is saved"');

// the button: unchanged rules (pending counts only what the server hasn't acknowledged: cloud.js)
assert.equal(syncState({ pending: 2, waited: 3000 }).text, 'Waiting for signal (2 changes)');
assert.equal(syncState({ pending: 2, waited: 100 }).kind, 'saved', 'a normal save confirms in well under 1.5 s');
// the kit's states and counts (syncButton): offline and at-risk carry what waits; a save on its way lifts the arrow
const st = o => { const v = syncState(o); return [v.state, v.count]; };
assert.deepEqual(st({}), ['synced', 0]);
assert.deepEqual(st({ pending: 2, waited: 100 }), ['pending', 2]);
assert.deepEqual(st({ pending: 2, waited: 3000 }), ['offline', 2]);
assert.deepEqual(st({ pending: 1, offline: true, persisted: false }), ['at-risk', 1]);
assert.deepEqual(st({ refused: 3, pending: 1 }), ['attention', 3]);
assert.deepEqual(st({ confirmed: false }), ['unknown', 0]);
assert.deepEqual(st({ stale: true }), ['unknown', 0]);
console.log('pantry sync now: ok');
