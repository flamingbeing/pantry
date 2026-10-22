# flamingbeing/pantry

Instructions for every AI assistant working here (Claude Code reads this through `CLAUDE.md`).

**Pantry** (`pantry/`): the family's household inventory, live at `pantry.flamingbeing.com` with real family data
in its own Firebase project. Start with `pantry/NOTES.md`; deeper notes in `pantry/docs/`. Hosting: [HOSTING.md](HOSTING.md).

## Public here, private elsewhere

Anything merged here is public. Keep only code, docs, general rules and **made-up** sample data. Never commit
secrets, tokens, personal data, real names or household data (public Firebase web configs are fine). Private notes
belong in the owner's private notes; never copy anything from there into this repo, a PR or an issue (neutral
pointers like "ask the owner" are fine).

## Rules that bite

- **Design kit by URL:** the family home design kit lives in another repo and is linked at
  `https://design.flamingbeing.com/v1/` (`tokens.css`, `app.css`, `app.js`, `icons.svg`); never copy it here. Icon
  markup writes `<use href="#i-<name>"/>` (the kit puts its sprite in the page). `/v1/` never breaks; a breaking kit
  change would come as `/v2/`.
- **Apps stay unlisted:** every page has `<meta name="robots" content="noindex, nofollow">`; never link the app publicly.
- **Service workers:** `sw.js` has `const VERSION = 'pantry-v<N>'`; never stamp it by hand (the deploy runs
  `tools/stamp-versions.mjs`). Change `<N>` only when the worker's own logic changes. Delete only `pantry-` caches.
  The kit's four files are in its `SHELL` list by full address, so the app works offline.
- **Google sign-in** happens on the app's own address (`authDomain` is `pantry.flamingbeing.com`; Firebase's helper
  pages in `__/auth/`, `init.json` in `pantry/auth/firebase/`). Never add `*.workers.dev` previews to Firebase.
- **Firebase is live family data:** never sign in to, read or change the live project; the local emulator with a `demo-*`
  project is fine. Rules deploy on merge (`.github/workflows/deploy-firestore-rules.yml`): run the rules tests, merge
  only when Checks are green, confirm the deploy run, and say what the rules now allow or deny. Never loosen rules to
  pass a test.
- **Live cloud changes** (Firebase, Auth, IAM, Cloudflare DNS or Workers settings) are not made from a session: ask the owner.

## Checks before merging

```
node tools/check.mjs                 # repo checks + Worker tests
node tools/stamp-versions.mjs --check
for f in pantry/test/*.test.mjs; do node "$f"; done
node tools/proofread.mjs             # page and doc mistakes
```

Plus the browser tests when the app changes (listed in `pantry/NOTES.md`; "Pantry checks" runs them on PRs).

## Working with the owner

- Instructions mostly come from a phone. Work through a request to the end; ask only when a decision is genuinely
  the owner's. When asked to plan, plan and wait.
- Keep each PR small and finished on its own. Start PR titles with "Pantry: …" (or "Repo: …").
- Merge your own PRs once the checks pass, then report with the PR link and call `unsubscribe_pr_activity`.
- Every merge to `main` deploys (`.github/workflows/deploy.yml`); push once per finished step.
- `pantry/NOTES.md` (lasting decisions, how to test) and `pantry/STATUS.md` (now, next, dated decisions): read
  them before starting; update them when a task finishes. Cheap end of session: `quick-save`.
- Show UI changes with 390 px screenshots. Plain words, short.

## Token savers

- `.claude/settings.json` denies reading `__/` (Firebase's sign-in helper pages). Ask the owner if one is really needed.
- Run only the touched tests while iterating and the full run once before merge.
