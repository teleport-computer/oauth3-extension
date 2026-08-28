# PLAN — #15 [extension] rate-limit cookie-change auto-sync

Issue: teleport-computer/oauth3-extension#15 (base `staging`). Checkboxes derived from
the issue's `## Acceptance`.

## Already on staging?
- [x] CHECKED: not implemented on `origin/staging` @ `5aa14d2` — the `cookies.onChanged`
  listener debounces 1s and calls `syncOne` bare; `syncOne` POSTs unconditionally (no
  cooldown, no digest, no `auto` flag anywhere in `service-worker.js`). → Do the whole issue.

## Design (what gates what)
- Cookie-triggered syncs only (`syncOne(..., { auto: true })`) pass two gates; every
  other caller (popup per-jar Sync, `sync-now`, `add-jar`, the 30-min alarm via
  `syncAll`) is an explicit act / fixed cadence and is never rate-limited.
- Debounce 1s → 30s (`COOKIE_DEBOUNCE_MS`).
- Cooldown 15 min (`COOKIE_COOLDOWN_MS`) keyed on the plugin's `lastSync` (any trigger) —
  half the 30-min alarm so a genuine change lands within 15 min worst-case.
- Digest: SHA-256 of sorted (name,value) pairs, recorded on successful POST only;
  identical jar past the cooldown → skip. Failure leaves the digest unset so the next
  attempt re-POSTs rather than trusting a jar the node may not hold.

## Checkboxes (from ## Acceptance)
- [x] 10 min of cookie churn → at most one cookie-triggered sync (verified: churn within
  cooldown adds no entry; base build shows the burst — count 2 after ONE rewrite).
- [x] Byte-identical jar (rotation that nets out) → no POST, no activity entry; the
  count stops oscillating.
- [x] 30-min alarm cadence untouched (`syncAll` ungated); manual popup Sync immediate
  (verified end-to-end: 2→3 manual, 3→4 alarm-fired).
- [x] e2e spec `test/autosync.spec.ts` drives the real extension + real server + real
  dashboard activity view; green on branch, red on base (mutation check).
- [x] Evidence: `.evidence/issue-15/` (popup + activity-view shots + flow.md).

## Operator-run remainder
- The literal logged-in-google.com 10-minute walk on staging (no Google identity on
  this box; Google de-auths datacenter-IP sessions). Recorded in flow.md and the PR.
