// Writes the family pantry's Firebase web config (SETUP.md step 6). Run it with what Firebase shows under
// Project settings > Your apps > Web app (the firebaseConfig object, as JSON or as the JavaScript snippet):
//   node pantry/tools/set-config.mjs '{ "apiKey": "…", "projectId": "…", "appId": "…", … }'
//   node pantry/tools/set-config.mjs config.txt          (a file holding the same)
// It writes pantry/config.js (read by the app) and pantry/auth/firebase/init.json (served at /__/firebase/init.json
// for Firebase's sign-in helper pages), with authDomain set to the app's own address, pantry.flamingbeing.com, so
// sign-in never leaves it. These are public client IDs, not secrets.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'pantry.flamingbeing.com';
const KEYS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];

export function parseConfig(text) {
  let t = String(text).trim();
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No { … } config found.');
  t = m[0]
    .replace(/\/\/[^\n]*/g, '')                          // comments in the snippet
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')   // unquoted keys
    .replace(/'([^']*)'/g, '"$1"')                      // single quotes
    .replace(/,\s*}/g, '}');                            // trailing comma
  let cfg;
  try { cfg = JSON.parse(t); } catch { throw new Error('Could not read the config. Paste the firebaseConfig object as Firebase shows it.'); }
  for (const k of ['apiKey', 'projectId', 'appId']) if (typeof cfg[k] !== 'string' || !cfg[k]) throw new Error(`The config has no ${k}.`);
  const out = {};
  for (const k of KEYS) if (typeof cfg[k] === 'string' && cfg[k]) out[k] = cfg[k];
  out.authDomain = HOST;
  return out;
}

export function files(cfg) {
  return {
    'config.js': `// Firebase web config for the family pantry, written by tools/set-config.mjs (SETUP.md step 6). Don't edit by hand.
// authDomain is the app's own address, so sign-in stays on it. A public client ID, not a secret: the Firestore rules
// decide who sees what.
export const firebaseConfig = ${JSON.stringify(cfg, null, 2)};
`,
    'auth/firebase/init.json': JSON.stringify(cfg, null, 2) + '\n',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) { console.error("Usage: node pantry/tools/set-config.mjs '<firebaseConfig JSON>'  (or a file holding it)"); process.exit(1); }
  const text = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg;
  try {
    const cfg = parseConfig(text);
    for (const [rel, body] of Object.entries(files(cfg))) {
      const f = path.join(APP, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
      console.log('wrote', path.relative(process.cwd(), f));
    }
    console.log(`project ${cfg.projectId}, authDomain ${cfg.authDomain}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
