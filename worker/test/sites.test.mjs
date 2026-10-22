// worker/sites.js with a stand-in for the static assets. Run: node --test 'worker/test/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../sites.js';

const FILES = { '/pantry/index.html': '<h1>hi</h1>', '/pantry/sw.js': '//', '/__/auth/handler.html': 'handler' };
const env = { ASSETS: { fetch: async req => {
  const p = new URL(req.url).pathname;
  return p in FILES ? new Response(FILES[p], { status: 200 }) : new Response('', { status: 404 });
} } };
const get = (url, method = 'GET') => worker.fetch(new Request(url, { method }), env);
const H = 'https://pantry.flamingbeing.com';

test('serves the folder index, noindex', async () => {
  const r = await get(H + '/');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<h1>hi</h1>');
  assert.equal(r.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});

test('sw.js is always checked fresh', async () => {
  assert.equal((await get(H + '/sw.js')).headers.get('Cache-Control'), 'no-cache');
});

test('/__/auth/handler is handler.html', async () => {
  const r = await get(H + '/__/auth/handler?apiKey=x');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'handler');
});

test('folder without a slash redirects; missing files 404; unknown hosts 404', async () => {
  assert.equal((await get(H + '/pantry')).status, 301);
  assert.equal((await get(H + '/nope.js')).status, 404);
  assert.equal((await get('https://x.workers.dev/pantry/')).status, 404);
});

test('only GET and HEAD', async () => {
  assert.equal((await get(H + '/', 'POST')).status, 405);
});
