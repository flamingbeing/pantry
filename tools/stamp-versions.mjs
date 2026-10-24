// Gives each app's service worker a VERSION that changes whenever its files do, at deploy time only (the deploy
// build runs it; never committed), so PRs don't touch sw.js for a version bump and two sessions on one app don't
// collide on that line.
// 'example-v1' becomes 'example-2026-10-14-3f9a2c1d': the day (Singapore time) of the last commit that touched a file
// the hash covers, then a hash of every file the app can serve: its whole folder (the service worker serves any
// same-origin file cache-first and keeps it until VERSION changes, so SHELL alone isn't enough) plus SHELL files
// outside it. Tests, tools and notes are left out. Without git history the date is today's.
// It also writes MANIFEST (app-update: a new version fetches only the SHELL files whose hash changed): per SHELL entry
// a hash of the file ('./' is index.html), 'pinned' for an exact-version address on another host (…/0.2.0/…), and
// 'deploy-<hash>' for any other address there (the kit's /v1/: fetched fresh by every deploy).
// Run: node tools/stamp-versions.mjs [--check]   (--check prints the versions without writing, and fails when a
// SHELL file is missing: the phones would never install that version)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = !process.argv.includes('--check');
const RE = /const VERSION = '([^']+)'/;
const MRE = /^const MANIFEST = .*;$/m;
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const lastChanged = files => {
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' });
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cd', '--date=format-local:%Y-%m-%d', '--', ...files.map(f => path.relative(ROOT, f))],
      { cwd: ROOT, env: { ...process.env, TZ: 'Asia/Singapore' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : today();
  } catch { return today(); }
};
const SKIP = /(^|\/)(test|tools|node_modules|\.[^/]+)(\/|$)|\.md$/;
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
  const f = path.join(dir, d.name);
  if (SKIP.test(path.relative(ROOT, f))) return [];
  return d.isDirectory() ? walk(f) : [f];
});

for (const app of fs.readdirSync(ROOT).filter(d => fs.existsSync(path.join(ROOT, d, 'sw.js')))) {
  const swPath = path.join(ROOT, app, 'sw.js');
  const sw = fs.readFileSync(swPath, 'utf8').replace(MRE, 'const MANIFEST = {};');   // a stamped MANIFEST hashes as the plain one
  const m = sw.match(RE);
  if (!m) { console.error(`stamp: ${app}/sw.js has no VERSION`); process.exitCode = 1; continue; }
  const base = m[1].replace(/-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/, '').replace(/-[0-9a-f]{8}$/, '');   // already stamped: stamp again from the base
  const shellSrc = sw.match(/const SHELL = \[([\s\S]*?)\];/)?.[1] || '';
  const entries = [...shellSrc.matchAll(/'([^']+)'/g)].map(x => x[1]);
  const shell = entries.filter(f => f !== './' && !/^https?:/.test(f)).map(f => path.join(ROOT, app, f));
  const missing = [...entries.filter(f => !/^https?:/.test(f)).map(f => (f === './' ? 'index.html' : f.split(/[?#]/)[0]))].filter(f => !fs.existsSync(path.join(ROOT, app, f)));
  if (missing.length) { console.error(`stamp: ${app}/sw.js SHELL lists files that don't exist: ${missing.join(', ')}`); process.exitCode = 1; continue; }
  const files = [...new Set([...walk(path.join(ROOT, app)).filter(f => f !== swPath), ...shell])].sort();
  const hash = crypto.createHash('sha256');
  hash.update(sw.replace(RE, `const VERSION = '${base}'`));
  for (const f of files) { hash.update('\0' + path.relative(ROOT, f) + '\0'); if (fs.existsSync(f)) hash.update(fs.readFileSync(f)); }
  const h8 = hash.digest('hex').slice(0, 8);
  const version = `${base.replace(/-v\d+$/, '')}-${lastChanged(files)}-${h8}`;
  const manifest = Object.fromEntries(entries.map(u => [u, /^https?:/.test(u) ? (/\/\d+\.\d+\.\d+\//.test(u) ? 'pinned' : 'deploy-' + h8)
    : sha(fs.readFileSync(path.join(ROOT, app, u === './' ? 'index.html' : u.split(/[?#]/)[0]))).slice(0, 12)]));
  let out = sw.replace(RE, `const VERSION = '${version}'`);
  if (MRE.test(out)) out = out.replace(MRE, () => `const MANIFEST = ${JSON.stringify(manifest)};`);
  if (write) fs.writeFileSync(swPath, out);
  console.log(`${app}: ${version}`);
}
