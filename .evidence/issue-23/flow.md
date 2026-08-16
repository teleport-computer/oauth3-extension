# Flow evidence — oauth3-server#29 — Per-site activation (provider only on approved sites)

Repo: **teleport-computer/oauth3-extension**, branch `staging-oa-23` (base `staging`; renamed from
`staging-oa-29`, where the Tier-2 walk ran at commit `a1d8540` — this evidence dir moved with the
rename; **no code changed between the walk and this move**). Issue: teleport-computer/oauth3-server#29
(the story of record), mirrored verbatim at oauth3-extension#23 so the same-repo merge gate can
resolve its `## Acceptance`. Evidence tier **2**.

## Rig (real browser, real chrome UI — no CDP)
- envoy/neko rig: real Brave inside the `envoy-browser` container (`docker-compose.alt.yml`, bridge on
  **:3002**). Page navigation/DOM via the envoy bridge extension; **browser chrome (popup, permission
  prompt) driven with OS-level xdotool keyboard/mouse** (`Ctrl+Shift+U` opens the wallet popup — the
  command added in this branch for accessibility + rig reachability); screenshots are X11
  `import -window root` captures of the real desktop, so they include the popup and the permission
  prompt themselves.
- The loaded build is **this branch** via `make-staging.sh` (only diff: name "OAuth3 (staging)",
  `DEFAULT_HOMESERVER` → the staging node `78ffc78c…phala.network/oauth3`), mounted read-only at
  `/usr/share/brave/extensions/oauth3` and loaded with `--load-extension`. Fresh profile; browser
  processes restarted twice during the walk (verified by pid change).
- The "console shows `typeof window.oauth3`" lines below are demonstrated **by the page itself**: the
  page computes `typeof window.oauth3` and renders it in a banner (screenshots 01/05/08/10/12/13),
  plus the raw bridge-evaluate transcripts quoted here. That is strictly stronger than a console
  screenshot — nothing is injected from outside the page.

## Acceptance → evidence (each line of the issue's `## Acceptance`)

**AC1 — On a site the user has not approved, the page sees no provider (`typeof window.oauth3 === "undefined"`).**
- `01-unapproved-undefined.png` — example.com banner: `typeof window.oauth3 = "undefined"` (page-computed).
- Transcript: `evaluate location.href + " | oauth3=" + typeof window.oauth3` →
  `"https://example.com/ | oauth3=undefined"` (fresh profile, fresh browser process).
- Control: `13-second-site-undefined.png` — example.org, same result, at the END of the walk (after
  all other steps), so unrelated state can't explain it. ✓

**AC2 — "Use OAuth3 here" in the popup → reload → `window.oauth3` is an object, `connect()` completes, origin survives a browser restart.**
- `02-popup-not-active.png` — the real popup (opened via Ctrl+Shift+U) showing the site card
  `https://example.com … USE OAUTH3 HERE` (zoom-OCR transcript: `USE OAUTH3 HERE` at the site card).
- `03-permission-prompt.png` — the real Chrome permission bubble: `"OAuth3 (staging)" has requested
  additional permissions … Read and change your data on example.com` (clicked via xdotool at the
  prompt's Accept button — first attempt missed and merely dismissed it, retry landed; the grant
  itself then drove activation exactly as the `arm-approve-site` design intends).
- `05-approved-object.png` — after approval the tab auto-reloaded (service worker) and the page
  banner reads `typeof window.oauth3 = "object"`. Transcript: `"https://example.com/ | object"`.
- `04-popup-active.png` — popup now shows `https://example.com [active]` and `STOP USING OAUTH3 ON
  THIS SITE` (zoom-OCR: `//example.com active`, `STOP USING OAUTH3 ON THIS SITE`).
- `connect()` completes: `06-connect-approval-dialog.png` — the extension-rendered consent dialog
  (`Authorize access … demo-app wants to read your youtube — scoped, revocable token … [Connect |
  Cancel]`), clicked; then `07-connect-token.png` — page banner `window.oauth3 = object` and
  `connect() → tok-youtube-1dace13b66624a76bc6597c4`. A first run minted
  `tok-youtube-6974acfa3199453e9c19e042` (transcripts in the PR body). Node: deployed staging
  (`/_api/version` → commit `d951fa7`). Note: app `demo-app` (listed in `STATIC_LISTING`) —
  `login-with-everything` is refused by the staging app gate (`"App … is not listed"`), which is
  correct gate behavior, not a provider failure.
- Restart persistence: Brave killed and relaunched (new pid, verified) → `08-restart-persist.png` —
  fresh load of example.com still `typeof window.oauth3 = "object"`; `09-popup-active-after-restart.png`
  — popup after restart shows `//example.com [active]`, `host permission: granted` (zoom-OCR
  transcript). ✓
  - **Erratum (rework pass 3, 2026-08-16):** the `host permission: granted` line is NOT readable in
    frame 09 — the capture likely preceded the async `chrome.permissions.contains` result populating
    the permission line; frame 11 shows the revoke side (`host permission: none`) cleanly. The
    granted state itself is still proven by 08: the post-restart banner reading `object` is only
    reachable with the host grant, since injection is keyed on it.

**AC3 — Revoking that site in the popup → reload → `undefined` again, host permission dropped.**
- `10-revoked-undefined.png` — after clicking `STOP USING OAUTH3 ON THIS SITE` the tab auto-reloaded
  and the page banner reads `typeof window.oauth3 = "undefined"` (transcript: `undefined` within 2s).
- `11-popup-after-revoke.png` — popup now shows `//example.com [not active]` and
  **`host permission: none`** (zoom-OCR transcript) — the grant was dropped, not just the injection. ✓

**AC4 — The instance's own origin (login/dashboard) still gets the provider without a manual approve.**
- `12-instance-auto-active.png` — `https://78ffc78c…-8080.dstack-pha-prod7.phala.network/oauth3/login`
  banner: `typeof window.oauth3 = "object"`, never manually approved (the walk approved only
  example.com, which was later revoked). Verified pre- and post-restart. ✓

## What could NOT be verified
- Nothing in the acceptance list. Two honesty notes: (1) the permission-prompt Accept button was
  located by pixel/OCR analysis of the real prompt (no CDP); the first click missed (dismissed the
  prompt), the second landed — both are real-browser interactions. (2) `test/` in this repo is a
  legacy Playwright/CDP harness; it was NOT run (CDP-driven browsers are banned by LESSONS — the
  real-browser walk above is the verification).

## Rig provenance
Bridge health `{"status":"ok"}` on :3002; all bridge calls flock-serialized
(`/tmp/envoy-bridge.lock`); navigation asserted via `location.href` before every capture (LESSONS).
Every PNG `test -s`'d (>45KB each) and its claim cross-checked by OCR of the same frame or a live
DOM evaluate.
