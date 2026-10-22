import { applyOps, applyFieldOps, toStored } from './logic.js';

// Storage backends. All three give the same small interface, so the app doesn't care where data lives:
//   load()                 -> { items: [], events: [], shop: [], places: [], settings: [] }   (never the photos: see photo.js)
//   get(kind, id)          one document, or null (the full photo of an item, fetched when the item is opened)
//   list(kind)             every document of one kind (backups and copying photos into the family pantry)
//   put(kind, obj)         save one document (obj.id is its key); returns false when it was refused
//   del(kind, id)          delete one document
//   patch(kind, id, ops)   change one item by instructions (logic.js applyOps: set a field, add to a number, remove a
//                          field or batch), never by rewriting it from a copy; the same result on all three backends
//   patchMany(kind, list)  [{ id, ops }] at once
//   purge(kind, id, cutoff) delete an item or shopping line for good, only if it is still removed (removedAt before the
//                          ISO time `cutoff`); true when deleted (the sweep: logic.js sweepDue)
//   delMany(kind, ids)     delete several documents (the history of a purged item)
//   listen(cb)             cb(kind, docs, removedIds) when another device changes something (cloud only)
// Items go in as the map shape of batches (logic.js toStored) and come out as they were stored (either shape): the app
// runs every item through normalizeItem when it loads or hears of one.
// The local backend keeps everything in this browser's IndexedDB (nothing leaves the phone).
// The memory backend (demo mode, ?demo) keeps made-up items in memory only: nothing is saved anywhere.
// The cloud backend (cloud.js) keeps the family's shared copy in Firestore.

// KINDS are loaded in full and kept in memory (places: one document each, places.js; settings holds small documents: `people`,
// the names the family gives its members, people.js, changed one name at a time by a keyed instruction (logic.js), and the old
// single `places` list that a household without place documents still shows); photos (one per item with a picture, photos/<item id>) are read one at
// a time, when their item is opened.
export const KINDS = ['items', 'events', 'shop', 'places', 'settings'];
export const PHOTOS = 'photos';
export const ALL_KINDS = [...KINDS, PHOTOS];
const DB = 'pantry', STORE = 'docs', VER = 1;

// A document after instructions: an item with batches (stored as the map), anything else (a shopping line, a place, the names) field by field.
const changed = (kind, doc, ops) => (kind === 'items' ? toStored(applyOps(doc, ops)) : applyFieldOps(doc, ops));

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = (db, mode, fn) => new Promise((res, rej) => {
  const t = db.transaction(STORE, mode);
  const out = fn(t.objectStore(STORE));
  t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
  t.onerror = () => rej(t.error);
});

export async function openLocal() {
  const db = await idb();
  return {
    kind: 'local',
    async load() {
      const all = await new Promise((res, rej) => {
        const out = [];
        const t = db.transaction(STORE, 'readonly');
        const c = t.objectStore(STORE).openCursor();
        c.onsuccess = () => { const x = c.result; if (x) { out.push([x.key, x.value]); x.continue(); } };
        t.oncomplete = () => res(out);
        t.onerror = () => rej(t.error);
      });
      const data = Object.fromEntries(KINDS.map(k => [k, []]));
      for (const [k, v] of all) {
        const kind = String(k).split('/')[0];
        if (data[kind]) data[kind].push(v);
      }
      return data;
    },
    get: (kind, id) => new Promise((res, rej) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(`${kind}/${id}`);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror = () => rej(r.error);
    }),
    list: kind => new Promise((res, rej) => {
      const range = IDBKeyRange.bound(kind + '/', kind + '/\uffff');
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(range);
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    }),
    put: (kind, obj) => tx(db, 'readwrite', s => s.put(kind === 'items' ? toStored(obj) : obj, `${kind}/${obj.id}`)),
    // read, change, write in one transaction (nothing else can slip in between)
    patch: (kind, id, ops) => new Promise((res, rej) => {
      const t = db.transaction(STORE, 'readwrite'), st = t.objectStore(STORE), r = st.get(`${kind}/${id}`);
      r.onsuccess = () => { st.put(changed(kind, r.result || { id }, ops), `${kind}/${id}`); };
      t.oncomplete = () => res(true);
      t.onerror = () => rej(t.error);
    }),
    async patchMany(kind, list) { for (const x of list) await this.patch(kind, x.id, x.ops); },
    del: (kind, id) => tx(db, 'readwrite', s => s.delete(`${kind}/${id}`)),
    delMany(kind, ids) { return Promise.all(ids.map(id => this.del(kind, id))); },
    purge: (kind, id, cutoff) => new Promise((res, rej) => {
      const t = db.transaction(STORE, 'readwrite'), st = t.objectStore(STORE), r = st.get(`${kind}/${id}`);
      let gone = false;
      r.onsuccess = () => { const d = r.result; if (d && typeof d.removedAt === 'string' && d.removedAt < cutoff) { st.delete(`${kind}/${id}`); gone = true; } };
      t.oncomplete = () => res(gone);
      t.onerror = () => rej(t.error);
    }),
    clear: () => tx(db, 'readwrite', s => s.clear()),
    listen() {},
  };
}

// Demo mode: everything in memory, gone on reload.
export function openMemory(seed = {}) {
  const data = Object.fromEntries(ALL_KINDS.map(k => [k, new Map((seed[k] || []).map(o => [o.id, o]))]));
  return {
    kind: 'memory',
    async load() { return Object.fromEntries(KINDS.map(k => [k, [...data[k].values()]])); },
    async get(kind, id) { return data[kind].get(id) ?? null; },
    async list(kind) { return [...data[kind].values()]; },
    put(kind, obj) { data[kind].set(obj.id, kind === 'items' ? toStored(obj) : obj); },
    patch(kind, id, ops) { data[kind].set(id, changed(kind, data[kind].get(id) || { id }, ops)); return true; },
    patchMany(kind, list) { for (const x of list) this.patch(kind, x.id, x.ops); },
    del(kind, id) { data[kind].delete(id); },
    delMany(kind, ids) { for (const id of ids) data[kind].delete(id); },
    async purge(kind, id, cutoff) { const d = data[kind].get(id); if (d && typeof d.removedAt === 'string' && d.removedAt < cutoff) { data[kind].delete(id); return true; } return false; },
    async clear() { for (const k of ALL_KINDS) data[k].clear(); },
    listen() {},
  };
}

// Small per-device settings (not shared with the family): which mode, the household id, display name.
export const prefs = {
  get(k, d = null) { try { const v = localStorage.getItem('pantry:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pantry:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem('pantry:' + k); } catch { /* private mode */ } },
};
