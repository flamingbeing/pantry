# Pantry sync safety: Names by field, places one record each (PR-C)

Dated design record, moved out of [../sync-safety.md](../sync-safety.md) (the index). Pantry notes: [../../NOTES.md](../../NOTES.md).

- **16 Oct 2026, names by field and places as one record each (sync safety, PR-C of three, the last; the sync-safety plan (private notes);
  owner: "places: one record each", names as dotted merge writes).** Goal: nothing a person saw as saved is lost by another phone,
  online or offline. What stays whole-document is listed under "The picture now" in [../sync-safety.md](../sync-safety.md).
  - **Names.** `settings/people` is unchanged in shape (`{ id, names: { email: name }, updatedAt }`, same rules), but saving or
    clearing ONE person's name is now one field: `people.js nameOps` makes a **keyed instruction** (`logic.js keyedOps`:
    `{ keyed: { names: { set: { 'a.b@x.com': 'Mum' }, del: [] } } }`; `applyFieldOps`/`applyOps`/`mergeOps`/`opsValid`/`opsEmpty` know
    it, so the on-phone, demo and cloud backends all do the same). `cloud.js updatePairs` turns it into the field path
    `['names', email]` and `updateArgs` sends every field as a `FieldPath` (never a dotted string: an email has dots) to
    `updateDoc` (or a batch update): set = the value, clear = `deleteField()`, plus `updatedAt`. A phone that doesn't have the
    document yet sends a `setDoc(..., { merge: true })` of the same fields plus `id: 'people'`. So two people naming themselves at
    once, or one naming while another stops sharing with someone, change different fields and keep both. **Stop sharing** clears
    that member's field by the same instruction (after the household update, as before). Saving a name still has no Undo (the
    Save toast has none). Names of people who left stay until someone clears them; they are only dropped in the same write when
    the 20 names the rules allow are full (`orphanNames`). The rules for `settings/people` did not change: they judge the
    document as it will be, so a dotted update passes exactly when the result is a whole valid document (tested: set, clear, the
    21st name, 41 characters, a newline, a number, a key that isn't an email, an unknown field, a deleted `names`).
  - **Places are documents.** `households/{hid}/places/{id}` = `{ id, name (1 to 40 characters, one line), order (a number),
    updatedAt }` and, as items, `removedAt` / `removedBy`. Nothing else. `places.js placeEntries(docs, legacy)` is the one way to
    read them (`placeList()` in `app.js`; `removed.test.mjs` fails if anything else reads `S.places` or the old list): the live
    documents sorted by order, then name, then id; two with the same name (any case) show once (the others' ids are kept, so
    removing the place removes them all). A household with NO place documents shows its old `settings/places` list, or the
    defaults, as *virtual* entries. Place documents sort ahead of the old list for good once any exist.
  - **Migration.** The first change anyone makes to places (add, rename, move, remove) first writes the places the household is
    showing as documents (`materializePlaces`, one batch, not waited for): ids from the name (`p-<slug>-<hash>`: the same name,
    the same id, on every phone), `order` 1, 2, 3, ... and the fixed `updatedAt` `1970-01-01T00:00:00.000Z` (`SEED_AT`). **The
    rules accept a write carrying that time only as a new document or as exactly what is already there**, so two phones migrating
    at once write the same documents, and a phone that was offline with the old list can't overwrite a place someone renamed,
    moved or removed since (every real change carries a real `updatedAt`; its whole seed batch is then refused and that phone's
    copy follows the server; the app swallows that refusal, nothing goes to "Needs attention"). Once migrated the app never
    writes `settings/places` again. **Old phones (before PR-C) still read and write `settings/places`** (the rules still allow
    it): their place edits after the migration do not show on new phones, and new phones' edits do not show on theirs (the app
    updates itself on the next open, so this lasts until each phone updates; nothing extra is shown).
  - **Changes.** Rename = one field (`name`) of one document, and the items kept there move by name with the existing item ops
    batch (`renamePlace`; Undo puts the name and those items back); an item added elsewhere under the old name keeps it and shows
    under "Not in your list" until moved (the existing tolerance). Move one step up or down = one field (`order`) of one
    document, set to the midpoint of its new neighbours (`places.js reorder`); only when there's no room between them (equal
    orders after two phones added at once, or a gap under 1e-6 after many moves) are the places whose order differs
    renumbered 1, 2, 3, ... (rare). Add = a new document under a random id after the last (two phones adding at once keep
    both; the same order is broken by name). Remove = `removedAt`/`removedBy` after the existing "where do the items go" step,
    Undo = Restore; a removed place is hidden everywhere (`placeList()`), listed in Settings → Recently removed → Places (Restore
    brings it back with any rename made since; refused with a toast if a live place has that name), and swept after 30 days by
    the same `purge` transaction. Remove vs rename on two phones: it stays hidden, the new name kept for Restore. The cap of
    40 live places is the app's (`placeProblem`); the rules cap the shape of each document and the id (`[A-Za-z0-9_-]{1,40}`)
    but **cannot count documents**, so another phone adding at the same moment could make 41 (harmless: the lists just get
    one longer).
  - **Rules (places).** `places/{id}`: members read, list and delete; create or update only if the resulting document has exactly
    `id` (= the document id, matching the id pattern), `name` (one line, 1 to 40 characters, one regex), `order` (a number, within
    plus or minus a million), `updatedAt` (a string up to 40), and optionally `removedAt` / `removedBy` under the items'
    constraints; no other field; an update whose `updatedAt` is `SEED_AT` must leave the document exactly as it is. An update
    of a place that isn't there is refused (`permission-denied`, not `not-found`: nothing to build the result from).
    Outsiders: denied everything. Under the 1000-expression limit (about 20 expressions). `settings/places` is unchanged.
  - **Everything that touched places now goes through the new helpers:** Settings → Places, Quick add's Where and the Add/Edit
    forms (`placeNames`, `placeChoices`), Say or type matching (the names), the household merge (`copyHousehold`: the other
    pantry's place documents merged by name into the kept pantry's, its old list too, removed over 30 days dropped, `merge-count`
    checked), backups (`places` in the file; a file from before has the old list in `settings`, read and merged by name) and
    restore, "Copy from this phone", the demo (its places are documents, one of them removed so Recently removed has a place to
    show), the guide. `KINDS` gained `places` (so `load`, the listeners, the on-phone IndexedDB and the in-memory backend all
    carry it; the IndexedDB keys are `places/<id>` in the same object store, so no version bump). One more listener per
    household (the places collection).
  - **Tests.** `places.test.mjs` (normalizing with the old list, none, documents, removed, malformed, same name twice; ids; the
    migration documents; the midpoint and renumbering; merging by name), `people.test.mjs` (one name as a keyed instruction,
    emails with dots, two phones in either order, a removed member), `cloud.test.mjs` (every field a `FieldPath`),
    `merge.test.mjs`, `removed.test.mjs` (places swept, the in-memory backend, the one-door guard); `sync.e2e.mjs` (both name
    themselves at once, online and with one phone offline; a dotted email; Mum names Gran while Dad, offline, stops sharing with
    her; both add a place; a rename and a reorder of one place; a remove and a rename, both orders; a rename while the other
    phone, offline, adds an item under the old name, then moving it out of "Not in your list"; two phones migrating from the old
    list, one offline and behind, and two online; an old phone's write of `settings/places` accepted and ignored; the rules for
    places and for names by field, outsiders included); `multidevice.e2e.mjs` (see its header: names, add, rename, move, remove,
    restore, the default places once, every phone showing the server's list).
  - **Still whole-document, on purpose:** see "What stays whole-document, and why" in [../sync-safety.md](../sync-safety.md).
