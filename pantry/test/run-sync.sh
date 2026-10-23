#!/usr/bin/env bash
# Runs the rest of the family-sharing story (sync.e2e.mjs) against local Firebase emulators (demo project, fake accounts; no sign-in).
# The first half and the randomised three-phone run are Playwright specs: npx playwright test sync multidevice
set -euo pipefail
cd "$(dirname "$0")/.."
npx -y firebase-tools@13.29.1 emulators:exec --only firestore,auth --project demo-pantry "node test/sync.e2e.mjs"
