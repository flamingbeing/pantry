// Unit tests for removing without losing (js/logic.js, js/merge.js, js/store.js, and a look at app.js): a delete is a marker,
// every list skips removed things, a change that lands on a removed thing never brings it back, Recently removed's words,
// and the sweep's choice of what to delete: node pantry/test/removed.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as L from '../js/logic.js';
import { carryOver } from '../js/merge.js';
import { openMemory } from '../js/store.js';

const DAY = 86400000, NOW = Date.parse('2026-10-16T12:00:00.000Z');
const ago = d => new Date(NOW - d * DAY).toISOString();

// ---- isRemoved / live ----
assert.equal(L.isRemoved({ id: 'a' }), false);
assert.equal(L.isRemoved({ id: 'a', removedAt: ago(1) }), true);
assert.equal(L.isRemoved({ id: 'a', removedAt: '' }), false, 'empty is not a removal');
assert.equal(L.isRemoved({ id: 'a', removedAt: null }), false);
assert.equal(L.isRemoved(null), false);
const all = [{ id: 'a' }, { id: 'b', removedAt: ago(2) }, { id: 'c', removedAt: '' }];
assert.deepEqual(L.live(all).map(x => x.id), ['a', 'c']);
assert.deepEqual(L.live(new Map(all.map(x => [x.id, x])).values()).map(x => x.id), ['a', 'c'], 'takes a Map’s values too');
assert.deepEqual(L.liveItems(null), []);

// ---- removing and restoring are instructions ----
const milk = L.normalizeItem({ id: 'm', name: 'Milk', location: 'Fridge', batches: { a: { qty: 3, expiry: '2026-12-01' } } });
const rm = L.removeOps('Dad', '2026-10-16T01:00:00.000Z');
assert.deepEqual(rm, { set: { removedAt: '2026-10-16T01:00:00.000Z', removedBy: 'Dad' }, inc: {}, del: [] });
assert.ok(L.opsValid(rm));
assert.equal(L.removeOps('x'.repeat(60)).set.removedBy.length, 40, 'a name is cut to the 40 characters the rules allow');
let r = L.applyOps(milk, rm);
assert.equal(L.isRemoved(r), true);
assert.equal(L.totalQty(r), 3, 'removing leaves the stock as it was');
assert.equal(milk.removedAt, undefined, 'never changes the item given');
// a use / edit / add that lands on the removed item is applied to it, and it stays removed
const use = L.takeOut(r, { today: '2026-10-16' });
assert.equal(L.totalQty(use.item), 2, 'the use is applied to the hidden item');
assert.equal(L.isRemoved(use.item), true, 'and does not bring it back');
assert.equal(L.isRemoved(L.applyOps(r, { set: { name: 'Fresh milk', location: 'Pantry' }, inc: {}, del: [] })), true, 'an edit neither');
assert.equal(L.isRemoved(L.applyOps(r, L.addStock(r, { qty: 2 }).ops)), true, 'nor an add');
// restore clears both fields, and keeps what landed meanwhile
const back = L.applyOps(use.item, L.restoreOps());
assert.equal(L.isRemoved(back), false);
assert.ok(!('removedAt' in back) && !('removedBy' in back), 'both fields gone (deleteField)');
assert.equal(L.totalQty(back), 2, 'Restore keeps the use that landed while it was hidden');
assert.deepEqual(L.restoreOps().del, ['removedAt', 'removedBy']);
assert.ok(L.opsValid(L.restoreOps()));
// stored form keeps the marker; the old whole-item shapes read it too
assert.equal(L.toStored(r).removedAt, '2026-10-16T01:00:00.000Z');
assert.equal(L.plainItem(r).removedBy, 'Dad');
// removing twice (both phones deleted) is the same marker again: nothing changes but the time
const twice = L.applyOps(r, L.removeOps('Mum', '2026-10-16T02:00:00.000Z'));
assert.equal(L.isRemoved(twice), true);
// undo of a delete is a restore; undo of the earlier use still works after the removal
const used = L.takeOut(milk, { today: '2026-10-16' });
const afterBoth = L.applyOps(L.applyOps(milk, used.ops), rm);
const inv = L.invertOps(used.ops, milk, afterBoth);
assert.equal(L.totalQty(L.applyOps(afterBoth, inv)), 3, 'undoing the use on a removed item gives the unit back');
assert.equal(L.isRemoved(L.applyOps(afterBoth, inv)), true, 'and it is still removed');

// ---- the same instructions on a shopping line (no batches) ----
const line = { id: 'l1', name: 'Milk', done: false, at: ago(1), by: 'Mum' };
const t1 = L.applyFieldOps(line, { set: { done: true, doneBy: 'Dad' }, inc: {}, del: [] });
assert.equal(t1.done, true); assert.equal(line.done, false, 'never changes the line given'); assert.ok(!('batches' in t1), 'no batches on a line');
const rl = L.applyFieldOps(t1, L.removeOps('Mum', ago(0)));
assert.equal(rl.done, true, 'a tick and a removal are different fields: both stay');
assert.equal(L.isRemoved(rl), true);
assert.equal(L.isRemoved(L.applyFieldOps(rl, { set: { done: false }, inc: {}, del: [] })), true, 'an untick lands on a removed line and does not bring it back');
assert.equal(L.isRemoved(L.applyFieldOps(rl, L.restoreOps())), false);
assert.equal(L.applyFieldOps(rl, L.restoreOps()).done, true, 'restoring keeps the tick');

// ---- days left (Recently removed's words) ----
assert.equal(L.daysLeft({ id: 'x' }, NOW), null, 'not removed: no days');
assert.equal(L.daysLeft({ removedAt: ago(0) }, NOW), 30);
assert.equal(L.daysLeft({ removedAt: ago(27) }, NOW), 3);
assert.equal(L.daysLeft({ removedAt: ago(29.5) }, NOW), 1);
assert.equal(L.daysLeft({ removedAt: ago(30) }, NOW), 0);
assert.equal(L.daysLeft({ removedAt: ago(45) }, NOW), 0);
assert.equal(L.daysLeft({ removedAt: 'garbage' }, NOW), 30, 'an odd time is treated as just removed (never swept early)');
assert.equal(L.daysLeft({ removedAt: new Date(NOW + 5 * DAY).toISOString() }, NOW), 30, 'a clock ahead can’t make it longer than 30');
assert.equal(L.daysLeftText(3), '3 days left'); assert.equal(L.daysLeftText(1), '1 day left'); assert.equal(L.daysLeftText(0), 'Going soon'); assert.equal(L.daysLeftText(null), '');
// the list: still inside its 30 days, newest removal first
const mix = [{ id: 'old', removedAt: ago(40) }, { id: 'new', removedAt: ago(1) }, { id: 'mid', removedAt: ago(20) }, { id: 'live' }];
assert.deepEqual(L.recentlyRemoved(mix, NOW).map(x => x.id), ['new', 'mid']);

// ---- the sweep: only what is older than 30 days, oldest first, at most 20 a day ----
assert.equal(L.expiredRemoval({ removedAt: ago(30.01) }, NOW), true);
assert.equal(L.expiredRemoval({ removedAt: ago(29.9) }, NOW), false, 'a day short: kept');
assert.equal(L.expiredRemoval({ id: 'live' }, NOW), false, 'a live thing is never due');
assert.equal(L.expiredRemoval({ removedAt: 'garbage' }, NOW), false, 'an odd time is never due');
const due = L.sweepDue([{ id: 'i1', removedAt: ago(31) }, { id: 'i2', removedAt: ago(10) }, { id: 'i3' }, { id: 'i4', removedAt: ago(90) }], [{ id: 's1', removedAt: ago(35) }, { id: 's2', removedAt: ago(2) }], NOW);
assert.deepEqual(due.items.map(x => x.id), ['i4', 'i1']); assert.deepEqual(due.shop.map(x => x.id), ['s1']);
// places are swept the same way (oldest first, in the same 20 a day)
const dueP = L.sweepDue([], [], NOW, 20, [{ id: 'p1', removedAt: ago(40) }, { id: 'p2', removedAt: ago(3) }, { id: 'p3' }]);
assert.deepEqual(dueP.places.map(x => x.id), ['p1'], 'a place removed over 30 days ago is due; a recent one and a live one are not');
const heap = Array.from({ length: 30 }, (_, i) => ({ id: 'h' + String(i).padStart(2, '0'), removedAt: ago(31 + i) }));
const part = L.sweepDue(heap, [{ id: 'sx', removedAt: ago(500) }], NOW);
assert.equal(part.items.length + part.shop.length, L.SWEEP_MAX, 'at most 20 in all, however many are due');
assert.equal(part.shop[0].id, 'sx', 'oldest first, shopping lines included');
assert.equal(part.items.at(-1).id, 'h11', 'the 19 oldest items come next');
assert.deepEqual(L.sweepDue([], [], NOW), { items: [], shop: [], places: [] });
// a second phone's sweep sees the same list (and deleting a missing document is fine: the backends say false)
assert.deepEqual(L.sweepDue(heap, [], NOW), L.sweepDue([...heap].reverse(), [], NOW), 'every phone chooses the same ones');

// ---- history of removed items is not counted ----
const evs = [{ id: 'e1', itemId: 'a' }, { id: 'e2', itemId: 'b' }, { id: 'e3', itemId: 'zz' }];
assert.deepEqual(L.liveEvents(evs, [{ id: 'a' }, { id: 'b', removedAt: ago(1) }]).map(e => e.id), ['e1', 'e3']);

// ---- backups, restores, copying and merging carry markers, but not what is past 30 days ----
const data = {
  items: [{ id: 'k', name: 'Keep', batches: [] }, { id: 'r', name: 'Recent', removedAt: ago(3), removedBy: 'Dad', batches: [] }, { id: 'x', name: 'Old', removedAt: ago(40), batches: [] }],
  shop: [{ id: 's1', name: 'a', done: false }, { id: 's2', name: 'b', done: false, removedAt: ago(5) }, { id: 's3', name: 'c', done: false, removedAt: ago(50) }],
  events: [{ id: 'e1', itemId: 'k' }, { id: 'e2', itemId: 'r' }, { id: 'e3', itemId: 'x' }],
  photos: [{ id: 'k', data: 'data:image/jpeg;base64,AA' }, { id: 'r', data: 'data:image/jpeg;base64,BB' }, { id: 'x', data: 'data:image/jpeg;base64,CC' }],
  settings: [],
};
const kept = L.keepLive(data, NOW);
assert.deepEqual(kept.items.map(i => i.id), ['k', 'r']); assert.deepEqual(kept.shop.map(i => i.id), ['s1', 's2']);
assert.deepEqual(kept.events.map(e => e.id), ['e1', 'e2'], 'the history of a purged item goes with it');
assert.deepEqual(kept.photos.map(p => p.id), ['k', 'r'], 'and its photo');
assert.equal(kept.items[1].removedBy, 'Dad', 'markers are carried as they are');
const b = L.backup(data, new Date(NOW).toISOString());
assert.deepEqual(b.items.map(i => i.id), ['k', 'r']); assert.equal(b.items[1].removedAt, ago(3)); assert.deepEqual(b.shop.map(i => i.id), ['s1', 's2']);
const back2 = L.parseBackup(JSON.stringify({ ...b, items: [...b.items, { id: 'x2', name: 'Old', removedAt: new Date(Date.now() - 40 * DAY).toISOString() }] }));
assert.deepEqual(back2.items.map(i => i.id), ['k', 'r'], 'a backup file’s old removals are not brought back');
assert.equal(back2.items[1].removedAt, ago(3), 'a recent removal is');
assert.deepEqual(carryOver(data, NOW).items.map(i => i.id), ['k', 'r'], 'merging two pantries carries the same');
assert.deepEqual(carryOver({ items: [], shop: [], events: [], photos: [] }, NOW), { items: [], shop: [], events: [], photos: [], places: [] });
// an old backup (no markers) is unchanged
assert.equal(L.parseBackup(JSON.stringify({ app: 'pantry', items: [{ id: 'q', name: 'Q', batches: [] }], shop: [{ id: 'z', name: 'Z', done: false }] })).items.length, 1);

// ---- the in-memory backend (demo): fields on a shopping line, purge only what is still removed and old ----
const mem = openMemory({ items: [{ id: 'o', name: 'Old', removedAt: ago(40), batches: {} }, { id: 'n', name: 'New', removedAt: ago(1), batches: {} }], shop: [{ id: 'l', name: 'Milk', done: false }] });
mem.patch('shop', 'l', { set: { done: true }, inc: {}, del: [] });
assert.deepEqual(await mem.get('shop', 'l'), { id: 'l', name: 'Milk', done: true }, 'a line changes by field, no batches added');
mem.patch('shop', 'l', L.removeOps('Mum', ago(0)));
assert.equal(L.isRemoved(await mem.get('shop', 'l')), true);
mem.patchMany('shop', [{ id: 'l', ops: L.restoreOps() }]);
assert.equal(L.isRemoved(await mem.get('shop', 'l')), false);
const cutoff = ago(30);
assert.equal(await mem.purge('items', 'n', cutoff), false, 'newer than 30 days: kept');
assert.equal(await mem.purge('items', 'o', cutoff), true, 'older: deleted');
assert.equal(await mem.purge('items', 'o', cutoff), false, 'a second sweep finds it gone: harmless');
assert.equal(await mem.purge('shop', 'l', cutoff), false, 'a live line is never purged');
assert.equal((await mem.get('items', 'n')).name, 'New');
mem.delMany('events', ['nope']);
// places and names on the in-memory backend (demo; the on-phone one runs the same applyFieldOps): fields and keyed names
const mp = openMemory({ places: [{ id: 'p1', name: 'Fridge', order: 1, updatedAt: 'T' }, { id: 'p2', name: 'Shed', order: 2, updatedAt: 'T', removedAt: ago(40) }], settings: [{ id: 'people', names: { 'a.b@c.d': 'Ann' }, updatedAt: 'T' }] });
assert.deepEqual((await mp.load()).places.map(x => x.id), ['p1', 'p2'], 'places load as a kind of their own');
mp.patch('places', 'p1', { set: { name: 'Big fridge', updatedAt: 'U' }, inc: {}, del: [] });
mp.patch('places', 'p1', L.removeOps('Mum', ago(0))); mp.patch('places', 'p1', L.restoreOps());
assert.deepEqual(await mp.get('places', 'p1'), { id: 'p1', name: 'Big fridge', order: 1, updatedAt: 'U' }, 'renamed by field, removed and restored: markers gone');
assert.equal(await mp.purge('places', 'p2', ago(30)), true, 'a place removed over 30 days ago is purged'); assert.equal(await mp.purge('places', 'p1', ago(30)), false);
mp.patch('settings', 'people', { set: { updatedAt: 'V' }, inc: {}, del: [], keyed: { names: { set: { 'x@y.z': 'Zed' }, del: [] } } });
mp.patch('settings', 'people', { set: {}, inc: {}, del: [], keyed: { names: { set: {}, del: ['a.b@c.d'] } } });
assert.deepEqual(await mp.get('settings', 'people'), { id: 'people', names: { 'x@y.z': 'Zed' }, updatedAt: 'V' }, 'one name set, one cleared (an email with dots), nothing else touched');

// ---- every list in the app skips removed things (one door: items(), shopLines(), liveEvents()) ----
// app.js reads S.items / S.shop in bulk only in the places below; anything else would show a removed thing somewhere.
const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8').split('\n');
const ALLOWED = [
  /^const items = \(\) => L\.live\(S\.items\.values\(\)\)/,               // the one list of items
  /^const shopLines = \(\) => L\.live\(S\.shop\.values\(\)\)/,            // the one list of shopping lines
  /^const liveEvents = \(\) => L\.liveEvents\(\[\.\.\.S\.events\.values\(\)\], \[\.\.\.S\.items\.values\(\)\]\)/,
  /const removedLists = \(\) =>/,                                          // Recently removed (shows exactly the removed)
  /const due = L\.sweepDue\(\[\.\.\.S\.items\.values\(\)\], \[\.\.\.S\.shop\.values\(\)\]/,   // the sweep
  /L\.backup\(\{ items: \[\.\.\.S\.items\.values\(\)\]/,                   // a backup carries markers (and leaves out the expired)
  /for \(const it of S\.items\.values\(\)\) noteLanded\(it\)/,             // looking for changes that landed on removed items
  /\[\.\.\.S\.items\.values\(\)\]\.find\(i => typeof i\.photo === 'string'/,   // moving old-style photos: harmless on any item
  /rm\('items'|S\.items\.size/,                                            // (the welcome only asks whether anything was ever saved)
];
const bulk = app.map((t, i) => [i + 1, t]).filter(([, t]) => /S\.(items|shop)\.values\(\)/.test(t) && !/^\s*\/\//.test(t));
const stray = bulk.filter(([, t]) => !ALLOWED.some(re => re.test(t)));
assert.deepEqual(stray, [], 'lists that read S.items / S.shop without skipping removed ones: ' + JSON.stringify(stray));
// and the lookups by id that show something go through itemById (a removed item is "gone" to every screen)
const byId = app.map((t, i) => [i + 1, t]).filter(([, t]) => /S\.items\.get\(/.test(t) && !/^\s*\/\//.test(t));
const OK_GET = [
  /const itemById/,                                              // the door itself
  /const before = S\.items\.get\(id\)/,                         // a change is applied to the item as this phone has it, hidden or not
  /const cur = S\.items\.get\(it\.id\)/,                          // (moving old photos)
  /const id = res\.item\.id, before = S\.items\.get\(id\)/,       // a stock change
  /const now = S\.items\.get\(id\); if \(!now\) return null/,   // Undo
  /const x = \(kind === 'shop' \? S\.shop : S\.items\)\.get\(id\)/, // Restore
  /S\[info\.kind\]|S\[r\.kind\]|S\[kind\]/,                        // a refused change, a change from another phone
  /S\.items\.get\(id\)\?\.name/,                                 // a name for the "needs attention" lines
  /const it = S\.items\.get\(mine\.id\)/,                         // the item a barcode was just added to
  /S\.items\.get\(it\.id\)\?\.location/,                          // moving the items of a renamed place
  /\(\[id, at\]\) => S\.items\.get\(id\)/,                       // the items a note is about (then checked removed)
  /use: \(id, batchId|add: \(id, qty|open: \(id, batchId/,         // the emulator tests' own actions
  /S\.items\.get\(sent\[0\]\.id\)\?\.name/,                         // the name in a toast about an item just moved
  /const nameOf2 = i => S\.items\.get\(i\)\?\.name/,              // a name in a drag's label (the item is on screen)
  /const now = S\.items\.get\(x\.id\)/,                          // Undo of a batch: the item as it is now (one removed since counts as changed, except undoing a delete)
];
const strayGet = byId.filter(([, t]) => !OK_GET.some(re => re.test(t)));
assert.deepEqual(strayGet, [], 'screens that look an item up by id without skipping removed ones: ' + JSON.stringify(strayGet));

// ---- places: one door, placeList() (a removed place is hidden everywhere; the household's old list is read only there) ----
const placeBulk = app.map((t, i) => [i + 1, t]).filter(([, t]) => /S\.places\b|P\.PLACES_ID/.test(t) && !/^\s*\/\//.test(t));
const OK_PLACES = [
  /^const placeList = \(\) => P\.placeEntries\(\[\.\.\.S\.places\.values\(\)\], S\.settings\.get\(P\.PLACES_ID\)\)/,   // the one list of places
  /^const removedPlaces = \(\) => L\.recentlyRemoved\(\[\.\.\.S\.places\.values\(\)\]\)/,                               // Recently removed shows exactly the removed
  /const before = S\.places\.get\(id\); if \(!before\) continue|S\.places\.set\(id, L\.applyFieldOps\(before, full\)\)/,   // a change is applied to the place as this phone has it, hidden or not
  /const fresh = virt\.filter\(e => !S\.places\.has\(e\.id\)\)\.map|for \(const d of fresh\) S\.places\.set/,             // writing the places a household is showing as documents
  /S\.places\.has\(e\.id\) && L\.isRemoved\(S\.places\.get\(e\.id\)\)/,                                                 // (every place removed: the defaults come back)
  /S\.places\.set\(doc\.id, doc\)/,                                                                                    // a new place
  /const x = S\.places\.get\(id\); if \(!x\) return/,                                                                  // Restore
  /const due = L\.sweepDue\(/, /S\.places\.delete\(d\.id\)/,                                                           // the sweep
  /L\.backup\(\{ items:.*places: \[\.\.\.S\.places\.values\(\)\]/,                                                      // a backup carries markers
  /const mergedPlaces = data => P\.mergeInto\(\{ docs: \[\.\.\.S\.places\.values\(\)\]/,                                // copying and restoring merge by name
  /places: new Map\(\)/,
  /placeName: id => S\.places\.get\(id\)\?\.name/,                                                                   // naming a waiting change (Sync now), hidden place or not
];
const strayP = placeBulk.filter(([, t]) => !OK_PLACES.some(re => re.test(t)));
assert.deepEqual(strayP, [], 'places read other than through placeList(): ' + JSON.stringify(strayP));
assert.ok(placeBulk.length >= 8 && app.some(t => /^const placeList = /.test(t)), 'the guard looks at the right lines');
// nothing else builds the list from the pieces: placeEntries / placeNames are only called by the door and the names made from it
const strayE = app.map((t, i) => [i + 1, t]).filter(([, t]) => /P\.placeEntries\(|P\.legacyNames\(/.test(t) && !/^const placeList = /.test(t) && !/^\s*\/\//.test(t));
assert.deepEqual(strayE, [], 'placeEntries used outside placeList(): ' + JSON.stringify(strayE));

console.log('pantry removed: ok');
