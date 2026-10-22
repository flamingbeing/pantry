# Pantry sync safety: Deletes and the shopping list (PR-B)

Dated design record, moved out of [../sync-safety.md](../sync-safety.md) (the index). Pantry notes: [../../NOTES.md](../../NOTES.md).

- **16 Oct 2026, deletes that can't bring things back, and the shopping list as fields (sync safety, PR-B of three;
  the sync-safety plan (private notes); owner: 30 days in Recently removed = yes).**
  - **A delete is a marker.** Deleting an item or a shopping line sets `removedAt` (ISO time) and `removedBy` (a name, cut to
    40 characters) as ops (`removeOps` in `js/logic.js`) and leaves the document, its history and its photo where they are.
    `isRemoved(x)` / `live(list)` is the one place that says what is hidden; `items()`, `shopLines()` and `liveEvents()` in
    `app.js` are the only doors every list, count, "Use soon", search, Buy again, Say or type, barcode lookup, Home card,
    "Since you last looked", badge, WhatsApp text, guide count and place count read through (`test/removed.test.mjs` fails if
    `app.js` reads `S.items`/`S.shop` in bulk anywhere else, or looks an item up by id without `itemById`). Removed things stay
    in `S.items`/`S.shop` so a change that lands on one is applied to it. The totals on Home leave out a removed item's history.
  - **A change that lands on a removed item never brings it back.** A use, an add, an edit, an Undo are field changes; none
    touches `removedAt`. The item shows in Settings → Recently removed (`#/removed`, a kit list: name, place, removed by (the
    name saved, or the family's name), days left of 30, **Restore**); Restore is `restoreOps` (`deleteField()` on both
    fields), so what landed meanwhile is in the item. When this phone's own change landed on something another phone removed
    (it changed the item at or after the removal, or still had it waiting to send: `touched` in localStorage, `hasPendingWrites`
    from the listener), Home shows a plain note ("Soy: this was removed on another phone; find it in Recently removed. Your
    change is kept.") until Recently removed is opened. Removed shopping lines are listed there too (Restore).
  - **Undo of a delete is Restore** (clear the marker), not re-creating from a snapshot, so Undo after another phone changed
    the item keeps their change. Undo of *adding* something (an item or a line made a moment ago) is also a marker, so the app
    never deletes a document for real except in the sweep and the household merge cleanup; the cost is that an item you
    added and undid sits in Recently removed for 30 days. History lines are still deleted by Undo (events are not removable
    things; the rules allow it).
  - **The sweep.** When the app opens (family pantry: 6 s after the first listener copy; this phone's own pantry: 4 s) and at
    most once a day per phone (`pantry:lastSweep`, `pantry:lastSweepLocal`), the phone deletes up to 20 items and shopping
    lines whose `removedAt` is more than 30 days old, oldest first (`sweepDue`), plus an item's photo and history. It uses the
    items it already holds: no extra listener, no full read. **Each delete is a small transaction** (`purge` in `cloud.js`):
    read the document, delete it only if it is still removed since before the cutoff. So a Restore on another phone a
    moment ago wins over a phone whose copy is old, a document another phone swept first is just skipped, and offline the
    transaction fails and the sweep tries another day (a phone also doesn't sweep from its own old copy: `fromCache`). The cost
    is one read and one write per document, at most 20 a day. A phone whose clock is far ahead could purge early (only things
    already removed, 20 a day); a clock far behind purges late.
  - **Shopping list lines.** A tick (`done`, `doneBy`), a rename and a removal are fields (`patchLine`, `applyFieldOps`;
    `patch('shop', ...)` on all three backends), Clear ticked is one batched update, Undo of a remove is a restore. Put away
    changes items by ops (as before) and removes its lines with markers; its Undo restores them. A new line is a whole
    document under a new random id (create-only in effect), so two phones adding "Milk" make two lines (tolerated; no
    de-duplication on screen). Line text is cut to 80 characters (the rules' limit).
  - **Rules.** Items: `removedAt` / `removedBy` are each absent or a string (`removedAt` ISO-shaped, at most 40 characters;
    `removedBy` at most 40), never null, a number or longer. Shopping lines (`/shop/{id}`, was unlimited): create or update only
    if the resulting line has exactly the fields `id` (= the document id), `name` (string, at most 80), `done` (boolean) and
    optionally `itemId` (null or a string up to 100), `at` (string up to 40), `by` and `doneBy` (strings up to 200), `removedAt`
    / `removedBy` as above; no other field. Whole-line writes (old phones) and field updates are both allowed. Deleting an item or
    a line for real stays allowed for members (the sweep, merging). Still true: members only, outsiders denied. A rules *compile*
    error shows in the emulator as `invalid-argument` on every request (found when `is boolean` was used instead of `is bool`).
  - **Backups, restore, copying, merging.** A backup carries the markers; a backup, a restore, "Copy from this phone" and
    the household merge leave out items and lines removed more than 30 days ago (with their history and photo): `keepLive` in
    `logic.js`, `carryOver` in `merge.js`. Demo mode has two removed items so Recently removed has something to show; the
    Settings "Add sample items" button leaves them out.
  - **Old phones (before PR-A) still do whole-document writes** of items and lines, which can put back an item another phone
    removed (a whole-item write has no `removedAt`). The app updates itself on the next open; no rules change can stop an old
    phone's whole write without also stopping new phones' new-item writes.
  - **Still whole-document writes** (and why): a new item or line (a new random id), restoring a backup, copying up from this
    phone and the household merge (deliberate bulk writes), a new place (a new random id), the migration of the old places list
    (PR-C). A refused whole write is replayed as it was (`replay`).
  - **Tests.** `test/removed.test.mjs` (markers, ops, inverse, days left, sweep selection by age and the 20 cap, backups and
    merging, the in-memory backend, every list uses the doors); `sync.e2e.mjs` (A deletes while B offline uses one; A edits while
    B deletes; both delete; Undo of a delete after the other phone changed it; tick vs remove both orders; two ticks; a new line
    while another is removed; Restore keeps the tick; the sweep deletes only the old ones, a second phone's sweep is harmless, a
    Restore elsewhere beats a stale copy; rules cases for the new fields and the shopping lines, outsiders); `multidevice.e2e.mjs`
    now also deletes, restores, ticks and removes lines at random (see its header for the invariants); `e2e.mjs` has the
    Recently removed screen.
