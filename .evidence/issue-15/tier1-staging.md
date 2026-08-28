# Tier 1 — HTTP transcript against deployed staging (issue #15, PR #25)

Run 2026-08-28 (UTC). Commands and responses verbatim; the throwaway wallet's
userKey/session values are masked.

## Pins — both sides of the HTTP conversation

```
$ git -C <rig checkout> rev-parse HEAD
b5291db5214d7a5d63588de821bebd3a48622182
#   extension build loaded into Chromium (EXT_PATH) — this PR's branch ready-15

$ curl -sS https://78ffc78c25e0c8a9e64bb3a969ba6f226abae62d-8080.dstack-pha-prod7.phala.network/oauth3/_api/version
{"service":"oauth3-server","commit":"159a02d"}
#   deployed oauth3-server the flow ran against (this PR changes the extension,
#   so the server pin names the counterpart build, not b5291db)
```

## The PR's own verification re-run against deployed staging

```
$ cd test && SERVER_URL=https://78ffc78c25e0c8a9e64bb3a969ba6f226abae62d-8080.dstack-pha-prod7.phala.network/oauth3 EXT_PATH=<rig checkout> ./node_modules/.bin/playwright test autosync.spec.ts

Running 1 test using 1 worker

  ✓  1 autosync.spec.ts:72:1 › #15: cookie churn stops flooding the activity view; explicit syncs are never rate-limited (1.9m)

  1 passed (1.9m)
```

Every phase asserts the live `GET /api/audit` count on staging (Bearer = the wallet the
extension itself minted on staging): add-jar → **1**; cookie churn within the 15-min
cooldown (waited past the 30s debounce so the attempt really fired) → still **1**;
byte-identical jar past cooldown (cookie rewritten then rewritten back) → still **1**;
genuine change past cooldown → **2**; manual popup Sync seconds later → **3**; resync
alarm fired once → **4**; zero popup pageerrors.

## Raw HTTP — the exact POST the #15 gates rate-limit (throwaway wallet)

```
$ curl -sS -X POST https://78ffc78c25e0c8a9e64bb3a969ba6f226abae62d-8080.dstack-pha-prod7.phala.network/oauth3/api/login -H 'Content-Type: application/json' -d '{"userKey":"<masked, 48-hex throwaway>"}'
{"ok":true,"subject":"u-d5ebb06f202f46c0d81e8fd8da1fd935","session":"<masked>"}

$ curl -sS -X POST https://78ffc78c25e0c8a9e64bb3a969ba6f226abae62d-8080.dstack-pha-prod7.phala.network/oauth3/api/cookies -H 'Authorization: Bearer sess-…' -H 'Content-Type: application/json' \
    -d '{\"plugin\":\"otter\",\"cookies\":{\"sessionid\":\"tier1-transcript\",\"csrftoken\":\"tier1-transcript\"}}'
{"ok":true,"plugin":"otter","account":"default","count":2}

$ curl -sS https://78ffc78c25e0c8a9e64bb3a969ba6f226abae62d-8080.dstack-pha-prod7.phala.network/oauth3/api/audit -H 'Authorization: Bearer sess-…'
{"audit":[{"ts":1787875172983,"action":"cookies.sync","detail":{"subject":"u-d5ebb06f202f46c0d81e8fd8da1fd935","plugin":"otter","account":"default","count":2}}]}
```

One POST → one `cookies.sync` audit entry (the dashboard Activity feed's backing API).
The churn suppression itself is client-side — the extension's cooldown + digest gates
decide whether this POST fires at all. That is what the spec run above proves: the
rewrite bursts in both skip phases left the count at 1; only the genuine change, the
manual sync, and the alarm produced entries 2–4.

## Dashboard rendering note

Staging commit 159a02d collapses a run of consecutive identical entries into one
"×N" row (oauth3-server #120, not yet in the local rig's server checkout). The spec's
final dashboard step asserted N rows — the *server's* rendering policy — so the first
staging run failed there (1 run row, ×4) while every audit-count assertion passed.
That step now asserts the activity renders; the trail's counts live in /api/audit.
