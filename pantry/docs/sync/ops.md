# Pantry sync safety: Changes as instructions (PR-A)

Dated design record, moved out of [../sync-safety.md](../sync-safety.md) (the index). Pantry notes: [../../NOTES.md](../../NOTES.md).

- **16 Oct 2026, sync safety, PR-A of three** (owner-approved plan: the sync-safety plan (private notes); goal: nothing a person saw as
  saved is lost or brought back by another phone, online or offline). The rule of the design: **never save a whole item
  from a stale copy; say what changed and let the server combine.** No transactions (they fail offline).
  - **Batches are a map.** `items/{id}.batches` is now `{ <batchId>: { qty, expiry, openedAt, addedAt, ... } }` (was an array).
    `normalizeItem()` in `js/logic.js` is the one door every item comes through (load, listen, restore, import, backup,
    demo, sample, the household merge): either shape in, an array of batches that each carry their `id` out, quantities
    clamped to 0 or more (so stock never shows below 0). An old array's own batch ids are kept when good and unique, else
    derived from the item id and position (`legacyBatchId`), so two phones that read the same old item agree. `toStored()`
    is the one door out. Backups keep arrays (readable by every version). **Old phones:** a phone on the old app writing a
    whole item puts the array back; readers cope and the next change converts it again. An old app version cannot *read*
    a map item (it expects an array), so it stops working until the service worker updates it (on the next open, or when
    the app goes to the background); the transition is a day or two for a family. **Arrays can be dropped** (the
    array branch of `normalizeBatches`, the rules' `list` branch) once every item has been saved by a new version and no
    phone has the old one: a month after PR-A is live is plenty; an optional one-time migration by the owner's
    session (read every item, write it in map shape) would close the window sooner.
  - **Changes are instructions** (`ops = { set: {path: value}, inc: {path: n}, del: [path] }`, dotted paths such as
    `location`, `batches.<id>.qty`, `batches.<id>`). `applyOps(item, ops)` (pure, `js/logic.js`) does them in memory; the
    cloud backend sends the same ops as one `updateDoc` (a field set, `increment()`, `deleteField()`); the on-phone and demo
    stores call `applyOps` too (`patch` in `store.js`), so all three behave alike. Use, Bin, Open, Bought more, put away,
    scan, Say or type, Freeze, Thaw, Plenty/Low/Out, moving a place's items and moving old photos are all ops. Two phones
    each using one unit make two `inc -1` and the server adds them, also offline. Opening one unit moves it to a batch
    whose id is the source's plus the day (`<id>-o20261016`), so two phones opening on one day add to the same one. **Undo
    is the inverse instructions** (`invertOps`): an `inc` is taken back by the opposite `inc` (what another phone did
    meanwhile stays); a field is put back only if it still holds what this change set, and the stamps are never put back.
    **Edit** saves only the fields changed against the copy the form opened with. New items and restores are whole-document
    writes (`save()`); so are deleting an item and undoing a delete (PR-B turns deletes into markers).
  - **Spent batches** stay in the item at quantity 0 (hidden) and are tidied only when an item has 40 batches: deleting one
    from a copy a moment out of date could remove a unit another phone had just given back with Undo (the randomised test
    found exactly that). The rules allow 60.
  - **Rules (stock).** `batches` may be the old array (at most 60) or the map (at most 60; every id 1 to 40 of `A-Za-z0-9_-`,
    one pattern over the ids joined by newlines); the first 12 batches of a map are also checked (`qty` a number from -99 to
    9999, `expiry` a string or empty). Only 12 because the rules engine allows 1000 expressions a request and about 16 such
    checks use them up (measured in the emulator: 60 batches pass with 12); the app clamps any quantity it reads. `qty`
    may be as low as -99 because two phones using the last unit both count (the screen shows 0). Anything else (a string,
    a number, a bad id, 61 batches) is refused.
  - **Rules (history).** `events` are write-once: create; delete (Undo, deleting an item, merging); and a rewrite identical to
    what is there (restoring a backup or re-running a merge writes the same line again). Nothing in the app edits an event
    (checked: `save('events')` only ever creates, Undo and delete use `remove`), so an update that changes anything is denied.
  - **Saved / Waiting / Needs attention.** The existing listeners now use `includeMetadataChanges`: `hasPendingWrites` per
    document and `fromCache` give the chip near the top of Home and in Settings → Saving to the family (cloud mode only): *Saved*,
    *Waiting for signal (N changes)* (unconfirmed for 1.5 s, or offline), *Needs attention*. History lines and photos aren't
    counted (each belongs to a change that is). No extra listener or read. A write the **server refuses** (`not-found` because
    another phone deleted the item, `permission-denied`, ...) is dropped by the SDK and the screen quietly goes back, so the
    app keeps a copy (`js/sync.js`, localStorage `pantry:refused`, newest 30, under 200 KB: the instructions, or a new
    item's document) and shows Needs attention with plain words and **Retry** (instructions are re-applied to the item as it
    now is; never brings a deleted item back) and **Discard**. Not captured: a write queued, the app closed, and refused by the
    server only after it is opened again (the SDK keeps the queue across a reload but the app has no promise to hear it).
  - **Known limits, honestly.** (1) `increment` is at-least-once: if the connection drops between the server applying a write
    and the phone hearing so, the phone sends it again and the unit counts twice (the randomised test drains before it
    drops a phone offline for that reason). (2) In the Firestore emulator (and possibly the live service) a write the server
    *refuses* makes the SDK resend the writes queued after it, applying their increments twice; so refusals must stay rare.
    That is why the rules do **not** refuse a stale old-array conversion (an earlier version did, with a token, and the
    test showed the doubled increments). (3) The one write built from a copy that may be stale is turning an old array into
    a map (the first change to an item still stored as an array): if another phone changes that same array item in the same
    moments, one change can be overwritten. It happens once per item and only while it is still an array. (4) Names and places
    were whole-document writes until PR-C; they are fields and one document each now (see the PR-C entry).
  - **Tests.** `test/ops.test.mjs` (both shapes, deterministic ids, clamping, `applyOps`, inverse, chip text, refused list);
    `sync.e2e.mjs` (two phones: both use one, offline use then reconnect, add vs use, Edit after another phone's use, offline
    rename, Undo after another phone changed it, an old array read and converted, a refused write kept with Retry and
    Discard, the rules for the map and the array, history write-once); `multidevice.e2e.mjs` (three phones, seeded random
    use/add/open/rename/Undo with phones going offline and back; every batch on the server must equal start + adds - uses,
    phones must show it, the history must match, nothing refused; `SEEDS=1,2 STEPS=60 node test/multidevice.e2e.mjs`
    inside `firebase emulators:exec`; two seeds run in CI, twelve were run by hand). The tests drive the app's own code
    through `window.__pantry.act` (emulator only).
