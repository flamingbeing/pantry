# Pantry: sign-in, hosting and deploys

Where the app is served, how sign-in works, config, the service worker, rules deploys, which family pantry opens, email sign-in, merging. Index: [../NOTES.md](../NOTES.md).

- **Hosting:** `pantry.flamingbeing.com` (Worker `SITES`, [HOSTING.md](../../HOSTING.md)), with `/__/auth/` (Firebase's generic sign-in
  helper pages, copied from Firebase into the repo's `__/auth/`) and `/__/firebase/init.json` (`pantry/auth/firebase/`).

- **Sign-in** (the anawj.com logbook's lessons): `authDomain` is the app's own address, so redirects never cross sites
  and installed iPhone apps keep their sign-in state ("missing initial state"). Installed apps and Firefox on Android
  sign in by redirect; browser tabs by popup, falling back to redirect when popups are blocked. `getRedirectResult`
  runs on every start. Errors show in plain words (`explain()` in `cloud.js`), never the raw message.

- **The Firebase SDK loads once** (one shared promise, reset on failure): v1 loaded it twice when two calls raced, and
  the second `initializeApp` broke the auth emulator.

- **Signing out** first waits up to 4 seconds for unsent changes (`waitForPendingWrites`); if some are still waiting
  (no signal) it asks before signing out, since they would be lost.

- **Config:** `config.js` stays `null` (on-phone only) until the owner sends the web config; then
  `node pantry/tools/set-config.mjs '<config>'` writes `config.js` and `auth/firebase/init.json` with
  `authDomain: 'pantry.flamingbeing.com'`. These are public client IDs, not secrets.

- **Service worker** (`sw.js`): `VERSION = 'pantry-v1'`, stamped only at deploy (`tools/stamp-versions.mjs`); never by
  hand. Install is all or nothing (every SHELL file, kit files included) and does not `skipWaiting`. The page tells a
  waiting version to take over only when idle (no sheet open, not on Add/Edit, nothing typed) or when the app goes to the
  background; otherwise it shows "Update ready · Restart". Activate deletes only `pantry-` caches. The Firebase SDK and
  the barcode reader are cached on first use. `/__/` (sign-in pages) and `sw.js` always go to the network.

- **Rules deploy on merge** through `.github/workflows/deploy-firestore-rules.yml` (project id from the repo variable
  `PANTRY_FIREBASE_PROJECT`, key from the secret `FIREBASE_SERVICE_ACCOUNT`); it skips cleanly until both are set.

- **16 Oct 2026, which family pantry opens** (owner report: after saving a name, "the list of my family members
  disappeared"; saving names itself never hides anyone, tested with three members on three phones, with reloads): an
  account can be in more than one household (a second "Start our family pantry" when the first lookup failed), and
  the lookup's first match is arbitrary, so a one-person duplicate could open instead of the family's. `findHousehold`
  now takes the one this phone last used (`pantry:household`), else the one with most members, else the oldest
  (`pickHousehold`); "Start our family pantry" first looks for an existing one.

- **16 Oct 2026, sign in by email too** (owner; Google stays the main button): Settings → Family sharing shows
  **Continue with Google** and a quiet **Use email instead** (a sheet: the address, then **Email me a sign-in link** or
  **Use a password** with Sign in, Create account and Forgot password). Not offered in the demo or on-this-phone mode.
  - **Rules still need `request.auth.token.email_verified == true`** (unchanged). Google and email-link sign-ins are
    verified already. A new password account is not: `userInfo().verified` is false, the app keeps it as `S.pending`
    (never `S.user`), does no household lookup and reads nothing from Firestore, and Settings shows "Check your email"
    with **I've verified** (`reload()` + `getIdToken(true)`, then carries on) and **Send it again**. Coming back to the
    app checks quietly too.
  - **Email link:** `sendSignInLinkToEmail` with `handleCodeInApp: true`, continue URL `https://pantry.flamingbeing.com/`
    (localhost: the page itself, `continueUrl()`). The address is saved in `localStorage pantry:emailForSignIn`. On
    load, `isSignInWithEmailLink` finishes it with that address, or, when the link was opened elsewhere (Safari instead
    of the home-screen app), a small sheet asks for it. Then the link's query comes off the address and the saved
    address is cleared. The "link sent" text says that on an iPhone the link may open in Safari, that's fine, and to use
    a password in the home-screen app.
  - Errors in plain words through `explain()` (wrong password, no account, already in use, weak password (8+ here),
    bad or missing email, expired or used link, "This way of signing in isn't switched on yet."). Passwords are
    only ever sent to Firebase Auth; nothing is stored here.
  - **The owner must switch it on** ([SETUP.md](../SETUP.md) step 6): Authentication → Sign-in method → Email/Password, with "Email
    link (passwordless sign-in)" ticked. Until then the sheet says it isn't switched on yet.
  - Tests: `test/signin.e2e.mjs` (run by `run-sync.sh`, reads the Auth emulator's `oobCodes`), helpers in
    `test/config.test.mjs`.

- **16 Oct 2026, never a second pantry from a bad signal** (owner: "can the app create a second pantry offline?"): yes,
  it could. The lookup used `getDocs` on the persistent cache, which answers from the phone's copy when offline (empty or
  old = "no pantry"), then "Start our family pantry" queued a `setDoc` that committed whenever signal came back. Now
  `findHouseholds` uses `getDocsFromServer`: offline it throws, the app shows "Can't check right now" with Try again
  (retries by itself when the phone is back online) and no Start button; `createHousehold` is a transaction, which needs
  the server and never queues; Start looks the account up on the server first and refuses a second tap while one is
  going. Test: Firestore blocked in the browser (`sync.e2e.mjs`).

- **16 Oct 2026, merge duplicate pantries** (owner: "we should merge duplicate emails into 1 pantry"; the real cause of
  the disappeared list was an account in two households, one a stray one-person pantry). `S.pantries` holds every
  household the account is in (`findHouseholds`, at most 10). With two or more, Settings shows "Two family pantries"
  and Home a one-line note; the sheet (`openMerge`) lists each (people, who started it) with the one with most people
  chosen to keep. **Merge into this one** (after a confirm): `copyHousehold` copies items, events, shop and photos in
  batches (photos first; an old-style item's `photo` moves to `photos/<id>`), merges places (`places.js mergeInto`, by name, the kept pantry's
  first) and settings (`js/merge.js`: names joined, the kept pantry's name wins), then COUNTS (`getCountFromServer`: the kept pantry must hold
  at least what was copied); members are unioned (over 20: refused, nothing done); the app switches to the kept pantry;
  only then `removeHousehold` deletes the other's documents and the household, one pantry at a time. Any error before
  that deletes nothing and says so (re-running is safe: the same ids are written again). Only the owner of a pantry that
  would be deleted may merge it away (the rules: household delete is owner only); otherwise it says "Ask <owner> to merge
  them". No rules change. Tests: `test/merge.test.mjs`, and the merge section of `test/sync.e2e.mjs` (merge, non-owner,
  failed copy).
