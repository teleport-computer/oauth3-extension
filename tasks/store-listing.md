# Chrome Web Store listing — OAuth3 v0.1.0

> Submission-ready copy and checklist. Bring this to the Developer Dashboard at
> https://chrome.google.com/webstore/devconsole.
> Modeled on the OpenFeedling listing (`openfeedling/tasks/store-listing.md`), which
> cleared review with the same cookie-reading + BYO-server risk profile.

## Scope decision (read first)

**v0.1 ships the ingest core only** — `cookies + storage + alarms + activeTab`. This
is the necessary-and-sufficient set for the extension's job: read a site's cookie jar
and sync it to your OAuth3 instance, which then hands apps a **scoped, revocable
token** (the app never touches your cookies).

Deliberately **not** in v0.1:
- **`content_scripts` / `window.oauth3` provider injection** — the "any page can call
  `window.oauth3.connect()`" DX. It's the *consume* side and is extension-optional
  (RFC 0008: the SDK works without it). It's also the single highest-scrutiny CWS
  surface (MAIN-world injection into `<all_urls>`). Deferred to **v0.2** (see roadmap).
- **Hardcoded site hosts** (reddit/otter/youtube/google/nytimes) — already redundant:
  `addJar()` requests each site's host permission at the user's click
  (`popup.js:69`, `chrome.permissions.request`). They move to runtime grants.

The default instance is **`https://pod.dstack.soc1024.com/oauth3`**, built in and
user-overridable under Advanced — the matrix.org model (a good default homeserver you
can point away from).

## Pre-submission checklist

- [ ] Apply the manifest changes below (`extension/manifest.json` → lean v0.1 profile)
- [ ] Privacy policy is live at `https://teleport-computer.github.io/oauth3-extension/privacy.html`
      (enable GitHub Pages on the repo, `docs/` → `privacy.html`; source in `docs/privacy.md`)
- [ ] Tagged release on GitHub matching the version in `manifest.json` (v0.1.0)
- [ ] Screenshots captured (see "Screenshots")
- [ ] `oauth3-extension-v0.1.0.zip` built (see "Submission packaging")
- [ ] Developer account 2FA + one-time $5 registration fee cleared

## Manifest changes required (current → lean v0.1)

Current shipped `manifest.json` carries provider injection, `tabs`, and a static site
list. Replace with:

```json
{
  "manifest_version": 3,
  "name": "OAuth3",
  "version": "0.1.0",
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
```

Deltas and why:
- **`tabs` → `activeTab`.** `popup.js:172` only reads the *current* tab's URL (to offer
  "add a jar for this site"). `activeTab` grants that on the popup-open gesture without
  the broad, review-flagged `tabs` permission. `chrome.tabs.create()` for the dashboard
  needs no permission at all. *(If review shows the active tab's URL coming back empty,
  fall back to `tabs` with the justification below.)*
- **Remove `content_scripts`.** Drops `provider-inject.js` + `provider-bridge.js`. Only
  affects third-party-page `window.oauth3`; the extension popup, dashboard, and ingest
  are untouched. Re-added in v0.2.
- **`host_permissions`: replace the site list + `*.phala.network` with the default
  instance host.** The default instance is `pod.dstack.soc1024.com` (not
  `*.phala.network` — the current manifest has a stale host that doesn't match
  `DEFAULT_HOMESERVER`). Sites are requested at runtime; only the built-in default
  instance is pre-granted so it works out of the box.
- **Keep `optional_host_permissions: ["https://*/*"]`** — covers both (a) each site the
  user adds a jar for and (b) a custom instance URL the user types under Advanced. Both
  granted at runtime via `chrome.permissions.request`, only for the specific origin.

## Listing fields

### Name (≤ 45 chars)
```
OAuth3
```

### Summary / short description (≤ 132 chars)
```
Your credential wallet. Approve once; apps read your data via a scoped, revocable token — never your raw cookies.
```

### Detailed description

```
OAuth3 is a credential wallet for the web. When an app wants to act on data of yours — your Otter transcripts, your Reddit saves, your YouTube history — it normally asks for your password or scrapes your cookies. OAuth3 replaces that with a single approval that hands the app a scoped, revocable token instead. The app never sees your cookies.

HOW IT WORKS

You run (or point at) an OAuth3 instance — a server that holds your cookie jars and mints tokens. This extension is the courier: for each site you choose, it reads that site's cookies from your own browser and syncs them to your instance. Your instance then answers apps' requests with a token scoped to exactly what you approved, which you can revoke at any time.

Open the popup, and each site you've added shows as a row with a freshness dot — green (fresh), amber (stale), red (error). Adding a site asks your browser, at that moment, for permission to read only that site's cookies. Nothing is read until you approve it.

A DEFAULT INSTANCE, OR YOUR OWN

Out of the box the extension points at a default instance (pod.dstack.soc1024.com/oauth3), the way a Matrix client defaults to matrix.org — a sensible home you can change. The default instance runs inside a Trusted Execution Environment (TEE); its code identity is remotely attestable, so you can verify what it does with your cookies rather than trust a promise. Under Advanced, point the extension at any instance you run or trust; the extension asks for permission for that URL at the moment you enter it.

WHAT IT READS, AND WHERE IT GOES

Only the cookies for the specific sites you add, and only ever sent to the one instance URL you've configured. No analytics, no central account, no third-party sharing. Cookies re-sync on relevant changes (debounced) and every 30 minutes so your instance's jars stay fresh for always-on use.

OPEN SOURCE

Full source at https://github.com/teleport-computer/oauth3-extension. Tagged releases match the version distributed here.

PRIVACY POLICY

https://teleport-computer.github.io/oauth3-extension/privacy.html
```

### Category
- Primary: **Productivity**
- (Alternate if rejected from Productivity: **Developer Tools**)

### Language
English

## Single-purpose statement

```
Read the user's own site cookies (only for sites the user explicitly adds, granted at runtime) and sync them to an OAuth3 instance the user configures, so that instance can mint scoped, revocable tokens for apps — replacing password sharing and raw-cookie scraping with a single revocable approval.
```

## Permission justifications

Paste each into the corresponding field in the "Privacy practices" tab of the
Developer Dashboard.

### `cookies` permission
```
The extension reads the user's own session cookies for sites the user explicitly adds (e.g. reddit.com, otter.ai). It reads them only after the user grants that specific site's host permission at click time, and sends them only to the single OAuth3 instance URL the user has configured (default: the user's chosen instance). No cookies are stored by the extension itself or transmitted to any other destination. The purpose is to let the user's own instance authenticate to those sites on the user's behalf and issue scoped tokens to apps — the app never receives the cookies.
```

### `storage` permission
```
Stores via chrome.storage.local: the list of sites the user has added and each jar's freshness status, the configured instance URL, and the owner secret the user pastes to authenticate uploads to their instance. No browsing history, identifiers, or analytics.
```

### `alarms` permission
```
Schedules a 30-minute alarm to re-sync the added sites' cookies to the user's configured instance, so the instance's session stays fresh for always-on polling even while the popup is closed.
```

### `activeTab` permission
```
When the user opens the popup, the extension reads the URL of the currently active tab only, to offer a one-click "add a jar for this site" shortcut for the site the user is looking at. No other tabs are accessed and no tab access persists beyond the popup interaction.
```

### Host permission `https://pod.dstack.soc1024.com/*`
```
This is the extension's built-in default OAuth3 instance (analogous to a Matrix client's default homeserver). The extension calls GET /api/plugins and POST /api/cookies on this host to learn which cookies a site needs and to upload the user's jar. Pre-granting only this one default host lets the extension work out of the box; users who point at their own instance grant that origin at runtime.
```

### Optional host permission `https://*/*`
```
Granted at runtime via chrome.permissions.request(), only ever for a specific origin the user chose: (1) when the user adds a site, the extension requests that site's origin so it can read that site's cookies; (2) when the user enters a custom instance URL under Advanced, the extension requests that one origin so it can sync to it. The extension never accesses any origin the user has not explicitly added or configured.
```

## Data handling form (Privacy practices tab)

For each category, the answer is **NO** unless noted:

- Personally identifiable information: NO
- Health information: NO
- Financial and payment information: NO
- Authentication information: **YES** — "Session cookies for sites the user explicitly adds, read by the extension and transmitted only to the OAuth3 instance URL the user configured, so that instance can mint scoped tokens on the user's behalf."
- Personal communications: NO
- Location: NO
- Web history: NO
- User activity: NO
- Website content: NO

**Limited Use disclosures (check all):**
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

## Visibility / distribution

For team/early preview: **Unlisted**.
- Anyone with the install URL can install; not searchable in the store
- Real one-click store-install UX (no "developer mode" warning)
- Flip to Public once v0.1 is broadly tested

## Screenshots needed

At least 1 required, up to 5 allowed. Recommended size: **1280×800**. Save as PNG into
`docs/screenshots/`:

1. **`screenshot-1-popup.png`** — popup with the instance-reachable pill green and two
   jar rows populated (e.g. Otter green/fresh, Reddit amber/stale), plus the "+ Add"
   control.
2. **`screenshot-2-add-jar.png`** — the Chrome "OAuth3 wants to read reddit.com" host
   permission prompt mid-add — shows permission is per-site and user-initiated.
3. **`screenshot-3-advanced.png`** — Advanced panel showing the instance URL field with
   the default `pod.dstack.soc1024.com/oauth3` and the override affordance.
4. **`screenshot-4-token.png`** — an app showing it holds a *scoped, revocable* OAuth3
   token (the value prop: app has a token, not your cookies). *(Optional.)*
5. **`screenshot-5-attestation.png`** — the instance's attestation verifier page for the
   default instance, to back "you can verify what it does." *(Optional.)*

## Icon assets

Already at `extension/icons/icon-{16,48,128}.png` (circular anarchist-A). Web Store also
wants a **128×128 listing icon** separate from the in-extension icon — export
`docs/store-icon-128.png`.

## Submission packaging

```bash
cd extension
git ls-files | zip -X ../oauth3-extension-v0.1.0.zip -@
```

`git ls-files | zip -@` ships exactly what's tracked — no `.DS_Store`, editor temp
files, or `test-install` clones.

## Expected review back-and-forth

- **`cookies` + auth-cookie reading is the main flag.** Answer: the extension reads the
  user's own cookies for sites the user explicitly added, from inside the user's own
  browser, and forwards them only to the user's own configured instance — it is a
  courier, not a collector. Have a 30-second screencast of the popup + a per-site
  permission prompt ready.
- **`https://*/*` optional host permission.** Same story OpenFeedling used and cleared:
  runtime grant, only for the exact origin the user added or typed. Emphasize in the
  justification.
- **`activeTab` vs `tabs`.** Using `activeTab` should avoid the "why does it need all
  tabs" question entirely. If the active-tab URL comes back empty in testing, switch to
  `tabs` and paste: "reads only the active tab's URL to offer add-jar-for-this-site."
- Typical first-review turnaround: 1–3 business days; auth-cookie extensions sometimes
  take ~a week with one clarification round.

## v0.2 roadmap — provider injection (the deferred surface)

Re-add `content_scripts` (`provider-inject.js` MAIN world + `provider-bridge.js`) so a
third-party page can call `window.oauth3.connect()` / `.signIn()` and get a token via a
single in-page approval dialog. This is the highest-scrutiny CWS surface, so ship it as
its own version with its own justification once v0.1 is approved and stable — exactly how
OpenFeedling added push notifications in its v0.2. Justification to prepare:
```
content_scripts inject a small window.oauth3 provider into pages so a site the user is
on can request a scoped token. Every request shows a user approval dialog before any
data moves; signin is refused for any origin that is not the configured instance's own,
so a cross-site page cannot grab the user's session. No page content is read or
modified; the script only exposes the request/approve bridge.
```

## After approval

- [ ] Tag the repo at `v0.1.0` matching the published version, push the tag
- [ ] Add an "Available in the Chrome Web Store" badge to `README.md` (and fix the
      stale "no content scripts" line to match the shipped lean manifest)
- [ ] Add the listing URL to the OAuth3 install docs / extension page
- [ ] Note the unlisted install URL as the easiest install path in onboarding
