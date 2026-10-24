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
assert.deepEqual(syncState({ pending: 2, offline: true, persisted: false }), { kind: 'waiting', text: 'Only on this phone (2 changes)' });
assert.equal(syncState({ pending: 0, persisted: false }).kind, 'saved', 'nothing waiting: nothing at risk');
assert.equal(syncState({ refused: 1, pending: 2, offline: true, persisted: false }).kind, 'attention');
console.log('pantry listen-watch: ok');
