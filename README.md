# oauth3-extension

The **ingest** client for [OAuth3](https://teleport.computer). A thin cookie-jar
courier: it reads your cookie jar for a site and syncs it into an OAuth3 instance
you trust (a TEE). Apps then read your data through that instance with a **scoped,
revocable token** — they never touch the raw jar.

It does one thing. No content scripts, no scraping, no dashboards — just
`cookies` + `storage` + `alarms`. (The heavier, deployment-specific
`oauth3-extension-1` is legacy and stays private.)

## Use

1. Load this folder unpacked in Chrome (`chrome://extensions` → Developer mode →
   Load unpacked).
2. Open the popup, set the **OAuth3 instance URL** (your dstack node or
   `http://localhost:3000` in dev) and your **owner secret**, pick a plugin, and
   hit **Sync jar now**.
3. After that it auto-syncs: on relevant cookie changes (debounced) and every
   30 minutes, so the instance's jar stays fresh for always-on polling.

## What it talks to

- `GET  /api/plugins` — to learn a plugin's `cookieDomains`
- `POST /api/cookies` — to upload the jar for the selected plugin (owner secret)

The instance (server + plugins) and the consume side (`oauth3-sdk`) live in their
own repos. This is just the ingest end.
