// tools/stamp-versions.mjs: only an exact-version core.anawj.com address is 'pinned' in the MANIFEST; every other
// cross-site SHELL entry (the design kit's /v1/, any other host with a number in its path) gets a hash that changes with
// each deploy, so a changed file under a moving address reaches the phones. Runs a copy of the tool on a made-up app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tool = fs.readFileSync(new URL('../../tools/stamp-versions.mjs', import.meta.url), 'utf8');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
fs.mkdirSync(path.join(root, 'tools')); fs.mkdirSync(path.join(root, 'demo'));
fs.writeFileSync(path.join(root, 'tools/stamp-versions.mjs'), tool);
fs.writeFileSync(path.join(root, 'demo/index.html'), '<p>hi</p>');
fs.writeFileSync(path.join(root, 'demo/sw.js'), `const VERSION = 'demo-v1';
const MANIFEST = {};
const SHELL = [
  './',
  'https://core.anawj.com/sync/0.4.0/index.js',
  'https://core.anawj.com/update/0.2.0/register.js',
  'https://core.anawj.com/sync/v1/index.js',
  'https://design.flamingbeing.com/v1/app.css',
  'https://cdn.example.com/lib/1.2.3/lib.js',
];
`);
const run = () => { execFileSync(process.execPath, [path.join(root, 'tools/stamp-versions.mjs')], { cwd: root, stdio: 'pipe' }); return fs.readFileSync(path.join(root, 'demo/sw.js'), 'utf8'); };
const manifest = src => JSON.parse(src.match(/^const MANIFEST = (.*);$/m)[1]);
const m = manifest(run());
assert.equal(m['https://core.anawj.com/sync/0.4.0/index.js'], 'pinned');
assert.equal(m['https://core.anawj.com/update/0.2.0/register.js'], 'pinned');
assert.match(m['https://core.anawj.com/sync/v1/index.js'], /^deploy-/, 'a moving core address is not pinned');
assert.match(m['https://design.flamingbeing.com/v1/app.css'], /^deploy-/);
assert.match(m['https://cdn.example.com/lib/1.2.3/lib.js'], /^deploy-/, 'a version number in another host’s path is not a pin');
assert.match(m['./'], /^[0-9a-f]{12}$/);
fs.rmSync(root, { recursive: true, force: true });
console.log('stamp-versions: ok');
