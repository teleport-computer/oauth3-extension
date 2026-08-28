# #15 — rate-limit cookie-change auto-sync — flow evidence

**Tier 2 (extension-mediated).** Driven through the repo's e2e rig (`test/`): a real
Chromium (`--headless=new`) with this branch's unpacked MV3 extension loaded, a real
oauth3-server (docker-compose, `~/projects/oauth3-server` @ `6f186f1`), and the node's
real `/dashboard` activity view — the exact observable the acceptance names. Every
`POST /api/cookies` appends a `cookies.sync` entry to that activity feed, so the
assertions count entries via `GET /api/audit` (the feed's backing API).

New spec: `test/autosync.spec.ts` (`docker compose -f docker-compose.yml up` → e2e service).

## Acceptance vs. what was verified

1. **"Cookie churn → at most one sync, not a burst"** — verified at the mechanism level.
   The spec rewrites the jar's `.otter.ai` cookie the way Google rewrites `.google.com`
   cookies (an in-place `chrome.cookies.set` overwrite fires `cookies.onChanged` with
   cause `overwrite`). With the cooldown gate: one rewrite 5s after the add-jar sync,
   waited 38s (past the 30s debounce so the attempt genuinely fires and is *skipped*,
   not merely starved) → activity entries stayed at **1**. On base `origin/staging`
   (mutation check, same spec, extension mounted from a pristine staging worktree):
   the same single rewrite produced a **second** `cookies.sync` entry (expected 1,
   received 2) — the burst the issue reports, reproduced and then gone.
2. **"Byte-identical jar → no POST"** — verified: lastSync backdated past the cooldown,
   cookie rewritten `A→B` then back `B→A` (burst of change events, net-identical jar)
   → after the debounce, **no** POST, no new activity entry. Control: a *genuine*
   value change past the cooldown still POSTs (count 1→2) — the gates rate-limit
   churn, they don't break auto-sync.
3. **"30-min alarm unaffected; manual Sync immediate"** — the per-jar Sync click on the
   popup row POSTs immediately (2→3) even though the plugin had synced seconds earlier
   with an unchanged jar; firing the `resync` alarm handler once (`chrome.alarms.create`
   with `when`) POSTs too (3→4). Explicit acts are never rate-limited.

## Shots

- `01-popup-jar-row.png` — the extension popup: otter jar row (green, `2 · …s ago`),
  "Sync all now" button. Asserted before capture: `.jar[data-plugin="otter"]` visible,
  instance reachable.
- `02-dashboard-activity-view.png` — the node's dashboard Activity feed for the wallet
  subject: **4** `cookies.sync otter` entries total — 1 add-jar, 1 genuine-change
  auto-sync, 1 manual Sync, 1 alarm — and **zero** from the churn phases. Asserted
  before capture: `#acts .act` with text `cookies.sync` has count exactly 4.

## Not exercised here (operator-run)

The literal 10-minute logged-in-`google.com` walk on the staging node. No Google
identity exists on this box, and Google de-auths sessions replayed from a datacenter
IP (worker-corpus: `shared_egress_live_2026_07_03`), so the churn source in this rig
is an otter.ai cookie rewritten through the same `cookies.onChanged` → debounce →
`syncOne` path Google exercises — the code path is identical; only the churning site
differs. To close the loop on live staging: load this build, add the `google-calendar`
jar, sign in to Google in the rig browser, watch the activity view for 10 minutes.

## Run log (branch: the PR branch tip; base: `origin/staging` @ `5aa14d2`)

```
✓ 1 autosync.spec.ts:72:1 › #15: cookie churn stops flooding the activity view;
   explicit syncs are never rate-limited (1.8m) — 1 passed
```
Base `origin/staging` @ `5aa14d2`, same spec:
```
✘ expect(...).toBe(1) — Expected: 1, Received: 2   (line 103, cooldown phase)
```
