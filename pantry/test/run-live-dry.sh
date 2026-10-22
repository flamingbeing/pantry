#!/usr/bin/env bash
# Dry run of the live-service harness (pantry/test/live-multidevice.mjs) against LOCAL Firebase emulators (project
# demo-pantry, made-up accounts, never the live projects). Used to test the harness itself.
#   pantry/test/run-live-dry.sh [harness options]      e.g.  --engine chromium --seeds 11 --steps 30 --out /tmp/dry.json
# Ports are 18085 (Firestore) and 19099 (Auth) so it can run beside run-sync.sh (8085 / 9099); change with
# LIVE_DRY_FS_PORT / LIVE_DRY_AUTH_PORT.
set -euo pipefail
cd "$(dirname "$0")/.."
FS_PORT="${LIVE_DRY_FS_PORT:-18085}"
AUTH_PORT="${LIVE_DRY_AUTH_PORT:-19099}"
CFG="$(mktemp -d)"
trap 'rm -rf "$CFG"' EXIT
cp firestore.rules "$CFG/firestore.rules"   # the repo's current rules, copied beside the temporary config
cat > "$CFG/firebase.json" <<EOF
{
  "firestore": { "rules": "firestore.rules" },
  "emulators": {
    "firestore": { "port": $FS_PORT, "host": "127.0.0.1" },
    "auth": { "port": $AUTH_PORT, "host": "127.0.0.1" },
    "hub": { "port": $((FS_PORT + 1000)), "host": "127.0.0.1" },
    "logging": { "port": $((FS_PORT + 1100)), "host": "127.0.0.1" },
    "ui": { "enabled": false }
  }
}
EOF
ARGS=""
for a in "$@"; do ARGS="$ARGS '$a'"; done
npx -y firebase-tools@13.29.1 emulators:exec --config "$CFG/firebase.json" --only firestore,auth --project demo-pantry "node test/live-multidevice.mjs --dry $ARGS"
