// Family sharing: Google sign-in and one shared pantry ("household") in Firestore.
// Loaded only when config.js has a Firebase config (or ?emulator on localhost for tests), so the app works on
// one phone with no account at all until the family pantry is set up (SETUP.md).
//
// Firestore layout (rules in firestore.rules):
//   households/{hid}                 { name, owner: email, members: [emails], createdAt }
//   households/{hid}/items/{id}      one product with its stock batches (and a tiny thumbnail, `thumb`)
//   households/{hid}/photos/{id}     the item's photo (same id), read only when the item is opened: never listened to,
//                                    so opening the app downloads thumbnails, not photos (photo.js)
//   households/{hid}/events/{id}     bought / opened / used up / thrown away, for the consumption pattern
//   households/{hid}/shop/{id}       things added to the shopping list by hand
//   households/{hid}/places/{id}    one place each ({ id, name, order, updatedAt, removedAt?, removedBy? }; places.js, since PR-C)
//   households/{hid}/settings/places the family's OLD single list of places ({ id: 'places', list: [names], updatedAt }): still
//                                    read when a household has no place documents, and still written by phones older than PR-C
//   households/{hid}/settings/people the names members give each other ({ id: 'people', names: { email: name }, updatedAt }; people.js),
//                                    changed one name at a time as field updates (`names.<email>` by FieldPath)
//
// Sign-in happens on the app's own address: authDomain is pantry.flamingbeing.com (config.js, written by
// tools/set-config.mjs), and the Worker serves Firebase's helper pages at /__/auth/ and the project's init.json at
// /__/firebase/. A redirect then never crosses to another site, so installed iPhone apps keep their sign-in state
// (the anawj.com logbook's fix for "missing initial state").

import { firebaseConfig } from '../config.js';
import { KINDS, prefs } from './store.js';
import { applyOps, batchMap, normalizeItem, toStored, opsValid } from './logic.js';
import { decide } from './listen-watch.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
export const APP_HOST = 'pantry.flamingbeing.com';

const emulator = (() => {
  try {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return null;
    const v = new URLSearchParams(location.search).get('emulator');
    if (v === null) return null;
    const [fs, auth] = v.split(':').map(Number);
    return { fs: fs || 8085, auth: auth || 9099 };
  } catch { return null; }
})();
export const usingEmulator = !!emulator;

export const configured = !!emulator || !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);

// The SDK loads once: every caller shares one promise (v1 loaded it twice when two calls raced, and the second
// initializeApp broke the auth emulator). A failed load (no signal on the very first open) is tried again next time.
let fb = null;
export function sdk() {
  if (fb) return fb;
  fb = load();
  fb.catch(() => { fb = null; });
  return fb;
}
async function load() {
  const [app, A, F] = await Promise.all([
    import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js'),
  ]);
  const cfg = emulator
    ? { apiKey: 'demo-key', projectId: 'demo-pantry', authDomain: 'localhost', appId: 'demo' }
    : { ...firebaseConfig, authDomain: firebaseConfig.authDomain || APP_HOST };
  const a = app.initializeApp(cfg);
  const auth = A.getAuth(a);
  let db;
  if (emulator) {
    db = F.getFirestore(a);
    F.connectFirestoreEmulator(db, '127.0.0.1', emulator.fs);
    A.connectAuthEmulator(auth, `http://127.0.0.1:${emulator.auth}`, { disableWarnings: true });
  } else {
    // keeps a copy on the phone, so the pantry opens and saves with no signal and catches up later
    try { db = F.initializeFirestore(a, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
    catch { db = F.getFirestore(a); }
  }
  return { A, F, auth, db };
}

const lc = s => String(s || '').trim().toLowerCase();

// Plain words for anything that goes wrong (never the raw error text).
export function explain(err, doing = 'That') {
  const code = String(err?.code || '');
  if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(code)) return 'Sign-in was cancelled.';
  if (/network-request-failed|unavailable|deadline-exceeded/.test(code) || err?.name === 'TypeError') return 'No signal, so that didn’t work. Try again when you’re online.';
  if (/unauthorized-domain/.test(code)) return 'This address isn’t allowed to sign in yet. The pantry’s setup needs finishing (SETUP.md).';
  if (/permission-denied/.test(code)) return 'This Google account isn’t in that family pantry.';
  if (/too-many-requests|resource-exhausted/.test(code)) return 'Too many tries. Wait a minute and try again.';
  if (/user-disabled/.test(code)) return 'This account can’t sign in.';
  if (/wrong-password|invalid-credential/.test(code)) return 'That email and password don’t match. Check them, or tap Forgot password.';
  if (/user-not-found/.test(code)) return 'There’s no account with that email yet. Tap Create account to make one.';
  if (/email-already-in-use/.test(code)) return 'That email already has an account. Tap Sign in, or Forgot password.';
  if (/weak-password/.test(code)) return 'That password is too easy to guess. Use at least 8 characters.';
  if (/invalid-email/.test(code)) return 'That doesn’t look like an email address.';
  if (/missing-email/.test(code)) return 'Type your email address first.';
  if (/missing-password/.test(code)) return 'Type your password.';
  if (/expired-action-code/.test(code)) return 'That link has expired or was already used. Ask for a new one.';
  if (/invalid-action-code/.test(code)) return 'That link isn’t valid any more. Ask for a new one.';
  if (/merge-count/.test(code)) return 'Not everything arrived in the pantry you’re keeping, so nothing was deleted.';
  if (/operation-not-allowed/.test(code)) return 'This way of signing in isn’t switched on yet.';
  return `${doing} didn’t work. Try again in a moment.`;
}

// Sign in by redirect straight away in the installed app (display-mode standalone, or iOS's navigator.standalone)
// and on Firefox for Android (a popup there opens as a separate tab that can't hand back; the anawj.com lesson).
// Elsewhere, a popup, falling back to a redirect when popups are blocked or unsupported.
export const redirectFirst = ({ standalone = false, ua = '' } = {}) => standalone || (/Android/i.test(ua) && /Firefox\//i.test(ua));
const installedApp = () => {
  try { return !!(globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.matchMedia?.('(display-mode: fullscreen)').matches || globalThis.navigator?.standalone); } catch { return false; }
};
const REDIRECT_CODES = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported', 'auth/cancelled-popup-request'];

export async function onUser(cb) {
  const { A, auth } = await sdk();
  // finishes a redirect sign-in when the page loads again
  A.getRedirectResult(auth).catch(e => console.warn('Redirect sign-in failed', e?.code || e));
  A.onAuthStateChanged(auth, u => cb(userInfo(u)));
}
// What the app needs to know about the signed-in account. `verified` is false for a new password account until the
// person taps the emailed link: the rules need a verified email, so the app shows no family data until then. (Google
// and email-link sign-ins are verified already.)
export const userInfo = u => u ? { email: lc(u.email), name: u.displayName || u.email, photo: u.photoURL || '', verified: u.emailVerified === true } : null;

export async function signIn() {
  const { A, auth } = await sdk();
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (redirectFirst({ standalone: installedApp(), ua: globalThis.navigator?.userAgent || '' })) return A.signInWithRedirect(auth, provider);
  try { await A.signInWithPopup(auth, provider); }
  catch (e) {
    if (!REDIRECT_CODES.includes(e?.code)) throw e;
    await A.signInWithRedirect(auth, provider);
  }
}
// ---- email link and password (besides Google) ----------------------------------------------------------------------

// Where an emailed link brings the person back: the app's own address (installed apps and the home screen open this).
// On localhost (the emulator tests) it is the page the test is on.
export const continueUrl = ({ hostname = '', origin = '', pathname = '/' } = {}) =>
  /^(localhost|127\.0\.0\.1)$/.test(hostname) ? origin + pathname : `https://${APP_HOST}/`;
const here = () => continueUrl({ hostname: location.hostname, origin: location.origin, pathname: location.pathname });
export const goodEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
export const MIN_PASSWORD = 8;
// The query that Firebase's emailed link adds (apiKey, oobCode, mode, lang) comes off the address once used.
export const stripLinkParams = (href, keep = ['emulator']) => {
  const u = new URL(href);
  const q = u.search.slice(1).split('&').filter(p => p && keep.includes(decodeURIComponent(p.split('=')[0])));
  return u.pathname + (q.length ? '?' + q.join('&') : '') + u.hash;
};
const KEY = 'emailForSignIn';
export const savedEmail = () => lc(prefs.get(KEY, ''));

export async function sendLink(email) {
  const e = lc(email);
  if (!e) throw { code: 'auth/missing-email' };
  if (!goodEmail(e)) throw { code: 'auth/invalid-email' };
  const { A, auth } = await sdk();
  await A.sendSignInLinkToEmail(auth, e, { url: here(), handleCodeInApp: true });
  prefs.set(KEY, e);   // the link may open in this same browser (no need to type the email again) or another one
}
export async function isEmailLink(href = location.href) {
  const { A, auth } = await sdk();
  return A.isSignInWithEmailLink(auth, href);
}
// Finishes the sign-in with the emailed link. The address is the one saved on this phone when the link was asked for;
// a link opened in another browser needs the person to type it.
export async function finishLink(email, href = location.href) {
  const e = lc(email);
  if (!e) throw { code: 'auth/missing-email' };
  const { A, auth } = await sdk();
  await A.signInWithEmailLink(auth, e, href);
  prefs.del(KEY);
}
export async function passwordSignIn(email, password) {
  const e = lc(email);
  if (!e) throw { code: 'auth/missing-email' };
  if (!password) throw { code: 'auth/missing-password' };
  const { A, auth } = await sdk();
  await A.signInWithEmailAndPassword(auth, e, password);
}
// A new account: the person must tap the emailed link before the app treats them as signed in.
export async function passwordCreate(email, password) {
  const e = lc(email);
  if (!e) throw { code: 'auth/missing-email' };
  if (!goodEmail(e)) throw { code: 'auth/invalid-email' };
  if (String(password || '').length < MIN_PASSWORD) throw { code: 'auth/weak-password' };
  const { A, auth } = await sdk();
  const c = await A.createUserWithEmailAndPassword(auth, e, password);
  await A.sendEmailVerification(c.user, { url: here() });
  return userInfo(c.user);
}
export async function resendVerification() {
  const { A, auth } = await sdk();
  if (!auth.currentUser) throw { code: 'auth/user-not-found' };
  await A.sendEmailVerification(auth.currentUser, { url: here() });
}
// "I've verified": reload the account and its sign-in token (the token carries email_verified), then say how it stands.
export async function refreshUser() {
  const { auth } = await sdk();
  const u = auth.currentUser;
  if (!u) return null;
  await u.reload();
  await u.getIdToken(true);
  return userInfo(u);
}
export async function resetPassword(email) {
  const e = lc(email);
  if (!e) throw { code: 'auth/missing-email' };
  if (!goodEmail(e)) throw { code: 'auth/invalid-email' };
  const { A, auth } = await sdk();
  await A.sendPasswordResetEmail(auth, e, { url: here() });
}
// Tests only (?emulator): sign in as a made-up Google account.
export async function emulatorSignIn(email) {
  if (!emulator) throw new Error('Only with ?emulator');
  const { A, auth } = await sdk();
  await A.signInWithCredential(auth, A.GoogleAuthProvider.credential(JSON.stringify({ sub: lc(email).replace(/\W/g, ''), email: lc(email), email_verified: true })));
}
// True when every change made on this phone has reached the family within ms (false offline or on a timeout), so
// signing out doesn't silently drop changes still waiting for signal.
export async function synced(ms = 4000) {
  const { F, db } = await sdk();
  return Promise.race([F.waitForPendingWrites(db).then(() => true, () => false), new Promise(r => setTimeout(() => r(false), ms))]);
}
export async function signOut() {
  const { A, auth } = await sdk();
  await A.signOut(auth);
}

// The household this account belongs to (the owner adds family members by their Google email). An account can end up
// in more than one (a second "Start our family pantry" tapped when the first couldn't be found), and a query's
// first match is arbitrary: so pick the one this phone used last (`prefer`), else the one with the most members,
// else the oldest.
export const pickHousehold = (list, prefer = '') => list.length < 2 ? (list[0] || null)
  : list.find(h => h.id === prefer) || [...list].sort((a, b) => (b.members?.length || 0) - (a.members?.length || 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || (a.id < b.id ? -1 : 1))[0];
export async function findHouseholds(email) {
  const { F, db } = await sdk();
  const q = F.query(F.collection(db, 'households'), F.where('members', 'array-contains', lc(email)), F.limit(10));
  // From the server, never the phone's copy: offline this throws ("can't tell") instead of answering "none" from an
  // empty or old copy, which would offer to start a second pantry.
  const s = await F.getDocsFromServer(q);
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function findHousehold(email, prefer = '') { return pickHousehold(await findHouseholds(email), prefer); }
export async function createHousehold(email, name = 'Our pantry') {
  const { F, db } = await sdk();
  const ref = F.doc(F.collection(db, 'households'));
  const data = { name, owner: lc(email), members: [lc(email)], createdAt: new Date().toISOString() };
  // A transaction needs the server: offline it fails at once, where a plain setDoc would queue on the phone and create
  // the pantry later, whenever signal came back (even if one already existed).
  await F.runTransaction(db, async t => { t.set(ref, data); });
  return { id: ref.id, ...data };
}
export async function setMembers(hid, members) {
  const { F, db } = await sdk();
  await F.updateDoc(F.doc(db, 'households', hid), { members: [...new Set(members.map(lc).filter(Boolean))] });
}
// Calls `cb(household)` when the household changes, and `cb(null)` once when it is gone or can't be read any more (deleted or
// merged away by its owner, this account removed from it, or the rules said no: a listener that fails is finished). A copy
// the phone made up from its own cache (no signal, nothing cached) is not "gone": only the server saying so counts.
export async function watchHousehold(hid, cb) {
  const { F, db } = await sdk();
  let last = '';
  return F.onSnapshot(F.doc(db, 'households', hid), { includeMetadataChanges: true }, s => {
    if (!s.exists()) { if (!s.metadata.fromCache && last !== 'gone') { last = 'gone'; cb(null); } return; }
    const h = { id: s.id, ...s.data() }, j = JSON.stringify(h);
    if (j !== last) { last = j; cb(h); }
  }, e => { console.warn('household', e?.code); if (last !== 'gone') { last = 'gone'; cb(null); } });
}

// Firestore can't store undefined; drop it.
const clean = o => JSON.parse(JSON.stringify(o));

// One document's change as the list of Firestore field updates, [[path, value], ...] with each path an array of field names
// (`['batches', 'b1', 'qty']`): a field set, increment() for an add, deleteField() for a removal, so only those fields travel
// and the server combines them with whatever other phones did meanwhile. A keyed instruction (logic.js keyedOps: a person's
// name, `['names', 'mum@example.com']`) is one such path too: its key is a whole field name, so the dots in an email never
// split it. An item still stored as an old-style array is converted by this one write instead (its batches as a map, which
// already holds the change; the other fields as usual). That one write is built from this phone's copy, so it is the one place
// a stale copy can still overwrite another phone's change: only while an item is still an array, once per item (NOTES.md).
export function updatePairs(F, before, ops) {
  if (!opsValid(ops)) throw new Error('ops overlap');
  const out = [];
  let o = ops;
  if (before?._arr) {
    out.push([['batches'], batchMap(applyOps(before, ops).batches)]);
    const rest = p => !/^batches(\.|$)/.test(p);
    o = { ...ops, set: Object.fromEntries(Object.entries(ops.set || {}).filter(([p]) => rest(p))), inc: Object.fromEntries(Object.entries(ops.inc || {}).filter(([p]) => rest(p))), del: (ops.del || []).filter(rest) };
  }
  for (const [p, v] of Object.entries(o.set || {})) out.push([p.split('.'), v]);
  for (const [p, n] of Object.entries(o.inc || {})) out.push([p.split('.'), F.increment(n)]);
  for (const p of o.del || []) out.push([p.split('.'), F.deleteField()]);
  for (const [f, k] of Object.entries(o.keyed || {})) {
    for (const [key, v] of Object.entries(k.set || {})) out.push([[f, key], v]);
    for (const key of k.del || []) out.push([[f, key], F.deleteField()]);
  }
  return out;
}
// updateDoc / batch.update take `(ref, field, value, field, value, ...)`; every field is a FieldPath, never a dotted string.
export const updateArgs = (F, before, ops) => updatePairs(F, before, ops).flatMap(([path, v]) => [new F.FieldPath(...path), v]);
// The same fields as nested maps (a set-with-merge takes those, not paths; it makes a document that isn't there yet).
export function nest(pairs) {
  const out = {};
  for (const [path, v] of pairs) {
    let o = out;
    for (const k of path.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {};
    o[path[path.length - 1]] = v;
  }
  return out;
}

// Many documents at once: at most 400 to a batch or about 4 MB (photos are up to 150 KB each; Firestore takes about
// 10 MB a request).
async function writeAll(F, db, hid, kind, list) {
  let b = null, n = 0, bytes = 0;
  for (const o of list) {
    const c = clean(kind === 'items' ? toStored(normalizeItem(o)) : o), size = JSON.stringify(c).length;
    if (b && (n >= 400 || bytes + size > 4e6)) { await b.commit(); b = null; }
    if (!b) { b = F.writeBatch(db); n = 0; bytes = 0; }
    b.set(F.doc(F.collection(db, 'households', hid, kind), o.id), c); n++; bytes += size;
  }
  if (b) await b.commit();
}
const MERGE_KINDS = ['items', 'events', 'shop', 'photos'];
const ALL_KINDS = [...MERGE_KINDS, 'places', 'settings'];

export async function addMembers(hid, members) { return setMembers(hid, members); }
// Merging, step 1: copy everything in household `fromId` into `toId` (ids are random, so nothing clashes; running it
// again after a failure just writes the same documents again). Settings are merged, not copied over. Then COUNT: the
// kept pantry must hold at least as many documents of each kind as were copied. Throws if anything fails; never
// deletes. Resolves with how many were copied.
export async function copyHousehold(toId, fromId, members) {
  const { F, db } = await sdk();
  const read = async (hid, k) => (await F.getDocs(F.collection(db, 'households', hid, k))).docs.map(d => d.data());
  const out = {};
  const { mergeSettings, carryOver, legacyPlaces } = await import('./merge.js');
  const { mergeInto } = await import('./places.js');
  const photos = await read(fromId, 'photos');
  const photoIds = new Set(photos.map(p => p.id));
  const items = (await read(fromId, 'items')).map(it => {
    // an item from before thumbnails still holds a whole photo: the rules refuse new ones, so it moves to photos/<id>
    if (it.photo && !photoIds.has(it.id) && String(it.photo).length <= 150000) { photos.push({ id: it.id, data: it.photo, updatedAt: new Date().toISOString() }); photoIds.add(it.id); }
    const { photo, ...rest } = it;
    return rest;
  });
  // what was removed more than 30 days ago isn't carried over (with its history and photo); markers of the rest are
  const lists = carryOver({ items, events: await read(fromId, 'events'), shop: await read(fromId, 'shop'), photos, places: await read(fromId, 'places') });
  for (const k of ['photos', 'items', 'events', 'shop']) { await writeAll(F, db, toId, k, lists[k]); out[k] = lists[k].length; }   // photos first, so no item points at a missing photo
  const keepSettings = await read(toId, 'settings'), fromSettings = await read(fromId, 'settings');
  // places: one document each; the other pantry's are merged by name into the kept pantry's (places.js mergeInto)
  const placeDocs = mergeInto({ docs: await read(toId, 'places'), legacy: legacyPlaces(keepSettings) }, { docs: lists.places, legacy: legacyPlaces(fromSettings) });
  await writeAll(F, db, toId, 'places', placeDocs);
  const settings = mergeSettings(keepSettings, fromSettings, members);
  await writeAll(F, db, toId, 'settings', settings);
  if (placeDocs.length) { const c = (await F.getCountFromServer(F.collection(db, 'households', toId, 'places'))).data().count; if (c < placeDocs.length) throw { code: 'merge-count', kind: 'places' }; }
  for (const k of MERGE_KINDS) {
    const c = (await F.getCountFromServer(F.collection(db, 'households', toId, k))).data().count;
    if (c < out[k]) throw { code: 'merge-count', kind: k };
  }
  return out;
}
// Merging, step 2, only after step 1 for every pantry succeeded: delete household `hid` (its documents, then itself).
// Only its owner may (the rules).
export async function removeHousehold(hid) {
  const { F, db } = await sdk();
  for (const k of ALL_KINDS) {
    const ids = (await F.getDocs(F.collection(db, 'households', hid, k))).docs.map(d => d.ref);
    for (let i = 0; i < ids.length; i += 400) {
      const b = F.writeBatch(db);
      for (const r of ids.slice(i, i + 400)) b.delete(r);
      await b.commit();
    }
  }
  await F.deleteDoc(F.doc(db, 'households', hid));
}

// `onError(err, info)` hears of a write the server refused (info says which: { op, kind, id, obj | ops });
// `onSync(state)` of how many of this phone's changes the server hasn't confirmed yet ({ pending, cache, list, heard }).
export async function openCloud(hid, onError = () => {}, onSync = () => {}) {
  const { F, db } = await sdk();
  const col = kind => F.collection(db, 'households', hid, kind);
  const unsubs = [];
  // Changes the server hasn't confirmed, counted two ways, both from the SERVER's acknowledgement and nothing else:
  //  - this phone's own writes whose promise hasn't resolved yet (`waiting`, with a record of each so Settings can say what it
  //    was: { kind, id, op, ops | name });
  //  - writes left from before the app was last closed (`leftover`: the documents the first snapshots flag as pending; each is
  //    cleared when waitForPendingWrites says they were all acknowledged).
  // NOT counted: a document the listener flags `hasPendingWrites` after this session's own write was acknowledged. The SDK keeps
  // that flag up (as "committed mutations") until the listener stream has caught up with the write, so on a slow or stalled
  // listener (wifi with a VPN, 17:54 on 16 Oct) a change the server already holds read as "Waiting for signal (1 change)"
  // (found and reproduced in the emulator, test/sync.e2e.mjs "the chip tells the truth"). History lines (events) aren't
  // counted: each belongs to a change that is.
  let inflight = 0, serial = 0, heard = 0, leftover = [];
  // what the listener watchdog (listen-watch.js) needs to know: when a server snapshot last arrived, since when a listener has shown only the
  // phone's own copy, since when a document has stayed flagged pending with nothing in flight, and the last re-listen
  const W = { lastServerAt: 0, openedAt: 0, cacheAt: {}, flaggedSince: 0, lastRelisten: 0, lastCycle: 0, relistens: 0, cycles: 0, cycling: false, why: '', timer: 0, cb: null, known: Object.fromEntries(KINDS.map(k => [k, new Map()])), restarting: {} };
  const waiting = new Map();
  const first = new Set();
  const seen = Object.fromEntries(KINDS.map(k => [k, { cache: false, flagged: [] }]));
  const tell = () => {
    const mine = [...waiting.values()];
    const old = leftover.filter(x => !mine.some(m => m.kind === x.kind && m.id === x.id));
    onSync({
      pending: Math.max(inflight, mine.length, leftover.length),
      cache: KINDS.some(k => seen[k].cache),
      list: [...mine, ...old],
      heard,
      lastServerAt: W.lastServerAt, relistens: W.relistens, cycles: W.cycles,
    });
  };
  const track = (p, counted = true, recs = []) => {
    if (!counted) return p;
    inflight++;
    const keys = recs.map(r => { const k = ++serial; waiting.set(k, r); return k; });
    tell();
    p.finally(() => { inflight--; for (const k of keys) waiting.delete(k); heard = Date.now(); tell(); });   // an answer from the server, whether it took the change or not
    return p;
  };
  const counts = kind => kind !== 'events' && kind !== 'photos';   // a history line or a photo belongs to a change that is counted
  const refused = info => e => { console.warn('save failed', info.op, info.kind, e?.code); onError(e, info); return false; };
  // The four listeners (items, events, shop, places, settings): one set at a time. Each snapshot is read whole (docChanges WITH
  // metadata changes, each document compared with what was last delivered), so a change that only came with a metadata change is never
  // dropped, and a document only changes the screen when its data did.
  const sig = d => JSON.stringify(d);
  function startListening() {
    if (unsubs.length) return;   // never two sets at once
    W.openedAt = Date.now();
    for (const k of KINDS) {
      if (W.known[k].size > 0) W.restarting[k] = true;   // (listening again: what was deleted meanwhile must be noticed)
      unsubs.push(F.onSnapshot(col(k), { includeMetadataChanges: true }, s => {
        const now = Date.now(), cache = s.metadata.fromCache, known = W.known[k];
        seen[k] = { cache, flagged: s.docs.filter(d => d.metadata.hasPendingWrites).map(d => d.id) };
        W.cacheAt[k] = cache ? (W.cacheAt[k] || now) : 0;
        if (!cache) { heard = now; W.lastServerAt = now; }
        // what was already waiting when the app opened (from before it was last closed): each kind's first snapshot says
        if (!first.has(k)) {
          first.add(k);
          if (first.size === KINDS.length) {
            leftover = KINDS.filter(x => x !== 'events').flatMap(x => seen[x].flagged.map(id => ({ kind: x, id, op: 'before' })));
            if (leftover.length) F.waitForPendingWrites(db).then(() => { leftover = []; tell(); }, () => {});
          }
        }
        const docs = [], removed = [], pending = [];
        for (const c of s.docChanges({ includeMetadataChanges: true })) {
          if (c.type === 'removed') { if (known.delete(c.doc.id)) removed.push(c.doc.id); continue; }
          const data = c.doc.data(), sg = sig(data);
          if (c.doc.metadata.hasPendingWrites) pending.push(c.doc.id);
          if (known.get(c.doc.id) === sg) continue;   // only its metadata changed
          known.set(c.doc.id, sg); docs.push(data);
        }
        // a listener made again: what was deleted while it was gone isn't in its first snapshot; and a snapshot whose documents don't
        // match what was delivered is read whole (a safety net: nothing the SDK lists as "no change" can leave the screen behind)
        if (W.restarting[k] || s.docs.length !== known.size) {
          W.restarting[k] = false;
          const ids = new Set();
          for (const d of s.docs) {
            ids.add(d.id);
            const data = d.data(), sg = sig(data);
            if (known.get(d.id) !== sg) { known.set(d.id, sg); docs.push(data); if (d.metadata.hasPendingWrites) pending.push(d.id); }
          }
          for (const id of [...known.keys()]) if (!ids.has(id)) { known.delete(id); removed.push(id); }
        }
        if (docs.length || removed.length) W.cb?.(k, docs, removed, pending);   // pending: ids this phone has changes on that the server hasn't confirmed
        tell();
      }, e => { console.warn('sync', k, e?.code); onError(e); }));
    }
    if (!W.timer && globalThis.setInterval) W.timer = setInterval(() => watch(false), 3000);
  }
  function stopListening() { unsubs.splice(0).forEach(u => u()); }
  // Look at the signs (listen-watch.js) and, if the listener is stuck, replace it: stop the old set, start a new one.
  function watch(event) {
    if (!unsubs.length || !W.cb) return false;
    const now = Date.now(), flagged = KINDS.some(k => k !== 'events' && seen[k].flagged.length) && inflight === 0 && !leftover.length;
    W.flaggedSince = flagged ? (W.flaggedSince || now) : 0;
    const cacheSince = Math.min(...KINDS.map(k => W.cacheAt[k] || Infinity));
    const d = decide({ now, online: globalThis.navigator?.onLine !== false, event, lastServerAt: W.lastServerAt, openedAt: W.openedAt, cacheSince: Number.isFinite(cacheSince) ? cacheSince : 0, flaggedSince: W.flaggedSince, lastRelisten: W.lastRelisten, lastCycle: W.lastCycle, quiet: inflight === 0 && !leftover.length });
    if (d.cycle && !W.cycling) {
      // still stuck after listening again, and nothing unacknowledged: restart the connection (off, then on; never on while on)
      console.warn('connection restarted:', d.why);
      W.cycling = true; W.lastCycle = now; W.cycles++; W.why = 'cycle:' + d.why; W.flaggedSince = 0;
      for (const k of KINDS) W.cacheAt[k] = 0;
      (async () => { try { await F.disableNetwork(db); await new Promise(r => setTimeout(r, 300)); await F.enableNetwork(db); } catch (e) { console.warn('network restart', e?.code || e?.message); } finally { W.cycling = false; tell(); } })();
      return true;
    }
    if (!d.relisten) return false;
    console.warn('listeners replaced:', d.why);
    W.lastRelisten = now; W.relistens++; W.why = d.why;
    for (const k of KINDS) { W.cacheAt[k] = 0; W.restarting[k] = true; }
    stopListening(); startListening();
    tell();
    return true;
  }
  return {
    kind: 'cloud',
    async load() {
      const out = {};
      for (const k of KINDS) {
        const s = await F.getDocs(col(k));
        out[k] = s.docs.map(d => d.data());
      }
      return out;
    },
    // Writes go to the phone's copy at once and reach the family when there's signal; don't wait for the server.
    // The promise (which callers may ignore) says whether the server took it: true, or false when refused.
    put: (kind, obj) => track(F.setDoc(F.doc(col(kind), obj.id), clean(kind === 'items' ? toStored(obj) : obj)).then(() => true, refused({ op: 'put', kind, id: obj.id, ...(kind === 'photos' ? {} : { obj: clean(kind === 'items' ? toStored(obj) : obj) }) })), counts(kind), [{ kind, id: obj.id, op: 'put', name: obj.name || '' }]),
    // One item's change as instructions (ops: logic.js). `before` is the item as this phone has it (to tell an old-style
    // array that needs converting); without one the item isn't known here yet, so the fields are merged into whatever
    // is there (a set-with-merge, which creates it). Otherwise an update: it fails, rather than bringing back an item
    // someone deleted.
    patch(kind, id, ops, { before = null } = {}) {
      const ref = F.doc(col(kind), id);
      const info = { op: 'patch', kind, id, ops };
      // an update when this phone has the document (it fails, rather than bringing back one that is gone); a merge when it
      // doesn't know it yet (it creates the document, or adds these fields to whatever another phone made)
      return track((before ? F.updateDoc(ref, ...updateArgs(F, before, ops)) : F.setDoc(ref, nest(updatePairs(F, before, ops)), { merge: true })).then(() => true, refused(info)), true, [{ kind, id, op: 'patch', ops }]);
    },
    // Several items' changes in one write (renaming a place moves every item in it): [{ id, ops, before }].
    async patchMany(kind, list) {
      for (let i = 0; i < list.length; i += 400) {
        const part = list.slice(i, i + 400), b = F.writeBatch(db);
        for (const x of part) b.update(F.doc(col(kind), x.id), ...updateArgs(F, x.before, x.ops));
        await track(b.commit().catch(e => { for (const x of part) refused({ op: 'patch', kind, id: x.id, ops: x.ops })(e); }), true, part.map(x => ({ kind, id: x.id, op: 'patch', ops: x.ops })));
      }
    },
    // Delete for good, only if it is still removed since before `cutoff` (the daily sweep): read and delete in one
    // transaction, so a Restore on another phone a moment ago is never undone by a phone whose copy is a moment old. A
    // transaction needs the server, so offline it fails and the sweep tries again another day. False for a document that is
    // already gone (another phone swept first) or was put back.
    async purge(kind, id, cutoff) {
      const ref = F.doc(col(kind), id);
      try {
        return await F.runTransaction(db, async t => {
          const s = await t.get(ref), d = s.exists() ? s.data() : null;
          if (!d || typeof d.removedAt !== 'string' || !(d.removedAt < cutoff)) return false;
          t.delete(ref);
          return true;
        });
      } catch (e) { console.warn('purge', kind, id, e?.code); return false; }
    },
    // Several documents at once (a purged item's history): at most 400 to a batch.
    async delMany(kind, ids) {
      for (let i = 0; i < ids.length; i += 400) {
        const b = F.writeBatch(db);
        for (const id of ids.slice(i, i + 400)) b.delete(F.doc(col(kind), id));
        await track(b.commit().catch(e => { console.warn('delete', kind, e?.code); }), false);
      }
    },
    del: (kind, id) => { track(F.deleteDoc(F.doc(col(kind), id)).then(() => true, refused({ op: 'del', kind, id })), counts(kind), [{ kind, id, op: 'del' }]); },
    // One document (an item's photo, when the item is opened), or null when there is none. Offline it is the
    // phone's copy if it has one; otherwise it throws, and the app tries again next time.
    async get(kind, id) {
      const s = await F.getDoc(F.doc(col(kind), id));
      return s.exists() ? s.data() : null;
    },
    // Every document of one kind (a backup's photos): only when someone asks for it.
    async list(kind) { return (await F.getDocs(col(kind))).docs.map(d => d.data()); },
    // Write many at once (copying the phone's pantry up, restoring a backup): at most 400 documents or about 4 MB
    // to a batch (photos are up to 150 KB each; Firestore takes about 10 MB a request).
    putMany: (kind, list) => writeAll(F, db, hid, kind, list),
    // The same listeners also say what is still waiting to be sent (hasPendingWrites) and whether the phone is showing
    // its own copy (fromCache): no extra listener, no extra read.
    listen(cb) { W.cb = cb; startListening(); },
    // The listener watchdog: `nudge('resume')` at a moment the phone came back (online, visible, pageshow, Sync now); a timer also
    // looks every few seconds for the signs that need no event (listen-watch.js). Resolves true when it listened again.
    nudge(event = '') { return watch(!!event); },
    relistens: () => W.relistens,
    // Sync now (Settings): try to send what is waiting, now: wait a few seconds for the SDK's own acknowledgement of every change,
    // then a read from the server to prove the family can be reached (that is "Last heard from the family"). Nothing is
    // switched off unless the person asks again (`cycle`: the "Reconnect and try again" button): one turn of the network switch,
    // off and then on (the SDK drops its streams and sends again what is unacknowledged; never "on" while already on, which
    // trips an assertion in Firestore 10.14.1). That is offered, not automatic, because a change the server applied but whose
    // acknowledgement was lost is sent again, and an increment sent twice counts twice (NOTES.md). Resolves
    // { ok, cycled, heard }: ok = every change on this phone is acknowledged; heard = the server answered.
    async syncNow({ cycle = false, wait = 5000 } = {}) {
      const race = (p, ms) => Promise.race([Promise.resolve(p).then(() => true, () => false), new Promise(r => setTimeout(() => r(false), ms))]);
      let cycled = false;
      if (cycle && globalThis.navigator?.onLine !== false) {
        cycled = true;
        try { await F.disableNetwork(db); await new Promise(r => setTimeout(r, 300)); await F.enableNetwork(db); } catch (e) { console.warn('network cycle', e?.code || e?.message); }
      }
      const ok = await race(F.waitForPendingWrites(db), cycled ? wait + 3000 : wait);
      const reached = await race(F.getDocFromServer(F.doc(db, 'households', hid)), 6000);
      if (reached) { heard = Date.now(); tell(); }
      return { ok, cycled, heard: reached };
    },
    close() { clearInterval(W.timer); W.timer = 0; stopListening(); },
  };
}
