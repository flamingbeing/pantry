# Pantry: sync safety

Instructions not copies, removal markers, one record per name and place, the listener watchdog, and what is left. Index: [../NOTES.md](../NOTES.md).

Read this page first; the dated design record of each step is in its own file:

| Step | What it covers | File |
|---|---|---|
| Changes as instructions (PR-A) | Batches as a map, `normalizeItem`/`toStored`, ops and `applyOps`, Undo as inverse ops, Edit saves only changed fields. | [sync/ops.md](sync/ops.md) |
| Deletes and the shopping list (PR-B) | `removedAt` markers that never bring things back, Restore, the sweep, the shopping list as fields. | [sync/deletes.md](sync/deletes.md) |
| Names by field, places one record each (PR-C) | `names.<email>` fields, `places/{id}` documents with midpoint order, migrating from the old list, the rules. | [sync/names-places.md](sync/names-places.md) |
| The listener watchdog | Dead shared connection after an offline spell, `js/listen-watch.js`, listener replacement and network restart, the chip's freshness. | [sync/watchdog.md](sync/watchdog.md) |

## The picture now and the limits that remain


| Thing | How it is written | Two phones at once |
|---|---|---|
| Stock (use, open, add, freeze, level) | `increment()` and field sets on `batches.<id>.*` | both counted |
| Item fields (place, notes, edit) | only the changed fields | each field its own; the same field: last write |
| Delete / Undo of add | `removedAt` marker; Restore clears it | never brought back; changes land on the hidden item |
| Shopping line (tick, rename, remove) | fields | tick and remove both kept |
| Names | one field per person | both kept |
| Places | one document each; fields | both kept; remove beats rename (Restore shows the rename) |
| History (events) | write-once | nothing edits one |

#### What stays whole-document, and why

- A **new** item, shopping line or place: a new random id, so there is nothing to overwrite (two phones adding "Milk" make two).
- **Restoring a backup, "Copy from this phone", merging two pantries**: deliberate bulk writes the person asked for (the merge
  counts what arrived before it deletes anything; places are merged by name, not overwritten).
- An **old-style array item**: converted once, by one write built from this phone's copy (PR-A).
- **Item name/notes/category edited on two phones at once, the same shopping line's text, the household name**: last write per
  field, on purpose (rare, harmless).
- `settings/places` (the old single list): still allowed by the rules for phones older than PR-C; new phones ignore it once a
  household has place documents.

#### Known limits that remain

- `increment()` is at-least-once: a connection lost in the instant between the server applying a write and the phone hearing so
  can count a unit twice.
- A write the server *refuses* makes the SDK resend the writes queued after it (their increments twice), so refusals must stay rare.
- The 40-place cap is the app's: the rules can't count documents, so two phones adding the 40th place at the same moment can make 41.
- Two places added at the same moment with the same name show once (the other is hidden until the first is removed); removing a
  place removes both.
- A phone that is offline for a long time and then sends a change for a document the sweep purged is refused ("Needs attention").
- Phones older than PR-C still write `settings/places` and whole items; their place edits after the migration are not seen by new
  phones (and vice versa) until they update.
- Names of people who left stay in `settings/people` until cleared (dropped only to make room under the 20-name rule).


## Engine lessons from the real service

- A rule that reads the household with `get()` ERRORS (it does not deny) when the household document no longer exists. The app leaves a dead pantry (`watchHousehold`). Rules `get()` lookups are billed as reads.
- `enableNetwork` while the network is already enabled crashes Firestore 10.14.1 in the tests: only call it after `disableNetwork`.
- `increment()` is at-least-once on the real service; safe counting (idempotent entries) is the next step in [../STATUS.md](../STATUS.md).
