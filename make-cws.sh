#!/usr/bin/env bash
# Build the lean, ingest-only Chrome Web Store package (v0.1) into
# ../oauth3-extension-v0.1.0.zip. NO provider injection — content_scripts and
# provider-inject/bridge.js are dropped so the single-purpose story is clean; the
# sideloaded pod build keeps injection. Reproducible: builds from committed HEAD
# (git archive), never the dirty working tree.
set -euo pipefail
cd "$(dirname "$0")"
VERSION="0.1.0"
OUT=../oauth3-extension-cws
ZIP=../oauth3-extension-v${VERSION}.zip

rm -rf "$OUT"; mkdir -p "$OUT"
git archive HEAD | tar -x -C "$OUT"

# strip everything that must not ship to CWS: injection, other build variants,
# tests, docs/listing scaffolding
rm -f "$OUT"/provider-inject.js "$OUT"/provider-bridge.js
rm -rf "$OUT"/test "$OUT"/docs "$OUT"/tasks
rm -f "$OUT"/make-*.sh "$OUT"/*.md

# the lean v0.1 manifest (ingest-only) — the sole source of truth is tasks/store-listing.md
cat > "$OUT/manifest.json" <<JSON
{
  "manifest_version": 3,
  "name": "OAuth3",
  "version": "${VERSION}",
  "description": "Your credential wallet for OAuth3. Apps you visit ask to read a site of yours; you approve once and they get a scoped, revocable token — never your cookies.",
  "permissions": ["cookies", "storage", "alarms", "activeTab"],
  "icons": { "16": "icons/icon-16.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" },
  "host_permissions": [
    "https://pod.dstack.soc1024.com/*",
    "http://localhost/*", "http://127.0.0.1/*"
  ],
  "optional_host_permissions": ["https://*/*"],
  "background": { "service_worker": "service-worker.js", "type": "module" },
  "action": { "default_popup": "popup.html", "default_title": "OAuth3" }
}
JSON

# sanity: no injection, right version, entry files present, no leftover injection refs
python3 - "$OUT/manifest.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
assert "content_scripts" not in m, "content_scripts must be absent for CWS"
assert m["version"]=="0.1.0", m["version"]
assert set(m["permissions"])=={"cookies","storage","alarms","activeTab"}, m["permissions"]
print("manifest ok:", m["permissions"])
PY
test -f "$OUT/service-worker.js" || { echo "service-worker.js missing"; exit 1; }
test -f "$OUT/popup.html" || { echo "popup.html missing"; exit 1; }
! grep -rq "provider-inject\|provider-bridge" "$OUT" || { echo "leftover injection reference"; exit 1; }

rm -f "$ZIP"
( cd "$OUT" && zip -X -rq "../$(basename "$ZIP")" . -x '.*' )
echo "built $ZIP"
( cd "$OUT" && find . -type f | sed 's|^\./||' | sort )
