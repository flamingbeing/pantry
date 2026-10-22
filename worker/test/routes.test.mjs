// worker/routes.js: which folder each address serves, and what it must never serve. Run: node --test 'worker/test/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve, SITES } from '../routes.js';

const H = 'pantry.flamingbeing.com';

test('Pantry serves its folder at the root', () => {
  assert.deepEqual(resolve(H, '/'), { file: 'pantry/' });
  assert.deepEqual(resolve(H, '/js/app.js'), { file: 'pantry/js/app.js' });
  assert.deepEqual(resolve('PANTRY.flamingbeing.com:443', '/'), { file: 'pantry/' });
  assert.deepEqual(resolve(H, '/pantry'), { redirect: '/pantry/' });
  assert.deepEqual(resolve(H, '/pantry/sw.js'), { file: 'pantry/sw.js' });
});

test('sign-in helper pages and init.json on its own address', () => {
  assert.deepEqual(resolve(H, '/__/auth/handler'), { file: '__/auth/handler' });
  assert.deepEqual(resolve(H, '/__/auth/iframe.js'), { file: '__/auth/iframe.js' });
  assert.deepEqual(resolve(H, '/__/firebase/init.json'), { file: 'pantry/auth/firebase/init.json' });
});

test('the design kit is not served here (it lives at design.flamingbeing.com/v1/)', () => {
  assert.deepEqual(resolve(H, '/homedesign/app.js'), { file: 'pantry/homedesign/app.js' });
  assert.ok(!fs.existsSync(new URL('../../pantry/homedesign', import.meta.url)));
});

test('unknown hosts serve nothing; localhost serves the repo', () => {
  assert.deepEqual(resolve('x.workers.dev', '/pantry/'), { notFound: true });
  assert.deepEqual(resolve('kakihome.flamingbeing.com', '/'), { notFound: true });
  assert.deepEqual(resolve('localhost:8787', '/pantry/'), { file: 'pantry/' });
});

test('nothing escapes its folder', () => {
  for (const p of ['/../wrangler.jsonc', '/%2e%2e/x', '/a%2fb', '/a\\b', '/./x', '/__/auth/../../wrangler.jsonc'])
    assert.deepEqual(resolve(H, p), { notFound: true }, p);
});

test('every folder in SITES exists', () => {
  for (const [host, s] of Object.entries(SITES))
    for (const f of [s.root, ...Object.values(s.prefixes || {})].filter(Boolean))
      assert.ok(fs.existsSync(new URL(`../../${f}`, import.meta.url)), `${host}: ${f}`);
});
