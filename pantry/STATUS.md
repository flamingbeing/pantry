# Pantry: status

Code facts: [NOTES.md](NOTES.md) and [docs/](docs/). The dated log and the owner's plans are in the owner's private notes.

## Now
- Live on its own subdomain. Working: family sharing, email and Google sign-in, places and names, sync safety, select
  mode, Group by place, grip drag, My order, Bulk edit, Sync now, the listener watchdog, expiry in words on every dated
  item (amber within 3 days, red once past).
- Freezer fixes (owner, 21 Oct 2026): Freeze 1 year (bread 1 month), Thaw 3 days, how many and which freezer, Not
  frozen, moving in or out of a freezer, place kinds. Detail: [docs/places-photos-names.md](docs/places-photos-names.md).
- Nothing blocks the build. iPhone touch is untested (only real touch events in Chromium).

## Next (in this order)
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
