# Pantry: status

Code facts: [NOTES.md](NOTES.md) and [docs/](docs/). The dated log and the owner's plans are in the owner's private notes.

## Now
- Live on its own subdomain. Working: family sharing, email and Google sign-in, places and names, sync safety, select
  mode, Group by place, grip drag, My order, Bulk edit, Sync now, the listener watchdog, expiry in words on every dated
  item (amber within 3 days, red once past).
- Freezer fixes (owner, 21 Oct 2026): Freeze 1 year (bread 1 month), Thaw 3 days, how many and which freezer, Not
  frozen, moving in or out of a freezer, place kinds. Detail: [docs/places-photos-names.md](docs/places-photos-names.md).
- Install (23 Oct 2026): manifest `id` set to the id Chrome already computes (`./`, so installs carry on), maskable
  icon and a 32 px PNG favicon from the shared app icon set (Home family; same design as before).
- Browser tests (23 Oct 2026): all old scripts are now Playwright Test specs in `pantry/test/specs` (app-*, items, sync-*,
  multidevice, signin; PRs #5-#8 and #6). Specs block the service worker unless a test is about it (`sw: true`). CI retries
  a failed test once for a Firestore emulator flake (pantry/NOTES.md, "How to test").
- Server stamps (24 Oct 2026): app-sync `0.3.0`, every save also writes `serverAt` (the server's time); rules allow it.
  Next: the backfill (`tools/backfill-server-at.mjs`, owner's go), then rules require it, then the hub reads by it
  (NOTES.md, "Sync engine").
- Nothing blocks the build. iPhone touch is untested (only real touch events in Chromium).

## Next (in this order)
0. **Finish the move to Playwright Test:** `sync.e2e.mjs` still holds the second half of the old chained story (stock changes
   as instructions and their rules, the Items list racing another phone, removing without losing, merging two pantries,
   the chip / Sync now / listener watchdog with `stallProxy`, a pantry that goes away, no signal). Split it into
   `specs/sync-*.spec.mjs` (own family per test, `fsAdmin` to seed), then delete it, `run-sync.sh` and the "sync" job in
   `pantry-checks.yml`. The first half and the randomised run are done (`sync-*.spec.mjs`, `multidevice.spec.mjs`).
1. **Safe counting (PR-E):** each use or add is its own entry keyed by a unique op id (`batches.<id>.d.<opId>`); stock
   is the base quantity plus the entries, so a resend changes nothing. Fold old entries into the base (online, per item);
   rules caps (at most 40 entries per batch, op id pattern, number range); `normalizeItem` reads `qty` plus the entries.
   Replaces `increment()`, which can apply twice after a cut connection.
2. **Harness v2 and a full live-service run** (smaller default; see `test/`).
3. **The Items tab (PR-F), after PR-E:** pinned-places bar under search (`pinned` on place records); compact rows with a
   stepper and a menu; drop My order (dragging only moves to a place); sync status as one top-bar icon on every screen.
4. **Product memory** (owner, 21 Oct 2026): barcode to name, details and photo for the household, kept after a delete;
   scans check it before the online look-up.
- Ideas: expiry reminders (push, Worker cron), prices, receipt photo, more catalogue lines, recipe links.
- Tests worth adding for bugs already fixed: [docs/tests-to-add.md](docs/tests-to-add.md).
