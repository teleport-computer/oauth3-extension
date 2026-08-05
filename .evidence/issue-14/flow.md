# Flow evidence — issue #14 (account-qualified jars)

Acceptance (from the issue's `## Acceptance`) and how each is now verified, with PNGs.

## How captured (the prior `needs-e2e` blocker is resolved)
The blocker was that the envoy bridge `screenshot` tool produced black frames. It no
longer does — `POST :3000/api/bridge {tool:"screenshot"}` returns a faithful non-black PNG
(verified on an example.com control: mean RGB ≈ 237 = its white background; full range
0–255 = real content). The extension **popup is browser chrome**, which
`chrome.tabs.captureVisibleTab` cannot grab, so the rig renders the **unmodified shipped
popup.js** at its shipped 320px width (harness.html) inside the real Brave on the neko
desktop and screenshots that tab. The picker is a page overlay, captured the same way.
Every PNG is `test -s`'d and its content asserted by a live DOM evaluate (LESSONS: "does
this image show the caption's claim?").

## AC1 — after a cookie sync the UI shows which account the jar was stored under
**Tier 1 (deployed staging):** `POST /api/cookies` returns `account` — twitter
`twid=u%3D111` → `{"account":"111","count":3}`, a second jar `twid=u%3D222` →
`{"account":"222"}` (a second jar, not an overwrite). See `contract-transcript.md`. ✓

## AC3 — plugin status lists the `jars: [{account,updatedAt,count}]` array
**Tier 1 (deployed staging):** `GET /api/plugins` (authed) returns twitter
`jars:[{account:"111",…},{account:"222",…}]` and amazon `jars:[{account:"default",…}]`.
See `contract-transcript.md` + `plugins-response.json`. ✓

**Tier 2 (visual):** `01-popup.png` — the shipped `popup.js` reading that **live** staging
response renders **one pill per account** (not the old single present/absent badge):
`Twitter / X timeline …  111 · 3 · Xm ago   222 · 3 · Xm ago` and
`Amazon (cart) … default · 2 · Xm ago`. Instance line reads "instance reachable —
<staging host>" (live). Live DOM pills: `["111 · 3 · 7m ago","222 · 3 · 7m ago",
"default · 2 · 7m ago"]` → `popup-rendered-dom.txt`. (`01-popup-full.png` = uncropped
1920×947 capture; the crop is for legibility.) ✓

## AC2 — a 409-with-accounts renders a picker; re-submitting with `account` completes connect
**Tier 1 (server):** connect-no-account → approve **409 `{accounts:["111","222"]}`**;
re-connect `account:"222"` → approve **200** → token. See `contract-transcript.md` (the
409 is reproduced on a local boot of the staging commit because the deployed staging app
gate lists no twitter-allowed app and twitter is the only multi-account-capable plugin —
documented there; the accounts are the real staging twitter jars). ✓

**Tier 2 (visual):** `02-picker.png` — the shipped `provider-bridge.js`
`accountPicker("twitter",["111","222"])` renders "Choose an account" /
"Which twitter account should this app use?" with buttons `[111, 222]` + Cancel. The
picker **resolves** on click: clicking `222` returns `"222"` and closes the dialog
(`picker-rendered-dom.txt`). (`02-picker-full.png` = uncropped capture.) ✓

## Provenance / faithfulness notes
- The popup and picker screenshots are produced by the **verbatim PR #20** `popup.js` and
  `provider-bridge.js` (inlined into `harness.html` / `pb-harness.html`, committed). The
  only stubs are `chrome.*` (a web page is not the extension context); `popup.js` fetches
  `/api/plugins` **live** from deployed staging (no fixture — staging allows the
  Authorization header cross-origin). The wallet Bearer and the live `session` are
  redacted from the committed harness (real credential → public repo).
- `test -s` on both PNGs; both non-black (popup mean RGB ≈ (218,230,229) = the teal-tinted
  popup; picker mean ≈ (197,196,196) = the `.4` overlay over the page with the white card).
- `/_api/version` pinned: `{"service":"oauth3-server","commit":"dev"}`.

## What I could NOT verify (honest)
- The **toolbar popup chrome itself** (the 320px panel dropped from the browser toolbar)
  is not captured as a standalone image — it is browser chrome, not capturable by
  `captureVisibleTab`, and driving a real click on the toolbar icon to open it + scrot was
  not needed because the shipped `popup.js` rendered against live staging already proves
  the render (the harness uses the exact popup.html DOM/styles at 320px width). If a
  shot of the actual toolbar panel is wanted, it needs the real extension loaded with
  storage configured (serverUrl+session) and a scrot of the neko desktop with the popup
  open — an operator step, not a code defect.
- AC2's server 409 is shown via a local boot of the staging commit, not the deployed node,
  for the app-gate reason above. The accounts are the real staging twitter jars.
