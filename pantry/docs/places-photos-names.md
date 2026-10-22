# Pantry: photos, places and names

Thumbnails, editable places, names for the family and the research items. Index: [../NOTES.md](../NOTES.md).

- **16 Oct 2026, thumbnails on items, photos only when opened** (owner): with the whole photo (30-60 KB) inside each
  item, every app open downloaded every photo (the `items` listener), which for hundreds of photographed items and a
  family opening the app often could pass Firestore's free 10 GB a month of downloads. Now an item holds only
  `thumb` (96px JPEG, quality 0.6; measured about 1.5-3 KB, at most 10 KB after stepping down) and `hasPhoto: true`;
  the photo (480px, quality 0.72; measured about 25-60 KB, at most 140 KB) is `photos/<item id>` = `{ id, data,
  updatedAt }`. Lists, rows, suggestions and Home use the thumbnail; the item screen shows it at once and swaps in the
  photo, fetched once (`get`, never a listener) and cached in memory by thumbnail. Taking, removing or deleting writes
  or deletes both (photo first); backups carry `photos`; copying the phone's pantry into the family's copies them.
  **Old-style items** (`photo` inside the item) still show, and `migratePhotos()` moves them quietly, about three a
  second, on every load and family change: it writes the photo, and only once that is saved drops `photo` from the
  item (local: omitted; Firestore: the item is rewritten without it). **Rules** (`firestore.rules`): `photos` is
  members-only like the rest; `thumb` at most 12 KB; photo `data` at most 150 KB with only `id`, `data`, `updatedAt`;
  no item may gain or change a `photo` (keeping it unchanged, removing it or an empty one from older versions is fine).
  Older app versions still on a phone can't add photos until they update (their writes are refused).

- **16 Oct 2026, places the family can edit** (owner: "add ability to see and edit locations? and make custom
  locations", and default places Level 1 fridge, Level 1 freezer, Basement store): the places ("Kept in") are an ordered
  list per household (**since PR-C, 16 Oct 2026, one document per place: see "Names by field and places as one record
  each" below; this paragraph is the original design**), `settings/places` = `{ id: 'places', list: [names], updatedAt }` (`js/places.js`), loaded and
  listened to with the other kinds so the whole family shares it, kept on the phone too, in backups, and merged (theirs
  first, then any only this phone had) when restoring or copying this phone's pantry into the family's. With nothing
  saved the list is `DEFAULT_PLACES`: the catalogue's places with the owner's three next to their kind. Items keep their
  place as plain text: the catalogue's generic place is kept as it is, and any place an item uses that isn't in the list
  still shows in Add, Items and Places ("Not in your list"). **Settings → Places** (`#/places`): each place with its item
  count; its sheet renames it (every item kept there moves in one batch, with Undo), moves it up or down (the order of
  Add and Items), or removes it (with items: a sheet asks where they go first; never orphaned; at least one place
  stays). Say or type matches the household's names first (multi-word, digits said as words, and a place the family
  added without its last kind word: "basement"), then the everyday words, landing on a household place of that kind.
  **Rules:** `settings` is members-only; only the id `places`, only `id`, `list`, `updatedAt`; `list` 1 to 40 strings of
  1 to 40 characters (one `is string` check per index, then the names joined by newlines matched by one pattern: 40
  separate length checks passed the 1000-expression limit).

- **16 Oct 2026, names for the family** (owner; Kaki Home's design, PR #28, ported): Settings → Family sharing lists
  each member as a row (the name, with the Gmail under it, or the Gmail alone); tapping one opens their contact sheet:
  Gmail, a Name field and Save, Email an invite (the same mailto as before), Stop sharing (asks first; not for whoever
  started it, nor yourself). The envelope and bin icons on each row moved into the sheet. Names are
  `settings/people` = `{ id: 'people', names: { email: name }, updatedAt }` (`js/people.js`; since PR-C one name is saved as one
  field update, never the whole map), loaded and listened to
  with the other settings (no new listener). The family's name for you signs your changes (`who()`), and names show
  wherever a person does (history, added and changed by, shopping list "Added by"): `nameOf()` maps an email to its
  name and leaves older name-signed entries as they are. Stop sharing also drops that person's name. **Rules:** settings
  ids `places` and `people` only; people exactly `id`, `names`, `updatedAt` (`updatedAt` a string), `names` a map of at
  most 20, each value a string of 1 to 40 characters with no new line, each key an email (no spaces, one @). Same trick
  as places to stay under the 1000-expression limit: one `is string` per index of `names.values()`, then one pattern
  over the values joined by new lines and one over the keys. An empty map is allowed (all names removed). Backups keep
  `people` but a restore takes only places (names belong to a family, not a file). The demo has a made-up family (Mum is
  "you", Dad, and Grandma with no name), changed in memory only.

- **16 Oct 2026, from the pantry research (items 1 to 8, owner):**
  - **Guessed best-before:** `shelfDays()` in `js/catalogue.js` (a product's own rule by name, else its category;
    `null` where no date matters: salt, tissue, soap; frozen goods ignore the name rules). Add, Bought more, Put away,
    Say or type and scan-many Bought fill the guess; on Add and Bought more it is a selected "About 1 week" chip with a
    line saying it's a guess. A date someone typed is never replaced; a change of category or place re-guesses only
    while the date is still the guess. In a freezer the guess is the frozen keep (1 year, bread 1 month).
  - **Since you last looked** (Home): events and shopping-list lines signed by someone else after this phone's
    `pantry:lastSeen` (per phone; set on open and when the app goes to the background; "Got it" sets it now). Never in
    on-this-phone mode (everything there is this phone's). **"Use this week"** under Use soon and **"Going shopping
    now"** on the list are `https://wa.me/?text=…` links with plain text: WhatsApp asks which chat, nothing is sent by
    the app.
  - **Freeze / Thaw** on a batch (food only; reworked 21 Oct 2026, owner): Freeze keeps the frozen units till the later of
    their own date and 1 year (bread 1 month), marks them `frozenAt` and remembers the packaging date and place
    (`packExpiry`, `packPlace`, kept through later thaws and freezes); Thaw clears `frozenAt`, sets `thawedAt` and gives
    3 days. Both ask **how many** when a batch has more than one (some of a batch split off into `<id>-f<day>` /
    `<id>-t<day>`, like Open) and **which** freezer or fridge when the family has two or more (this phone's last pick
    first, `pantry:lastCold`). Places belong to items, not batches, so the **item moves only when none of its stock is
    left behind** (the batch rows say which is frozen). **Not frozen** on a still-frozen batch with `packExpiry` (never after a thaw) puts the packaging
    date back, drops both fields and moves the item back to `packPlace` once nothing else of it is frozen. A batch in a
    freezer place counts as frozen unless thawed (`isFrozenBatch`). While frozen, opening doesn't count; after a thaw an
    opened batch counts from the thaw. Events `freeze`, `thaw`, `unfreeze` show in history only.
  - **Moving into or out of a freezer** (Move to…, a drag, Bulk edit's place, the edit form's Kept in): food freezes or
    thaws the same way (`moveFreezeOps`), with the place change in one write and one Undo. Bulk edit that also sets a date
    keeps that date. Renaming a place moves nothing.
  - **Kinds of place**: Fridge, Freezer or Other, guessed from the name (freezer, freeze, frozen, ice box; fridge,
    refrigerator, chiller) and settable in the place's sheet (`kind` on the place document; the rules allow only those
    three). Freeze, Thaw, Leftovers and the freezer guess on Add use the kind.
  - **Leftovers** (Home and Add): a name, the fridge place, use within 3 days; category Leftovers, `noRestock`.
  - **Shopping list:** lines grouped by aisle (the pantry item's category, else the catalogue's best match for the
    typed name, in `CATEGORIES` order); **Buy again** chips (items bought two or more units in total, not on the list or
    suggested, most bought first, at most 8); a mic on the add line when the browser has speech recognition (each
    thing said becomes a line, one Undo). **Ticking no longer opens Bought more**: a ticked line goes to "In the
    trolley", and **Put away** opens one sheet listing every ticked line with its place, guessed date and how many
    (new items take the catalogue match's details), one Save adds them all and removes the lines, one Undo.
  - **Plenty / Low / Out** (staples): item `measure: 'level'`, `level`. Chosen on Add or Edit ("Keep track by"); the
    item shows a three-way control instead of batches. Low or Out adds a list line (Undo takes both back); Put away,
    Bought more, Say or type and scan-many Bought set Plenty; scan-many Used up sets Out. `toBuy` lists Low/Out staples;
    staples never show under Use soon; events `level` ("Marked low").
  - **Scan many** (Home): one sheet, the camera stays open (`scanMany()` in `js/scan.js`: each barcode once while it
    stays in view, 2.5 s), mode Bought / Used up / Add to list, a running tally, barcodes not in the pantry wait with
    "Add it" (opens Add with the look-up), Done gives one toast with one Undo for every scan.
  - Data cost: nothing new is listened to or read in full; all of it is the existing items, events, shop and settings.
