// Places: where things are kept ("Kept in"). Each household has its own ordered list, shared by the family. Since 16 Oct 2026
// (PR-C of "pantry sync safety") every place is ONE DOCUMENT, places/{id} = { id, name, order, updatedAt, removedAt?,
// removedBy? }, so renaming, reordering, adding and removing are field changes or new documents that two phones can do at
// once without overwriting each other (the old single list, settings/places = { id: 'places', list: [names], updatedAt }, was
// one document every phone wrote whole). The household's list is `placeEntries()`: its live place documents, by order, then
// name. A household that has no place documents yet shows its old list (or DEFAULT_PLACES), and the first change anyone
// makes writes the documents (seedDoc: ids from the name, so two phones doing it at once write the same documents). An item
// keeps its place as plain text (its name), so a place an item still uses always shows in the pickers and filters, even
// when it is not (or no longer) in the list ("not in your list"). Pure functions only, so test/places.test.mjs runs them in Node.
import { LOCATIONS } from './catalogue.js';

export const PLACES_ID = 'places';
export const MAX_PLACES = 40;      // the rules allow at most 40 places
export const MAX_NAME = 40;        // and at most 40 characters a name

// The catalogue's generic places, with the owner's three (16 Oct 2026) next to their kind.
export const DEFAULT_PLACES = (() => {
  const out = [...LOCATIONS];
  const after = (anchor, name) => out.splice(out.indexOf(anchor) + 1, 0, name);
  after('Fridge', 'Level 1 fridge');
  after('Freezer', 'Level 1 freezer');
  after('Store room', 'Basement store');
  return out;
})();

// A name as it is saved: spaces tidied, at most MAX_NAME characters.
export const cleanPlace = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
const key = s => cleanPlace(s).toLowerCase();

// ---- the old list, settings/places (still read; old phones still write it) ------------------------------------------------------

// The names in an old-style list document, or null when there is none (or it is empty or unreadable).
export function legacyNames(doc) {
  const l = Array.isArray(doc?.list) ? doc.list.filter(x => typeof x === 'string' && cleanPlace(x)) : null;
  return l && l.length ? l : null;
}
// Is this a well-formed old-style list document (an older backup's settings)?
export const isPlacesDoc = o => !!o && o.id === PLACES_ID && Array.isArray(o.list) && o.list.length > 0 && o.list.every(x => typeof x === 'string' && cleanPlace(x));

// ---- one document a place ------------------------------------------------------------------------------------------------------

// What two phones that migrate at once must agree on: the `updatedAt` of a document made from the old list. The rules accept
// a write with this time only as a new document, or as exactly what is already there, so a phone that was offline and still
// has the old list can never overwrite a place someone has renamed, moved or removed since (the real changes carry a real time).
export const SEED_AT = '1970-01-01T00:00:00.000Z';
const hash = s => { let h = 0x811c9dc5; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
// A document id made from a name (letters, digits, - and _; 35 characters at most): the same name gives the same id on every
// phone. The hash tells "Mum's room" from "Mums room".
export const placeId = name => {
  const k = key(name), slug = k.normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
  return `p-${slug || 'x'}-${hash(k)}`;
};
const gone = d => typeof d?.removedAt === 'string' && d.removedAt !== '';
// Is this a well-formed place document? (Anything else is ignored, never shown.)
export const isPlaceDoc = o => !!o && typeof o.id === 'string' && !!o.id && typeof o.name === 'string' && !!cleanPlace(o.name) && typeof o.order === 'number' && Number.isFinite(o.order);
const byOrder = (a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// The places made from a list of names, as entries that are not documents yet (`virtual`): orders 1, 2, 3, ...
const seedEntries = names => {
  const seen = new Set(), out = [];
  for (const n of names) { const k = key(n); if (k && !seen.has(k)) { seen.add(k); out.push({ id: placeId(n), name: cleanPlace(n), order: out.length + 1, dupes: [], virtual: true }); } }
  return out;
};
// What the household has said, or [] when it has said nothing: its live place documents (two with the same name, ignoring case,
// show once: the first by order; the others' ids are kept in `dupes`, so removing a place removes them all), else its old list.
function explicitEntries(docs, legacy) {
  const good = (docs || []).filter(isPlaceDoc);
  if (!good.length) { const l = legacyNames(legacy); return l ? seedEntries(l) : []; }
  const seen = new Map(), out = [];
  for (const d of good.filter(x => !gone(x)).sort(byOrder)) {
    const k = key(d.name);
    if (seen.has(k)) { seen.get(k).dupes.push(d.id); continue; }
    const e = { id: d.id, name: cleanPlace(d.name), order: d.order, dupes: [] };
    if (KINDS.includes(d.kind)) e.kind = d.kind;
    seen.set(k, e); out.push(e);
  }
  return out;
}
// The household's places, in order: [{ id, name, order, dupes, virtual? }]. The ONE door for reading places (app.js placeList()).
// With no place documents: the old list, else DEFAULT_PLACES (virtual: the first change writes them as documents). If every
// place has been removed (two phones removed the last two at once) the defaults show too, so the app is never without one.
export function placeEntries(docs, legacy) {
  const e = explicitEntries(docs, legacy);
  return e.length ? e : seedEntries(DEFAULT_PLACES);
}
// A virtual entry (or a made-up one) as the document it becomes. `at` is SEED_AT for the migration.
export const seedDoc = (e, at = SEED_AT) => ({ id: e.id, name: cleanPlace(e.name), order: e.order, updatedAt: at });
// A new place: a document under a new id, after the others (`id` is a fresh random one; two phones adding at once make two).
export const newPlaceDoc = (name, order, id, at = new Date().toISOString()) => ({ id, name: cleanPlace(name), order, updatedAt: at });
// Where a new place goes: after the last (the whole number above the highest order).
export const nextOrder = entries => (entries.length ? Math.floor(Math.max(...entries.map(e => e.order))) + 1 : 1);

// Moving a place one step up (-1) or down (+1), as the changes of `order` to send: [{ id, order }]. Normally ONE change: the
// place takes the midpoint between its new neighbours (or one beyond the end), so nothing else is rewritten and a rename or
// move on another phone is kept. When there is no room between the neighbours (equal orders, or a gap under 1e-6 after many
// moves) every place whose order differs from its new position is renumbered 1, 2, 3, ... (rare). [] when it can't move.
export const MIN_GAP = 1e-6;
export function reorder(entries, id, dir) {
  const i = entries.findIndex(e => e.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= entries.length) return [];
  const rest = entries.filter((_, k) => k !== i), lo = rest[j - 1], hi = rest[j];
  const order = lo && hi ? (lo.order + hi.order) / 2 : hi ? hi.order - 1 : lo.order + 1;
  if ((!lo || order - lo.order >= MIN_GAP) && (!hi || hi.order - order >= MIN_GAP)) return [{ id, order }];
  const moved = [...rest.slice(0, j), entries[i], ...rest.slice(j)];
  return moved.map((e, k) => ({ id: e.id, order: k + 1 })).filter((x, k) => moved[k].order !== x.order);
}

// Two sets of places as one (copying this phone's pantry into the family's, restoring a backup, merging two family pantries):
// the documents to WRITE into `base` so that it also has the places only `incoming` has, merged by name (ignoring case),
// after its own. Each side is { docs: [place documents], legacy: the old settings/places document or null }. If `base` only has
// the old list (or none) its places are written as documents first (SEED_AT, so a phone that already did leaves them alone).
// Removed places still inside their 30 days come across with their markers, unless the base has them or a live place of that
// name. [] when there is nothing to add.
export function mergeInto(base, incoming, at = new Date().toISOString()) {
  const bDocs = (base.docs || []).filter(isPlaceDoc), bEntries = explicitEntries(base.docs, base.legacy);
  const have = new Set(bEntries.map(e => key(e.name)));
  const add = [];
  const kinds = new Map();
  for (const e of explicitEntries(incoming.docs, incoming.legacy)) if (!have.has(key(e.name)) && !add.some(n => key(n) === key(e.name))) { add.push(e.name); if (e.kind) kinds.set(key(e.name), e.kind); }
  const carried = (incoming.docs || []).filter(d => isPlaceDoc(d) && gone(d) && !bDocs.some(b => b.id === d.id) && !have.has(key(d.name)));
  const room = Math.max(0, MAX_PLACES - bEntries.length), fresh = add.slice(0, room);
  if (!fresh.length && !carried.length) return [];
  const out = bDocs.length ? [] : bEntries.map(e => seedDoc(e));
  let order = Math.max(0, ...bEntries.map(e => e.order));
  for (const n of fresh) { order = Math.floor(order) + 1; out.push({ id: placeId(n), name: cleanPlace(n), order, updatedAt: at, ...(kinds.has(key(n)) ? { kind: kinds.get(key(n)) } : {}) }); }
  out.push(...carried.map(d => ({ ...d })));
  return out;
}

// Every place to offer: the list in its order, then any place an item uses that is not in it (in first-seen order).
// Returns { listed: [names], unlisted: [names] }. `extra` adds one more name (the form's current value).
export function allPlaces(list, items = [], extra = '') {
  const have = new Set(list.map(key)), unlisted = [];
  for (const p of [...items.map(i => i?.location), extra]) {
    const k = key(p);
    if (k && !have.has(k)) { have.add(k); unlisted.push(cleanPlace(p)); }
  }
  return { listed: [...list], unlisted };
}

// How many items use each place (by the exact name the item holds).
export function placeCounts(items = []) {
  const m = new Map();
  for (const it of items) if (it?.location) m.set(it.location, (m.get(it.location) || 0) + 1);
  return m;
}

// Why a new name can't be used ('' when it can). `except` is the place being renamed (it may change only its case).
export function placeProblem(list, name, except = null) {
  const n = cleanPlace(name);
  if (!n) return 'Type a name for the place.';
  if (String(name ?? '').replace(/\s+/g, ' ').trim().length > MAX_NAME) return `Keep it to ${MAX_NAME} characters.`;
  const clash = list.find(p => key(p) === key(n) && p !== except);
  if (clash) return `${clash} is already in your list.`;
  if (except == null && list.length >= MAX_PLACES) return `You can have up to ${MAX_PLACES} places.`;
  return '';
}

// The items that move from one place to another, as new item objects (the others are left out).
export function moveItems(items, from, to) {
  return items.filter(it => it.location === from).map(it => ({ ...it, location: cleanPlace(to) }));
}
// ---- kinds of place (21 Oct 2026, owner) ---------------------------------------------------------------------------------------
// A place is a fridge, a freezer or anything else. The kind is guessed from the name ("Level 1 freezer", "Chest freezer",
// "Ice box", "Chiller") and can be set in Settings, Places (`kind` on the place document; none means "guess"). Food moved into
// a freezer freezes, out of one thaws (logic.js moveFreezeOps); Freeze, Thaw and Leftovers go to a place of the right kind.
export const KINDS = ['fridge', 'freezer', 'other'];
export const KIND_LABELS = { fridge: 'Fridge', freezer: 'Freezer', other: 'Other (cupboard, shelf…)' };
export function guessKind(name) {
  const n = String(name || '');
  if (/\b(freezers?|freeze|frozen|ice ?box(es)?)\b/i.test(n)) return 'freezer';
  if (/\b(fridges?|refrigerators?|chillers?)\b/i.test(n)) return 'fridge';
  return 'other';
}
// A place's kind: what the household set on it, else the guess from its name. `entries` from placeEntries().
export function kindOf(name, entries = []) {
  const e = entries.find(x => key(x.name) === key(name));
  return e && KINDS.includes(e.kind) ? e.kind : guessKind(name);
}
// The places of a kind, in list order (names). `list` is names; `kinds` a name -> kind function (default: the guess).
export const placesOfKind = (list, kind, kinds = guessKind) => list.filter(p => kinds(p) === kind);
// The household's first place of a kind ('fridge', 'freezer'), else the generic name (Freeze moves a batch to the freezer,
// Thaw and Leftovers to the fridge).
export function placeOfKind(list, kind, kinds = guessKind) {
  return placesOfKind(list, kind, kinds)[0] || kind.charAt(0).toUpperCase() + kind.slice(1);
}
export const isFreezer = (name, kinds = guessKind) => !!name && kinds(name) === 'freezer';
