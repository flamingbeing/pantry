// The chip's use of "the server was heard a moment ago", of the watchdog's "stale" and of storage at risk (js/sync.js).
import assert from 'node:assert/strict';
import { syncState } from '../js/sync.js';

// (the watchdog's decision itself is app-sync's watchdog.js now, tested there)
assert.equal(syncState({ pending: 1, cache: true, waited: 100 }).kind, 'waiting', 'unsent, and showing its own copy: waiting');
assert.equal(syncState({ pending: 1, cache: true, waited: 100, recent: true }).kind, 'saved', 'a server snapshot just arrived: not a lost connection');
assert.equal(syncState({ pending: 1, cache: true, waited: 2000, recent: true }).kind, 'waiting', 'still unconfirmed after 1.5 s: waiting, whatever the listener says');
assert.equal(syncState({ pending: 0, cache: true }).kind, 'saved', 'nothing unsent: never waiting');
assert.equal(syncState({ pending: 1, offline: true, recent: true }).kind, 'waiting');
// B5: the watchdog says the server isn't heard: never "Saved"
assert.deepEqual(syncState({ pending: 0, stale: true }), { kind: 'waiting', text: 'May be out of date' });
assert.equal(syncState({ pending: 0, stale: true, offline: true }).kind, 'saved', 'offline with nothing unsent: nothing to say');
assert.equal(syncState({ pending: 1, stale: true, offline: true }).text, 'Waiting for signal (1 change)');
// B3: changes waiting while the browser may clear the site's storage
assert.deepEqual(syncState({ pending: 2, offline: true, persisted: false, waited: 10 * 60000 }), { kind: 'waiting', text: 'Only on this phone (2 changes)' });
assert.equal(syncState({ pending: 1, offline: true, persisted: false, waited: 5000 }).text, 'Only on this phone (1 change)', 'offline and storage not persistent: at risk at once (app-sync 0.4.0 atRiskOnlyOffline)');
assert.equal(syncState({ pending: 0, persisted: false }).kind, 'saved', 'nothing waiting: nothing at risk');
assert.equal(syncState({ refused: 1, pending: 2, offline: true, persisted: false }).kind, 'attention');
console.log('pantry listen-watch: ok');

// app-sync 0.4.0 syncStatus: `confirmed` (nothing says Saved before the server has answered once) and at-risk only offline
{
  const { syncState, reloadAllowed } = await import('../js/sync.js');
  assert.deepEqual(syncState({ pending: 0, confirmed: false }), { kind: 'waiting', text: 'Not checked with the family yet' }, 'nothing unsent, but the server has not answered: not Saved');
  assert.equal(syncState({ pending: 0, confirmed: true }).kind, 'saved');
  assert.equal(syncState({ pending: 0 }).kind, 'saved', 'confirmed defaults to true');
  assert.equal(syncState({ pending: 0, confirmed: false, offline: true }).kind, 'waiting', 'offline and never heard: still not Saved');
  assert.equal(syncState({ pending: 1, waited: 10, persisted: false }).kind, 'saved', 'online, storage not persistent, changes on their way: not at risk');
  assert.deepEqual(syncState({ pending: 1, offline: true, persisted: false, waited: 10 }), { kind: 'waiting', text: 'Only on this phone (1 change)' }, 'offline and not persistent: at risk at once');
  assert.equal(syncState({ pending: 1, offline: true, persisted: true, waited: 10 }).text, 'Waiting for signal (1 change)');
  assert.equal(syncState({ refused: 1, pending: 0, confirmed: false }).kind, 'attention', 'attention comes first');

  // the page reloads for a new version only when nothing is open and nothing is sending
  assert.equal(reloadAllowed({}), true);
  assert.equal(reloadAllowed({ pending: 1 }), false, 'changes still sending');
  assert.equal(reloadAllowed({ sheet: true }), false, 'a sheet is open');
  assert.equal(reloadAllowed({ draft: true }), false, 'an add or edit form is open');
  assert.equal(reloadAllowed({ typing: true }), false, 'someone is typing');
  assert.equal(reloadAllowed({ dragging: true }), false);
  assert.equal(reloadAllowed({ pending: 0, sheet: false, draft: false }), true);
}
console.log('syncStatus and reload guard: ok');
