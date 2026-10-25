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
import { applyOps, applyFieldOps, batchMap, normalizeItem, toStored, opsValid } from './logic.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
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
  const a = app.getApps()[0] || app.initializeApp(cfg);
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
// True when every change made on this phone has reached the family within ms (false offline, on a timeout, or while
// a save waits in another tab), so signing out doesn't silently drop changes still waiting for signal.
export async function synced(ms = 4000) {
  const { F, db } = await sdk();
  const sdkDone = Promise.race([F.waitForPendingWrites(db).then(() => true, () => false), new Promise(r => setTimeout(() => r(false), ms))]);
  if (engine) await Promise.race([Promise.allSettled([...engine.saving]), new Promise(r => setTimeout(r, ms))]);   // (saves still being stored)
  return (engine ? await engine.queue.flush(ms) : true) && await sdkDone;
}
// Send what waits in the outbox now (tests: after the SDK's network is switched back on).
export function kick() { engine?.queue.kick(); }
// Signing out wipes this phone's family copy, in app-sync's order (forgetDevice): stop every listener, check the person is
// still the one signing out, the copy of every kind (in every tab), the outbox, and the SDK's own cache (terminated, so
// that instance can't be used again: the app reloads, `reload`). The sign-out check (`synced`) came first.
export async function signOut() {
  const { A, auth } = await sdk(), uid = auth.currentUser?.uid || null;
  if (engine) {
    const { hub, stores, queue, fs } = engine;
    owner = '';
    const r = await engine.AS.forgetDevice({
      hub, stores, queue, keep: [],
      proceed: async () => (auth.currentUser?.uid || null) === uid,   // another tab signed in as someone else meanwhile: wipe nothing
      clearBackendCache: emulator ? null : fs.clearCache,
      extra: async () => { engine = null; if (!emulator) fb = null; },
    });
    if (!r.wiped) throw Object.assign(new Error('Signing out was stopped: someone signed in on this phone meanwhile.'), { code: 'signout-stopped' });   // (the hub is stopped: the page starts again)
    if (r.failed.length) console.warn('sign-out steps that failed', r.failed);
  }
  await A.signOut(auth);
  return { reload: !emulator };   // (the SDK instance is closed outside the emulator: the page starts clean)
}
// How many of this phone's changes the outbox still holds (the update reload waits for none).
export function pending() { return engine ? engine.queue.pending() : 0; }
// The chip's state by app-sync's rules (a chip drawn by app.js): never Saved before the server has answered once, and
// at-risk only while offline. -> { state, count }
export function status(input) { return engine ? engine.AS.syncStatus({ atRiskOnlyOffline: true, ...input }) : null; }

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

// Many documents at once into another household (merging pantries, copyHousehold): at most 400 to a batch or about 4 MB
// (photos are up to 150 KB each; Firestore takes about 10 MB a request). Merging needs signal and counts what arrived
// afterwards, so these stay batches; they are stamped by app-sync's adapter (stampFields: updatedAt now, serverAt), as
// every save through the outbox is.
async function writeAll(F, db, hid, kind, list) {
  let b = null, n = 0, bytes = 0;
  const st = await (await sync()).fs.stampFields();
  for (const o of list) {
    const { _saves, serverAt, ...c } = clean(kind === 'items' ? toStored(normalizeItem(o)) : o), size = JSON.stringify(c).length;
    Object.assign(c, st);   // stamped now, so every phone's delta listener hears it, and the server's own stamp (a copied one is another pantry's)
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

// ---- saving and listening through app-sync (core.anawj.com/sync/) ----------------------------------------------------
// Every save goes to an outbox on this phone first (IndexedDB), then to the server in a transaction, one document at a
// time and in order (app-sync's write queue): nothing waits in the SDK's own offline queue, so a refused save is kept
// and a save made offline survives a reload. Each kind has a copy on this phone and listens only for documents changed
// since the last sync (`updatedAt`, stamped by the adapter at commit), so a quiet reopen reads about one document a kind.
// Every kind is merged by field on the server's copy (no conflict screen): a whole document (`put`) replaces it, as
// setDoc did; a change as instructions (`patch`) is applied to the server's copy inside the transaction, as updateDoc did,
// and `_saves` keeps the keys of the last saves applied, so a save sent twice (its answer lost) counts once.

// One change in a queued save: { put: true } (the record replaces the document) or { patch: ops } (logic.js ops).
const INC = '__inc', DEL = { __del: true };
const OPS_F = { increment: n => ({ [INC]: n }), deleteField: () => DEL };
// updatePairs' field updates done to a plain document, as the server does them: a set replaces that field, an
// increment adds to a number (a missing or non-number field counts as 0), a delete removes it; maps on the way are made.
export function applyPairs(doc, pairs) {
  const out = clean(doc || {});
  for (const [path, v] of pairs) {
    let o = out;
    for (const k of path.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? o[k] : {};
    const k = path[path.length - 1];
    if (v && typeof v === 'object' && v.__del === true) delete o[k];
    else if (v && typeof v === 'object' && Object.hasOwn(v, INC)) o[k] = (typeof o[k] === 'number' ? o[k] : 0) + v[INC];
    else o[k] = v === undefined ? v : clean(v);
  }
  return out;
}
// The document a kind's queued saves make of the server's copy (`current`, null when there is none): app-sync's merge
// function, run inside the transaction. An old-style array item is converted from the server's copy, so a stale copy
// on this phone can no longer overwrite another phone's change. A place made from the old single list (SEED_AT) is
// written only when the place isn't there yet, as the rules have it.
export function mergeSaves(kind) {
  return (current, record, _base, ops) => {
    let doc = current ? clean(current) : null;
    for (const o of ops && ops.length ? ops : [{ put: true }]) {
      if (o.patch) doc = applyPairs(doc || { id: record.id }, updatePairs(OPS_F, kind === 'items' && doc && Array.isArray(doc.batches) ? normalizeItem(doc) : null, o.patch));
      else if (kind === 'places' && record.updatedAt === SEED_AT && doc) continue;
      else doc = { ...(kind === 'items' ? toStored(normalizeItem(record)) : clean(record)), ...(current?.updatedAt ? { updatedAt: current.updatedAt } : {}) };
    }
    return doc;   // (updatedAt still the server's: the adapter's stamp moves it on)
  };
}
const SEED_AT = '1970-01-01T00:00:00.000Z';   // places.js
const SYNC = 'https://core.anawj.com/sync/0.5.1/index.js';
// A soft-deleted item, line or place leaves the phones a week after the sweep deletes it for good (logic.js REMOVED_DAYS),
// so the sweep still sees it here first.
const EXPIRE = { field: 'removedAt', after: (30 + 7) * 86400000 };
const counts = x => x.kind !== 'events' && x.kind !== 'photos'   // a history line or a photo belongs to a change that is counted,
  && !(x.kind === 'places' && x.record?.updatedAt === SEED_AT);      // and a place made from the old list is no one's change
// (`_saves` and the server's stamp `serverAt` are the engine's, never the app's: a record the app writes back never carries them)
const strip = d => { if (!d || !('_saves' in d || 'serverAt' in d)) return d; const { _saves, serverAt, ...rest } = d; return rest; };

// The engine, once a page: the device copy, the outbox and the queue outlive a switch between households (owner: the
// household's id), and signing out wipes them.
let engine = null, owner = '';
async function sync() {
  if (engine) return engine;
  const { F, db } = await sdk(), AS = await import(SYNC);
  const meta = new Set(), codes = new Map();
  const fs = AS.createFirestoreBackend({
    // stampMode 'server' (app-sync 0.3.0): every save also sets `serverAt` to the server's time, beside `updatedAt`. The
    // hub still reads by `updatedAt` until the backfill (tools/backfill-server-at.mjs) and the rules require the stamp.
    // `updatedAt` is the adapter's default stamp (0.4.0): max(now, the server copy's + 1), taken inside the commit.
    sdk: async () => ({ F, db }), path: (hid, kind) => ['households', hid, kind], time: 'iso', mark: '_saves', stampMode: 'server',
    merge: Object.fromEntries(ALL_KINDS.map(k => [k, mergeSaves(k)])),
    onSnapshotMeta: (kind, m) => { for (const fn of meta) fn(kind, m); },
  });
  const stores = AS.createStores({ prefix: 'pantry-sync:', colls: KINDS, metaOnly: [] });
  // nothing-lost report (app-sync report.js): counts only (saves waiting over an hour, refused, in conflict, sync
  // errors by code) and versions, at most once an hour and when the page is hidden; never an item, a household or an id
  let appVersion = 'unknown';
  import('https://core.anawj.com/update/0.2.0/register.js').then(m => m.version()).then(v => { if (v) appVersion = v; }).catch(() => {});
  const report = AS.createReport({ app: 'pantry', version: () => appVersion, storage: (() => { try { return localStorage; } catch { return null; } })() });
  report.start();
  const hub = AS.createSyncHub({ openStore: stores.openStore, listen: fs.listen, fetchOne: fs.fetchOne, bin: null, unstamped: 'full', expire: { items: EXPIRE, shop: EXPIRE, places: EXPIRE }, onError: e => { report.error(e?.code); console.warn('sync', e?.code || e?.message); } });
  AS.replanOnWake(hub);
  // (the queue keeps a failed save's message only: its code, for the plain words, is kept here)
  const queue = AS.createWriteQueue({
    store: AS.createOutbox({ name: 'pantry-outbox' }), getOwner: () => owner, online: () => globalThis.navigator?.onLine !== false,
    report,
    // ('aborted', two phones' transactions on one document at once, is retried by the queue itself (app-sync 0.4.0).
    // 'permission-denied' is tried once more on a fresh read: the server judges the rules before it notices the copy read
    // was stale, so a write racing another phone's in the same millisecond can be refused for the same stamp.)
    backend: async (hid, kind, record, base, extra) => {
      const once = () => fs.commit(hid, kind, record, base, extra);
      try { return await once().catch(async e => { if (e?.code !== 'permission-denied') throw e; await new Promise(r => setTimeout(r, 50 + Math.random() * 100)); return once(); }); }
      catch (e) { codes.set(extra.key, e?.code || ''); throw e; }
    },
  });
  globalThis.addEventListener?.('online', () => queue.kick());
  engine = { AS, fs, stores, hub, queue, meta, codes, persisted: true, saving: new Set() };
  return engine;
}

// `onError(err, info)` hears of a write the server refused (info says which: { op, kind, id, obj | ops });
// `onSync(state)` of how many of this phone's changes the server hasn't confirmed yet ({ pending, cache, list, heard, stale, persisted }).
export async function openCloud(hid, onError = () => {}, onSync = () => {}) {
  const { F, db } = await sdk();
  const E = await sync(), { AS, hub, queue } = E;
  owner = hid;
  await queue.activate(hid);
  AS.persistGuard().then(r => { E.persisted = r.persisted || !r.supported; tell(); }, () => {});
  const col = kind => F.collection(db, 'households', hid, kind);
  let heard = 0, lastServerAt = 0, relistens = 0, cycles = 0, closed = false, cb = null, timer = 0;
  // Writes an older version of the app left in the SDK's own queue (before this phone moved to the outbox): still sent by
  // the SDK, counted until it says they all arrived.
  let leftover = true;
  F.waitForPendingWrites(db).then(() => { leftover = false; tell(); }, () => {});
  const seen = Object.fromEntries(KINDS.map(k => [k, { cache: true, ready: false }]));
  const known = Object.fromEntries(KINDS.map(k => [k, new Map()]));   // id -> signature, as last delivered
  const data = Object.fromEntries(KINDS.map(k => [k, new Map()]));
  const ready = Object.fromEntries(KINDS.map(k => { let done; const p = new Promise(r => { done = r; }); return [k, { p, done }]; }));
  const ofQueue = kind => queue.entries().filter(x => x.owner === hid && x.kind === kind && x.state === 'pending').map(x => x.record.id);
  const tell = () => {
    if (closed) return;
    const mine = queue.entries().filter(x => x.owner === hid && x.state === 'pending' && counts(x));
    const list = mine.map(x => {
      const patch = (x.ops || []).filter(o => o.patch).at(-1);
      return { kind: x.kind, id: x.record.id, op: x.record._deleted ? 'del' : patch && !(x.ops || []).some(o => o.put) ? 'patch' : 'put', ...(patch ? { ops: patch.patch } : {}), name: x.record.name || '' };
    });
    onSync({
      pending: mine.length + (leftover ? 1 : 0), cache: !cb || KINDS.some(k => seen[k].cache), list: [...list, ...(leftover ? [{ kind: 'items', id: '', op: 'before' }] : [])],
      heard, lastServerAt, relistens, cycles, stale: dog.stale(), persisted: E.persisted,
    });
  };
  // A save the server refused: kept in the app's list (Settings, Retry or Discard) and set aside in the queue, so a
  // Retry is a new save and nothing is sent twice.
  const reported = new Set();
  const report = () => {
    for (const x of queue.entries()) {
      if (x.owner !== hid || x.state !== 'failed' || reported.has(x.key)) continue;
      reported.add(x.key);
      const op = x.record._deleted ? 'del' : (x.ops || []).some(o => o.put) ? 'put' : 'patch', patch = (x.ops || []).filter(o => o.patch).map(o => o.patch);
      const err = { code: E.codes.get(x.key) || '', message: x.error };
      console.warn('save failed', op, x.kind, err.code);
      onError(err, { op, kind: x.kind, id: x.record.id, ...(op === 'put' && x.kind !== 'photos' ? { obj: x.record } : {}), ...(op === 'patch' ? { ops: patch.length === 1 ? patch[0] : mergeAll(patch) } : {}) });
      void queue.archive(x.key);
    }
  };
  const offQueue = queue.onChange(() => { report(); tell(); });
  // One save per document at a time from this page, in the order made (the queue orders a document's saves by the time
  // each was stored; two stored in the same moment could otherwise swap).
  const chains = new Map();
  function enqueue(kind, record, base, change, info) {
    const k = kind + ':' + record.id;
    const run = (chains.get(k) || Promise.resolve()).then(() => queue.save(kind, hid, record, base, { ops: change }))
      .then(() => true, e => { if (queue.error()) { console.warn('outbox', e?.message); onError(e, info); } return false; });
    const tail = run.finally(() => { if (chains.get(k) === tail) chains.delete(k); E.saving.delete(tail); });
    chains.set(k, tail); E.saving.add(tail);
    return run;
  }
  // the listeners: each kind's whole list from the engine (this phone's copy, then the server's changes), with this
  // phone's saves not yet sent laid over it (app-sync watchSaved: again when a save is done, so the server's copy heard
  // while it was sent shows then); only what changed since the last delivery goes to the app
  const sig = d => JSON.stringify(d);
  let offs = [];
  function deliver(k, list, m) {
    if (closed) return;
    seen[k].cache = !!m?.fromCache;
    const now = new Map(list.map(d => [d.id, strip(d)]));
    const docs = [], removed = [];
    for (const [id, d] of now) { const s = sig(d); if (known[k].get(id) !== s) { known[k].set(id, s); docs.push(d); } }
    for (const id of [...known[k].keys()]) if (!now.has(id)) { known[k].delete(id); removed.push(id); }
    data[k] = now;
    if (!seen[k].ready) { seen[k].ready = true; ready[k].done(); }
    else if (cb && (docs.length || removed.length)) cb(k, docs, removed, ofQueue(k));
    tell();
  }
  const startListening = () => { if (!offs.length && !closed) offs = KINDS.map(k => AS.watchSaved({ hub, queue, scope: hid, coll: k, kind: k }, (list, m) => deliver(k, list, m))); };
  const stopListening = () => { offs.splice(0).forEach(off => off()); };
  const onMeta = (_kind, m) => { if (closed) return; dog.heard(m); if (!m.fromCache) { heard = lastServerAt = Date.now(); } };
  E.meta.add(onMeta);
  // The listener watchdog (app-sync, from this app's listen-watch.js): listening again stops the engines and starts them
  // from this phone's copy; restarting the connection turns the SDK's network off and on (never on while on).
  const dog = AS.createWatchdog({
    relisten: why => { console.warn('listeners replaced:', why); relistens++; stopListening(); hub.stopAll().then(() => { startListening(); tell(); }); },
    cycle: why => { console.warn('connection restarted:', why); cycles++; cycleNet().finally(tell); },
    online: () => globalThis.navigator?.onLine !== false, quiet: () => queue.pending() === 0 && !leftover,
  });
  let cycling = false;
  async function cycleNet() {
    if (cycling) return; cycling = true;
    // (capped: the SDK's switch waits its turn behind a save whose answer is held up)
    const turn = (async () => { await F.disableNetwork(db); await new Promise(r => setTimeout(r, 300)); await F.enableNetwork(db); })();
    try { await Promise.race([turn, new Promise(r => setTimeout(r, 4000))]); } catch (e) { console.warn('network restart', e?.code || e?.message); } finally { cycling = false; }
    turn.catch(() => {});
  }
  startListening();
  dog.opened();
  if (globalThis.setInterval) timer = setInterval(() => { if (!closed) dog.check(); }, 3000);
  return {
    kind: 'cloud',
    // what this phone holds now (its copy, or the server's first answer): each kind's first list, or after a few seconds
    // whatever there is (a phone that never synced, with no signal); the rest arrives through listen()
    async load() {
      await Promise.all(KINDS.map(k => Promise.race([ready[k].p, new Promise(r => setTimeout(r, 5000))])));
      for (const k of KINDS) if (!seen[k].ready) { seen[k].ready = true; ready[k].done(); }
      return Object.fromEntries(KINDS.map(k => [k, [...data[k].values()]]));
    },
    // Saves go to the outbox at once and reach the family when there's signal; don't wait for the server. The promise
    // (which callers may ignore) is true once the save is kept on this phone; a refusal comes through onError.
    put: (kind, obj) => enqueue(kind, clean(kind === 'items' ? toStored(obj) : obj), null, { put: true }, { op: 'put', kind, id: obj.id, ...(kind === 'photos' ? {} : { obj: clean(kind === 'items' ? toStored(obj) : obj) }) }),
    // One document's change as instructions (ops: logic.js), applied to the server's copy. `before` is the document as this
    // phone has it: with one, a document deleted since is not made again (the save fails: "removed on another phone");
    // without one the fields are merged into whatever is there (it makes the document).
    patch(kind, id, ops, { before = null } = {}) {
      if (!opsValid(ops)) throw new Error('ops overlap');
      const now = before ? (kind === 'items' ? applyOps(before, ops) : applyFieldOps(before, ops)) : applyFieldOps({ id }, ops);
      return enqueue(kind, { ...clean(kind === 'items' ? toStored(now) : now), id }, before ? { id } : null, { patch: ops }, { op: 'patch', kind, id, ops });
    },
    // Several documents' changes (renaming a place moves every item in it): [{ id, ops, before }], one save each.
    async patchMany(kind, list) { await Promise.all(list.map(x => this.patch(kind, x.id, x.ops, { before: x.before }))); },
    // Delete for good, only if it is still removed since before `cutoff` (the daily sweep): read and delete in one
    // transaction, so a Restore on another phone a moment ago is never undone by a phone whose copy is a moment old. A
    // transaction needs the server, so offline it fails and the sweep tries again another day. False for a document that is
    // already gone (another phone swept first) or was put back. (Other phones drop it a week later: EXPIRE.)
    async purge(kind, id, cutoff) {
      const ref = F.doc(col(kind), id);
      try {
        const gone = await F.runTransaction(db, async t => {
          const s = await t.get(ref), d = s.exists() ? s.data() : null;
          if (!d || typeof d.removedAt !== 'string' || !(d.removedAt < cutoff)) return false;
          t.delete(ref);
          return true;
        });
        if (gone && KINDS.includes(kind)) await hub.drop(hid, kind, [id]);
        return gone;
      } catch (e) { console.warn('purge', kind, id, e?.code); return false; }
    },
    // Several documents at once (a purged item's photo and history): one delete each through the outbox, so a delete
    // made as signal drops is kept and sent later (it used to be a batch, left in the SDK's own queue). Resolves once
    // they are kept on this phone.
    async delMany(kind, ids) {
      if (KINDS.includes(kind)) await hub.drop(hid, kind, ids);
      await Promise.all(ids.map(id => enqueue(kind, { id, _deleted: true }, null, undefined, { op: 'del', kind, id })));
    },
    del: (kind, id) => {
      if (KINDS.includes(kind)) void hub.drop(hid, kind, [id]);
      enqueue(kind, { id, _deleted: true }, null, undefined, { op: 'del', kind, id });
    },
    // One document (an item's photo, when the item is opened), or null when there is none. Offline it is the
    // phone's copy if it has one; otherwise it throws, and the app tries again next time.
    async get(kind, id) {
      const s = await F.getDoc(F.doc(col(kind), id));
      return s.exists() ? strip(s.data()) : null;
    },
    // Every document of one kind (a backup's photos): only when someone asks for it.
    async list(kind) { return (await F.getDocs(col(kind))).docs.map(d => strip(d.data())); },
    // Write many at once (copying the phone's pantry up, restoring a backup): one whole-document save each through the
    // outbox, as `put` (they used to be batches, which waited in the SDK's own queue with no signal, uncounted). Resolves
    // once all are kept on this phone; the queue sends them in the order made (photos first, so no item points at a
    // missing photo), stamped by the adapter. A place made from the old list never overwrites one (mergeSaves).
    putMany: (kind, list) => Promise.all(list.map(o => {
      const doc = clean(kind === 'items' ? toStored(normalizeItem(strip(o))) : strip(o));
      return enqueue(kind, doc, null, { put: true }, { op: 'put', kind, id: o.id, ...(kind === 'photos' ? {} : { obj: doc }) });
    })),
    listen(fn) { cb = fn; startListening(); tell(); },   // (until the app has the lists, it hears `cache`: nothing is decided from half a copy)
    // The listener watchdog: `nudge('resume')` at a moment the phone came back (online, visible, pageshow, Sync now); a timer
    // also looks every few seconds for the signs that need no event. Resolves true when it listened again or restarted.
    nudge(event = '') { if (!offs.length) return false; const a = event ? dog.event() : dog.check(); return !!(a.relisten || a.cycle); },
    relistens: () => relistens,
    // Sync now (Settings): send what is waiting, now, and wait a few seconds to know what became of it; then a read from
    // the server to prove the family can be reached ("Last heard from the family"). `cycle` (the "Reconnect and try
    // again" button) first turns the SDK's network off and on. Resolves { ok, cycled, heard }: ok = nothing of this
    // phone's is left unsent.
    async syncNow({ cycle = false, wait = 5000 } = {}) {
      const race = (p, ms) => Promise.race([Promise.resolve(p).then(r => r !== false, () => false), new Promise(r => setTimeout(() => r(false), ms))]);
      let cycled = false;
      if (cycle && globalThis.navigator?.onLine !== false) { cycled = true; await cycleNet(); }
      hub.replan();
      const ok = await queue.flush(cycled ? wait + 3000 : wait) && (!leftover || await race(F.waitForPendingWrites(db), 2000));
      const reached = await race(F.getDocFromServer(F.doc(db, 'households', hid)), 6000);
      if (reached) { heard = Date.now(); tell(); }
      return { ok, cycled, heard: reached };
    },
    close() { closed = true; clearInterval(timer); timer = 0; stopListening(); offQueue(); E.meta.delete(onMeta); },
  };
}
const mergeAll = list => list.reduce((a, o) => ({ set: { ...a.set, ...o.set }, inc: { ...a.inc, ...o.inc }, del: [...a.del, ...(o.del || [])], keyed: { ...a.keyed, ...o.keyed } }), { set: {}, inc: {}, del: [], keyed: {} });
