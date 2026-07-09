# `window.oauth3` — page API for app developers

OAuth3 is a wallet model: an app you visit asks the user's browser wallet to read
a site of theirs, the user approves once, and the app gets a **scoped, revocable
token** — it never sees the raw cookies. The extension injects a MetaMask-style
provider at `window.oauth3`; this doc is the contract for pages that use it.

> **Consumer library.** If you're calling OAuth3 from a page or backend, prefer
> the [`oauth3-sdk`](https://github.com/teleport-computer/oauth3-sdk) client. Its
> `connect()` detects `window.oauth3` automatically and delegates to the wallet
> when present, falling back to the server-side approval URL otherwise. Use the
> raw provider below only if you're wiring it by hand.

## Detecting the wallet

```js
if (window.oauth3?.isOauth3Wallet) {
  // the OAuth3 extension is installed; the user has a wallet in this browser
}
```

`window.oauth3.isOauth3Wallet` is always `true` when the provider is present.
There is **no sign-in step** — see [Identity](#identity) below; the wallet
provisions itself the first time it's used.

## `connect(opts)` → `Promise<string>`

The single entry point. Asks the wallet to authorize your app to read one plugin
(a site the user has saved). It:

1. Shows a consent dialog (`#oauth3-approve`, see below) — the user's click is
   the gesture that authorizes the request.
2. If the user hasn't already, copies the site's cookie jar into their instance
   (so the token has something to read).
3. Connects + **approves** as the wallet owner and hands your page back a scoped
   token.

```js
const token = await window.oauth3.connect({
  plugin: "otter",   // required — the plugin id (e.g. "otter", "reddit")
  app: "my-otter",   // optional — your app id; bound into the minted token
  caps: ["otter:live-follow"], // optional — scope ingredients; gate the minted token
  node: undefined,   // optional — override the homeserver URL
  subject: undefined // optional — wallet subject passed through to /api/connect
});
// → "tok_…"  (a scoped, revocable read token for that plugin)
```

| opt | type | meaning |
|---|---|---|
| `plugin` | `string` *(required)* | Plugin id the token will be scoped to. Must be one the homeserver knows (`GET /api/plugins`). |
| `app` | `string?` | Your app id. Recorded against the token so the user can see *which app* has access and revoke just that one. |
| `node` | `string?` | Homeserver URL. Defaults to the wallet's configured instance (`serverUrl` in the popup, else the built-in default). |
| `subject` | `string?` | Wallet subject forwarded to `POST /api/connect`. Usually omitted — the wallet fills its own `u-<hash>` subject. |
| `caps` | `string[]?` | Scope **ingredients** to bind into the minted token, e.g. `["otter:live-follow"]`. Forwarded to `POST /api/connect` and threaded into the mint, so the homeserver's read-scope gate enforces them: a `live-follow` token may read `/live`+`/frame` but is rejected (`403 scope`) on `/items`. Omit for the plugin's default (full) read surface. When `caps` are passed the approval dialog leads with them so the user sees the actual requested scope, not a generic "read your `<plugin>`". |

**Returns:** a `Promise` that resolves to the token `string`.

**Rejects with `Error(message)`** in these cases — `message` is stable enough to
switch on, the token is never returned on rejection:

| `Error.message` | When |
|---|---|
| `"denied by user"` | The user clicked **Cancel** in the consent dialog (or closed it). |
| `"unknown plugin \"<id>\""` | `plugin` isn't registered on the homeserver. |
| `"cookie sync <status>"` | The jar upload to `/api/cookies` failed (HTTP status appended). |
| `"approve <status>: <body>"` | The `/api/connect/:id/approve` call failed (status + server body). |
| `"approval failed"` | The connect request ended in a non-`approved` state. |
| `"<other>"` | Relay/extension error (e.g. the service worker was reload mid-flight). |

Once you have the token, use it as a bearer against the homeserver's read API
(`GET /api/...` with `Authorization: Bearer <token>`), or hand it to the SDK:
`oauth3({ node, token })`. The token is **scoped** (one plugin) and
**revocable** (`DELETE /api/tokens/<token>` from the user's dashboard).

## The `#oauth3-approve` consent dialog

`connect()` is not resolvable without a user gesture — that gesture is the
consent click. The wallet renders a modal in the page, attached as a shadow-DOM
child of a host element with `id="oauth3-approve"`:

```html
<div id="oauth3-approve">
  #shadow-root (open)
    ┌─────────────────────────────────────────┐
    │ Authorize access                         │
    │ <app> wants to read your <plugin>        │
    │ — with a scoped, revocable token,        │
    │   never your cookies.                    │
    │            [ Connect ]   [ Cancel ]      │
    └─────────────────────────────────────────┘
</div>
```

- `app` defaults to `"An app"` if you didn't pass one — **pass `app`** so the
  user can tell what they're approving.
- It's a real `<div>` in the page (`document.querySelector('#oauth3-approve')`
  exists while the dialog is up) but the card styles are isolated in its shadow
  root, so it can't clash with your page's CSS.
- z-index is `2147483647` so it sits over everything. There is exactly one dialog
  per `connect()` call; it removes itself on either button.

When you pass `caps`, the dialog leads with the requested ingredient and drops
the generic "read your `<plugin>`" copy:

```text
┌─────────────────────────────────────────────┐
│ Authorize access                              │
│ <app> wants a scoped, revocable token for     │
│ <plugin>, limited to:                          │
│ • <cap>                                         │
│ Never your cookies.                            │
│              [ Connect ]   [ Cancel ]          │
└─────────────────────────────────────────────┘
```

The cap identifier (e.g. `otter:live-follow`) is shown as-is: the homeserver
holds the human-readable ingredient labels (returned in a gated read's `403
scope` field) and exposes no pre-approval catalogue endpoint, so the extension
shows the actual scope you requested rather than a prose it would have to guess.
A server-side `GET /api/caps/:plugin` is the remaining piece to mirror the prose
label without client-side drift.

You don't drive this dialog from your page — just `await connect()`. If you need
to know it's showing (e.g. to pause a tour), check for the `#oauth3-approve`
element.

## Identity

There is **no `signIn()`**. The wallet identity is the browser itself:

- The extension mints a random `userKey` on first use and logs it in once
  (`POST /api/login`), getting back a `u-<sha256(userKey)>` subject and a session
  it caches and reuses. So the same browser is the same `u-<hash>` account every
  time — no password, no passkey prompt, no `signIn({node})` to call.
- `connect()` is therefore also the *first* thing that can establish the wallet
  session against a given `node`; if you pass a `node`, the wallet will provision
  a session **on that node** as part of handling the call (one-time, then cached).
- This is why the provider surface is just `{ isOauth3Wallet, connect }`. If you
  need the user's subject (e.g. to key your own records), read it from the token's
  claims server-side, or have the user paste it from the popup — the extension
  does not expose the subject to the page directly.

## Minimal example

```js
// 1. prefer the SDK, which auto-uses this provider when present:
import { oauth3 } from "oauth3-sdk";
const oa = oauth3({ node: "https://…/oauth3" });
await oa.connect({ plugin: "otter", app: "my-otter" }); // delegates to window.oauth3
const items = await oa.list("otter");

// 2. or, raw — talk to the provider directly:
if (!window.oauth3?.isOauth3Wallet) {
  throw new Error("install the OAuth3 extension to connect your sites");
}
const token = await window.oauth3.connect({ plugin: "otter", app: "my-otter" });
// token is a scoped, revocable bearer against the homeserver's read API.
```

## Reference: the relay

For completeness, the on-page wiring the extension installs (you don't need this
to use it — it's what makes the above work):

- `provider-inject.js` (MAIN world, `document_start`) — defines `window.oauth3`
  with `connect()` that `postMessage`s a request and awaits a matching reply.
- `provider-bridge.js` (ISOLATED world, `document_start`) — receives that
  request, shows the `#oauth3-approve` dialog, then asks the service worker to
  copy the jar + connect + approve, and relays the token (or error) back.
- `service-worker.js` `providerConnect()` — the actual work against
  `/api/plugins`, `/api/cookies`, `/api/connect`, `/api/connect/:id/approve`.

So a `connect()` round-trip is: **page → MAIN-world provider → ISOLATED-world
bridge → consent dialog → service worker → homeserver → token back the same
chain.** The cookie jar never reaches your page — only the token does.
