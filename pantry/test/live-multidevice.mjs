// Live-service robustness harness for the pantry's sync code (cloud.js + logic.js), run against the REAL Firestore (and
// Auth) service by the owner's home-computer session, or, with --dry, against the local emulators (demo-pantry) so the
// harness itself can be tested. It drives the sync code directly in browsers (no UI): see LIVE-TEST.md for how to run it
// and pantry/test/live-page.mjs for what each simulated phone can do.
//
// Why it exists: the emulator tests can't show how the real SDK and service behave (increment() is at-least-once, writes
// queued behind a refused write, persistence across a reload, reconnect timing, WebKit).
//
// Safety (all tested by live-guards.test.mjs):
//   - refuses to run unless the household id starts with `robust-test-`; every document path is built by docPath()
//     (live-lib.mjs), which throws otherwise; every REST request is checked to be under that household;
//   - the household document is only ever read; --reset deletes only documents under the test household's collections;
//   - browsers may only reach localhost, www.gstatic.com and Firebase (anything else is blocked and listed in the report);
//   - passwords, keys and tokens are never printed or written to the report.
//
// Usage: node pantry/test/live-multidevice.mjs [--engine chromium|firefox|webkit|chrome] [--seeds 11,2026,7] [--steps 40]
//   [--reset] [--only 1,2,5|none] [--converge 30] [--budget 2000] [--toggle safe|raw] [--out report.json] [--dry] [--headed]
//   [--key auto|config|creds] [--settle ms] [--allow-host host] [--port n]
// Live: ROBUST_CREDS=<path to the creds JSON> (never in the repo). --dry: run inside the emulators (run-live-dry.sh).
import { readFileSync, writeFileSync } from 'node:fs';
import { serve } from './serve.mjs';
import * as Lib from './live-lib.mjs';

const { assertTestHousehold, docPath, hostAllowed, isApiHost, makeRedactor, makeRest, qtyMap, isRemovedDoc, diffQty, rng, parseArgs, validateCreds, secretsOf } = Lib;

const OPT = parseArgs(process.argv.slice(2));
const started = new Date();
const runTag = 'r' + Date.now().toString(36);
let redact = makeRedactor([]);
const out = (...a) => console.log(redact(a.join(' ')));
const err = (...a) => console.error(redact(a.join(' ')));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = ms => ms == null ? '-' : ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms) + ' ms';

// ---- setup: credentials (live) or made-up accounts in the emulators (dry) -----------------------------------------------------

let creds;
const DRY = OPT.dry;
const emuHost = v => String(v || '').replace(/^localhost/, '127.0.0.1');
const FS_HOST = emuHost(process.env.FIRESTORE_EMULATOR_HOST);
const AUTH_HOST = emuHost(process.env.FIREBASE_AUTH_EMULATOR_HOST);
if (DRY) {
  if (!FS_HOST || !AUTH_HOST) throw new Error('--dry runs inside the emulators: use pantry/test/run-live-dry.sh');
  creds = {
    project: 'demo-pantry', household: process.env.ROBUST_DRY_HOUSEHOLD || `robust-test-dry-${runTag}`, apiKey: 'demo-key',
    users: Object.fromEntries(['a', 'b', 'c'].map(k => [`dry-${k}`, { email: `robust-${k}@example.test`, password: `dry-${k}-pass-${process.env.ROBUST_DRY_HOUSEHOLD || runTag}` }])),
  };
} else {
  const path = process.env.ROBUST_CREDS;
  if (!path) throw new Error('set ROBUST_CREDS to the creds JSON file (see LIVE-TEST.md), or use --dry');
  creds = validateCreds(JSON.parse(readFileSync(path, 'utf8')));
}
redact = makeRedactor(DRY ? [] : secretsOf(creds));
const HID = assertTestHousehold(creds.household);
const USERS = Object.values(creds.users);
const PROJECT = creds.project;
const realConfig = (await import('../config.js')).firebaseConfig || {};
if (!DRY && PROJECT !== realConfig.projectId) out(`note: the creds project differs from config.js (${PROJECT} vs ${realConfig.projectId}); using the creds project and key`);

const REST_BASE = DRY ? `http://${FS_HOST}/v1/projects/${PROJECT}/databases/(default)/documents` : `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
let tokenSource = null;           // () => Promise<string>
let cachedToken = { t: 0, v: '' };
const rest = makeRest({
  base: REST_BASE, hid: HID, patchAllowed: DRY,
  token: async () => {
    if (DRY) return 'owner';
    if (Date.now() - cachedToken.t > 40 * 60 * 1000 || !cachedToken.v) {
      if (!tokenSource) throw new Error('no signed-in phone to read the server with yet');
      cachedToken = { t: Date.now(), v: await tokenSource() };
    }
    return cachedToken.v;
  },
});

// ---- the browser, the static server and the network guard ----------------------------------------------------------------------

async function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const t of tries) { try { return await import(t); } catch { /* next */ } }
  throw new Error('Playwright not found: run "npm install --no-save playwright" in the repo root, or set PLAYWRIGHT_PATH to its index.mjs');
}
const PW = await loadPlaywright();
const srv = await serve(OPT.port);
const PAGE = srv.url + '/pantry/test/live-page.html';
const blocked = new Set();
const assetCache = new Map();
const allPhones = new Set();
let browser = null;
let useCredsKey = OPT.key === 'creds' || (!DRY && PROJECT !== realConfig.projectId);

const FIREBASE_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
// --dry only: send the SDK to the emulators without touching app code. The two Firebase modules the app imports are replaced
// by thin wrappers around the real ones (fetched with ?real): Firestore gets host/ssl settings, Auth connects to the emulator.
const shimFirestore = `import * as R from '${FIREBASE_BASE}firebase-firestore.js?real';
export * from '${FIREBASE_BASE}firebase-firestore.js?real';
const emu = { host: ${JSON.stringify(FS_HOST)}, ssl: false };
export function initializeFirestore(app, settings, ...rest) { return R.initializeFirestore(app, { ...settings, ...emu }, ...rest); }
export function getFirestore(app, ...rest) { try { return R.initializeFirestore(app, emu); } catch { return R.getFirestore(app, ...rest); } }
`;
const shimAuth = `import * as R from '${FIREBASE_BASE}firebase-auth.js?real';
export * from '${FIREBASE_BASE}firebase-auth.js?real';
export function getAuth(app, ...rest) { const a = R.getAuth(app, ...rest); if (!a.__emu) { R.connectAuthEmulator(a, ${JSON.stringify('http://' + AUTH_HOST)}, { disableWarnings: true }); a.__emu = true; } return a; }
`;
const configBody = () => DRY
  ? `export const firebaseConfig = { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-pantry', appId: 'demo' };`
  : `export const firebaseConfig = ${JSON.stringify({ apiKey: creds.apiKey, authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT, appId: realConfig.appId || '' })};`;

async function onRoute(route) {
  try { await onRoute1(route); } catch (e) { try { await route.abort('failed'); } catch { /* page gone */ } }
}
async function onRoute1(route) {
  const req = route.request(), url = req.url();
  if (!hostAllowed(url, { project: PROJECT, extra: OPT.allowHosts }) || (DRY && isApiHost(url))) {
    blocked.add(new URL(url).hostname);
    return route.abort('blockedbyclient');
  }
  const u = new URL(url);
  const isLocal = u.origin === srv.url;   // the test's own static server (not the emulators, also on localhost)
  if (isLocal && u.pathname === '/pantry/config.js' && (DRY || useCredsKey)) {
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'cache-control': 'no-store' }, body: configBody() });
  }
  if (DRY && u.hostname === 'www.gstatic.com' && !u.search.includes('real')) {
    if (u.pathname.endsWith('/firebase-firestore.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: shimFirestore });
    if (u.pathname.endsWith('/firebase-auth.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: shimAuth });
  }
  // static files (the page, the app's modules, the SDK) are fetched once and served from memory afterwards, so a phone
  // that is "offline" can still reload its page (the offline switch cuts Firebase's connections, not the test page)
  if ((isLocal || u.hostname === 'www.gstatic.com') && req.method() === 'GET') {
    let hit = assetCache.get(url);
    if (!hit) {
      const r = await route.fetch();
      if (r.status() !== 200) return route.fulfill({ response: r });
      // (the body is already decoded, so the encoding and length headers must not be repeated)
      const headers = Object.fromEntries(Object.entries(r.headers()).filter(([k]) => !/^(content-encoding|content-length|transfer-encoding)$/i.test(k)));
      hit = { body: await r.body(), headers, status: 200 };
      assetCache.set(url, hit);
    }
    return route.fulfill({ status: hit.status, headers: hit.headers, body: hit.body });
  }
  return route.continue();
}

class Phone {
  constructor(label, user, ctx, page) { Object.assign(this, { label, user, ctx, page, errors: [], total: { writes: 0, listenReads: 0 }, closed: false }); }
  call(m, ...a) { return this.page.evaluate(([m, a]) => window.H[m](...a), [m, a]); }
  act(name, ...a) { return this.call('act', name, ...a); }
  offline(on) { return this.ctx.setOffline(on); }
  state() { return this.call('state'); }
  async harvest() { try { const c = await this.call('counts'); this.total.writes += c.writes; this.total.listenReads += c.listenReads; } catch { /* page gone */ } }
  async close() { if (this.closed) return; this.closed = true; await this.harvest(); allPhones.delete(this); try { await this.ctx.close(); } catch { /* closed */ } }
}
const tally = { writes: 0, listenReads: 0 };
let signInPause = 0;

async function newPhone(i) {
  const user = USERS[i];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route(url => !isApiHost(url.href) || DRY, onRoute);
  const page = await ctx.newPage();
  const p = new Phone('ABC'[i], user, ctx, page);
  allPhones.add(p);
  page.on('pageerror', e => p.errors.push(redact(e.message).slice(0, 600)));
  page.on('console', m => { if (m.type() === 'error') p.errors.push(redact(m.text()).slice(0, 600)); });
  await goPage(p);
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await p.call('signIn', user.email, user.password);
    if (r.ok || !/too-many|network/.test(r.code || '')) break;
    await sleep(2000 * (attempt + 1));
  }
  if (!r.ok) { const e = new Error(`sign-in failed on phone ${p.label}: ${r.code || 'unknown'}`); e.code = r.code; throw e; }
  if (!r.verified) throw new Error(`phone ${p.label}: the account's email is not verified (the rules need it)`);
  if (!tokenSource) tokenSource = () => p.call('token');
  await p.call('open');
  if (OPT.shadow) await p.call('shadow');
  return p;
}
async function goPage(p) {
  await p.page.goto(PAGE);
  await p.page.waitForFunction(() => window.H?.ready, null, { timeout: 30000 });
  await p.call('setHousehold', HID, p.label);
}
async function reloadPage(p) {
  await p.harvest();
  await p.page.reload({ waitUntil: 'load' });
  await p.page.waitForFunction(() => window.H?.ready, null, { timeout: 30000 });
  await p.call('setHousehold', HID, p.label);
}
async function withPhones(n, fn) {
  const phones = [];
  try {
    for (let i = 0; i < n; i++) phones.push(await newPhone(i));
    tokenSource = () => phones[0].call('token');
    cachedToken = { t: 0, v: '' };
    return await fn(phones);
  } finally {
    let tok = null;
    if (!DRY && phones[0]) { try { tok = await phones[0].call('token'); } catch { /* page gone */ } }
    for (const p of phones) { await p.close(); tally.writes += p.total.writes; tally.listenReads += p.total.listenReads; }
    tokenSource = null; cachedToken = { t: 0, v: '' };
    await cleanupCreated(tok);
  }
}

// ---- expected state, server reads, comparisons --------------------------------------------------------------------------------

// every document a scenario creates is remembered and deleted when the scenario ends well (not after a failure, so it can
// be looked at; --keep keeps them all), so the next scenario's phones don't pay to read them. Only ever under the test household.
const created = [];
let healthy = () => true;
const made = (kind, id) => { created.push([kind, id]); };
async function cleanupCreated(token) {
  const list = created.splice(0);
  if (OPT.keep || !healthy() || !list.length) return;
  if (!DRY) { if (!token) return; cachedToken = { t: Date.now(), v: token }; }
  for (const [kind, id] of list) { try { await rest.del(kind, id); } catch { /* left for --reset */ } }
}
const mkItem = (id, name, batches) => ({ id, name, batches: batches.map(([bid, qty, expiry = '2027-01-01']) => ({ id: bid, qty, expiry, openedAt: null, addedAt: '2026-01-01' })) });
const newExpected = () => ({ items: {}, shop: {}, events: new Set() });
const expItem = (E, id, batches, extra = {}) => { E.items[id] = { qty: Object.fromEntries(batches.map(([b, q]) => [b, q])), ...extra }; };
// add what one action did to the expected totals
function tally1(E, id, res) {
  if (!res) throw new Error('action did nothing on ' + id);
  for (const [path, d] of Object.entries(res.ops?.inc || {})) { const b = path.split('.')[1]; E.items[id].qty[b] = (E.items[id].qty[b] || 0) + d; }
  if (res.event) { E.events.add(res.event.id); made('events', res.event.id); }
}
const stepper = (E, sc) => async (phone, steps) => {
  for (const [name, id, ...args] of steps) {
    const res = await phone.act(name, id, ...args);
    if (['use', 'add', 'open'].includes(name)) tally1(E, id, res);
    else if (res === null) throw new Error(`${name} ${id} did nothing on phone ${phone.label}`);
  }
};

async function readServer(E) {
  const server = { items: {}, shop: {}, events: new Set() };
  for (const id of Object.keys(E.items)) server.items[id] = await rest.get('items', id);
  for (const id of Object.keys(E.shop)) server.shop[id] = await rest.get('shop', id);
  for (const id of E.events) if (await rest.get('events', id)) server.events.add(id);
  return server;
}
function checkServer(E, server) {
  const out = [];
  for (const [id, e] of Object.entries(E.items)) {
    const d = server.items[id];
    if (!d) { out.push(`server: item ${id} is missing`); continue; }
    out.push(...diffQty(qtyMap(d), e.qty, `server ${id}/`));
    if (e.name !== undefined && d.name !== e.name) out.push(`server: ${id} name is "${d.name}", expected "${e.name}"`);
    if (e.nameOneOf && !e.nameOneOf.has(d.name)) out.push(`server: ${id} name "${d.name}" was never saved by anyone`);
    const gone = isRemovedDoc(d);
    if (e.removed === true && !gone) out.push(`server: ${id} should be removed but is live`);
    if (e.removed === false && gone) out.push(`server: ${id} is removed but never was deleted`);
    if (!gone && 'removedBy' in d) out.push(`server: ${id} is live but still has removedBy`);
  }
  for (const [id, e] of Object.entries(E.shop)) {
    const d = server.shop[id];
    if (!d) { out.push(`server: line ${id} is missing`); continue; }
    if (e.done !== undefined && d.done !== e.done) out.push(`server: line ${id} done is ${d.done}, expected ${e.done}`);
    const gone = isRemovedDoc(d);
    if (e.removed === true && !gone) out.push(`server: line ${id} should be removed but is live`);
    if (e.removed === false && gone) out.push(`server: line ${id} is removed but never was`);
  }
  for (const id of E.events) if (!server.events.has(id)) out.push(`server: event ${id} is missing`);
  return out;
}
// what one phone shows against what the server has, as { kind, id, text }
function phoneDiffs(st, E, server) {
  const out = [];
  for (const id of Object.keys(E.items)) {
    const s = st.items[id], d = server.items[id];
    if (!d) continue;
    if (!s) { out.push({ kind: 'items', id, text: `${id}: not on this phone` }); continue; }
    for (const t of diffQty(s.qty, qtyMap(d), `${id}/`)) out.push({ kind: 'items', id, text: t.replace(', expected', ' (phone), server') });
    if (s.name !== d.name) out.push({ kind: 'items', id, text: `${id}: name "${s.name}" (phone) vs "${d.name}" (server)` });
    if (s.removed !== isRemovedDoc(d)) out.push({ kind: 'items', id, text: `${id}: removed ${s.removed} (phone) vs ${isRemovedDoc(d)} (server)` });
  }
  for (const id of Object.keys(E.shop)) {
    const s = st.shop[id], d = server.shop[id];
    if (!d) continue;
    if (!s) { out.push({ kind: 'shop', id, text: `${id}: not on this phone` }); continue; }
    if (s.done !== !!d.done || s.removed !== isRemovedDoc(d)) out.push({ kind: 'shop', id, text: `${id}: done ${s.done}/removed ${s.removed} (phone) vs ${!!d.done}/${isRemovedDoc(d)} (server)` });
  }
  for (const id of E.events) if (!st.events.includes(id)) out.push({ kind: 'events', id, text: `event ${id}: not on this phone` });
  return out;
}
async function waitPhones(phones, E, server, timeoutMs) {
  const t0 = Date.now(), done = {}, last = {};
  while (Date.now() - t0 < timeoutMs) {
    for (const p of phones) {
      if (p.label in done) continue;
      last[p.label] = phoneDiffs(await p.state(), E, server);
      if (!last[p.label].length) done[p.label] = Date.now() - t0;
    }
    if (Object.keys(done).length === phones.length) break;
    await sleep(150);
  }
  return { times: done, stale: phones.filter(p => !(p.label in done)).map(p => ({ p, diffs: last[p.label] })) };
}
// is a stale phone's page behind its SDK cache, or is the cache itself behind the server?
async function diagnose(p, diff, server) {
  if (diff.kind === 'events') return 'event not in the SDK listener';
  const cache = await p.call('cacheDoc', diff.kind, diff.id);
  const d = server[diff.kind][diff.id];
  if (cache === undefined) return 'SDK cache could not be read';
  if (cache === null) return 'SDK cache has no copy of it';
  const same = diff.kind === 'items'
    ? JSON.stringify(Object.entries(qtyMap(cache)).filter(([, q]) => q).sort()) === JSON.stringify(Object.entries(qtyMap(d)).filter(([, q]) => q).sort()) && cache.name === d.name && isRemovedDoc(cache) === isRemovedDoc(d)
    : !!cache.done === !!d.done && isRemovedDoc(cache) === isRemovedDoc(d);
  return same ? 'the SDK cache is current but the page state is stale' : 'the SDK cache itself is stale (the listener has not delivered the server value)';
}
// For a phone still stale: what the page last heard of that document (time, quantities, waiting-to-send), and whether
// listening afresh (as a restart of the app would) puts it right.
async function staleDetail(p, diff, server) {
  const out = { document: `${diff.kind}/${diff.id}`, lastHeardByPage: await p.call('trace', diff.kind, diff.id), pageClockNow: await p.call('now'), syncLog: (await p.call('syncLog')).slice(-6), refused: await p.call('refused') };
  out.probe = await p.call('probe', diff.kind, diff.id);
  if (OPT.shadow && diff.kind === 'items') out.shadowListener = await p.call('shadowState', diff.id);
  try {
    await p.call('open', { ms: 15000 });
    const again = phoneDiffs(await p.state(), { items: diff.kind === 'items' ? { [diff.id]: {} } : {}, shop: diff.kind === 'shop' ? { [diff.id]: {} } : {}, events: new Set() }, server);
    out.afterListeningAgain = again.length ? 'still wrong: ' + again[0].text : 'correct';
  } catch (e) { out.afterListeningAgain = 'could not re-listen: ' + redact(e.message).slice(0, 100); }
  return out;
}

// Everyone's writes confirmed (waitForPendingWrites, timed), then the server read, then every phone compared to it.
async function settle(sc, phones, E, { drainMs = 30000, label = '' } = {}) {
  const tStart = Date.now();
  const drains = await Promise.all(phones.map(async p => ({ p, d: await p.call('drain', drainMs) })));
  sc.m[`drain${label}_ms`] = Object.fromEntries(drains.map(({ p, d }) => [p.label, d.ms]));
  for (const { p, d } of drains) if (d.result !== 'ok') sc.problem(`phone ${p.label}: waitForPendingWrites ${d.result} after ${fmt(d.ms)}`);
  const server = await readServer(E);
  if (OPT.selfTestBreak) { const it = Object.values(E.items)[0], b = Object.keys(it.qty)[0]; it.qty[b] = (it.qty[b] || 0) + 1; }   // --selftest-break: the run must then FAIL
  for (const t of checkServer(E, server)) sc.problem(t);
  const w = await waitPhones(phones, E, server, OPT.converge * 1000);
  sc.m[`converged${label}_ms`] = w.times;
  if (OPT.shadow) {
    // the second listener (kept by whole snapshot, and by docChanges with metadata changes) against the server, on every phone
    const res = {};
    for (const p of phones) {
      const bad = { full: [], chg: [] };
      for (const id of Object.keys(E.items)) {
        const d = server.items[id]; if (!d) continue;
        const sh = await p.call('shadowState', id);
        const want = JSON.stringify(Object.entries(qtyMap(d)).filter(([, q]) => q).sort());
        for (const k of ['full', 'chg']) if (!sh[k] || JSON.stringify(Object.entries(sh[k]).filter(([, q]) => q).sort()) !== want) bad[k].push(id.split('-').slice(-2).join('-'));
      }
      res[p.label] = bad;
    }
    sc.m[`shadowListenerStale${label}`] = res;
  }
  if (!w.stale.length) sc.m[`fromLastWrite_toAllPhonesConverged${label}_ms`] = Date.now() - tStart;
  for (const { p, diffs } of w.stale) {
    sc.problem(`phone ${p.label} did not match the server within ${OPT.converge} s: ${diffs.slice(0, 3).map(x => x.text).join('; ')}`);
    sc.m[`stale${label}_${p.label}`] = await diagnose(p, diffs[0], server);
    sc.m[`pending${label}_${p.label}`] = await p.call('pending');
    const det = await staleDetail(p, diffs[0], server);
    sc.m[`staleDetail${label}_${p.label}`] = det;
    sc.note(`stale phone ${p.label}: ${sc.m[`stale${label}_${p.label}`]}; the page last heard ${JSON.stringify(det.lastHeardByPage.slice(-2))}; probe ${JSON.stringify(det.probe)}; ${det.shadowListener ? 'second listener says ' + JSON.stringify(det.shadowListener) + '; ' : ''}after listening again: ${det.afterListeningAgain}`);
  }
  return server;
}
const phoneProblem = async (sc, phones) => {
  for (const p of phones) {
    const r = await p.call('refused');
    if (r.length) sc.problem(`phone ${p.label} had ${r.length} refused write(s): ${r.slice(0, 3).map(x => `${x.op} ${x.kind}/${x.id} ${x.code}`).join('; ')}`);
  }
};
// everyone sees these documents (after seeding)
async function seeAll(phones, E, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    let ok = true;
    for (const p of phones) { const st = await p.state(); for (const id of Object.keys(E.items)) if (!st.items[id]) ok = false; for (const id of Object.keys(E.shop)) if (!st.shop[id]) ok = false; }
    if (ok) return Date.now() - t0;
    if (Date.now() - t0 > ms) throw new Error('the phones never saw the seeded documents');
    await sleep(120);
  }
}
async function seedDocs(phone, E, phones, items = [], lines = []) {
  for (const it of items) { made('items', it.id); await phone.act('newItem', it); E.items[it.id] = E.items[it.id] || { qty: Object.fromEntries(it.batches.map(b => [b.id, b.qty])) }; }
  for (const l of lines) { made('shop', l); await phone.act('addLine', l, 'Line ' + l); E.shop[l] = { done: false, removed: false }; }
  const d = await phone.call('drain', 30000);
  if (d.result !== 'ok') throw new Error('seeding did not reach the server: ' + d.result);
  await seeAll(phones, E);
}
const goOffline = async (p) => { await p.offline(true); await sleep(OPT.settle); };

// ---- scenarios -----------------------------------------------------------------------------------------------------------------

class Scenario {
  constructor(id, name) { Object.assign(this, { id, name, problems: [], notes: [], m: {}, status: 'PASS', ms: 0 }); }
  problem(t) { this.problems.push(t); }
  note(t) { this.notes.push(t); }
}

// 1. three phones online, concurrent changes on the same items
async function s1(sc) {
  await withPhones(3, async ([A, B, C]) => {
    const E = newExpected(), run = stepper(E, sc);
    const rice = `${runTag}-s1-rice`, milk = `${runTag}-s1-milk`, eggs = `${runTag}-s1-eggs`;
    await seedDocs(A, E, [A, B, C], [mkItem(rice, 'Rice', [['r1', 20], ['r2', 20]]), mkItem(milk, 'Milk', [['m1', 10]]), mkItem(eggs, 'Eggs', [['e1', 10]])]);
    expItem(E, rice, [['r1', 20], ['r2', 20]]); expItem(E, milk, [['m1', 10]]); expItem(E, eggs, [['e1', 10]]);
    await Promise.all([
      run(A, [['use', rice, 'r1'], ['use', rice, 'r1'], ['use', rice, 'r1'], ['add', rice, 2, '2027-05-01', 'bx'], ['use', eggs, 'e1']]),
      run(B, [['use', rice, 'r1'], ['use', rice, 'r1'], ['use', milk, 'm1'], ['use', milk, 'm1'], ['open', milk]]),
      run(C, [['use', rice, 'r2'], ['add', rice, 3, '2027-05-01', 'bx'], ['use', rice, 'r1'], ['use', rice, 'r1'], ['use', rice, 'r1'], ['use', rice, 'r1'], ['set', eggs, 'name', 'Eggs (C)']]),
    ]);
    E.items[eggs].name = 'Eggs (C)';
    await settle(sc, [A, B, C], E);
    await phoneProblem(sc, [A, B, C]);
    sc.note(`${E.events.size} history lines, ${Object.keys(E.items).length} items; rice r1 ended at ${E.items[rice].qty.r1}`);
  });
}

// 2. phone B offline while A and C carry on, then back
async function s2(sc) {
  await withPhones(3, async ([A, B, C]) => {
    const E = newExpected(), run = stepper(E, sc);
    const rice = `${runTag}-s2-rice`, milk = `${runTag}-s2-milk`;
    await seedDocs(A, E, [A, B, C], [mkItem(rice, 'Rice', [['r1', 30]]), mkItem(milk, 'Milk', [['m1', 10]])]);
    expItem(E, rice, [['r1', 30]]); expItem(E, milk, [['m1', 10]]);
    await goOffline(B);
    await run(A, [['use', rice, 'r1'], ['use', rice, 'r1'], ['add', rice, 4, '2027-05-01', 'bx']]);
    await run(C, [['use', rice, 'r1'], ['use', milk, 'm1'], ['add', milk, 1, '2027-06-01', 'mx']]);
    const awayQty = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(E.items).map(([id, e]) => [id, e.qty]))));   // A's and C's changes only
    await Promise.all([A, C].map(p => p.call('drain', 30000)));
    // B is meanwhile unaware; its own changes land only locally
    await run(B, [['use', rice, 'r1'], ['use', rice, 'r1'], ['use', rice, 'r1'], ['add', rice, 2, '2027-05-01', 'bx'], ['use', milk, 'm1'], ['set', rice, 'name', 'Rice (B)']]);
    E.items[rice].name = 'Rice (B)';
    await sleep(500);
    sc.m.bPendingWhileOffline = (await B.call('pending')).pending;
    // the server holds A's and C's changes and none of B's (proof B was really cut off)
    for (const id of Object.keys(awayQty)) {
      for (const t of diffQty(qtyMap(await rest.get('items', id)), awayQty[id], `while B was away, server ${id}/`)) sc.problem(t + ' (B should not have reached the server yet)');
    }
    const tBack = Date.now();
    await B.offline(false);
    await settle(sc, [A, B, C], E);
    sc.m.backOnline_to_B_confirmed_ms = sc.m.drain_ms?.B;
    sc.m.backOnline_total_ms = Date.now() - tBack;
    await phoneProblem(sc, [A, B, C]);
  });
}
// 3. B offline, issues changes, the page is reloaded while offline, comes back: exactly once
async function s3(sc) {
  await withPhones(3, async ([A, B, C]) => {
    const E = newExpected(), run = stepper(E, sc);
    const rice = `${runTag}-s3-rice`, milk = `${runTag}-s3-milk`;
    await seedDocs(A, E, [A, B, C], [mkItem(rice, 'Rice', [['r1', 40]]), mkItem(milk, 'Milk', [['m1', 20]])]);
    expItem(E, rice, [['r1', 40]]); expItem(E, milk, [['m1', 20]]);
    await goOffline(B);
    await run(A, [['use', rice, 'r1']]);
    await run(B, [['use', rice, 'r1'], ['use', rice, 'r1'], ['add', rice, 1, '2027-05-01', 'bx'], ['use', milk, 'm1'], ['set', milk, 'name', 'Milk (B)']]);
    E.items[milk].name = 'Milk (B)';
    // wait until the phone has applied (and so stored) its changes: pending shows on the listeners
    const t0 = Date.now();
    while (Date.now() - t0 < 10000 && (await B.call('pending')).pending < 2) await sleep(100);
    await sleep(800);
    const before = await B.call('pending');
    sc.m.pendingBeforeReload = before.pending;
    // reload the page while still offline
    try { await reloadPage(B); } catch (e) { throw new Error('could not reload the page while offline: ' + redact(e.message).slice(0, 160)); }
    const restored = await B.call('restoreAuth');
    if (!restored) sc.problem('the signed-in account was not restored after a reload while offline');
    const opened = await B.call('open', { wantServer: false, ms: 15000 });
    const after = await B.call('pending');
    sc.m.pendingAfterReload = after.pending;
    sc.m.openedOfflineMs = opened.ms;
    if (after.pending < 1) sc.problem('persistence lost the queue: no writes pending after the reload while offline');
    const st = await B.state();
    const shows = st.items[rice]?.qty?.r1;
    sc.m.bShowsRiceAfterReload = shows;
    if (shows !== 38) sc.problem(`after the reload B should still show its own changes (rice r1 38), shows ${shows}`);
    await B.offline(false);
    await settle(sc, [A, B, C], E);
    await phoneProblem(sc, [A, B, C]);
    sc.note(`pending before reload ${before.pending}, after reload ${after.pending}; all landed exactly once`);
  });
}

// 4. a write the rules refuse, queued between valid ones
async function s4(sc) {
  await withPhones(2, async ([A, B]) => {
    const E = newExpected();
    const P = `${runTag}-s4-p`, Q = [1, 2, 3].map(i => `${runTag}-s4-q${i}`), R = `${runTag}-s4-r`;
    await seedDocs(A, E, [A, B], [mkItem(P, 'P', []), ...Q.map((q, i) => mkItem(q, 'Q' + i, [])), mkItem(R, 'R', [])]);
    const refusedSpec = id => ({ op: 'update', kind: 'items', id, data: { 'batches.bad.qty': 99999 } });
    const inc = (id, b) => B.act('inc', id, b, 1);
    const variants = {};
    await goOffline(B);
    // a: one document: valid w1, refused, valid w2
    await inc(P, 'w1'); await B.call('rawFire', refusedSpec(P)); await inc(P, 'w2');
    // b: three documents: valid, refused, valid
    await inc(Q[0], 'w1'); await B.call('rawFire', refusedSpec(Q[1])); await inc(Q[2], 'w1');
    // c: one document: three valid, refused, three valid
    for (const b of ['w1', 'w2', 'w3']) await inc(R, b);
    await B.call('rawFire', refusedSpec(R));
    for (const b of ['w4', 'w5', 'w6']) await inc(R, b);
    await sleep(500);
    const tBack = Date.now();
    await B.offline(false);
    const d = await B.call('drain', 40000);
    sc.m.drainAfterBackOnline_ms = d.ms; sc.m.drainResult = d.result;
    await sleep(2500);   // late resends, if any, land now
    const acks = await B.call('acks');
    sc.m.writeAnswers = acks.map(a => `${a.name}: ${a.state}${a.ms != null ? ' ' + a.ms + ' ms' : ''}`);
    const read = async id => qtyMap(await rest.get('items', id));
    const doc = async id => rest.get('items', id);
    const count = (q, ...bs) => Object.fromEntries(bs.map(b => [b, q[b] || 0]));
    const qa = await read(P), qb = await Promise.all(Q.map(read)), qc = await read(R);
    variants.a_oneDoc = count(qa, 'w1', 'w2');
    variants.b_threeDocs = { q1_w1: qb[0].w1 || 0, q3_w1: qb[2].w1 || 0 };
    variants.c_threeAroundRefused = count(qc, 'w1', 'w2', 'w3', 'w4', 'w5', 'w6');
    sc.m.timesApplied = variants;
    // was the refused write ever accepted?
    for (const id of [P, Q[1], R]) { const dd = await doc(id); if (dd?.batches && 'bad' in dd.batches) sc.problem(`the refused write was accepted on ${id}!`); }
    const applied = [...Object.values(variants.a_oneDoc), ...Object.values(variants.b_threeDocs), ...Object.values(variants.c_threeAroundRefused)];
    const doubled = applied.filter(n => n > 1).length, lost = applied.filter(n => n === 0).length;
    const verdict = doubled ? 'DOUBLE-COUNT' : lost ? 'LOST-WRITE' : 'exactly-once';
    sc.m.verdict = verdict;
    sc.note(`verdict: ${verdict} (valid writes applied ${JSON.stringify(variants)}); the refused write was answered: ${acks.filter(a => a.name.startsWith('raw')).map(a => a.state).join(', ')}`);
    if (doubled) sc.note('FLAG: a valid increment queued around a refused write was applied more than once');
    if (!acks.some(a => a.state === 'refused')) sc.problem('the refused write was never reported refused (state: ' + acks.filter(a => a.name.startsWith('raw')).map(a => a.state).join(', ') + ')');
    // both phones must still end up with what the server has
    const En = newExpected();
    for (const id of [P, Q[0], Q[1], Q[2], R]) En.items[id] = { qty: {} };
    for (const id of [P, Q[0], Q[1], Q[2], R]) En.items[id].qty = await read(id);
    const server = await readServer(En);
    const w = await waitPhones([A, B], En, server, OPT.converge * 1000);
    sc.m.converged_ms = w.times;
    for (const { p, diffs } of w.stale) sc.problem(`phone ${p.label} did not match the server: ${diffs.slice(0, 2).map(x => x.text).join('; ')}`);
    sc.m.totalMs = Date.now() - tBack;
  });
}

// 5. increment at-least-once probe: kill the connection right after sending
async function s5(sc) {
  await withPhones(2, async ([A, B]) => {
    const E = newExpected();
    const PR = `${runTag}-s5-probe`;
    await seedDocs(A, E, [A, B], [mkItem(PR, 'Probe', [])]);
    const N = 20, delays = [0, 15, 30, 50, 75, 100, 150, 220];
    const pad = n => String(n).padStart(2, '0');
    const iters = [];
    for (let i = 1; i <= N; i++) {
      const delay = delays[(i - 1) % delays.length];
      await A.call('clearAcks');
      await A.act('inc', PR, 'k' + pad(i), 1);                 // not awaited: sent as soon as the SDK gets to it
      if (delay) await sleep(delay);
      const state0 = (await A.call('acks'))[0]?.state;         // had the answer already arrived when the line was cut?
      await A.offline(true);
      await sleep(300);
      await A.offline(false);
      const d = await A.call('drain', 25000);
      iters.push({ i, delay, ackedBeforeCut: state0 === 'ok', drainMs: d.ms, drain: d.result });
      if (d.result !== 'ok') { sc.problem(`probe ${i}: waitForPendingWrites ${d.result}`); }
    }
    await sleep(1500);
    const q = qtyMap(await rest.get('items', PR));
    const per = iters.map(it => ({ ...it, applied: q['k' + pad(it.i)] || 0 }));
    const doubles = per.filter(x => x.applied > 1), lost = per.filter(x => x.applied === 0);
    sc.m.issued = N; sc.m.appliedTotal = per.reduce((n, x) => n + x.applied, 0);
    sc.m.doubleApplies = doubles.length;
    sc.m.doubleApplyDetail = doubles.map(x => ({ iteration: x.i, killedAfterMs: x.delay, ackedBeforeCut: x.ackedBeforeCut, timesApplied: x.applied }));
    sc.m.lostWrites = lost.map(x => x.i);
    sc.m.byDelay = Object.fromEntries(delays.map(dl => [dl + ' ms', per.filter(x => x.delay === dl).map(x => x.applied).join(',')]));
    sc.m.drainMs = per.map(x => x.drainMs);
    sc.note(`${N} increments issued with the connection cut 0-220 ms after each: ${sc.m.appliedTotal} applied, ${doubles.length} applied twice (measurement)${lost.length ? `, ${lost.length} LOST` : ''}`);
    if (doubles.length) sc.note('FLAG: increment() was applied more than once after a connection cut (the SDK resent a write the server had already applied)');
    if (lost.length) sc.problem(`${lost.length} increment(s) never arrived: ${lost.map(x => x.i).join(',')}`);
    // phase 2: acknowledged increments, no cut: must be exactly once
    const M = 10, E2 = newExpected();
    for (let i = 1; i <= M; i++) await A.call('actAwait', 'inc', PR, 'a' + pad(i), 1);
    const q2 = qtyMap(await rest.get('items', PR));
    const bad = []; for (let i = 1; i <= M; i++) if ((q2['a' + pad(i)] || 0) !== 1) bad.push(`a${pad(i)}=${q2['a' + pad(i)] || 0}`);
    sc.m.awaitedIssued = M; sc.m.awaitedWrong = bad;
    if (bad.length) sc.problem(`with every acknowledgement awaited and no connection cut, increments were not applied exactly once: ${bad.join(', ')}`);
    E2.items[PR] = { qty: q2 };
    const server = await readServer(E2);
    const w = await waitPhones([A, B], E2, server, OPT.converge * 1000);
    sc.m.converged_ms = w.times;
    for (const { p, diffs } of w.stale) sc.problem(`phone ${p.label} did not match the server: ${diffs.slice(0, 2).map(x => x.text).join('; ')}`);
  });
}

// 6. the old whole-document array shape against map operations
async function s6(sc) {
  await withPhones(3, async ([A, B, C]) => {
    const phones = [A, B, C];
    const OLD = `${runTag}-s6-old`, OLD2 = `${runTag}-s6-two`;
    const base = { category: 'Other', location: 'Fridge', brand: '', size: '', barcode: '', lowAt: 0, openDays: 7, createdAt: '2026-10-16T00:00:00.000Z', createdBy: 'robust' };
    const arr = (id, name, list) => ({ id, name, ...base, batches: list.map(([bid, qty]) => ({ id: bid, qty, expiry: '2027-01-01', openedAt: null, addedAt: '2026-01-01' })) });
    const E = newExpected();
    const stage = async (label, want) => {
      // want: { qty, arr } for item OLD; check server, every phone's raw state and normalizeItem's reading
      const d = await rest.get('items', OLD);
      const got = qtyMap(d);
      for (const t of diffQty(got, want.qty, `${label}: server ${OLD}/`)) sc.problem(t);
      if (Array.isArray(d.batches) !== want.arr) sc.problem(`${label}: the server holds the ${Array.isArray(d.batches) ? 'array' : 'map'} shape, expected ${want.arr ? 'array' : 'map'}`);
      const t0 = Date.now();
      for (const p of phones) {
        for (;;) {
          const st = (await p.state()).items[OLD], nm = await p.call('normalized', OLD);
          const clamp = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.max(0, v)]).filter(([, v]) => v));
          const ok = st && nm && st.arr === want.arr && JSON.stringify(Object.entries(clamp(st.qty)).sort()) === JSON.stringify(Object.entries(clamp(want.qty)).sort())
            && JSON.stringify(Object.entries(clamp(nm.qty)).sort()) === JSON.stringify(Object.entries(clamp(want.qty)).sort());
          if (ok) break;
          if (Date.now() - t0 > OPT.converge * 1000) { sc.problem(`${label}: phone ${p.label} reads ${JSON.stringify(st?.qty)} (${st?.arr ? 'array' : 'map'}), normalizeItem gives ${JSON.stringify(nm?.qty)}; expected ${JSON.stringify(want.qty)}`); break; }
          await sleep(150);
        }
      }
    };
    // a. an old phone saves the item as the old array
    made('items', OLD); made('items', OLD2);
    await A.call('rawWrite', { op: 'set', kind: 'items', id: OLD, data: arr(OLD, 'Old shape', [['e1', 10], ['e2', 10]]) });
    E.items[OLD] = { qty: { e1: 10, e2: 10 } };
    await seeAll(phones, E);
    await stage('old array on every phone', { qty: { e1: 10, e2: 10 }, arr: true });
    // b. a new phone uses one unit: the item converts to the map, with the use in it
    await B.act('use', OLD, 'e1'); await B.call('drain', 30000);
    await stage('after B used one (conversion)', { qty: { e1: 9, e2: 10 }, arr: false });
    // c. another new phone uses one from e2 (a plain map operation)
    await C.act('use', OLD, 'e2'); await C.call('drain', 30000);
    await stage('after C used one (map operation)', { qty: { e1: 9, e2: 9 }, arr: false });
    // d. an old phone with a copy from before (e1 10, e2 10) uses one of e1 and saves the whole item as an array over the map
    await A.call('rawWrite', { op: 'set', kind: 'items', id: OLD, data: arr(OLD, 'Old shape', [['e1', 9], ['e2', 10]]) });
    await stage('old phone wrote the whole array over the map', { qty: { e1: 9, e2: 10 }, arr: true });
    sc.m.lostByOldPhoneOverwrite = { e1: 1, e2: 1, why: 'B\'s and C\'s uses were overwritten by the old phone\'s whole write (the documented once-per-item window)' };
    // e. a new phone applies a map operation to the array item again: converts, nothing else lost
    await A.act('use', OLD, 'e2'); await A.call('drain', 30000);
    await stage('new phone used one on the array item (second conversion)', { qty: { e1: 9, e2: 9 }, arr: false });
    // f. two new phones convert the same array item at the same moment
    await A.call('rawWrite', { op: 'set', kind: 'items', id: OLD2, data: arr(OLD2, 'Two converters', [['e1', 10]]) });
    E.items[OLD2] = { qty: { e1: 10 } };
    await seeAll(phones, E);
    await Promise.all([B.act('use', OLD2, 'e1'), C.act('use', OLD2, 'e1')]);
    await Promise.all([B, C].map(p => p.call('drain', 30000)));
    await sleep(1000);
    const two = qtyMap(await rest.get('items', OLD2));
    sc.m.concurrentConversion = { e1: two.e1, ideal: 8, lost: 8 - two.e1 };
    if (two.e1 !== 8 && two.e1 !== 9) sc.problem(`concurrent conversion: e1 is ${two.e1}, expected 8 or 9`);
    sc.note(`concurrent conversion by two phones: e1 = ${two.e1} (ideal 8): ${two.e1 === 8 ? 'no unit lost' : 'one unit lost, the documented once-per-item window'}`);
    sc.note('old phone overwrite: lost B\'s and C\'s uses (e1 and e2 one each), as documented; a later map operation converted back with nothing else lost');
    await phoneProblem(sc, phones);
  });
}

// 7. soft-delete races
async function s7(sc) {
  await withPhones(3, async ([A, B, C]) => {
    const phones = [A, B, C];
    const E = newExpected(), run = stepper(E, sc);
    const X = `${runTag}-s7-x`, Y = `${runTag}-s7-y`, L1 = `${runTag}-s7-l1`, L2 = `${runTag}-s7-l2`;
    await seedDocs(A, E, phones, [mkItem(X, 'Xrice', [['b1', 10]]), mkItem(Y, 'Ymilk', [['b1', 10]])], [L1, L2]);
    expItem(E, X, [['b1', 10]], { removed: false }); expItem(E, Y, [['b1', 10]], { removed: false });
    // a. A removes X while B (offline) uses one
    await goOffline(B);
    await A.act('remove', X); await A.call('drain', 30000);
    await run(B, [['use', X, 'b1']]);
    E.items[X].removed = true;
    // b. B (offline) removes Y while A uses one
    await B.act('remove', Y);
    await run(A, [['use', Y, 'b1']]);
    E.items[Y].removed = true;
    // shopping lines: A ticks L1 while B (offline) removes it; B (offline) ticks L2 while A removes it
    await A.act('tick', L1, true); await B.act('removeLine', L1);
    await B.act('tick', L2, true); await A.act('removeLine', L2);
    E.shop[L1] = { done: true, removed: true }; E.shop[L2] = { done: true, removed: true };
    await A.call('drain', 30000);
    await B.offline(false);
    await settle(sc, phones, E, { label: '_afterReturn' });
    // c. restore X and L1: they come back, keeping the use and the tick
    await A.act('restore', X); await A.act('restoreLine', L1);
    E.items[X].removed = false; E.shop[L1].removed = false;
    await settle(sc, phones, E, { label: '_afterRestore' });
    const x = await rest.get('items', X), l1 = await rest.get('shop', L1);
    if ('removedAt' in x || 'removedBy' in x) sc.problem('restored item still carries removal fields');
    if ('removedAt' in l1) sc.problem('restored line still carries removedAt');
    await phoneProblem(sc, phones);
    sc.note('removed-while-used (both orders), tick vs remove (both orders) and restore all held');
  });
}

// 8. live rules spot checks on the test household
async function s8(sc) {
  await withPhones(1, async ([A]) => {
    const w = (op, kind, id, data, merge = false) => { if (op === 'set') made(kind, id); return A.call('rawWrite', { op, kind, id, data, merge }); };
    const map = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`b${String(i).padStart(2, '0')}`, { qty: 1, expiry: null }]));
    const it = (id, batches, more = {}) => ({ id, name: 'Rules ' + id.slice(-4), category: 'Other', location: 'Fridge', brand: '', size: '', barcode: '', lowAt: 0, openDays: 7, createdAt: '2026-10-16T00:00:00.000Z', createdBy: 'robust', batches, ...more });
    const P = n => `${runTag}-s8-${n}`;
    const line = (id, more = {}) => ({ id, name: 'Rule line', done: false, itemId: null, at: '2026-10-16T00:00:00.000Z', by: 'robust', ...more });
    const OK = 'ok', DENY = 'permission-denied';
    const cases = [];
    const add = (name, expect, fn) => cases.push({ name, expect, fn });
    // items
    add('item, map of 60 batches', OK, () => w('set', 'items', P('m60'), it(P('m60'), map(60))));
    add('item, map of 61 batches', DENY, () => w('set', 'items', P('m61'), it(P('m61'), map(61))));
    add('item, old array of 3 batches', OK, () => w('set', 'items', P('arr'), it(P('arr'), [{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }, { id: 'c', qty: 3 }])));
    add('item, batch id with a space', DENY, () => w('set', 'items', P('sp'), it(P('sp'), { 'bad id': { qty: 1 } })));
    add('item, batch id with a dot', DENY, () => w('set', 'items', P('dot'), it(P('dot'), { 'a.b': { qty: 1 } })));
    add('item, 41-character batch id', DENY, () => w('set', 'items', P('id41'), it(P('id41'), { ['x'.repeat(41)]: { qty: 1 } })));
    add('item, quantity 10000', DENY, () => w('set', 'items', P('q10k'), it(P('q10k'), { b1: { qty: 10000 } })));
    add('item, quantity -100', DENY, () => w('set', 'items', P('qm100'), it(P('qm100'), { b1: { qty: -100 } })));
    add('item, quantity -99', OK, () => w('set', 'items', P('qm99'), it(P('qm99'), { b1: { qty: -99 } })));
    add('item, expiry a number', DENY, () => w('set', 'items', P('exn'), it(P('exn'), { b1: { qty: 1, expiry: 5 } })));
    add('item, increment on a map item', OK, () => w('update', 'items', P('m60'), { 'batches.b00.qty': { __inc: -1 } }));
    add('item, increment past the top (9999 + 1)', DENY, async () => { await w('set', 'items', P('top'), it(P('top'), { b1: { qty: 9999 } })); return w('update', 'items', P('top'), { 'batches.b1.qty': { __inc: 1 } }); });
    add('item, removedAt valid time', OK, () => w('update', 'items', P('m60'), { removedAt: '2026-10-16T09:00:00.000Z', removedBy: 'robust' }));
    add('item, removedAt a number', DENY, () => w('update', 'items', P('m60'), { removedAt: 5 }));
    add('item, removedAt not a time', DENY, () => w('update', 'items', P('m60'), { removedAt: 'yesterday' }));
    add('item, removedBy 41 characters', DENY, () => w('update', 'items', P('m60'), { removedBy: 'y'.repeat(41) }));
    add('item, thumb 10 KB', OK, () => w('set', 'items', P('th10'), it(P('th10'), {}, { thumb: 't'.repeat(10240) })));
    add('item, thumb over 12 KB', DENY, () => w('set', 'items', P('th13'), it(P('th13'), {}, { thumb: 't'.repeat(12400) })));
    add('item gains a whole photo', DENY, () => w('set', 'items', P('ph'), it(P('ph'), {}, { photo: 'data:image/jpeg;base64,AAAA' })));
    // events: write once
    add('event, create', OK, () => w('set', 'events', P('ev'), { id: P('ev'), itemId: P('m60'), name: 'Rice', type: 'use', qty: 1, at: '2026-10-16T09:00:00.000Z', by: 'robust' }));
    add('event, rewrite identical', OK, () => w('set', 'events', P('ev'), { id: P('ev'), itemId: P('m60'), name: 'Rice', type: 'use', qty: 1, at: '2026-10-16T09:00:00.000Z', by: 'robust' }));
    add('event, rewrite changed', DENY, () => w('set', 'events', P('ev'), { id: P('ev'), itemId: P('m60'), name: 'Rice', type: 'use', qty: 2, at: '2026-10-16T09:00:00.000Z', by: 'robust' }));
    add('event, update a field', DENY, () => w('update', 'events', P('ev'), { qty: 3 }));
    // shopping lines
    add('line, valid', OK, () => w('set', 'shop', P('l1'), line(P('l1'))));
    add('line, tick by field', OK, () => w('update', 'shop', P('l1'), { done: true, doneBy: 'robust' }));
    add('line, unknown field', DENY, () => w('set', 'shop', P('l2'), line(P('l2'), { text: 'old field' })));
    add('line, 81-character name', DENY, () => w('set', 'shop', P('l3'), line(P('l3'), { name: 'n'.repeat(81) })));
    add('line, id differs from its document', DENY, () => w('set', 'shop', P('l4'), line('another-id')));
    add('line, removedAt a number', DENY, () => w('update', 'shop', P('l1'), { removedAt: 5 }));
    add('line, removedAt valid', OK, () => w('update', 'shop', P('l1'), { removedAt: '2026-10-16T09:00:00.000Z', removedBy: 'robust' }));
    // settings
    add('people, a 40-character name', OK, () => w('set', 'settings', 'people', { id: 'people', names: { 'robust-a@example.test': 'n'.repeat(40) }, updatedAt: '2026-10-16T09:00:00.000Z' }));
    add('people, a 41-character name', DENY, () => w('set', 'settings', 'people', { id: 'people', names: { 'robust-a@example.test': 'n'.repeat(41) }, updatedAt: '2026-10-16T09:00:00.000Z' }));
    add('places, valid list', OK, () => w('set', 'settings', 'places', { id: 'places', list: ['Fridge', 'Pantry'], updatedAt: '2026-10-16T09:00:00.000Z' }));
    add('places, a 41-character place', DENY, () => w('set', 'settings', 'places', { id: 'places', list: ['p'.repeat(41)], updatedAt: '2026-10-16T09:00:00.000Z' }));
    add('settings, another document id', DENY, () => w('set', 'settings', 'other', { id: 'other' }));
    // photos
    add('photo, valid', OK, () => w('set', 'photos', P('m60'), { id: P('m60'), data: 'data:image/jpeg;base64,AAAA', updatedAt: '2026-10-16T09:00:00.000Z' }));
    add('photo, extra field', DENY, () => w('set', 'photos', P('m60'), { id: P('m60'), data: 'x', updatedAt: 'x', more: 1 }));
    const table = [];
    for (const c of cases) {
      const r = await c.fn();
      const got = r.ok ? OK : r.code;
      table.push({ case: c.name, expected: c.expect, got });
      if (got !== c.expect) sc.problem(`${c.name}: expected ${c.expect}, got ${got}`);
    }
    sc.m.cases = table.length; sc.m.allowedOk = table.filter(t => t.expected === OK && t.got === OK).length; sc.m.deniedOk = table.filter(t => t.expected === DENY && t.got === DENY).length;
    sc.m.table = table;
    sc.note(`${table.length} cases: ${sc.m.allowedOk} allowed as expected, ${sc.m.deniedOk} denied with permission-denied`);
  });
}

// 9. randomised: three phones, random changes, random offline spells
async function s9(sc) {
  for (const seed of OPT.seeds) {
    const sub = { problems: [], m: {}, notes: [] };
    const t0 = Date.now();
    try { await randomRun(seed, sub); }
    catch (e) { sub.problems.push('ERROR: ' + redact(e.message).slice(0, 300)); }
    sc.m['seed_' + seed] = sub.m;
    for (const p of sub.problems) sc.problem(`seed ${seed}: ${p}`);
    for (const n of sub.notes) sc.note(`seed ${seed}: ${n}`);
    sc.note(`seed ${seed}: ${sub.problems.length ? 'FAILED' : 'ok'} (${fmt(Date.now() - t0)}; ${Object.entries(sub.m.actions || {}).map(([k, v]) => `${v} ${k}`).join(', ')})`);
  }
}
async function randomRun(seed, sub) {
  healthy = () => !sub.problems.length;
  await withPhones(3, async phones => {
    const [A] = phones;
    const sc = { problem: t => sub.problems.push(t), m: sub.m, note: t => sub.notes.push(t) };
    const R = rng(seed), pick = a => a[Math.floor(R() * a.length)];
    const tag = `${runTag}-z${seed}`;
    const ids = [`${tag}-rice`, `${tag}-milk`, `${tag}-eggs`];
    const E = newExpected();
    const base = { category: 'Other', location: 'Fridge', brand: '', size: '', barcode: '', lowAt: 0, openDays: 7, createdAt: '2026-10-16T00:00:00.000Z', createdBy: 'robust' };
    const mk = (bid, qty, expiry) => ({ id: bid, qty, expiry, openedAt: null, addedAt: '2026-01-01' });
    // two maps and one old array (converted by one change first, as in multidevice.e2e.mjs)
    await seedDocs(A, E, phones, [mkItem(ids[0], 'Rice', [['r1', 6], ['r2', 6], ['r3', 6, null]]), mkItem(ids[1], 'Milk', [['m1', 5, '2026-12-01'], ['m2', 5, '2027-02-01']])]);
    made('items', ids[2]);
    await A.call('rawWrite', { op: 'set', kind: 'items', id: ids[2], data: { id: ids[2], name: 'Eggs', ...base, batches: [mk('e1', 6, '2027-01-01'), mk('e2', 6, '2027-04-01')] } });
    E.items[ids[2]] = { qty: { e1: 6, e2: 6 } };
    await seeAll(phones, E);
    expItem(E, ids[0], [['r1', 6], ['r2', 6], ['r3', 6]]); expItem(E, ids[1], [['m1', 5], ['m2', 5]]);
    const names = Object.fromEntries(ids.map(id => [id, new Set()]));
    const orig = { [ids[0]]: 'Rice', [ids[1]]: 'Milk', [ids[2]]: 'Eggs' };
    { const res = await A.act('use', ids[2], 'e1'); tally1(E, ids[2], res); await A.call('drain', 30000); for (const p of phones) { for (let k = 0; k < 100; k++) { if ((await p.call('normalized', ids[2]))?.arr === false) break; await sleep(100); } } }
    const lineIds = [0, 1, 2, 3, 4].map(k => `${tag}-l${k}`);
    await seedDocs(A, E, phones, [], lineIds);
    const lineDone = Object.fromEntries(lineIds.map(l => [l, false]));
    const removedIssued = new Set(), restoredIssued = new Set();
    const offline = [false, false, false];
    const actions = { use: 0, add: 0, open: 0, rename: 0, delete: 0, restore: 0, tick: 0, removeLine: 0, restoreLine: 0, toggles: 0 };
    const drainTimes = [];
    for (let step = 0; step < OPT.steps; step++) {
      const i = Math.floor(R() * 3), p = phones[i], id = pick(ids);
      const r = R();
      if (r < 0.10) {
        // (safe: a phone confirms what it sent before it drops offline, as in the emulator test; raw: it drops at any moment)
        if (OPT.toggle === 'safe' && !offline[i]) { const d = await p.call('drain', 30000); drainTimes.push([p.label, d.ms, d.result]); }
        offline[i] = !offline[i]; await p.offline(offline[i]); actions.toggles++;
        if (!offline[i] && OPT.toggle === 'safe') { const d = await p.call('drain', 30000); drainTimes.push([p.label, d.ms, d.result]); }
      } else if (r < 0.32) {
        const nm = await p.call('normalized', id); const mine = Object.entries(nm?.qty || {}).filter(([, q]) => q > 0);
        if (!mine.length) continue;
        const res = await p.act('use', id, pick(mine)[0]); if (res) { tally1(E, id, res); actions.use++; }
      } else if (r < 0.44) {
        const res = await p.act('add', id, 1 + Math.floor(R() * 3), '2027-0' + (1 + Math.floor(R() * 9)) + '-15', `a${step}`); if (res) { tally1(E, id, res); actions.add++; }
      } else if (r < 0.50) {
        const res = await p.act('open', id); if (res) { tally1(E, id, res); actions.open++; }
      } else if (r < 0.56) {
        const name = `${id.split('-').pop()}-${step}`; await p.act('set', id, 'name', name); names[id].add(name); actions.rename++;
      } else if (r < 0.68) {
        const did = pick([ids[0], ids[1]]); await p.act('remove', did); removedIssued.add(did); actions.delete++;
      } else if (r < 0.73) {
        if (!(await p.state()).items[ids[1]]?.removed) continue;
        await p.act('restore', ids[1]); restoredIssued.add(ids[1]); actions.restore++;
      } else if (r < 0.84) {
        const lid = pick(lineIds.filter((_, k) => k % 3 === i)); lineDone[lid] = !lineDone[lid]; await p.act('tick', lid, lineDone[lid]); actions.tick++;
      } else if (r < 0.92) {
        const lid = pick(lineIds.slice(0, 4)); await p.act('removeLine', lid); removedIssued.add(lid); actions.removeLine++;
      } else {
        const lid = pick(lineIds.slice(2, 4)); if (!(await p.state()).shop[lid]?.removed) continue;
        await p.act('restoreLine', lid); restoredIssued.add(lid); actions.restoreLine++;
      }
      await sleep(Math.floor(R() * 60));
    }
    sub.m.actions = actions;
    // everyone back online; what each phone is still waiting to send; then confirm, read the server, compare
    for (let i = 0; i < 3; i++) if (offline[i]) await phones[i].offline(false);
    sub.m.pendingAtEnd = Object.fromEntries(await Promise.all(phones.map(async p => [p.label, (await p.call('pending')).pending])));
    const mustBeRemoved = x => removedIssued.has(x) && !restoredIssued.has(x);
    for (const id of ids) {
      E.items[id].removed = mustBeRemoved(id) ? true : (id === ids[2] ? false : undefined);
      if (names[id].size) E.items[id].nameOneOf = new Set([...names[id], orig[id]]);
    }
    for (const lid of lineIds) E.shop[lid].done = lineDone[lid];
    for (const [k, lid] of lineIds.entries()) E.shop[lid].removed = mustBeRemoved(lid) ? true : (k === 4 ? false : undefined);
    sub.m.drainDuringRun = drainTimes.length;
    sub.m.slowDrainsDuringRun = drainTimes.filter(([, ms, r]) => ms > 5000 || r !== 'ok');
    const tEnd = Date.now();
    await settle(sc, phones, E);
    sub.m.settleTotal_ms = Date.now() - tEnd;
    await phoneProblem(sc, phones);
    // a phone that never saw its own change the server has: reported by settle; the events must all be there
  });
}

// ---- the run ---------------------------------------------------------------------------------------------------------------------

const SCENARIOS = [
  ['1', 'basic: three phones online', s1, 120],
  ['2', 'offline: one phone away', s2, 150],
  ['3', 'reload with pending writes', s3, 150],
  ['4', 'a refused write in the queue', s4, 180],
  ['5', 'increment at-least-once probe', s5, 400],
  ['6', 'old array shape vs map operations', s6, 200],
  ['7', 'soft-delete races', s7, 200],
  ['8', 'rules spot-checks (live)', s8, 150],
  ['9', 'randomised, three phones', s9, 100 * OPT.seeds.length + 200],
];
const estimate = () => {
  const writes = tally.writes + rest.stats.deletes + rest.stats.writes;
  const reads = tally.listenReads + rest.stats.reads + tally.writes;   // + one rules lookup of the household document per write
  return { writes, reads, total: writes + reads, note: 'approximate: listener documents received + REST reads + one rules lookup per write; writes = SDK writes + deletes' };
};
const report = { engine: OPT.engine, mode: DRY ? 'dry (emulator)' : 'live', household: HID, project: PROJECT, started: started.toISOString(), options: { ...OPT, out: undefined }, scenarios: [], blockedHosts: [], estimate: null, browser: '', phoneErrors: [] };

async function reset() {
  let n = 0;
  if (!DRY && !tokenSource) {
    // a throwaway phone just to get a token (it does not listen, so it reads nothing)
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route(url => !isApiHost(url.href), onRoute);
    const page = await ctx.newPage();
    const p = new Phone('A', USERS[0], ctx, page);
    allPhones.add(p);
    await goPage(p);
    const r = await p.call('signIn', USERS[0].email, USERS[0].password);
    if (!r.ok) throw new Error('reset: sign-in failed: ' + r.code);
    tokenSource = () => p.call('token');
    try {
      for (const k of Lib.RESET_KINDS) for (const d of await rest.list(k)) { await rest.del(k, d._id); n++; }
    } finally { tokenSource = null; cachedToken = { t: 0, v: '' }; await p.close(); }
  } else {
    for (const k of Lib.RESET_KINDS) for (const d of await rest.list(k)) { await rest.del(k, d._id); n++; }
  }
  out(`reset: deleted ${n} documents under ${HID} (items, events, shop, settings, photos); the household document was not touched`);
}

async function checkHousehold() {
  const members = async () => rest.household();
  let h;
  if (DRY) {
    // the emulator has nothing yet: made-up accounts and the household document (admin write, emulator only)
    for (const u of USERS) {
      const r = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ email: u.email, password: u.password, emailVerified: true, returnSecureToken: true }) });
      if (!r.ok && !/EMAIL_EXISTS/.test(await r.text())) throw new Error('dry: could not create an emulator account: HTTP ' + r.status);
    }
    await rest.putHousehold({ name: 'Robustness test (emulator)', owner: USERS[0].email, members: USERS.map(u => u.email), createdAt: new Date().toISOString() });
    h = await members();
  } else {
    // a live check needs a token: sign in a throwaway phone briefly
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route(url => !isApiHost(url.href), onRoute);
    const page = await ctx.newPage();
    const p = new Phone('A', USERS[0], ctx, page);
    allPhones.add(p);
    try {
      await goPage(p);
      let r = await p.call('signIn', USERS[0].email, USERS[0].password);
      // the real config's key may be limited to the app's own address: fall back to the key from the creds file
      if (!r.ok && OPT.key === 'auto' && !useCredsKey && /referer|api-key|invalid-api-key|requests-from|app-not-authorized|internal-error/i.test(r.code || '')) {
        out(`sign-in with config.js's key was refused (${r.code}); switching to the key from the creds file (authDomain ${PROJECT}.firebaseapp.com)`);
        useCredsKey = true;
        await reloadPage(p);
        r = await p.call('signIn', USERS[0].email, USERS[0].password);
      }
      if (!r.ok) throw new Error('sign-in failed: ' + (r.code || 'unknown'));
      tokenSource = () => p.call('token');
      h = await members();
    } finally { tokenSource = null; cachedToken = { t: 0, v: '' }; await p.close(); }
  }
  const have = new Set((h.members || []).map(x => String(x).toLowerCase()));
  const want = new Set(USERS.map(u => u.email.toLowerCase()));
  if (![...want].every(e => have.has(e))) throw new Error('the household document does not list all three test users as members');
  if ([...have].some(e => !want.has(e))) throw new Error('refusing: the household has members other than the three test users');
  out(`household ${HID}: members check ok${useCredsKey && !DRY ? ' (using the creds key)' : ''}`);
}

let failed = false;
try {
  const ver = { chromium: 'chromium', firefox: 'firefox', webkit: 'webkit', chrome: 'chromium' }[OPT.engine];
  // (--dry only: a page whose files come from the test's own cache has no network address, so Chromium's local-network
  // checks would refuse its calls to the emulators on 127.0.0.1; the live service is on public addresses and needs nothing)
  const args = DRY && ver === 'chromium' ? ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests'] : [];
  browser = await PW[ver].launch({ headless: !OPT.headed, args, ...(OPT.engine === 'chrome' ? { channel: 'chrome' } : {}) });
  report.browser = `${OPT.engine} ${browser.version()}`;
  out(`pantry live harness: ${DRY ? 'DRY RUN against the emulators' : 'LIVE service'}, project ${PROJECT}, household ${HID}, engine ${report.browser}`);
  await checkHousehold();
  if (OPT.reset) await reset();
  const chosen = OPT.only.includes('none') ? [] : SCENARIOS.filter(([id]) => !OPT.only.length || OPT.only.includes(id));
  for (const [id, name, fn, limit] of chosen) {
    const sc = new Scenario(id, name);
    const e = estimate();
    if (e.total > OPT.budget) { sc.status = 'SKIPPED'; sc.note(`over the traffic budget (${e.total} > ${OPT.budget})`); report.scenarios.push(sc); out(`SKIP  ${id} ${name} [${OPT.engine}]: ${sc.notes[0]}`); continue; }
    const t0 = Date.now(), e0 = estimate();
    healthy = () => !sc.problems.length;
    let timer;
    try {
      await Promise.race([fn(sc), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${limit} s`)), limit * 1000); })]);
    } catch (e2) { sc.error = redact(e2.stack ? String(e2.message) : String(e2)).slice(0, 400); sc.problem('ERROR: ' + sc.error); }
    clearTimeout(timer);
    for (const p of [...allPhones]) { report.phoneErrors.push(...p.errors.filter(x => !/Failed to load resource|net::ERR|WebChannel|transport errored|offline|the client is offline/i.test(x)).map(x => `${id}/${p.label}: ${x}`)); await p.close(); tally.writes += p.total.writes; tally.listenReads += p.total.listenReads; }
    sc.ms = Date.now() - t0;
    { const e1 = estimate(); sc.traffic = { reads: e1.reads - e0.reads, writes: e1.writes - e0.writes }; }
    sc.status = sc.error ? 'ERROR' : sc.problems.length ? 'FAIL' : 'PASS';
    if (sc.status !== 'PASS') failed = true;
    report.scenarios.push(sc);
    out(`${sc.status.padEnd(5)} ${id} ${name} [${OPT.engine}] (${fmt(sc.ms)}; about ${sc.traffic.reads} reads + ${sc.traffic.writes} writes)`);
    for (const n of sc.notes) out('        ' + n);
    for (const k of ['converged_ms', 'converged_afterReturn_ms', 'drain_ms']) if (sc.m[k]) out(`        ${k}: ${Object.entries(sc.m[k]).map(([p, v]) => `${p} ${fmt(v)}`).join(', ')}`);
    for (const p of sc.problems) out('      ! ' + p);
  }
  report.estimate = estimate();
  report.blockedHosts = [...blocked];
  if (blocked.size) out(`blocked requests to: ${[...blocked].join(', ')} (not on the allow-list; see LIVE-TEST.md if something needed them)`);
  if (report.phoneErrors.length) out(`page errors seen (${report.phoneErrors.length}), first: ${report.phoneErrors[0]}`);
  out(`estimated traffic: about ${report.estimate.reads} reads + ${report.estimate.writes} writes (limit ${OPT.budget} for reads+writes)`);
  const failedN = report.scenarios.filter(s => ['FAIL', 'ERROR'].includes(s.status)).length;
  out(`${failedN ? 'FAILED' : 'ALL PASSED'}: ${report.scenarios.filter(s => s.status === 'PASS').length} passed, ${failedN} failed, ${report.scenarios.filter(s => s.status === 'SKIPPED').length} skipped [${OPT.engine}]`);
} catch (e) {
  failed = true;
  err('harness stopped: ' + (e.message || e));
  report.fatal = redact(e.message || String(e));
} finally {
  report.finished = new Date().toISOString();
  if (OPT.out) {
    try { writeFileSync(OPT.out, redact(JSON.stringify(report, (k, v) => v instanceof Set ? [...v] : v, 2))); out('report written to ' + OPT.out); } catch (e) { err('could not write the report: ' + e.message); }
  }
  for (const p of [...allPhones]) await p.close();
  try { await browser?.close(); } catch { /* closed */ }
  srv.close();
}
process.exit(failed ? 1 : 0);
