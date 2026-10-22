// Shared, pure helpers for the live-service harness (live-multidevice.mjs): the safety guards, the Firestore REST
// codec and reader, secret redaction and a seeded random generator. No Node-only imports, so the harness page
// (live-page.mjs) can use the same guards in the browser. Tested without Firebase by live-guards.test.mjs.
//
// The guards, in one place on purpose:
//   - every document path is built by docPath() / collPath(), which throw unless the household id starts with
//     `robust-test-` (and the kind and id look right);
//   - every REST request goes through guardedFetch(), which refuses any URL that isn't (a) a document or collection under
//     that test household, or (b) the household document itself, read-only;
//   - the browsers may only talk to localhost, Google's gstatic CDN and Firebase (hostAllowed);
//   - everything printed passes through redact(), which hides passwords, API keys and tokens.

export const TEST_PREFIX = 'robust-test-';
export const KINDS_OK = ['items', 'events', 'shop', 'settings', 'photos'];
// the kinds --reset empties (never the household document itself)
export const RESET_KINDS = ['items', 'events', 'shop', 'settings', 'photos'];

const HID = /^robust-test-[A-Za-z0-9_-]{1,60}$/;
const DOC_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function assertTestHousehold(hid) {
  if (typeof hid !== 'string' || !HID.test(hid)) throw new Error(`refusing: household id must look like ${TEST_PREFIX}<date> (letters, digits, - and _ only)`);
  return hid;
}
export function docPath(hid, kind, id) {
  assertTestHousehold(hid);
  if (!KINDS_OK.includes(kind)) throw new Error(`refusing: unknown collection "${kind}"`);
  if (typeof id !== 'string' || !DOC_ID.test(id)) throw new Error('refusing: bad document id');
  return `households/${hid}/${kind}/${id}`;
}
export function collPath(hid, kind) {
  assertTestHousehold(hid);
  if (!KINDS_OK.includes(kind)) throw new Error(`refusing: unknown collection "${kind}"`);
  return `households/${hid}/${kind}`;
}
// the household document: reading it (to check we are members) is allowed, nothing else ever touches it
export function householdPath(hid) { assertTestHousehold(hid); return `households/${hid}`; }

// The harness page only runs on localhost.
export const localHost = h => /^(localhost|127\.0\.0\.1)$/.test(String(h || ''));

// ---- network allow-list --------------------------------------------------------------------------------------------

// Hosts a phone's browser may reach: this machine, the gstatic CDN (the Firebase SDK), and Firebase itself. The app's own
// address and the project's firebaseapp.com host are allowed for Firebase's sign-in helper pages only (/__/auth/, /__/firebase/).
export function hostAllowed(href, { project = '', extra = [] } = {}) {
  let u;
  try { u = new URL(href); } catch { return false; }
  if (['data:', 'blob:', 'about:'].includes(u.protocol)) return true;
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return false;
  const h = u.hostname.toLowerCase();
  if (localHost(h)) return true;
  if (extra.includes(h)) return true;
  if (h === 'www.gstatic.com' && u.protocol === 'https:') return true;
  if (['firestore.googleapis.com', 'identitytoolkit.googleapis.com', 'securetoken.googleapis.com'].includes(h) && u.protocol === 'https:') return true;
  const helper = /^\/__\/(auth|firebase)\//.test(u.pathname);
  if (helper && u.protocol === 'https:' && (h === 'pantry.flamingbeing.com' || (project && h === `${project}.firebaseapp.com`))) return true;
  return false;
}
export const API_HOSTS = ['firestore.googleapis.com', 'identitytoolkit.googleapis.com', 'securetoken.googleapis.com'];
export const isApiHost = href => { try { return API_HOSTS.includes(new URL(href).hostname.toLowerCase()); } catch { return false; } };

// ---- secrets never reach the output ---------------------------------------------------------------------------------

export function makeRedactor(secrets = []) {
  const list = [...new Set(secrets.map(String).filter(s => s.length >= 4))].sort((a, b) => b.length - a.length);
  return text => {
    let s = String(text);
    for (const x of list) s = s.split(x).join('[hidden]');
    return s
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[hidden-key]')
      .replace(/eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]*/g, '[hidden-token]')
      .replace(/([?&](?:key|apiKey|token|access_token)=)[^&\s"']+/gi, '$1[hidden]')
      .replace(/(Bearer\s+)[0-9A-Za-z._~+/-]{8,}/g, '$1[hidden]')
      .replace(/("(?:password|apiKey|idToken|refreshToken|access_token)"\s*:\s*")[^"]*"/gi, '$1[hidden]"');
  };
}

// ---- the creds file ---------------------------------------------------------------------------------------------------

// { project, household, apiKey, users: { uid: { email, password } } } (never in the repo). Returns it checked, or throws.
export function validateCreds(c) {
  const bad = m => { throw new Error('creds file: ' + m); };
  if (!c || typeof c !== 'object') bad('not a JSON object');
  if (typeof c.project !== 'string' || !/^[a-z0-9-]{4,40}$/.test(c.project)) bad('"project" missing or odd');
  assertTestHousehold(c.household);
  if (typeof c.apiKey !== 'string' || c.apiKey.length < 10) bad('"apiKey" missing');
  const ids = Object.keys(c.users || {});
  if (ids.length !== 3) bad('"users" must hold exactly 3 throwaway accounts');
  for (const id of ids) {
    const u = c.users[id];
    if (!u || typeof u.email !== 'string' || !u.email.includes('@') || typeof u.password !== 'string' || u.password.length < 6) bad(`user ${id}: email and password needed`);
  }
  return c;
}
export const secretsOf = c => [c.apiKey, ...Object.values(c.users || {}).flatMap(u => [u.password])];

// ---- Firestore REST codec (reading, and seeding the emulator) ----------------------------------------------------------

export const val = v => v === null || v === undefined ? { nullValue: null } : typeof v === 'string' ? { stringValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'boolean' ? { booleanValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : { mapValue: { fields: fields(v) } };
export const fields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));
export const unval = v => 'stringValue' in v ? v.stringValue : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? v.doubleValue : 'nullValue' in v ? null : 'arrayValue' in v ? (v.arrayValue.values || []).map(unval)
  : 'mapValue' in v ? unfields(v.mapValue.fields || {}) : undefined;
export const unfields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, unval(v)]));

// Every REST request goes through here. `base` is `https://firestore.googleapis.com/v1/projects/<p>/databases/(default)/documents`
// (or the emulator's). The path after it must be under the test household (a document or collection of it), or the household
// document itself with GET only. Anything else throws before a byte is sent.
export function restTarget(base, hid, path, method = 'GET') {
  assertTestHousehold(hid);
  const rel = String(path).replace(/^\/+/, '');
  const parts = rel.split('/');
  const underHousehold = parts[0] === 'households' && parts[1] === hid;
  if (!underHousehold) throw new Error('refusing: path is outside the test household');
  if (parts.length === 2) {
    if (method !== 'GET') throw new Error('refusing: the household document is read-only here');
  } else {
    if (!KINDS_OK.includes(parts[2])) throw new Error('refusing: unknown collection');
    if (parts.length === 4) docPath(hid, parts[2], parts[3]);
    else if (parts.length !== 3) throw new Error('refusing: path too deep');
    if (parts.length === 3 && method !== 'GET') throw new Error('refusing: write to a collection');
  }
  if (!['GET', 'DELETE', 'PATCH'].includes(method)) throw new Error('refusing: method ' + method);
  return `${base.replace(/\/$/, '')}/${rel}`;
}

// A small REST client for the judge (reads server state, independent of every phone's SDK and cache) and for --reset.
// `token()` returns the bearer token (a signed-in test user's, or 'owner' for the emulator). Counts reads and deletes.
export function makeRest({ base, hid, token, fetchImpl = globalThis.fetch, patchAllowed = false }) {
  assertTestHousehold(hid);
  const stats = { reads: 0, deletes: 0, writes: 0 };
  const call = async (method, path, body, query = '') => {
    const url = restTarget(base, hid, path, method) + query;
    const r = await fetchImpl(url, { method, headers: { Authorization: 'Bearer ' + await token(), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return r;
  };
  return {
    stats,
    async get(kind, id) {
      const r = await call('GET', docPath(hid, kind, id));
      stats.reads++;
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`REST get ${kind}/${id}: HTTP ${r.status}`);
      return unfields((await r.json()).fields || {});
    },
    async household() {
      const r = await call('GET', householdPath(hid));
      stats.reads++;
      if (!r.ok) throw new Error(`REST get household: HTTP ${r.status}`);
      return unfields((await r.json()).fields || {});
    },
    async list(kind) {
      const out = []; let pageToken = '';
      do {
        const r = await call('GET', collPath(hid, kind), null, '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
        if (!r.ok) throw new Error(`REST list ${kind}: HTTP ${r.status}`);
        const j = await r.json();
        const docs = (j.documents || []);
        stats.reads += Math.max(1, docs.length);
        out.push(...docs.map(d => ({ _id: d.name.split('/').pop(), ...unfields(d.fields || {}) })));
        pageToken = j.nextPageToken || '';
      } while (pageToken);
      return out;
    },
    async del(kind, id) {
      const r = await call('DELETE', docPath(hid, kind, id));
      stats.deletes++;
      if (!r.ok && r.status !== 404) throw new Error(`REST delete ${kind}/${id}: HTTP ${r.status}`);
    },
    // only for the emulator (dry mode seeds the household document there); a live run never has patchAllowed
    async putHousehold(data) {
      if (!patchAllowed) throw new Error('refusing: REST writes are only for the emulator');
      const r = await fetchImpl(`${base.replace(/\/$/, '')}/${householdPath(hid)}`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + await token(), 'content-type': 'application/json' }, body: JSON.stringify({ fields: fields(data) }) });
      stats.writes++;
      if (!r.ok) throw new Error(`REST put household: HTTP ${r.status}`);
    },
    async put(kind, id, data) {
      if (!patchAllowed) throw new Error('refusing: REST writes are only for the emulator');
      const r = await call('PATCH', docPath(hid, kind, id), { fields: fields(data) });
      stats.writes++;
      if (!r.ok) throw new Error(`REST put ${kind}/${id}: HTTP ${r.status}`);
    },
  };
}

// ---- reading what the server has -----------------------------------------------------------------------------------------

// A stored item's quantities as { batchId: qty } whichever shape it is in (map or the old array); missing -> {}.
export function qtyMap(doc) {
  const b = doc?.batches;
  if (Array.isArray(b)) return Object.fromEntries(b.filter(x => x && typeof x === 'object').map((x, i) => [x.id || `#${i}`, Number(x.qty) || 0]));
  if (b && typeof b === 'object') return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Number(v?.qty) || 0]));
  return {};
}
export const isRemovedDoc = d => !!d && typeof d.removedAt === 'string' && d.removedAt !== '';
// Compare two { id: qty } maps ignoring zeros (a spent batch may be absent or 0). Returns a list of differences.
export function diffQty(got, want, label = '') {
  const out = [];
  for (const k of new Set([...Object.keys(got || {}), ...Object.keys(want || {})])) {
    const g = (got || {})[k] ?? 0, w = (want || {})[k] ?? 0;
    if (g !== w) out.push(`${label}${k}: ${g}, expected ${w}`);
  }
  return out;
}

// ---- seeded random numbers (the same generator as multidevice.e2e.mjs) ------------------------------------------------------

export const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// ---- the command line ---------------------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const o = { engine: 'chromium', seeds: [11], steps: 30, converge: 30, budget: 2000, out: '', dry: false, reset: false, only: [], key: 'auto', headed: false, toggle: 'safe', settle: 1500, selfTestBreak: false, shadow: false, keep: false, port: 0, allowHosts: [] };
  const need = (i, name) => { if (i + 1 >= argv.length) throw new Error(`${name} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') o.dry = true;
    else if (a === '--reset') o.reset = true;
    else if (a === '--headed') o.headed = true;
    else if (a === '--selftest-break') o.selfTestBreak = true;
    else if (a === '--shadow') o.shadow = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '--engine') o.engine = need(i++, a);
    else if (a === '--seeds') o.seeds = need(i++, a).split(',').map(s => Number(s.trim())).filter(Number.isFinite);
    else if (a === '--steps') o.steps = Number(need(i++, a));
    else if (a === '--converge') o.converge = Number(need(i++, a));
    else if (a === '--budget') o.budget = Number(need(i++, a));
    else if (a === '--out') o.out = need(i++, a);
    else if (a === '--only') o.only = need(i++, a).split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--key') o.key = need(i++, a);
    else if (a === '--toggle') o.toggle = need(i++, a);
    else if (a === '--settle') o.settle = Number(need(i++, a));
    else if (a === '--port') o.port = Number(need(i++, a));
    else if (a === '--allow-host') o.allowHosts.push(need(i++, a).toLowerCase());
    else throw new Error(`unknown option ${a}`);
  }
  if (!['chromium', 'firefox', 'webkit', 'chrome'].includes(o.engine)) throw new Error('--engine: chromium, firefox, webkit or chrome');
  if (!['auto', 'config', 'creds'].includes(o.key)) throw new Error('--key: auto, config or creds');
  if (!['safe', 'raw'].includes(o.toggle)) throw new Error('--toggle: safe or raw');
  if (!o.seeds.length || !(o.steps > 0)) throw new Error('--seeds and --steps need numbers');
  return o;
}
