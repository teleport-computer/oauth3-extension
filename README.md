# oauth3-extension

The **ingest** client for [OAuth3](https://teleport.computer). A thin cookie-jar
courier: it reads your cookie jar for a site and syncs it into an OAuth3 instance
you trust (a TEE). Apps then read your data through that instance with a **scoped,
revocable token** — they never touch the raw jar.

It does one thing. No content scripts that scrape pages, no dashboards of its own
— just `cookies` + `storage` + `alarms`. (The heavier, deployment-specific
`oauth3-extension-1` is legacy and stays private.)

> **App developers** — if you're building a page that wants to *read* a user's
> site through OAuth3, skip to **[`docs/APP_API.md`](docs/APP_API.md)** (the
> `window.oauth3` provider). This README is for the person installing/running the
> extension.

---

## Install

### Prod (load unpacked)

1. `chrome://extensions` → toggle **Developer mode** (top-right).
2. **Load unpacked** → select this folder.
3. Open the popup (toolbar icon). The top row tells you whether the instance is
   reachable. No sign-in — your browser is your identity (see
   [Identity model](#identity-model)).
4. **Add a jar** for each site you want kept fresh (Otter, Reddit, …). Each
   appears as a row with a freshness dot: 🟢 fresh / 🟡 stale / 🔴 error. Chrome
   will prompt for host permission to read that site's cookies — that's the only
   permission beyond the initial three.

After a jar is added it **auto-syncs**: on relevant cookie changes (debounced
~1 s) and every 30 minutes (alarm), so the instance's jar stays fresh for
always-on polling. **Sync all now** forces a one-off sync of every jar.

### Staging (alongside prod)

`make-staging.sh` builds a sibling `../oauth3-extension-staging` pointed at a
staging homeserver. It is renamed **OAuth3 (staging)** and has no packed key, so
it installs as a **separate** entry next to your prod extension — run both at
once.

```sh
./make-staging.sh https://<staging-host>/oauth3
# or:  WEBHOST_STAGING=https://<staging-host>/oauth3 ./make-staging.sh
```

The staging URL is **required** — there is intentionally no default, so a staging
build can never silently hit the prod node. Load `../oauth3-extension-staging`
unpacked as above.

## Settings (popup → Advanced)

The happy path needs no settings. **Advanced** (the disclosure at the bottom of
the popup) exposes the plumbing for self-hosters and operators:

| Field | What it is | When you'd touch it |
|---|---|---|
| **OAuth3 instance URL** (`serverUrl`) | The homeserver the extension syncs into. Defaults to the built-in federated node (`DEFAULT_HOMESERVER` in `popup.js` / `service-worker.js`). | Only if self-hosting or pointing at staging by hand. |
| **Owner secret** (`secret`) | `OWNER_SECRET` — an admin bearer that overrides the wallet identity. The session subject becomes `owner`. | Admin/debugging only. **Single-tenant artifact** — see [Identity model](#identity-model). End users should leave it blank. |
| **Daemon URL** (`daemon`) | Federation-verify daemon (`/_api/projects/<project>`). | To **pin** the node's code measurement before syncing anything (see below). All three of daemon/project/allow must be set, or verification is skipped. |
| **Project** (`project`) | Project name on that daemon. | Same. |
| **Allowed tree hashes** (`allow`) | Comma-separated trusted `tree_hash` measurements. | Same. If the node's live measurement isn't in this list, syncs are blocked. |

**Federation pin** (daemon + project + allow): trust the code *measurement*, not
the operator. When all three are set, the popup checks the daemon's recorded
`tree_hash` before any sync and refuses if it isn't on your allowlist.

## Jar sync — what leaves the machine, and where it goes

For each jar (a saved plugin), the extension:

1. `GET /api/plugins` — learns the plugin's `cookieDomains` (defined server-side
   per plugin).
2. Reads **every** cookie for those domains via `chrome.cookies.getAll({ domain })`
   — this is the whole jar, cookie `name=value` pairs (HttpOnly included, since
   `chrome.cookies` sees them). It is **not** page-scraped; there are no content
   scripts reading the DOM.
3. `POST /api/cookies` with header `Authorization: Bearer <wallet session>` and
   body `{ plugin, cookies }` — uploads the jar to the homeserver.

**Where it goes:** the node at `serverUrl` (the default federated TEE, or your
override / staging node), over HTTPS. The server stores it in its vault keyed by
`<subject>:<plugin>`. Apps never receive the jar — they get a scoped,
revocable read token minted by the instance.

**Cookie domains & host permission:** `chrome.cookies` only returns cookies for
origins the extension has host permission for, and `*.otter.ai` does **not** match
`otter.ai`, so the popup requests both the apex and the wildcard for each
domain when you add a jar.

**How to verify it worked:**

- **Popup** — each jar row shows a count and freshness (`22 cookies · 2m ago`),
  colored green (≤35 min) / amber (stale) / red (error). Click a row to re-sync.
- **Server dashboard** — open the homeserver URL in a browser; its dashboard
  lists the synced sites, connected apps, and an activity feed for *your* subject.
- **Federation pin** — if you set daemon/project/allow, an untrusted measurement
  surfaces as `instance not trusted — …` in the popup and blocks the sync.

Sync triggers: on demand (popup), on matching cookie changes (debounced 1 s), and
every 30 min (`chrome.alarms`, period `RESYNC_ALARM`).

## Identity model

There is **no sign-in step** in the extension. Three identity paths exist on the
server (`POST /api/login`), and the extension's wallet uses the first:

1. **userKey wallet (default).** On first use the extension mints a random
   64-hex-char `userKey`, kept in `chrome.storage.local` (the localStorage
   analog). It posts it to `/api/login`; the server derives
   `subject = "u-" + sha256hex(userKey)` and returns a session token, cached as
   `walletSession`. The popup then reads `wallet identity: u-<hash>`. The session
   persists on the node's data volume and is reused, so the same browser = the
   same `u-<hash>` account across syncs. **This is "you".**
2. **Owner secret (override).** If `secret` is set in Advanced, it is sent as the
   bearer instead and the subject is `owner` — a single-tenant admin/debug path.
   End users should not need it; removing it from the default UI is tracked
   elsewhere (depends on multi-tenant).
3. **Passkey / linked providers (server-side).** The homeserver also supports
   WebAuthn passkeys and OAuth providers (GitHub/Google/OpenKey), linkable to a
   subject from its dashboard. The **extension wallet** doesn't use these — it's
   always the `userKey` path — but a user can link a passkey to the same
   `u-<hash>` subject so they can sign in on other devices without the extension.

Per-node sessions: the wallet session is minted per homeserver URL. Point the
extension at a different `serverUrl` (or run the staging build) and you get a
fresh, independent session/subject on that node — prod and staging never share a
wallet.

## What it talks to

| Endpoint | Used for |
|---|---|
| `GET  /api/plugins` | Learn a plugin's `cookieDomains`; populate the Add-jar dropdown. |
| `POST /api/login` | Wallet login (`userKey` → `u-<hash>` subject + session). |
| `POST /api/cookies` | Upload the jar for a plugin (wallet bearer). |
| `GET  /api/connect/:id`, `POST /api/connect`, `POST /api/connect/:id/approve` | The `window.oauth3.connect` app flow — see [`docs/APP_API.md`](docs/APP_API.md). |

The instance (server + plugins) and the consume side (`oauth3-sdk`) live in their
own repos. This is just the ingest end.

## For app developers

If your page wants to read a user's site through OAuth3, you talk to the wallet
the extension injects at `window.oauth3` — one `connect()` call, one consent
click, and you hold a scoped token. Full reference: **[`docs/APP_API.md`](docs/APP_API.md)**.

Internal UX design notes (popup/dashboard proposals, not built) live in
[`DESIGN.md`](DESIGN.md).
