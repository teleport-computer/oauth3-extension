#!/usr/bin/env bash
# Generate ../oauth3-extension-staging: same extension, default node = webhost-staging,
# renamed so it can be installed side by side with the prod one. Re-run after any change.
set -euo pipefail
cd "$(dirname "$0")"
STAGING_NODE="https://78ffc78c25e0c8a9e64bb3a969ba6f226abae62d-8080.dstack-pha-prod7.phala.network/oauth3"
OUT=../oauth3-extension-staging
rsync -a --delete --exclude .git --exclude make-staging.sh --exclude test ./ "$OUT/"
sed -i "s|const DEFAULT_HOMESERVER = \".*\";|const DEFAULT_HOMESERVER = \"$STAGING_NODE\";|" "$OUT/popup.js" "$OUT/service-worker.js"
sed -i 's|"name": "OAuth3"|"name": "OAuth3 (staging)"|' "$OUT/manifest.json"
grep -q "$STAGING_NODE" "$OUT/popup.js" "$OUT/service-worker.js"
grep -q '(staging)' "$OUT/manifest.json"
echo "built $OUT -> default node $STAGING_NODE"
