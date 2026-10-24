#!/usr/bin/env node
// One-off: stamp `serverAt` (the server's time) on every family-pantry document that has none, or has an older app
// version's plain copy of one (a map, not a timestamp). app-sync 0.3.0's phones will listen only for documents the server
// stamped since they last synced (`serverAt`), once the rules require the stamp: a document without one would never reach
// them. Run once, by the owner's go, after the app version that writes `serverAt` is live; until then nothing reads it.
//
//   npm install --no-save firebase-admin
//   node pantry/tools/backfill-server-at.mjs --project <project id>            # dry run (the default): counts only
//   node pantry/tools/backfill-server-at.mjs --project <project id> --write    # stamps them, then counts again
//
// Credentials: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS, or gcloud auth application-default
// login). FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 runs it against the local emulator instead. Prints counts per kind, never
// a document's content. A document is stamped only if it is unchanged since it was read (a phone's save meanwhile
// carries its own stamp), with the server's time of the write (serverTimestamp()); only `serverAt` changes (`updatedAt`
// stays as it is). Nothing is deleted.
const KINDS = ['items', 'events', 'shop', 'places', 'settings', 'photos'];
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const project = arg('--project') || process.env.GCLOUD_PROJECT, write = process.argv.includes('--write');
if (!project) { console.error('Usage: backfill-server-at.mjs --project <project id> [--write]'); process.exit(2); }

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: project, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
const db = getFirestore();
const stamped = d => d.serverAt instanceof Timestamp;

async function count() {
  const out = {}, todo = [];
  for (const h of (await db.collection('households').get()).docs) {
    for (const kind of KINDS) {
      const c = out[kind] ||= { docs: 0, missing: 0, copied: 0 };
      for (const d of (await h.ref.collection(kind).get()).docs) {
        c.docs++;
        const data = d.data();
        if (stamped(data)) continue;
        if ('serverAt' in data) c.copied++; else c.missing++;
        todo.push(d);
      }
    }
  }
  return { out, todo, households: (await db.collection('households').count().get()).data().count };
}
const show = (label, { out, households }) => {
  console.log(`${label}: ${households} households`);
  for (const k of KINDS) {
    const c = out[k] || { docs: 0, missing: 0, copied: 0 }, n = v => String(v).padStart(6);
    console.log(`  ${k.padEnd(9)} ${n(c.docs)} docs, ${n(c.missing)} without serverAt, ${n(c.copied)} with an old app's copy`);
  }
};

const before = await count();
show(write ? 'Before' : 'Dry run (nothing written)', before);
if (!write) process.exit(0);

const bw = db.bulkWriter();
let done = 0, skipped = 0;
bw.onWriteError(e => { if (e.code === 9 || e.code === 5) { skipped++; return false; } return e.failedAttempts < 3; });   // changed or gone since read: left alone
for (const d of before.todo) bw.update(d.ref, { serverAt: FieldValue.serverTimestamp() }, { lastUpdateTime: d.updateTime }).then(() => { done++; }, () => {});
await bw.close();
console.log(`Stamped ${done}; left alone ${skipped} (changed or deleted since read)`);
const after = await count();
show('After', after);
const left = KINDS.reduce((n, k) => n + (after.out[k]?.missing || 0) + (after.out[k]?.copied || 0), 0);
if (left) { console.error(`${left} documents still without a server stamp: run it again`); process.exit(1); }
