// Photo sizes (plain node): the thumbnail and photo sizes, and the step-down until a picture fits its limit.
// The canvas drawing itself is checked in the browser test (e2e.mjs), which also reports the real sizes.
import assert from 'node:assert/strict';
import { fitSize, steps, fit, THUMB, PHOTO } from '../js/photo.js';

// the longer side becomes max, never enlarged, never 0
assert.deepEqual(fitSize(4032, 3024, 96), { w: 96, h: 72 });
assert.deepEqual(fitSize(3024, 4032, 480), { w: 360, h: 480 });
assert.deepEqual(fitSize(60, 40, 96), { w: 60, h: 40 });
assert.deepEqual(fitSize(5000, 10, 96), { w: 96, h: 1 });

// the limits sit under the rules' caps (thumb 12 KB, photo 150 KB)
assert.ok(THUMB.max === 96 && THUMB.limit < 12 * 1024);
assert.ok(PHOTO.max === 480 && PHOTO.limit < 150 * 1024);

// steps: first the asked size and quality, then lower quality, then smaller; no repeats
const st = steps(THUMB);
assert.deepEqual(st[0], { max: 96, q: 0.6 });
assert.ok(st.every((s, i) => i === 0 || s.max < st[i - 1].max || s.q < st[i - 1].q), 'each step is smaller or lower quality');
assert.equal(new Set(st.map(s => s.max + '/' + s.q)).size, st.length);

// fit: the first try under the limit wins; if none fits, the smallest
const tried = [];
const enc = s => { tried.push(s); return 'x'.repeat(Math.round(s.max * s.q * 200)); };
const got = fit(enc, { max: 100, quality: 0.8, limit: 9000 });
assert.ok(got.length <= 9000);
assert.deepEqual(tried[0], { max: 100, q: 0.8 });
assert.ok(tried.length > 1, 'stepped down');
const small = fit(() => 'tiny', THUMB);
assert.equal(small, 'tiny');
const never = fit(s => 'x'.repeat(100000 + s.max), { max: 96, quality: 0.6, limit: 10 });
assert.equal(never.length, 100000 + 48, 'nothing fits: the smallest try');

console.log('pantry photo: ok');
