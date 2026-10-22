# Pantry

The family's household inventory, at `pantry.flamingbeing.com`: what's at home, what to use first, how fast the
family gets through things, and what to buy. A phone app (installable PWA) on the home design kit (`https://design.flamingbeing.com/v1/`).
Start with [NOTES.md](NOTES.md) (decisions, how to test); the owner's one-time setup is [SETUP.md](SETUP.md); what's
happening now is [STATUS.md](STATUS.md).

| Path | What |
|---|---|
| `index.html`, `pantry.css` | The shell (bar, tab bar, toolbar) and the app's own `pa-` styles on top of the kit |
| `js/app.js` | Screens (hash routes via the kit's `haRouter`), sheets, clicks, data sources, updates |
| `js/logic.js` | Pure logic: dates, batches (first expiring first out), opened-by dates, usage pace, run-out, shopping list, search, CSV, backups |
| `js/catalogue.js` | About 190 common Singapore supermarket goods to pick from |
| `js/store.js` | This phone's pantry (IndexedDB), the demo's (memory) and small per-phone settings |
| `js/cloud.js` | Family sharing: Google sign-in and the household in Firestore (only with a config) |
| `js/guide.js` | Help for first-time users: the welcome on first open (once per phone) and the guide screen `#/guide` |
| `js/scan.js`, `js/photo.js`, `js/sample.js` | Barcode scanning and Open Food Facts look-up, photos shrunk into the item, made-up sample items |
| `config.js` | The Firebase web config (null until set up: on-phone only); written by `tools/set-config.mjs` |
| `auth/firebase/init.json` | Served at `/__/firebase/init.json` for Firebase's sign-in pages (written by `tools/set-config.mjs`) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and the home-screen icon (`tools/icons.mjs` renders the PNGs) |
| `firestore.rules`, `firebase.json` | Members-only households; deployed on merge by `.github/workflows/deploy-firestore-rules.yml` |
| `test/` | `logic.test.mjs`, `config.test.mjs`, `scan.test.mjs` (plain node), `e2e.mjs` (phone browser test), `sync.e2e.mjs` + `run-sync.sh` (emulators) |

Try it without any account: `<preview>/_sites/pantry.flamingbeing.com/?demo` (made-up items, nothing saved).
