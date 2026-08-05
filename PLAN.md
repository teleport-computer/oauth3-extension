# PLAN — issue #14: Jar sync + connect: surface account-qualified jars (picker)

Base: `staging`. Branch: `ready-14`. Tier: **2** (extension UI + flow) with a **Tier 1**
contract transcript (the extension speaks the account-qualified server contract).

## Acceptance (from issue #14 `## Acceptance`)
1. After a cookie sync, the UI shows which account the jar was stored under, read from the
   `account` the sync (`POST /api/cookies`) response now returns.
2. A 409-with-accounts from the connect flow renders a picker, and re-submitting with `account`
   set completes the connect.
3. Plugin status lists the `jars: [{account, updatedAt, count}]` array from `GET /api/plugins`
   instead of one present/absent badge.

## Already on staging?
- [x] CHECKED: none of the three are implemented on `origin/staging`.
  - `syncOne` ignores the sync response `account`; `jars[plugin]` has no account field. (AC1 ✗)
  - `providerConnect` throws on any non-OK approve; no 409/picker. (AC2 ✗)
  - popup `loadPlugins` is anonymous (server returns `jars: []` for anon) and renders one
    present/absent badge from local storage. (AC3 ✗)
  → Do the whole issue.

## Server contract (verified from oauth3-server `origin/staging` source + local boot)
- `POST /api/cookies` → `{ ok, plugin, account, count }` (account derived from jar, e.g. twid).
- `GET /api/plugins` (authed) → `plugins[].jars: [{account, updatedAt, count}]`; anon → `[]`.
- `POST /api/connect` accepts `body.account`; approve (`POST /api/connect/:id/approve`) 409s
  with `{ accounts: [...] }` when the approver holds >1 jars for the plugin and none named.
  Re-POST `/api/connect` with `account` set, then approve, succeeds.

## Build
- [ ] `service-worker.js`
  - `syncOne`: parse `/api/cookies` JSON, capture `account`, store on `jars[plugin]`, return it.
  - `providerConnect`: forward `opts.account` into `POST /api/connect`; on approve 409 with
    `accounts`, return `{ needAccount: true, accounts, plugin }` (don't throw).
- [ ] `popup.js`
  - `loadPlugins`: send wallet bearer (session/secret) so `jars[]` is populated.
  - `render`: list per-account jars from `PLUGINS[id].jars` (server authority) instead of one
    badge.
  - sync/add handlers: status line names the account; reload plugins after sync.
- [ ] `popup.html`: CSS for per-account pill rows (token-based).
- [ ] `provider-bridge.js`: `accountPicker(plugin, accounts)` dialog; on `needAccount`, show it
  and re-send `provider-connect` with `account` set.

## Verify
- [ ] `node --check` every changed `.js`.
- [ ] Local boot of oauth3-server (staging oauth3 node is 500ing — infra, not this issue): sync
  two twitter-shaped jars, capture: sync `account`, `/api/plugins` `jars[]`, connect→approve 409,
  re-connect with account → token. (Tier 1 contract transcript.)
- [ ] Bridge render of popup with real `jars[]` (harness stubs `chrome.storage` with the live
  server response) + the account picker. (Tier 2 UI render.)

## Ship
- [ ] commit + push `ready-14` → PR to `staging`.
- [ ] swap `ready` → `in-review` on issue #14.
