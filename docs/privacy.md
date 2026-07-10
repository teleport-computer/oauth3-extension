---
title: Privacy Policy — OAuth3 extension
description: How the OAuth3 extension handles your data — short version&#58; it couriers your cookies to an instance you choose, and nowhere else.
---

**Effective date:** 2026-07-04

The OAuth3 extension is an open-source tool. Its data flow is fully determined by the
source published at
[github.com/teleport-computer/oauth3-extension](https://github.com/teleport-computer/oauth3-extension)
under an MIT license, which you can audit in full.

## What the extension does with your data

The extension is a **cookie-jar courier**. For each site you explicitly add, it reads
that site's session cookies from your own browser and sends them, over HTTPS, to the
**one OAuth3 instance URL you configure**. It does not send your data anywhere else.

Specifically:

| Data | Where it goes | Why |
|---|---|---|
| Session cookies for sites you add | The one instance URL you configure | So your instance can act on your behalf at those sites and mint scoped tokens for apps |
| The list of sites you added + freshness status | Stored locally in `chrome.storage.local` on your device | So the popup shows your jars |
| Your configured instance URL | Stored locally in `chrome.storage.local` on your device | So the extension knows where to sync |
| The owner secret you paste | Stored locally in `chrome.storage.local` on your device | Authenticates cookie uploads to your instance |

The extension does not collect, store, or transmit any other personal information. It
does not use analytics. It does not communicate with any third-party service other than
the instance URL you provide.

## Your instance, and the default one

You choose which OAuth3 instance the extension talks to. Out of the box it points at a
default instance (`pod.dstack.soc1024.com/oauth3`), the way a Matrix client defaults to
matrix.org — a starting point you can change under Advanced.

The default instance runs inside a Trusted Execution Environment (TEE). Its code
identity is **remotely attestable**, meaning you can cryptographically verify which
published code is handling your cookies rather than take it on trust. If you run your
own instance, your cookies go only to infrastructure you operate.

Once your cookies are at your instance, that instance answers apps' requests with a
**scoped, revocable token** — the app receives a token limited to what you approved, not
your cookies, and you can revoke it at any time.

## Permissions the extension requests, and why

| Permission | Why |
|---|---|
| `cookies` | Read your session cookies for the sites you explicitly add |
| `storage` | Save your added sites, instance URL, and upload secret locally on your device |
| `alarms` | Re-sync cookies every 30 minutes so your instance's session stays fresh |
| `activeTab` | Read only the active tab's URL, so the popup can offer "add a jar for this site" |
| `host_permissions: pod.dstack.soc1024.com` | Talk to the built-in default instance (learn a site's cookie needs; upload the jar) |
| `optional_host_permissions: https://*/*` | Read a site you add, or reach a custom instance URL you enter — granted at runtime, only for that exact origin |

Each site you add prompts your browser, at that moment, for permission to read only that
site's cookies. Nothing is read until you approve it.

## What it does not do

- No central OAuth3 account and no central collection — the extension talks only to the
  instance URL you set.
- No third-party analytics, telemetry, or tracking.
- Does not sell or share your data — it never receives your data centrally; the courier
  path is browser → your instance only.
- No advertising.
- Does not transmit browsing history beyond the per-site cookie sync described above.

## Data retention and deletion

- **Local browser storage** (added sites, instance URL, secret) — clear by uninstalling
  the extension or via Chrome's clear-storage flow.
- **Your instance** — the cookie jars live on the instance you configured; delete them
  there (or shut the instance down). For the default TEE instance, revoke via its
  dashboard.

## Open source and verifiability

Full source is at
[github.com/teleport-computer/oauth3-extension](https://github.com/teleport-computer/oauth3-extension)
under the MIT license. Tagged releases are intended to match the version distributed via
the Chrome Web Store. The default instance's behavior is additionally verifiable via TEE
remote attestation.

## Contact

Questions, security reports, or privacy concerns: file an issue at
[github.com/teleport-computer/oauth3-extension/issues](https://github.com/teleport-computer/oauth3-extension/issues).

## Changes to this policy

If this policy changes, the updated version is published at this URL and the effective
date above is updated. The change history is visible in the git history of
`docs/privacy.md` in the repository.
