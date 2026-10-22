// The page the live-service harness drives (one per simulated phone). It runs the pantry's real sync code (js/cloud.js,
// js/logic.js) directly, with no UI, and exposes window.H to the Playwright script (live-multidevice.mjs). The actions
// copy what the app's buttons do (app.js patchItem / apply / patchLine), so what reaches Firestore is what a phone sends.
//
// Safety: it only runs on localhost, takes the household id from the harness and refuses anything that doesn't start with
// `robust-test-` (live-lib.mjs); every document path here comes from docPath(), so no other household can be touched.
import * as C from '../js/cloud.js';
import * as L from '../js/logic.js';
import { assertTestHousehold, docPath, collPath, localHost, qtyMap } from './live-lib.mjs';

if (!localHost(location.hostname)) throw new Error('the live-service harness page only runs on localhost');

let hid = null, cloud = null, label = 'x';
const KINDS = ['items', 'events', 'shop', 'settings'];
const S = Object.fromEntries(KINDS.map(k => [k, new Map()]));     // what this phone shows (items normalized, as the app holds them)
const RAW = Object.fromEntries(KINDS.map(k => [k, new Map()]));   // the documents as the SDK delivered them (raw quantities, stored shape)
const T = { writes: 0, listenReads: 0, syncCalls: 0 };
let sync = { pending: 0, cache: true };
const syncLog = [];
const acks = [];
const refused = [];
const nowIso = () => new Date().toISOString();
const who = () => 'robust-' + label;

const onSync = s => { sync = s; T.syncCalls++; syncLog.push([Math.round(performance.now()), s.pending, s.cache ? 1 : 0]); if (syncLog.length > 300) syncLog.shift(); };
const onError = (e, info) => { refused.push({ code: String(e?.code || e?.name || 'error'), op: info?.op || '', kind: info?.kind || '', id: info?.id || '', at: Math.round(performance.now()) }); };
// the last few things the page heard about each document (to explain a stale screen): [ms, quantities, waiting-to-send?]
const TRACE = new Map();
const SH = { full: new Map(), chg: new Map(), off: null };
function onRemote(kind, docs, removed, pending = []) {
  for (const d of docs) {
    const key = kind + '/' + d.id, tr = TRACE.get(key) || [];
    tr.push([Math.round(performance.now()), kind === 'items' ? JSON.stringify(qtyMap(d)) : JSON.stringify([d.done, d.removedAt || null]), pending.includes(d.id) ? 1 : 0]);
    if (tr.length > 8) tr.shift();
    TRACE.set(key, tr);
    RAW[kind].set(d.id, d);
    S[kind].set(d.id, kind === 'items' ? L.normalizeItem(d) : d);
  }
  for (const id of removed) { RAW[kind].delete(id); S[kind].delete(id); }
  T.listenReads += Math.max(0, docs.length - pending.length) + removed.length;
}

// every write the phone issues is tracked: did the server take it (true), refuse it (false), or is it still waiting
function track(name, p) {
  T.writes++;
  const e = { name, state: 'pending', t0: performance.now(), ms: null, p };
  acks.push(e);
  Promise.resolve(p).then(ok => { e.state = ok === false ? 'refused' : 'ok'; e.ms = Math.round(performance.now() - e.t0); }, err => { e.state = 'error:' + (err?.code || err?.name); e.ms = Math.round(performance.now() - e.t0); });
  return p;
}

function patchItem(id, ops, { stamp = true } = {}) {
  const before = S.items.get(id);
  if (!before) return null;
  const sent = stamp ? L.mergeOps(ops, { set: { updatedAt: nowIso(), updatedBy: who() } }) : ops;
  S.items.set(id, L.applyOps(before, sent));
  track(`patch items/${id}`, cloud.patch('items', id, sent, { before }));
  return sent;
}
function patchLine(id, ops) {
  const before = S.shop.get(id);
  if (!before) return null;
  S.shop.set(id, L.applyFieldOps(before, ops));
  track(`patch shop/${id}`, cloud.patch('shop', id, ops, { before }));
  return ops;
}
function apply(res) {
  if (!res.event) return null;
  const sent = patchItem(res.item.id, res.ops);
  if (!sent) return null;
  S.events.set(res.event.id, res.event);
  track(`put events/${res.event.id}`, cloud.put('events', res.event));
  return { ops: sent, event: res.event };
}
const itemBase = { category: 'Other', location: 'Fridge', brand: '', size: '', barcode: '', lowAt: 0, openDays: 7, createdAt: '2026-10-16T00:00:00.000Z', createdBy: 'robust' };

const act = {
  use: (id, batchId = null) => S.items.has(id) ? apply(L.takeOut(S.items.get(id), { type: 'use', by: who(), batchId })) : null,
  add: (id, qty = 1, expiry = null, batchId = undefined) => S.items.has(id) ? apply(L.addStock(S.items.get(id), { qty, expiry, by: who(), ...(batchId ? { id: batchId } : {}) })) : null,
  open: (id, batchId = null) => S.items.has(id) ? apply(L.openOne(S.items.get(id), { by: who(), batchId })) : null,
  set: (id, k, v) => patchItem(id, { set: { [k]: v }, inc: {}, del: [] }),
  // an increment on one batch with no event (the probe scenarios)
  inc: (id, batchId, n) => patchItem(id, { set: {}, inc: { [`batches.${batchId}.qty`]: n }, del: [] }, { stamp: false }),
  remove: id => patchItem(id, L.removeOps(who()), { stamp: false }),
  restore: id => patchItem(id, L.restoreOps(), { stamp: false }),
  // a new item, whole, as the app saves a new one
  newItem: item => {
    const obj = { ...L.normalizeItem({ ...itemBase, ...item }), _arr: false, updatedAt: nowIso(), updatedBy: who() };
    S.items.set(obj.id, L.normalizeItem(obj));
    track(`put items/${obj.id}`, cloud.put('items', obj));
    return true;
  },
  addLine: (id, name) => {
    const o = { id, name: String(name).slice(0, 80), itemId: null, done: false, at: nowIso(), by: who() };
    S.shop.set(id, o);
    track(`put shop/${id}`, cloud.put('shop', o));
    return true;
  },
  tick: (id, done) => patchLine(id, { set: { done, ...(done ? { doneBy: 'robust' } : {}) }, inc: {}, del: [] }),
  removeLine: id => patchLine(id, L.removeOps(who())),
  restoreLine: id => patchLine(id, L.restoreOps()),
};

// Raw writes for the rules checks and the old-shape scenario: { __inc: n } and { __del: true } stand for increment() and
// deleteField(). Resolves { ok: true } or { ok: false, code } (the call waits for the server's answer).
async function rawWrite({ op, kind, id, data = {}, merge = false }) {
  const { F, db } = await C.sdk();
  const ref = F.doc(db, ...docPath(hid, kind, id).split('/'));
  const conv = v => Array.isArray(v) ? v.map(conv)
    : v && typeof v === 'object' ? ('__inc' in v ? F.increment(v.__inc) : '__del' in v ? F.deleteField() : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)])))
    : v;
  const d = conv(data);
  T.writes++;
  try {
    if (op === 'set') await F.setDoc(ref, d, merge ? { merge: true } : {});
    else if (op === 'update') await F.updateDoc(ref, d);
    else throw new Error('bad op');
    return { ok: true };
  } catch (e) { return { ok: false, code: String(e?.code || e?.name || 'error') }; }
}

window.H = {
  ready: true,
  setHousehold(h, who2) { assertTestHousehold(h); hid = h; label = who2 || label; return true; },
  async signIn(email, password) {
    try {
      await C.passwordSignIn(email, password);
      const { auth } = await C.sdk();
      return { ok: !!auth.currentUser, verified: auth.currentUser?.emailVerified === true };
    } catch (e) { return { ok: false, code: String(e?.code || e?.name || 'error') }; }
  },
  // after a reload: the SDK restores the signed-in account from the phone's storage without a network call
  async restoreAuth(ms = 8000) {
    const { auth } = await C.sdk();
    await Promise.race([auth.authStateReady(), new Promise(r => setTimeout(r, ms))]);
    return !!auth.currentUser;
  },
  async token() { const { auth } = await C.sdk(); return auth.currentUser.getIdToken(); },
  // start listening to the household, as the app does (openCloud + listen); resolves when the four listeners have reported
  // (and, online, when the phone is no longer showing only its own copy), or after `ms`
  async open({ ms = 20000, wantServer = true } = {}) {
    assertTestHousehold(hid);
    if (cloud) cloud.close();
    for (const k of KINDS) { S[k].clear(); RAW[k].clear(); }
    syncLog.length = 0; T.syncCalls = 0;
    cloud = await C.openCloud(hid, onError, onSync);
    cloud.listen(onRemote);
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (T.syncCalls >= 4 && (!wantServer || !sync.cache)) break;
      await new Promise(r => setTimeout(r, 50));
    }
    return { ms: Math.round(performance.now() - t0), syncCalls: T.syncCalls, cache: sync.cache, pending: sync.pending };
  },
  close() { cloud?.close(); cloud = null; return true; },
  act(name, ...args) { if (!(name in act)) throw new Error('no action ' + name); return act[name](...args); },
  // the same, then wait for the server's answer to the write it made (true: taken; false: refused)
  async actAwait(name, ...args) {
    const n = acks.length;
    const r = act[name](...args);
    if (acks.length > n) await acks[acks.length - 1].p.catch(() => {});
    return r;
  },
  // a raw write started but not waited for (queued while offline): its fate shows in acks()
  rawFire(spec) { T.writes--; track(`raw ${spec.op} ${spec.kind}/${spec.id}`, rawWrite(spec).then(r => r.ok)); return true; },
  rawWrite,
  // what this phone shows now: raw quantities by batch, name, removal, the stored shape; shop lines; event ids
  state() {
    const items = {};
    for (const [id, d] of RAW.items) items[id] = { name: d.name, removed: L.isRemoved(d), removedBy: d.removedBy ?? null, arr: Array.isArray(d.batches), qty: qtyMap(d) };
    const shop = {};
    for (const [id, d] of RAW.shop) shop[id] = { done: !!d.done, removed: L.isRemoved(d), name: d.name };
    return { items, shop, events: [...RAW.events.keys()], settings: [...RAW.settings.keys()] };
  },
  // the same item as the app reads it (normalizeItem): batches by id with quantities clamped to 0 or more
  normalized(id) {
    const it = S.items.get(id);
    return it ? { qty: Object.fromEntries(it.batches.map(b => [b.id, b.qty])), arr: it._arr, name: it.name } : null;
  },
  // what the SDK's own cache holds for a document (no server read), to tell a stale page from a stale cache
  async cacheDoc(kind, id) {
    const { F, db } = await C.sdk();
    try { const s = await F.getDocFromCache(F.doc(db, ...docPath(hid, kind, id).split('/'))); return s.exists() ? s.data() : null; }
    catch { return undefined; }
  },
  // for a stale document: what each way of asking the SDK says (its cache by document, its cache by collection query, the
  // server by document) and what the page holds
  async probe(kind, id) {
    const { F, db } = await C.sdk();
    const ref = F.doc(db, ...docPath(hid, kind, id).split('/'));
    const q = d => d ? (kind === 'items' ? qtyMap(d) : { done: d.done, removedAt: d.removedAt || null }) : null;
    const out = { page: q(RAW[kind].get(id)) };
    try { const s = await F.getDocFromCache(ref); out.docFromCache = q(s.exists() ? s.data() : null); out.docFromCachePending = s.metadata.hasPendingWrites; } catch (e) { out.docFromCache = 'error ' + (e?.code || e?.name); }
    try { const s = await F.getDocsFromCache(F.collection(db, ...collPath(hid, kind).split('/'))); const d = s.docs.find(x => x.id === id); out.queryFromCache = q(d ? d.data() : null); out.queryFromCachePending = d ? d.metadata.hasPendingWrites : null; } catch (e) { out.queryFromCache = 'error ' + (e?.code || e?.name); }
    try { const s = await Promise.race([F.getDocFromServer(ref), new Promise((_, r) => setTimeout(() => r({ code: 'timeout' }), 8000))]); out.docFromServer = q(s.exists() ? s.data() : null); } catch (e) { out.docFromServer = 'error ' + (e?.code || e?.name); }
    return out;
  },
  async drain(ms = 20000) {
    const { F, db } = await C.sdk();
    const t = performance.now();
    const r = await Promise.race([F.waitForPendingWrites(db).then(() => 'ok', e => 'error:' + (e?.code || e?.name)), new Promise(res => setTimeout(() => res('timeout'), ms))]);
    return { result: r, ms: Math.round(performance.now() - t) };
  },
  pending() { return { pending: sync.pending, cache: sync.cache, acks: acks.filter(a => a.state === 'pending').length }; },
  acks() { return acks.map(a => ({ name: a.name, state: a.state, ms: a.ms })); },
  clearAcks() { acks.length = 0; return true; },
  refused() { return refused.slice(); },
  clearRefused() { refused.length = 0; return true; },
  // --shadow (extra reads): a second listener on the items, kept two other ways, to tell a stale page from a listener that
  // really stopped: `full` is rebuilt from every snapshot's whole document list, `chg` from docChanges with metadata changes
  // included (the app's listener uses the default docChanges, which leaves metadata-only changes out)
  async shadow() {
    const { F, db } = await C.sdk();
    SH.full.clear(); SH.chg.clear();
    SH.off?.();
    SH.off = F.onSnapshot(F.collection(db, ...collPath(hid, 'items').split('/')), { includeMetadataChanges: true }, s => {
      SH.full = new Map(s.docs.map(d => [d.id, d.data()]));
      for (const c of s.docChanges({ includeMetadataChanges: true })) { if (c.type === 'removed') SH.chg.delete(c.doc.id); else SH.chg.set(c.doc.id, c.doc.data()); }
    });
    return true;
  },
  shadowState(id) { return { full: SH.full.has(id) ? qtyMap(SH.full.get(id)) : null, chg: SH.chg.has(id) ? qtyMap(SH.chg.get(id)) : null }; },
  syncLog() { return syncLog.slice(); },
  trace(kind, id) { return TRACE.get(kind + '/' + id) || []; },
  now: () => Math.round(performance.now()),
  counts() { return { ...T }; },
};
