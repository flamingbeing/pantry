// The listener watchdog's decision (js/listen-watch.js) and the chip's use of "the server was heard a moment ago" (js/sync.js).
import assert from 'node:assert/strict';
import { decide, CACHE_MS, FLAG_MS, STALE_MS, THROTTLE_MS, ESCALATE_MS, CYCLE_THROTTLE_MS } from '../js/listen-watch.js';
import { syncState } from '../js/sync.js';

const T = 1_000_000;
const base = { now: T, online: true, event: false, lastServerAt: T - 1000, openedAt: T - 60000, cacheSince: 0, flaggedSince: 0, lastRelisten: 0, lastCycle: 0, quiet: true };
const d = o => decide({ ...base, ...o });

// healthy: nothing to do, however long it has been quiet (a quiet household sends nothing for hours)
const R = why => ({ relisten: true, cycle: false, why }), C = why => ({ relisten: false, cycle: true, why }), NO = { relisten: false, cycle: false, why: '' };
assert.deepEqual(d({}), NO);
assert.deepEqual(d({ lastServerAt: T - 3 * 3600_000 }), NO, 'long quiet alone is not a sign (no event)');
// 'cache': a listener has shown only the phone's own copy for CACHE_MS while online
assert.deepEqual(d({ cacheSince: T - CACHE_MS + 1 }), NO);
assert.deepEqual(d({ cacheSince: T - CACHE_MS }), R('cache'));
assert.equal(d({ cacheSince: T - 60000, online: false }).relisten, false, 'never while the browser says it is offline');
// 'flagged': a document still flagged pending long after every write was acknowledged
assert.equal(d({ flaggedSince: T - FLAG_MS + 1 }).relisten, false);
assert.deepEqual(d({ flaggedSince: T - FLAG_MS }), R('flagged'));
// 'quiet': only at a moment the phone came back, and only if the server hasn't been heard for STALE_MS
assert.equal(d({ event: true }).relisten, false, 'came back, heard from the server a second ago: fine');
assert.deepEqual(d({ event: true, lastServerAt: T - STALE_MS }), R('quiet'));
assert.deepEqual(d({ event: true, lastServerAt: 0, openedAt: T - STALE_MS - 1 }), R('quiet'), 'never heard since it opened');
assert.equal(d({ event: true, lastServerAt: 0, openedAt: T - 2000 }).relisten, false, 'it only just started listening');
assert.equal(d({ event: false, lastServerAt: T - 5 * STALE_MS }).relisten, false, 'no event, no quiet rule');
assert.equal(d({ event: true, lastServerAt: T - 5 * STALE_MS, online: false }).relisten, false, 'offline: wait for online');
// throttle: once every THROTTLE_MS
assert.equal(d({ cacheSince: T - 60000, lastRelisten: T - THROTTLE_MS + 1, quiet: false }).relisten, false);
assert.equal(d({ cacheSince: T - 60000, lastRelisten: T - THROTTLE_MS, quiet: false }).relisten, true);
assert.equal(d({ event: true, lastServerAt: T - 60000, lastRelisten: T - 5000 }).relisten, false, 'events are throttled too');
// escalation: still stuck ESCALATE_MS after listening again, and every write acknowledged: restart the connection
const stuck = { flaggedSince: T - 20000 };
assert.deepEqual(d({ ...stuck, lastRelisten: T - ESCALATE_MS }), C('flagged'), 'listened again and still stuck: restart the connection');
assert.deepEqual(d({ ...stuck, lastRelisten: T - ESCALATE_MS + 1 }), NO, 'not yet (and the relisten throttle holds)');
assert.equal(d({ ...stuck, lastRelisten: T - ESCALATE_MS, quiet: false }).cycle, false, 'never restart with a write unacknowledged: it would be sent again, and an increment sent twice counts twice');
assert.deepEqual(d({ ...stuck, lastRelisten: T - ESCALATE_MS, lastCycle: T - CYCLE_THROTTLE_MS + 1 }), NO, 'at most one restart a minute');
assert.deepEqual(d({ ...stuck, lastRelisten: T - ESCALATE_MS, lastCycle: T - CYCLE_THROTTLE_MS }), C('flagged'));
assert.equal(d({ ...stuck, lastRelisten: T - ESCALATE_MS, online: false }).cycle, false, 'offline: nothing');
assert.deepEqual(d({ cacheSince: T - CACHE_MS, lastRelisten: T - 10000 }), C('cache'), 'the cache sign escalates too');
assert.deepEqual(d({ event: true, lastServerAt: 1, lastRelisten: T - 10000 }), NO, 'the quiet sign never restarts the connection');
// order of reasons: the cache sign first
assert.equal(d({ cacheSince: T - CACHE_MS, flaggedSince: T - FLAG_MS, event: true, lastServerAt: 1 }).why, 'cache');

// the chip: a listener that still says "my own copy" is not a reason to say Waiting when the server was heard a moment ago
assert.equal(syncState({ pending: 1, cache: true, waited: 100 }).kind, 'waiting', 'unsent, and showing its own copy: waiting');
assert.equal(syncState({ pending: 1, cache: true, waited: 100, recent: true }).kind, 'saved', 'a server snapshot just arrived: not a lost connection');
assert.equal(syncState({ pending: 1, cache: true, waited: 2000, recent: true }).kind, 'waiting', 'still unconfirmed after 1.5 s: waiting, whatever the listener says');
assert.equal(syncState({ pending: 0, cache: true }).kind, 'saved', 'nothing unsent: never waiting');
assert.equal(syncState({ pending: 1, offline: true, recent: true }).kind, 'waiting');
console.log('pantry listen-watch: ok');
