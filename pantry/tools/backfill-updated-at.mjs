#!/usr/bin/env node
// One-off: stamp `updatedAt` on every family-pantry document that has none (written before the app moved to app-sync,
// whose phones listen only for documents changed since they last synced). Run once, by the owner's go, after the
// app-sync version is live; until then the app reads in full while any document it holds has no stamp.
//
//   npm install --no-save firebase-admin
//   node pantry/tools/backfill-updated-at.mjs --project <project id>            # dry run (the default): counts only
//   node pantry/tools/backfill-updated-at.mjs --project <project id> --write    # stamps them, then counts again
//
// Credentials: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS, or gcloud auth application-default
// login). FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 runs it against the local emulator instead. Prints counts per kind, never
// a document's content. A document is stamped only if it is unchanged since it was read (a phone's save meanwhile
// carries its own stamp), with the time of the run as an ISO string (the app's form). Nothing is deleted.
const KINDS = ['items', 'events', 'shop', 'places', 'settings', 'photos'];
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const project = arg('--project') || process.env.GCLOUD_PROJECT, write = process.argv.includes('--write');
if (!project) { console.error('Usage: backfill-updated-at.mjs --project <project id> [--write]'); process.exit(2); }

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ projectId: project, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
const db = getFirestore();
const stamped = d => typeof d.updatedAt === 'string' && d.updatedAt.length > 0 && d.updatedAt.length <= 40;

async function count() {
  const out = {}, todo = [];
  for (const h of (await db.collection('households').get()).docs) {
    for (const kind of KINDS) {
      const c = out[kind] ||= { docs: 0, unstamped: 0 };
      for (const d of (await h.ref.collection(kind).get()).docs) {
        c.docs++;
        if (!stamped(d.data())) { c.unstamped++; todo.push(d); }
      }
    }
  }
  return { out, todo, households: (await db.collection('households').count().get()).data().count };
}
const show = (label, { out, households }) => {
  console.log(`${label}: ${households} households`);
  for (const k of KINDS) console.log(`  ${k.padEnd(9)} ${String(out[k]?.docs || 0).padStart(6)} docs, ${String(out[k]?.unstamped || 0).padStart(6)} without updatedAt`);
};

const before = await count();
show(write ? 'Before' : 'Dry run (nothing written)', before);
if (!write) process.exit(0);

const at = new Date().toISOString(), bw = db.bulkWriter();
let done = 0, skipped = 0;
bw.onWriteError(e => { if (e.code === 9 || e.code === 5) { skipped++; return false; } return e.failedAttempts < 3; });   // changed or gone since read: left alone
for (const d of before.todo) bw.update(d.ref, { updatedAt: at }, { lastUpdateTime: d.updateTime }).then(() => { done++; }, () => {});
await bw.close();
console.log(`Stamped ${done} (${at}); left alone ${skipped} (changed or deleted since read)`);
const after = await count();
show('After', after);
const left = KINDS.reduce((n, k) => n + (after.out[k]?.unstamped || 0), 0);
if (left) { console.error(`${left} documents still without updatedAt: run it again`); process.exit(1); }
