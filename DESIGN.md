# OAuth3 extension — UX design

Design report for the popup + dashboard. Status: proposal (2026-06-24). Nothing here
is built yet; it supersedes the current config-form popup.

## What's wrong now
The popup *is a config form*. Every open shows: instance URL, **owner secret**, plugin
dropdown, a federation-verify drawer, Save, Sync. That's plumbing — settings you touch
once — in front of you on every click. The **owner secret** field is the worst tell: it
leaks a single-tenant dev artifact into the end-user UI.

Meanwhile the repo already has `provider-inject.js` + `provider-bridge.js`, and the SDK's
`connect()` prefers a `window.oauth3` provider. The extension is **already becoming a
wallet** (pages call it; it approves and hands back a token). Design for that.

## Principles
1. **Zero config on the happy path.** Homeserver is defaulted — never show a URL field by
   default. Owner secret shouldn't exist for end users (see below).
2. **Contextual primary action.** The popup knows the current tab. On a supported site the
   hero is one button: *Save this site*.
3. **Progressive disclosure.** Glance by default; the popup is a *launcher* to a full
   dashboard tab for anything deep.
4. **Consent is its own mode**, triggered by a page's connect request — not mixed with settings.

## Popup states

**A · on a supported site, not yet saved** — the contextual "save it"
```
┌──────────────────────────────┐
│ ◉ OAuth3             ● healthy│
│  You're on  reddit.com        │
│  ┌────────────────────────┐   │
│  │   Save Reddit          │   │ ← syncs the jar, one tap
│  └────────────────────────┘   │
│  Apps then read it with a     │
│  scoped token, never cookies. │
│  3 sites · 2 apps · activity ▸│ ← → dashboard
└──────────────────────────────┘
```

**B · supported site, already saved** — status, not a form
```
┌──────────────────────────────┐
│ ◉ OAuth3             ● healthy│
│  reddit.com  ✓ saved          │
│  fresh · 22 cookies · 2m ago  │
│  read by: otter-importer      │
│  [ Update ]        [ Manage ▸]│
│  3 sites · 2 apps · activity ▸│
└──────────────────────────────┘
```

**C · any other page** — glance (health + activity)
```
┌──────────────────────────────┐
│ ◉ OAuth3      instance ● verified
│  3 sites saved · 2 apps        │
│  Recent                        │
│   · otter-importer read Otter 2h
│   · approved reddit-wrapped  1d│
│  ┌────────────────────────┐   │
│  │    Open dashboard  ▸    │   │
│  └────────────────────────┘   │
└──────────────────────────────┘
```

**D · a page is requesting access** — the consent card (pairs with the provider flow)
```
┌──────────────────────────────┐
│  Approve access?              │
│  reddit-wrapped.app wants      │
│   ● Reddit — saved items       │
│  Gets a scoped, revocable token│
│  [  Approve  ]     [  Deny  ]  │
│  ▸ exactly what it can see     │
└──────────────────────────────┘
```

## Dashboard tab (the "nice landing page")
Glance first, drill down on click.
```
OAuth3 — your account          instance ● verified (915c…/oauth3)

SITES                          APPS & TOKENS
reddit  ✓ 22 · fresh 2m        otter-importer → Otter   read 2h   [revoke]
otter   ✓ 49 · fresh 1h        reddit-wrapped → Reddit  read 1d   [revoke]
nytimes ✓ 31 · 3d (stale!)
youtube — not saved

ACTIVITY
2h  otter-importer read Otter (12 items)
1d  approved reddit-wrapped → Reddit
2d  revoked yt-history-app
```

**Data wiring** (real vs. small gap):
- Sites + freshness → `GET /api/plugins` ✓ exists
- Revoke → `DELETE /api/tokens/:token` ✓ exists
- Apps/tokens list → `listTokens()` exists, needs a `GET /api/tokens` *(small add)*
- Activity feed → `server/audit.ts` logs events, needs a `GET /api/audit` *(small add)*
- Health/verified → `/api/health` + federation pin ✓ exists

The dashboard is **two small read endpoints** away from fully real.

## The owner-secret problem
Asking a user to paste an `OWNER_SECRET` is wrong and it's why the UI feels like plumbing.
In the wallet model the **extension holds your key**; "your OAuth3 account" *is* that key,
not a typed secret. That field should vanish for end users — it's a single-tenant artifact,
and killing it depends on **multi-tenant (#7)**. Until then: set it once in first-run, never
show it again.

## Phasing
1. **Kill config from the default view** → contextual popup (A/B/C) + a gear-tucked Settings.
   *(extension-only, no backend)*
2. **Dashboard tab** on `/api/plugins` + `/api/health` (sites + health).
3. **Add `GET /api/tokens` + `/api/audit`** → apps & activity light up.
4. **Consent card (D)** — lands with the provider/connect flow.
5. **Remove owner-secret** for end users — gated on multi-tenant (#7).
