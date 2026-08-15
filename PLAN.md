# PLAN — #29 [extension] Per-site activation (inject the provider only on approved sites)

Issue: teleport-computer/oauth3-server#29 (code lives here, `oauth3-extension`).
Checkboxes derived from the issue's `## Acceptance`.

## Already on staging?
- [x] CHECKED: not implemented on `origin/staging` — `manifest.json` still carries both
  static `<all_urls>` content_scripts; no `approvedOrigins`, no
  `chrome.scripting.registerContentScripts`, no popup site-approve anywhere
  (`grep` across the repo). The vendored rig copy (`oauth3-apps/oauth3-extension`)
  is the same. → Do the whole issue.

## Design
- Drop the static `<all_urls>` `content_scripts`; register `provider-inject.js`
  (MAIN world) + `provider-bridge.js` (ISOLATED) dynamically per approved origin via
  `chrome.scripting.registerContentScripts` (`persistAcrossSessions: true`).
- `approvedOrigins` list in `chrome.storage.local` + a per-origin host grant from
  `chrome.permissions.request` (optional_host_permissions) — both restart-durable.
- Popup "Use OAuth3 here" adds the active tab's origin (activeTab gesture); revoke
  unregisters + drops the host permission.
- The instance's own origin (serverUrl + DEFAULT_HOMESERVER) is auto-approved —
  registered on install/startup/serverUrl-change so sign-in doesn't regress.

## Checkboxes (from ## Acceptance)
- [ ] On an un-approved site, `typeof window.oauth3 === "undefined"`.
- [ ] "Use OAuth3 here" in the popup → reload → `window.oauth3` object, `connect()` completes; origin survives browser restart.
- [ ] Revoke in popup → reload → `undefined` again; host permission dropped.
- [ ] Instance's own origin (login/dashboard) gets the provider with no manual approve.

## Steps
- [x] manifest: drop static content_scripts; add `scripting` + `activeTab`; optional host perms http+https.
- [x] service-worker: per-origin register/unregister/sync + `site-info`/`approve-site`/`revoke-site` handlers.
- [x] popup: site card (origin, state, Use/Stop buttons, permission line) + Advanced save asks for a custom instance origin's grant.
- [x] `node --check` all JS; manifest JSON valid; `make-staging.sh` builds.
- [ ] Tier 2 walk on the envoy/neko rig (branch build loaded in the shared Brave), screenshots → `.evidence/issue-29/`.
