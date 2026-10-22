# Pantry: the items list

Small fixes, select mode, grip drag and My order, Bulk edit. Index: [../NOTES.md](../NOTES.md).

- **18 Oct 2026, My order hidden (owner's request):** the "Order within each category" choice under Category is gone; Category is by name. The drag code, `order.js` and any saved `order` numbers stay (nothing is deleted), and a saved `myorder` sort falls back to Use by. Move up and Move down in the grip sheet go with it; Move to… stays.

- **16 Oct 2026, small fixes (commit 1 of the combined Items-list PR; owner's queue, "PR-D"):**
  - **A pantry that goes away under an open phone.** Evidence: 11 rules errors at 08:30-08:32 UTC when a phone resumed on a
    household that had been deleted (the rules `get()` the household document, which errors when it is missing). `watchHousehold`
    (`cloud.js`) now says `cb(null)` once when the server says the document is gone or the listener fails (never from the phone's
    own cache: no signal with nothing cached is not "gone"), and `useHousehold`'s callback used to ignore null. Now
    `householdLost` (`app.js`) stops the old listeners, asks the SERVER which households the account is in (`findHouseholds`,
    `getDocsFromServer`: never the phone's copy, which still holds the dead one), and opens the survivor (`pickHousehold`) without a
    reload, with the toast "Your pantry changed: now showing …". With none left (or no signal) the phone shows its own pantry plus
    "Your pantry changed" with Try again on Home and Settings; nothing is started by itself. Test: `sync.e2e.mjs`, "a pantry that
    goes away" (two phones, the owner removes the pantry; the other ends on the survivor with no reload and no console errors; then
    nothing left, Try again before and after the owner adds the account to a new pantry).
  - **Sync now** (Settings → Saving to the family). A button that waits up to 5 s for the SDK to acknowledge every change
    (`waitForPendingWrites`), reads the household document from the server (proves the family can be reached: that read, any
    acknowledgement and any non-cache snapshot set "Last heard from the family"), and says plainly: "Everything is saved", "Still
    waiting: this phone can't reach the family right now" or "Needs attention: …" (a refused change; Retry and Discard below). It
    lists each waiting change in words ("Used one Rice", "Name for Jun", "Added place Garage": `describeWaiting` in `sync.js`) from
    a small record `cloud.js` keeps of the writes it has sent and the server has not answered (each `track()` call carries
    `{ kind, id, op, ops | name }`, cleared when its promise settles); changes left from before the app was last closed are
    listed by document ("A change to Rice (saved before the app was closed)"). **The network switch is offered, not automatic:** if
    the first try is still waiting, a second button "Reconnect and try again" turns the SDK's network off and on once
    (`disableNetwork`, 300 ms, `enableNetwork`; never `enableNetwork` while already enabled, which crashed Firestore 10.14.1 in
    tests). Reason: a change the server applied whose acknowledgement was lost is sent again after a reconnect, and an
    `increment` sent twice counts twice (the same limit as the randomised test's note). The SDK does this on any real reconnect;
    Sync now does not add one unasked.
  - **The "Waiting for signal" chip was wrong in one case, found and fixed.** The owner's phone said "Waiting for signal (1 change)"
    on wifi with a VPN while the server already held everything. `pending` used to be `max(inflight, documents the listeners flag
    hasPendingWrites)`. That flag is `hasLocalMutations || hasCommittedMutations` in the SDK, and a listener that already flagged a
    document keeps flagging it after the server ACKNOWLEDGED the write until the listen stream has delivered the server's version
    (view.mutatedKeys). On a slow or stalled listen stream (a VPN that buffers one of the two streams) that is "for good", so a
    saved change read as waiting. Reproduced in the emulator with `test/proxy.mjs` (a pass-through proxy that holds back what the
    server says on the Listen or the Write stream): the old code said "Waiting for signal (1 change)" with the change on the server;
    now `pending` counts only what the server has not acknowledged: this session's writes whose promise is unresolved, plus the
    documents flagged when the app opened (cleared when `waitForPendingWrites` resolves). The other candidates were checked and
    are fine: a listener that stays `fromCache` only matters with `pending > 0`; `onSyncState`'s 1.5 s grace stays. Not counted
    on purpose (so the chip can undercount, never overcount): `putMany` (copying the phone's pantry up, restoring, seeding the
    default places; the caller waits for those itself) and the daily sweep.
  - **"You → Your name" is gone in a family pantry** (the person's own row in Family sharing is the one place for the name; the
    contact sheet's field says "Your name" on your own row). A name saved on this phone is adopted once per household when the
    family has none for the account (one `names.<email>` field operation, flag `pantry:nameAdopted` = `{ <household id>: true }`),
    only after the family's own copy has come from the server, so it never overwrites a name from a stale cache. The field stays in
    local-only and demo mode, `who()` keeps its order (family name, this phone's name, Google first name), and the welcome check
    (`maybeWelcome`: "already using the app on this phone") still reads `prefs 'name'`.

- **16 Oct 2026, selecting items on the Items list (commit 2 of the combined PR; owner's decisions: "My order" per category only, every
  drag starts from the grip, Bulk edit in the same PR, plain words, phone first, a keyboard and screen-reader way for every drag):**
  - **Three ways in, so nobody is stuck behind a gesture:** the Select button above the list (the way for keyboards and screen
    readers), a press and hold on a row, and, once selecting, a tap anywhere on a row. `js/select.js` holds the selection as plain
    state (by item id, so it survives redraws from other phones; what another phone deletes drops out) and `holdToSelect`, written
    once: 500 ms with the finger still; more than 10 px of movement, a scroll or a cancelled pointer (a scroll starting on a touch
    screen) cancels; a small buzz through the kit's `haHaptic` (Android only, never with reduced motion), a visible cue (the row is
    shaded while it is held, then the bar and ticks appear) and a spoken one ("Selecting. 1 selected"); the click that comes with
    lifting the finger is swallowed (the row is a link); Android's `contextmenu` counts as the hold. The guard excludes only the
    grip, buttons and inputs, never the row's own link. Delegated on `#main`, so rows drawn later work.
  - **Rows while selecting** are `<label>` around a real checkbox (kit `.ha-row` style; the whole row is the target, no link to
    open); Space ticks, Enter too (a checkbox only does Space by itself). The **selection bar** sticks above the tab bar: "N selected"
    (a live region; "(M not shown)" for ticked items the search or place chip hides: a filter never silently changes what an action
    will touch), Select all (the whole filtered result), Select none, Done, and Move to… / Shopping list / Delete. Under a heading,
    "Select these N" ticks that group (also when it is folded), "Unselect these N" takes them off. **Back, the iPhone swipe and
    Escape leave selecting**: it is a history entry shaped like a sheet (`haSheet: 'pa-select'`), so `haGo` replaces it when a link
    is followed and no dead entry is left. Leaving the screen ends it.
  - **The actions end selecting and are each ONE batch and ONE toast with Undo.** Move to… opens a place picker sheet (radio list,
    the button names the count and the place); Shopping list adds one line per item not already on the list (one `putMany`; says how
    many were already there); Delete is the same removal marker as the item screen's (Recently removed). The word is **Delete**,
    not "Bin", on purpose: "Bin 1" on an item already means "throw one unit away" (a history entry counted as waste), and a bar
    button called Bin would suggest that. Undo (`undoBatch`) sends each item the inverse of what was done to it
    (`invertOps` with the item as it is now), so a field another phone changed since is left alone, and says "N changed since, left
    as they are" (an item removed since counts as changed, except when undoing a delete).
  - **Group by Place** is a fourth choice next to Use by, Name and Category (the default sort and look are unchanged): a heading per
    place in the household's order, with its count; a heading folds (the chevron button, `aria-expanded`; kept per phone in
    `pantry:folded`). Each place section carries `data-place`, which is what the drag in the next commit looks for.
  - Rows are now `<li data-id>` and the row `<a>` has `draggable="false"` (a link drags as a native ghost otherwise).

- **16 Oct 2026, dragging by the grip and My order (commit 3 of the combined PR):**
  - **The grip.** Every row on Items ends with a real button (`aria-label` "Reorder or move <item>", 44 px, `touch-action: none`,
    a sibling of the row's link, never inside it: a button inside a link fails axe). Every drag starts there (owner), and a tap, Enter
    or Space on it opens a small sheet (the keyboard and screen-reader way): Move up and Move down in My order, Move to… always;
    each result is spoken ("Eggs moved down: 2 of 2 in Dairy & eggs"). In My order the arrow keys on a focused grip move it a step.
    While selecting, the grip of a ticked row drags the whole selection (the ghost says "3 items"); an unticked row's grip drags that
    row alone.
  - **Where a drag can land** (`js/drag.js` knows nothing of items; `onGripDown` in `app.js` says what is under the finger): on a
    place, which moves it: a heading or section under Group by place (`data-place` on the section), or one of the place chips at the
    top (added so the grip does something in every sort; the chips scroll sideways, so only visible ones can be hit); and, in My
    order, within its own category, which reorders (an insertion line, "After Kaya" / "First in Dairy & eggs", "Stays here" when it
    would not move). Its own place is ignored ("Already in Fridge"), another category's rows give no line, and a drop on nothing does
    nothing. Moves reuse the selection's batch and Undo toast.
  - **Why pointer events, not HTML5 drag and drop:** HTML5 DnD does not work with touch on iOS Safari and gives no control of the
    ghost, the auto-scroll or the label. Adapted from the logbook's Reflections drag: a ghost lifted above the finger (so it isn't
    hidden), the target lit, a tick (`haHaptic`) on each new target, `touchmove` default prevented while dragging (iOS), edge
    auto-scroll that stops above the tab bar and the selection bar and below the top bar, Escape or a cancelled pointer puts
    everything back, ghost marked `aria-hidden`. A drag begins after 6 px, so a tap stays a tap, and the click after a drag is
    swallowed. Remote changes wait (`S.dragging`) and are drawn when it ends.
  - **My order** (`js/order.js`, pure) is a way of ordering inside each category (owner: per category only), chosen under Category
    ("By name | My order"; five labels don't fit one row at 320-390 px, and the segmented control keeps its look). One optional
    number `order` per item; the list sorts by it, numbers before items without one, ties by name then id, so every phone shows the
    same order whatever happened at once. Moving an item sets ONE field on ONE item: the midpoint of its new neighbours (after the
    last: last + 1; before the first: first - 1; first ever: 1). Only when there is no room (equal or too-close neighbours, a
    neighbour before it without a number, numbers near the limit) is the whole category renumbered 1, 2, 3 in one batch. No stamp:
    moving isn't changing. New items have no number and land at the bottom. Undo puts the numbers back only where nobody changed
    them since.
  - **Rules:** an item's `order` is absent or a number, greater than -1,000,000 and less than 1,000,000 (a string, null, NaN, a map or a
    list is refused; a rename in the same update is fine); no `hasOnly` on item keys (test: "order" cases in `sync.e2e.mjs`). Deploys
    on merge.
  - **Known limits.** iOS Safari touch behaviour is NOT verified here (Chromium with real touch events only): `touch-action: none`,
    pointer capture and `touchmove` prevention are the standard way, but a real iPhone needs a try. Two phones putting different items into
    the same gap can write the same number; the tie-break keeps their order the same everywhere. Chips scrolled out of sight can't be
    dropped on. A drag with several ticked items only moves them to a place (reordering several at once isn't offered).

- **16 Oct 2026, Bulk edit (commit 4 of the combined PR; the shape of the logbook's `bulkDialog` / `bulk-change.js`, written for the
  pantry's fields, nothing copied):** a screen, `#/bulk`, reached from the Bulk edit button above Items (or from the same button while
  selecting, which brings the ticked items along). Checkbox rows with the Items search and place chips plus a category, **Select all
  matching** (the whole filtered result; ticked items the filter hides are counted, not forgotten) and Select none. Every field starts
  **Unchanged**; you choose which to change: Place (Move to…), Category, Kept track of (Counting, or Plenty, low, out), Best-before
  (move every date by N days later or earlier, or set one date), Add to the shopping list, Delete. Names stay one at a time. **Review
  changes** says "N items will change" (the headline counts items, not fields), lists each choice, up to three before and after,
  what was skipped and why, and warns when it replaces something; **Save** applies ONE batch (`patchMany`) plus one `putMany` for new
  shopping lines, with ONE toast Undo for both ("N changed since, left as they are", counting an item when ANY of its fields had
  been changed since, even if the rest was put back). `js/bulk-items.js` is the pure part (`test/bulk-items.test.mjs`: every choice as
  ops, skips, warnings, and Undo round trips through `invertOps` for batches of moves, categories, conversions, date changes and
  deletes).
  - **Tracking mode.** Counting → Plenty, low, out sets `measure: 'level'` and `level` from the stock (nothing: Out; at or below its
    "on the list when down to" number: Low; else Plenty). The batches are NOT deleted: they stay, hidden, so switching back brings the
    counts and dates back and Undo is exact; Review warns "N items will stop counting: their numbers and dates are kept, hidden".
    Level → Counting removes `measure` and `level`; an item with no stock counted then shows None left (warned). An item converted to
    Plenty, low, out has no dates, so a best-before choice is skipped for it ("kept as Plenty, Low, Out"). Nothing here is lossy, so
    there is no "lossy" warning beyond those two.
  - **Best-before** works on batches with something left (`fefo`): a shift moves each dated one (undated ones are left); a set date
    goes on all of them. Items with no stock, no dates to shift or kept as Plenty, low, out are skipped and counted in Review.
  - **Delete is applied alone** (every other choice is ignored for it) and is the same removal marker as everywhere (Recently removed).
  - The screen's rows read `items()` only (the live-only door): `removed.test.mjs` still guards every list and was extended for the
    few lookups by id that name an item in a toast or a label.

- **Dates toggle** (per phone, `fullDates`): a chip beside the Items title swaps the use-by badges between "in 10 days" and the date in full ("24th Oct 26"). Items list only.
