#!/usr/bin/env bash
# Runs the family-sharing test against local Firebase emulators (demo project, fake accounts; no sign-in).
set -euo pipefail
cd "$(dirname "$0")/.."
npx -y firebase-tools@13.29.1 emulators:exec --only firestore,auth --project demo-pantry "node test/sync.e2e.mjs && node test/signin.e2e.mjs && node test/multidevice.e2e.mjs"
