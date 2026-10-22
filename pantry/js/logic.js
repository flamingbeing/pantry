// Pure logic for the pantry: dates, expiry, stock, consumption patterns and the shopping list.
// No DOM and no storage here, so the unit tests (test/logic.test.mjs) can run it in Node.

import { isPlacesDoc } from './places.js';

export const DAY = 86400000;

// Local calendar dates as 'YYYY-MM-DD' (expiry dates are calendar days, not instants).
export function ymd(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function parseYmd(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return ymd(d);
}
// Whole days from a to b (both 'YYYY-MM-DD'); negative when b is before a.
export function daysBetween(a, b) {
  const x = parseYmd(a), y = parseYmd(b);
  if (!x || !y) return null;
  return Math.round((y - x) / DAY);
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---- batches: two shapes in the database, one in memory -----------------------------------------------------------------
//
// An item's stock is a list of batches. In Firestore it is stored two ways (16 Oct 2026, owner's "pantry sync safety"
// plan; NOTES.md): the old ARRAY `batches: [{ id, qty, expiry, ... }]`, and the new MAP `batches: { <batchId>: { qty,
// expiry, ... } }`. The map lets one phone change `batches.<id>.qty` without sending the whole item (and so without
// overwriting what another phone just did). In memory (S.items) it is always an array of batches that each carry their
// `id`, so everything below works the same for both. normalizeItem() is the one door every item comes through (load,
// listen, restore, import, backup, demo, sample); toStored() is the one door out.

export const MAX_BATCHES = 60;   // the rules allow at most 60 batches an item
export const MAX_QTY = 9999;
const BATCH_ID = /^[A-Za-z0-9_-]{1,40}$/;
export const goodBatchId = s => typeof s === 'string' && BATCH_ID.test(s);
// A short stable hash of text (FNV-1a, 32 bits), for ids two phones must agree on.
const hash = s => { let h = 0x811c9dc5; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
// The id an id-less batch of an old array gets: from the item's id and its place in the array, so two phones that
// convert the same old item agree on it.
export const legacyBatchId = (itemId, index) => `L${hash(itemId)}-${index}`;
// Stock never shows below 0: two phones using the last unit at once can leave -1 in the database.
export const clampQty = v => { const n = Number(v); return Number.isFinite(n) ? Math.min(MAX_QTY, Math.max(0, n)) : 0; };

// Batches from either shape as an array, each with its `id`, quantity clamped to 0 or more. An array's own ids are kept
// when they are good and unique, else derived (legacyBatchId); a map's keys are its ids (in key order, so every
// phone lists them the same).
export function normalizeBatches(raw, itemId = '') {
  const out = [], seen = new Set();
  const push = (b, id) => { seen.add(id); out.push({ ...b, id, qty: clampQty(b.qty) }); };
  if (Array.isArray(raw)) {
    raw.forEach((b, i) => {
      if (!b || typeof b !== 'object') return;
      let id = goodBatchId(b.id) && !seen.has(b.id) ? b.id : legacyBatchId(itemId, i);
      while (seen.has(id)) id += 'x';
      push(b, id);
    });
  } else if (raw && typeof raw === 'object') {
    for (const k of Object.keys(raw).sort()) if (goodBatchId(k) && raw[k] && typeof raw[k] === 'object') push(raw[k], k);
  }
  return out;
}
// An item as the app holds it: `batches` an array with ids. `_arr` remembers that the stored copy was an old-style
// array (the next change then converts it: see updateData in cloud.js). Safe to call twice.
export function normalizeItem(it) {
  if (!it || typeof it !== 'object') return it;
  const arr = it._arr !== undefined ? !!it._arr : Array.isArray(it.batches);
  return { ...it, batches: normalizeBatches(it.batches, it.id), _arr: arr };
}
// The stored form of batches: a map keyed by id, each batch without its id, spent batches (nothing left) left out.
export function batchMap(batches) {
  const out = {};
  for (const b of batches || []) {
    if (!(b.qty > 0)) continue;
    const { id, ...rest } = b;
    out[id] = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  }
  return out;
}
// An item as it goes to the database (a new item, a restore): batches as a map, no `_` helpers.
export function toStored(it) {
  const n = normalizeItem(it);
  const out = {};
  for (const [k, v] of Object.entries(n)) if (!k.startsWith('_') && v !== undefined) out[k] = v;
  out.batches = batchMap(n.batches);
  return out;
}
// The same item as plain data for a backup file: batches as an array (the file stays readable by older versions).
export function plainItem(it) {
  const out = {};
  for (const [k, v] of Object.entries(normalizeItem(it))) if (!k.startsWith('_')) out[k] = v;
  return out;
}

// ---- changes as instructions -------------------------------------------------------------------------------------------
//
// A change to an item is `ops = { set: { path: value }, inc: { path: n }, del: [path] }`, paths dotted
// (`location`, `batches.<id>.expiry`, `batches.<id>`), never two that overlap. applyOps() does them to an item in
// memory; cloud.js sends the same ops as one Firestore update (set a field, increment() a number, deleteField()), and
// the on-phone and demo stores call applyOps too, so all three behave alike. Nothing here ever sends a whole item built
// from a copy that may be stale: two phones each using one unit make two `inc -1`s, and the server adds them.

export const emptyOps = () => ({ set: {}, inc: {}, del: [] });
// A fourth kind of instruction, for a map whose KEYS are data, not field names (16 Oct 2026, PR-C: names): `keyed` is
// `{ <field>: { set: { key: value }, del: [key] } }`, e.g. `{ names: { set: { 'mum@example.com': 'Mum' }, del: [] } }`. A key is
// taken whole, never split at its dots (an email has dots): cloud.js sends it as the field path ['names', key] (a Firestore
// FieldPath), so one person's name is one field and two people naming themselves never overwrite each other.
export const keyedOps = (field, { set = {}, del = [] } = {}) => ({ set: {}, inc: {}, del: [], keyed: { [field]: { set, del } } });
const keyedEmpty = o => Object.values(o?.keyed || {}).every(k => !Object.keys(k.set || {}).length && !(k.del || []).length);
export const opsEmpty = o => !o || (!Object.keys(o.set || {}).length && !Object.keys(o.inc || {}).length && !(o.del || []).length && keyedEmpty(o));
export const opsPaths = o => [...Object.keys(o?.set || {}), ...Object.keys(o?.inc || {}), ...(o?.del || [])];
// True when no path is the same as, or inside, another (Firestore refuses an update that overlaps itself). A keyed field
// counts as the path to the map (nothing else may touch it), and its own set and del keys must be different keys.
export function opsValid(o) {
  const ps = opsPaths(o), kf = Object.keys(o?.keyed || {});
  const all = [...ps, ...kf];
  return ps.every(p => typeof p === 'string' && p && !p.startsWith('.') && !p.endsWith('.'))
    && !all.some((p, i) => all.some((q, j) => i !== j && (p === q || p.startsWith(q + '.'))))
    && kf.every(f => { const k = o.keyed[f], keys = [...Object.keys(k.set || {}), ...(k.del || [])]; return keys.every(x => typeof x === 'string' && x) && new Set(keys).size === keys.length; });
}
// Two sets of instructions as one (they must not overlap): Put away sets the place and adds the stock.
export function mergeOps(...list) {
  const out = emptyOps();
  for (const o of list) {
    if (!o) continue;
    Object.assign(out.set, o.set); Object.assign(out.inc, o.inc); out.del.push(...(o.del || []));
    for (const [f, k] of Object.entries(o.keyed || {})) {
      const t = (out.keyed ||= {})[f] ||= { set: {}, del: [] };
      Object.assign(t.set, k.set); t.del.push(...(k.del || []));
    }
  }
  return out;
}
// The keyed instructions done to a plain object (a map field of a document): never changes the one given.
function applyKeyed(out, ops) {
  for (const [f, k] of Object.entries(ops.keyed || {})) {
    const m = { ...(out[f] && typeof out[f] === 'object' && !Array.isArray(out[f]) ? out[f] : {}) };
    for (const [key, v] of Object.entries(k.set || {})) m[key] = v;
    for (const key of k.del || []) delete m[key];
    out[f] = m;
  }
}
const split = p => p.split('.');
function getPath(item, path) {
  const [a, id, f] = split(path);
  if (a === 'batches') {
    const b = (item.batches || []).find(x => x.id === id);
    return f === undefined ? (b ? { ...b } : undefined) : b?.[f];
  }
  return split(path).reduce((o, k) => (o == null ? undefined : o[k]), item);
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Do `ops` to an item (any shape in, a normalized item out; never changes the one given). A batch that an `inc` or a
// `set` names but the item doesn't have is created, as the database does. Quantities are clamped for display.
export function applyOps(item, ops = {}) {
  const it = normalizeItem(item);
  const out = { ...it };
  const bm = new Map(it.batches.map(b => [b.id, { ...b }]));
  const batch = id => { if (!bm.has(id)) bm.set(id, { id, qty: 0 }); return bm.get(id); };
  const deep = (path, fn) => {
    const ks = split(path); let o = out;
    for (const k of ks.slice(0, -1)) { o[k] = o[k] && typeof o[k] === 'object' ? { ...o[k] } : {}; o = o[k]; }
    fn(o, ks[ks.length - 1]);
  };
  for (const [path, v] of Object.entries(ops.set || {})) {
    const [a, id, f] = split(path);
    if (a === 'batches') { if (!id) continue; if (f === undefined) bm.set(id, { ...(v || {}), id, qty: Number(v?.qty) || 0 }); else batch(id)[f] = v; }
    else deep(path, (o, k) => { o[k] = v; });
  }
  for (const [path, n] of Object.entries(ops.inc || {})) {
    const [a, id, f] = split(path);
    if (a === 'batches') { if (id && f) { const b = batch(id); b[f] = (Number(b[f]) || 0) + n; } }
    else deep(path, (o, k) => { o[k] = (Number(o[k]) || 0) + n; });
  }
  for (const path of ops.del || []) {
    const [a, id, f] = split(path);
    if (a === 'batches') { if (id && f === undefined) bm.delete(id); else if (id && bm.has(id)) delete bm.get(id)[f]; }
    else deep(path, (o, k) => { delete o[k]; });
  }
  applyKeyed(out, ops);
  out.batches = [...bm.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)).map(b => ({ ...b, qty: clampQty(b.qty) }));
  out._arr = false;
  return out;
}
// The instructions that undo `ops` (done to `before`), for this phone's Undo. An `inc` is undone by the opposite `inc`
// (so what another phone did meanwhile stays). A field is put back only if it still holds what `ops` set (`now`: the
// item as it is now), and only if it existed. Fields that stamp who changed it are left alone (Undo is a change too).
const STAMPS = new Set(['updatedAt', 'updatedBy']);
export function invertOps(ops, before, now = null) {
  const b = normalizeItem(before), n = now ? normalizeItem(now) : null, inv = emptyOps();
  for (const [p, d] of Object.entries(ops.inc || {})) inv.inc[p] = -d;
  for (const [p, v] of Object.entries(ops.set || {})) {
    if (STAMPS.has(p)) continue;
    const [a, id] = split(p);
    if (a === 'batches' && !b.batches.some(x => x.id === id)) continue;   // a batch this change made: its `inc` empties it
    if (n && !same(getPath(n, p), v)) continue;                            // someone changed it since
    const old = getPath(b, p);
    if (old === undefined) inv.del.push(p); else inv.set[p] = old;
  }
  for (const p of ops.del || []) {
    const old = getPath(b, p);
    if (old === undefined || (split(p)[0] === 'batches' && split(p).length === 2 && !(old.qty > 0))) continue;   // a spent batch stays gone
    if (n && getPath(n, p) !== undefined) continue;
    if (split(p)[0] === 'batches' && split(p).length === 2) { const { id, ...rest } = old; inv.set[p] = rest; } else inv.set[p] = old;
  }
  return inv;
}
// Spent batches (nothing left) to tidy away with the next added stock: only when an item has piled up 40 batches (the
// rules allow 60), and then all the spent ones. Otherwise they stay, hidden at 0: deleting one from a copy that may be a
// moment out of date could remove a unit another phone has just given back with Undo (found by the randomised
// two-phone test), and a spent batch costs next to nothing. A batch that is gone is simply made again by the next `inc`.
export function spentBatches(item) {
  const list = normalizeItem(item).batches;
  return list.length >= 40 ? list.filter(b => !(b.qty > 0)).map(b => `batches.${b.id}`) : [];
}

// ---- removing without losing: a marker, not a delete ---------------------------------------------------------------------
//
// Deleting an item or a shopping line (16 Oct 2026, PR-B of "pantry sync safety"; NOTES.md) sets two fields, `removedAt`
// (an ISO time) and `removedBy` (a name), and leaves the document where it is. Every list, count, search and match skips
// a removed one (isRemoved / live: the one place that says so). A change another phone sends meanwhile (a use, an edit, a
// tick) lands on the hidden document and never brings it back; Settings → Recently removed puts it back (Restore clears
// both fields) for REMOVED_DAYS days, after which any phone's sweep deletes it for good.

export const REMOVED_DAYS = 30;
export const SWEEP_MAX = 20;   // documents one phone purges in one day
export const isRemoved = x => !!x && typeof x.removedAt === 'string' && x.removedAt !== '';
// The documents (items, shopping lines) that are still there, as an array. Every list in the app comes through this.
export const live = list => [...(list || [])].filter(x => !isRemoved(x));
export const liveItems = live;
// The instructions that remove a document, and that put it back (`by` fits the rules' 40 characters).
export const removeOps = (by = '', at = new Date().toISOString()) => ({ set: { removedAt: at, removedBy: String(by || '').slice(0, 40) }, inc: {}, del: [] });
export const restoreOps = () => ({ set: {}, inc: {}, del: ['removedAt', 'removedBy'] });
const removedMs = x => (isRemoved(x) ? Date.parse(x.removedAt) : NaN);
// Whole days left in Recently removed (30 on the day itself, 1 on the last day, 0 once it is due for the sweep).
export function daysLeft(x, now = Date.now()) {
  const t = removedMs(x);
  if (Number.isNaN(t)) return isRemoved(x) ? REMOVED_DAYS : null;
  return Math.max(0, Math.min(REMOVED_DAYS, Math.ceil((t + REMOVED_DAYS * DAY - new Date(now).getTime()) / DAY)));
}
export const daysLeftText = n => (n == null ? '' : n <= 0 ? 'Going soon' : n === 1 ? '1 day left' : `${n} days left`);
// Removed, and still within its 30 days: what Recently removed lists, newest removal first.
export const recentlyRemoved = (list, now = Date.now()) => [...(list || [])].filter(x => isRemoved(x) && daysLeft(x, now) > 0)
  .sort((a, b) => (a.removedAt < b.removedAt ? 1 : a.removedAt > b.removedAt ? -1 : 0));
// Removed more than 30 days ago: due to be deleted for good.
export const expiredRemoval = (x, now = Date.now()) => isRemoved(x) && removedMs(x) + REMOVED_DAYS * DAY <= new Date(now).getTime();
// A list without what is past its 30 days (copying, backups and merging don't carry those).
export const dropExpired = (list, now = Date.now()) => (list || []).filter(x => !expiredRemoval(x, now));
// History lines whose item is not removed (what Home's totals and "Since you last looked" count).
export function liveEvents(events, items) {
  const gone = new Set((items || []).filter(isRemoved).map(i => i.id));
  return [...(events || [])].filter(e => !gone.has(e.itemId));
}
// What this phone's daily sweep deletes: items, shopping lines and places removed more than 30 days ago, oldest first, at most
// `max` in all (so the cost of a day is bounded, however long nobody swept). { items: [docs], shop: [docs], places: [docs] }.
export function sweepDue(items, shop, now = Date.now(), max = SWEEP_MAX, places = []) {
  const due = [...(items || []).map(d => ({ k: 'items', d })), ...(shop || []).map(d => ({ k: 'shop', d })), ...(places || []).map(d => ({ k: 'places', d }))]
    .filter(x => expiredRemoval(x.d, now)).sort((a, b) => (a.d.removedAt < b.d.removedAt ? -1 : a.d.removedAt > b.d.removedAt ? 1 : a.d.id < b.d.id ? -1 : 1)).slice(0, max);
  const of = k => due.filter(x => x.k === k).map(x => x.d);
  return { items: of('items'), shop: of('shop'), places: of('places') };
}

// Instructions on a plain document (a shopping line): the same set / inc / del as applyOps, without batches. Never
// changes the one given.
export function applyFieldOps(doc, ops = {}) {
  const out = { ...doc };
  const deep = (path, fn) => {
    const ks = path.split('.'); let o = out;
    for (const k of ks.slice(0, -1)) { o[k] = o[k] && typeof o[k] === 'object' ? { ...o[k] } : {}; o = o[k]; }
    fn(o, ks[ks.length - 1]);
  };
  for (const [p, v] of Object.entries(ops.set || {})) deep(p, (o, k) => { o[k] = v; });
  for (const [p, n] of Object.entries(ops.inc || {})) deep(p, (o, k) => { o[k] = (Number(o[k]) || 0) + n; });
  for (const p of ops.del || []) deep(p, (o, k) => { delete o[k]; });
  applyKeyed(out, ops);
  return out;
}

// ---- stock -------------------------------------------------------------------------------------------------

export const batchesOf = item => (Array.isArray(item.batches) ? item.batches : normalizeBatches(item.batches, item.id));
export const totalQty = item => batchesOf(item).reduce((n, b) => n + clampQty(b.qty), 0);

// The date a batch should be used by: the printed date, or "opened on + keeps N days after opening",
// whichever comes first.
// A frozen batch keeps its frozen date (opening doesn't count in the freezer); once thawed, an opened one counts its
// days from the thaw.
export function batchUseBy(batch, item) {
  let d = batch.expiry || null;
  if (batch.frozenAt) return d;
  if (batch.openedAt && item.openDays > 0) {
    const from = batch.thawedAt && batch.thawedAt > batch.openedAt ? batch.thawedAt : batch.openedAt;
    const o = addDays(from, Number(item.openDays));
    if (!d || o < d) d = o;
  }
  return d;
}

// Batches in "first expiring, first out" order: opened ones first, then by use-by date (no date last).
export function fefo(item) {
  return [...batchesOf(item)].filter(b => b.qty > 0).sort((a, b) => {
    if (!!a.openedAt !== !!b.openedAt) return a.openedAt ? -1 : 1;
    const x = batchUseBy(a, item) || '9999', y = batchUseBy(b, item) || '9999';
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

export function nextUseBy(item) {
  const b = fefo(item).map(b => batchUseBy(b, item)).filter(Boolean).sort();
  return b[0] || null;
}

// 'expired' | 'soon' (within 7 days) | 'month' (within 30) | 'ok' | 'none' (no date)
export function expiryStatus(date, today = ymd()) {
  if (!date) return 'none';
  const d = daysBetween(today, date);
  if (d < 0) return 'expired';
  if (d <= 7) return 'soon';
  if (d <= 30) return 'month';
  return 'ok';
}

export function expiryLabel(date, today = ymd()) {
  if (!date) return '';
  const d = daysBetween(today, date);
  if (d < -1) return `expired ${-d} days ago`;
  if (d === -1) return 'expired yesterday';
  if (d === 0) return 'use by today';
  if (d === 1) return 'use by tomorrow';
  if (d <= 60) return `${d} days left`;
  const m = Math.round(d / 30.4);
  if (m < 24) return `${m} months left`;
  return `${Math.round(d / 365)} years left`;
}

// Stock changes. Each returns { item, event, ops }: `ops` is the change as instructions (what is sent), `item` is the
// result of doing them to the item given (a new object; the one given is never changed), `event` the history line.
function ev(item, type, qty, by, at = new Date().toISOString(), extra = {}) {
  return { id: uid(), itemId: item.id, name: item.name, type, qty, at, by: by || '', ...extra };
}
const bp = (id, f) => `batches.${id}.${f}`;
const done = (item, ops, event) => ({ item: applyOps(item, ops), event, ops });
const nothing = item => ({ item, event: null, ops: emptyOps() });

export function addStock(item, { qty = 1, expiry = null, by, at, price = null, id = uid() } = {}) {
  const n = Number(qty) || 1;
  const ops = emptyOps();
  ops.set[bp(id, 'expiry')] = expiry || null;
  ops.set[bp(id, 'openedAt')] = null;
  ops.set[bp(id, 'addedAt')] = ymd(at ? new Date(at) : new Date());
  ops.inc[bp(id, 'qty')] = n;
  ops.del.push(...spentBatches(item));
  return done(item, ops, ev(item, 'add', n, by, at, price != null ? { price } : {}));
}

// Take n units out of the batches, first expiring first. type: 'use' (used up) or 'discard' (thrown away).
// The event also says how the units stood against their dates, for "used before expiry": saved = units used up
// while still in date (dated batches only); a discard where every unit was already past its date is recorded as
// type 'expired', so wasted-because-forgotten shows apart from thrown away.
// Each batch is changed with `inc -n` (never a rewrite), so two phones using one each make two.
export function takeOut(item, { qty = 1, type = 'use', by, at, batchId = null, today = ymd() } = {}) {
  let left = Number(qty) || 1;
  const order = batchId ? batchesOf(item).filter(b => b.id === batchId && b.qty > 0) : fefo(item);
  const ops = emptyOps();
  let inDate = 0, past = 0;
  for (const b of order) {
    if (left <= 0) break;
    const n = Math.min(b.qty, left);
    ops.inc[bp(b.id, 'qty')] = -n;
    left -= n;
    const d = batchUseBy(b, item);
    if (d && d < today) past += n; else if (d) inDate += n;
  }
  const taken = (Number(qty) || 1) - left;
  if (!taken) return nothing(item);
  const kind = type === 'discard' && past === taken ? 'expired' : type;
  return done(item, ops, ev(item, kind, taken, by, at, kind === 'use' && inDate ? { saved: inDate } : {}));
}

// Open one unit: it moves to a batch of its own with today's opening date (so "keeps N days after opening" starts). That
// batch's id comes from the source batch and the day, so two phones opening on the same day add to the same one.
export function openOne(item, { by, at, today = ymd(), batchId = null } = {}) {
  const b = fefo(item).find(b => !b.openedAt && (!batchId || b.id === batchId));
  if (!b) return nothing(item);
  const id = `${b.id}-o${today.replace(/-/g, '')}`.slice(0, 40);
  const ops = emptyOps();
  ops.inc[bp(b.id, 'qty')] = -1;
  ops.inc[bp(id, 'qty')] = 1;
  ops.set[bp(id, 'expiry')] = b.expiry || null;
  ops.set[bp(id, 'addedAt')] = b.addedAt ?? null;
  ops.set[bp(id, 'openedAt')] = today;
  if (b.thawedAt) ops.set[bp(id, 'thawedAt')] = b.thawedAt;
  ops.del.push(...spentBatches(item).filter(p => p !== `batches.${id}`));
  return done(item, ops, ev(item, 'open', 1, by, at));
}

// Staples (rice, oil, salt, wet-market vegetables) can be kept as Plenty / Low / Out instead of a count: the item has
// measure 'level' and level 'plenty' | 'low' | 'out' (no batches needed). Low and Out put it on the shopping list.
export const LEVELS = ['plenty', 'low', 'out'];
export const isStaple = it => it?.measure === 'level';
export const levelOf = it => (LEVELS.includes(it?.level) ? it.level : 'plenty');
export function setLevel(item, { level = 'plenty', by, at } = {}) {
  if (!LEVELS.includes(level)) return nothing(item);
  const ops = emptyOps();
  ops.set.level = level;
  return done(item, ops, ev(item, 'level', 1, by, at, { level }));
}

// Freeze and thaw (21 Oct 2026, owner). A batch counts as frozen when it is marked so, or when it sits in a freezer place and
// hasn't been thawed (frozen goods bought into the freezer); `inFreezer` says whether the item's place is a freezer.
export const isFrozenBatch = (b, inFreezer = false) => !!b?.frozenAt || (inFreezer && !b?.thawedAt);
// What a batch is split into when only some of it changes: `<id>-<tag><day>`, so two phones doing it on one day add to one.
const splitId = (b, tag, today) => `${b.id}-${tag}${today.replace(/-/g, '')}`.slice(0, 40);
// Change `n` units of batch `b`: all of it in place, or some of it into a batch of its own (like openOne) that carries
// `fields`. Returns the ops and the id that changed.
function splitOff(item, b, n, tag, today, fields) {
  const ops = emptyOps();
  const all = n >= b.qty, id = all ? b.id : splitId(b, tag, today);
  if (!all) {
    ops.inc[bp(b.id, 'qty')] = -n;
    ops.inc[bp(id, 'qty')] = n;
    ops.set[bp(id, 'addedAt')] = b.addedAt ?? null;
    ops.set[bp(id, 'openedAt')] = b.openedAt ?? null;
    ops.del.push(...spentBatches(item).filter(p => p !== `batches.${id}`));
  }
  for (const [k, v] of Object.entries(fields)) ops.set[bp(id, k)] = v;
  return { ops, id };
}
const unitsOf = (qty, b) => Math.max(1, Math.min(b.qty, Math.round(Number(qty)) || b.qty));
// Is anything with stock left in the other state? (The item moves only when nothing is left behind.)
const anyLeft = (item, inFreezer, frozen) => batchesOf(item).some(x => x.qty > 0 && isFrozenBatch(x, inFreezer) === frozen);
// Freeze `qty` units of one batch (all of it when not given). They keep till the later of their own date and `days` from
// today, are marked frozen on today and remember their packaging date and place (`packExpiry`, `packPlace`; kept from an
// earlier freeze), for "Not frozen: back to packaging date". The item moves to `place` once none of its stock is left unfrozen.
export function freezeBatch(item, { batchId, qty = null, days = 365, place, inFreezer = false, by, at, today = ymd() } = {}) {
  const b = batchesOf(item).find(x => x.id === batchId) || fefo(item).find(x => !isFrozenBatch(x, inFreezer));
  if (!b || isFrozenBatch(b, inFreezer) || !(b.qty > 0)) return nothing(item);
  const n = unitsOf(qty, b);
  const keep = addDays(today, days), was = batchUseBy(b, item);
  const { ops } = splitOff(item, b, n, 'f', today, {
    frozenAt: today, thawedAt: null, expiry: was && was > keep ? was : keep,
    packExpiry: 'packExpiry' in b ? b.packExpiry ?? null : b.expiry ?? null,
    packPlace: 'packPlace' in b ? b.packPlace ?? null : (!inFreezer && item.location) || null,
  });
  const after = applyOps(item, ops);
  if (place && !anyLeft(after, inFreezer, false)) ops.set.location = place;
  return done(item, ops, ev(item, 'freeze', n, by, at));
}
// Thaw `qty` units of a frozen batch (all when not given): use within `days`. The item moves to `place` once none of its
// stock is left frozen. The packaging date stays remembered.
export function thawBatch(item, { batchId, qty = null, days = 3, place, inFreezer = false, by, at, today = ymd() } = {}) {
  const b = batchesOf(item).find(x => x.id === batchId);
  if (!b || !(b.qty > 0)) return nothing(item);
  const n = unitsOf(qty, b);
  const fields = { frozenAt: null, thawedAt: today, expiry: addDays(today, days) };
  if (n < b.qty) { if ('packExpiry' in b) fields.packExpiry = b.packExpiry ?? null; if ('packPlace' in b) fields.packPlace = b.packPlace ?? null; }
  const { ops } = splitOff(item, b, n, 't', today, fields);
  const after = applyOps(item, ops);
  if (place && !anyLeft(after, inFreezer, true)) ops.set.location = place;
  return done(item, ops, ev(item, 'thaw', n, by, at));
}
// "Not frozen: back to packaging date": a batch frozen by mistake (still frozen) gets its packaging date back and stops
// counting as frozen; the item goes back to where it was (`packPlace`, or `place`) once none of its stock is left frozen.
export const canUnfreeze = b => !!b && 'packExpiry' in b && !!b.frozenAt;   // never after a real thaw: thawed food keeps its 3 days
export function unfreezeBatch(item, { batchId, place = null, inFreezer = false, by, at } = {}) {
  const b = batchesOf(item).find(x => x.id === batchId);
  if (!canUnfreeze(b)) return nothing(item);
  const ops = emptyOps();
  ops.set[bp(b.id, 'frozenAt')] = null;
  ops.set[bp(b.id, 'thawedAt')] = null;
  ops.set[bp(b.id, 'expiry')] = b.packExpiry ?? null;
  ops.del.push(bp(b.id, 'packExpiry'), bp(b.id, 'packPlace'));
  const to = b.packPlace || place;
  // the batch itself no longer counts as frozen, wherever the item is
  const rest = applyOps(item, ops);
  if (to && to !== item.location && !batchesOf(rest).some(x => x.id !== b.id && x.qty > 0 && isFrozenBatch(x, inFreezer))) ops.set.location = to;
  return done(item, ops, ev(item, 'unfreeze', b.qty, by, at));
}
// Moving an item between a freezer and anywhere else (Move to…, a drag, Bulk edit, the edit form) freezes or thaws its food
// the same way: into a freezer, every unfrozen batch with stock freezes; out of one, every frozen batch thaws. The ops
// (without the location, which the caller sets) and how many units changed: { ops, frozen, thawed }.
export function moveFreezeOps(item, { fromFreezer, toFreezer, food = true, freezeDays = 365, thawDays = 3, today = ymd() } = {}) {
  const out = { ops: emptyOps(), frozen: 0, thawed: 0 };
  if (!food || fromFreezer === toFreezer || isStaple(item)) return out;
  let cur = item;
  for (const b of batchesOf(item).filter(x => x.qty > 0)) {
    const r = toFreezer
      ? (!isFrozenBatch(b, fromFreezer) ? freezeBatch(cur, { batchId: b.id, days: freezeDays, inFreezer: fromFreezer, today }) : null)
      : (isFrozenBatch(b, fromFreezer) ? thawBatch(cur, { batchId: b.id, days: thawDays, inFreezer: fromFreezer, today }) : null);
    if (!r?.event) continue;
    out.ops = mergeOps(out.ops, r.ops); cur = r.item;
    if (toFreezer) out.frozen += r.event.qty; else out.thawed += r.event.qty;
  }
  delete out.ops.set.location;
  return out;
}

// ---- consumption patterns ------------------------------------------------------------------------------------

// Thrown away, for whatever reason ('expired': it was already past its date).
export const WASTE = new Set(['discard', 'expired']);

// From an item's events: how fast the family gets through it.
// daysPerUnit: average days one unit lasts (needs two or more "used up" events).
export function usage(events, now = new Date()) {
  const uses = events.filter(e => e.type === 'use').sort((a, b) => (a.at < b.at ? -1 : 1));
  const units = uses.reduce((n, e) => n + (e.qty || 1), 0);
  const discards = events.filter(e => WASTE.has(e.type)).reduce((n, e) => n + (e.qty || 1), 0);
  const out = { uses: uses.length, units, discards, daysPerUnit: null, perMonth: null, lastUse: uses.length ? uses[uses.length - 1].at : null };
  if (uses.length >= 2) {
    const span = (new Date(uses[uses.length - 1].at) - new Date(uses[0].at)) / DAY;
    const counted = units - (uses[0].qty || 1);   // the first finish only marks the start of the clock
    if (span >= 1 && counted > 0) {
      out.daysPerUnit = span / counted;
      out.perMonth = 30.4 / out.daysPerUnit;
    }
  }
  // the last 6 calendar months, oldest first, units used up in each
  const months = [];
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key, label: m.toLocaleString('en-SG', { month: 'short' }), used: 0, wasted: 0 });
  }
  for (const e of events) {
    const k = String(e.at).slice(0, 7);
    const m = months.find(x => x.key === k);
    if (!m) continue;
    if (e.type === 'use') m.used += e.qty || 1;
    if (WASTE.has(e.type)) m.wasted += e.qty || 1;
  }
  out.months = months;
  return out;
}

// When the stock will run out at the usual pace ('YYYY-MM-DD'), or null without a pattern yet.
// The unit in use started at the last "used up"; every unit in stock lasts daysPerUnit.
export function runOutDate(item, u, now = new Date()) {
  if (!u || !u.daysPerUnit || !u.lastUse) return null;
  const qty = totalQty(item);
  const end = new Date(new Date(u.lastUse).getTime() + Math.max(qty, 0) * u.daysPerUnit * DAY);
  return ymd(end < now ? now : end);
}

export function paceLabel(u) {
  if (!u || !u.daysPerUnit) return '';
  const d = u.daysPerUnit;
  if (d < 1.5) return 'about 1 a day';
  if (d < 10) return `1 every ${Math.round(d)} days`;
  if (d < 60) return `1 every ${Math.round(d / 7)} week${Math.round(d / 7) === 1 ? '' : 's'}`;
  return `1 every ${Math.round(d / 30.4)} month${Math.round(d / 30.4) === 1 ? '' : 's'}`;
}

// ---- the shopping list ---------------------------------------------------------------------------------------

// Items to buy: out of stock, at or below their "running low" level, or due to run out within `days`.
export function toBuy(items, eventsByItem, { days = 7, now = new Date() } = {}) {
  const today = ymd(now);
  const out = [];
  for (const it of items) {
    if (it.archived || it.noRestock) continue;
    if (isStaple(it)) {
      const l = levelOf(it);
      if (l !== 'plenty') out.push({ item: it, why: l === 'out' ? 'out' : 'low', runOut: null, qty: 0, staple: true });
      continue;
    }
    const q = totalQty(it);
    const low = Number(it.lowAt) || 0;
    const u = usage(eventsByItem.get(it.id) || [], now);
    const ro = runOutDate(it, u, now);
    let why = null;
    if (q <= 0) why = 'out';
    else if (q <= low) why = 'low';
    else if (ro && daysBetween(today, ro) <= days) why = 'soon';
    if (why) out.push({ item: it, why, runOut: ro, qty: q });
  }
  const rank = { out: 0, low: 1, soon: 2 };
  return out.sort((a, b) => rank[a.why] - rank[b.why] || a.item.name.localeCompare(b.item.name));
}

// Items whose next use-by date is past or within `days`.
export function expiring(items, { days = 14, today = ymd() } = {}) {
  return items
    .filter(it => !it.archived && !isStaple(it) && totalQty(it) > 0)
    .map(it => ({ item: it, date: nextUseBy(it) }))
    .filter(x => x.date && daysBetween(today, x.date) <= days)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---- search --------------------------------------------------------------------------------------------------

export const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Simple word-prefix scoring, good enough for a few hundred names.
export function score(query, text) {
  const q = norm(query).split(' ').filter(Boolean);
  if (!q.length) return 0;
  const t = norm(text);
  const words = t.split(' ');
  let s = 0;
  for (const w of q) {
    if (words.some(x => x === w)) s += 3;
    else if (words.some(x => x.startsWith(w))) s += 2;
    else if (t.includes(w)) s += 1;
    else return 0;
  }
  return s;
}

export function fairpriceUrl(q) { return 'https://www.fairprice.com.sg/search?query=' + encodeURIComponent(q); }
export function shengSiongUrl(q) { return 'https://shengsiong.com.sg/search/' + encodeURIComponent(q); }
export function coldStorageUrl(q) { return 'https://coldstorage.com.sg/search?q=' + encodeURIComponent(q); }
export function shopeeUrl(q) { return 'https://shopee.sg/search?keyword=' + encodeURIComponent(q); }
// The shops an item links to ("Buy online"), in the order shown. Each opens the shop's own search for the item.
export const SHOPS = [
  { name: 'FairPrice', url: fairpriceUrl },
  { name: 'Sheng Siong', url: shengSiongUrl },
  { name: 'Cold Storage', url: coldStorageUrl },
  { name: 'Shopee', url: shopeeUrl },
];

// ---- export ----------------------------------------------------------------------------------------------------

const csvCell = v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export function toCsv(items, today = ymd()) {
  const rows = [['Name', 'Brand', 'Size', 'Category', 'Where', 'Quantity', 'Next use-by', 'Status', 'Barcode']];
  for (const it of items) {
    if (it.archived) continue;
    const d = nextUseBy(it);
    const q = isStaple(it) ? levelOf(it).replace(/^./, c => c.toUpperCase()) : totalQty(it);
    rows.push([it.name, it.brand, it.size, it.category, it.location, q, isStaple(it) ? '' : d || '', d && !isStaple(it) ? expiryLabel(d, today) : '', it.barcode]);
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\n');
}

// ---- small words for the screens -------------------------------------------------------------------------------

// A short badge for a use-by date: 'Expired', 'Today', 'Tomorrow', '3 days', '2 weeks', or '' when it is far off.
// tone: 'bad' (expired), 'warn' (within 7 days), 'plain' (within 30 days), '' (later or no date).
export function shortLabel(date, today = ymd()) {
  if (!date) return { text: '', tone: '' };
  const d = daysBetween(today, date), n = Math.abs(d);
  const unit = (v, w) => `${v} ${w}${v === 1 ? '' : 's'}`;
  const span = n < 14 ? unit(n, 'day') : n < 60 ? unit(Math.round(n / 7), 'week') : Math.round(n / 30.4) < 12 ? unit(Math.round(n / 30.4), 'month') : unit(Math.max(1, Math.round(n / 365)), 'year');
  if (d === -1) return { text: 'Expired yesterday', tone: 'bad' };
  if (d < 0) return { text: `Expired ${span} ago`, tone: 'bad' };
  if (d === 0) return { text: 'Today', tone: 'warn' };
  if (d === 1) return { text: 'Tomorrow', tone: 'warn' };
  return { text: `in ${span}`, tone: d <= 3 ? 'warn' : 'plain' };
}

// Why something is on the shopping list, in words.
export function whyText(b, today = ymd()) {
  if (b.staple) return b.why === 'out' ? 'Out' : 'Running low';
  if (b.why === 'out') return 'None left';
  if (b.why === 'low') return `Only ${b.qty} left`;
  const d = daysBetween(today, b.runOut);
  return d <= 0 ? 'Runs out about now' : `Runs out in about ${d} day${d === 1 ? '' : 's'}`;
}

// This month's totals from the events (units): used, bought, wasted (thrown away, expired included), expired, and
// saved: used up while still in date (waste the pantry helped prevent).
export function monthStats(events, month = ymd().slice(0, 7)) {
  const out = { used: 0, wasted: 0, bought: 0, expired: 0, saved: 0 };
  for (const e of events) {
    if (!String(e.at).startsWith(month)) continue;
    const n = Number(e.qty) || 1;
    if (e.type === 'use') { out.used += n; out.saved += Math.min(n, Number(e.saved) || 0); }
    else if (WASTE.has(e.type)) { out.wasted += n; if (e.type === 'expired') out.expired += n; }
    else if (e.type === 'add') out.bought += n;
  }
  return out;
}

// Items added in the last `days` days, newest first (for "Recently added").
export function recent(items, { days = 7, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * DAY).toISOString();
  return items.filter(it => !it.archived && (it.createdAt || '') >= since).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// ---- since you last looked (Home) ------------------------------------------------------------------------------

const SINCE_TYPES = new Set(['add', 'use', 'discard', 'expired', 'open', 'freeze', 'thaw', 'unfreeze', 'level']);
// What the rest of the family did after `since` (an ISO time: when this phone last looked): history and shopping-list
// lines signed by someone for whom isMe(by) is false, newest first, as { by, type, name, qty, level?, at }.
export function sinceLast({ events = [], shop = [], since, isMe = () => false } = {}) {
  if (!since) return [];
  const out = [];
  for (const e of events) if (e.at > since && e.by && !isMe(e.by) && SINCE_TYPES.has(e.type)) out.push({ by: e.by, type: e.type, name: e.name, qty: Number(e.qty) || 1, level: e.level, at: e.at });
  for (const m of shop) if ((m.at || '') > since && m.by && !isMe(m.by)) out.push({ by: m.by, type: 'list', name: m.name, qty: 1, at: m.at });
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}
// One line of it, after the person's name: "bought 2 Fresh milk", "added Bananas to the shopping list".
export function sinceText(x) {
  const n = (x.qty > 1 ? `${x.qty} ` : '') + x.name;
  return {
    add: `bought ${n}`, use: `used up ${n}`, discard: `threw away ${n}`, expired: `threw away ${n} (expired)`, open: `opened ${x.name}`,
    freeze: `froze ${n}`, thaw: `thawed ${n}`, level: `marked ${x.name} ${x.level === 'out' ? 'as out' : x.level === 'low' ? 'as low' : 'as plenty'}`,
    list: `added ${x.name} to the shopping list`,
  }[x.type] || `changed ${x.name}`;
}
// "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago".
export function agoText(iso, now = new Date()) {
  const m = Math.max(0, Math.round((now - new Date(iso)) / 60000));
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / (24 * 60));
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

// ---- sharing as plain text (WhatsApp, Notes) ---------------------------------------------------------------------

// A WhatsApp link that opens a message with this text, for the person to pick the chat (no number, nothing sent by us).
export const waLink = text => 'https://wa.me/?text=' + encodeURIComponent(text);
// "Use this week" from Home's list: [{ item, date }] with a date formatter.
export function useWeekText(list, fmt = d => d) {
  return 'Use this week\n' + list.map(x => `- ${[x.item.brand, x.item.name].filter(Boolean).join(' ')}, by ${fmt(x.date)}`).join('\n');
}
// The shopping list as plain text to share (WhatsApp, Notes).
export function shareText(lines) {
  return 'Shopping list\n' + (lines.length ? lines.map(l => '- ' + l).join('\n') : '(nothing to buy)');
}

// ---- backups ---------------------------------------------------------------------------------------------------

// Items and shopping lines removed (Recently removed) travel with their markers; those removed more than 30 days ago are
// left out, with their history and photo.
export function keepLive(data, now = Date.now()) {
  const items = dropExpired(data.items, now), have = new Set(items.map(i => i.id)), gone = new Set((data.items || []).filter(i => !have.has(i.id)).map(i => i.id));
  return {
    ...data, items, shop: dropExpired(data.shop, now), places: dropExpired(data.places, now),
    events: (data.events || []).filter(e => !gone.has(e.itemId)),
    photos: (data.photos || []).filter(p => !gone.has(p.id)),
  };
}
export function backup(data, at = new Date().toISOString()) {
  const d = keepLive(data, new Date(at).getTime() || Date.now());
  return { app: 'pantry', v: 1, at, items: (d.items || []).map(plainItem), events: d.events || [], shop: d.shop || [], places: d.places || [], settings: d.settings || [], photos: d.photos || [] };
}
// Reads a backup file's text. Returns { items, events, shop, settings, photos } with only well-formed documents, or throws a plain
// message when the file is not a pantry backup.
export function parseBackup(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('That file is not a pantry backup.'); }
  if (!j || j.app !== 'pantry' || typeof j !== 'object') throw new Error('That file is not a pantry backup.');
  const ok = o => o && typeof o === 'object' && typeof o.id === 'string' && o.id && !o.id.includes('/');
  const out = {};
  for (const k of ['items', 'events', 'shop', 'places', 'settings', 'photos']) out[k] = Array.isArray(j[k]) ? j[k].filter(ok) : [];
  out.places = out.places.filter(p => typeof p.name === 'string' && p.name.trim() && Number.isFinite(p.order));   // one document a place (16 Oct 2026); older backups have none
  out.items = out.items.map(plainItem);   // either shape of batches in, an array with ids out
  { const k = keepLive(out); out.items = k.items; out.shop = k.shop; out.events = k.events; out.photos = k.photos; out.places = k.places; }   // removed more than 30 days ago: not brought back
  out.settings = out.settings.filter(isPlacesDoc);   // an older backup's one list of places (it becomes place documents when restored)
  out.photos = out.photos.filter(p => typeof p.data === 'string' && p.data.startsWith('data:image/'));
  return out;
}
