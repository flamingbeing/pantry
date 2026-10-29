// Pantry: the family's household inventory, on the shared kit (app-ui `@core/ui` and `@core/theme`, glue in js/ui.js).
// Screens are hash routes drawn by router (every screen and sheet is a history entry, so the iPhone edge swipe and
// Android back always work). Each screen is an HTML string drawn from the state S; clicks are handled by one listener
// reading data-act attributes. Data lives in one of three backends (store.js, cloud.js): this phone (IndexedDB),
// the family's shared pantry (Firestore), or memory only (demo mode, ?demo).
import * as L from './logic.js';
import { CATALOGUE, CATEGORIES, shelfDays, freezeDays, freezable, FROZEN_DAYS, THAW_DAYS } from './catalogue.js';
import * as P from './places.js';
import * as PP from './people.js';
import * as MG from './merge.js';
import * as SY from './sync.js';
import * as SEL from './select.js';
import * as O from './order.js';
import * as BI from './bulk-items.js';
import { startDrag } from './drag.js';
import { startUpdates, versionText } from './app-update.js';
import { openLocal, openMemory, prefs, KINDS, PHOTOS } from './store.js';
import { sampleData, demoBy, DEMO_FAMILY, DEMO_ME, DEMO_NAMES } from './sample.js';
import { openWelcome, viewGuide, welcomed, markWelcomed, installed } from './guide.js';
import { starterChoices, tourTasks } from './tour.js';
import { firebaseConfig } from '../config.js';
import {
  router, go as goTo, back as goBack, sheet, closeSheet, sheetOpen, confirm, toast, hideToast, stepper, stepperHtml, version,
  haptic, icon as kitIcon, esc, announce, largeTitle, deviceSwitch, sheetsSettled, syncButton, refusedList,
} from './ui.js';

const $ = (s, el = document) => el.querySelector(s);
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const EMULATOR = params.has('emulator') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const WELCOME = params.has('welcome');   // show the welcome even in the demo, or again

const S = {
  items: new Map(), events: new Map(), shop: new Map(), places: new Map(), settings: new Map(), pics: new Map(),
  backend: null, local: null, mode: DEMO ? 'demo' : 'local', cloud: null, user: null, household: null, pantries: [], lookupFailed: false, lost: null, creating: false, pending: null, localCount: 0,
  // this phone last had a family pantry open, and it isn't open again yet: the screens wait for it instead of showing this phone's
  // own (usually empty) pantry as "Nothing here yet" for the second or two the sign-in and family lookup take
  opening: !DEMO && !!prefs.get('household'),
  q: '', place: '', sort: prefs.get('sort', 'expiry'),
  sel: SEL.newSel(),   // Items: the items selected (by id), while selecting (select.js)
  bulk: null,   // the Bulk edit screen's state while it is open (filters, ticked items, the chosen changes, the step)
  dragging: false, gripQuiet: 0,   // a drag by the grip is going on (redraws wait); the click that follows a drag isn't a tap
  folded: new Set(prefs.get('folded', []) || []),   // place headings folded shut on Items (Group by place); per phone
  draft: null, dirty: false, pendingRender: false, syncError: false,
  refused: prefs.get('refused', []) || [],   // changes the family pantry refused, kept here until retried or discarded (sync.js)
  sync: { pending: 0, cache: false, since: 0, list: [], heard: 0, lastServerAt: 0, relistens: 0, cycles: 0 },   // changes this phone made that the server hasn't confirmed yet (list: each in words' records), and when the family last answered
  syncNow: { busy: false, result: null },   // the sync button's tap (Sync now) while it runs, and what it found
  lastUndo: null,
  removedNotes: prefs.get('removedNotes', {}) || {},   // items another phone removed that this phone had changes on: id -> removedAt (until Recently removed is opened)
  since: null,   // when this phone last looked (Since you last looked), an ISO time
  originTab: '#/', backLabel: 'Pantry',
};

// Product pictures: the photo, or a neutral kit icon for the category (no emoji).
const CAT_ICON = {
  'Sauces & condiments': 'bottle', 'Rice, noodles & grains': 'bowl', 'Canned & jarred': 'tin', 'Cooking & baking': 'jar',
  'Breakfast & spreads': 'jar', Drinks: 'cup', 'Dairy & eggs': 'carton', 'Bread & bakery': 'bread', 'Fresh produce': 'leaf',
  'Meat & seafood': 'fish', Frozen: 'snowflake', Snacks: 'cookie', Baby: 'heart', 'Laundry & cleaning': 'sparkle',
  'Kitchen & paper': 'roll', Toiletries: 'droplet', 'Medicine & first aid': 'pill', Pet: 'paw', Leftovers: 'bowl', Other: 'box',
};
const icon = (name, o) => kitIcon(name, o);
const chevron = () => icon('chevron-right', { cls: 'ui-row-chevron' });

// Names the family gave its members (settings/people, people.js), shared with everyone in the family pantry.
const names = () => PP.namesOf(S.settings.get(PP.PEOPLE_ID));
// This phone's Google account (in the demo, a made-up family member).
const me = () => S.user?.email || (DEMO ? DEMO_ME : '');
// How a person shows (history, added by, the shopping list): the family's name for them, else what was saved.
const nameOf = by => PP.label(names(), by);
// The name this phone signs changes with: the family's name for me, this phone's own, or my Google first name.
const who = () => (me() && names()[me()]) || prefs.get('name') || S.user?.name?.split(' ')[0] || '';
// What every list shows: items and shopping lines that are not removed (logic.js isRemoved). Removed ones stay in S.items /
// S.shop (so a change that lands on one is applied to it, and Recently removed can list it) but nowhere else.
const items = () => L.live(S.items.values()).filter(i => !i.archived);
const itemById = id => { const it = id && S.items.get(id); return it && !L.isRemoved(it) ? it : null; };
const shopLines = () => L.live(S.shop.values());
const liveEvents = () => L.liveEvents([...S.events.values()], [...S.items.values()]);
const eventsFor = id => [...S.events.values()].filter(e => e.itemId === id);
function eventsByItem() {
  const m = new Map();
  for (const e of S.events.values()) { if (!m.has(e.itemId)) m.set(e.itemId, []); m.get(e.itemId).push(e); }
  return m;
}
const today = () => L.ymd();
// How many days ahead Home's "Use soon" looks (Settings; per phone; two weeks as before).
const soonDays = () => Number(prefs.get('soonDays', 14)) || 14;
const SOON = { 3: '3 days', 7: '1 week', 14: '2 weeks' };
const soonText = () => SOON[soonDays()] || plural(soonDays(), 'day');
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const route = () => R?.route || { parts: [] };
const screen = () => route().parts[0] || 'home';

// ---- saving ----------------------------------------------------------------------------------------------------

// A whole document: a NEW item, a restore, an Edit of something that isn't an item. (An existing item is changed by
// instructions instead: patchItem, below.)
function save(kind, obj) {
  if (kind === 'items') {
    obj = { ...L.normalizeItem(obj), _arr: false, updatedAt: new Date().toISOString(), updatedBy: who() };
    if (obj.photo === '') delete obj.photo;   // left by older versions; pictures are `thumb` + photos/<id> now
  }
  S[kind].set(obj.id, obj);
  S.backend.put(kind, obj);
  return obj;
}
function remove(kind, id) {
  S[kind].delete(id);
  S.backend.del(kind, id);
}
// Changing an existing item (logic.js: "changes as instructions"): do `ops` to this phone's copy at once, and send the same
// ops, never the whole item, so a copy that is a moment out of date can't overwrite what someone else just did. Stamps
// who changed it and when, as fields too. Returns the ops sent (for Undo), or null when the item is gone.
function patchItem(id, ops, { stamp = true } = {}) {
  const before = S.items.get(id);
  if (!before) return null;
  const sent = stamp ? L.mergeOps(ops, { set: { updatedAt: new Date().toISOString(), updatedBy: who() } }) : ops;
  if (stamp) touch(id);
  S.items.set(id, L.applyOps(before, sent));
  S.backend.patch('items', id, sent, { before });
  return sent;
}
// The same for many items (moving every item from one place to another): one write to the family pantry.
function patchMany(list, { stamp = true } = {}) {
  const at = new Date().toISOString(), by = who(), sent = [];
  if (stamp) touchMany(list.map(x => x.id));
  for (const { id, ops } of list) {
    const before = S.items.get(id); if (!before) continue;
    const full = stamp ? L.mergeOps(ops, { set: { updatedAt: at, updatedBy: by } }) : ops;
    S.items.set(id, L.applyOps(before, full));
    sent.push({ id, ops: full, before });
  }
  if (S.backend.patchMany) Promise.resolve(S.backend.patchMany('items', sent)).catch(err => { S.syncError = S.cloud ? S.cloud.explain(err, 'Saving') : 'Saving didn’t work.'; redraw(); });
  return sent;
}
// ---- removing without losing (logic.js): a marker, never a delete; Recently removed puts it back ------------------------

// Remove an item (or shopping line): `removedAt` and `removedBy`, as instructions, so a use or an edit another phone sends
// meanwhile still lands on it, hidden, and never brings it back. Put it back = clear both. Neither stamps the item
// (`removedBy` already says who).
const removeItem = id => patchItem(id, L.removeOps(who()), { stamp: false });
const restoreItem = id => patchItem(id, L.restoreOps(), { stamp: false });
// A shopping line is changed the same way, by field (never rewritten whole from a copy that may be a moment out of date).
function patchLine(id, ops) {
  const before = S.shop.get(id);
  if (!before) return null;
  S.shop.set(id, L.applyFieldOps(before, ops));
  S.backend.patch('shop', id, ops, { before });
  return ops;
}
function patchLines(list) {
  const sent = [];
  for (const { id, ops } of list) {
    const before = S.shop.get(id); if (!before) continue;
    S.shop.set(id, L.applyFieldOps(before, ops));
    sent.push({ id, ops, before });
  }
  if (S.backend.patchMany) Promise.resolve(S.backend.patchMany('shop', sent)).catch(err => { S.syncError = S.cloud ? S.cloud.explain(err, 'Saving') : 'Saving didn’t work.'; redraw(); });
  return sent;
}
// Any other small document (a place, the names) changed the same way: by field, never rewritten whole from a copy. A document this
// phone doesn't have yet is made by the change itself (the backends merge the fields into whatever is there).
function patchDoc(kind, id, ops) {
  const before = S[kind].get(id) || null;
  S[kind].set(id, L.applyFieldOps(before || { id }, ops));
  S.backend.patch(kind, id, ops, { before });
  return ops;
}
const removeLine = id => patchLine(id, L.removeOps(who()));
const restoreLine = id => patchLine(id, L.restoreOps());
// A new line: whole, under a new random id (so two phones adding the same words make two lines; duplicates are tolerated).
const LINE_MAX = 80;   // the rules' limit on a line's text
const newLine = (name, itemId) => save('shop', { id: L.uid(), name: String(name).slice(0, LINE_MAX), itemId: itemId || null, done: false, at: new Date().toISOString(), by: who().slice(0, 100) });

// This phone's own changes to an item, kept on the phone (item id -> when), to tell "my change landed on something another
// phone had already removed" from "someone removed it after I used it".
const touched = () => prefs.get('touched', {}) || {};
function touch(id) {
  if (S.mode !== 'cloud') return;
  const t = { ...touched(), [id]: new Date().toISOString() }, keys = Object.keys(t);
  if (keys.length > 200) for (const k of keys.sort((a, b) => (t[a] < t[b] ? -1 : 1)).slice(0, keys.length - 200)) delete t[k];
  prefs.set('touched', t);
}
function touchMany(ids) {
  if (S.mode !== 'cloud' || !ids.length) return;
  const at = new Date().toISOString(), t = { ...touched() };
  for (const id of ids) t[id] = at;
  const keys = Object.keys(t);
  if (keys.length > 200) for (const k of keys.sort((a, b) => (t[a] < t[b] ? -1 : 1)).slice(0, keys.length - 200)) delete t[k];
  prefs.set('touched', t);
}
// An item turned up removed (another phone removed it) and this phone has changes on it that came at or after the removal,
// or still waiting to be sent: say so on Home until Recently removed is opened.
function noteLanded(it, pending = false) {
  if (S.mode !== 'cloud' || !L.isRemoved(it)) return;
  if (S.removedNotes[it.id] === it.removedAt || (prefs.get('removedSeen', {}) || {})[it.id] === it.removedAt) return;
  const t = touched()[it.id];
  if (!pending && !(t && t >= it.removedAt)) return;
  S.removedNotes = { ...S.removedNotes, [it.id]: it.removedAt };
  prefs.set('removedNotes', S.removedNotes);
}
// The notes still true: the item is still removed, and since the same removal.
const landedItems = () => Object.entries(S.removedNotes).map(([id, at]) => S.items.get(id)).filter(it => it && L.isRemoved(it) && S.removedNotes[it.id] === it.removedAt);
function noteSeen() {
  if (!Object.keys(S.removedNotes).length) return;
  prefs.set('removedSeen', { ...(prefs.get('removedSeen', {}) || {}), ...S.removedNotes });
  S.removedNotes = {}; prefs.del('removedNotes');
}

// Many whole documents at once (restore, copying): one batch to the family pantry.
function saveMany(kind, list) {
  const at = new Date().toISOString(), by = who();
  const out = list.map(o => {
    if (kind !== 'items') return o;
    const x = { ...L.normalizeItem(o), _arr: false, updatedAt: at, updatedBy: by };
    if (x.photo === '') delete x.photo;
    return x;
  });
  for (const o of out) S[kind].set(o.id, o);
  if (S.backend.putMany) S.backend.putMany(kind, out).catch(err => { S.syncError = S.cloud.explain(err, 'Saving'); redraw(); });
  else for (const o of out) S.backend.put(kind, o);
  return out;
}

// ---- places (places.js): the household's own ordered list, one document a place, shared with the family ---------------------

// The ONE door for reading places (like items(): a removed place never shows): the household's live place documents by order,
// then name; with none yet, its old list (settings/places) or the defaults, as entries that aren't documents yet (`virtual`).
// An entry is { id, name, order, dupes, virtual? }. Every screen that lists, picks or matches places comes through here.
const placeList = () => P.placeEntries([...S.places.values()], S.settings.get(P.PLACES_ID));
const placeNames = () => placeList().map(e => e.name);
const placeByName = name => placeList().find(e => e.name === name) || null;
// A place's kind (places.js): what the family set in Places, else the guess from its name.
const kindOfPlace = name => P.kindOf(name, placeList());
const inFreezer = it => P.isFreezer(it?.location, kindOfPlace);
// Moving an item to another place: into a freezer its food freezes, out of one it thaws (logic.js moveFreezeOps). `tally`
// counts the units, for the message.
function placeOps(it, to, tally = null) {
  const r = L.moveFreezeOps(it, { fromFreezer: inFreezer(it), toFreezer: P.isFreezer(to, kindOfPlace), food: freezable(it), freezeDays: freezeDays(it), thawDays: THAW_DAYS, today: today() });
  if (tally) { tally.frozen += r.frozen; tally.thawed += r.thawed; }
  return r.ops;
}
const tallyText = t => [t.frozen ? `${t.frozen} frozen (keeps a year)` : '', t.thawed ? `${t.thawed} thawed (use within ${plural(THAW_DAYS, 'day')})` : ''].filter(Boolean).join(', ');
// Recently removed shows the removed places (within their 30 days), newest removal first.
const removedPlaces = () => L.recentlyRemoved([...S.places.values()]);
// Every place to offer, the list's order first, then places items still use that aren't in it.
const placeChoices = (extra = '') => P.allPlaces(placeNames(), items(), extra);
const defaultPlace = () => { const l = placeNames(); return l.includes('Kitchen cabinet') ? 'Kitchen cabinet' : l[0]; };
// A change to place documents, by field: stamps updatedAt (a real time: the rules treat SEED_AT specially), changes this
// phone's copy at once and sends the same fields. `list`: [{ id, ops }].
function patchPlaces(list) {
  const at = new Date().toISOString(), sent = [];
  for (const { id, ops } of list) {
    const before = S.places.get(id); if (!before) continue;
    const full = L.mergeOps(ops, { set: { updatedAt: at } });
    S.places.set(id, L.applyFieldOps(before, full));
    sent.push({ id, ops: full, before });
  }
  if (!sent.length) return sent;
  if (S.backend.patchMany) Promise.resolve(S.backend.patchMany('places', sent)).catch(err => { S.syncError = S.cloud ? S.cloud.explain(err, 'Saving') : 'Saving didn’t work.'; redraw(); });
  return sent;
}
// Before the first change to places in a household that has no place documents yet: write the ones it is showing (its old list
// or the defaults) as documents, ids from the names and a fixed time, so two phones doing this at once write the same
// documents, and one that was offline can't overwrite a change made since (the rules: places.js SEED_AT). The write isn't
// waited for; if the server turns it down, someone already made them and this phone's copy follows the server.
function materializePlaces() {
  const virt = placeList().filter(e => e.virtual);
  if (!virt.length) return;
  const fresh = virt.filter(e => !S.places.has(e.id)).map(e => P.seedDoc(e));
  for (const d of fresh) S.places.set(d.id, d);
  if (fresh.length && S.backend.putMany) S.backend.putMany('places', fresh).catch(() => { /* another phone made them first */ });
  else for (const d of fresh) S.backend.put('places', d);
  // every place was removed and the defaults are showing: bring those documents back
  patchPlaces(virt.filter(e => S.places.has(e.id) && L.isRemoved(S.places.get(e.id))).map(e => ({ id: e.id, ops: L.restoreOps() })));
}
// A new place, after the others, under a new random id (two phones adding at once make two).
function addPlace(name) {
  materializePlaces();
  const doc = P.newPlaceDoc(name, P.nextOrder(placeList()), L.uid());
  S.places.set(doc.id, doc);
  S.backend.put('places', doc);
  return doc;
}
const placeIds = e => [e.id, ...(e.dupes || [])];
// Remove a place (a marker, like an item: Recently removed puts it back) and put it back.
const removePlace = e => { materializePlaces(); patchPlaces(placeIds(e).map(id => ({ id, ops: L.removeOps(who()) }))); };
const restorePlaces = ids => patchPlaces(ids.map(id => ({ id, ops: L.restoreOps() })));
// Rename a place's own document (items kept there move separately: renamePlace).
const renamePlaceDoc = (e, to) => { materializePlaces(); patchPlaces([{ id: e.id, ops: { set: { name: P.cleanPlace(to) }, inc: {}, del: [] } }]); };
// Move a place one step: normally one field of one document.
function movePlace(e, dir) {
  materializePlaces();
  const sets = P.reorder(placeList(), e.id, dir);
  patchPlaces(sets.map(x => ({ id: x.id, ops: { set: { order: x.order }, inc: {}, del: [] } })));
  return sets.length;
}
// A <select>'s options: the list, then "Not in your list" for any other place in use (or the form's own value).
function placeOptions(value) {
  const { listed, unlisted } = placeChoices(value);
  const opt = x => `<option${x === value ? ' selected' : ''}>${esc(x)}</option>`;
  return listed.map(opt).join('') + (unlisted.length ? `<optgroup label="Not in your list">${unlisted.map(opt).join('')}</optgroup>` : '');
}
// ---- photos (photo.js): a tiny `thumb` on the item for every list; the photo itself in photos/<item id>, read only
// when the item is opened (cached here, keyed by the thumb it belongs to, so a family member's new photo is fetched).
// Items from before 16 Oct 2026 may still carry the whole photo as `photo`: shown as it is until migratePhotos() moves it.

const thumbSrc = it => it.thumb || it.photo || '';
function bestPic(it) {
  if (it.photo) return it.photo;
  const c = S.pics.get(it.id);
  return c && c.thumb === (it.thumb || '') && c.data ? c.data : it.thumb || '';
}
const fetching = new Set();
function wantPhoto(it) {
  if (!it.hasPhoto || it.photo || fetching.has(it.id)) return;
  const ver = it.thumb || '', c = S.pics.get(it.id);
  if (c && c.thumb === ver) return;
  fetching.add(it.id);
  Promise.resolve().then(() => S.backend.get(PHOTOS, it.id)).then(doc => {
    S.pics.set(it.id, { thumb: ver, data: doc?.data || null });
    const img = document.getElementById('pa-hero');
    if (doc?.data && img && img.dataset.id === it.id) img.src = doc.data;
  }, () => { /* no signal: the thumbnail stays; tried again next time */ }).finally(() => fetching.delete(it.id));
}
function savePhoto(id, thumb, data) {
  S.pics.set(id, { thumb, data });
  return S.backend.put(PHOTOS, { id, data, updatedAt: new Date().toISOString() });
}
function delPhoto(id) {
  S.pics.delete(id);
  S.backend.del(PHOTOS, id);
}
async function photoOf(it) {
  if (!it.hasPhoto) return null;
  const c = S.pics.get(it.id);
  if (c?.data) return c.data;
  // not fetched yet: ask, but never hold up a delete for long (no signal)
  const got = Promise.resolve().then(() => S.backend.get(PHOTOS, it.id)).then(d => d?.data || null, () => null);
  return Promise.race([got, new Promise(r => setTimeout(() => r(null), 1500))]);
}
// An old-style item (whole photo inside it) as { item, doc }: the item with a thumbnail, and its photos document.
// null when the picture can't be read.
async function splitOld(it) {
  try {
    const { picturesFromData } = await import('./photo.js');
    const p = await picturesFromData(it.photo);
    const item = { ...it, thumb: p.thumb, hasPhoto: true };
    delete item.photo;
    return { item, doc: { id: it.id, data: p.photo, updatedAt: new Date().toISOString() } };
  } catch { return null; }
}
// Before copying or restoring into the family pantry (whose rules refuse old-style photos): split every old-style item.
async function splitAll(data) {
  const have = new Set(data.photos.map(p => p.id));
  data.items = await Promise.all(data.items.map(async it => {
    if (it.photo === '' || (it.photo && typeof it.photo !== 'string')) { const x = { ...it }; delete x.photo; return x; }
    if (!it.photo) return it;
    const s = await splitOld(it);
    if (!s) { const x = { ...it }; delete x.photo; return x; }   // an unreadable picture is left behind
    if (!have.has(it.id)) data.photos.push(s.doc);
    return s.item;
  }));
  return data;
}
// Moves old-style photos out of their items, quietly, a few a second: the photo is written first, and only once it is
// saved does the item lose its `photo` (so a photo is never lost). Runs again whenever items load or change.
let migrating = false;
async function migratePhotos() {
  if (migrating) return;
  migrating = true;
  let moved = 0;
  try {
    const skip = new Set();
    for (;;) {
      const it = [...S.items.values()].find(i => typeof i.photo === 'string' && i.photo && !skip.has(i.id));
      if (!it) break;
      const backend = S.backend;
      const s = await splitOld(it);
      if (!s) { skip.add(it.id); continue; }   // unreadable: left as it is
      if ((await backend.put(PHOTOS, s.doc)) === false) { skip.add(it.id); continue; }
      if (backend !== S.backend) break;   // signed in or out meanwhile: done on the next load
      const cur = S.items.get(it.id);
      if (cur && cur.photo === it.photo) {
        // only the picture fields change (the item itself may have been changed by someone meanwhile)
        const ops = { set: { thumb: s.item.thumb, hasPhoto: true }, inc: {}, del: ['photo'] };
        S.pics.set(cur.id, { thumb: s.item.thumb, data: s.doc.data });
        patchItem(cur.id, ops, { stamp: false });
        moved++;
      }
      await new Promise(r => setTimeout(r, 300));
    }
  } finally { migrating = false; }
  if (moved) redraw();
}

// Apply a stock change from logic.js ({ item, event, ops }) and offer Undo. The change is sent as instructions; Undo sends the
// opposite instructions (an add taken back, a field put back only if nobody has changed it since), never the old copy.
function apply(res, msg) {
  if (!res.event) { toast('Nothing in stock to do that with'); return null; }
  const id = res.item.id, before = S.items.get(id);
  const sent = patchItem(id, res.ops);
  if (!sent) { toast('That item is gone'); return null; }
  save('events', res.event);
  redraw();
  const undo = () => { const inv = undoItem(id, sent, before); remove('events', res.event.id); redraw(); announce('Undone'); return { ops: inv, event: res.event }; };
  S.lastUndo = undo;
  toast(msg, { action: 'Undo', onAction: undo });
  return { ops: sent, event: res.event };
}
// Take back `sent` (done to `before`) on item `id` as it is now.
function undoItem(id, sent, before) {
  const now = S.items.get(id); if (!now) return null;
  const inv = L.invertOps(sent, before, now);
  return L.opsEmpty(inv) ? null : patchItem(id, inv);
}

// ---- small pieces --------------------------------------------------------------------------------------------------

function thumb(it, cls = 'ui-row-thumb') {
  const src = thumbSrc(it);
  return src ? `<img class="${cls}" src="${esc(src)}" alt="">` : `<span class="${cls}">${icon(CAT_ICON[it.category] || 'box')}</span>`;
}
// '24th Oct 26': the date in full (the Items list toggle), always with the year.
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
function longDate(ymd) {
  const d = L.parseYmd(ymd);
  return d ? `${ordinal(d.getDate())} ${d.toLocaleDateString('en-GB', { month: 'short' })} ${String(d.getFullYear()).slice(-2)}` : '';
}
function badge(date, { full = false } = {}) {
  const b = L.shortLabel(date, today());
  if (!b.text) return '';
  if (full) return `<span class="ui-badge"${{ bad: ' data-tone="danger"', warn: ' data-tone="warn"' }[b.tone] || ''}>${esc(longDate(date))}</span>`;
  const tone = { bad: ' data-tone="danger"', warn: ' data-tone="warn"' }[b.tone] || '';
  return `<span class="ui-badge"${tone}>${esc(b.text)}</span>`;
}
const LEVEL_WORD = { plenty: 'Plenty', low: 'Low', out: 'Out' };
// A stock change that means "bought more": a count gets a batch; a staple goes back to Plenty.
const restock = (it, { qty = 1, expiry = null } = {}) => (L.isStaple(it) ? L.setLevel(it, { level: 'plenty', by: who() }) : L.addStock(it, { qty, expiry, by: who() }));
const subOf = it => [it.brand, it.size].filter(Boolean).map(esc).join(' · ');
const gripIcon = () => `<svg class="pa-grip-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>`;
// `grip`: the Items list: a real button after the row, 44 px, that drags the item (or, with a tap, opens its Move sheet).
function itemRow(it, { sub, trail, select = false, grip = false, sel = null, attr = 'sel' } = {}) {
  const q = L.totalQty(it), staple = L.isStaple(it);
  const s = sub ?? [staple ? LEVEL_WORD[L.levelOf(it)] : q ? `${q} left` : 'None left', esc(it.location || '')].filter(Boolean).join(' · ');
  const t = trail ?? (staple ? '' : badge(L.nextUseBy(it), { full: screen() === 'items' && prefs.get('fullDates', false) === true }));
  const body = `${thumb(it)}
    <span class="ui-row-main"><span class="pa-row-title">${esc(it.name)}</span>${s ? `<span class="ui-row-sub">${s}</span>` : ''}</span>
    ${t ? `<span class="ui-row-trail">${t}</span>` : ''}`;
  // selecting: the row is a label around a real checkbox (the whole row is the target; no link to open)
  if (select) {
    const on = SEL.isSel(sel || S.sel, it.id);
    return `<li data-id="${esc(it.id)}"${grip ? ' class="pa-li"' : ''}><label class="ui-row pa-item pa-item--sel${on ? ' is-selected' : ''}"><input type="checkbox" class="pa-${attr}" id="pa-${attr}-${esc(it.id)}" data-${attr}="${esc(it.id)}"${on ? ' checked' : ''}>${body}</label>${grip ? gripBtn(it) : ''}</li>`;
  }
  return `<li data-id="${esc(it.id)}"${grip ? ' class="pa-li"' : ''}><a class="ui-row pa-item" href="#/item/${esc(it.id)}" draggable="false">${body}${grip ? '' : chevron()}</a>${grip ? gripBtn(it) : ''}</li>`;
}
const gripBtn = it => `<button type="button" class="pa-grip" id="pa-grip-${esc(it.id)}" data-act="grip" data-id="${esc(it.id)}" aria-label="Reorder or move ${esc(it.name)}">${gripIcon()}</button>`;
function section(title, body, { count = '', action = '', footer = '', id = '' } = {}) {
  const hid = 'h-' + (id || title.toLowerCase().replace(/[^a-z]+/g, '-'));
  return `<section class="ui-section" aria-labelledby="${hid}"><h2 class="ui-section-head" id="${hid}"><span>${esc(title)}</span>${action || (count !== '' ? `<span class="pa-num">${count}</span>` : '')}</h2>${body}${footer ? `<p class="ui-section-foot">${footer}</p>` : ''}</section>`;
}
function fmt(ymd) {
  const d = L.parseYmd(ymd);
  if (!d) return ymd || '';
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
const fmtTime = iso => fmt(L.ymd(new Date(iso)));
function quickDates() {
  const t = today();
  return [['1 week', L.addDays(t, 7)], ['1 month', L.addDays(t, 30)], ['3 months', L.addDays(t, 91)], ['6 months', L.addDays(t, 182)], ['1 year', L.addDays(t, 365)]];
}
// How long, in words: 5 days, 1 week, 3 weeks, 6 months, 2 years.
function daysText(d) {
  if (d === 7) return '1 week';
  if (d < 14) return plural(d, 'day');
  if (d < 60) return plural(Math.round(d / 7), 'week');
  if (d < 330) return plural(Math.round(d / 30.4), 'month');
  return plural(Math.round(d / 365), 'year');
}
// A guessed best-before date from how long a product usually keeps (catalogue.js): { days, date, label } or null.
// In a freezer it keeps as long as frozen food does.
function guessFor(x) {
  const days = inFreezer(x) && x.category !== 'Frozen' && shelfDays(x) !== null ? freezeDays(x) : shelfDays(x);
  return days ? { days, date: L.addDays(today(), days), label: `About ${daysText(days)}` } : null;
}
// The quick dates under a date field; a guess comes first (selected while it is the date), with a line saying so.
const dateChips = (name, value, guess = null) => `<div class="pa-datebox"><div class="ui-chips pa-dates" data-wrap="on" role="group" aria-label="Quick dates" data-for="${name}">${
  guess ? `<button type="button" class="ui-chip pa-guess" aria-pressed="${guess.date === value}" data-act="date" data-v="${guess.date}">${esc(guess.label)}</button>` : ''}${
  quickDates().filter(([, v]) => !guess || v !== guess.date).map(([l, v]) =>
  `<button type="button" class="ui-chip" aria-pressed="${v === value}" data-act="date" data-v="${v}">${l}</button>`).join('')}<button type="button" class="ui-chip" aria-pressed="false" data-act="date" data-v="">No date</button></div>${
  guess ? `<p class="pa-field-hint pa-guess-hint">${esc(guess.label)} is a guess from how long it usually keeps. Change it to the date on the pack.</p>` : ''}</div>`;
const shopQuery = it => [it.brand, it.name].filter(Boolean).join(' ').replace(/\(.*?\)/g, '').trim();
const onList = id => shopLines().some(m => m.itemId === id && !m.done);

// ---- the bar ----------------------------------------------------------------------------------------------------

function setBar({ title = '', lead = '', trail = '', solid = false }) {
  $('#bar-title').textContent = title;
  $('#bar-lead').innerHTML = lead;
  $('#bar-trail').innerHTML = trail;
  $('.ui-bar').classList.toggle('pa-bar--solid', solid);
}
const backBtn = label => `<button type="button" class="pa-bar-btn pa-back" data-act="back">${icon('chevron-left')}<span>${esc(label)}</span></button>`;
const textBtn = (label, act, extra = '') => `<button type="button" class="pa-bar-btn" data-act="${act}"${extra}>${esc(label)}</button>`;
const iconBtn = (name, label, act) => `<button type="button" class="pa-bar-btn" data-act="${act}" aria-label="${esc(label)}">${icon(name)}</button>`;
// New item: the one primary action, top right (not a tab)
const addBtn = () => `<button type="button" class="pa-bar-btn ui-primary" data-act="go-add" aria-label="Add an item">${icon('plus')}<span>Add</span></button>`;

// ---- Home -------------------------------------------------------------------------------------------------------

function statusLine() {
  if (S.mode === 'demo') return 'Demo with made-up items. Nothing is saved.';
  if (S.mode === 'cloud') {
    if (!navigator.onLine) return 'Offline. Changes reach the family when there’s signal.';
    const n = S.household?.members?.length || 1;
    return n > 1 ? `Shared with ${plural(n - 1, 'other person', 'other people')}` : 'Shared family pantry';
  }
  return 'Saved on this phone';
}
// What an empty screen shows while the family pantry is still opening.
const openingCard = () => `<div class="ui-card ui-empty" role="status"><span class="ui-empty-icon">${icon('box')}</span><p class="ui-empty-title">Opening the family pantry…</p></div>`;
function viewHome() {
  const all = items();
  let h = `<h1 class="ui-large-title">Pantry</h1><p class="pa-large-sub">${esc(statusLine())}</p><div id="refused-list"></div>`;
  h += viewLost();
  if (S.syncError) h += `<div class="pa-panel pa-alert" role="status">${icon('alert')}<span>Some changes didn’t reach the family pantry. ${esc(S.syncError)}</span></div>`;
  if (S.mode === 'cloud' && S.pantries.length > 1) h += `<a class="pa-panel pa-alert" href="#/settings">${icon('alert')}<span>You’re in more than one family pantry. Merge them in Settings.</span></a>`;
  h += viewLanded();
  h += viewTour();
  h += viewSince();
  if (!all.length && S.opening) return h + openingCard();
  if (!all.length) {
    return h + `<div class="ui-card ui-empty">
      <span class="ui-empty-icon">${icon('box')}</span>
      <p class="ui-empty-title">Nothing here yet</p>
      <p class="ui-empty-text">Add what’s in the fridge and cupboards. The pantry then shows what to use first and what to buy.</p>
      <button type="button" class="ui-fill" data-act="start">Pick what you have</button>
      <button type="button" class="ui-tint" data-act="go-add">Add one item</button>
      <button type="button" class="ui-plain" data-act="sample">Try it with sample items</button>
      <a class="ui-plain" href="#/guide">How to use the pantry</a>
    </div>`;
  }
  const t = today();
  const exp = L.expiring(all, { days: soonDays(), today: t });
  const expired = exp.filter(x => x.date < t), soon = exp.filter(x => x.date >= t);
  const buy = L.toBuy(all, eventsByItem());
  const listed = new Set(exp.map(x => x.item.id));
  const opened = all.filter(it => !listed.has(it.id) && (it.batches || []).some(b => b.openedAt && b.qty > 0));
  const m = L.monthStats(liveEvents(), t.slice(0, 7));
  h += `<div class="pa-btn-row pa-quickrow"><button type="button" class="ui-tint" data-act="leftovers">${icon('bowl')}Leftovers</button><button type="button" class="ui-tint" data-act="scan-many">${icon('barcode')}Scan many</button></div>`;
  h += `<div class="ui-stats" aria-label="Summary">
    <div class="ui-stat"><span class="ui-stat-value">${expired.length}</span><span class="ui-stat-label">Expired</span></div>
    <div class="ui-stat"><span class="ui-stat-value">${soon.length}</span><span class="ui-stat-label">Use soon</span></div>
    <div class="ui-stat"><span class="ui-stat-value">${buy.length}</span><span class="ui-stat-label">To buy</span></div>
  </div>`;
  if (expired.length) h += section('Expired', `<ul class="ui-list">${expired.map(x => itemRow(x.item)).join('')}</ul>`, { count: expired.length, footer: 'Used it or binned it? Open the item and tap Used 1 or Bin 1.' });
  h += section('Use soon', soon.length ? `<ul class="ui-list">${soon.map(x => itemRow(x.item)).join('')}</ul>` : '', { count: soon.length || '', footer: soon.length ? `Within the next ${soonText()}.` : `Nothing runs out of date in the next ${soonText()}.` });
  const week = soon.filter(x => L.daysBetween(t, x.date) <= 7);
  if (week.length) {
    h += `<p class="pa-share-line"><a class="ui-tint" id="pa-wa-week" href="${esc(L.waLink(L.useWeekText(week, fmt)))}" target="_blank" rel="noopener">${icon('share')}Send “use this week” on WhatsApp<span class="pa-sr"> (opens WhatsApp)</span></a></p>`;
  }
  if (opened.length) h += section('Opened', `<ul class="ui-list">${opened.map(it => itemRow(it)).join('')}</ul>`, { count: opened.length });
  if (buy.length) {
    h += section('Running low', `<ul class="ui-list">${buy.slice(0, 5).map(b => itemRow(b.item, { sub: esc(L.whyText(b, t)), trail: '' })).join('')}</ul>`,
      { id: 'low', action: `<a href="#/shop">Shopping list</a>`, footer: buy.length > 5 ? `${buy.length - 5} more on the shopping list.` : '' });
  }
  h += section('This month', `<ul class="ui-list">
    <li><div class="ui-row"><span class="ui-row-lead">${icon('check')}</span><span class="ui-row-main"><span class="pa-row-title">Used up</span></span><span class="ui-row-value">${m.used}</span></div></li>
    <li><div class="ui-row"><span class="ui-row-lead" data-tone="grey">${icon('cart')}</span><span class="ui-row-main"><span class="pa-row-title">Bought</span></span><span class="ui-row-value">${m.bought}</span></div></li>
    <li><div class="ui-row"><span class="ui-row-lead">${icon('clock')}</span><span class="ui-row-main"><span class="pa-row-title">Used before expiry</span></span><span class="ui-row-value">${m.saved}</span></div></li>
    <li><div class="ui-row"><span class="ui-row-lead" data-tone="danger">${icon('trash')}</span><span class="ui-row-main"><span class="pa-row-title">Thrown away</span>${m.expired ? `<span class="ui-row-sub">${m.expired} past ${m.expired === 1 ? 'its' : 'their'} date</span>` : ''}</span><span class="ui-row-value">${m.wasted}</span></div></li>
  </ul>`, { id: 'month' });
  return h;
}

// The family pantry this phone was showing is gone (deleted or merged away, or this account was taken out of it): say so plainly,
// with Try again (asks the server which pantry this account is in now).
function viewLost() {
  if (!S.lost) return '';
  return `<div class="pa-panel pa-alert pa-lost" id="pa-lost" role="status">${icon('alert')}<span><strong>Your pantry changed.</strong> The family pantry you were using is gone, or this account isn’t in it any more.
    ${S.lost.failed ? 'There’s no signal to check right now.' : 'This phone is showing its own pantry for now.'}
    <button type="button" class="ui-tint" data-size="small" data-act="hh-check">Try again</button></span></div>`;
}

// This phone's change landed on an item another phone had removed: it is kept, hidden, and Recently removed has it.
function viewLanded() {
  const list = landedItems();
  if (!list.length) return '';
  const text = list.length === 1 ? `${list[0].name}: this was removed on another phone; find it in Recently removed. Your change is kept.`
    : `${plural(list.length, 'item')} you changed were removed on another phone; find them in Recently removed. Your changes are kept.`;
  return `<a class="pa-panel pa-note" id="pa-landed" href="#/removed">${icon('info')}<span>${esc(text)}</span></a>`;
}

// ---- since you last looked: what the rest of the family did since this phone last opened the pantry ----------------

function viewSince() {
  if (S.mode === 'local') return '';   // on this phone only, everything is this phone's
  const mine = who();
  const list = L.sinceLast({ events: liveEvents(), shop: shopLines(), since: S.since, isMe: by => nameOf(by) === mine });
  if (!list.length) return '';
  const row = x => `<li><div class="ui-row"><span class="ui-row-lead" data-tone="grey">${icon('user')}</span><span class="ui-row-main"><span class="pa-row-title">${esc(nameOf(x.by))} ${esc(L.sinceText(x))}</span><span class="ui-row-sub">${esc(L.agoText(x.at))}</span></span></div></li>`;
  return section('Since you last looked', `<ul class="ui-list pa-since">${list.slice(0, 5).map(row).join('')}</ul>`,
    { id: 'since', count: list.length, footer: `${list.length > 5 ? `And ${list.length - 5} more. ` : ''}<button type="button" class="ui-plain pa-since-ok" data-act="since-ok">Got it</button>` });
}
// This phone looked: remember when (per phone), so the next open shows only what happened after.
function looked() { S.since = new Date().toISOString(); prefs.set('lastSeen', S.since); }

// ---- first steps (tour.js): the Getting started checklist and the quick start --------------------------------------

const tourOn = () => prefs.get('tour') === 'on';
const flags = () => prefs.get('tourFlags', {}) || {};
function flag(k) { if (!tourOn() || flags()[k]) return; prefs.set('tourFlags', { ...flags(), [k]: true }); }
function tasks() {
  const sharing = !S.cloud?.configured ? 'none' : (S.household?.members?.length || 0) > 1 ? 'in' : 'out';
  return tourTasks({ items: items(), events: [...S.events.values()], flags: flags(), installed: installed(), sharing });
}
function viewTour() {
  if (!tourOn()) return '';
  const list = tasks(), done = list.filter(t => t.done).length;
  if (done === list.length) {
    return section('Getting started', `<div class="ui-card pa-tour-done"><p class="ui-card-title">All set</p>
      <p class="ui-card-text">You know your way around. The guide in Settings has the rest.</p>
      <button type="button" class="ui-tint" data-act="tour-hide">Hide this</button></div>`, { id: 'tour' });
  }
  const row = t => `<li><div class="ui-row pa-tour-row${t.done ? ' is-done' : ''}">
      <span class="pa-tour-mark" aria-hidden="true">${t.done ? icon('check') : ''}</span>
      <span class="ui-row-main"><span class="pa-row-title">${esc(t.title)}<span class="pa-sr">${t.done ? ', done' : ', to do'}</span></span><span class="ui-row-sub">${esc(t.sub)}</span></span>
      ${t.done ? '' : `<span class="ui-row-trail"><button type="button" class="ui-tint" data-size="small" data-act="tour-show" data-task="${t.id}" aria-label="Show me: ${esc(t.title)}">Show me</button></span>`}
    </div></li>`;
  return section('Getting started', `<ul class="ui-list pa-tour">${list.map(row).join('')}</ul>
    <p class="pa-tour-foot"><button type="button" class="ui-plain" data-act="tour-hide">Hide this list</button></p>`,
    { id: 'tour', count: `${done} of ${list.length}` });
}
// Point at a button on the screen just drawn: scroll it into view, ring it for a few seconds, focus it.
function spotlight(sel) {
  setTimeout(() => {
    const el = $(sel); if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.classList.add('pa-spot');
    el.focus({ preventScroll: true });
    setTimeout(() => el.classList.remove('pa-spot'), 4500);
  }, 400);
}
function showMe(task) {
  if (task === 'stock') return openStarter();
  if (task === 'say') return openQuick();
  if (task === 'use') {
    const all = items().filter(it => L.totalQty(it) > 0);
    const first = L.expiring(all, { days: 3650 })[0]?.item || all[0];
    if (!first) { toast('Add something first'); return openStarter(); }
    goTo('#/item/' + first.id);
    return spotlight('[data-act="use"]');
  }
  if (task === 'shop') { goTo('#/shop'); return spotlight('#pa-shop-text'); }
  if (task === 'install') {
    return sheet({
      title: 'On your home screen', closeLabel: 'Done', grey: true,
      body: `<ul class="ui-list">
        <li><div class="ui-row"><span class="ui-row-lead">${icon('share')}</span><span class="ui-row-main"><span class="pa-row-title">iPhone</span><span class="ui-row-sub">In Safari, tap Share (the square with an arrow), then Add to Home Screen.</span></span></div></li>
        <li><div class="ui-row"><span class="ui-row-lead">${icon('plus')}</span><span class="ui-row-main"><span class="pa-row-title">Android</span><span class="ui-row-sub">In Chrome, tap the menu (three dots), then Add to home screen or Install app.</span></span></div></li>
      </ul><p class="ui-section-foot">It then opens like an app, full screen, and works without signal.</p>`,
      onClose: () => { flag('installSeen'); afterSheet(); redraw(); },
    });
  }
  if (task === 'family') {
    goTo('#/settings');
    return spotlight('[data-act="signin"], [data-act="hh-create"], #pa-member-email');
  }
}
function openStarter() {
  const choices = starterChoices();
  const have = new Set(items().map(it => L.norm(`${it.brand} ${it.name}`)));
  const groups = [...new Set(choices.map(c => c.group))];
  const chip = c => {
    const at = have.has(L.norm(`${c.cat.brand} ${c.cat.name}`));
    return `<button type="button" class="ui-chip" aria-pressed="false" data-k="${esc(c.key)}"${at ? ' disabled' : ''}>${esc(c.cat.name.replace(/ \(.*\)$/, ''))}${at ? ' <span class="ui-chip-badge">at home</span>' : ''}</button>`;
  };
  const s = sheet({
    title: 'What do you have?', closeLabel: 'Cancel', grey: true, detent: 'large',
    body: `<p class="pa-text pa-start-intro">Tap the everyday things you have at home. Each goes in with a rough best-before date, which you can change on the item.</p>
      ${groups.map((g, i) => `<section class="ui-section" aria-labelledby="pa-sg-${i}"><h3 class="ui-section-head" id="pa-sg-${i}">${esc(g)}</h3>
        <div class="ui-chips pa-start-chips" data-wrap="on" role="group" aria-labelledby="pa-sg-${i}">${choices.filter(c => c.group === g).map(chip).join('')}</div></section>`).join('')}
      <p class="ui-section-foot">Not here? Add it afterwards with + or the microphone.</p>`,
    footer: `<button type="button" class="ui-fill ui-wide" id="pa-start-go" disabled>Add items</button>`,
    onClose: afterSheet,
  });
  const go = $('#pa-start-go', s.el);
  const picked = () => [...s.el.querySelectorAll('.pa-start-chips [aria-pressed="true"]')].map(b => choices.find(c => c.key === b.dataset.k));
  s.el.addEventListener('click', e => {
    const b = e.target.closest('.pa-start-chips .ui-chip');
    if (!b || b.disabled) return;
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    const n = picked().length;
    go.disabled = !n; go.textContent = n ? `Add ${plural(n, 'item')}` : 'Add items';
  });
  go.addEventListener('click', async () => {
    const list = picked(); if (!list.length) return;
    const added = [];
    for (const { cat, days } of list) {
      const base = { id: L.uid(), batches: [], createdAt: new Date().toISOString(), createdBy: who(), name: cat.name, brand: cat.brand, size: cat.size,
        category: cat.category, location: cat.location, openDays: cat.openDays ?? null, lowAt: 0, barcode: '' };
      const res = L.addStock(base, { qty: 1, expiry: days ? L.addDays(today(), days) : null, by: who() });
      save('items', res.item); added.push({ id: base.id, ev: save('events', res.event).id });
    }
    await closeSheet(s.el);
    if (screen() !== 'home') goTo('#/', { replace: screen() === 'add' }); else redraw();
    toast(`Added ${plural(added.length, 'item')}`, { action: 'Undo', onAction: () => { for (const a of added) { removeItem(a.id); remove('events', a.ev); } redraw(); announce('Undone'); } });
  });
  return s;
}

// ---- Items ------------------------------------------------------------------------------------------------------

// How the list is sorted. 'category', 'place' and 'myorder' put the items under headings (My order: under their category, in the order
// the family set by dragging, order.js); the others are one flat list.
// My order is a way of ordering WITHIN each category (the owner: "per category only"), so it is a second choice that appears under
// Category rather than a fifth segment: five labels don't fit one row at 320 to 390 px.
const SORTS = [['expiry', 'Use by'], ['name', 'Name'], ['category', 'Category'], ['place', 'Place']];
const sortMode = () => (SORTS.some(([v]) => v === S.sort) ? S.sort : 'expiry');   // a saved 'myorder' falls back to expiry; Category is plain by name now
const topSort = () => sortMode();   // the segment that is on
function viewItems() {
  const all = items();
  const { listed, unlisted } = placeChoices();
  const places = [...listed, ...unlisted].filter(l => all.some(i => i.location === l));
  if (S.place && !places.includes(S.place)) S.place = '';
  const chip = (v, label, n) => `<button type="button" class="ui-chip" aria-pressed="${S.place === v}" data-act="place" data-v="${esc(v)}"${v ? ` data-place="${esc(v)}"` : ''}>${esc(label)} <span class="ui-chip-badge">${n}</span></button>`;
  const seg = (v, label) => `<label class="pa-seg"><input type="radio" name="pa-sort" id="pa-sort-${v}" value="${v}"${topSort() === v ? ' checked' : ''}><span>${label}</span></label>`;
  const full = prefs.get('fullDates', false) === true;
  return `<div class="pa-titlerow"><h1 class="ui-large-title">Items</h1>
    <button type="button" class="ui-chip pa-datetoggle" aria-pressed="${full}" data-act="dates-toggle" aria-label="Show use-by dates in full">Dates</button></div>
    <div class="ui-search" role="search">${icon('search')}
      <input type="search" id="pa-q" placeholder="Search the pantry" aria-label="Search the pantry" autocomplete="off" value="${esc(S.q)}">
      <button type="button" class="pa-search-clear" data-act="q-clear" aria-label="Clear search">${icon('close')}</button></div>
    <div class="ui-chips" role="group" aria-label="Where it’s kept">${chip('', 'All', all.length)}${places.map(p => chip(p, p, all.filter(i => i.location === p).length)).join('')}</div>
    <fieldset class="ui-segmented"><legend>Sort by</legend>${SORTS.map(([v, l]) => seg(v, l)).join('')}</fieldset>
    <div id="pa-items-list"${full ? ' class="pa-fulldates"' : ''}>${itemsList()}</div>`;
}
// What the search and the place chips let through (the whole result: Select all means this, not just the rows drawn).
function filteredItems() {
  return items().filter(i => (!S.place || i.location === S.place) && (!S.q || L.score(S.q, `${i.name} ${i.brand} ${i.category} ${i.barcode || ''}`)));
}
const byUseBy = (a, b) => { const x = L.nextUseBy(a) || '9999', y = L.nextUseBy(b) || '9999'; return x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name); };
function sortedItems(list) {
  const l = [...list];
  if (sortMode() === 'category') l.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));
  else if (sortMode() === 'myorder') l.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || O.compareOrder(a, b));
  else if (sortMode() === 'name') l.sort((a, b) => a.name.localeCompare(b.name));
  else l.sort(byUseBy);   // by use-by date (and, grouped by place, within each place)
  return l;
}
// The headings, as [{ key, title, items, place? , fold? }], or null for a flat list. Place headings follow the household's
// order of places (then any place items still use that isn't in it, then "No place").
function itemGroups(list) {
  const mode = sortMode();
  if (mode === 'category' || mode === 'myorder') {
    const groups = new Map();
    for (const it of list) { const c = it.category || 'Other'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(it); }
    return [...groups].map(([c, l], i) => ({ key: 'cat:' + c, hid: 'h-cat-' + i, title: c, cat: c, items: l }));
  }
  if (mode === 'place') {
    const { listed, unlisted } = placeChoices();
    const by = new Map();
    for (const it of list) { const k = it.location || ''; if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
    const order = [...listed, ...unlisted, ''].filter(k => by.has(k));
    return [...new Set([...order, ...by.keys()])].map((k, i) => ({ key: 'place:' + k, hid: 'h-place-' + i, title: k || 'No place', place: k, fold: true, items: by.get(k) }));
  }
  return null;
}
function groupSection(g) {
  const folded = g.fold && S.folded.has(g.key), n = g.items.length;
  const sel = S.sel.on ? `<button type="button" class="pa-selthese" data-act="sel-group" data-g="${esc(g.key)}">${esc(selTheseText(g))}</button>` : '';
  const title = g.fold
    ? `<button type="button" class="pa-fold" data-act="fold" data-g="${esc(g.key)}" id="pa-fold-${esc(g.hid)}" aria-expanded="${!folded}" aria-controls="pa-list-${esc(g.hid)}">${icon('chevron-right', { cls: 'pa-fold-icon' })}<span class="pa-fold-name">${esc(g.title)}</span></button>`
    : `<span>${esc(g.title)}</span>`;
  return `<section class="ui-section pa-group" ${g.place ? `data-place="${esc(g.place)}" ` : ''}${g.cat !== undefined ? `data-cat="${esc(g.cat)}" ` : ''}aria-labelledby="${esc(g.hid)}"><h2 class="ui-section-head pa-grouphead" id="${esc(g.hid)}">${title}<span class="pa-num">${n}</span>${sel}</h2>${
    folded ? '' : `<ul class="ui-list" id="pa-list-${esc(g.hid)}">${g.items.map(it => itemRow(it, { select: S.sel.on, grip: true })).join('')}</ul>`}</section>`;
}
const selTheseText = g => (SEL.groupState(S.sel, g.items.map(i => i.id)) === 'all' ? `Unselect these ${g.items.length}` : `Select these ${g.items.length}`);
function itemsList() {
  const all = items();
  SEL.pruneSel(S.sel, all.map(i => i.id));   // what another phone deleted drops out of the selection
  const list = sortedItems(filteredItems());
  if (!list.length) {
    if (!all.length && S.opening) return openingCard();
    return all.length
      ? `<div class="ui-empty"><span class="ui-empty-icon">${icon('search')}</span><p class="ui-empty-title">Nothing found</p><p class="ui-empty-text">No items match. Try another word or place.</p></div>`
      : `<div class="ui-card ui-empty"><span class="ui-empty-icon">${icon('box')}</span><p class="ui-empty-title">No items yet</p><p class="ui-empty-text">Add what’s at home to start.</p><button type="button" class="ui-fill" data-act="go-add">Add an item</button></div>`;
  }
  const groups = itemGroups(list);
  if (!groups) return section(plural(list.length, 'item'), `<ul class="ui-list">${list.map(i => itemRow(i, { select: S.sel.on, grip: true })).join('')}</ul>`, { id: 'items' });
  return groups.map(groupSection).join('');
}
function drawItemsList() {
  const el = $('#pa-items-list'); if (!el) return;
  const keep = el.contains(document.activeElement) ? document.activeElement.id : '';
  el.innerHTML = itemsList();
  if (keep) document.getElementById(keep)?.focus({ preventScroll: true });
  updateSelUI();
}

// ---- selecting items (select.js): a Select button, a press and hold, rows with checkboxes, a bar above the tab bar -----------------

// Start selecting, with `id` already ticked (a press and hold) or nothing (the Select button). The selection is a history entry
// (like a sheet), so Back, the iPhone swipe and Escape leave it.
function enterSelect(id = '') {
  if (S.sel.on || screen() !== 'items') return;
  SEL.startSel(S.sel, id);
  history.pushState({ ...(history.state || {}), paSelect: true, uiTransient: 1 }, '', location.href);
  redraw();
  announce(`Selecting. ${S.sel.ids.size} selected. Tap items to select them.`);
  (id && document.getElementById('pa-sel-' + id) || $('.pa-sel'))?.focus({ preventScroll: true });
}
function exitSelect({ pop = true } = {}) {
  if (!S.sel.on) return;
  SEL.endSel(S.sel);
  if (pop && history.state?.paSelect) history.back();
  redraw();
}
// The selected items that still exist, in the list's order.
const selectedItems = () => SEL.chosen(S.sel, items());
function selBarHTML() {
  const btn = (act, label, cls = '') => `<button type="button" class="${cls}" data-act="${act}">${label}</button>`;
  return `<div class="pa-selbar-inner"><div class="pa-selbar-row"><span class="pa-selcount" id="pa-selcount" role="status" aria-live="polite"></span>
      <span class="pa-selbar-links"><button type="button" class="ui-plain" data-act="sel-all">Select all</button><button type="button" class="ui-plain" data-act="sel-none">Select none</button><button type="button" class="ui-plain" data-act="sel-done">Done</button></span></div>
    <div class="pa-selbar-acts" role="group" aria-label="What to do with the selected items">${btn('sel-move', 'Move to…', 'ui-tint')}${btn('sel-list', 'Shopping list', 'ui-tint')}${btn('sel-delete', 'Delete', 'ui-tint ui-danger')}</div></div>`;
}
// The bar exists only while selecting on Items. Its buttons keep their place while the numbers change (updateSelUI).
function drawSelBar() {
  const on = S.sel.on && screen() === 'items';
  document.body.classList.toggle('pa-selecting', on);
  let el = $('#pa-selbar');
  if (!on) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'pa-selbar'; el.className = 'pa-selbar';
    el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Selected items');
    el.innerHTML = selBarHTML();
    document.body.append(el);
  }
  updateSelUI();
}
// After any change to the selection: the count (how many are hidden by the filter), the checkboxes, the headings' buttons and the
// actions (off with nothing selected). Never replaces a button, so focus stays where it is.
function updateSelUI() {
  if (!S.sel.on) return;
  const shown = new Set(filteredItems().map(i => i.id)), n = S.sel.ids.size;
  const hidden = [...S.sel.ids].filter(id => !shown.has(id)).length;
  const c = $('#pa-selcount'); if (c) { const t = SEL.selText(n, hidden); if (c.textContent !== t) c.textContent = t; }
  for (const b of document.querySelectorAll('#pa-selbar [data-act="sel-move"], #pa-selbar [data-act="sel-list"], #pa-selbar [data-act="sel-delete"]')) b.setAttribute('aria-disabled', String(n === 0));
  for (const i of document.querySelectorAll('input.pa-sel')) {
    const on = SEL.isSel(S.sel, i.dataset.sel);
    if (i.checked !== on) i.checked = on;
    i.closest('.pa-item')?.classList.toggle('is-selected', on);
  }
  const groups = itemGroups(sortedItems(filteredItems())) || [];
  for (const b of document.querySelectorAll('[data-act="sel-group"]')) {
    const g = groups.find(x => x.key === b.dataset.g); if (g) b.textContent = selTheseText(g);
  }
}
// A change to the selection from a checkbox or a button.
function selChanged() { updateSelUI(); }
// An action is done: stop selecting (the items have moved or gone), redraw.
function finishBulk() { SEL.endSel(S.sel); if (history.state?.paSelect) history.back(); redraw(); }

// ---- the three actions on the selection: each ONE batch of changes and ONE toast with Undo that only touches what nobody has
// changed since ("2 changed since, left as they are").

// Take back a batch (`sent`: what patchMany returned): each item gets the inverse of what was done to it, only if nobody has
// changed those fields since (logic.js invertOps). `liveOnly`: an item removed since counts as changed (not for undoing a delete).
function undoBatch(sent, { liveOnly = true, lines = [] } = {}) {
  const back = [];
  let changed = 0, undone = 0;
  // shopping lines a bulk edit added: one another phone has ticked or removed since is left as it is
  const mine = lines.filter(m => { const now = S.shop.get(m.id); return now && !L.isRemoved(now) && !now.done; });
  if (mine.length) patchLines(mine.map(m => ({ id: m.id, ops: L.removeOps(who()) })));
  changed += lines.length - mine.length; undone += mine.length;
  for (const x of sent) {
    const now = S.items.get(x.id);
    const inv = now && (!liveOnly || !L.isRemoved(now)) ? L.invertOps(x.ops, x.before, now) : null;
    if (inv && !L.opsEmpty(inv)) back.push({ id: x.id, ops: inv });
    // changed since: nothing could be put back, or only some of what was done (another phone changed one of the fields)
    const want = Object.keys(x.ops.set || {}).filter(k => k !== 'updatedAt' && k !== 'updatedBy').length + (x.ops.del || []).length + Object.keys(x.ops.inc || {}).length;
    const got = inv ? Object.keys(inv.set || {}).length + (inv.del || []).length + Object.keys(inv.inc || {}).length : 0;
    if (got < want) changed++;
  }
  if (back.length) patchMany(back);
  redraw();
  const msg = `${back.length || undone ? 'Undone' : 'Nothing to undo'}${changed ? `: ${changed} changed since, left as ${changed === 1 ? 'it is' : 'they are'}` : ''}`;
  toast(msg); announce(msg);
}
// The move itself: one batch, nothing for an item that is already there. { place, sent, same }.
function moveItems(list, to) {
  const place = P.cleanPlace(to), todo = list.filter(it => it.location !== place), tally = { frozen: 0, thawed: 0 };
  const sent = todo.length ? patchMany(todo.map(it => ({ id: it.id, ops: L.mergeOps(placeOps(it, place, tally), { set: { location: place } }) }))) : [];
  return { place, sent, same: list.length - todo.length, tally };
}
function bulkMove(list, to) {
  finishBulk();
  const { place, sent, same, tally } = moveItems(list, to);
  if (!sent.length) { toast(`Already in ${place}`); return; }
  redraw();
  const cold = tallyText(tally);
  const msg = (sent.length === 1 && !same ? `${S.items.get(sent[0].id)?.name || 'Item'} moved to ${place}` : `${plural(sent.length, 'item')} moved to ${place}${same ? ` (${same} already there)` : ''}`) + (cold ? `: ${cold}` : '');
  toast(msg, { action: 'Undo', onAction: () => undoBatch(sent) }); announce(msg);
}
function bulkToList(list) {
  const fresh = list.filter(it => !onList(it.id)), already = list.length - fresh.length;
  finishBulk();
  if (!fresh.length) { toast(list.length === 1 ? 'Already on the shopping list' : 'All of them are already on the shopping list'); return; }
  const at = new Date().toISOString(), by = who().slice(0, 100);
  const lines = saveMany('shop', fresh.map(it => ({ id: L.uid(), name: [it.brand, it.name].filter(Boolean).join(' ').slice(0, LINE_MAX), itemId: it.id, done: false, at, by })));
  redraw();
  const msg = `${plural(lines.length, 'item')} on the shopping list${already ? ` (${already} already there)` : ''}`;
  toast(msg, { action: 'Undo', onAction: () => {
    // a line another phone has ticked or removed since is left as it is
    const gone = lines.filter(m => { const now = S.shop.get(m.id); return now && !L.isRemoved(now) && !now.done; });
    if (gone.length) patchLines(gone.map(m => ({ id: m.id, ops: L.removeOps(who()) })));
    redraw();
    const left = lines.length - gone.length, t = `Undone${left ? `: ${left} changed since, left as ${left === 1 ? 'it is' : 'they are'}` : ''}`;
    toast(t); announce(t);
  } });
  announce(msg);
}
function bulkDelete(list) {
  finishBulk();
  const sent = patchMany(list.map(it => ({ id: it.id, ops: L.removeOps(who()) })));
  redraw();
  const msg = `${plural(sent.length, 'item')} deleted`;
  toast(msg, { action: 'Undo', onAction: () => undoBatch(sent, { liveOnly: false }) }); announce(msg);
}
// Move to…: the place picker as a sheet (a radio list; the button names how many move).
function openMoveTo(list) {
  const { listed, unlisted } = placeChoices();
  const counts = P.placeCounts(items());
  const here = new Set(list.map(it => it.location));
  const row = (p, i) => `<li><label class="ui-row"><input type="radio" name="pa-moveto" value="${esc(p)}" id="pa-moveto-${i}"><span class="ui-row-main"><span class="pa-row-title">${esc(p)}</span><span class="ui-row-sub">${esc(plural(counts.get(p) || 0, 'item'))} there${here.size === 1 && here.has(p) ? ' · where they are now' : ''}</span></span></label></li>`;
  const all = [...listed, ...unlisted];
  const s = sheet({
    title: `Move ${plural(list.length, 'item')}`, closeLabel: 'Cancel', grey: true,
    body: `<fieldset class="pa-moveto"><legend class="pa-sr">Move to which place?</legend><ul class="ui-list">${all.map(row).join('')}</ul></fieldset>`,
    footer: `<button type="button" class="ui-fill ui-wide" id="pa-moveto-go" aria-disabled="true">Choose a place</button>`,
    onClose: afterSheet,
  });
  const go = $('#pa-moveto-go', s.el);
  s.el.addEventListener('change', e => {
    if (e.target.name !== 'pa-moveto') return;
    go.setAttribute('aria-disabled', 'false'); go.textContent = `Move ${plural(list.length, 'item')} to ${e.target.value}`;
  });
  go.addEventListener('click', async () => {
    const v = $('input[name="pa-moveto"]:checked', s.el)?.value;
    if (!v) return;
    closeSheet(s.el);   // (not awaited: the write lands now, as the sheet goes)
    bulkMove(list.filter(it => S.items.has(it.id) && itemById(it.id)), v);
  });
  return s;
}
// ---- My order, and dragging by the grip (order.js, drag.js) ---------------------------------------------------------------------

const catOf = it => it.category || 'Other';
const groupOf = it => items().filter(x => catOf(x) === catOf(it));   // an item's category, every item (the filters don't matter to the order)
// Put item `id` just after `afterId` (null: first) in its category: ONE field on ONE item, or, when there is no room (or the items
// have no numbers yet), a renumbering of the category in one batch. No stamp: moving isn't changing. { sent, plan } or null.
function commitOrder(id, afterId) {
  const it = itemById(id); if (!it) return null;
  const plan = O.planMove(groupOf(it), id, afterId);
  if (!plan.sets.length) return null;
  const sent = patchMany(plan.sets.map(x => ({ id: x.id, ops: { set: { order: x.order }, inc: {}, del: [] } })), { stamp: false });
  return { sent, plan, cat: catOf(it) };
}
// One step up or down (the buttons, the arrow keys): { moved, text } with what to say.
function moveStep(id, dir) {
  const it = itemById(id); if (!it) return null;
  const cat = catOf(it), to = O.stepTarget(groupOf(it), id, dir);
  if (to === undefined) return { moved: false, text: `${it.name} is already ${dir < 0 ? 'first' : 'last'} in ${cat}` };
  const r = commitOrder(id, to);
  const p = O.positionOf(groupOf(it), id);
  return { moved: !!r, ...r, text: `${it.name} moved ${dir < 0 ? 'up' : 'down'}: ${p.index + 1} of ${p.count} in ${cat}` };
}
// The sheet behind a grip, for anyone who isn't dragging (a tap, Enter or Space on the grip): Move up and Move down in My order,
// and Move to… in every sort. The result is spoken each time.
function openGrip(id) {
  const it = itemById(id); if (!it) return;
  const ord = sortMode() === 'myorder', cat = catOf(it);
  const pos = () => { const p = O.positionOf(groupOf(it), id); return `${p.index + 1} of ${p.count} in ${cat}`; };
  const btn = (g, title, sub, dis = false) => `<li><button type="button" class="ui-row" data-tone="action" data-g="${g}"${dis ? ' aria-disabled="true"' : ''}><span class="ui-row-main"><span class="pa-row-title">${title}</span><span class="ui-row-sub" ${g === 'to' ? '' : `id="pa-grip-sub-${g}"`}>${sub}</span></span></button></li>`;
  const first = () => O.positionOf(groupOf(it), id).index === 0, last = () => { const p = O.positionOf(groupOf(it), id); return p.index === p.count - 1; };
  const s = sheet({
    title: it.name, closeLabel: 'Done', grey: true,
    body: `<ul class="ui-list">${ord ? btn('up', 'Move up', esc(pos()), first()) + btn('down', 'Move down', esc(pos()), last()) : ''}${btn('to', 'Move to…', `Now in ${esc(it.location || 'no place')}`)}</ul>`,
    onClose: afterSheet,
  });
  const refresh = () => {
    const u = $('[data-g="up"]', s.el), d = $('[data-g="down"]', s.el); if (!u) return;
    u.setAttribute('aria-disabled', String(first())); d.setAttribute('aria-disabled', String(last()));
    for (const sub of s.el.querySelectorAll('[id^="pa-grip-sub-"]')) sub.textContent = pos();
  };
  s.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-g]'); if (!b || b.getAttribute('aria-disabled') === 'true') return;
    if (b.dataset.g === 'to') { await closeSheet(s.el); return openMoveTo([it]); }
    const r = moveStep(id, b.dataset.g === 'up' ? -1 : 1);
    if (r) { announce(r.text); refresh(); }
  });
  return s;
}
// A drag from a grip (drag.js). A grip of a ticked row, while selecting, carries every ticked item. It can be dropped on a place
// (a heading or section in Group by place, or one of the place chips at the top) to move, and in My order within its category
// to reorder. The ghost says which, and where.
function onGripDown(e) {
  const grip = e.target.closest?.('.pa-grip'); if (!grip || screen() !== 'items') return;
  const id = grip.dataset.id, it = itemById(id); if (!it) return;
  const ids = S.sel.on && SEL.isSel(S.sel, id) ? selectedItems().map(x => x.id) : [id];
  const many = ids.length > 1, ord = sortMode() === 'myorder' && !many;
  const nameOf2 = i => S.items.get(i)?.name || 'item';
  const hit = (x, y, under) => {
    const t = under?.closest?.('[data-place]');
    if (t) {
      const place = t.dataset.place, movers = ids.map(itemById).filter(i => i && i.location !== place);
      if (!movers.length) return { key: 'own', tip: `Already in ${place}`, drop: null };   // its own heading isn't a target
      return { key: 'place:' + place, el: t, tip: many ? `Move ${ids.length} items to ${place}` : `Move to ${place}`, drop: { place } };
    }
    if (ord) {
      const sec = [...document.querySelectorAll('section[data-cat]')].find(c => c.dataset.cat === catOf(it)), list = sec?.querySelector('ul.ui-list');
      if (list) {
        const lr = list.getBoundingClientRect();
        if (y >= lr.top - 24 && y <= lr.bottom + 24 && x >= lr.left - 24 && x <= lr.right + 24) {
          const all = [...list.querySelectorAll('li[data-id]')], rows = all.filter(li => li.dataset.id !== id);
          const idx = rows.filter(li => { const r = li.getBoundingClientRect(); return r.top + r.height / 2 < y; }).length;
          const afterId = idx > 0 ? rows[idx - 1].dataset.id : null;
          const own = all.findIndex(li => li.dataset.id === id), prevId = own > 0 ? all[own - 1].dataset.id : null;
          const at = idx < rows.length ? rows[idx].getBoundingClientRect().top : rows.length ? rows[rows.length - 1].getBoundingClientRect().bottom : lr.top;
          const same = afterId === prevId;
          return { key: 'ord:' + (afterId || ''), tip: same ? 'Stays here' : afterId ? `After ${nameOf2(afterId)}` : `First in ${catOf(it)}`, line: same ? null : { y: at, left: lr.left, width: lr.width }, drop: same ? null : { afterId } };
        }
      }
    }
    return { key: 'none', tip: ord ? 'Drop in the list to reorder, or on a place to move' : 'Drop on a place to move it', drop: null };
  };
  S.dragging = true;
  startDrag(e, {
    handle: grip,
    ghost: many ? null : grip.closest('li'),
    text: many ? `${ids.length} items` : '',
    hit, haptic: () => haptic('tick'),
    suppressClick: () => { S.gripQuiet = Date.now() + 500; },
    onDrop: d => {
      if (d.place) { const list = ids.map(itemById).filter(Boolean); bulkMove(list, d.place); return; }
      const r = commitOrder(id, d.afterId);
      if (!r) return;
      redraw();
      const msg = d.afterId ? `${it.name} moved after ${nameOf2(d.afterId)}` : `${it.name} moved to the top of ${catOf(it)}`;
      toast(msg, { action: 'Undo', onAction: () => undoBatch(r.sent) }); announce(msg);
    },
    onEnd: () => { S.dragging = false; afterSheet(); },
  });
}
// What the bar's actions do with the items as they are now.
function selAction(act) {
  const list = selectedItems();
  if (!list.length) { toast('Select some items first'); return; }
  if (act === 'sel-move') return openMoveTo(list);
  if (act === 'sel-list') return bulkToList(list);
  if (act === 'sel-delete') return bulkDelete(list);
}

// ---- Bulk edit (#/bulk; bulk-items.js): pick items, choose what to change (every field starts Unchanged), Review, Save ONE batch -----

const bulkState = () => (S.bulk ||= { q: '', place: '', cat: '', sel: SEL.newSel(), ch: BI.none(), step: 'edit', plan: null });
function openBulk(ids = []) {
  S.bulk = null; const b = bulkState();
  SEL.startSel(b.sel); SEL.setMany(b.sel, ids, true);
  goTo('#/bulk');
}
// What the filters let through (the same search and place chips as Items, plus a category), by name.
function bulkFiltered() {
  const b = bulkState();
  return items().filter(i => (!b.place || i.location === b.place) && (!b.cat || (i.category || 'Other') === b.cat) && (!b.q || L.score(b.q, `${i.name} ${i.brand} ${i.category} ${i.barcode || ''}`)))
    .sort((a, c) => a.name.localeCompare(c.name));
}
const bulkChosen = () => SEL.chosen(bulkState().sel, items());
function bulkList() {
  const b = bulkState(), list = bulkFiltered();
  SEL.pruneSel(b.sel, items().map(i => i.id));
  if (!list.length) return `<div class="ui-empty"><span class="ui-empty-icon">${icon('search')}</span><p class="ui-empty-title">Nothing found</p><p class="ui-empty-text">No items match. Try another word, place or category.</p></div>`;
  return `<ul class="ui-list">${list.map(i => itemRow(i, { select: true, sel: b.sel, attr: 'bsel' })).join('')}</ul>`;
}
function bulkChanges() {
  const ch = bulkState().ch, { listed, unlisted } = placeChoices();
  const sel = (id, label, value, opts, extra = '') => `<div class="pa-bk-field"><label class="pa-field"><span class="pa-field-label">${label}</span><select id="pa-bk-${id}" data-bk="${id}">${opts.map(([v, t]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>${extra}</div>`;
  const placeOpts = [['', 'Choose a place…'], ...[...listed, ...unlisted].map(p => [p, p])];
  const catOpts = [['', 'Choose a category…'], ...CATEGORIES.map(c => [c, c])];
  const x = ch.expiry;
  return `${sel('place', 'Place', ch.place ? 'set' : '', [['', 'Unchanged'], ['set', 'Move to…']],
      ch.place ? `<label class="pa-field"><span class="pa-field-label">Move to</span><select id="pa-bk-place-to" data-bk="place-to">${placeOpts.map(([v, t]) => `<option value="${esc(v)}"${v === ch.place.to ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>` : '')}
    ${sel('category', 'Category', ch.category ? 'set' : '', [['', 'Unchanged'], ['set', 'Change to…']],
      ch.category ? `<label class="pa-field"><span class="pa-field-label">Change to</span><select id="pa-bk-category-to" data-bk="category-to">${catOpts.map(([v, t]) => `<option value="${esc(v)}"${v === ch.category.to ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>` : '')}
    ${sel('mode', 'Kept track of', ch.mode || '', [['', 'Unchanged'], ['count', 'Counting'], ['level', 'Plenty, low, out']])}
    ${sel('expiry', 'Best-before', x ? x.kind : '', [['', 'Unchanged'], ['shift', 'Move every date by…'], ['set', 'Set one date…']],
      x?.kind === 'shift' ? `<div class="pa-bk-shift"><label class="pa-field"><span class="pa-field-label">Days</span><input id="pa-bk-days" data-bk="days" type="number" inputmode="numeric" min="1" max="3650" value="${esc(x.days ?? '')}"></label>
          <label class="pa-field"><span class="pa-field-label">Which way</span><select id="pa-bk-dir" data-bk="dir"><option value="later"${x.dir !== 'earlier' ? ' selected' : ''}>Later</option><option value="earlier"${x.dir === 'earlier' ? ' selected' : ''}>Earlier</option></select></label></div>`
      : x?.kind === 'set' ? `<label class="pa-field"><span class="pa-field-label">Date</span><input id="pa-bk-date" data-bk="date" type="date" value="${esc(x.date || '')}"></label>` : '')}
    ${sel('list', 'Shopping list', ch.list ? 'add' : '', [['', 'Unchanged'], ['add', 'Add to the shopping list']])}
    ${sel('bin', 'Delete', ch.bin ? 'del' : '', [['', 'Unchanged'], ['del', 'Delete these items']], ch.bin ? '<p class="pa-field-hint">Delete is done on its own: any other change you chose is ignored. The items stay in Recently removed for 30 days.</p>' : '')}`;
}
function viewBulk() {
  const b = bulkState();
  if (b.step === 'review' && b.plan) return viewBulkReview();
  const all = items();
  const cats = CATEGORIES.filter(c => all.some(i => (i.category || 'Other') === c));
  const { listed, unlisted } = placeChoices();
  const places = [...listed, ...unlisted].filter(l => all.some(i => i.location === l));
  const chip = (v, label, n) => `<button type="button" class="ui-chip" aria-pressed="${b.place === v}" data-act="bk-place" data-v="${esc(v)}">${esc(label)} <span class="ui-chip-badge">${n}</span></button>`;
  return `<h1 class="ui-large-title">Bulk edit</h1>
    <p class="pa-large-sub">Pick items, choose what to change, then check it. Nothing is saved until you say so.</p>
    ${section('Which items', `<div class="ui-search" role="search">${icon('search')}
        <input type="search" id="pa-bq" placeholder="Search the pantry" aria-label="Search the pantry" autocomplete="off" value="${esc(b.q)}">
        <button type="button" class="pa-search-clear" data-act="bk-q-clear" aria-label="Clear search">${icon('close')}</button></div>
      <div class="ui-chips" role="group" aria-label="Where it’s kept">${chip('', 'All', all.length)}${places.map(p => chip(p, p, all.filter(i => i.location === p).length)).join('')}</div>
      <label class="pa-field pa-bk-cat"><span class="pa-field-label">Category</span><select id="pa-bk-cat" data-bk="cat"><option value="">All categories</option>${cats.map(c => `<option value="${esc(c)}"${b.cat === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <div class="pa-bk-bar"><span class="pa-selcount" id="pa-bcount" role="status" aria-live="polite"></span>
        <span class="pa-selbar-links"><button type="button" class="ui-plain" data-act="bk-all">Select all matching</button><button type="button" class="ui-plain" data-act="bk-none">Select none</button></span></div>
      <div id="pa-bulk-list">${bulkList()}</div>`, { id: 'bk-items' })}
    ${section('What to change', `<div class="ui-card pa-bk-changes" id="pa-bulk-changes">${bulkChanges()}</div>
      <button type="button" class="ui-fill ui-wide" data-act="bk-review">Review changes</button>`, { id: 'bk-change', footer: 'Every field stays as it is until you choose. Names are changed one item at a time, on the item.' })}`;
}
function updateBulkUI() {
  const b = S.bulk; if (!b) return;
  const shown = new Set(bulkFiltered().map(i => i.id)), n = b.sel.ids.size, hidden = [...b.sel.ids].filter(id => !shown.has(id)).length;
  const c = $('#pa-bcount'); if (c) { const t = SEL.selText(n, hidden); if (c.textContent !== t) c.textContent = t; }
  for (const i of document.querySelectorAll('input.pa-bsel')) { const on = SEL.isSel(b.sel, i.dataset.bsel); if (i.checked !== on) i.checked = on; i.closest('.pa-item')?.classList.toggle('is-selected', on); }
}
function drawBulkList() { const el = $('#pa-bulk-list'); if (!el) return; const k = el.contains(document.activeElement) ? document.activeElement.id : ''; el.innerHTML = bulkList(); if (k) document.getElementById(k)?.focus({ preventScroll: true }); updateBulkUI(); }
// The choice made in a field of the Change section. `structure`: the set of inputs changed (redraw that block).
function bulkField(name, v) {
  const b = bulkState(), ch = b.ch;
  let structure = true;
  if (name === 'place') ch.place = v ? { to: ch.place?.to || '' } : null;
  else if (name === 'place-to') { ch.place.to = v; structure = false; }
  else if (name === 'category') ch.category = v ? { to: ch.category?.to || '' } : null;
  else if (name === 'category-to') { ch.category.to = v; structure = false; }
  else if (name === 'mode') ch.mode = v || null;
  else if (name === 'expiry') ch.expiry = v === 'shift' ? { kind: 'shift', days: ch.expiry?.days || 7, dir: ch.expiry?.dir || 'later' } : v === 'set' ? { kind: 'set', date: ch.expiry?.date || '' } : null;
  else if (name === 'days') { ch.expiry.days = v; structure = false; }
  else if (name === 'dir') { ch.expiry.dir = v; structure = false; }
  else if (name === 'date') { ch.expiry.date = v; structure = false; }
  else if (name === 'list') ch.list = v === 'add';
  else if (name === 'bin') ch.bin = v === 'del';
  if (structure) { const el = $('#pa-bulk-changes'), id = document.activeElement?.id; if (el) { el.innerHTML = bulkChanges(); if (id) document.getElementById(id)?.focus({ preventScroll: true }); } }
}
// Review: what will change, in numbers, with up to three before and after.
function bulkReview() {
  const b = bulkState(), ch = b.ch, list = bulkChosen();
  if (!list.length) return toast('Select some items first');
  if (BI.isEmpty(ch)) return toast('Choose what to change first');
  const gap = BI.missing(ch); if (gap) return toast(gap);
  const p = BI.plan(list, ch, { onList, by: who(), placeOps: (it, to) => placeOps(it, to) });
  if (!p.changing) return toast(p.unchanged ? 'None of them would change: they are already as chosen' : 'None of them would change');
  b.plan = p; b.step = 'review';
  redraw();
  window.scrollTo(0, 0);
}
function viewBulkReview() {
  const b = bulkState(), ch = b.ch, p = b.plan;
  const lines = BI.changeLines(ch, p), notes = BI.reviewNotes(p, ch);
  const big = p.changing >= BI.BIG && BI.overwrites(ch);
  const samples = p.pairs.slice(0, 3).map(x => `<li><div class="ui-row"><span class="ui-row-main"><span class="ui-row-sub">${esc(BI.summary(x.before))}</span><span class="pa-row-title pa-break">→ ${esc(BI.summary(x.after))}</span></span></div></li>`).join('')
    || p.addToList.slice(0, 3).map(i => `<li><div class="ui-row"><span class="ui-row-main"><span class="pa-row-title pa-break">${esc(i.name)} → on the shopping list</span></span></div></li>`).join('');
  return `<h1 class="ui-large-title" id="pa-bulk-h" tabindex="-1">Review changes</h1>
    <p class="pa-large-sub">${esc(BI.headline(p))}${p.total > p.changing ? ` (of ${p.total} picked)` : ''}</p>
    <ul class="ui-list">${lines.map(t => `<li><div class="ui-row"><span class="ui-row-main"><span class="pa-row-title pa-break">${esc(t)}</span></span></div></li>`).join('')}</ul>
    ${notes.map(n => `<p class="pa-panel ${n.kind === 'warn' ? 'pa-warn' : ''}" role="note">${n.kind === 'warn' ? icon('alert') : ''}<span>${esc(n.text)}</span></p>`).join('')}
    ${section(p.pairs.length > 3 ? 'For example' : 'Before and after', `<ul class="ui-list">${samples}</ul>`, { id: 'bk-samples' })}
    <div class="ui-buttons"><button type="button" class="${p.deleting ? 'ui-tint ui-danger' : 'ui-fill'} ui-wide" data-act="bk-save">${p.deleting ? `Delete ${plural(p.changing, 'item')}` : big ? `Change ${plural(p.changing, 'item')}` : 'Save'}</button>
      <button type="button" class="ui-plain ui-wide" data-act="bk-back">Back</button></div>`;
}
// Save: ONE batch for the items, one for the shopping lines, ONE toast with Undo for both.
function bulkSave() {
  const b = bulkState(), p = b.plan, ch = b.ch;
  if (!p) return;
  const pairs = p.pairs.filter(x => itemById(x.id));   // (not what another phone deleted meanwhile)
  const sent = pairs.length ? patchMany(pairs.map(x => ({ id: x.id, ops: x.ops }))) : [];
  const fresh = ch.bin ? [] : p.addToList.filter(it => itemById(it.id) && !onList(it.id));
  const at = new Date().toISOString(), by = who().slice(0, 100);
  const lines = fresh.length ? saveMany('shop', fresh.map(it => ({ id: L.uid(), name: [it.brand, it.name].filter(Boolean).join(' ').slice(0, LINE_MAX), itemId: it.id, done: false, at, by }))) : [];
  const n = new Set([...sent.map(x => x.id), ...fresh.map(i => i.id)]).size;
  S.bulk = null;
  goBack(S.originTab);
  redraw();
  const msg = ch.bin ? `${plural(n, 'item')} deleted` : `${plural(n, 'item')} changed`;
  toast(msg, { action: 'Undo', onAction: () => undoBatch(sent, { liveOnly: !ch.bin, lines }) }); announce(msg);
}

// ---- Item -------------------------------------------------------------------------------------------------------

const VERB = { add: 'Bought', use: 'Used up', open: 'Opened', discard: 'Thrown away', expired: 'Expired, thrown away', freeze: 'Frozen', thaw: 'Thawed', unfreeze: 'Back to packaging date' };
function viewItem(it) {
  const evs = eventsFor(it.id).sort((a, b) => (a.at < b.at ? 1 : -1));
  const u = L.usage(evs);
  const ro = L.isStaple(it) ? null : L.runOutDate(it, u);
  const q = L.totalQty(it);
  const batches = L.fefo(it);
  const t = today();
  let h = `<h1 class="ui-large-title">${esc(it.name)}</h1>${subOf(it) ? `<p class="pa-large-sub">${subOf(it)}</p>` : ''}`;
  // the thumbnail straight away; the photo replaces it once fetched (wantPhoto)
  const pic = bestPic(it);
  if (pic) h += `<img class="pa-hero" id="pa-hero" data-id="${esc(it.id)}" src="${esc(pic)}" alt="Photo of ${esc(it.name)}">`;
  wantPhoto(it);

  // stock, batch by batch (first to use at the top)
  const batchRow = b => {
    const d = L.batchUseBy(b, it);
    // frozen: marked so, or kept in a freezer (frozen goods); Thaw then. Food elsewhere can be frozen.
    const frozen = L.isFrozenBatch(b, inFreezer(it));
    const what = frozen ? `${b.qty} frozen` : b.openedAt ? `${b.qty} opened` : it.openDays ? `${b.qty} unopened` : plural(b.qty, 'in stock', 'in stock');
    const sub = [b.frozenAt ? `Frozen ${fmt(b.frozenAt)}` : '', b.thawedAt && !frozen ? `Thawed ${fmt(b.thawedAt)}` : '', b.openedAt ? `Opened ${fmt(b.openedAt)}` : '', d ? `use by ${fmt(d)}` : 'No date'].filter(Boolean).join(' · ');
    const desc = d ? `use by ${fmt(d)}` : 'no date';
    return `<li><div class="ui-row pa-batch">
      <span class="ui-row-main"><span class="pa-row-title">${esc(what)}</span><span class="ui-row-sub">${esc(sub.charAt(0).toUpperCase() + sub.slice(1))}</span></span>
      <span class="ui-row-trail">${badge(d)}</span>
      <span class="pa-batch-acts">
        ${!b.openedAt && it.openDays && !frozen ? `<button type="button" class="ui-tint" data-size="small" data-act="open" data-b="${esc(b.id)}" aria-label="Open 1, ${esc(desc)}">Open</button>` : ''}
        ${L.canUnfreeze(b) ? `<button type="button" class="ui-plain pa-quiet" data-size="small" data-act="unfreeze" data-b="${esc(b.id)}" aria-label="Not frozen: back to the packaging date, ${esc(b.packExpiry ? fmt(b.packExpiry) : 'no date')}">Not frozen</button>` : ''}
        ${frozen ? `<button type="button" class="ui-tint" data-size="small" data-act="thaw" data-b="${esc(b.id)}" aria-label="Thaw ${esc(plural(b.qty, 'unit'))}, ${esc(desc)}">${icon('droplet')}Thaw</button>`
          : freezable(it) ? `<button type="button" class="ui-tint" data-size="small" data-act="freeze" data-b="${esc(b.id)}" aria-label="Freeze ${esc(plural(b.qty, 'unit'))}, ${esc(desc)}">${icon('snowflake')}Freeze</button>` : ''}
        <button type="button" class="ui-tint" data-size="small" data-act="use" data-b="${esc(b.id)}" aria-label="Used 1, ${esc(desc)}">Used 1</button>
        <button type="button" class="ui-plain pa-quiet" data-size="small" data-act="toss" data-b="${esc(b.id)}" aria-label="Bin 1, ${esc(desc)}">Bin 1</button>
      </span></div></li>`;
  };
  if (L.isStaple(it)) {
    const lv = L.levelOf(it);
    const seg = (v, label) => `<label class="pa-seg"><input type="radio" name="pa-level" value="${v}"${lv === v ? ' checked' : ''}><span>${label}</span></label>`;
    h += section('How much is left', `<fieldset class="ui-segmented pa-level"><legend class="pa-sr">How much is left</legend>${seg('plenty', 'Plenty')}${seg('low', 'Low')}${seg('out', 'Out')}</fieldset>`,
      { id: 'stock', footer: 'Kept without counting. Low or Out puts it on the shopping list; Put away sets it back to Plenty.' });
  } else {
    h += section('In stock', `<ul class="ui-list">${batches.length ? batches.map(batchRow).join('') : `<li><div class="ui-row"><span class="ui-row-main"><span class="pa-row-title">None left</span><span class="ui-row-sub">Bought more? Add it below.</span></span></div></li>`}</ul>`,
      { count: q, id: 'stock', footer: it.openDays ? `Keeps about ${plural(it.openDays, 'day')} once opened (the label wins).` : '' });
  }
  h += `<div class="ui-buttons pa-actions">
    ${L.isStaple(it) ? '' : `<button type="button" class="ui-fill ui-wide" data-act="bought">${icon('plus')}Bought more</button>`}
    <button type="button" class="ui-tint ui-wide" data-act="to-list"${onList(it.id) ? ' aria-disabled="true"' : ''}>${icon('cart')}${onList(it.id) ? 'On the shopping list' : 'Add to shopping list'}</button>
  </div>`;

  // how fast the family uses it
  const max = Math.max(1, ...u.months.map(m => m.used + m.wasted));
  const cur = t.slice(0, 7);
  const cols = u.months.map(m => `<li class="pa-col${m.key === cur ? ' is-current' : ''}"><span class="pa-col-value">${m.used + m.wasted}</span><span class="pa-col-bar" style="--v:${Math.round(((m.used + m.wasted) / max) * 100)}%"></span><span>${esc(m.label)}${m.key === cur ? '<span class="pa-sr"> (this month)</span>' : ''}</span></li>`).join('');
  const pace = u.daysPerUnit
    ? `<p class="pa-card-kicker">Usual pace</p><p class="ui-card-title">${esc(L.paceLabel(u).replace(/^./, c => c.toUpperCase()))}</p>${ro ? `<p class="ui-card-text">At this pace it runs out around <strong>${esc(fmt(ro))}</strong>.</p>` : ''}`
    : `<p class="ui-card-text">Tap “Used 1” each time one is finished. After two, the pantry learns how fast you use it and puts it on the shopping list before it runs out.</p>`;
  h += section('How fast we use it', `<div class="ui-card">${pace}
      <p class="pa-cols-label" id="pa-cols-l">Used up or thrown away each month</p>
      <ul class="pa-cols pa-cols" aria-labelledby="pa-cols-l">${cols}</ul></div>`,
    { id: 'pace', footer: [plural(u.units, 'used up', 'used up'), u.discards ? `${u.discards} thrown away` : '', it.lowAt ? `on the shopping list at ${it.lowAt} left` : ''].filter(Boolean).join(' · ') });

  // buy it online
  const sq = shopQuery(it);
  h += section('Buy online', `<ul class="ui-list">
    ${L.SHOPS.map(sh => `<li><a class="ui-row" href="${esc(sh.url(sq))}" target="_blank" rel="noopener"><span class="ui-row-lead" data-tone="grey">${icon('cart')}</span><span class="ui-row-main"><span class="pa-row-title">Search ${esc(sh.name)}</span></span>${icon('external', { cls: 'ui-row-chevron' })}<span class="pa-sr"> (opens ${esc(sh.name)})</span></a></li>`).join('')}
  </ul>`, { id: 'online' });

  // details
  const detail = (label, value) => value === '' || value == null ? '' : `<li><div class="ui-row"><span class="ui-row-main"><span class="pa-row-title">${label}</span></span><span class="ui-row-value pa-wrap">${esc(value)}</span></div></li>`;
  h += section('Details', `<ul class="ui-list">${detail('Category', it.category)}${detail('Kept in', it.location)}${detail('Keeps once opened', it.openDays ? plural(it.openDays, 'day') : 'Not set')}${L.isStaple(it) ? detail('Kept track of', 'Plenty, low or out') : detail('Shopping list at', it.lowAt ? `${it.lowAt} left` : 'None left')}${detail('Barcode', it.barcode)}${detail('Added by', nameOf(it.createdBy))}${detail('Last changed by', nameOf(it.updatedBy))}</ul>`, { id: 'details' });

  // history
  h += section('History', evs.length
    ? `<ul class="ui-list">${evs.slice(0, 15).map(e => `<li><div class="ui-row"><span class="ui-row-main"><span class="pa-row-title">${e.type === 'level' ? `Marked ${esc(LEVEL_WORD[e.level] || e.level || '').toLowerCase()}` : VERB[e.type] || esc(e.type)} ${e.qty > 1 ? e.qty : ''}</span><span class="ui-row-sub">${esc(fmtTime(e.at))}${e.by ? ' · ' + esc(nameOf(e.by)) : ''}</span></span></div></li>`).join('')}</ul>`
    : `<ul class="ui-list"><li><div class="ui-row"><span class="ui-row-main"><span class="ui-row-sub">Nothing yet.</span></span></div></li></ul>`, { id: 'history', footer: evs.length > 15 ? `The latest 15 of ${evs.length}.` : '' });
  h += `<ul class="ui-list pa-delete"><li><button type="button" class="ui-row" data-tone="danger" data-align="center" data-act="delete"><span class="ui-row-main"><span class="pa-row-title">Delete item</span></span></button></li></ul>`;
  return h;
}

// ---- Add and edit -----------------------------------------------------------------------------------------------

function blank() {
  return { id: null, name: '', brand: '', size: '', category: 'Other', location: defaultPlace(), qty: 1, expiry: '', openDays: '', lowAt: 0, barcode: '', pic: '' };
}
// The form's picture: `pic` is what it shows (a thumbnail); `_pics` is { photo, thumb } for a new picture, null when
// removed, and absent when unchanged.
function viewForm(id) {
  const editing = !!id;
  const key = id || 'new';
  if (!S.draft || S.draft._for !== key) {
    const it = itemById(id);
    S.draft = it ? { ...blank(), ...it, openDays: it.openDays ?? '', pic: thumbSrc(it), _for: key, _base: it } : { ...blank(), _for: key };   // _base: the item as the form opened it (Save sends only what changed from it)
    S.dirty = false;
  }
  const d = S.draft;
  const opt = (list, v) => list.map(x => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('');
  const field = (name, label, attrs = '', hint = '') => `<label class="pa-field"><span class="pa-field-label">${label}</span><input name="${name}" value="${esc(d[name])}" ${attrs}>${hint ? `<span class="pa-field-hint">${hint}</span>` : ''}</label>`;
  let h = `<h1 class="ui-large-title">${editing ? 'Edit item' : 'Add an item'}</h1>`;
  if (!editing) {
    h += `<section class="ui-section pa-finder" aria-label="Find a product">
      <div class="ui-search" role="search">${icon('search')}
        <input type="search" id="pa-find" placeholder="Soy sauce, Milo, Dynamo…" aria-label="Find a product" autocomplete="off" enterkeyhint="search">
        <button type="button" class="pa-search-clear" data-act="find-clear" aria-label="Clear">${icon('close')}</button></div>
      <ul class="ui-list" id="pa-sugg" hidden></ul>
      <div class="pa-btn-row"><button type="button" class="ui-tint" data-act="scan">${icon('barcode')}Scan barcode</button><button type="button" class="ui-tint" data-act="quick">${icon('mic')}Say or type a list</button><button type="button" class="ui-tint" data-act="leftovers">${icon('bowl')}Leftovers</button></div>
      <p class="ui-section-foot" id="pa-find-foot">Pick a common Singapore supermarket product, scan its barcode, or say what you bought, to fill in the details.</p>
    </section>`;
  }
  h += `<form id="pa-form" novalidate>
    <section class="ui-section" aria-labelledby="h-f-details"><h2 class="ui-section-head" id="h-f-details">Details</h2>
      <div class="pa-photo-row">
        <label class="pa-photo">${d.pic ? `<img src="${esc(d.pic)}" alt="">` : icon('camera')}<span>${d.pic ? 'Change photo' : 'Add photo'}</span>
          <input type="file" accept="image/*" capture="environment" class="pa-file" id="pa-photo-file"></label>
        <div class="pa-photo-fields">
          <label class="pa-field"><span class="pa-field-label">Name</span><input name="name" value="${esc(d.name)}" required autocomplete="off" placeholder="Light soy sauce" aria-describedby="pa-name-err"></label>
          <p class="pa-field-error" id="pa-name-err" hidden>${icon('alert')}Give it a name</p>
        </div>
      </div>
      ${d.pic ? `<p class="pa-photo-del"><button type="button" class="ui-plain" data-act="photo-del">Remove photo</button></p>` : ''}
      <div class="pa-two">${field('brand', 'Brand', 'autocomplete="off" placeholder="Kikkoman"')}${field('size', 'Size', 'autocomplete="off" placeholder="500 ml"')}</div>
      <div class="pa-two">
        <label class="pa-field"><span class="pa-field-label">Category</span><select name="category">${opt(CATEGORIES, d.category)}</select></label>
        <label class="pa-field"><span class="pa-field-label">Kept in</span><select name="location">${placeOptions(d.location)}</select></label>
      </div>
    </section>`;
  const track = `<fieldset class="ui-segmented pa-track"><legend>Keep track by</legend>
      <label class="pa-seg"><input type="radio" name="measure" value="count"${d.measure !== 'level' ? ' checked' : ''}><span>Counting</span></label>
      <label class="pa-seg"><input type="radio" name="measure" value="level"${d.measure === 'level' ? ' checked' : ''}><span>Plenty, low, out</span></label></fieldset>`;
  const trackFoot = '<p class="ui-section-foot">For rice, oil or loose vegetables, “Plenty, low, out” is easier than counting.</p>';
  if (!editing && d.measure === 'level') {
    h += `<section class="ui-section" aria-labelledby="h-f-stock"><h2 class="ui-section-head" id="h-f-stock">Stock</h2>${track}${trackFoot}</section>`;
  } else if (!editing) {
    h += `<section class="ui-section" aria-labelledby="h-f-stock"><h2 class="ui-section-head" id="h-f-stock">Stock</h2>${track}
      <ul class="ui-list"><li><div class="ui-row"><span class="ui-row-main"><span class="pa-row-title" id="pa-qty-l">How many</span></span>
        ${stepperHtml({ id: 'pa-qty', labelledby: 'pa-qty-l', value: Number(d.qty) || 0, min: 0, max: 99 })}</div></li></ul>
      <label class="pa-field pa-gap"><span class="pa-field-label">Best before or use by</span><input type="date" name="expiry" value="${esc(d.expiry)}"></label>
      ${dateChips('expiry', d.expiry, d._guess)}
    </section>`;
  }
  h += `<section class="ui-section" aria-labelledby="h-f-remind"><h2 class="ui-section-head" id="h-f-remind">Reminders</h2>
      ${editing ? `${track}${trackFoot}` : ''}
      <div class="pa-two">${field('openDays', 'Keeps once opened (days)', 'type="number" inputmode="numeric" min="0" placeholder="Not set"')}${field('lowAt', 'On the list when down to', 'type="number" inputmode="numeric" min="0"')}</div>
      <p class="ui-section-foot">Opened items are due the earlier of the printed date and this many days after opening.</p>
    </section>
    <section class="ui-section" aria-labelledby="h-f-code"><h2 class="ui-section-head" id="h-f-code">Barcode</h2>
      ${field('barcode', 'Barcode number', 'inputmode="numeric" autocomplete="off" placeholder="Optional"', 'Scanning it next time finds this item.')}
    </section>
  </form>`;
  return h;
}
function wireForm() {
  const f = $('#pa-form'); if (!f) return;
  const q = $('#pa-qty');
  if (q) stepper(q, { min: 0, max: 99, onChange: v => { S.draft.qty = v; S.dirty = true; } });
  f.addEventListener('input', e => {
    const t = e.target; if (!t.name || !S.draft) return;
    S.draft[t.name] = t.value; S.dirty = true;
    if (t.name === 'category' || t.name === 'location') { S.draft._picked = { ...S.draft._picked, [t.name]: true }; refreshGuess(); }
    if (t.name === 'name' && t.value.trim()) { t.removeAttribute('aria-invalid'); $('#pa-name-err').hidden = true; }
    if (t.name === 'measure') { const y = scrollY; draw(route(), { keep: true }); scrollTo(0, y); $(`#pa-form [name="measure"][value="${t.value}"]`)?.focus(); return; }
    if (t.name === 'expiry') for (const c of document.querySelectorAll('.pa-dates .ui-chip')) c.setAttribute('aria-pressed', String(c.dataset.v === t.value && !!t.value));
  });
  f.addEventListener('submit', submitForm);
}
// A guessed best-before date for the form's product: filled in while the date is empty or still the last guess.
function withGuess(fields) {
  const d = S.draft, g = guessFor({ ...d, ...fields });
  const keep = d.expiry && d.expiry !== d._guess?.date;   // a date someone chose stays
  return { ...fields, _guess: g, ...(keep ? {} : { expiry: g?.date || '' }) };
}
function refreshGuess() {
  const box = $('#pa-form .pa-datebox'); if (!box || !S.draft) return;
  Object.assign(S.draft, withGuess({}));
  $('#pa-form [name="expiry"]').value = S.draft.expiry;
  box.outerHTML = dateChips('expiry', S.draft.expiry, S.draft._guess);
}
// Fill the form from a suggestion or a barcode lookup, then redraw it where it was.
function fillDraft(fields) {
  Object.assign(S.draft, fields);
  S.dirty = true;
  const y = scrollY;
  draw(route(), { keep: true });
  scrollTo(0, y);
}
function suggestions(q) {
  if (!q.trim()) return [];
  const out = [];
  const have = new Set();
  for (const it of items()) {
    have.add(L.norm(`${it.brand} ${it.name}`));
    const s = L.score(q, `${it.name} ${it.brand}`); if (s) out.push({ s: s + 2, mine: it });
  }
  for (const [i, c] of CATALOGUE.entries()) {
    if (have.has(L.norm(`${c.brand} ${c.name}`))) continue;   // already in the pantry: offer that one only
    const s = L.score(q, `${c.name} ${c.brand} ${c.category}`); if (s) out.push({ s, cat: c, i });
  }
  return out.sort((a, b) => b.s - a.s).slice(0, 8);
}
// Suggestion rows (the Add screen's finder and the unknown-barcode sheet): pantry items first, then the catalogue.
function suggRows(list, { mine = 'sugg-mine', cat = 'sugg' } = {}) {
  const row = (act, data, thumbHtml, title, sub, trail = '') => `<li><button type="button" class="ui-row" data-act="${act}" ${data}>${thumbHtml}<span class="ui-row-main"><span class="pa-row-title">${title}</span>${sub ? `<span class="ui-row-sub">${sub}</span>` : ''}</span>${trail}</button></li>`;
  return list.map(x => x.mine
    ? row(mine, `data-id="${esc(x.mine.id)}"`, thumb(x.mine), esc(x.mine.name), subOf(x.mine), `<span class="ui-row-trail"><span class="ui-badge" data-tone="accent">In the pantry</span></span>`)
    : row(cat, `data-i="${x.i}"`, `<span class="ui-row-thumb">${icon(CAT_ICON[x.cat.category] || 'box')}</span>`, esc(x.cat.name), [x.cat.brand, x.cat.size].filter(Boolean).map(esc).join(' · '))).join('');
}
function showSugg() {
  const q = $('#pa-find')?.value || '', ul = $('#pa-sugg');
  if (!ul) return;
  ul.innerHTML = suggRows(suggestions(q))
    + (q.trim() ? `<li><button type="button" class="ui-row" data-tone="action" data-act="sugg-own"><span class="ui-row-lead">${icon('plus')}</span><span class="ui-row-main"><span class="pa-row-title">Add “${esc(q.trim())}”</span><span class="ui-row-sub">Not in the list? Type the details below.</span></span></button></li>` : '');
  ul.hidden = !q.trim();
  $('#pa-find-foot').hidden = !!q.trim();
}
function validName() {
  const n = $('#pa-form [name="name"]');
  if (S.draft.name.trim()) return true;
  n.setAttribute('aria-invalid', 'true'); $('#pa-name-err').hidden = false;
  n.focus(); n.scrollIntoView({ block: 'center' });
  return false;
}
function submitForm(e) {
  e.preventDefault();
  const d = S.draft;
  if (!d || !validName()) return;
  const base = d._for !== 'new' ? itemById(d._for) : null;
  if (d._for !== 'new' && !base) { S.draft = null; S.dirty = false; goTo(S.originTab, { replace: true }); return toast('That item was removed on another phone. Find it in Settings, Recently removed.'); }
  const num = v => Math.max(0, parseInt(v, 10) || 0);
  const fields = {
    name: d.name.trim(), brand: String(d.brand || '').trim(), size: String(d.size || '').trim(), category: d.category, location: d.location,
    openDays: num(d.openDays) || null, lowAt: num(d.lowAt), barcode: String(d.barcode || '').trim(),
  };
  // a new or removed picture: the photo is written (or deleted) first, then the item with its thumbnail
  const pics = d._pics, hadPhoto = !!base?.hasPhoto;
  const id = base ? base.id : L.uid();
  if (pics !== undefined) {
    if (pics) savePhoto(id, pics.thumb, pics.photo);
    else if (hadPhoto) delPhoto(id);
  }
  const was = d._base || base;
  S.draft = null; S.dirty = false;
  if (base) {
    // Save sends only the fields the person changed in this form (against the item as the form opened it), so another
    // phone's change to anything else, such as the stock, is never overwritten by this save.
    const ops = L.emptyOps();
    const before = { openDays: null, lowAt: 0 };
    for (const [k, v] of Object.entries(fields)) if ((was[k] ?? before[k] ?? '') !== v) ops.set[k] = v;
    const wasLevel = was.measure === 'level';
    if (d.measure === 'level' && !wasLevel) { ops.set.measure = 'level'; ops.set.level = L.levelOf(base); }
    else if (d.measure !== 'level' && wasLevel) ops.del.push('measure', 'level');
    if (pics !== undefined) {
      if (base.photo) ops.del.push('photo');
      if (pics) { ops.set.thumb = pics.thumb; ops.set.hasPhoto = true; }
      else { if (base.thumb !== undefined) ops.del.push('thumb'); if (base.hasPhoto !== undefined) ops.del.push('hasPhoto'); }
    }
    const tally = { frozen: 0, thawed: 0 };
    const now = itemById(base.id) || base;
    const all = ops.set.location ? L.mergeOps(placeOps(now, ops.set.location, tally), ops) : ops;
    if (!L.opsEmpty(all)) patchItem(base.id, all);
    goBack('#/item/' + base.id);
    const cold = tallyText(tally);
    toast(cold ? `Saved: ${cold}` : 'Saved');
    return;
  }
  const it = { id, batches: [], createdAt: new Date().toISOString(), createdBy: who(), ...fields };
  if (d.measure === 'level') { it.measure = 'level'; it.level = 'plenty'; }
  if (pics) { it.thumb = pics.thumb; it.hasPhoto = true; }
  const qty = num(d.qty);
  let ev = null;
  if (qty > 0 && !L.isStaple(it)) {
    const res = L.addStock(it, { qty, expiry: d.expiry || null, by: who() });
    save('items', res.item); ev = save('events', res.event);
  } else save('items', it);
  goTo('#/item/' + it.id, { replace: true });
  toast(`${it.name} added`, { action: 'Undo', onAction: () => { removeItem(it.id); if (ev) remove('events', ev.id); redraw(); } });
}

// ---- barcode scanning -------------------------------------------------------------------------------------------

let scanning = null;
async function openScan() {
  const s = sheet({
    title: 'Scan a barcode', closeLabel: 'Cancel',
    body: `<div class="pa-scan"><video muted playsinline aria-label="Camera view"></video></div>
      <p class="pa-text pa-scan-msg" id="pa-scan-msg" role="status">Point the camera at the barcode.</p>
      <label class="ui-tint ui-wide pa-file-btn">${icon('camera')}Use a photo instead<input type="file" accept="image/*" class="pa-file" id="pa-scan-file"></label>`,
    onClose: () => { scanning?.cancel(); scanning = null; afterSheet(); },
  });
  const msg = $('#pa-scan-msg', s.el);
  const found = async code => { await closeSheet(s.el); gotBarcode(code); };
  $('#pa-scan-file', s.el).addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    msg.textContent = 'Reading the photo…';
    try {
      const { scanFile } = await import('./scan.js');
      scanning?.cancel();
      const code = await scanFile(file);
      if (code) return found(code);
      msg.textContent = 'No barcode found in that photo. Try closer, flat and in focus.';
    } catch { msg.textContent = 'This phone can’t read barcodes. Type the number into Barcode instead.'; }
  });
  try {
    const { scanVideo } = await import('./scan.js');
    if (!s.el.open) return;
    scanning = scanVideo($('video', s.el));
    const code = await scanning.done;
    scanning = null;
    if (code) found(code);
  } catch (e) {
    msg.textContent = /Permission|NotAllowed/i.test(`${e?.name} ${e?.message}`)
      ? 'The camera is blocked. Allow it in the browser’s settings, or use a photo of the barcode.'
      : 'No live camera here. Use a photo of the barcode instead.';
  }
}
async function gotBarcode(code) {
  const mine = items().find(i => i.barcode === code);
  if (mine) {
    await goTo('#/item/' + mine.id, { replace: screen() === 'add' });
    toast(`Found ${mine.name}`);
    openBought(mine);
    return;
  }
  if (screen() !== 'add') await goTo('#/add');
  if (!S.draft) draw(route());
  toast('Looking up the barcode…');
  const { lookup } = await import('./scan.js');
  const p = await lookup(code);
  if (!S.draft || screen() !== 'add') return;
  if (!p) { hideToast(); fillDraft({ barcode: code }); openUnknown(code); return; }
  // a household or toiletry database guesses the category and place, unless someone has already chosen them
  const d = S.draft, picked = d._picked || {}, def = blank(), guess = {};
  if (p.category && !picked.category && d.category === def.category) guess.category = p.category;
  if (p.location && !picked.location && d.location === def.location) guess.location = p.location;
  fillDraft(withGuess({ barcode: code, name: p.name, brand: p.brand, size: p.size, ...guess }));
  toast(`Found ${p.name}`);
  if (p.image && !S.draft.pic) {
    const { fromUrl } = await import('./photo.js');
    const ph = await fromUrl(p.image);
    if (ph && S.draft && !S.draft.pic) fillDraft({ pic: ph.thumb, _pics: ph });
  }
}

// No database knows this barcode: find it in the family's pantry or the Singapore list once, and it's known from
// then on. The barcode is already in the form, so Cancel still keeps it.
function openUnknown(code) {
  const s = sheet({
    title: 'We don’t know this barcode yet', closeLabel: 'Cancel',
    body: `<p class="pa-text pa-unk-text">${navigator.onLine === false ? 'No signal to look it up online. ' : ''}Find what it is, and scanning barcode <span class="pa-unk-code">${esc(code)}</span> finds it next time.</p>
      <div class="ui-search" role="search">${icon('search')}
        <input type="search" id="pa-unk-find" placeholder="Soy sauce, Dynamo, tissue…" aria-label="Find the product" autocomplete="off" enterkeyhint="search" autofocus>
        <button type="button" class="pa-search-clear" data-act="unk-clear" aria-label="Clear">${icon('close')}</button></div>
      <ul class="ui-list" id="pa-unk-list" aria-label="Matching products" hidden></ul>
      <ul class="ui-list pa-unk-new"><li><button type="button" class="ui-row" data-tone="action" data-act="unk-new"><span class="ui-row-lead">${icon('edit')}</span><span class="ui-row-main"><span class="pa-row-title">Type a new name</span><span class="ui-row-sub" id="pa-unk-new-sub">Not in the list? Fill in the details yourself.</span></span></button></li></ul>`,
    onClose: afterSheet,
  });
  const input = $('#pa-unk-find', s.el), ul = $('#pa-unk-list', s.el), sub = $('#pa-unk-new-sub', s.el);
  const show = () => {
    const q = input.value.trim();
    ul.innerHTML = suggRows(suggestions(q), { mine: 'unk-mine', cat: 'unk-cat' });
    ul.hidden = !ul.children.length;
    sub.textContent = q ? `Start with “${q}” and fill in the rest.` : 'Not in the list? Fill in the details yourself.';
  };
  input.addEventListener('input', show);
  s.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-act^="unk-"]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'unk-clear') { input.value = ''; show(); input.focus(); return; }
    const q = input.value.trim();
    await closeSheet(s.el);
    if (act === 'unk-mine') {
      const mine = itemById(b.dataset.id); if (!mine) return;
      patchItem(mine.id, { set: { barcode: code }, inc: {}, del: [] });
      const it = S.items.get(mine.id);
      S.draft = null; S.dirty = false;
      await goTo('#/item/' + it.id, { replace: screen() === 'add' });
      toast(`Barcode added to ${it.name}`);
      openBought(it);
      return;
    }
    if (!S.draft || screen() !== 'add') return;
    if (act === 'unk-cat') {
      const c = CATALOGUE[Number(b.dataset.i)];
      fillDraft(withGuess({ name: c.name, brand: c.brand, size: c.size, category: c.category, location: c.location, openDays: c.openDays ?? '', barcode: code }));
      $('#h-f-details')?.scrollIntoView({ block: 'start' });
      announce(`${c.name} filled in`);
      return;
    }
    if (q && !S.draft.name.trim()) fillDraft({ name: q });
    const n = $('#pa-form [name="name"]');
    n?.focus(); n?.scrollIntoView({ block: 'center' });
  });
}

// ---- scan many in a row: the camera stays open, a mode says what each scan does, a running tally, one Done -------

const SCAN_MODES = { add: 'Bought', use: 'Used up', list: 'Add to list' };
function openScanMany(mode = 'add') {
  const ops = [], tally = new Map(), unknown = new Set();
  let run = null;
  const s = sheet({
    title: 'Scan many', closeLabel: 'Done',
    body: `<fieldset class="ui-segmented pa-sm-mode"><legend>Each scan</legend>${Object.entries(SCAN_MODES).map(([v, l]) =>
        `<label class="pa-seg"><input type="radio" name="pa-sm-mode" value="${v}"${v === mode ? ' checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>
      <div class="pa-scan pa-sm-video"><video muted playsinline aria-label="Camera view"></video></div>
      <p class="pa-text pa-scan-msg" id="pa-sm-msg" role="status">Point the camera at each barcode in turn. Each counts once.</p>
      <section class="ui-section" aria-labelledby="pa-sm-h"><h3 class="ui-section-head" id="pa-sm-h"><span>Scanned</span><span class="pa-num" id="pa-sm-n">0</span></h3>
        <ul class="ui-list" id="pa-sm-tally"><li><div class="ui-row"><span class="ui-row-main"><span class="ui-row-sub">Nothing yet.</span></span></div></li></ul></section>
      <label class="ui-tint ui-wide pa-file-btn">${icon('camera')}Use a photo instead<input type="file" accept="image/*" class="pa-file" id="pa-sm-file"></label>`,
    footer: `<button type="button" class="ui-fill ui-wide" data-pa-close>Done</button>`,
    onClose: () => {
      run?.cancel(); run = null;
      afterSheet(); redraw();
      if (ops.length) toast(`Saved ${plural(ops.length, 'scan')}`, { action: 'Undo', onAction: () => {
        for (const o of ops.reverse()) { if (o.sent) undoItem(o.id, o.sent, o.before); if (o.ev) remove('events', o.ev); if (o.line) removeLine(o.line); }
        redraw(); announce('Undone');
      } });
    },
  });
  const el = s.el, msg = $('#pa-sm-msg', el), ul = $('#pa-sm-tally', el);
  const modeNow = () => el.querySelector('[name="pa-sm-mode"]:checked')?.value || 'add';
  const draw = () => {
    $('#pa-sm-n', el).textContent = [...tally.values()].reduce((n, t) => n + t.n, 0) + unknown.size;
    ul.innerHTML = [...tally.values()].reverse().map(t => `<li><div class="ui-row"><span class="ui-row-main"><span class="pa-row-title">${esc(t.name)}</span><span class="ui-row-sub">${esc(SCAN_MODES[t.mode])}</span></span><span class="ui-row-value">× ${t.n}</span></div></li>`).join('')
      + [...unknown].map(c => `<li><div class="ui-row"><span class="ui-row-main"><span class="pa-row-title">New barcode</span><span class="ui-row-sub pa-unk-code">${esc(c)}</span></span><span class="ui-row-trail"><button type="button" class="ui-tint" data-size="small" data-sm-new="${esc(c)}">Add it</button></span></div></li>`).join('')
      || `<li><div class="ui-row"><span class="ui-row-main"><span class="ui-row-sub">Nothing yet.</span></span></div></li>`;
  };
  const got = code => {
    const m = modeNow(), it = items().find(i => i.barcode === code);
    if (!it) { unknown.add(code); draw(); msg.textContent = `Not in the pantry yet: ${code}. Add it when you’re done.`; return; }
    let op = null, say = '';
    if (m === 'list') {
      const line = addToList(it, { quiet: true });
      if (!line) { msg.textContent = `${it.name} is already on the shopping list.`; return; }
      op = { line: line.id }; say = `${it.name} is on the shopping list`;
    } else {
      const res = m === 'add' ? restock(it, { qty: 1, expiry: guessFor(it)?.date || null })
        : L.isStaple(it) ? L.setLevel(it, { level: 'out', by: who() }) : L.takeOut(it, { type: 'use', by: who() });
      if (!res.event) { msg.textContent = `No ${it.name} left to use.`; return; }
      op = { id: it.id, before: it, sent: patchItem(it.id, res.ops), ev: save('events', res.event).id };
      if (m === 'use' && L.isStaple(it)) { const line = addToList(res.item, { quiet: true }); if (line) op.line = line.id; }
      say = m === 'add' ? `Added 1 ${it.name}` : L.isStaple(it) ? `${it.name}: out, on the shopping list` : `Used 1 ${it.name}`;
    }
    ops.push(op);
    const k = `${m}:${it.id}`, t = tally.get(k) || { name: it.name, mode: m, n: 0 };
    t.n++; tally.delete(k); tally.set(k, t);
    draw(); msg.textContent = say; haptic();
  };
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-sm-new]'); if (!b) return;
    const code = b.dataset.smNew;
    await closeSheet(el);
    gotBarcode(code);
  });
  $('#pa-sm-file', el).addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const { scanFile } = await import('./scan.js');
      const code = await scanFile(file);
      if (code) got(code); else msg.textContent = 'No barcode found in that photo. Try closer, flat and in focus.';
    } catch { msg.textContent = 'This phone can’t read barcodes.'; }
    e.target.value = '';
  });
  (async () => {
    try {
      const { scanMany } = await import('./scan.js');
      if (!el.open) return;
      run = scanMany($('video', el), got);
      await run.done;
    } catch (err) {
      msg.textContent = /Permission|NotAllowed/i.test(`${err?.name} ${err?.message}`)
        ? 'The camera is blocked. Allow it in the browser’s settings, or use a photo of each barcode.'
        : 'No live camera here. Use a photo of each barcode instead.';
    }
  })();
  return s;
}

// ---- the "bought more" sheet ----------------------------------------------------------------------------------

function openBought(it, { shopId = null } = {}) {
  const g = guessFor(it);
  const s = sheet({
    title: 'Bought more', closeLabel: 'Cancel', grey: true,
    body: `<form id="pa-bought" novalidate>
      <ul class="ui-list"><li><div class="ui-row">${thumb(it)}<span class="ui-row-main"><span class="pa-row-title">${esc(it.name)}</span>${subOf(it) ? `<span class="ui-row-sub">${subOf(it)}</span>` : ''}</span></div></li>
        <li><div class="ui-row"><span class="ui-row-main"><span class="pa-row-title" id="pa-b-qty-l">How many</span></span>
          ${stepperHtml({ id: 'pa-b-qty', labelledby: 'pa-b-qty-l', value: 1, min: 1, max: 99 })}</div></li></ul>
      <label class="pa-field pa-gap"><span class="pa-field-label">Best before or use by</span><input type="date" name="expiry" value="${esc(g?.date || '')}"></label>
      ${dateChips('expiry', g?.date || '', g)}
    </form>`,
    footer: `<button type="submit" form="pa-bought" class="ui-fill ui-wide">Add to stock</button>`,
    onClose: afterSheet,
  });
  const qty = stepper($('#pa-b-qty', s.el), { min: 1, max: 99 });
  const f = $('#pa-bought', s.el);
  f.addEventListener('input', e => { if (e.target.name === 'expiry') for (const c of s.el.querySelectorAll('.pa-dates .ui-chip')) c.setAttribute('aria-pressed', 'false'); });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const n = qty.get(), cur = itemById(it.id);
    if (!cur) { closeSheet(s.el); return; }
    const res = restock(cur, { qty: n, expiry: f.expiry.value || null });
    const ticked = shopLines().filter(m => m.itemId === it.id && !m.done && m.id !== shopId);
    for (const m of ticked) patchLine(m.id, { set: { done: true }, inc: {}, del: [] });
    closeSheet(s.el);   // (not awaited: the write lands now, as the sheet goes)
    apply(res, `Added ${n} ${it.name}`);
  });
}
// ---- Freeze and Thaw on a batch (21 Oct 2026, owner) ----------------------------------------------------------------
// One tap when there's one unit and one place of the kind. Otherwise a sheet: how many (some of a batch split off, logic.js),
// and, when all of it goes and the family has two or more freezers (or fridges), which one, this phone's last pick first.
// `kind` is where it goes: 'freezer' (Freeze) or 'fridge' (Thaw).
function coldPlaces(kind) {
  const list = P.placesOfKind(placeNames(), kind, kindOfPlace), last = (prefs.get('lastCold', {}) || {})[kind];
  if (!list.length) return [P.placeOfKind(placeNames(), kind, kindOfPlace)];
  return list.includes(last) ? [last, ...list.filter(p => p !== last)] : list;
}
function doCold(it, batchId, kind, n, place) {
  const cur = itemById(it.id); if (!cur) return null;
  const opts = { batchId, qty: n, place, inFreezer: inFreezer(cur), by: who() };
  const res = kind === 'freezer' ? L.freezeBatch(cur, { ...opts, days: freezeDays(cur) }) : L.thawBatch(cur, { ...opts, days: THAW_DAYS });
  if (!res.event) return apply(res, '');
  prefs.set('lastCold', { ...(prefs.get('lastCold', {}) || {}), [kind]: place });
  const moved = res.ops.set.location ? `moved to ${res.ops.set.location}` : `the rest stays in ${cur.location || 'its place'}`;
  const changed = L.batchesOf(res.item).find(x => x.frozenAt === today() || x.thawedAt === today());
  return apply(res, kind === 'freezer'
    ? `${n} frozen: ${moved}, keeps till ${fmt(changed?.expiry || L.addDays(today(), freezeDays(cur)))}`
    : `${n} thawed: ${moved}, use within ${plural(THAW_DAYS, 'day')}`);
}
function openCold(it, batchId, kind) {
  const b = L.batchesOf(it).find(x => x.id === batchId); if (!b || !(b.qty > 0)) return apply({ event: null }, '');
  const places = coldPlaces(kind), verb = kind === 'freezer' ? 'Freeze' : 'Thaw';
  if (b.qty <= 1 && places.length <= 1) return doCold(it, batchId, kind, 1, places[0]);
  const rest = it.location || 'its place';
  const row = (p, i) => `<li><label class="ui-row"><input type="radio" name="pa-cold" value="${esc(p)}"${i === 0 ? ' checked' : ''}><span class="ui-row-main"><span class="pa-row-title">${esc(p)}</span></span></label></li>`;
  const s = sheet({
    title: `${verb} ${it.name}`, closeLabel: 'Cancel', grey: true,
    body: `${b.qty > 1 ? `<ul class="ui-list"><li><div class="ui-row"><span class="ui-row-main"><span class="pa-row-title" id="pa-cold-l">How many</span><span class="ui-row-sub">of ${b.qty}</span></span>
        ${stepperHtml({ id: 'pa-cold-qty', labelledby: 'pa-cold-l', value: b.qty, min: 1, max: b.qty })}</div></li></ul>` : ''}
      ${places.length > 1 ? `<fieldset class="pa-moveto" id="pa-cold-where"><legend class="ui-section-head">${kind === 'freezer' ? 'Which freezer' : 'Which fridge'}</legend><ul class="ui-list">${places.map(row).join('')}</ul></fieldset>` : ''}
      <p class="ui-section-foot" id="pa-cold-note" role="status"></p>`,
    footer: `<button type="button" class="ui-fill ui-wide" id="pa-cold-go">${verb}</button>`,
    onClose: afterSheet,
  });
  const go = $('#pa-cold-go', s.el), where = $('#pa-cold-where', s.el), note = $('#pa-cold-note', s.el);
  const sync = n => {
    const all = n >= b.qty;
    if (where) where.hidden = !all;
    go.textContent = `${verb} ${n}`;
    note.textContent = all ? (kind === 'freezer' ? `Keeps about ${freezeDays(it) >= 365 ? 'a year' : 'a month'}.` : `Use within ${plural(THAW_DAYS, 'day')}.`) : `The rest stays in ${rest}.`;
  };
  const qty = b.qty > 1 ? stepper($('#pa-cold-qty', s.el), { min: 1, max: b.qty, onChange: sync }) : { get: () => 1 };
  sync(qty.get());
  go.addEventListener('click', async () => {
    const n = qty.get(), place = $('input[name="pa-cold"]:checked', s.el)?.value || places[0];
    closeSheet(s.el);   // (not awaited: the write lands now, as the sheet goes)
    doCold(it, batchId, kind, n, place);
  });
  return s;
}
// ---- leftovers: a name, the fridge, use within 3 days, one tap ----------------------------------------------------

const LEFTOVER_DAYS = 3;
function openLeftovers() {
  const fridge = P.placeOfKind(placeNames(), 'fridge', kindOfPlace), by = L.addDays(today(), LEFTOVER_DAYS);
  const s = sheet({
    title: 'Leftovers', closeLabel: 'Cancel', grey: true,
    body: `<form id="pa-left" novalidate>
      <label class="pa-field"><span class="pa-field-label">What is it?</span><input name="name" id="pa-left-name" autocomplete="off" placeholder="Chicken curry, fried rice…" required aria-describedby="pa-left-err pa-left-when"></label>
      <p class="pa-field-error" id="pa-left-err" hidden>${icon('alert')}Say what it is</p>
      <label class="pa-field pa-gap"><span class="pa-field-label">Kept in</span><select name="location">${placeOptions(fridge)}</select></label>
      <p class="ui-section-foot" id="pa-left-when">Use within ${plural(LEFTOVER_DAYS, 'day')}, by ${esc(fmt(by))}. It shows under Use soon, and never goes on the shopping list.</p>
    </form>`,
    footer: `<button type="submit" form="pa-left" class="ui-fill ui-wide">Add leftovers</button>`,
    onClose: afterSheet,
  });
  const f = $('#pa-left', s.el), name = $('#pa-left-name', s.el);
  name.addEventListener('input', () => { if (name.value.trim()) { name.removeAttribute('aria-invalid'); $('#pa-left-err', s.el).hidden = true; } });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const n = name.value.replace(/\s+/g, ' ').trim();
    if (!n) { name.setAttribute('aria-invalid', 'true'); $('#pa-left-err', s.el).hidden = false; name.focus(); return; }
    const base = { id: L.uid(), batches: [], createdAt: new Date().toISOString(), createdBy: who(), name: n, brand: '', size: '', category: 'Leftovers',
      location: f.location.value, openDays: null, lowAt: 0, barcode: '', noRestock: true };
    const res = L.addStock(base, { qty: 1, expiry: by, by: who() });
    save('items', res.item); const ev = save('events', res.event);
    await closeSheet(s.el);
    redraw();
    toast(`${n}: use by ${fmt(by)}`, { action: 'Undo', onAction: () => { removeItem(base.id); remove('events', ev.id); redraw(); announce('Undone'); } });
  });
  setTimeout(() => name.focus(), 50);
  return s;
}

// ---- "Say or type" (quick.js): a sentence becomes items to confirm -----------------------------------------------

async function openQuick() {
  const Q = await import('./quick.js');
  let found = [], mic = null;
  const s = sheet({
    title: 'Say or type', closeLabel: 'Cancel', grey: true,
    body: `<form id="pa-quick" novalidate>
      <label class="pa-field"><span class="pa-field-label">What did you buy?</span>
        <textarea class="pa-quick-text" id="pa-quick-text" autocomplete="off" placeholder="2 Meiji milk in the fridge expires 25 Oct, eggs and 3 tins of sardines"></textarea></label>
      ${Q.canListen() ? `<div class="pa-btn-row"><button type="button" class="ui-tint pa-mic" id="pa-mic" aria-pressed="false">${icon('mic')}<span>Speak</span></button></div>` : ''}
      <p class="ui-section-foot" id="pa-quick-hint">${Q.canListen() ? 'Tap Speak, or type.' : 'Type, or tap the microphone on your keyboard.'} Say how many, where it’s kept and the date; separate things with “and” or commas.</p>
      <ul class="ui-list" id="pa-quick-list" aria-live="polite"></ul>
    </form>`,
    footer: `<button type="submit" form="pa-quick" class="ui-fill ui-wide" id="pa-quick-go" disabled>Add items</button>`,
    onClose: () => { mic?.stop(); afterSheet(); },
  });
  const ta = $('#pa-quick-text', s.el), ul = $('#pa-quick-list', s.el), go = $('#pa-quick-go', s.el);
  const describe = x => [x.brand, plural(x.qty, 'unit'), x.location, x.expiry ? `use by ${fmt(x.expiry)}` : x.guess ? `about ${fmt(x.guess.date)} (a guess)` : 'no date',
    x.match?.mine ? 'adds to the one at home' : x.match?.cat ? '' : 'new item'].filter(Boolean).join(' · ');
  const show = () => {
    const pc = placeChoices();
    found = Q.parseQuick(ta.value, { today: today(), items: items(), catalogue: CATALOGUE, places: [...pc.listed, ...pc.unlisted] });
    for (const x of found) {
      const m = x.match?.mine || x.match?.cat;
      x.guess = x.expiry ? null : guessFor({ name: x.name, category: m?.category || '', location: x.location || m?.location || '' });
    }
    ul.innerHTML = found.map((x, i) => `<li><label class="ui-row"><input type="checkbox" data-q="${i}" checked>
      <span class="ui-row-main"><span class="pa-row-title">${esc(x.name)}</span><span class="ui-row-sub">${esc(describe(x))}</span></span></label></li>`).join('');
    count();
  };
  const count = () => {
    const n = ul.querySelectorAll('input:checked').length;
    go.disabled = !n;
    go.textContent = n ? `Add ${plural(n, 'item')}` : 'Add items';
  };
  ta.addEventListener('input', show);
  ul.addEventListener('change', count);
  $('#pa-mic', s.el)?.addEventListener('click', e => {
    const btn = e.currentTarget;
    if (mic) { mic.stop(); return; }
    const before = ta.value.trim();
    btn.classList.add('is-on'); btn.setAttribute('aria-pressed', 'true'); btn.lastElementChild.textContent = 'Stop';
    try {
      mic = Q.listen({
        onText: text => { ta.value = [before, text].filter(Boolean).join(', '); show(); },
        onEnd: err => {
          mic = null; btn.classList.remove('is-on'); btn.setAttribute('aria-pressed', 'false'); btn.lastElementChild.textContent = 'Speak';
          if (err && err !== 'no-speech' && err !== 'aborted') toast(/not-allowed|service/.test(err) ? 'The microphone is blocked. Allow it in the browser’s settings, or type instead.' : 'Didn’t catch that. Try again or type.');
        },
      });
    } catch { mic = null; toast('Speech isn’t available here. Type instead.'); }
  });
  $('#pa-quick', s.el).addEventListener('submit', async e => {
    e.preventDefault();
    mic?.stop();
    const picked = [...ul.querySelectorAll('input:checked')].map(c => found[Number(c.dataset.q)]);
    if (!picked.length) return;
    const undo = [];
    for (const x of picked) {
      const mine = x.match?.mine && itemById(x.match.mine.id);
      const c = x.match?.cat;
      const base = mine || {
        id: L.uid(), batches: [], createdAt: new Date().toISOString(), createdBy: who(),
        name: x.name, brand: x.brand || '', size: c?.size || '', category: c?.category || 'Other',
        location: x.location || c?.location || defaultPlace(), openDays: c?.openDays ?? null, lowAt: 0, barcode: '',
      };
      const res = restock(base, { qty: x.qty, expiry: x.expiry || x.guess?.date || null });
      const ev = save('events', res.event).id;
      if (mine) undo.push({ id: base.id, ev, before: mine, sent: patchItem(base.id, res.ops) });   // one more of what's at home: added to, not rewritten
      else { save('items', res.item); undo.push({ id: base.id, ev, created: true }); }
    }
    flag('said');
    await closeSheet(s.el);
    if (screen() === 'add') { S.draft = null; S.dirty = false; goTo('#/', { replace: true }); } else redraw();
    toast(`Added ${plural(picked.length, 'item')}`, { action: 'Undo', onAction: () => {
      for (const u of undo.reverse()) { if (u.created) removeItem(u.id); else if (u.sent) undoItem(u.id, u.sent, u.before); remove('events', u.ev); }
      redraw(); announce('Undone');
    } });
  });
  setTimeout(() => ta.focus(), 50);
}

// A sheet closed: draw anything the family changed while it was open.
function afterSheet() {
  if (S.pendingRender && !sheetOpen()) redraw();
}

// ---- Shopping ---------------------------------------------------------------------------------------------------

function shopLists() {
  const buy = L.toBuy(items(), eventsByItem());
  const manual = shopLines().sort((a, b) => (a.done - b.done) || (a.at < b.at ? -1 : 1));
  const listed = new Set(manual.filter(m => m.itemId && !m.done).map(m => m.itemId));
  return { manual, suggested: buy.filter(b => !listed.has(b.item.id)) };
}
// The aisle a shopping line belongs to: its pantry item's category, else the catalogue's best match for its name.
const aisleCache = new Map();
function aisleOf(m) {
  const it = itemById(m.itemId);
  if (it?.category) return it.category;
  if (!aisleCache.has(m.name)) aisleCache.set(m.name, catMatch(m.name)?.category || 'Other');
  return aisleCache.get(m.name);
}
// The catalogue product a typed name most likely is (or null).
function catMatch(name) {
  let best = null;
  for (const c of CATALOGUE) { const sc = L.score(name, `${c.name} ${c.brand}`); if (sc && (!best || sc > best.sc)) best = { sc, c }; }
  return best?.c || null;
}
// "Buy again": things the family has bought before (two or more), not on the list or suggested already, most bought first.
function buyAgain(suggested) {
  const n = new Map();
  for (const e of S.events.values()) if (e.type === 'add') n.set(e.itemId, (n.get(e.itemId) || 0) + (Number(e.qty) || 1));
  const skip = new Set(suggested.map(b => b.item.id));
  return items().filter(it => (n.get(it.id) || 0) >= 2 && !it.noRestock && !skip.has(it.id) && !onList(it.id))
    .sort((a, b) => n.get(b.id) - n.get(a.id) || a.name.localeCompare(b.name)).slice(0, 8);
}
const canSpeak = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
function viewShop() {
  const { manual, suggested } = shopLists();
  const todo = manual.filter(m => !m.done), done = manual.filter(m => m.done);
  let h = `<h1 class="ui-large-title">Shopping</h1>
    <form class="pa-addline" id="pa-shop-add"><label class="pa-sr" for="pa-shop-text">Add something to buy</label>
      <input id="pa-shop-text" placeholder="Add something to buy" autocomplete="off" enterkeyhint="done">
      ${canSpeak() ? `<button type="button" class="ui-tint pa-round pa-mic" id="pa-shop-mic" data-act="shop-mic" aria-pressed="false" aria-label="Say what to buy">${icon('mic')}</button>` : ''}
      <button class="ui-tint" type="submit">Add</button></form>`;
  const again = buyAgain(suggested);
  if (again.length) {
    h += section('Buy again', `<div class="ui-chips pa-again" data-wrap="on" role="group" aria-labelledby="h-again">${again.map(it =>
      `<button type="button" class="ui-chip" data-act="to-list" data-id="${esc(it.id)}" aria-label="Add ${esc(it.name)} to the list">${icon('plus')}${esc(it.name)}</button>`).join('')}</div>`, { id: 'again' });
  }
  const line = m => `<li><label class="ui-row${m.done ? ' is-done' : ''}">
      <input type="checkbox" data-shop="${esc(m.id)}"${m.done ? ' checked' : ''}>
      <span class="ui-row-main"><span class="pa-row-title">${esc(m.name)}</span>${m.by ? `<span class="ui-row-sub">Added by ${esc(nameOf(m.by))}</span>` : ''}</span>
      <button type="button" class="ui-plain pa-quiet pa-round" data-act="shop-del" data-id="${esc(m.id)}" aria-label="Remove ${esc(m.name)}">${icon('trash')}</button></label></li>`;
  // the lines to buy, by aisle (the catalogue's category order), so the shop is walked once
  const groups = new Map();
  for (const m of todo) { const a = aisleOf(m); if (!groups.has(a)) groups.set(a, []); groups.get(a).push(m); }
  const order = [...groups.keys()].sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b));
  const body = todo.length
    ? order.map((a, i) => `<h3 class="pa-aisle" id="pa-aisle-${i}">${esc(a)}</h3><ul class="ui-list" aria-labelledby="pa-aisle-${i}">${groups.get(a).map(line).join('')}</ul>`).join('')
    : `<ul class="ui-list"><li><div class="ui-row"><span class="ui-row-main"><span class="ui-row-sub">${done.length ? 'Everything is in the trolley.' : 'Nothing on the list yet.'}</span></span></div></li></ul>`;
  h += section('To buy', `<div id="pa-shop">${body}</div>`, {
    id: 'shop', count: todo.length || '',
    footer: manual.length || suggested.length ? 'Grouped by aisle. Tick things off as they go in the trolley, then Put away.'
      : 'Pantry items come here by themselves when none are left, when they’re down to their “on the list when down to” number, or when they’ll run out within a week at your usual pace. Type anything else above.' });
  if (done.length) {
    h += section('In the trolley', `<ul class="ui-list" id="pa-shop-done">${done.map(line).join('')}</ul>
      <div class="ui-buttons pa-putaway-btn"><button type="button" class="ui-fill ui-wide" data-act="put-away">${icon('box')}Put away ${esc(plural(done.length, 'thing'))}</button></div>`,
    { id: 'trolley', action: `<button type="button" data-act="shop-clear">Clear ticked</button>`, footer: 'Home again? Put away adds them to the pantry, each with its place and date, in one go.' });
  }
  h += section('Suggested from the pantry', suggested.length
    ? `<ul class="ui-list">${suggested.map(b => `<li><div class="ui-row">${thumb(b.item)}<span class="ui-row-main"><span class="pa-row-title">${esc(b.item.name)}</span><span class="ui-row-sub">${esc(L.whyText(b, today()))}</span></span>
        <span class="ui-row-trail"><button type="button" class="ui-tint" data-size="small" data-act="to-list" data-id="${esc(b.item.id)}" aria-label="Add ${esc(b.item.name)} to the list">Add</button></span></div></li>`).join('')}</ul>`
    : '', { id: 'suggested', footer: suggested.length ? 'Out of stock, running low, or due to run out within a week at your usual pace.' : 'Nothing is running low.' });
  if (todo.length || suggested.length) {
    h += `<p class="pa-share-line pa-going"><a class="ui-tint ui-wide" id="pa-wa-going" href="${esc(L.waLink(goingText()))}" target="_blank" rel="noopener">${icon('share')}Going shopping now<span class="pa-sr"> (opens WhatsApp)</span></a></p>
      <p class="ui-section-foot pa-going-foot">Tells the family on WhatsApp, with the list, so they can add anything before you’re back.</p>`;
  }
  return h;
}
const goingText = () => `Going shopping now. Anything to add?\n\n${L.shareText(shareLines())}`;
function shareLines() {
  const { manual, suggested } = shopLists();
  return [...manual.filter(m => !m.done).map(m => m.name), ...suggested.map(b => [b.item.brand, b.item.name].filter(Boolean).join(' '))];
}
function addToList(it, { quiet = false } = {}) {
  if (onList(it.id)) { if (!quiet) toast('Already on the shopping list'); return null; }
  const m = newLine([it.brand, it.name].filter(Boolean).join(' '), it.id);
  if (quiet) return m;
  redraw();
  toast(`${it.name} is on the shopping list`, { action: 'Undo', onAction: () => { removeLine(m.id); redraw(); } });
  return m;
}
// A line typed or said: linked to the pantry item of that name, if there is one.
function addLine(v) {
  const mine = items().find(i => L.norm(i.name) === L.norm(v) || L.norm(`${i.brand} ${i.name}`) === L.norm(v));
  if (mine && onList(mine.id)) return null;
  return newLine(v, mine?.id);
}
// The mic on the shopping list: say "milk, eggs and bread"; each becomes a line when the speaking stops.
let shopMic = null;
async function listenShop(btn) {
  if (shopMic) { shopMic.stop(); return; }
  const Q = await import('./quick.js');
  const inp = $('#pa-shop-text');
  let heard = '', ended = false;
  const done = err => {
    if (ended) return;   // browsers may end twice (an error, then the end)
    ended = true;
    shopMic = null;
    const b = $('#pa-shop-mic'); b?.classList.remove('is-on'); b?.setAttribute('aria-pressed', 'false');
    if (err && err !== 'no-speech' && err !== 'aborted') toast(/not-allowed|service/.test(err) ? 'The microphone is blocked. Allow it in the browser’s settings, or type instead.' : 'Didn’t catch that. Try again or type.');
    const added = Q.splitItems(heard).map(p => addLine(p.replace(/^(buy|get|need|we need|some)\s+/i, '').replace(/^./, c => c.toUpperCase()))).filter(Boolean);
    if (inp) inp.value = '';
    redraw();
    if (added.length) toast(`Added ${plural(added.length, 'thing')} to the list`, { action: 'Undo', onAction: () => { for (const m of added) removeLine(m.id); redraw(); announce('Undone'); } });
  };
  btn.classList.add('is-on'); btn.setAttribute('aria-pressed', 'true');
  try {
    shopMic = Q.listen({ onText: t => { heard = t; if (inp) inp.value = t; }, onEnd: done });
  } catch { shopMic = null; btn.classList.remove('is-on'); btn.setAttribute('aria-pressed', 'false'); toast('Speech isn’t available here. Type instead.'); }
}

// ---- Put away: everything ticked on the shopping list goes into the pantry in one sheet -----------------------------

function openPutAway() {
  const lines = shopLines().filter(m => m.done).sort((a, b) => (a.at < b.at ? -1 : 1));
  if (!lines.length) return;
  // each line: its pantry item, or a new one (from the catalogue's best match for the name)
  const rows = lines.map(m => {
    const it = itemById(m.itemId);
    const c = it ? null : catMatch(m.name);
    const base = it || { name: m.name, brand: '', category: c?.category || 'Other', location: c?.location || defaultPlace() };
    return { m, it, c, g: L.isStaple(it) ? null : guessFor(base), place: base.location || defaultPlace() };
  });
  const row = (r, i) => {
    const staple = L.isStaple(r.it);
    return `<li class="pa-pa"><label class="ui-row"><input type="checkbox" data-pa="${i}" checked>
        <span class="ui-row-main"><span class="pa-row-title" id="pa-pa-t${i}">${esc(r.it ? r.it.name : r.m.name)}</span><span class="ui-row-sub">${r.it ? staple ? 'Back to plenty' : 'Adds to the one at home' : r.c ? `New item · ${esc(r.c.category)}` : 'New item'}</span></span></label>
      <div class="pa-pa-fields">
        <label class="pa-field"><span class="pa-field-label">Kept in</span><select name="place" data-i="${i}">${placeOptions(r.place)}</select></label>
        ${staple ? '' : `<label class="pa-field"><span class="pa-field-label">Best before</span><input type="date" name="expiry" data-i="${i}" value="${esc(r.g?.date || '')}"></label>
        <label class="pa-field pa-pa-qty"><span class="pa-field-label">How many</span><input type="number" inputmode="numeric" min="1" max="99" name="qty" data-i="${i}" value="1"></label>`}
      </div>${r.g ? `<p class="pa-field-hint">${esc(r.g.label)}: a guess. Change it to the date on the pack.</p>` : ''}</li>`;
  };
  const s = sheet({
    title: 'Put away', closeLabel: 'Cancel', grey: true, detent: 'large',
    body: `<p class="pa-text pa-pa-intro">Check where each goes and its date, then save them all at once. Untick anything that isn’t for the pantry.</p>
      <ul class="ui-list pa-pa-list">${rows.map(row).join('')}</ul>`,
    footer: `<button type="button" class="ui-fill ui-wide" id="pa-pa-go">Put away ${esc(plural(rows.length, 'thing'))}</button>`,
    onClose: afterSheet,
  });
  const go = $('#pa-pa-go', s.el);
  const picked = () => [...s.el.querySelectorAll('[data-pa]:checked')].map(c => Number(c.dataset.pa));
  s.el.addEventListener('change', e => {
    if (!e.target.dataset.pa) return;
    const n = picked().length;
    go.disabled = !n; go.textContent = n ? `Put away ${plural(n, 'thing')}` : 'Put away';
  });
  go.addEventListener('click', async () => {
    const val = (name, i) => s.el.querySelector(`[name="${name}"][data-i="${i}"]`)?.value || '';
    const undo = { items: [], created: [], events: [], lines: [] };
    for (const i of picked()) {
      const r = rows[i], place = val('place', i), qty = Math.max(1, Math.min(99, parseInt(val('qty', i), 10) || 1));
      const have = r.it && itemById(r.it.id);
      let res;
      if (have) {
        // an item at home: its place and the new stock go as changes to those fields, not as the whole item
        res = restock(have, { qty, expiry: val('expiry', i) || null });
        const ops = L.mergeOps(res.ops, place && place !== have.location ? { set: { location: place } } : null);
        undo.items.push({ id: have.id, before: have, sent: patchItem(have.id, ops) });
      } else {
        const c = r.c;
        const it = { id: L.uid(), batches: [], createdAt: new Date().toISOString(), createdBy: who(), name: c?.name || r.m.name, brand: c?.brand || '', size: c?.size || '',
          category: c?.category || 'Other', location: place, openDays: c?.openDays ?? null, lowAt: 0, barcode: '' };
        undo.created.push(it.id);
        res = restock(it, { qty, expiry: val('expiry', i) || null });
        save('items', res.item);
      }
      if (res.event) undo.events.push(save('events', res.event).id);
      undo.lines.push(r.m); removeLine(r.m.id);
    }
    await closeSheet(s.el);
    redraw();
    const n = undo.lines.length;
    toast(`Put away ${plural(n, 'thing')}`, { action: 'Undo', onAction: () => {
      for (const u of undo.items) if (u.sent) undoItem(u.id, u.sent, u.before);
      for (const id of undo.created) removeItem(id);
      for (const id of undo.events) remove('events', id);
      for (const m of undo.lines) restoreLine(m.id);
      redraw(); announce('Undone');
    } });
  });
  return s;
}

// ---- Recently removed (Settings → Recently removed, #/removed): 30 days to put things back --------------------------

// What is in it: removed items and shopping lines still inside their 30 days, newest removal first.
const removedLists = () => ({ items: L.recentlyRemoved([...S.items.values()]), lines: L.recentlyRemoved([...S.shop.values()]), places: removedPlaces() });
function viewRemoved() {
  const { items: its, lines, places: pls } = removedLists();
  const landed = new Set(landedItems().map(i => i.id));
  const row = (x, kind) => {
    const by = x.removedBy ? `Removed by ${nameOf(x.removedBy)}` : 'Removed';
    const sub = [kind === 'items' ? x.location : kind === 'places' ? 'Place' : 'Shopping list', by, L.daysLeftText(L.daysLeft(x)), landed.has(x.id) ? 'Your change is kept' : ''].filter(Boolean).join(' · ');
    return `<li><div class="ui-row pa-removed"><span class="ui-row-main"><span class="pa-row-title pa-break">${esc(x.name)}</span><span class="ui-row-sub pa-break">${esc(sub)}</span></span>
      <span class="ui-row-trail"><button type="button" class="ui-tint" data-size="small" data-act="restore" data-kind="${kind}" data-id="${esc(x.id)}" aria-label="Restore ${esc(x.name)}">Restore</button></span></div></li>`;
  };
  let h = `<h1 class="ui-large-title">Recently removed</h1><p class="pa-large-sub">Kept for ${L.REMOVED_DAYS} days</p>`;
  if (!its.length && !lines.length && !pls.length) {
    return h + `<div class="ui-card ui-empty"><span class="ui-empty-icon">${icon('trash')}</span><p class="ui-empty-title">Nothing removed</p>
      <p class="ui-empty-text">Items, shopping list lines and places you delete wait here for ${L.REMOVED_DAYS} days, so you can put them back.</p></div>`;
  }
  if (its.length) h += section('Items', `<ul class="ui-list" id="pa-removed">${its.map(x => row(x, 'items')).join('')}</ul>`, { id: 'removed-items', count: its.length, footer: 'Restore brings the item back with its history and any change made to it since.' });
  if (lines.length) h += section('Shopping list', `<ul class="ui-list" id="pa-removed-lines">${lines.map(x => row(x, 'shop')).join('')}</ul>`, { id: 'removed-lines', count: lines.length });
  if (pls.length) h += section('Places', `<ul class="ui-list" id="pa-removed-places">${pls.map(x => row(x, 'places')).join('')}</ul>`, { id: 'removed-places', count: pls.length, footer: 'Restore brings the place back to your list, with any new name it was given since.' });
  return h;
}
// Put back: clear the marker. The item returns as it now is (a use or edit that landed while it was hidden is in it).
function restoreFromList(kind, id) {
  if (kind === 'places') return restoreRemovedPlace(id);
  const x = (kind === 'shop' ? S.shop : S.items).get(id); if (!x) return;
  (kind === 'shop' ? restoreLine : restoreItem)(id);
  redraw();
  toast(`${x.name} is back`, { action: 'Undo', onAction: () => { (kind === 'shop' ? removeLine : removeItem)(id); redraw(); announce('Removed again'); } });
}

// A removed place back in the list (at its old position, with any rename made since). A live place of the same name is already
// there (the same name twice would show once), so say so instead.
function restoreRemovedPlace(id) {
  const x = S.places.get(id); if (!x) return;
  if (placeNames().some(n => n.toLowerCase() === P.cleanPlace(x.name).toLowerCase())) return toast(`${x.name} is already in your list`);
  restorePlaces([id]);
  redraw();
  toast(`${x.name} is back`, { action: 'Undo', onAction: () => { const e = placeByName(x.name); if (e) { removePlace(e); redraw(); announce('Removed again'); } } });
}

// ---- the daily sweep: what was removed more than 30 days ago goes for good -------------------------------------------------

// Once a day per phone (`pantry:lastSweep`), when the family pantry has been read from the server: this phone deletes up to
// 20 items, shopping lines and places removed more than 30 days ago (and an item's photo and history). It already holds every item
// in memory, so there is no extra listener and no full read; each delete is a small transaction that checks the document
// is still removed (a Restore elsewhere a moment ago wins), and a document another phone swept first is just skipped.
async function sweep({ force = false } = {}) {
  if (S.mode !== 'cloud' && S.mode !== 'local') return 0;
  const key = S.mode === 'cloud' ? 'lastSweep' : 'lastSweepLocal';
  if (!force && prefs.get(key) === today()) return 0;
  if (S.mode === 'cloud' && !force && (navigator.onLine === false || S.sync.cache)) return 0;   // from the phone's old copy: not today
  const backend = S.backend, now = Date.now();
  const due = L.sweepDue([...S.items.values()], [...S.shop.values()], now, undefined, [...S.places.values()]);
  const cutoff = new Date(now - L.REMOVED_DAYS * 86400000).toISOString();
  let n = 0;
  for (const it of due.items) {
    if (backend !== S.backend) break;
    if (!(await backend.purge('items', it.id, cutoff))) continue;
    const evs = eventsFor(it.id).map(e => e.id);
    if (it.hasPhoto || it.photo) await backend.delMany(PHOTOS, [it.id]);
    if (evs.length) await backend.delMany('events', evs);
    S.items.delete(it.id); for (const id of evs) S.events.delete(id); S.pics.delete(it.id);
    n++;
  }
  for (const m of due.shop) {
    if (backend !== S.backend) break;
    if (await backend.purge('shop', m.id, cutoff)) { S.shop.delete(m.id); n++; }
  }
  for (const d of due.places) {
    if (backend !== S.backend) break;
    if (await backend.purge('places', d.id, cutoff)) { S.places.delete(d.id); n++; }
  }
  if (backend === S.backend && !force) prefs.set(key, today());
  if (n) redraw();
  return n;
}

// ---- Places (Settings → Places, #/places) -------------------------------------------------------------------------

function viewPlaces() {
  const { listed, unlisted } = placeChoices();
  const counts = P.placeCounts(items());
  const row = p => { const n = counts.get(p) || 0; return `<li><button type="button" class="ui-row pa-place" data-act="place-open" data-v="${esc(p)}">
      <span class="ui-row-main"><span class="pa-row-title">${esc(p)}</span>${kindOfPlace(p) !== 'other' ? `<span class="ui-row-sub">${esc(P.KIND_LABELS[kindOfPlace(p)])}</span>` : ''}</span>
      <span class="ui-row-value">${n}<span class="pa-sr"> ${n === 1 ? 'item' : 'items'}</span></span>${chevron()}</button></li>`; };
  let h = `<h1 class="ui-large-title">Places</h1><p class="pa-large-sub">Where things are kept${S.mode === 'cloud' ? ', shared with the family' : ''}</p>`;
  h += section('Your places', `<ul class="ui-list" id="pa-places">${listed.map(row).join('')}</ul>`,
    { id: 'places-list', count: listed.length, footer: 'Tap a place to rename it, move it up or down, or remove it. Add and Items show them in this order.' });
  if (unlisted.length) {
    h += section('Not in your list', `<ul class="ui-list" id="pa-places-other">${unlisted.map(row).join('')}</ul>`,
      { id: 'places-other', footer: 'Items are still kept here. Tap one to add it to your list or move its items.' });
  }
  h += section('Add a place', `<form class="pa-addline pa-place-add" id="pa-place-add" novalidate><label class="pa-sr" for="pa-place-name">Name of the new place</label>
      <input id="pa-place-name" maxlength="${P.MAX_NAME}" placeholder="Level 2 fridge" autocomplete="off" aria-describedby="pa-place-err">
      <button class="ui-tint" type="submit">Add</button></form>
    <p class="pa-field-error pa-place-err" id="pa-place-err" aria-live="polite" hidden></p>`,
  { id: 'places-add', footer: `Up to ${P.MAX_NAME} letters, like Level 2 fridge or Mum’s room.` });
  return h;
}
function addPlaceFromForm() {
  const inp = $('#pa-place-name'), err = $('#pa-place-err'), list = placeNames();
  const problem = P.placeProblem(list, inp.value);
  if (problem) {
    err.innerHTML = `${icon('alert')}${esc(problem)}`; err.hidden = false;
    inp.setAttribute('aria-invalid', 'true'); inp.focus();
    return;
  }
  const name = P.cleanPlace(inp.value);
  addPlace(name);
  inp.value = ''; inp.removeAttribute('aria-invalid'); err.hidden = true;
  redraw();
  $('#pa-place-name')?.focus();
  toast(`Added ${name}`);
}
// A place's kind: Fridge, Freezer or Other, guessed from the name until someone picks one (one field of its document).
const kindNote = name => `${placeByName(name)?.kind ? '' : 'Guessed from the name. '}Food moved into a freezer freezes (keeps a year); moved out of one, it thaws. Things already here keep their dates.`;
function placeKindSection(name) {
  const k = kindOfPlace(name);
  const seg = v => `<label class="pa-seg"><input type="radio" name="pa-pl-kind" value="${v}"${k === v ? ' checked' : ''}><span>${v === 'other' ? 'Other' : esc(P.KIND_LABELS[v])}</span></label>`;
  return `<section class="ui-section" aria-labelledby="pa-pl-kind-h"><h3 class="ui-section-head" id="pa-pl-kind-h">Kind of place</h3>
    <fieldset class="ui-segmented pa-pl-kind"><legend class="pa-sr">Kind of place</legend>${P.KINDS.map(seg).join('')}</fieldset>
    <p class="ui-section-foot" id="pa-pl-kind-note">${esc(kindNote(name))}</p></section>`;
}
function setPlaceKind(e, kind) {
  materializePlaces();
  patchPlaces(placeIds(e).map(id => ({ id, ops: { set: { kind }, inc: {}, del: [] } })));
}
// A place's sheet: rename it, move it up or down, add it to the list, or remove it.
function openPlace(name) {
  const listed = () => !!placeByName(name);
  const n = P.placeCounts(items()).get(name) || 0;
  const pos = () => { const l = placeNames(); return `${l.indexOf(name) + 1} of ${l.length} in your list`; };
  const only = listed() && placeNames().length === 1;
  const s = sheet({
    title: name, closeLabel: 'Done', grey: true,
    body: `<form id="pa-pl-form" novalidate>
        <label class="pa-field"><span class="pa-field-label">Name</span><input name="name" id="pa-pl-name" value="${esc(name)}" maxlength="${P.MAX_NAME}" autocomplete="off" aria-describedby="pa-pl-err"></label>
        <p class="pa-field-error" id="pa-pl-err" aria-live="polite" hidden></p>
        <button type="submit" class="ui-tint ui-wide">Rename</button>
      </form>
      <p class="pa-text pa-pl-count">${n ? `${esc(plural(n, 'item'))} kept here. Renaming moves ${n === 1 ? 'it' : 'them'} too.` : 'No items kept here.'}</p>
      ${listed() ? placeKindSection(name) : ''}
      ${listed()
        ? `<section class="ui-section" aria-labelledby="pa-pl-order"><h3 class="ui-section-head" id="pa-pl-order">Order</h3>
          <div class="pa-btn-row pa-pl-move"><button type="button" class="ui-tint" data-pl="up" aria-label="Move up, ${esc(name)}">${icon('chevron-left', { cls: 'pa-up' })}Move up</button><button type="button" class="ui-tint" data-pl="down" aria-label="Move down, ${esc(name)}">${icon('chevron-left', { cls: 'pa-down' })}Move down</button></div>
          <p class="ui-section-foot" id="pa-pl-pos" role="status">${esc(pos())}</p></section>`
        : `<div class="ui-buttons pa-pl-add"><button type="button" class="ui-tint ui-wide" data-pl="list">${icon('plus')}Add to your list</button></div>`}
      <ul class="ui-list pa-pl-del"><li><button type="button" class="ui-row" data-tone="danger" data-align="center" data-pl="remove"${only ? ' aria-disabled="true" aria-describedby="pa-pl-only"' : ''}><span class="ui-row-main"><span class="pa-row-title">${listed() ? 'Remove place' : 'Move its items'}</span></span></button></li></ul>
      ${only ? '<p class="ui-section-foot" id="pa-pl-only">Keep at least one place.</p>' : ''}`,
    onClose: afterSheet,
  });
  const el = s.el;
  const moveBtns = () => {
    const l = placeNames(), i = l.indexOf(name);
    const up = $('[data-pl="up"]', el), down = $('[data-pl="down"]', el);
    if (!up) return;
    const was = document.activeElement;
    up.disabled = i <= 0; down.disabled = i < 0 || i >= l.length - 1;
    if (was?.disabled) (was === up ? down : up).focus();
    $('#pa-pl-pos', el).textContent = pos();
  };
  moveBtns();
  // someone in the family changed it meanwhile: say so instead of acting on an old name
  const stillThere = () => {
    if (listed() || P.placeCounts(items()).get(name)) return true;
    toast(`${name} was changed on another phone`); closeSheet(el); return false;
  };
  el.addEventListener('change', e => {
    if (e.target.name !== 'pa-pl-kind' || !stillThere()) return;
    const pe = placeByName(name); if (!pe) return;
    setPlaceKind(pe, e.target.value);
    $('#pa-pl-kind-note', el).textContent = kindNote(name);
    S.pendingRender = true;
    announce(`${name} is a ${P.KIND_LABELS[e.target.value].toLowerCase()}`);
  });
  $('#pa-pl-form', el).addEventListener('submit', async e => {
    e.preventDefault();
    if (!stillThere()) return;
    const inp = $('#pa-pl-name', el), err = $('#pa-pl-err', el);
    const to = P.cleanPlace(inp.value);
    if (to === name) return closeSheet(el);
    const problem = P.placeProblem(placeNames(), inp.value, name);
    if (problem) { err.innerHTML = `${icon('alert')}${esc(problem)}`; err.hidden = false; inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
    closeSheet(el);   // (not awaited: the write lands now, as the sheet goes)
    renamePlace(name, to);
  });
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-pl]');
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true' || !stillThere()) return;
    const a = b.dataset.pl;
    if (a === 'up' || a === 'down') {
      const e = placeByName(name); if (!e) return;
      movePlace(e, a === 'up' ? -1 : 1);
      S.pendingRender = true;
      moveBtns();
      announce(`${name} moved ${a}, ${pos()}`);
    } else if (a === 'list') {
      const problem = P.placeProblem(placeNames(), name);
      if (problem) return toast(problem);
      addPlace(name);
      await closeSheet(el);
      redraw();
      toast(`${name} is in your list`);
    } else if (a === 'remove') {
      const count = P.placeCounts(items()).get(name) || 0;
      await closeSheet(el);
      if (count) return openMovePlace(name);
      const e = placeByName(name); if (!e) return;
      removePlace(e);
      redraw();
      toast(`Removed ${name}`, { action: 'Undo', onAction: () => { restorePlaces(placeIds(e)); redraw(); announce('Undone'); } });
    }
  });
  return s;
}
// Renames a place in the list and on every item kept there (one batch), with Undo.
function renamePlace(from, to) {
  const e = placeByName(from), moved = items().filter(it => it.location === from);
  if (e) renamePlaceDoc(e, to);
  patchMany(moved.map(it => ({ id: it.id, ops: { set: { location: P.cleanPlace(to) }, inc: {}, del: [] } })));
  if (S.place === from) S.place = to;
  redraw();
  toast(`Renamed to ${to}`, { action: 'Undo', onAction: () => {
    if (e) renamePlaceDoc(e, from);
    patchMany(moved.filter(it => S.items.get(it.id)?.location === P.cleanPlace(to)).map(it => ({ id: it.id, ops: { set: { location: from }, inc: {}, del: [] } })));   // only those still there
    if (S.place === to) S.place = from;
    redraw(); announce('Undone');
  } });
}
// Removing a place that items use: first ask where they go (never leaves items pointing at a removed place).
function openMovePlace(name) {
  const listed = !!placeByName(name);
  const n = P.placeCounts(items()).get(name) || 0;
  const { listed: l, unlisted } = placeChoices();
  const others = [...l, ...unlisted].filter(p => p !== name);
  const s = sheet({
    title: listed ? `Remove ${name}` : `Move items from ${name}`, closeLabel: 'Cancel', grey: true,
    body: `<p class="pa-text pa-mv-text">${esc(plural(n, 'item'))} ${n === 1 ? 'is' : 'are'} kept in ${esc(name)}. Choose where ${n === 1 ? 'it goes' : 'they go'}${listed ? ' before the place is removed' : ''}.</p>
      <label class="pa-field"><span class="pa-field-label">Move ${n === 1 ? 'it' : 'them'} to</span><select id="pa-mv-to">${others.map(p => `<option>${esc(p)}</option>`).join('')}</select></label>`,
    footer: `<button type="button" class="ui-fill ui-wide" id="pa-mv-go">${listed ? 'Move and remove' : `Move ${esc(plural(n, 'item'))}`}</button>`,
    onClose: afterSheet,
  });
  $('#pa-mv-go', s.el).addEventListener('click', async () => {
    const to = $('#pa-mv-to', s.el).value;
    const e = placeByName(name), moved = items().filter(it => it.location === name);
    closeSheet(s.el);   // (not awaited: the write lands now, as the sheet goes)
    patchMany(moved.map(it => ({ id: it.id, ops: { set: { location: P.cleanPlace(to) }, inc: {}, del: [] } })));
    if (e) removePlace(e);
    if (S.place === name) S.place = '';
    redraw();
    toast(listed ? `Removed ${name}; ${plural(moved.length, 'item')} moved to ${to}` : `${plural(moved.length, 'item')} moved to ${to}`, { action: 'Undo', onAction: () => {
      if (e) restorePlaces(placeIds(e));
      patchMany(moved.filter(it => S.items.get(it.id)?.location === P.cleanPlace(to)).map(it => ({ id: it.id, ops: { set: { location: name }, inc: {}, del: [] } })));
      redraw(); announce('Undone');
    } });
  });
  return s;
}

// ---- Settings ---------------------------------------------------------------------------------------------------

// The family: one row per member (the name, with the Gmail under it), each opening their contact sheet; then the line
// to add someone. In the demo, a made-up family that changes in memory only.
function familyList(h, { demo = false, extra = '' } = {}) {
  const n = names();
  const person = m => {
    const sub = [n[m] ? m : '', m === h.owner ? 'Started it' : '', m === me() ? 'You' : ''].filter(Boolean).join(' · ');
    return `<li><button type="button" class="ui-row pa-person" data-act="person" data-v="${esc(m)}"><span class="ui-row-lead" data-tone="grey">${icon('user')}</span>
      <span class="ui-row-main"><span class="pa-row-title pa-break">${esc(n[m] || m)}</span>${sub ? `<span class="ui-row-sub pa-break">${esc(sub)}</span>` : ''}</span>${chevron()}</button></li>`;
  };
  return `<ul class="ui-list">
      <li><div class="ui-row"><span class="ui-row-lead">${icon('cloud')}</span><span class="ui-row-main"><span class="pa-row-title">${esc(h.name)}</span><span class="ui-row-sub pa-break">${demo ? 'Demo family' : `Signed in as ${esc(me())}`}</span></span></div></li>
      ${h.members.map(person).join('')}${extra}</ul>
    <form class="pa-addline pa-member" id="pa-member-add"><label class="pa-sr" for="pa-member-email">Family member’s email</label>
      <input id="pa-member-email" type="email" placeholder="Family member’s email" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button class="ui-tint" type="submit">Add</button></form>`;
}
// Adding or removing someone: the family pantry's members (in the demo, only in memory).
async function setMembers(list) {
  if (S.mode === 'demo') { S.household = { ...S.household, members: list }; redraw(); return; }
  await S.cloud.setMembers(S.household.id, list);
}
// One person's name (or clearing it): a change to that one field, `names.<email>` (people.js nameOps), never the whole map from
// a copy that may be a moment old. A household with no names yet gets the document made by the same change.
function setPersonName(email, name) {
  const members = S.household?.members || [], cur = names();
  const ops = PP.nameOps(email, name, { orphans: PP.orphanNames(cur, members, email) });
  return patchDoc('settings', PP.PEOPLE_ID, S.settings.has(PP.PEOPLE_ID) ? ops : L.mergeOps(ops, { set: { id: PP.PEOPLE_ID } }));
}
// A name this phone had saved for itself (Settings → You, before the family pantry) becomes the family's name for this account, once per
// household and only when the family has none for it: one field (`names.<email>`) like any other name. Waits until the family's own
// copy has come from the server (never decided from the phone's cache). The person's own row in Family sharing is the one place for
// the name from then on (the field is hidden in a family pantry); the phone's own name stays saved, and is what shows on this phone alone.
function adoptName() {
  if (S.mode !== 'cloud' || !S.household || !me() || S.sync.cache) return;
  const done = prefs.get('nameAdopted', {}) || {};
  if (done[S.household.id]) return;
  prefs.set('nameAdopted', { ...done, [S.household.id]: true });
  const mine = PP.cleanName(prefs.get('name') || '');
  if (mine && !names()[me()]) setPersonName(me(), mine);
}
// A family member's contact sheet: their Gmail, a name everyone sees, email an invite, stop sharing (not for whoever
// started it, nor yourself).
function openPerson(email) {
  const h = S.household; if (!h) return;
  const canRemove = email !== h.owner && email !== me();
  const s = sheet({
    title: names()[email] || 'Family member', closeLabel: 'Done', grey: true,
    body: `<ul class="ui-list"><li><div class="ui-row"><span class="ui-row-lead">${icon('mail')}</span><span class="ui-row-main"><span class="pa-row-title pa-break">${esc(email)}</span>
        <span class="ui-row-sub">${email === h.owner ? 'Started the family pantry' : 'Google account'}${email === me() ? ' · you' : ''}</span></span></div></li></ul>
      <form id="pa-person" class="pa-person-form" novalidate>
        <label class="pa-field"><span class="pa-field-label">${email === me() ? 'Your name' : 'Name'}</span>
          <input name="name" id="pa-person-name" value="${esc(names()[email] || '')}" maxlength="${PP.NAME_MAX}" autocomplete="off" placeholder="For example, Mum or Ah Mei" aria-describedby="pa-person-hint"></label>
        <p class="ui-section-foot" id="pa-person-hint">Everyone in the family sees this name instead of the email, in history and on the shopping list. Leave it empty to show the email.</p>
        <button type="submit" class="ui-fill ui-wide">Save</button>
      </form>
      <ul class="ui-list pa-person-acts">
        ${email !== me() ? `<li><a class="ui-row" data-tone="action" href="${esc(inviteHref(email))}"><span class="ui-row-lead">${icon('mail')}</span><span class="ui-row-main"><span class="pa-row-title">Email an invite</span><span class="ui-row-sub">From your own mail app, with the link</span></span></a></li>` : ''}
        ${canRemove ? `<li><button type="button" class="ui-row" data-tone="danger" data-align="center" data-pp="remove"><span class="ui-row-main"><span class="pa-row-title">Stop sharing</span></span></button></li>` : ''}
      </ul>`,
    onClose: afterSheet,
  });
  $('#pa-person', s.el).addEventListener('submit', async e => {
    e.preventDefault();
    const v = PP.cleanName($('#pa-person-name', s.el).value);
    if ((names()[email] || '') !== v) setPersonName(email, v);
    await closeSheet(s.el);
    redraw();
    toast(v ? `Saved: ${v}` : 'Name removed; the email shows instead');
  });
  s.el.addEventListener('click', async e => {
    if (!e.target.closest('[data-pp="remove"]')) return;
    const label = nameOf(email);
    if (!(await confirm({ title: 'Stop sharing?', text: `${label} won’t see the pantry any more. You can add them again later.`, ok: 'Stop sharing', danger: true }))) return;
    try {
      await setMembers(h.members.filter(x => x !== email));
      if (names()[email]) setPersonName(email, '');
      await closeSheet(s.el);
      redraw();
      toast(`Stopped sharing with ${label}`);
    } catch (err) { toast(S.cloud.explain(err, 'Removing them')); }
  });
  return s;
}


// Sync now (the sync button's tap): try to send what is waiting (cloud.js syncNow), then say plainly how it went (a toast;
// Reconnect when the first try didn't reach the family).
async function syncNow({ cycle = false } = {}) {
  if (S.syncNow.busy || S.mode !== 'cloud' || !S.backend?.syncNow) return;
  S.syncNow = { busy: true, result: null }; announce(cycle ? 'Reconnecting…' : 'Checking…');
  try { S.backend.nudge?.('syncnow'); } catch { /* not listening */ }
  let r;
  try { r = await S.backend.syncNow({ cycle }); } catch (err) { console.warn('sync now', err?.code || err?.message); r = { ok: false }; }
  const res = SY.syncNowResult(r, { refused: SY.refusedFor(S.refused, S.household?.id || '').length, pending: S.sync.pending });
  S.syncNow = { busy: false, result: res };
  drawSync();
  if (res.offer) toast(res.text, { action: 'Reconnect', onAction: () => syncNow({ cycle: true }) });
  else if (res.kind === 'attention' && screen() !== 'home') toast(res.text, { action: 'Show', onAction: () => goTo('#/') });
  else toast(res.text);
}

// The kit's two version lines (and its "Get the latest version" button); the line reads the running worker's version,
// as the kit's own guess (the first 'pantry-' cache) can be a runtime cache ('pantry-rt-kit').
async function showVersion(el) {
  await version(el, 'pantry');
  const v = await versionText(), text = el?.querySelector('.pa-version-text');
  if (v && text) { text.textContent = 'App version ' + v; text.hidden = false; }
}

function viewSettings() {
  const configured = !!S.cloud?.configured;
  const row = (inner, cls = '') => `<li><div class="ui-row"${cls}>${inner}</div></li>`;
  const btnRow = (act, title, { cls = ' data-tone="action"', iconName = '', sub = '' } = {}) => `<li><button type="button" class="ui-row"${cls} data-act="${act}">${iconName ? `<span class="ui-row-lead">${icon(iconName)}</span>` : ''}<span class="ui-row-main"><span class="pa-row-title">${title}</span>${sub ? `<span class="ui-row-sub">${sub}</span>` : ''}</span></button></li>`;
  let fam, famFoot = '';
  if (S.mode === 'demo') {
    fam = familyList(S.household, { demo: true });
    famFoot = 'A made-up family: tap someone to give them a name. Nothing is saved.';
  } else if (!configured) {
    fam = `<ul class="ui-list">${row(`<span class="ui-row-lead" data-tone="grey">${icon('box')}</span><span class="ui-row-main"><span class="pa-row-title">On this phone only</span><span class="ui-row-sub">Family sharing isn’t set up yet.</span></span>`)}</ul>`;
    famFoot = 'Sharing with the family needs a one-time setup of the pantry’s Firebase project (SETUP.md).';
  } else if (S.pending) {
    // a new password account, not verified yet: no family data until the emailed link has been tapped
    fam = `<ul class="ui-list">${row(`<span class="ui-row-lead">${icon('mail')}</span><span class="ui-row-main"><span class="pa-row-title">Check your email</span><span class="ui-row-sub pa-break">We sent a link to ${esc(S.pending.email)}. Tap it, then come back here.</span></span>`)}
      ${btnRow('verified', 'I’ve verified', { iconName: 'check' })}${btnRow('verify-resend', 'Send it again')}${btnRow('signout', 'Use a different email')}</ul>`;
    famFoot = 'The link proves the email is yours. Look in Junk or Spam if it doesn’t arrive in a minute or two.';
  } else if (!S.user) {
    fam = `<ul class="ui-list">${btnRow('signin', 'Continue with Google', { iconName: 'user' })}</ul>
      <p class="pa-quiet"><button type="button" class="ui-plain" data-act="email-open">Use email instead</button></p>`;
    famFoot = 'Sign in to share one pantry with the family: everyone sees the same items and shopping list. Only the people added can see it.';
  } else if (!S.household && S.lost) {
    fam = `<ul class="ui-list">${row(`<span class="ui-row-lead">${icon('alert')}</span><span class="ui-row-main"><span class="pa-row-title">Your pantry changed</span><span class="ui-row-sub pa-break">${S.lost.failed ? 'No signal to check right now.' : 'Your family pantry is gone, or this account isn’t in it any more.'}</span></span>`)}
      ${btnRow('hh-check', 'Try again', { iconName: 'refresh' })}${btnRow('hh-create', 'Start our family pantry')}${btnRow('signout', 'Sign out')}</ul>`;
    famFoot = `Signed in as ${esc(S.user.email)}. Try again looks for a pantry this account is in now; starting a new one is your choice.`;
  } else if (!S.household && S.lookupFailed) {
    // couldn't ask the server (no signal): not "no pantry", so no Start button
    fam = `<ul class="ui-list">${row(`<span class="ui-row-lead">${icon('alert')}</span><span class="ui-row-main"><span class="pa-row-title">Can’t check right now</span><span class="ui-row-sub pa-break">${esc(S.user.email)}</span></span>`)}
      ${btnRow('hh-check', 'Try again', { iconName: 'refresh' })}${btnRow('signout', 'Sign out')}</ul>`;
    famFoot = 'Connect to the internet and try again. Your family pantry is looked up first, so a second one is never started by mistake.';
  } else if (!S.household) {
    fam = `<ul class="ui-list">${row(`<span class="ui-row-lead">${icon('user')}</span><span class="ui-row-main"><span class="pa-row-title">Signed in</span><span class="ui-row-sub">${esc(S.user.email)}</span></span>`)}
      ${btnRow('hh-create', 'Start our family pantry')}${btnRow('hh-check', 'Check again')}${btnRow('signout', 'Sign out')}</ul>`;
    famFoot = `Not in a family pantry yet. Start one, or ask whoever started yours to add ${esc(S.user.email)}, then tap Check again.`;
  } else {
    fam = familyList(S.household, { extra: `${S.localCount ? btnRow('copy-up', `Copy ${plural(S.localCount, 'item')} from this phone`, { iconName: 'upload', sub: 'Saved here before you signed in' }) : ''}
      ${btnRow('signout', 'Sign out')}` });
    famFoot = 'They sign in with that email (Google, or an emailed link or password) to see the pantry. Tap your own row to set your name; tap someone else to name them, email them the link again, or stop sharing. Whoever started it can’t be removed.';
  }
  return `<h1 class="ui-large-title">Settings</h1>
    ${mergeCard()}
    ${section('Family sharing', fam, { id: 'family', footer: famFoot })}
    ${section('This device', '<div class="pa-device" id="pa-device"></div>', { id: 'device', footer: 'Look, light or dark, and how roomy the lists are. Solid turns off the see-through bars and sheets (smoother on older phones). Kept on this phone.' })}
    ${section('Where things are kept', `<ul class="ui-list"><li><a class="ui-row" href="#/places"><span class="ui-row-lead">${icon('home')}</span><span class="ui-row-main"><span class="pa-row-title">Places</span><span class="ui-row-sub">${esc(plural(placeNames().length, 'place'))}: ${esc(placeNames().slice(0, 3).join(', '))}${placeNames().length > 3 ? '…' : ''}</span></span>${chevron()}</a></li></ul>`,
      { id: 'places', footer: `Rename, reorder or add your own places.${S.mode === 'cloud' ? ' Shared with the family.' : ''}` })}
    ${section('Recently removed', `<ul class="ui-list"><li><a class="ui-row" href="#/removed"><span class="ui-row-lead">${icon('trash')}</span><span class="ui-row-main"><span class="pa-row-title">Recently removed</span><span class="ui-row-sub">${esc((() => { const r = removedLists(), n = r.items.length + r.lines.length + r.places.length; return n ? `${plural(n, 'thing')} you can put back` : 'Nothing right now'; })())}</span></span>${chevron()}</a></li></ul>`,
      { id: 'removed', footer: `Deleted items, shopping list lines and places wait here for ${L.REMOVED_DAYS} days, then go for good.` })}
    ${section('Reminders', `<div class="ui-chips" data-wrap="on" role="group" aria-label="Use soon means within">${Object.entries(SOON).map(([v, l]) =>
      `<button type="button" class="ui-chip" aria-pressed="${soonDays() === Number(v)}" data-act="soon" data-v="${v}">${l}</button>`).join('')}</div>`,
      { id: 'remind', footer: 'How far ahead “Use soon” looks, on Home. Kept on this phone.' })}
    ${section('Help', `<ul class="ui-list">
      <li><a class="ui-row" href="#/guide"><span class="ui-row-lead">${icon('info')}</span><span class="ui-row-main"><span class="pa-row-title">How to use the pantry</span></span>${chevron()}</a></li>
      ${btnRow('welcome', 'Show the welcome again', { iconName: 'home' })}
      ${tourOn() ? '' : btnRow('tour-on', 'Show the getting-started list', { iconName: 'list' })}
    </ul>`, { id: 'help' })}
    ${S.mode === 'cloud' ? '' : section('You', `<ul class="ui-list"><li><label class="ui-row"><span class="ui-row-main"><span class="pa-row-title">Your name</span></span>
      <input class="ui-row-input" id="pa-name" value="${esc(prefs.get('name') || '')}" placeholder="${esc(S.user?.name?.split(' ')[0] || 'For example, Mum')}" autocomplete="off"></label></li></ul>`,
      { id: 'you', footer: 'Shows in each item’s history and on the shopping list. Kept on this phone. In a family pantry, your name is set on your own row under Family sharing, and the family sees it too.' })}
    ${section('Your data', `<ul class="ui-list">
      ${btnRow('csv', 'Export as CSV', { iconName: 'download', sub: 'A spreadsheet of what’s in stock' })}
      ${btnRow('backup', 'Back up', { iconName: 'download', sub: 'Everything, as a JSON file' })}
      <li><label class="ui-row" data-tone="action"><span class="ui-row-lead">${icon('upload')}</span><span class="ui-row-main"><span class="pa-row-title">Restore a backup</span><span class="ui-row-sub">Adds the items in a backup file</span></span><input type="file" accept="application/json,.json" class="pa-file" id="pa-restore"></label></li>
      ${btnRow('sample', 'Add sample items', { iconName: 'box', sub: 'Made-up items to try the app with' })}
      ${S.mode === 'local' ? btnRow('wipe', 'Delete everything on this phone', { cls: ' data-tone="danger"' }) : ''}
    </ul>`, { id: 'data' })}
    ${section('On your home screen', `<div class="ui-card pa-install"><p class="ui-card-text"><strong>iPhone:</strong> in Safari, tap Share, then Add to Home Screen.</p><p class="ui-card-text"><strong>Android:</strong> in Chrome, open the menu, then Add to home screen or Install app.</p><p class="ui-card-text">It then opens like an app and works without signal.</p></div>`, { id: 'install' })}
    ${section('About', '', { id: 'about', footer: 'Product suggestions are common Singapore supermarket goods; “keeps once opened” days are a rough guide, so check the label. Barcode look-ups use Open Food Facts, Open Products Facts and Open Beauty Facts. Shop links open FairPrice’s, Sheng Siong’s, Cold Storage’s and Shopee’s own search.' })}
    <div id="pa-version"></div>`;
}

// ---- drawing ----------------------------------------------------------------------------------------------------

const TOP = { home: 'Pantry', items: 'Items', shop: 'Shopping', settings: 'Settings' };
const GUIDE = 'How to use the pantry';
function draw(r, { keep = false } = {}) {
  let [name = 'home', id] = r.parts;
  const main = $('#main');
  const task = name === 'add' || name === 'edit';
  if (!task) { S.draft = null; S.dirty = false; }
  let it = null;
  if (name === 'item' || name === 'edit') {
    it = itemById(id);
    if (!it) {
      // deleted (here or by the family): go back to where it was opened from, after this draw has finished
      main.innerHTML = '';
      setTimeout(() => { if (route().parts[1] === id) goTo(S.originTab, { replace: true, nav: 'pop' }); });
      return;
    }
  }
  if (!['home', 'items', 'item', 'add', 'edit', 'shop', 'settings', 'guide', 'places', 'removed', 'bulk'].includes(name)) name = 'home';
  if (name !== 'bulk') S.bulk = null;   // (leaving Bulk edit drops what was chosen there)
  if (name !== 'items' && S.sel.on) SEL.endSel(S.sel);   // (a sheet-like history entry: the new screen replaced it)
  if (TOP[name]) { S.originTab = name === 'home' ? '#/' : '#/' + name; S.backLabel = TOP[name]; }

  $('.ui-tabbar').hidden = task;
  $('#pa-toolbar').hidden = !task;

  let title = TOP[name] || '';
  if (name === 'home') { main.innerHTML = viewHome(); setBar({ title, trail: iconBtn('mic', 'Say or type what you bought', 'quick') + iconBtn('barcode', 'Scan a barcode', 'scan-home') + addBtn() }); }
  else if (name === 'items') { main.innerHTML = viewItems(); setBar({ title, trail: `<button type="button" class="pa-bar-btn" data-act="bulk-open" data-sel="${S.sel.on ? 'with' : ''}">Bulk edit</button>${S.sel.on ? '' : `<button type="button" class="pa-bar-btn" id="pa-sel-toggle" data-act="sel-on">Select</button>${addBtn()}`}` }); }
  else if (name === 'bulk') { title = 'Bulk edit'; main.innerHTML = viewBulk(); updateBulkUI(); setBar({ title, lead: backBtn(S.backLabel) }); if (S.bulk?.step === 'review') $('#pa-bulk-h')?.focus({ preventScroll: true }); }
  else if (name === 'item') {
    title = it.name;
    main.innerHTML = viewItem(it);
    setBar({ title, lead: backBtn(S.backLabel), trail: textBtn('Edit', 'edit') });
  } else if (name === 'add' || name === 'edit') {
    title = name === 'add' ? 'Add an item' : 'Edit item';
    main.innerHTML = viewForm(name === 'edit' ? id : null);
    setBar({ title, lead: textBtn('Cancel', 'back') });
    $('#pa-save').textContent = name === 'add' ? 'Add to pantry' : 'Save';
    wireForm();
  } else if (name === 'shop') { flag('shopped'); main.innerHTML = viewShop(); setBar({ title, trail: iconBtn('share', 'Share the list', 'share') }); }
  else if (name === 'removed') { title = 'Recently removed'; main.innerHTML = viewRemoved(); setBar({ title, lead: backBtn(S.backLabel) }); noteSeen(); }
  else if (name === 'places') { title = 'Places'; main.innerHTML = viewPlaces(); setBar({ title, lead: backBtn(S.backLabel) }); }
  else if (name === 'guide') { title = GUIDE; main.innerHTML = viewGuide(); setBar({ title: 'How to use it', lead: backBtn(S.backLabel) }); }
  else if (name === 'settings') {
    main.innerHTML = viewSettings(); setBar({ title });
    deviceSwitch($('#pa-device'));
    showVersion($('#pa-version'));
  }
  document.title = name === 'home' ? 'Pantry' : `${title} · Pantry`;
  if (name === 'home') drawRefusedList();
  drawSync();
  drawSelBar();
  drawBadge();
  S.pendingRender = false;
  if (keep) largeTitle();
}
// Draw the current screen again after a data change, keeping the scroll position. Not while a form is being filled
// in or a sheet is open: then it waits (a family member's change must never wipe what someone is typing).
function redraw() {
  if (!R) return;
  if (sheetOpen() || S.dragging || ['add', 'edit'].includes(screen())) { S.pendingRender = true; drawBadge(); return; }
  // someone is typing (a family member's email, a shopping line): draw once they leave the field
  const a = document.activeElement;
  if (a?.matches?.('#main input:not([type=checkbox]):not([type=radio]):not([type=search]), #main textarea') && a.value) {
    S.pendingRender = true;
    a.addEventListener('blur', () => { if (S.pendingRender) setTimeout(redraw); }, { once: true });
    return;
  }
  const y = scrollY, focus = document.activeElement?.id;
  draw(route(), { keep: true });
  scrollTo(0, y);
  if (focus && $('#' + focus)) $('#' + focus).focus({ preventScroll: true });
}
function drawBadge() {
  const left = shopLines().filter(m => !m.done).length + shopLists().suggested.length;
  const b = $('#pa-shop-badge');
  b.textContent = left > 99 ? '99+' : left; b.hidden = !left;
  const side = $('#pa-side-shop'); side.textContent = b.textContent; side.hidden = !left;
  $('#pa-shop-sr').textContent = left ? `, ${left} to buy` : '';
}

// ---- clicks and forms ---------------------------------------------------------------------------------------------

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.getAttribute('aria-disabled') === 'true') return;
  const act = b.dataset.act;
  const it = screen() === 'item' ? itemById(route().parts[1]) : itemById(b.dataset.id);
  switch (act) {
    case 'back': return goBack(screen() === 'edit' ? '#/item/' + route().parts[1] : S.originTab);
    case 'welcome': return showWelcome({ save: S.mode !== 'demo' });
    case 'go-add': return goTo('#/add');
    case 'scan-home': await goTo('#/add'); return openScan();
    case 'scan': return openScan();
    case 'edit': return goTo('#/edit/' + it.id);
    case 'use': return apply(L.takeOut(it, { type: 'use', by: who(), batchId: b.dataset.b || null }), `Used 1 ${it.name}`);
    case 'toss': {
      const res = L.takeOut(it, { type: 'discard', by: who(), batchId: b.dataset.b || null });
      return apply(res, res.event?.type === 'expired' ? `Binned 1 ${it.name} (expired)` : `Binned 1 ${it.name}`);
    }
    case 'quick': return openQuick();
    case 'start': return openStarter();
    case 'tour-show': return showMe(b.dataset.task);
    case 'tour-hide': { prefs.set('tour', 'off'); redraw(); return toast('Hidden. Settings → Help can show it again.'); }
    case 'tour-on': { prefs.set('tour', 'on'); goTo('#/'); return toast('The getting-started list is on Home'); }
    case 'soon': { prefs.set('soonDays', Number(b.dataset.v)); redraw(); return toast(`Use soon: within ${SOON[b.dataset.v]}`); }
    case 'open': return apply(L.openOne(it, { by: who(), batchId: b.dataset.b || null }), `Opened 1 ${it.name}`);
    case 'freeze': return openCold(it, b.dataset.b, 'freezer');
    case 'thaw': return openCold(it, b.dataset.b, 'fridge');
    case 'unfreeze': {
      const res = L.unfreezeBatch(it, { batchId: b.dataset.b, place: P.placeOfKind(placeNames(), 'fridge', kindOfPlace), inFreezer: inFreezer(it), by: who() });
      const was = L.batchesOf(it).find(x => x.id === b.dataset.b);
      const where = res.ops.set.location ? `, back in ${res.ops.set.location}` : '';
      return apply(res, `Not frozen: ${was?.packExpiry ? `use by ${fmt(was.packExpiry)}` : 'no date'}${where}`);
    }
    case 'leftovers': return openLeftovers();
    case 'scan-many': return openScanMany();
    case 'since-ok': { looked(); redraw(); return announce('Cleared'); }
    case 'bought': return openBought(it);
    case 'to-list': return addToList(it);
    case 'delete': {
      // a marker, not a delete: its history and photo stay, it is hidden everywhere, Recently removed (Settings) lists it for 30
      // days, and Undo is Restore (clears the marker; whatever another phone did to it meanwhile is kept)
      removeItem(it.id);
      goBack(S.originTab);
      toast(`${it.name} deleted`, { action: 'Undo', onAction: () => { restoreItem(it.id); redraw(); announce('Undone'); } });
      return;
    }
    case 'grip': if (Date.now() < S.gripQuiet) return; return openGrip(b.dataset.id);
    case 'bulk-open': return openBulk(b.dataset.sel === 'with' ? [...S.sel.ids] : []);
    case 'bk-place': { bulkState().place = b.dataset.v; for (const c of document.querySelectorAll('[data-act="bk-place"]')) c.setAttribute('aria-pressed', String(c === b)); return drawBulkList(); }
    case 'bk-q-clear': { bulkState().q = ''; const q = $('#pa-bq'); q.value = ''; drawBulkList(); return q.focus(); }
    case 'bk-all': { const n = SEL.selectAll(bulkState().sel, bulkFiltered().map(i => i.id)); updateBulkUI(); return announce(`All ${n} matching selected`); }
    case 'bk-none': { SEL.selectNone(bulkState().sel); updateBulkUI(); return announce('None selected'); }
    case 'bk-review': return bulkReview();
    case 'bk-back': { bulkState().step = 'edit'; redraw(); return window.scrollTo(0, 0); }
    case 'bk-save': return bulkSave();
    case 'sel-on': return enterSelect('');
    case 'sel-done': return exitSelect();
    case 'sel-all': { const n = SEL.selectAll(S.sel, filteredItems().map(i => i.id)); selChanged(); return announce(`All ${n} selected`); }
    case 'sel-none': { SEL.selectNone(S.sel); selChanged(); return announce('None selected'); }
    case 'sel-group': {
      const g = (itemGroups(sortedItems(filteredItems())) || []).find(x => x.key === b.dataset.g); if (!g) return;
      const ids = g.items.map(i => i.id), all = SEL.groupState(S.sel, ids) === 'all';
      SEL.setMany(S.sel, ids, !all); selChanged();
      return announce(`${all ? 'Unselected' : 'Selected'} ${g.items.length} in ${g.title}. ${S.sel.ids.size} selected.`);
    }
    case 'sel-move': case 'sel-list': case 'sel-delete': return selAction(act);
    case 'fold': {
      if (S.folded.has(b.dataset.g)) S.folded.delete(b.dataset.g); else S.folded.add(b.dataset.g);
      prefs.set('folded', [...S.folded]);
      return drawItemsList();
    }
    case 'place': {
      S.place = b.dataset.v;
      for (const c of document.querySelectorAll('[data-act="place"]')) c.setAttribute('aria-pressed', String(c === b));
      return drawItemsList();
    }
    case 'place-open': return openPlace(b.dataset.v);
    case 'restore': return restoreFromList(b.dataset.kind, b.dataset.id);
    case 'dates-toggle': prefs.set('fullDates', prefs.get('fullDates', false) !== true); return redraw();
    case 'q-clear': { S.q = ''; const q = $('#pa-q'); q.value = ''; drawItemsList(); return q.focus(); }
    case 'find-clear': { const f = $('#pa-find'); f.value = ''; showSugg(); return f.focus(); }
    case 'sample': {
      const data = sampleData(who() || 'Sample');
      for (const k of ['items', 'events']) for (const o of data[k]) save(k, o);
      redraw();
      return toast(`Added ${data.items.length} sample items`);
    }
    case 'date': {
      const box = b.closest('.pa-dates'), input = b.closest('form').querySelector(`[name="${box.dataset.for}"]`);
      input.value = b.dataset.v;
      if (S.draft && input.closest('#pa-form')) { S.draft[input.name] = input.value; S.dirty = true; }
      for (const c of box.querySelectorAll('.ui-chip')) c.setAttribute('aria-pressed', String(c === b));
      return;
    }
    case 'sugg': {
      const c = CATALOGUE[Number(b.dataset.i)];
      $('#pa-find').value = '';
      fillDraft(withGuess({ name: c.name, brand: c.brand, size: c.size, category: c.category, location: c.location, openDays: c.openDays ?? '' }));
      $('#h-f-details')?.scrollIntoView({ block: 'start' });
      announce(`${c.name} filled in`);
      return;
    }
    case 'sugg-own': {
      const v = $('#pa-find').value.trim();
      $('#pa-find').value = '';
      fillDraft({ name: v });
      const n = $('#pa-form [name="name"]'); n.focus(); return;
    }
    case 'sugg-mine': {
      const mine = itemById(b.dataset.id); if (!mine) return;
      S.draft = null; S.dirty = false;
      await goTo('#/item/' + mine.id, { replace: true });
      return openBought(mine);
    }
    case 'photo-del': return fillDraft({ pic: '', _pics: null });
    case 'shop-del': {
      e.preventDefault();
      const m = S.shop.get(b.dataset.id); if (!m) return;
      removeLine(m.id); redraw();
      return toast(`${m.name} removed`, { action: 'Undo', onAction: () => { restoreLine(m.id); redraw(); } });
    }
    case 'shop-mic': return listenShop(b);
    case 'put-away': return openPutAway();
    case 'shop-clear': {
      const gone = shopLines().filter(m => m.done);
      patchLines(gone.map(m => ({ id: m.id, ops: L.removeOps(who()) })));
      redraw();
      return toast(`Cleared ${plural(gone.length, 'ticked item')}`, { action: 'Undo', onAction: () => { patchLines(gone.map(m => ({ id: m.id, ops: L.restoreOps() }))); redraw(); } });
    }
    case 'share': {
      const text = L.shareText(shareLines());
      if (navigator.share) { try { await navigator.share({ text }); } catch { /* cancelled */ } return; }
      try { await navigator.clipboard.writeText(text); toast('Copied the list. Paste it into a message.'); } catch { toast('Couldn’t copy the list on this phone'); }
      return;
    }
    case 'csv': return download('pantry.csv', L.toCsv(items()), 'text/csv');
    case 'backup': {
      let photos;
      try { photos = await S.backend.list(PHOTOS); } catch (err) { return toast(S.cloud ? S.cloud.explain(err, 'The backup') : 'The backup didn’t work. Try again.'); }
      return download(`pantry-backup-${today()}.json`, JSON.stringify(L.backup({ items: [...S.items.values()], events: [...S.events.values()], shop: [...S.shop.values()], places: [...S.places.values()], settings: [...S.settings.values()], photos })), 'application/json');
    }
    case 'wipe': {
      if (!(await confirm({ title: 'Delete everything?', text: 'Every item, its history and the shopping list on this phone are deleted. This can’t be undone. A backup first keeps a copy.', ok: 'Delete everything', danger: true }))) return;
      await S.local.clear();
      for (const k of KINDS) S[k].clear();
      S.pics.clear();
      redraw(); return toast('Deleted everything on this phone');
    }
    case 'signin':
      try { await S.cloud.signIn(); } catch (err) { toast(S.cloud.explain(err, 'Sign-in')); }
      return;
    case 'email-open': return openEmailSheet();
    case 'merge-open': return openMerge();
    case 'verified': return checkVerified();
    case 'verify-resend':
      try { await S.cloud.resendVerification(); toast('Sent again. Check your email.'); } catch (err) { toast(S.cloud.explain(err, 'Sending it')); }
      return;
    case 'signout': {
      toast('Checking everything reached the family…');
      const ok = await S.cloud.synced(4000);
      hideToast();
      if (!ok && !(await confirm({ title: 'Sign out now?', text: 'Some changes on this phone haven’t reached the family yet (no signal?). Signing out now loses them. Wait for signal, then sign out.', ok: 'Sign out anyway', cancel: 'Wait', danger: true }))) return;
      let out;
      try { out = await S.cloud.signOut({ anyway: !ok }); } catch (err) { toast(S.cloud.explain(err, 'Signing out')); if (err?.code === 'signout-stopped') setTimeout(() => location.reload(), 1500); return; }
      toast('Signed out. This phone is back to its own pantry.');
      if (out?.reload) setTimeout(() => location.reload(), 400);   // the SDK's cache was cleared and its instance closed: start clean
      return;
    }
    case 'hh-create': {
      if (S.creating) return;   // a double tap, or a second try while the first is still going
      S.creating = true;
      try {
        // never a second pantry for someone already in one: ask the server right now (offline this throws, and nothing
        // is created: the create itself also needs the server)
        const had = await locate(S.user.email);
        if (had) { S.lookupFailed = false; await useHousehold(had); return toast('You’re already in a family pantry; it’s open now.'); }
        await useHousehold(await S.cloud.createHousehold(S.user.email, 'Our pantry'));
        toast('Family pantry started. Add the family below.');
      } catch (err) { toast(S.cloud.explain(err, 'Starting the family pantry')); }
      finally { S.creating = false; }
      return;
    }
    case 'hh-check': {
      try {
        const h = await locate(S.user.email);
        S.lookupFailed = false;
        if (!h) { redraw(); return toast('Not added yet. Ask whoever started it to add you.'); }
        await useHousehold(h);
      } catch (err) { S.lookupFailed = true; redraw(); toast(S.cloud.explain(err, 'Checking')); }
      return;
    }
    case 'person': return openPerson(b.dataset.v);
    case 'copy-up': {
      try {
        const data = L.keepLive(await splitAll({ ...(await S.local.load()), photos: await S.local.list(PHOTOS) }));   // not what was removed over 30 days ago
        data.places = mergedPlaces(data);   // the family's places first, then any only this phone had (the old list on this phone too)
        data.settings = [];
        await S.backend.putMany(PHOTOS, data.photos);   // photos first, so no item points at a missing photo
        for (const k of KINDS) await S.backend.putMany(k, data[k]);
        for (const k of KINDS) for (const o of data[k]) S[k].set(o.id, adopt(k, o));
        await S.local.clear();
        S.localCount = 0; redraw();
        toast(`Copied ${plural(data.items.length, 'item')} into the family pantry`);
      } catch (err) { toast(S.cloud.explain(err, 'Copying')); }
      return;
    }
  }
}

// A document as the app holds it once it has been written whole (items: the map shape, nothing left to convert).
const adopt = (kind, o) => (kind === 'items' ? L.normalizeItem(L.toStored(o)) : o);

// Places from a backup or this phone's own pantry, added after the pantry's own (merged by name): the place documents to write
// ([] when there is nothing new). `data` holds `places` (documents) and `settings` (an older file's single list).
const mergedPlaces = data => P.mergeInto({ docs: [...S.places.values()], legacy: S.settings.get(P.PLACES_ID) || null }, { docs: data.places || [], legacy: (data.settings || []).find(P.isPlacesDoc) || null });

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function onChange(e) {
  const t = e.target;
  if (t.name === 'pa-level') {
    const it = itemById(route().parts[1]); if (!it) return;
    const before = it, res = L.setLevel(it, { level: t.value, by: who() });
    const sent = patchItem(it.id, res.ops); const ev = save('events', res.event);
    const line = t.value !== 'plenty' ? addToList(res.item, { quiet: true }) : null;
    redraw();
    toast(`${it.name}: ${LEVEL_WORD[t.value].toLowerCase()}${line ? ', on the shopping list' : ''}`, { action: 'Undo', onAction: () => {
      undoItem(it.id, sent, before); remove('events', ev.id); if (line) removeLine(line.id); redraw(); announce('Undone');
    } });
    return;
  }
  if (t.name === 'pa-sort') {
    S.sort = t.value;
    prefs.set('sort', S.sort);
    return redraw();
  }
  if (t.dataset.bsel !== undefined) { const b = bulkState(); if (t.checked) b.sel.ids.add(t.dataset.bsel); else b.sel.ids.delete(t.dataset.bsel); return updateBulkUI(); }
  if (t.dataset.bk !== undefined) {
    if (t.dataset.bk === 'cat') { bulkState().cat = t.value; return drawBulkList(); }
    return bulkField(t.dataset.bk, t.value);
  }
  if (t.dataset.sel !== undefined) { if (t.checked) S.sel.ids.add(t.dataset.sel); else S.sel.ids.delete(t.dataset.sel); return selChanged(); }
  if (t.id === 'pa-name') { prefs.set('name', t.value.trim()); return toast('Saved'); }
  if (t.dataset.shop) {
    const m = S.shop.get(t.dataset.shop); if (!m) return;
    patchLine(m.id, { set: { done: t.checked, ...(t.checked ? { doneBy: who().slice(0, 100) } : {}) }, inc: {}, del: [] });   // a tick is a field, so two phones ticking and removing never undo each other
    return redraw();
  }
  if (t.id === 'pa-photo-file' && t.files[0]) {
    const { pictures } = await import('./photo.js');
    try { const p = await pictures(t.files[0]); fillDraft({ pic: p.thumb, _pics: p }); } catch { toast('Couldn’t read that picture. Try another.'); }
    return;
  }
  if (t.id === 'pa-restore' && t.files[0]) {
    try {
      const data = L.parseBackup(await t.files[0].text());
      data.places = mergedPlaces(data);
      data.settings = [];   // (a backup holds no names; the old list of places became place documents just above)
      S.pics.clear();
      if (S.backend.putMany) {
        await splitAll(data);   // the family pantry takes only thumbnails on items
        await S.backend.putMany(PHOTOS, data.photos);
        for (const k of KINDS) await S.backend.putMany(k, data[k]);
      } else for (const p of data.photos) S.backend.put(PHOTOS, p);
      for (const k of KINDS) for (const o of data[k]) { if (S.backend.putMany) S[k].set(o.id, adopt(k, o)); else save(k, o); }
      redraw(); toast(`Restored ${plural(data.items.length, 'item')}`);
      migratePhotos();
    } catch (err) { toast(err?.message?.startsWith('That file') ? err.message : 'Couldn’t restore that file.'); }
    t.value = '';
  }
}
function onInput(e) {
  if (e.target.id === 'pa-q') { S.q = e.target.value; drawItemsList(); }
  if (e.target.id === 'pa-bq') { bulkState().q = e.target.value; drawBulkList(); }
  if (e.target.dataset?.bk === 'days') bulkField('days', e.target.value);
  if (e.target.id === 'pa-find') showSugg();
}
async function onSubmit(e) {
  if (e.target.id === 'pa-place-add') { e.preventDefault(); return addPlaceFromForm(); }
  if (e.target.id === 'pa-shop-add') {
    e.preventDefault();
    const inp = $('#pa-shop-text'), v = inp.value.trim();
    if (!v) return inp.focus();
    if (!addLine(v)) { toast(`${v} is already on the list`); return; }
    inp.value = '';
    redraw();
    $('#pa-shop-text')?.focus();
    return;
  }
  if (e.target.id === 'pa-member-add') {
    e.preventDefault();
    const v = $('#pa-member-email').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast('Type their email address');
    if (S.household.members.includes(v)) return toast(`${nameOf(v)} is already in the family pantry`);
    try {
      await setMembers([...S.household.members, v]);
      $('#pa-member-email').value = '';
      toast(`Added ${v}`, { action: 'Email invite', onAction: () => { location.href = inviteHref(v); }, ms: 10000 });
    } catch (err) { toast(S.cloud ? S.cloud.explain(err, 'Adding them') : 'Adding them didn’t work.'); }
  }
}

// An invite from the person's own mail app (no email server: the pantry never sends mail itself).
function inviteHref(email) {
  const from = who() || S.user?.name?.split(' ')[0] || '';
  const link = location.origin + location.pathname.replace(/[^/]*$/, '') + '#/settings';   // lands on Sign in
  const body = `Hi! I've added you to our family pantry, so we can all see what's at home, what to use first and what to buy.\n\n`
    + `1. Open ${link}\n2. Settings → Continue with Google (or Use email instead), using this email address (${email})\n3. Add it to your home screen: Safari's Share button → Add to Home Screen (iPhone), or Chrome's menu → Add to home screen (Android)`
    + (from ? `\n\n${from}` : '');
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Our family pantry')}&body=${encodeURIComponent(body)}`;
}

// ---- data sources ------------------------------------------------------------------------------------------------

function loadInto(data) {
  for (const k of KINDS) { S[k].clear(); for (const o of data[k] || []) S[k].set(o.id, k === 'items' ? L.normalizeItem(o) : o); }   // items: either shape of batches in, one out
  for (const it of S.items.values()) noteLanded(it);
}
// `list`: the kind's whole list as the engine has it (its copy, with this phone's unsent saves laid over it). S[kind] is
// made again from it each time, never patched by a difference, so the screen shows exactly that (a change made here
// shows at once and comes back the same from the outbox a moment later). `pending`: ids of these documents this phone
// has changes on that the server hasn't confirmed yet.
function onRemote(kind, list, pending = []) {
  const was = new Map(S[kind]), now = list.map(d => kind === 'items' ? L.normalizeItem(d) : d);
  S[kind].clear();
  for (const d of now) S[kind].set(d.id, d);
  if (kind === 'items') for (const d of now) if (L.isRemoved(d) && !L.isRemoved(was.get(d.id))) noteLanded(d, pending.includes(d.id));   // removed on another phone
  redraw();
  if (kind === 'items' && list.some(d => d.photo)) migratePhotos();
}
// ---- saving to the family: the chip, and what the server refused (sync.js) ----------------------------------------------

// What the sync button says now (only in a family pantry: on this phone alone there is nothing to wait for).
function syncView() {
  if (S.mode !== 'cloud') return null;
  const refused = SY.refusedFor(S.refused, S.household?.id || '').length, offline = navigator.onLine === false;
  const confirmed = !!S.sync.lastServerAt, persisted = S.sync.persisted !== false;   // (confirmed: the server has answered since the app opened)
  return SY.syncState({
    refused, pending: S.sync.pending, cache: S.sync.cache, offline, waited: S.sync.since ? Date.now() - S.sync.since : 0,
    recent: !!S.sync.lastServerAt && Date.now() - S.sync.lastServerAt < 10000, persisted, stale: !!S.sync.stale, confirmed,
    status: S.cloud.status?.({ online: !offline, pending: S.sync.pending, attention: refused, persisted, stale: !!S.sync.stale, confirmed }),
  });
}
// The sync button (the kit's syncButton, in the top bar): shown in a family pantry only; its words are pantry's own.
const SYNC_WORDS = { synced: 'Saved', pending: 'Saving…', offline: 'Waiting for signal', 'at-risk': 'Only on this phone', attention: 'Needs attention', unknown: 'Not checked with the family yet' };
const syncWatch = new Set(), refusedWatch = new Set();
const watch = set => fn => { set.add(fn); return () => set.delete(fn); };
const buttonStatus = () => { const v = syncView(); return v ? { state: v.state, count: v.count } : { state: 'synced', count: 0 }; };
// What the kit's parts read: the status for the button; the refused changes, kept on this phone (S.refused), for the list.
const syncApi = {
  status$: fn => { fn(buttonStatus()); return watch(syncWatch)(fn); },
  queue: {
    refused: () => SY.refusedFor(S.refused, S.household?.id || '').map(r => ({ key: r.n, record: r, code: SY.refusedReason(r.code).replace(/\.$/, '') })),
    retry: n => settleRefused(n, true),
    discard: n => settleRefused(n, false),
    onChange: watch(refusedWatch),
  },
};
const refusedText = r => SY.describeRefused(r, id => S.items.get(id)?.name);
let syncTimer = null, stopRefused = null;
function startSyncButton() {
  syncButton($('#sync-btn'), { sync: syncApi, syncNow: () => syncNow(), labels: SYNC_WORDS });
}
// Home's refused list (the kit's refusedList): put in again each time Home is drawn, as the screen's markup is new.
function drawRefusedList() {
  stopRefused?.(); stopRefused = null;
  const host = $('#refused-list');
  if (host && S.mode === 'cloud') stopRefused = refusedList(host, { sync: syncApi, text: refusedText });
}
function drawSync() {
  const b = $('#sync-btn'); if (b) b.hidden = S.mode !== 'cloud';
  const st = buttonStatus();
  for (const fn of syncWatch) fn(st);
  for (const fn of refusedWatch) fn();
}
// The cloud backend's count of this phone's unconfirmed changes (and whether it is showing its own copy). A change that
// stays unconfirmed for a moment turns the button to "Waiting for signal"; a normal save confirms before that.
function onSyncState(st) {
  const was = S.sync.pending;
  S.sync = { pending: st.pending, cache: st.cache, since: st.pending > 0 ? (was > 0 ? S.sync.since : Date.now()) : 0, list: st.list || [], heard: st.heard || S.sync.heard || 0, lastServerAt: st.lastServerAt || 0, relistens: st.relistens || 0, cycles: st.cycles || 0, stale: !!st.stale, persisted: st.persisted !== false };
  drawSync();
  adoptName();
  clearTimeout(syncTimer);
  if (st.pending > 0) syncTimer = setTimeout(drawSync, 1600);
}
// The server refused a write (info says which; none: a listener failed). The SDK has already put the screen back, so the
// change would vanish: keep a copy on this phone and say "Needs attention" until it is retried or discarded.
function onWriteError(err, info) {
  if (!info || !SY.keepable(info)) { S.cloud.discardRefused?.(info?.key); S.syncError = S.cloud.explain(err, 'Saving'); redraw(); return; }
  keepRefused(err, info);
}
function keepRefused(err, info) {
  const name = S[info.kind]?.get?.(info.id)?.name || info.obj?.name || '';
  const was = S.refused;
  S.refused = SY.addRefused(S.refused, { n: L.uid(), key: info.key || '', hid: S.household?.id || '', kind: info.kind, id: info.id, op: info.op, ops: info.ops, obj: info.obj, code: err?.code || '', at: new Date().toISOString(), name });
  for (const r of was) if (!S.refused.includes(r)) S.cloud.discardRefused?.(r.key);   // (the oldest ones dropped from a full list)
  prefs.set('refused', S.refused);
  drawSync(); redraw();
}
// Send a refused change again. A whole document goes as it was; a change goes as instructions to the item as it is now
// (false when the item is gone).
function replay(r) {
  if (r.op === 'del') { remove(r.kind, r.id); return true; }
  if (r.op === 'put') { if (r.kind === 'items') S.items.set(r.id, L.normalizeItem(L.toStored(r.obj))); else S[r.kind].set(r.id, r.obj); S.backend.put(r.kind, r.obj); return true; }
  const before = S[r.kind]?.get(r.id);
  if (!before) return false;
  S[r.kind].set(r.id, r.kind === 'items' ? L.applyOps(before, r.ops) : L.applyFieldOps(before, r.ops));
  S.backend.patch(r.kind, r.id, r.ops, { before });
  return true;
}
function settleRefused(n, retry) {
  const r = S.refused.find(x => x.n === n); if (!r) return;
  S.refused = SY.dropRefused(S.refused, n);
  prefs.set('refused', S.refused);
  S.cloud.discardRefused?.(r.key);
  if (retry && !replay(r)) toast('That item was removed on another phone, so there is nothing to change.');
  else if (retry) toast('Sent again');
  else toast('Dropped');
  drawSync(); redraw();
}

let unwatch = null;
async function useHousehold(h) {
  S.household = h; S.lost = null;
  prefs.set('household', h.id);
  S.backend?.close?.();
  S.sync = { pending: 0, cache: false, since: 0, list: [], heard: 0, lastServerAt: 0, relistens: 0, cycles: 0 }; S.syncNow = { busy: false, result: null };
  S.backend = await S.cloud.openCloud(h.id, onWriteError, onSyncState);
  S.mode = 'cloud';
  S.pics.clear();
  loadInto(await S.backend.load());
  migratePhotos();
  S.backend.listen(onRemote);
  setTimeout(sweep, 6000);   // once the first copy from the server is in
  unwatch?.();
  unwatch = await S.cloud.watchHousehold(h.id, x => onHouseholdDoc(h.id, x));
  S.localCount = (await S.local.load()).items.length;
  redraw();
}
// The household document changed (x), or is gone or can't be read any more (x is null: deleted or merged away by its owner, this
// account taken out of it, or the rules refused). Nothing is read from the phone's copy to decide: see householdLost.
function onHouseholdDoc(hid, x) {
  if (S.household?.id !== hid) return;   // an old listener, after the phone moved to another pantry
  if (x) { S.household = x; redraw(); } else householdLost(hid);
}
// The pantry this phone was showing is gone. Stop its listeners, ask the SERVER which pantries this account is in now (never the
// phone's copy: it would still say the old one is there), and move to the one left; with none, or no signal, say so plainly with
// Try again (a pantry is never started by mistake). Phone: "Your pantry changed", at most once at a time.
let losing = false;
async function householdLost(hid) {
  if (losing || !S.user || S.household?.id !== hid) return;
  losing = true;
  try {
    S.backend?.close?.();
    unwatch?.(); unwatch = null;
    let h = null, failed = false;
    try { h = await locate(S.user.email); } catch (e) { console.warn('household', e?.code); failed = true; }
    if (h) {
      await useHousehold(h);   // (the same pantry again if it was only unreadable for a moment)
      if (h.id !== hid) { toast(`Your pantry changed: now showing ${h.name}`); announce(`Your pantry changed. Now showing ${h.name}.`); }
      return;
    }
    await useLocal();
    S.lost = { at: Date.now(), failed };
    S.lookupFailed = failed;
    redraw();
  } finally { losing = false; }
}
async function useLocal() {
  S.backend?.close?.();
  unwatch?.(); unwatch = null;
  S.backend = S.local;
  S.mode = 'local';
  S.household = null; S.pantries = []; S.lookupFailed = false; S.syncError = false; S.lost = null;
  S.pics.clear();
  loadInto(await S.local.load());
  migratePhotos();
  redraw();
}

// ---- two family pantries for one account: merge them into one ---------------------------------------------------------

// The Settings card, only when this account is in more than one family pantry (a second "Start our family pantry"
// made a duplicate). Only an owner can delete a pantry, so someone else is asked to do it.
function mergeCard() {
  if (S.mode !== 'cloud' || S.pantries.length < 2) return '';
  const p = MG.plan(S.pantries, S.household?.id, me());
  const notMine = [...new Set(p.notMine.map(h => nameOf(h.owner)))];
  const body = p.notMine.length && !S.pantries.some(h => h.owner === me())
    ? `<li><div class="ui-row"><span class="ui-row-lead">${icon('alert')}</span><span class="ui-row-main"><span class="pa-row-title">You’re in more than one family pantry</span><span class="ui-row-sub pa-break">Ask ${esc(notMine.join(' or '))} to merge them.</span></span></div></li>`
    : `<li><button type="button" class="ui-row" data-tone="action" data-act="merge-open"><span class="ui-row-lead">${icon('alert')}</span><span class="ui-row-main"><span class="pa-row-title">You’re in more than one family pantry</span><span class="ui-row-sub">Merge them into one</span></span>${chevron()}</button></li>`;
  return section('Two family pantries', `<ul class="ui-list">${body}</ul>`, { id: 'merge', footer: 'The same email is in more than one family pantry, so you may see a different one on another phone. Merging moves everything into one.' });
}
// The merge sheet: each pantry (name, who started it, how many people), the one with the most people chosen to keep.
async function openMerge() {
  let all;
  try { all = await S.cloud.findHouseholds(me()); } catch (err) { return toast(S.cloud.explain(err, 'Looking')); }
  S.pantries = all;
  if (all.length < 2) { redraw(); return toast('There’s only one family pantry now.'); }
  let keep = S.cloud.pickHousehold(all, '').id;
  const s = sheet({ title: 'Merge family pantries', closeLabel: 'Cancel', grey: true, body: '', onClose: afterSheet });
  const body = $('.ui-sheet-body', s.el);
  const draw = () => {
    const p = MG.plan(all, keep, me());
    const rows = all.map(h => `<li><label class="ui-row pa-pick"><span class="ui-row-main"><span class="pa-row-title pa-break">${esc(h.name || 'Our pantry')}</span>
      <span class="ui-row-sub pa-break">${esc(plural((h.members || []).length, 'person', 'people'))} · started by ${esc(nameOf(h.owner))}</span></span>
      <input type="radio" name="pa-keep" value="${esc(h.id)}"${h.id === keep ? ' checked' : ''} aria-label="Keep ${esc(h.name || 'Our pantry')}, ${esc(plural((h.members || []).length, 'person', 'people'))}"></label></li>`).join('');
    const why = p.over ? `Together they have ${p.total} people and a family pantry holds ${MG.MAX_MEMBERS}. Remove some people first, then merge.`
      : p.notMine.length ? `Only whoever started a pantry can merge it away. Ask ${[...new Set(p.notMine.map(h => nameOf(h.owner)))].join(' or ')} to merge them.` : '';
    body.innerHTML = `<p class="pa-em-lead">Choose the one to keep. Everything in the others (items, history, shopping lists, photos, places, names and people) moves into it, then the others are deleted.</p>
      <ul class="ui-list" role="radiogroup" aria-label="Pantry to keep">${rows}</ul>
      ${why ? `<p class="pa-field-error" role="alert">${icon('alert')}<span>${esc(why)}</span></p>` : ''}
      <p class="ui-section-foot" id="pa-merge-msg" role="status"></p>
      <button type="button" class="ui-fill ui-wide" data-pm="go"${p.canMerge ? '' : ' disabled'}>Merge into this one</button>`;
  };
  draw();
  let busy = false;
  s.el.addEventListener('change', e => { if (e.target.name === 'pa-keep' && !busy) { keep = e.target.value; draw(); } });
  s.el.addEventListener('click', async e => {
    if (!e.target.closest('[data-pm="go"]') || busy) return;
    const p = MG.plan(all, keep, me());
    if (!p.canMerge) return;
    if (!(await confirm({ title: 'Merge and delete the others?', text: `${plural(p.others.length, 'other pantry', 'other pantries')} will be deleted after everything is copied into ${p.keep.name || 'Our pantry'}. This can’t be undone.`, ok: 'Merge', danger: true }))) return;
    busy = true;
    const say = t => { const m = $('#pa-merge-msg', s.el); if (m) m.textContent = t; };
    body.querySelectorAll('button, input').forEach(b => { b.disabled = true; });
    try {
      say('Copying…');
      for (const o of p.others) await S.cloud.copyHousehold(p.keep.id, o.id, p.members);   // any failure stops here: nothing deleted
      if (p.members.length !== (p.keep.members || []).length) await S.cloud.addMembers(p.keep.id, p.members);
      if (S.household?.id !== p.keep.id) await useHousehold({ ...p.keep, members: p.members });   // leave the ones about to go
      say('Removing the extra pantries…');
      for (const o of p.others) await S.cloud.removeHousehold(o.id);
      S.pantries = [{ ...p.keep, members: p.members }];
      await closeSheet(s.el);
      redraw();
      toast(`Merged. One family pantry now, with ${plural(p.members.length, 'person', 'people')}.`);
    } catch (err) {
      busy = false;
      say(`${S.cloud.explain(err, 'Merging')} Nothing was lost; the pantries are as they were, so you can try again.`);
      body.querySelectorAll('button, input').forEach(b => { b.disabled = false; });
    }
  });
  return s;
}

// ---- signing in by email (besides Google): an emailed link, or a password ----------------------------------------------

// Every change of who is signed in comes here. A new password account is `pending` until the emailed link has been
// tapped: no family lookup, no family data, nothing from Firestore (its rules need a verified email).
async function handleUser(u) {
  try { await whoIs(u); } finally { if (S.opening) { S.opening = false; redraw(); } }
}
async function whoIs(u) {
  S.pending = u && !u.verified ? u : null;
  S.user = u && u.verified ? u : null;
  if (!S.user) { if (S.mode !== 'local') await useLocal(); else redraw(); return; }
  let h = null;
  S.lookupFailed = false;
  try { h = await locate(S.user.email); } catch (e) { console.warn('household', e?.code); S.lookupFailed = true; }   // can't tell (no signal): never "none"
  if (h) await useHousehold(h); else redraw();
}
// Which family pantry this account opens: the one this phone used last, else the biggest. Every one it is in is kept in
// S.pantries (two means a duplicate to merge: Settings offers it).
async function locate(email) {
  const all = await S.cloud.findHouseholds(email);
  S.pantries = all;
  return S.cloud.pickHousehold(all, prefs.get('household') || '');
}
// "I've verified": reload the account and its token, then carry on as signed in (or say it isn't done yet).
async function checkVerified({ quiet = false } = {}) {
  try {
    const u = await S.cloud.refreshUser();
    if (!u) { if (!quiet) toast('Sign in again, please.'); return; }
    if (!u.verified) { if (!quiet) toast('Not yet. Tap the link in the email first, then try again.'); return; }
    await handleUser(u);
    toast('Verified. You’re signed in.');
  } catch (err) { if (!quiet) toast(S.cloud.explain(err, 'Checking')); }
}
// The one sheet for email: the address, then "Email me a sign-in link" or "Use a password" (Sign in, Create account,
// Forgot password). `confirm` is for an emailed link opened where the address wasn't saved: just ask for it.
function openEmailSheet({ confirm = false, onSubmit = null } = {}) {
  const C = S.cloud;
  let step = confirm ? 'confirm' : 'email', mail = C.savedEmail(), err = '', busy = false;
  const s = sheet({ title: confirm ? 'Finish signing in' : 'Sign in with email', closeLabel: 'Cancel', grey: true, body: '', onClose: afterSheet });
  const body = $('.ui-sheet-body', s.el);
  const emailField = (hint = '') => `<label class="pa-field"><span class="pa-field-label">Email</span>
      <input id="pa-em-email" name="email" type="email" value="${esc(mail)}" autocomplete="email" autocapitalize="off" spellcheck="false" inputmode="email" placeholder="you@example.com"${hint ? ' aria-describedby="pa-em-hint"' : ''}></label>${hint ? `<p class="ui-section-foot pa-em-hint" id="pa-em-hint">${hint}</p>` : ''}`;
  const errBox = () => `<p class="pa-field-error" id="pa-em-err" role="alert"${err ? '' : ' hidden'}>${icon('alert')}<span>${esc(err)}</span></p>`;
  const views = {
    email: () => `<form id="pa-em-form" novalidate>${emailField('Use the email the family added. No password needed: we email you a link that signs you in.')}${errBox()}
        <button type="submit" class="ui-fill ui-wide" data-pe="link">Email me a sign-in link</button>
        <button type="button" class="ui-tint ui-wide pa-em-second" data-pe="pw">Use a password</button></form>`,
    password: () => `<form id="pa-em-form" novalidate>${emailField()}
        <label class="pa-field"><span class="pa-field-label">Password</span>
          <input id="pa-em-pass" name="password" type="password" autocomplete="current-password" minlength="${C.MIN_PASSWORD}" aria-describedby="pa-em-phint"></label>
        <p class="ui-section-foot pa-em-hint" id="pa-em-phint">New here? Choose at least ${C.MIN_PASSWORD} characters, then tap Create account. We email a link to check the address.</p>${errBox()}
        <button type="submit" class="ui-fill ui-wide" data-pe="signin">Sign in</button>
        <button type="button" class="ui-tint ui-wide pa-em-second" data-pe="create">Create account</button>
        <div class="pa-em-links"><button type="button" class="ui-plain" data-pe="forgot">Forgot password?</button>
          <button type="button" class="ui-plain" data-pe="back">Email me a link instead</button></div></form>`,
    sent: () => `<div class="pa-em-note"><span class="ui-row-lead">${icon('mail')}</span><div><p class="pa-em-title">Check your email</p>
        <p>We sent a sign-in link to <strong class="pa-break">${esc(mail)}</strong>. Tap it on this phone and you’re in.</p>
        <p>On an iPhone the link may open in Safari instead of the home-screen app. That’s fine: you’ll be signed in there. In the home-screen app, use a password instead, or ask for the link from inside the home-screen app.</p></div></div>${errBox()}
      <button type="button" class="ui-fill ui-wide" data-pe="link">Send it again</button>
      <button type="button" class="ui-tint ui-wide pa-em-second" data-pe="pw">Use a password instead</button>`,
    reset: () => `<div class="pa-em-note"><span class="ui-row-lead">${icon('mail')}</span><div><p class="pa-em-title">Check your email</p>
        <p>We sent a link to <strong class="pa-break">${esc(mail)}</strong>. Open it, choose a new password, then come back and sign in.</p></div></div>
      <button type="button" class="ui-fill ui-wide" data-pe="pw">Back to sign in</button>`,
    confirm: () => `<form id="pa-em-form" novalidate><p class="pa-em-lead">You opened a sign-in link. Type the email it was sent to, to finish.</p>${emailField()}${errBox()}
        <button type="submit" class="ui-fill ui-wide" data-pe="finish">Sign in</button></form>`,
  };
  const draw = (focus = true) => {
    body.innerHTML = views[step]();
    if (focus) requestAnimationFrame(() => (step === 'password' && mail ? $('#pa-em-pass', body) : $('#pa-em-email', body))?.focus({ preventScroll: true }));
  };
  const fail = e => { err = step === 'confirm' && e?.code === 'auth/invalid-email' && C.goodEmail(mail) ? 'That isn’t the email the link was sent to. Check it and try again.' : C.explain(e, 'That'); const box = $('#pa-em-err', body); if (box) { box.hidden = false; box.lastElementChild.textContent = err; } };
  const run = async fn => {
    if (busy) return; busy = true; err = '';
    const box = $('#pa-em-err', body); if (box) box.hidden = true;
    body.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try { await fn(); } catch (e) { fail(e); }
    busy = false;
    body.querySelectorAll('button').forEach(b => { b.disabled = false; });
  };
  const read = () => { const i = $('#pa-em-email', body); if (i) mail = i.value.trim(); return mail; };
  const act = {
    link: () => run(async () => { mail = (read() || mail).toLowerCase(); await C.sendLink(mail); step = 'sent'; draw(); }),
    pw: () => { read(); step = 'password'; err = ''; draw(); },
    back: () => { read(); step = 'email'; err = ''; draw(); },
    signin: () => run(async () => { await C.passwordSignIn(read(), $('#pa-em-pass', body).value); await closeSheet(s.el); }),
    create: () => run(async () => {
      await C.passwordCreate(read(), $('#pa-em-pass', body).value);
      await closeSheet(s.el);
      toast('Check your email and tap the link, then come back.');
    }),
    forgot: () => run(async () => { await C.resetPassword(read()); step = 'reset'; draw(); }),
    finish: () => run(async () => { if (await onSubmit(read())) await closeSheet(s.el); }),
  };
  s.el.addEventListener('click', e => { const b = e.target.closest('[data-pe]'); if (b && b.type !== 'submit') act[b.dataset.pe]?.(); });
  s.el.addEventListener('submit', e => {
    e.preventDefault();
    const b = e.submitter?.dataset.pe || (step === 'password' ? 'signin' : step === 'confirm' ? 'finish' : 'link');
    act[b]?.();
  });
  draw();
  return s;
}
// A link from the sign-in email opened this page: finish with the saved address, or ask for it (the link was opened in
// another browser, such as Safari instead of the home-screen app). The link's query comes off the address afterwards.
async function finishEmailLink() {
  const C = S.cloud;
  let isLink = false;
  try { isLink = await C.isEmailLink(); } catch { return; }
  if (!isLink) return;
  const href = location.href;
  let used = false;
  const tidy = () => { used = true; history.replaceState(history.state, '', C.stripLinkParams(href)); };
  const attempt = async email => {
    try { await C.finishLink(email, href); tidy(); toast('Signed in.'); return true; }
    catch (err) {
      if (err?.code === 'auth/invalid-email') throw err;   // wrong address: let them retype it
      tidy(); toast(C.explain(err, 'Signing in')); return true;
    }
  };
  const saved = C.savedEmail();
  if (saved) { try { if (await attempt(saved)) return; } catch { /* the saved address was wrong: ask */ } }
  // closing the sheet steps back in history, so the address is tidied again once it has gone
  openEmailSheet({ confirm: true, onSubmit: attempt }).closed.then(sheetsSettled).then(() => { if (used) tidy(); });
}

// ---- start ----------------------------------------------------------------------------------------------------

let R = null;
async function start() {
  startSyncButton();
  if (DEMO) {
    S.local = S.backend = openMemory({ ...sampleData(demoBy, { removed: true }), settings: [PP.peopleDoc(DEMO_NAMES)] });   // (with its places as documents, one of them removed)
    S.household = { ...DEMO_FAMILY };
  } else {
    try { S.local = await openLocal(); }
    catch { S.local = openMemory(); toast('This browser can’t save here (private mode?). Changes last until you close it.'); }
    S.backend = S.local;
  }
  loadInto(await S.backend.load());
  // Since you last looked: from this phone's last visit (the demo pretends four days ago); then this visit counts
  if (DEMO) S.since = new Date(Date.now() - 4 * 86400000).toISOString();
  else { S.since = prefs.get('lastSeen'); prefs.set('lastSeen', new Date().toISOString()); }
  document.addEventListener('visibilitychange', () => {
    if (DEMO) return;
    if (document.visibilityState === 'hidden') prefs.set('lastSeen', new Date().toISOString());
    else { S.since = prefs.get('lastSeen'); prefs.set('lastSeen', new Date().toISOString()); redraw(); }
  });
  setTimeout(migratePhotos, 1000);   // old-style photos move out quietly, after the first screen is drawn
  if (!DEMO) setTimeout(sweep, 4000);   // (this phone's own pantry; the family's runs once it is open)
  // selecting: a press and hold on a row (select.js), Escape and Back leave it; Enter ticks a row's checkbox like Space does
  SEL.holdToSelect($('#main'), {
    start: el => { if (!S.sel.on && screen() === 'items') enterSelect(el.closest('li')?.dataset.id || ''); },
    haptic: () => haptic('long'),
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && S.sel.on && !sheetOpen()) { e.preventDefault(); exitSelect(); }
    else if (e.key === 'Enter' && e.target.matches?.('input.pa-sel, input.pa-bsel')) { e.preventDefault(); e.target.click(); }
    else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.matches?.('.pa-grip') && sortMode() === 'myorder' && !e.altKey && !e.metaKey && !e.ctrlKey) {
      // on a grip in My order, the arrow keys move the item one step (and say where it went)
      e.preventDefault();
      const r = moveStep(e.target.dataset.id, e.key === 'ArrowUp' ? -1 : 1);
      if (r) { announce(r.text); if (r.moved) { redraw(); document.getElementById('pa-grip-' + e.target.dataset.id)?.focus({ preventScroll: false }); } }
    }
  });
  addEventListener('popstate', () => { if (S.sel.on && !history.state?.paSelect) exitSelect({ pop: false }); });
  document.addEventListener('pointerdown', onGripDown);
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('submit', onSubmit);
  // the listener watchdog (cloud.js, listen-watch.js): a moment the phone came back is when a dead listener is most likely
  const resumed = () => { try { S.backend?.nudge?.('resume'); } catch { /* not listening */ } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resumed(); });
  addEventListener('pageshow', resumed);
  addEventListener('online', () => { resumed(); if (S.user && !S.household && S.lookupFailed && S.cloud) handleUser(S.user); else redraw(); });
  addEventListener('offline', () => { drawSync(); redraw(); });
  R = router({
    render: r => draw(r),
    tabOf: r => ['item', 'edit', 'add', 'guide', 'places', 'removed', 'bulk'].includes(r.parts[0]) ? S.originTab : r.hash,
  });
  // family sharing, only when a Firebase project is set up (config.js) or in the emulator tests
  if (!DEMO && (firebaseConfig || EMULATOR)) {
    try {
      S.cloud = await import('./cloud.js');
      if (S.cloud.configured) {
        if (EMULATOR) window.__pantry = { S, signIn: S.cloud.emulatorSignIn };
        S.cloud.onUser(handleUser).catch(() => { /* no signal on the very first open: stays on this phone's pantry */ S.opening = false; redraw(); });
        // never wait for ever (sign-in itself stuck): after a while this phone's own pantry shows as it is
        if (S.opening) setTimeout(() => { if (S.opening) { S.opening = false; redraw(); } }, 8000);
        finishEmailLink();
        // someone verified their email in the mail app and came back: carry on without asking
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.pending) checkVerified({ quiet: true }); });
      } else S.opening = false;
    } catch { /* sharing unavailable (no signal on the first open) */ S.opening = false; }
    redraw();
  } else S.opening = false;
  if ('serviceWorker' in navigator && !EMULATOR) {
    // no offline copy in a private window: the app still runs. A new version reloads the page only when no sheet or form is
    // open, nobody is typing or dragging and nothing is waiting to be sent.
    startUpdates({
      canReload: () => SY.reloadAllowed({
        pending: S.cloud?.pending?.() || 0, sheet: sheetOpen(), draft: ['add', 'edit'].includes(screen()), dragging: !!S.dragging,
        typing: !!document.activeElement?.matches?.('input:not([type=checkbox]):not([type=radio]), textarea, [contenteditable]'),
      }),
      beforeReload: () => S.cloud?.synced?.(1500),
    });
  }
  window.__pantry = { ...(window.__pantry || {}), S, redraw, places: () => placeList().map(e => e.name), ...(EMULATOR ? { act: testActions, synced: ms => S.cloud.synced(ms), kick: () => S.cloud.kick() } : {}) };
  setTimeout(maybeWelcome, 300);
}

// The emulator tests (never the live app) drive the same code the buttons do, so a randomised run can make hundreds of
// changes quickly. Each returns the instructions it sent ({ ops, event }) for the test to add up.
const testActions = {
  use: (id, batchId = null) => apply(L.takeOut(S.items.get(id), { type: 'use', by: who(), batchId }), 'Used 1'),
  add: (id, qty = 1, expiry = null, batchId = undefined) => apply(L.addStock(S.items.get(id), { qty, expiry, by: who(), ...(batchId ? { id: batchId } : {}) }), 'Added'),
  open: (id, batchId = null) => apply(L.openOne(S.items.get(id), { by: who(), batchId }), 'Opened'),
  set: (id, k, v) => patchItem(id, { set: { [k]: v }, inc: {}, del: [] }),
  undo: () => { const u = S.lastUndo; S.lastUndo = null; return u?.() || null; },
  remove: id => removeItem(id), restore: id => restoreItem(id),
  addLine: (name, itemId = null) => newLine(name, itemId).id,
  tick: (id, done) => patchLine(id, { set: { done, ...(done ? { doneBy: 'test' } : {}) }, inc: {}, del: [] }),
  removeLine: id => removeLine(id), restoreLine: id => restoreLine(id),
  rename: (id, name) => patchLine(id, { set: { name }, inc: {}, del: [] }),
  sweep: () => sweep({ force: true }),
  // names and places (PR-C): one person's name, and place documents, by the same functions the sheets call
  namePerson: (email, name) => { setPersonName(email, name); return true; },
  addPlace: name => addPlace(name).id,
  renamePlace: (id, to) => { const e = placeList().find(x => x.id === id); if (e) renamePlaceDoc(e, to); return !!e; },
  reorderPlace: (id, dir) => { const e = placeList().find(x => x.id === id); return e ? movePlace(e, dir) : 0; },
  removePlace: id => { const e = placeList().find(x => x.id === id); if (e) removePlace(e); return !!e; },
  restorePlace: id => { restorePlaces([id]); return true; },
  // the Items list (this PR): move items to a place in one batch, put one after another in My order, and tidy a category's numbers
  bulkMove: (ids, place) => moveItems(ids.map(itemById).filter(Boolean), place).sent.length,
  reorder: (id, afterId = null) => { const r = commitOrder(id, afterId); return r ? { sets: r.plan.sets, renumbered: r.plan.renumbered } : null; },
  bulkPlan: (ids, ch) => BI.plan(ids.map(itemById).filter(Boolean), ch, { onList, by: who() }).changing,
  renumber: category => { const g = items().filter(x => catOf(x) === category); const sets = O.renumber(O.sortByOrder(g)); patchMany(sets.map(x => ({ id: x.id, ops: { set: { order: x.order }, inc: {}, del: [] } })), { stamp: false }); return sets.length; },
};

// ---- the welcome, once per phone (guide.js) -------------------------------------------------------------------------

// Someone opening an invite: the email's link ends #/settings, where Sign in is.
const INVITED = /^#\/settings/.test(location.hash);
function maybeWelcome() {
  if (!WELCOME) {
    if (DEMO || EMULATOR || welcomed()) return;
    // already using the app on this phone (from before the welcome existed): never interrupt them
    if (S.items.size || prefs.get('household') || prefs.get('name')) { markWelcomed(); return; }
  }
  if (sheetOpen() || ['add', 'edit'].includes(screen())) return;
  // a first-time user: the Getting started checklist goes on Home too (never for anyone already using the app)
  if (!DEMO && prefs.get('tour') == null) { prefs.set('tour', 'on'); redraw(); }
  showWelcome({ invited: INVITED && !S.user, save: !DEMO });
}
function showWelcome({ invited = false, save = true } = {}) {
  openWelcome({
    invited, save, signedIn: !!S.user,
    onDone: v => {
      afterSheet();
      if (v === 'add') goTo('#/add');
      else if (v === 'start') openStarter();
      else if (v === 'signin') {
        (screen() !== 'settings' ? goTo('#/settings') : Promise.resolve()).then(() => requestAnimationFrame(() => $('[data-act="signin"]')?.focus()));
      }
    },
  });
}
start();
