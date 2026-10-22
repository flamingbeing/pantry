# Pantry: app design and data

Stock, photos, shops, barcodes, the look, undo, demo mode, lessons from Kaki Home. Index: [../NOTES.md](../NOTES.md).

- **16 Oct 2026, first build (PR #5, closed):** plain HTML and JS modules, no build step. Data lives on the phone
  (IndexedDB) until family sharing is set up; then in Firestore, one household per family: `households/{hid}` with
  `members` (emails, lower case; Google, emailed link or password), and `items`, `events`, `shop` under it. Rules: only members read or write; the
  person who started it can't be removed and stays owner. Real household data never goes in this public repo.

- **Stock is batches** (qty, best-before, opened date). An opened item is due by the earlier of its printed date and
  opened + "keeps once opened" days. Taking out is first expiring first (opened ones first). The pace comes from
  "used up" events: (last − first finish) ÷ units after the first; run-out = last finish + stock × pace. The shopping
  list suggests anything out, at or below its "on the list when down to", or due to run out within a week.
- **Expiry in words** (owner, Oct 2026): every dated item shows it ("in 2 weeks", "Expired 3 days ago"; amber within 3
  days, red once past; `shortLabel` in `js/logic.js`).

- **Photos** are small JPEG data URLs in Firestore (no Storage bucket to pay for or secure). Since 16 Oct 2026 (owner,
  see below) each one is kept twice: a thumbnail on the item and the photo in its own document.

- **Shops:** items link to FairPrice, Sheng Siong, Cold Storage and Shopee search (`SHOPS` in `js/logic.js`; Cold Storage and Shopee added 16 Oct 2026 at the owner's request). FairPrice and Sheng Siong have no public product API and block cross-site requests, so the app has its own
  list of common Singapore goods (`js/catalogue.js`) and links to each shop's search. Barcodes: see below. iPhone has no built-in
  barcode reader, so a ZXing WebAssembly polyfill loads from jsDelivr on the first scan (then works offline).

- **Barcode look-ups (16 Oct 2026, owner):** a scan first checks the family's own pantry (found: the item opens with
  Bought more, nothing asked online). Otherwise `lookup()` in `js/scan.js` asks Open Food Facts, Open Products Facts
  (household goods) and Open Beauty Facts (toiletries) at once, same API (`/api/v2/product/<code>.json`), all
  `access-control-allow-origin: *`, each with a 6 second limit; the first hit in that order wins and the slower ones are
  stopped. Errors, 404s, 500s and no signal all count as "not known" (it never throws). A household hit guesses Laundry
  & cleaning / Store room, a toiletry hit Toiletries / Bathroom, used only while the form still has the default and
  nobody has picked one. The product picture is fetched as before. **Unknown barcodes** open the sheet "We don't know
  this barcode yet" (a history entry; Cancel keeps the barcode in the form): a search over the pantry and the
  catalogue (the Add screen's own scoring; a catalogue product already in the pantry shows once, as the pantry item).
  A catalogue pick fills the form with the barcode; a pantry pick saves the barcode on that item (replacing any older
  one) and opens Bought more; "Type a new name" focuses Name, starting with what was typed. The browser test fakes the
  camera (a canvas stream and a stub `BarcodeDetector` reading `window.__scanCode`) and routes the three hosts; the
  app itself has no test hook.

- **16 Oct 2026, rebuilt on the home design kit** (owner): `https://design.flamingbeing.com/v1/tokens.css`, `app.css`, `app.js`; the app's own
  CSS is only `pantry.css` with a `pa-` prefix; no emoji (category icons from the kit's sprite, which gained 22 icons for
  household things). Every screen (`#/`, `#/items`, `#/item/<id>`, `#/add`, `#/edit/<id>`, `#/shop`, `#/settings`) and
  every sheet is a history entry, so the iPhone swipe and Android back always work. Add and Edit are task screens: the
  tab bar gives way to a toolbar with the one primary button. Saving an add replaces the add screen with the item, so
  back returns to where Add was opened.

- **Undo over confirm:** Used 1, Bin 1, Open, Bought more, delete item, remove a list line, clear ticked: done at once
  with Undo in the toast. Only "Delete everything on this phone", stopping sharing with someone and signing out with
  unsent changes ask first.

- **A family member's change never wipes what someone is doing:** while a form is open, a sheet is up or a field has
  text in it, changes from the family wait and are drawn afterwards.

- **Demo mode `?demo`:** made-up items in memory only, no Firebase, nothing saved. Makes PR previews useful.

- **16 Oct 2026, from Kaki Home** (now `flamingbeing/kakihome`, a separate app built from this one; owner asked for its lessons to
  come back here):
  - **Used before expiry and expired are recorded when they happen.** Whether a unit was still in date is lost once
    its batch is gone, so a "used up" event stores `saved` (units from dated batches still in date) and binning a
    batch already past its date is recorded as type `expired` (counted with thrown away). This month on Home shows
    "Used before expiry" and how many of the thrown away were past their date.
  - **Say or type** (`js/quick.js`, mic on Home and on Add): the phone's own speech-to-text (or the keyboard's mic),
    then plain rules for quantity, place and date, matched against the pantry and the catalogue; a list to confirm
    before anything is added, with one Undo. No AI; nothing leaves the phone.
  - **Who added and last changed an item** (`createdBy`, `updatedBy`), in its details.
  - **"Use soon" setting** (Settings → Reminders: 3 days, 1 week or 2 weeks; default 2 weeks as before; per phone).
