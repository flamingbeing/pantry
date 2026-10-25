# Pantry: notes

Code facts, conventions and how to test. Now and next: [STATUS.md](STATUS.md). Setup steps: [SETUP.md](SETUP.md).
Detail by topic is in [docs/](docs/); the owner's plans, the dated log and real-service results are in the owner's private notes.

## Where the detail is

| Topic | File |
|---|---|
| Stock as batches, photos, shops, barcode look-ups, the look, undo, demo mode, lessons from Kaki Home | [docs/design.md](docs/design.md) |
| Welcome, guide screen, hints, hands-on first steps | [docs/onboarding.md](docs/onboarding.md) |
| Hosting, sign-in on the app's own address, config, service worker, rules deploys, which pantry opens, email sign-in, merging pantries | [docs/sign-in-and-hosting.md](docs/sign-in-and-hosting.md) |
| Thumbnails and photos, editable places, names, guessed best-before dates and the other research items | [docs/places-photos-names.md](docs/places-photos-names.md) |
| Sync safety: instructions not copies, removal markers, one record per place, the listener watchdog, limits that remain | [docs/sync-safety.md](docs/sync-safety.md) |
| The Items list: select mode, grip drag, My order, Bulk edit, Sync now | [docs/items-list.md](docs/items-list.md) |
| Fixed bugs that still want a test | [docs/tests-to-add.md](docs/tests-to-add.md) |

## Rules that bite

- Plain HTML and JS modules, no build step. Data is on the phone (IndexedDB) until family sharing is set up; then in
  Firestore: `households/{hid}` with `members` (lower-case emails) and `items`, `events`, `shop`, `places`, `settings`
  under it. Rules: only members read or write; the person who started a pantry stays its owner. Real household data never
  goes in this public repo.
- Stock is batches (qty, best-before, opened date); taking out is first expiring first. Photos are small JPEG data URLs in
  Firestore: a thumbnail on the item and the photo in its own document, read only when the item opens.
- Every stock change is sent as instructions (`ops`: set, inc, del on dotted paths), never a copy of the whole item; Undo is
  the inverse. Deleting is a `removedAt` marker that every list skips. Names are one field each, places one document each.
  History is write-once. See [docs/sync-safety.md](docs/sync-safety.md) before touching `cloud.js` or `logic.js`.
- Undo over confirm. A family member's change never wipes what someone is typing: while a form or sheet is open, changes
  wait and are drawn afterwards.
- Every screen and sheet is a history entry (swipe-back works). The app uses `https://design.flamingbeing.com/v1/` (`tokens.css`, `app.css`,
  `app.js`) with the `pa-` prefix for its own CSS; no emoji; light only.
- `?demo` shows made-up items in memory, with no Firebase and nothing saved (this makes PR previews useful).
- Sign-in happens on the app's own address (`authDomain`), with Firebase's helper pages in `__/auth/` and `auth/firebase/`.
  Never add `*.workers.dev` previews to Firebase or the OAuth client.
- `config.js` stays `null` (on-phone only) until `node pantry/tools/set-config.mjs '<config>'` writes it.
- `sw.js` has `VERSION = 'pantry-v1'`, stamped only at deploy (`tools/stamp-versions.mjs`); never stamp by hand. A new
  version never takes over while someone is typing; delete only `pantry-` caches.
- Rules deploy on merge (`.github/workflows/deploy-firestore-rules.yml`); run the rules tests first and never loosen a
  rule to make a test pass.
- The Firebase SDK loads once (one shared promise, reset on failure). Signing out waits up to 4 seconds for unsent changes.
- `enableNetwork` while the network is already enabled crashes Firestore 10.14.1 in the tests: call it only after `disableNetwork`.

## How to test

```
node pantry/test/logic.test.mjs        # logic, catalogue, backups (plain node; also in the repo Checks)
node pantry/test/quick.test.mjs        # Say or type: dates, places, quantities, matching
node pantry/test/tour.test.mjs         # first steps: quick-start list, checklist ticks
node pantry/test/places.test.mjs       # places: defaults, one document each (normalizing, ids, midpoint order, merging by name), used-but-unlisted, Say or type matching
node pantry/test/people.test.mjs       # names for the family: cleaning, one name as a keyed instruction, labels
node pantry/test/cloud.test.mjs        # how a change becomes Firestore field updates (FieldPath, increment, deleteField) with a stand-in SDK
node pantry/test/merge.test.mjs        # merging duplicate pantries: members, who may, settings
node pantry/test/scan.test.mjs         # the barcode look-up chain with a stubbed fetch (plain node)
node pantry/test/photo.test.mjs        # thumbnail and photo sizes, stepping down to fit the limits (plain node)
node pantry/test/ops.test.mjs          # both shapes of batches, changes as instructions and their inverse, the chip text (plain node)
node pantry/test/listen-watch.test.mjs # the chip's use of freshness, the watchdog's stale and storage at risk (plain node)
node pantry/test/bulk-items.test.mjs   # Bulk edit's rules: each choice as ops, skips, warnings, Undo round trips (plain node)
node pantry/test/order.test.mjs        # My order: midpoints, append, prepend, collisions, renumbering, tie-breaks, 200 random sequences (plain node)
node pantry/test/select.test.mjs       # selecting: the selection state and the press and hold with a fake pointer (plain node)
node pantry/test/syncnow.test.mjs      # Sync now: each waiting change in words, last heard, what it says (plain node)
node pantry/test/removed.test.mjs      # removed markers, Restore, days left, the sweep's choice, backups and merging, every list skips removed (plain node)
node pantry/test/live-guards.test.mjs  # the live-service harness's safety guards (plain node; the harness itself: pantry/test/LIVE-TEST.md)
node pantry/test/config.test.mjs       # set-config, sign-in choice, plain-word errors, sw.js rules
pantry/test/run-sync.sh                # the rest of the old family-sharing story (sync.e2e.mjs: stock rules, removing, merging, the chip, no signal) in the local emulators
npm ci && npx playwright test          # Playwright Test specs in pantry/test/specs (the phone app: app-*.spec.mjs, split by screen or feature; the Items list with real touch: items.spec.mjs;
                                       # with axe; signing in by email: signin.spec.mjs; family sharing, rules, photos, places and names: sync-*.spec.mjs;
                                       # the randomised three-phone run: multidevice.spec.mjs, SEED=<n> re-runs a seed): fully parallel, 4 workers, own server,
                                       # accounts and ids per test; starts the emulators itself. One file: npx playwright test app-places;
                                       # the env var PW_NO_EMULATOR (set to 1) skips the emulators (the app-* specs don't need them); the env var SHOTS (a folder) saves screenshots
node tools/check.mjs && node tools/stamp-versions.mjs --check
```

Known emulator flake (about 1 test in 200 under 4 workers): the Firestore emulator (v1.19.8, firebase-tools 13.29.1) sometimes
writes one WebChannel message twice in the same response. The SDK (10.14.1) doesn't drop the repeat, takes a second write-stream
handshake for a write result with no commitTime and stops with "INTERNAL ASSERTION FAILED: Unexpected state". Each denied write
opens a new write stream, so the rules probes hit it most. The live service is not affected. CI retries a failed test once
(`retries` in `playwright.config.mjs`); a newer emulator (v1.22.0, firebase-tools 15.32.1) is the untested proper fix.

The older script (`run-sync.sh`) need Playwright (`PLAYWRIGHT_PATH`) and axe-core (`AXE_PATH`, or `npm install --no-save axe-core`);
`run-sync.sh` and the specs need Java 21 and fetches `firebase-tools` with npx. The "Pantry checks" workflow runs all of them on PRs (three parallel jobs: browser (the plain-node tests), specs, sync)
touching `pantry/` or `__/`; they load the design kit from its live address. Never point a test at the live Firebase project, with one exception: the
live-service harness (`pantry/test/live-multidevice.mjs`, see `pantry/test/LIVE-TEST.md`), which the owner arranges separately
and sessions run only with `--dry` (`pantry/test/run-live-dry.sh`, local emulators).


## Sync engine: app-sync (24 Oct 2026)

Saves and listeners go through app-sync `0.4.1` (`https://core.anawj.com/sync/0.4.1/`, exact pin, precached by `sw.js`):
every save goes to an outbox on the phone (IndexedDB) and then to the server in a transaction, one document at a time;
each kind keeps a copy on the phone and listens only for documents changed since the last sync (`updatedAt`, stamped by
the adapter as the save reaches the server: its default stamp, the later of now and the server copy's stamp plus one,
taken inside the commit, so the app has no stamp function of its own). Every kind is merged on the server's copy (`cloud.js mergeSaves`): a whole
document replaces it (as setDoc did), a change as instructions is applied to it (as updateDoc did), and `_saves` keeps the
last 20 save keys so a resent save counts once. The rules require a stamp on every write and a new one on every change;
app versions from before refuse to update until the phone updates (their change is kept: Settings, Retry). Until the
one-off backfill (`pantry/tools/backfill-updated-at.mjs`, dry run by default) has stamped old documents, the engine reads
in full while any document has no stamp (`unstamped: 'full'`); drop that option once it has run. The SDK's network
switch doesn't stop a transaction: tests go offline with the browser context as well (`test/specs/sync-lib.mjs net`).

What 0.4.0 added, as the app uses it (25 Oct 2026): `aborted` (two phones on one document) is retried by the write queue, not
by the app; the chip follows `syncStatus({ confirmed, atRiskOnlyOffline: true })` (`cloud.status`, `sync.js syncState`): never
"Saved" before the server has answered once ("Not checked with the family yet"), and "Only on this phone" only while
offline; sign-out is `forgetDevice` (stop listening, re-check it is still the same person, wipe the copies, the outbox and
the SDK's cache, then reload; no reload in the emulator). Not used yet: `otherPending` for photo writes outside the queue,
`onCommit`, `unsent` / `onLeave`.

Server stamps (app-sync `0.3.0`, 24 Oct 2026): the adapter runs `stampMode: 'server'`, so every save also writes
`serverAt` = the server's time (`serverTimestamp()`), beside `updatedAt`; `writeAll` (backup restore, merging pantries)
sets it too and drops any copied one. The hub still reads by `updatedAt` (client mode). `serverAt` is the engine's, like
`_saves`: `strip` keeps it out of the app's records. The rules allow it (a timestamp must be `request.time`) and still
take older versions' saves: none, or their JSON copy of one (a map). Next, in order: backfill
(`pantry/tools/backfill-server-at.mjs`, dry run by default; stamps documents with none or with a copy), then once no
older version is left a second rules change requires `serverAt == request.time`, then the hub gets `stampMode: 'server'`
(no clock in the delta read). Tests: `test/specs/sync-stamps.spec.mjs`.
