// Unit tests for js/logic.js: node pantry/test/logic.test.mjs
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { CATALOGUE, CATEGORIES, LOCATIONS } from '../js/catalogue.js';

const T = '2026-10-16';
const item = (batches, f = {}) => ({ id: 'i1', name: 'Soy sauce', openDays: 90, batches, ...f });

// dates
assert.equal(L.addDays('2026-12-30', 3), '2027-01-02');
assert.equal(L.daysBetween('2026-10-16', '2026-10-09'), -7);
assert.equal(L.expiryStatus('2026-10-15', T), 'expired');
assert.equal(L.expiryStatus('2026-10-23', T), 'soon');
assert.equal(L.expiryStatus('2026-11-10', T), 'month');
assert.equal(L.expiryStatus('2027-06-01', T), 'ok');
assert.equal(L.expiryStatus(null, T), 'none');
assert.equal(L.expiryLabel('2026-10-15', T), 'expired yesterday');
assert.equal(L.expiryLabel('2026-10-16', T), 'use by today');
assert.equal(L.expiryLabel('2026-10-26', T), '10 days left');

// opened: the earlier of the printed date and opened + keeps-days
const opened = { id: 'b1', qty: 1, expiry: '2027-10-01', openedAt: '2026-10-01' };
assert.equal(L.batchUseBy(opened, item([])), '2026-12-30');
assert.equal(L.batchUseBy({ ...opened, expiry: '2026-11-01' }, item([])), '2026-11-01');
assert.equal(L.batchUseBy({ id: 'x', qty: 1, expiry: null, openedAt: null }, item([])), null);

// first expiring first out; opened ones first
const it = item([{ id: 'a', qty: 2, expiry: '2027-05-01' }, { id: 'b', qty: 1, expiry: '2027-01-01' }, { id: 'c', qty: 1, expiry: '2028-01-01', openedAt: '2026-10-10' }]);
assert.deepEqual(L.fefo(it).map(b => b.id), ['c', 'b', 'a']);
assert.equal(L.totalQty(it), 4);
let r = L.takeOut(it, { qty: 2, at: '2026-10-16T10:00:00Z' });
const live = r => r.item.batches.filter(b => b.qty > 0);   // a batch used up stays at 0 until it is tidied
assert.deepEqual(live(r).map(b => [b.id, b.qty]), [['a', 2]]);
assert.equal(r.event.type, 'use'); assert.equal(r.event.qty, 2);
assert.equal(it.batches.length, 3, 'never mutates');
r = L.takeOut(it, { qty: 9 });
assert.equal(r.event.qty, 4); assert.equal(live(r).length, 0);
assert.equal(L.takeOut(item([]), {}).event, null);
r = L.takeOut(it, { type: 'discard', batchId: 'a' });
assert.equal(r.event.type, 'discard'); assert.equal(r.item.batches.find(b => b.id === 'a').qty, 1);

// opening one splits it off its batch
r = L.openOne(item([{ id: 'a', qty: 3, expiry: '2027-05-01', openedAt: null }]), { today: T });
assert.deepEqual(r.item.batches.map(b => [b.qty, b.openedAt]).sort(), [[1, T], [2, null]]);
r = L.openOne(item([{ id: 'a', qty: 1, expiry: '2027-05-01', openedAt: null }, { id: 'b', qty: 1, expiry: '2027-01-01', openedAt: null }]), { today: T, batchId: 'a' });
assert.equal(r.item.batches.find(b => b.openedAt).expiry, '2027-05-01');

r = L.addStock(item([]), { qty: 3, expiry: '2027-01-01', at: '2026-10-16T02:00:00Z' });
assert.equal(L.totalQty(r.item), 3); assert.equal(r.event.type, 'add');

// consumption pattern: 4 bottles finished over 60 days -> one every 20 days
const now = new Date('2026-10-16T12:00:00Z');
const evs = ['2026-08-01', '2026-08-21', '2026-09-10', '2026-09-30'].map((d, i) => ({ id: 'e' + i, itemId: 'i1', type: 'use', qty: 1, at: d + 'T12:00:00Z' }));
evs.push({ id: 'd', itemId: 'i1', type: 'discard', qty: 1, at: '2026-10-02T12:00:00Z' });
const u = L.usage(evs, now);
assert.equal(Math.round(u.daysPerUnit), 20);
assert.equal(u.units, 4); assert.equal(u.discards, 1);
assert.equal(u.months.length, 6);
assert.deepEqual(u.months.slice(-3).map(m => [m.used, m.wasted]), [[2, 0], [2, 0], [0, 1]]);
assert.equal(L.paceLabel(u), '1 every 3 weeks');
// 1 in stock (the one in use, started when the last ran out on 30 Sep) lasts 20 days -> 20 Oct
assert.equal(L.runOutDate(item([{ id: 'a', qty: 1 }]), u, now), '2026-10-20');
assert.equal(L.usage(evs.slice(0, 1), now).daysPerUnit, null);

// shopping list
const byItem = new Map([['i1', evs]]);
const list = L.toBuy([
  item([{ id: 'a', qty: 1 }]),
  { id: 'i2', name: 'Rice', batches: [] },
  { id: 'i3', name: 'Milo', lowAt: 1, batches: [{ id: 'x', qty: 1 }] },
  { id: 'i4', name: 'Salt', batches: [{ id: 'x', qty: 1 }] },
  { id: 'i5', name: 'Gone', archived: true, batches: [] },
], byItem, { now, days: 30 });
assert.deepEqual(list.map(x => [x.item.name, x.why]), [['Rice', 'out'], ['Milo', 'low'], ['Soy sauce', 'soon']]);

const ex = L.expiring([item([{ id: 'a', qty: 1, expiry: '2026-10-20' }]), { id: 'z', name: 'z', batches: [{ id: 'q', qty: 1, expiry: '2027-10-20' }] }], { today: T });
assert.deepEqual(ex.map(x => x.date), ['2026-10-20']);

// search and shop links
assert.ok(L.score('soy', 'Light soy sauce Kikkoman') > 0);
assert.equal(L.score('soy milk', 'Light soy sauce'), 0);
assert.ok(L.score('kikk', 'Kikkoman soy') > 0);
assert.equal(L.fairpriceUrl('Kaya & butter'), 'https://www.fairprice.com.sg/search?query=Kaya%20%26%20butter');
assert.equal(L.shengSiongUrl('milo'), 'https://shengsiong.com.sg/search/milo');
assert.equal(L.coldStorageUrl('kaya toast'), 'https://coldstorage.com.sg/search?q=kaya%20toast');
assert.equal(L.shopeeUrl('milo'), 'https://shopee.sg/search?keyword=milo');
assert.deepEqual(L.SHOPS.map(s => s.name), ['FairPrice', 'Sheng Siong', 'Cold Storage', 'Shopee']);

// CSV quotes commas
assert.match(L.toCsv([{ id: '1', name: 'Eggs, large', brand: 'Pasar', batches: [{ id: 'b', qty: 2, expiry: '2026-10-20' }] }], T), /"Eggs, large",Pasar,,,,2,2026-10-20,4 days left,/);

// the catalogue is well formed
assert.ok(CATALOGUE.length > 150);
for (const c of CATALOGUE) {
  assert.ok(c.name, 'name');
  assert.ok(CATEGORIES.includes(c.category), `${c.name}: category ${c.category}`);
  assert.ok(LOCATIONS.includes(c.location), `${c.name}: location ${c.location}`);
  assert.ok(c.openDays === null || c.openDays > 0, `${c.name}: openDays`);
}
// badges and words
assert.deepEqual(L.shortLabel('2026-10-15', T), { text: 'Expired yesterday', tone: 'bad' });
assert.deepEqual(L.shortLabel('2026-10-13', T), { text: 'Expired 3 days ago', tone: 'bad' });
assert.deepEqual(L.shortLabel('2026-09-18', T), { text: 'Expired 4 weeks ago', tone: 'bad' });
assert.deepEqual(L.shortLabel('2026-10-16', T), { text: 'Today', tone: 'warn' });
assert.deepEqual(L.shortLabel('2026-10-17', T), { text: 'Tomorrow', tone: 'warn' });
assert.deepEqual(L.shortLabel('2026-10-19', T), { text: 'in 3 days', tone: 'warn' });
assert.deepEqual(L.shortLabel('2026-10-20', T), { text: 'in 4 days', tone: 'plain' });
assert.deepEqual(L.shortLabel('2026-10-29', T), { text: 'in 13 days', tone: 'plain' });
assert.deepEqual(L.shortLabel('2026-10-30', T), { text: 'in 2 weeks', tone: 'plain' });
assert.deepEqual(L.shortLabel('2026-12-15', T), { text: 'in 2 months', tone: 'plain' });
assert.deepEqual(L.shortLabel('2027-10-30', T), { text: 'in 1 year', tone: 'plain' });
assert.deepEqual(L.shortLabel('2029-10-16', T), { text: 'in 3 years', tone: 'plain' });
assert.deepEqual(L.shortLabel(null, T), { text: '', tone: '' });
assert.equal(L.whyText({ why: 'out' }, T), 'None left');
assert.equal(L.whyText({ why: 'low', qty: 1 }, T), 'Only 1 left');
assert.equal(L.whyText({ why: 'soon', runOut: '2026-10-19' }, T), 'Runs out in about 3 days');
assert.equal(L.whyText({ why: 'soon', runOut: '2026-10-16' }, T), 'Runs out about now');
assert.deepEqual(L.monthStats([...evs, { type: 'add', qty: 3, at: '2026-10-05T00:00:00Z' }], '2026-10'), { used: 0, wasted: 1, bought: 3, expired: 0, saved: 0 });

// Kaki Home's measures: used before expiry ("saved"), and binned after the date ("expired")
const dated = item([{ id: 'old', qty: 1, expiry: '2026-10-10' }, { id: 'new', qty: 2, expiry: '2026-11-01' }], { openDays: null });
r = L.takeOut(dated, { batchId: 'new', today: T });
assert.equal(r.event.type, 'use'); assert.equal(r.event.saved, 1);
r = L.takeOut(dated, { type: 'discard', batchId: 'old', today: T });
assert.equal(r.event.type, 'expired', 'binned past its date counts as expired');
r = L.takeOut(dated, { type: 'discard', batchId: 'new', today: T });
assert.equal(r.event.type, 'discard', 'binned in date stays thrown away');
r = L.takeOut(dated, { batchId: 'old', today: T });
assert.equal(r.event.saved, undefined, 'used after its date is not saved');
r = L.takeOut(item([{ id: 'x', qty: 1, expiry: null }], { openDays: null }), { today: T });
assert.equal(r.event.saved, undefined, 'no date: not counted');
const ms = L.monthStats([
  { type: 'use', qty: 2, saved: 2, at: '2026-10-02T00:00:00Z' }, { type: 'use', qty: 1, at: '2026-10-03T00:00:00Z' },
  { type: 'expired', qty: 1, at: '2026-10-04T00:00:00Z' }, { type: 'discard', qty: 1, at: '2026-10-05T00:00:00Z' },
  { type: 'use', qty: 1, saved: 1, at: '2026-09-30T00:00:00Z' },
], '2026-10');
assert.deepEqual(ms, { used: 3, saved: 2, wasted: 2, expired: 1, bought: 0 });
assert.equal(L.usage([{ type: 'expired', qty: 1, at: '2026-10-04T00:00:00Z' }], now).discards, 1);
const rec = L.recent([{ id: 'a', createdAt: '2026-10-15T00:00:00Z' }, { id: 'b', createdAt: '2026-09-01T00:00:00Z' }, { id: 'c', createdAt: '2026-10-12T00:00:00Z' }], { now });
assert.deepEqual(rec.map(x => x.id), ['a', 'c']);
assert.equal(L.shareText(['Milk', 'Eggs']), 'Shopping list\n- Milk\n- Eggs');

// backups: round trip, and anything else is refused in plain words
const b = L.backup({ items: [{ id: 'a', name: 'x' }], events: [], shop: [{ id: 's' }] }, '2026-10-16T00:00:00Z');
assert.deepEqual(L.parseBackup(JSON.stringify(b)), { items: [{ id: 'a', name: 'x', batches: [] }], events: [], shop: [{ id: 's' }], places: [], settings: [], photos: [] });
// the list of places travels too; anything else under settings is dropped
const sb = L.backup({ settings: [{ id: 'places', list: ['Fridge', 'Basement store'], updatedAt: 'x' }, { id: 'other', list: ['x'] }, { id: 'places', list: [3] }] });
assert.deepEqual(L.parseBackup(JSON.stringify(sb)).settings, [{ id: 'places', list: ['Fridge', 'Basement store'], updatedAt: 'x' }], 'an older file’s single list still reads');
// places are documents now: they travel in a backup, the malformed ones don't, and one removed over 30 days ago isn't carried
const pl = L.backup({ places: [{ id: 'p1', name: 'Fridge', order: 1 }, { id: 'p2', name: 'Shed', order: 2, removedAt: '2026-10-01T00:00:00.000Z' }, { id: 'p3', name: 'Old', order: 3, removedAt: '2020-01-01T00:00:00.000Z' }] }, '2026-10-16T00:00:00Z');
assert.deepEqual(L.parseBackup(JSON.stringify({ ...pl, places: [...pl.places, { id: 'bad', name: 3, order: 1 }, { id: 'bad2', name: 'x' }] })).places.map(p => p.id), ['p1', 'p2']);
// photos travel in backups too (only pictures, nothing else)
const pb = L.backup({ items: [{ id: 'a', thumb: 'data:image/jpeg;base64,t', hasPhoto: true }], photos: [{ id: 'a', data: 'data:image/jpeg;base64,p' }, { id: 'b', data: 'javascript:x' }, { id: 'c' }] });
assert.deepEqual(L.parseBackup(JSON.stringify(pb)).photos, [{ id: 'a', data: 'data:image/jpeg;base64,p' }]);
assert.deepEqual(L.parseBackup(JSON.stringify({ app: 'pantry', items: [] })).photos, [], 'an old backup has no photos');
assert.deepEqual(L.parseBackup(JSON.stringify({ app: 'pantry', items: [{ id: 'ok' }, { id: 'a/b' }, { name: 'no id' }, null] })).items, [{ id: 'ok', batches: [] }]);
assert.throws(() => L.parseBackup('{"app":"other"}'), /not a pantry backup/);
assert.throws(() => L.parseBackup('nonsense'), /not a pantry backup/);

// ---- guessed best-before dates (catalogue.js) ----
{
  const C = await import('../js/catalogue.js');
  const day = n => C.shelfDays(C.CATALOGUE.find(c => c.name === n));
  assert.equal(day('Fresh milk'), 7);
  assert.equal(day('Salt'), null, 'salt has no date that matters');
  assert.equal(day('Green tea (no sugar)'), 270, '"no sugar" is not sugar');
  assert.equal(day('Frozen chicken nuggets'), 180, 'frozen chicken is not 2-day chicken');
  assert.equal(day('Chicken breast'), 2);
  assert.equal(day('Laundry liquid'), null);
  assert.equal(C.shelfDays({ name: 'Fried rice', category: 'Leftovers' }), 3);
  assert.equal(C.shelfDays({ name: 'Something', category: 'Nope' }), null);
  assert.ok(C.CATEGORIES.includes('Leftovers'));
  assert.equal(C.freezeDays({ name: 'White bread', category: 'Bread & bakery' }), 30);
  assert.equal(C.freezeDays({ name: 'Minced pork', category: 'Meat & seafood' }), C.FROZEN_DAYS);
  assert.ok(C.freezable({ category: 'Meat & seafood' }) && !C.freezable({ category: 'Toiletries' }));
}
// ---- freeze and thaw ----
{
  const it = { id: 'f', name: 'Minced pork', openDays: 2, location: 'Fridge', batches: [{ id: 'b1', qty: 2, expiry: '2026-10-18', openedAt: '2026-10-15' }, { id: 'b2', qty: 1, expiry: '2028-03-01' }] };
  const f = L.freezeBatch(it, { batchId: 'b1', days: 365, place: 'Level 1 freezer', today: '2026-10-16', by: 'Mum' });
  const b1 = f.item.batches.find(b => b.id === 'b1');
  assert.equal(b1.frozenAt, '2026-10-16');
  assert.equal(b1.expiry, '2027-10-16', 'frozen: keeps a year from today');
  assert.equal(L.batchUseBy(b1, f.item), '2027-10-16', 'opening no longer counts while frozen');
  assert.equal(f.item.location, 'Fridge', 'another batch is still unfrozen: the item stays');
  assert.deepEqual([b1.packExpiry, b1.packPlace], ['2026-10-18', 'Fridge'], 'the packaging date and place are remembered');
  assert.deepEqual([f.event.type, f.event.qty, f.event.by], ['freeze', 2, 'Mum']);
  const later = L.freezeBatch(it, { batchId: 'b2', days: 365, today: '2026-10-16' }).item.batches.find(b => b.id === 'b2');
  assert.equal(later.expiry, '2028-03-01', 'a later printed date stays');
  assert.equal(L.freezeBatch(f.item, { batchId: 'b1' }).event, null, 'already frozen');
  const t = L.thawBatch(f.item, { batchId: 'b1', days: 3, place: 'Fridge', today: '2026-11-01' });
  const tb = t.item.batches.find(b => b.id === 'b1');
  assert.deepEqual([tb.frozenAt, tb.thawedAt, tb.expiry, t.item.location, t.event.type], [null, '2026-11-01', '2026-11-04', 'Fridge', 'thaw']);
  assert.equal(L.batchUseBy(tb, t.item), '2026-11-03', 'an opened one counts its days from the thaw (2, sooner than the 3-day thaw)');
  assert.equal(L.monthStats([f.event, t.event], f.event.at.slice(0, 7)).bought, 0, 'freezing and thawing are not buying');
  assert.equal(tb.packExpiry, '2026-10-18', 'a thaw keeps the packaging date');
}
// ---- freezing part of a batch, the last of the stock, back to the packaging date, moves (21 Oct 2026) ----
{
  const it = { id: 'c', name: 'Chicken thighs', location: 'Fridge', batches: [{ id: 'b', qty: 3, expiry: '2026-10-23', addedAt: '2026-10-20' }] };
  const two = L.freezeBatch(it, { batchId: 'b', qty: 2, place: 'Freezer', today: '2026-10-21' });
  const [rest, cold] = [two.item.batches.find(b => b.id === 'b'), two.item.batches.find(b => b.id === 'b-f20261021')];
  assert.deepEqual([rest.qty, cold.qty, cold.frozenAt, cold.expiry, cold.packExpiry, cold.addedAt], [1, 2, '2026-10-21', '2027-10-21', '2026-10-23', '2026-10-20'], 'two split off, frozen');
  assert.equal(two.item.location, 'Fridge', 'one is left unfrozen: the item stays');
  assert.equal(two.event.qty, 2);
  assert.deepEqual(two.ops.inc, { 'batches.b.qty': -1 * 2, 'batches.b-f20261021.qty': 2 }, 'a split is two increments');
  const all = L.freezeBatch(two.item, { batchId: 'b', place: 'Freezer', today: '2026-10-21' });
  assert.equal(all.item.location, 'Freezer', 'the last of it frozen: the item moves');
  const one = L.thawBatch(all.item, { batchId: 'b-f20261021', qty: 1, place: 'Fridge', today: '2026-10-25', inFreezer: true });
  assert.equal(one.item.location, 'Freezer', 'some still frozen: stays in the freezer');
  const thawed = one.item.batches.find(b => b.id === 'b-f20261021-t20261025');
  assert.deepEqual([thawed.qty, thawed.thawedAt, thawed.expiry, thawed.packExpiry], [1, '2026-10-25', '2026-10-28', '2026-10-23'], 'one thawed, three days');
  // frozen by mistake: back to the packaging date and place
  const back = L.unfreezeBatch(all.item, { batchId: 'b', inFreezer: true });
  const bb = back.item.batches.find(b => b.id === 'b');
  assert.deepEqual([bb.frozenAt, bb.thawedAt, bb.expiry, 'packExpiry' in bb], [null, null, '2026-10-23', false], 'the packaging date is back');
  assert.equal(back.item.location, 'Freezer', 'the other batch is still frozen: the item stays');
  assert.equal(back.event.type, 'unfreeze');
  const mistake = L.freezeBatch(it, { batchId: 'b', place: 'Level 1 freezer', today: '2026-10-21' }).item;
  const undone = L.unfreezeBatch(mistake, { batchId: 'b', inFreezer: true });
  assert.deepEqual([undone.item.location, undone.item.batches[0].expiry, L.isFrozenBatch(undone.item.batches[0], false)], ['Fridge', '2026-10-23', false], 'all of it: back in the fridge');
  assert.ok(!L.canUnfreeze(it.batches[0]) && L.canUnfreeze(mistake.batches[0]) && !L.canUnfreeze(thawed), 'only while frozen');
  // a batch in a freezer place counts as frozen (frozen goods); freezing it again does nothing
  assert.ok(L.isFrozenBatch({ qty: 1 }, true) && !L.isFrozenBatch({ qty: 1, thawedAt: '2026-10-01' }, true) && L.isFrozenBatch({ frozenAt: 'x' }, false));
  assert.equal(L.freezeBatch({ ...it, location: 'Freezer' }, { batchId: 'b', inFreezer: true }).event, null);
  // moving: into a freezer freezes every unfrozen batch, out of one thaws the frozen ones; staples and non-food don't
  const m = L.moveFreezeOps(two.item, { fromFreezer: false, toFreezer: true, today: '2026-10-21' });
  assert.equal(m.frozen, 1, 'only the unfrozen one'); assert.ok(!('location' in m.ops.set));
  assert.equal(L.applyOps(two.item, m.ops).batches.every(b => b.frozenAt), true);
  const out = L.moveFreezeOps({ ...all.item, location: 'Freezer' }, { fromFreezer: true, toFreezer: false, today: '2026-10-22' });
  assert.equal(out.thawed, 3); assert.ok(L.applyOps(all.item, out.ops).batches.every(b => b.thawedAt === '2026-10-22' && b.expiry === '2026-10-25'));
  const goods = { id: 'g', name: 'Dumplings', category: 'Frozen', location: 'Freezer', batches: [{ id: 'd', qty: 2, expiry: '2027-04-01' }] };
  assert.equal(L.moveFreezeOps(goods, { fromFreezer: true, toFreezer: false, today: '2026-10-22' }).thawed, 2, 'frozen goods thaw on the way out');
  assert.equal(L.moveFreezeOps(goods, { fromFreezer: true, toFreezer: true }).thawed, 0, 'freezer to freezer: nothing');
  assert.ok(L.opsEmpty(L.moveFreezeOps(it, { fromFreezer: false, toFreezer: true, food: false }).ops), 'not food: nothing');
  // Undo of a move in and out of a freezer (invertOps) puts the batches back exactly as they were
  const roundTrip = (start, opts) => {
    const m = L.moveFreezeOps(start, opts), moved = L.applyOps(start, m.ops);
    const back = L.applyOps(moved, L.invertOps(m.ops, start, moved));
    return { m, moved, back };
  };
  const mixed = { id: 'm', name: 'Soup', category: 'Meals', location: 'Fridge', batches: [{ id: 'p', qty: 2, expiry: '2026-10-25' }, { id: 'q', qty: 1, expiry: '2026-10-27' }] };
  const into = roundTrip(mixed, { fromFreezer: false, toFreezer: true, today: '2026-10-21' });
  assert.equal(into.m.frozen, 3); assert.ok(into.moved.batches.every(b => b.frozenAt), 'frozen on the way in');
  assert.deepEqual(L.normalizeItem(into.back).batches, L.normalizeItem(mixed).batches, 'Undo of a move into a freezer: the batches are back');
  const frozenItem = into.moved;
  const outOf = roundTrip({ ...frozenItem, location: 'Freezer' }, { fromFreezer: true, toFreezer: false, today: '2026-10-22' });
  assert.equal(outOf.m.thawed, 3); assert.ok(outOf.moved.batches.every(b => b.thawedAt === '2026-10-22'), 'thawed on the way out');
  assert.deepEqual(L.normalizeItem(outOf.back).batches, L.normalizeItem(frozenItem).batches, 'Undo of a move out of a freezer: still frozen, as before');
}
// ---- places of a kind ----
{
  const P = await import('../js/places.js');
  assert.equal(P.placeOfKind(P.DEFAULT_PLACES, 'freezer'), 'Freezer');
  assert.equal(P.placeOfKind(['Kitchen cabinet', 'Level 2 Fridge'], 'fridge'), 'Level 2 Fridge');
  assert.equal(P.placeOfKind(['Kitchen cabinet'], 'freezer'), 'Freezer');
  assert.ok(P.isFreezer('Level 1 freezer') && !P.isFreezer('Fridge'));
  // kinds: guessed from the name, or set on the place
  assert.deepEqual(['Chest freezer', 'Ice box', 'Frozen drawer', 'Fridge freezer', 'Chiller', 'Level 2 Fridge', 'Store room', 'Freezer'].map(P.guessKind),
    ['freezer', 'freezer', 'freezer', 'freezer', 'fridge', 'fridge', 'other', 'freezer']);
  const entries = P.placeEntries([{ id: 'a', name: 'Garage box', order: 1, updatedAt: 'x', kind: 'freezer' }, { id: 'b', name: 'Freezer', order: 2, updatedAt: 'x', kind: 'other' }, { id: 'c', name: 'Mum’s fridge', order: 3, updatedAt: 'x', kind: 'bogus' }]);
  const k = n => P.kindOf(n, entries);
  assert.deepEqual(['Garage box', 'Freezer', 'Mum’s fridge'].map(k), ['freezer', 'other', 'fridge'], 'a set kind wins; an unknown one is ignored');
  assert.deepEqual(P.placesOfKind(entries.map(e => e.name), 'freezer', k), ['Garage box']);
  assert.ok(P.isFreezer('Garage box', k) && !P.isFreezer('Freezer', k) && !P.isFreezer('', k));
  const merged = P.mergeInto({ docs: [{ id: 'x', name: 'Fridge', order: 1, updatedAt: 'x' }] }, { docs: [{ id: 'a', name: 'Garage box', order: 1, updatedAt: 'x', kind: 'freezer' }] }, 't');
  assert.equal(merged[0].kind, 'freezer', 'merging keeps a kind');
}

// ---- since you last looked, and WhatsApp text ----
{
  const ev = (by, type, at, extra = {}) => ({ id: at, itemId: 'x', name: 'Milk', type, qty: 1, at, by, ...extra });
  const since = '2026-10-15T00:00:00.000Z';
  const list = L.sinceLast({ events: [ev('Dad', 'add', '2026-10-16T01:00:00.000Z', { qty: 2 }), ev('Mum', 'use', '2026-10-16T02:00:00.000Z'), ev('Dad', 'use', '2026-10-14T02:00:00.000Z'), ev('Dad', 'level', '2026-10-16T03:00:00.000Z', { level: 'low' })],
    shop: [{ id: 's', name: 'Bananas', by: 'Dad', at: '2026-10-16T04:00:00.000Z' }], since, isMe: by => by === 'Mum' });
  assert.deepEqual(list.map(L.sinceText), ['added Bananas to the shopping list', 'marked Milk as low', 'bought 2 Milk'], 'others only, after since, newest first');
  assert.deepEqual(L.sinceLast({ events: [ev('Dad', 'add', '2026-10-16T01:00:00.000Z')], since: null }), [], 'never looked: nothing');
  const now = new Date('2026-10-16T12:00:00Z');
  assert.equal(L.agoText('2026-10-16T11:59:30Z', now), 'just now');
  assert.equal(L.agoText('2026-10-16T11:30:00Z', now), '30 min ago');
  assert.equal(L.agoText('2026-10-16T09:00:00Z', now), '3 h ago');
  assert.equal(L.agoText('2026-10-15T10:00:00Z', now), 'yesterday');
  assert.equal(L.agoText('2026-10-12T12:00:00Z', now), '4 days ago');
  const text = L.useWeekText([{ item: { name: 'Fresh milk', brand: 'Meiji' }, date: '2026-10-18' }, { item: { name: 'Kaya', brand: '' }, date: '2026-10-20' }]);
  assert.equal(text, 'Use this week\n- Meiji Fresh milk, by 2026-10-18\n- Kaya, by 2026-10-20');
  assert.equal(L.waLink('a & b\nc'), 'https://wa.me/?text=a%20%26%20b%0Ac');
}

// ---- staples: Plenty / Low / Out ----
{
  const rice = { id: 'r', name: 'Rice', measure: 'level', level: 'plenty', batches: [] };
  assert.ok(L.isStaple(rice) && !L.isStaple({ id: 'x' }));
  assert.equal(L.levelOf({ measure: 'level' }), 'plenty', 'no level yet: plenty');
  assert.deepEqual(L.toBuy([rice], new Map()), [], 'plenty: not on the list (no count needed)');
  const low = L.setLevel(rice, { level: 'low', by: 'Dad' });
  assert.deepEqual([low.item.level, low.event.type, low.event.level, low.event.by], ['low', 'level', 'low', 'Dad']);
  const b = L.toBuy([low.item, L.setLevel(rice, { level: 'out' }).item], new Map());
  assert.deepEqual(b.map(x => [x.why, L.whyText(x)]), [['out', 'Out'], ['low', 'Running low']]);
  assert.equal(L.setLevel(rice, { level: 'lots' }).event, null);
  assert.deepEqual(L.expiring([{ ...rice, batches: [{ id: 'b', qty: 1, expiry: '2000-01-01' }] }], { today: T }), [], 'staples never show under Use soon');
  assert.ok(L.toCsv([low.item]).split('\n')[1].includes(',Low,'), 'the CSV says Low');
}

console.log('pantry logic: ok');
