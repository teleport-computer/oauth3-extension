# Flow evidence — issue #14 (account-qualified jars)

Acceptance (from issue `## Acceptance`) and how each was verified.

## Tier 1 — API contract transcript (GREEN)
`contract-transcript.md` — driven against a LOCAL boot of `oauth3-server@origin/staging`
(the merged #111 contract, PR #113). The DEPLOYED staging oauth3 node was returning HTTP
500 on every endpoint (including `/api/health`) during this run, so a local boot at the same
commit was used; that's an infra outage, not this issue's scope.

- **AC1** — `POST /api/cookies` returns `account`: syncing `twid=u%3D111` →
  `{"ok":true,"plugin":"twitter","account":"111","count":3}`, and a second jar
  `twid=u%3D222` → `account:"222"` (a second jar, not an overwrite). ✓
- **AC3** — `GET /api/plugins` (authed) returns `jars: [{account,updatedAt,count}]`:
  twitter → `[{account:"111",...},{account:"222",...}]`, amazon →
  `[{account:"default",...}]`. Anonymous returns `[]` (so the popup MUST auth — see
  `loadPlugins` change). ✓
- **AC2** — the connect flow's 409-with-accounts + resolution: `POST /api/connect`
  (no account) → approve → **409 `{"accounts":["111","222"]}`**; re-`POST /api/connect`
  with `account:"222"` → approve → **200** → `{"status":"approved","token":"tok-…"}`. ✓

## Tier 2 — UI render (bridge-driven; PNG unavailable)
Driven through the envoy/neko bridge (`POST localhost:3000/api/bridge` — `flock`-serialized)
with the REAL, unmodified `popup.js` and `provider-bridge.js`. Because a plain browser page
is CORS-bound on the `Authorization` header (the extension page is not), the popup harness
intercepts `fetch("/api/plugins")` and returns the **real captured server response**
(`plugins-response.json`); the render logic itself is unchanged.

- **AC1/AC3 render** — `popup-rendered-dom.txt` (live evaluate of the rendered `#jars`):
  ```
  Twitter / X timeline (browser-path)  ✕   111 · 3 · 3m ago   222 · 3 · 3m ago
  Amazon (cart)                        ✕   default · 2 · 3m ago
  ```
  One pill **per account** the server holds (replaces the single present/absent badge),
  each showing `account · count · freshness`. ✓
- **AC2 picker render** — `picker-rendered-dom.txt`: `accountPicker("twitter",["111","222"])`
  renders `title:"Choose an account"`, `prompt:"Which twitter account should this app use?"`,
  buttons `["111","222"]` + Cancel; clicking `222` resolves the promise with `"222"` and
  closes the dialog. ✓

## What I could NOT verify
- **No PNG screenshots.** The envoy bridge `screenshot` tool was timing out on EVERY page
  (including a bare `popup.html`) during this run — `navigate` + `evaluate` worked, so the
  DOM captures above are live, but the visual capture could not be produced. The PR is marked
  `needs-e2e` for that reason; the render itself is demonstrated by the DOM captures.
- **No live-staging walk.** The deployed staging oauth3 node was 500ing (see above), so the
  contract transcript uses a local boot of the same server commit rather than the deployed
  URL. Re-pointing the extension at staging and re-walking once the node is healthy is the
  remaining operator step.

## Parse checks
`node --check` green on `service-worker.js`, `popup.js`, `provider-bridge.js`.
