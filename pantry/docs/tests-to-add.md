# Pantry: tests to add for fixed bugs

Bugs already fixed in the notes, and whether a test guards them. Index: [../NOTES.md](../NOTES.md). Remove a line once its
test lands.

| Fixed bug | Where it is written up | Guarded by a test? | Test to add |
|---|---|---|---|
| "Waiting for signal (1 change)" while the server held everything (`pending` counted `hasPendingWrites`) | [items-list.md](items-list.md) | Yes: `sync.e2e.mjs` (through `test/proxy.mjs`) | — |
| Dead shared connection after an offline spell (a phone stuck on an old value) | [sync/watchdog.md](sync/watchdog.md) | Yes: `sync.e2e.mjs` "the listener watchdog", `listen-watch.test.mjs` | — |
| `enableNetwork` while already enabled crashes Firestore 10.14.1 | [../NOTES.md](../NOTES.md), [items-list.md](items-list.md) | Yes (22 Oct 2026): `cloud.test.mjs` checks every `enableNetwork` in `js/` follows a `disableNetwork` in its block | — |
| Resuming on a deleted household errored the rules (`get()` on a missing household) | [items-list.md](items-list.md) | Yes (22 Oct 2026): `sync.e2e.mjs` also asserts no rules refusals are logged on the phone left behind. The app deliberately logs one `household permission-denied` warning from `watchHousehold` (how it notices and leaves), so that one line is allowed | — |
| `increment()` counted twice after a cut connection | [sync-safety.md](sync-safety.md) | Not fixed yet (PR-E in [../STATUS.md](../STATUS.md)) | Skipped 22 Oct 2026: needs the PR-E app change to be testable. With PR-E: resend the same op id twice in `ops.test.mjs` and through `test/proxy.mjs`; stock changes once |
| Freezer fixes (21 Oct 2026: 1 year frozen, 3 days thawed, Not frozen, moving in or out of a freezer) | [places-photos-names.md](places-photos-names.md) | Yes (22 Oct 2026): freeze, thaw and `moveFreezeOps` in `logic.test.mjs`, plus an Undo round trip (`invertOps`) in and out of a freezer | — |
