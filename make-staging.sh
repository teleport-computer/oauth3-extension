#!/usr/bin/env bash
# Build a *staging* variant of this extension into ../oauth3-extension-staging,
# pointed at a staging homeserver. It installs alongside the prod extension
# (different display name → separate entry in chrome://extensions) so you can
# run both at once against prod and staging nodes.
#
#   ./make-staging.sh https://<staging-host>/oauth3
#   WEBHOST_STAGING=https://<staging-host>/oauth3 ./make-staging.sh
#
# The staging URL is REQUIRED — there is no built-in default (the prod default
# lives in popup.js / service-worker.js). Passing nothing is an error, on
# purpose, so a staging build can never silently hit the prod node.
set -euo pipefail

STAGING_URL="${1:-${WEBHOST_STAGING:-}}"
if [[ -z "$STAGING_URL" ]]; then
  echo "make-staging: missing staging homeserver URL" >&2
  echo "  usage: ./make-staging.sh <staging-homeserver-url>" >&2
  echo "     or: WEBHOST_STAGING=<url> ./make-staging.sh" >&2
  exit 64
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$(cd "$HERE/.." && pwd)/oauth3-extension-staging"

echo "make-staging: building → $OUT"
echo "  homeserver: $STAGING_URL"

# Fresh copy of the extension sources (no build step — load-unpacked).
rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$HERE"/{manifest.json,popup.html,popup.js,service-worker.js,provider-inject.js,provider-bridge.js,icons} "$OUT"/

# Repoint the default homeserver at the staging node. Both files declare the
# same const on its own line; swap the whole line so the quote/semicolon style
# is preserved exactly. (-i.bak + rm keeps this portable across GNU/BSD sed.)
sed -i.bak \
  -e "s#^const DEFAULT_HOMESERVER = .*#const DEFAULT_HOMESERVER = \"$STAGING_URL\";#" \
  "$OUT/popup.js" "$OUT/service-worker.js"
rm -f "$OUT"/*.bak

# Rename so it installs alongside prod (no packed key → distinct install entry).
python3 - "$OUT/manifest.json" <<'PY'
import json, sys
p = sys.argv[1]
m = json.load(open(p))
m["name"] = "OAuth3 (staging)"
m["description"] = "[STAGING] " + m.get("description", "")
json.dump(m, open(p, "w"), indent=2)
PY

echo
echo "make-staging: done. Load $OUT unpacked in Chrome:"
echo "  chrome://extensions → Developer mode → Load unpacked → $OUT"
echo "  It shows as 'OAuth3 (staging)' next to your prod install."
