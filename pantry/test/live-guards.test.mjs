// Tests for the safety guards of the live-service harness (live-multidevice.mjs): they run in Node with no Firebase, no
// browser and no network. The harness may only ever touch households whose id starts with `robust-test-`, may delete only
// under that household, may reach only localhost, gstatic and Firebase, and never prints a password, key or token.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Lib from './live-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const HID = 'robust-test-2026-10-16';

// ---- the household id --------------------------------------------------------------------------------------------------
assert.equal(Lib.assertTestHousehold(HID), HID);
assert.equal(Lib.assertTestHousehold('robust-test-dry-abc_1'), 'robust-test-dry-abc_1');
for (const bad of ['', 'robust-test-', 'robust-test', 'robust-testX', 'Robust-Test-1', 'households', 'real-household-id', 'xrobust-test-1', 'robust-test-a/b', 'robust-test-a b', 'robust-test-../x', 'robust-test-' + 'a'.repeat(61), null, undefined, 5, {}, ['robust-test-1']]) {
  assert.throws(() => Lib.assertTestHousehold(bad), /refusing/, `household ${JSON.stringify(bad)} must be refused`);
  assert.throws(() => Lib.docPath(bad, 'items', 'x'), /refusing/);
  assert.throws(() => Lib.collPath(bad, 'items'), /refusing/);
  assert.throws(() => Lib.householdPath(bad), /refusing/);
}

// ---- paths ------------------------------------------------------------------------------------------------------------
assert.equal(Lib.docPath(HID, 'items', 'abc-1'), `households/${HID}/items/abc-1`);
assert.equal(Lib.collPath(HID, 'events'), `households/${HID}/events`);
assert.equal(Lib.householdPath(HID), `households/${HID}`);
for (const kind of ['households', 'members', '', '__proto__', 'places', '../items', 'items/x', undefined]) assert.throws(() => Lib.docPath(HID, kind, 'x'), /refusing/, `kind ${kind}`);
for (const id of ['', 'a/b', '../x', 'a b', 'x'.repeat(101), undefined, 5]) assert.throws(() => Lib.docPath(HID, 'items', id), /refusing/, `id ${id}`);
for (const k of Lib.RESET_KINDS) assert.ok(Lib.KINDS_OK.includes(k));

// ---- REST: only under the test household, the household document read-only -------------------------------------------------------
const BASE = 'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents';
assert.equal(Lib.restTarget(BASE, HID, `households/${HID}`), `${BASE}/households/${HID}`);
assert.equal(Lib.restTarget(BASE, HID, `households/${HID}/items/a1`, 'DELETE'), `${BASE}/households/${HID}/items/a1`);
assert.equal(Lib.restTarget(BASE, HID, `households/${HID}/items`, 'GET'), `${BASE}/households/${HID}/items`);
const refuse = (path, method = 'GET', hid = HID) => assert.throws(() => Lib.restTarget(BASE, hid, path, method), /refusing/, `${method} ${path}`);
refuse(`households/${HID}`, 'DELETE');
refuse(`households/${HID}`, 'PATCH');
refuse('households/real-family-pantry/items/a1');
refuse('households/real-family-pantry');
refuse('households/robust-test-other/items/a1');
refuse('households');
refuse('');
refuse('users/x');
refuse(`households/${HID}/members/a1`);
refuse(`households/${HID}/items/a1/photos/b`);
refuse(`households/${HID}/items`, 'DELETE');
refuse(`households/${HID}/items/a1`, 'POST');
refuse(`households/${HID}/items/a/b`, 'GET');
refuse(`households/${HID}/items/a1`, 'GET', 'real-family-pantry');

// the REST client with a fake fetch: nothing goes out except guarded URLs
{
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization });
    if (init.method === 'GET' && /\/items\?/.test(url)) return { ok: true, status: 200, json: async () => ({ documents: [{ name: `projects/p/databases/(default)/documents/households/${HID}/items/a1`, fields: { x: { integerValue: '1' } } }] }) };
    if (init.method === 'GET') return { ok: true, status: 200, json: async () => ({ fields: { members: { arrayValue: { values: [{ stringValue: 'a@b.test' }] } } } }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const live = Lib.makeRest({ base: BASE, hid: HID, token: async () => 'tok-123456', fetchImpl: fakeFetch });
  assert.deepEqual((await live.household()).members, ['a@b.test']);
  assert.deepEqual(await live.list('items'), [{ _id: 'a1', x: 1 }]);
  await live.del('items', 'a1');
  await assert.rejects(live.del('households', 'x'), /refusing/);
  await assert.rejects(live.put('items', 'a1', {}), /only for the emulator/);
  await assert.rejects(live.putHousehold({}), /only for the emulator/);
  assert.ok(calls.every(c => c.url.startsWith(BASE + `/households/${HID}`)), 'every request is under the test household');
  assert.ok(calls.some(c => c.method === 'DELETE'));
  assert.ok(!calls.some(c => c.method === 'PATCH' || c.method === 'POST'), 'a live client never writes');
  assert.throws(() => Lib.makeRest({ base: BASE, hid: 'real-family-pantry', token: async () => 'x' }), /refusing/);
  const emu = Lib.makeRest({ base: BASE, hid: HID, token: async () => 'owner', fetchImpl: fakeFetch, patchAllowed: true });
  await emu.putHousehold({ name: 'n' });
  await emu.put('items', 'a1', { id: 'a1' });
  await assert.rejects(emu.put('items', '../x', {}), /refusing/);
}

// ---- the network allow-list --------------------------------------------------------------------------------------------------
const ok = (u, o) => assert.equal(Lib.hostAllowed(u, o), true, 'allowed: ' + u);
const no = (u, o) => assert.equal(Lib.hostAllowed(u, o), false, 'blocked: ' + u);
ok('http://localhost:3000/pantry/test/live-page.html');
ok('http://127.0.0.1:8085/v1/projects/demo-pantry/databases/(default)/documents');
ok('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
ok('https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?VER=8');
ok('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x');
ok('https://securetoken.googleapis.com/v1/token?key=x');
ok('https://proj-1.firebaseapp.com/__/auth/iframe', { project: 'proj-1' });
ok('https://pantry.flamingbeing.com/__/firebase/init.json');
ok('data:text/plain,hi');
no('https://evil.example.com/');
no('https://firestore.googleapis.com.evil.example.com/');
no('https://www.gstatic.com.evil.example.com/x.js');
no('http://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
no('https://pantry.flamingbeing.com/');
no('https://pantry.flamingbeing.com/pantry/');
no('https://other.firebaseapp.com/__/auth/iframe', { project: 'proj-1' });
no('https://proj-1.firebaseapp.com/', { project: 'proj-1' });
no('https://apis.google.com/js/api.js');
no('https://www.google.com/');
no('https://storage.googleapis.com/x');
no('ftp://localhost/x');
no('not a url');
ok('https://apis.google.com/js/api.js', { extra: ['apis.google.com'] });   // only when the person adds the host
assert.equal(Lib.isApiHost('https://firestore.googleapis.com/x'), true);
assert.equal(Lib.isApiHost('https://www.gstatic.com/x'), false);

// ---- the harness page only runs on localhost, and the app code was not touched to allow a test config ---------------------------
assert.equal(Lib.localHost('localhost'), true);
assert.equal(Lib.localHost('127.0.0.1'), true);
for (const h of ['pantry.flamingbeing.com', 'localhost.evil.com', 'evil.com', 'flamingbeing.com', '', undefined]) assert.equal(Lib.localHost(h), false, `host ${h}`);
const page = readFileSync(join(here, 'live-page.mjs'), 'utf8');
assert.match(page, /if \(!localHost\(location\.hostname\)\) throw/, 'the harness page refuses to run off localhost');
const cloud = readFileSync(join(here, '..', 'js', 'cloud.js'), 'utf8');
assert.ok(!/__PANTRY_TEST_CONFIG|live-test/.test(cloud), 'cloud.js has no hook for a test configuration: the harness swaps config.js from outside instead');

// ---- no raw document paths, no raw printing, outside the guarded helpers -----------------------------------------------------------
const main = readFileSync(join(here, 'live-multidevice.mjs'), 'utf8');
for (const [name, src] of [['live-multidevice.mjs', main], ['live-page.mjs', page]]) {
  assert.ok(!/['"`]households\//.test(src), `${name} builds no household path by hand (docPath/collPath only)`);
  assert.ok(!/deleteDoc\(|writeBatch\(|runTransaction\(/.test(src), `${name} deletes only through the guarded REST helper`);
}
assert.equal((main.match(/console\.(log|error|warn)/g) || []).length, 2, 'the harness prints only through out()/err(), which redact');
assert.ok(/redact\(JSON\.stringify\(report/.test(main), 'the report is redacted before it is written');
assert.ok(/ROBUST_CREDS/.test(main) && !/writeFileSync\([^)]*creds/.test(main), 'the creds are only read');

// ---- secrets never reach the output --------------------------------------------------------------------------------------------
{
  const creds = { project: 'proj-1', household: HID, apiKey: 'AIzaSyFAKEKEY0000000000000000000000000', users: { u1: { email: 'a@example.test', password: 'pw-secret-1' }, u2: { email: 'b@example.test', password: 'pw-secret-2' }, u3: { email: 'c@example.test', password: 'pw-secret-3' } } };
  Lib.validateCreds(creds);
  const red = Lib.makeRedactor(Lib.secretsOf(creds));
  const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJ1aWQiOiJ4In0.c2lnbmF0dXJl';
  for (const text of [`sign in with pw-secret-1 failed`, `url ?key=${creds.apiKey}&x=1`, `Authorization: Bearer ${jwt}`, JSON.stringify({ password: 'pw-secret-2', idToken: jwt }), `token ${jwt}`, `x pw-secret-3 y pw-secret-3`]) {
    const r = red(text);
    assert.ok(!/pw-secret|AIzaSy|eyJ/.test(r), `redacted: ${r}`);
  }
  assert.equal(red('plain text'), 'plain text');
  // creds validation
  const bad = patch => () => Lib.validateCreds({ ...creds, ...patch });
  assert.throws(bad({ household: 'real-family-pantry' }), /refusing/);
  assert.throws(bad({ household: undefined }), /refusing/);
  assert.throws(bad({ apiKey: '' }), /apiKey/);
  assert.throws(bad({ project: 'X' }), /project/);
  assert.throws(bad({ users: { u1: creds.users.u1 } }), /exactly 3/);
  assert.throws(bad({ users: { ...creds.users, u3: { email: 'c@example.test', password: 'x' } } }), /password/);

  // the harness itself refuses to start: no creds file, or a creds file whose household isn't a test one; and says nothing secret
  const dir = mkdtempSync(join(tmpdir(), 'live-guards-'));
  try {
    const run = env => spawnSync(process.execPath, [join(here, 'live-multidevice.mjs')], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 20000 });
    let r = run({});
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /ROBUST_CREDS/);
    const file = join(dir, 'creds.json');
    writeFileSync(file, JSON.stringify({ ...creds, household: 'real-family-pantry' }));
    r = run({ ROBUST_CREDS: file });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /robust-test-/);
    assert.ok(!/pw-secret|AIzaSyFAKE/.test(r.stderr + r.stdout), 'no secret in the refusal');
    writeFileSync(file, JSON.stringify({ ...creds, users: {} }));
    r = run({ ROBUST_CREDS: file });
    assert.notEqual(r.status, 0);
    assert.ok(!/pw-secret|AIzaSyFAKE/.test(r.stderr + r.stdout));
    r = run({ ROBUST_CREDS: file, FIRESTORE_EMULATOR_HOST: '' });   // --dry outside the emulators
    r = spawnSync(process.execPath, [join(here, 'live-multidevice.mjs'), '--dry'], { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 20000 });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /run-live-dry\.sh/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- the command line ---------------------------------------------------------------------------------------------------------
{
  const d = Lib.parseArgs([]);
  assert.deepEqual([d.engine, d.seeds, d.dry, d.reset, d.toggle, d.key], ['chromium', [11], false, false, 'safe', 'auto']);
  const o = Lib.parseArgs(['--engine', 'webkit', '--seeds', '11,2026,7', '--steps', '40', '--reset', '--only', '1,2,5', '--out', 'r.json', '--dry', '--toggle', 'raw', '--key', 'creds', '--allow-host', 'Apis.Google.com']);
  assert.deepEqual([o.engine, o.seeds, o.steps, o.reset, o.only, o.out, o.dry, o.toggle, o.key, o.allowHosts], ['webkit', [11, 2026, 7], 40, true, ['1', '2', '5'], 'r.json', true, 'raw', 'creds', ['apis.google.com']]);
  assert.throws(() => Lib.parseArgs(['--engine', 'netscape']), /--engine/);
  assert.throws(() => Lib.parseArgs(['--nope']), /unknown option/);
  assert.throws(() => Lib.parseArgs(['--seeds']), /needs a value/);
  assert.throws(() => Lib.parseArgs(['--key', 'x']), /--key/);
}

// ---- the small helpers ----------------------------------------------------------------------------------------------------------
{
  const doc = { a: 'x', n: 3, f: 1.5, t: true, z: null, l: [1, 'b'], m: { k: { qty: 2 } } };
  assert.deepEqual(Lib.unfields(Lib.fields(doc)), doc);
  assert.deepEqual(Lib.qtyMap({ batches: { a: { qty: 2 }, b: { qty: -1 } } }), { a: 2, b: -1 });
  assert.deepEqual(Lib.qtyMap({ batches: [{ id: 'a', qty: 2 }, { id: 'b', qty: 3 }] }), { a: 2, b: 3 });
  assert.deepEqual(Lib.qtyMap({}), {});
  assert.deepEqual(Lib.diffQty({ a: 1, b: 0 }, { a: 1 }), []);
  assert.deepEqual(Lib.diffQty({ a: 1 }, { a: 2, c: 1 }, 'x/'), ['x/a: 1, expected 2', 'x/c: 0, expected 1']);
  assert.equal(Lib.isRemovedDoc({ removedAt: '2026-10-16T00:00:00.000Z' }), true);
  assert.equal(Lib.isRemovedDoc({}), false);
  const r1 = Lib.rng(11), r2 = Lib.rng(11), r3 = Lib.rng(12);
  const a = [r1(), r1(), r1()], b = [r2(), r2(), r2()], c = [r3(), r3(), r3()];
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
}
console.log('pantry live-service harness guards: ok');
