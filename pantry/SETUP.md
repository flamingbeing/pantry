# Setting up family sharing (the owner, once, about 20 minutes)

Without this the pantry works fully, but each phone keeps its own. These steps make one shared pantry the family signs
into with Google. Nothing here goes in the repo except the web config (a public client ID, not a secret). Keep the
project id and who's in the pantry in the owner's private notes, not here.

1. **Cloudflare address.** First check `pantry` isn't a name already used at home (ask the owner; see [HOSTING.md](../HOSTING.md)).
   The address comes from `routes` in `wrangler.jsonc` (the deploy on merge creates it); if it doesn't appear,
   Cloudflare → Workers & Pages → **flamingbeing-home** → Settings → Domains & Routes → Add → Custom domain:
   `pantry.flamingbeing.com`. Open it on the phone: the empty pantry shows.
2. **Firebase project.** <https://console.firebase.google.com> → Add project → a name such as `family-pantry`
   (Google Analytics not needed).
3. **Blaze plan, with a budget alert.** Project settings → Usage and billing → Details → Modify plan → **Blaze**.
   Then in Google Cloud → Billing → Budgets & alerts → Create budget: this project, **US$5**, alerts at 50%, 90%, 100%.
   One family stays well inside the free quota (expected about US$0 a month; backups cost cents).
4. **Database.** Build → Firestore Database → Create database → location **asia-southeast1 (Singapore)** →
   production mode. (The rules arrive by themselves in step 9.)
5. **Daily backups.** Firestore → **Disaster recovery** (Backups) → Create schedule → **Daily**, keep **7 days** (needs
   Blaze). If the console doesn't offer it, ask Claude for the one-line `gcloud firestore backups schedules create`
   command to run in Cloud Shell.
6. **Google sign-in.** Build → Authentication → Get started → Sign-in method → **Google** → Enable (pick your support
   email) → Save. Then Authentication → Settings → **Authorised domains** → Add `pantry.flamingbeing.com`.
   Also on **Sign-in method**: **Email/Password** → Enable, and tick **Email link (passwordless sign-in)** → Save. This
   lets family members without a Google account sign in with an emailed link or a password.
   Never add a `*.workers.dev` preview address: previews can't sign in, on purpose.
7. **The Google sign-in client** (so sign-in can finish on the pantry's own address). Google Cloud console
   (<https://console.cloud.google.com>, same project) → APIs & Services → Credentials → **Web client (auto created by
   Google Service)** →
   - Authorised JavaScript origins: add `https://pantry.flamingbeing.com`
   - Authorised redirect URIs: add `https://pantry.flamingbeing.com/__/auth/handler`
   → Save. (OAuth consent screen: app name "Pantry", your email; it can stay in Testing if you add the family's Gmail
   addresses as test users, or publish it: only basic profile and email are asked for.)
8. **Web app config → Claude.** Project settings (gear) → Your apps → Web (`</>`) → nickname `pantry` → Register (no
   Firebase Hosting). Copy the `firebaseConfig = { … }` it shows and send it to Claude, who runs
   `node pantry/tools/set-config.mjs '<config>'` (it writes `pantry/config.js` and `pantry/auth/firebase/init.json`
   with `authDomain: "pantry.flamingbeing.com"`) and opens a PR.
9. **Rules deploy on merge.** The workflow `.github/workflows/deploy-firestore-rules.yml` deploys
   `pantry/firestore.rules` whenever it changes on `main`. It signs in without a key (Workload Identity Federation)
   as a rules-deployer service account with **Firebase Rules Admin** on this project, set up once by the owner's admin
   route (details in the owner's private notes). The workflow carries the project, provider and account names itself;
   repo variables `FIREBASE_PROJECT`, `WIF_PROVIDER` and `RULES_DEPLOYER` override them (for a fork or a new project).
10. **On your phone.** Open `https://pantry.flamingbeing.com` → Settings → **Continue with Google** (or **Use email instead**) → **Start our family
    pantry** → add each family member's Google (Gmail) address. If you had added items on that phone before, tap
    "Copy … from this phone". Family members open the same address and sign in; they see the pantry straight away.
    Then Add to Home Screen (Settings shows how).
