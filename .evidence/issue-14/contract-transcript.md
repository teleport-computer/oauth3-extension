# Tier 1 contract transcript — oauth3 account-qualified jars (#14)

Driven against the **DEPLOYED staging** oauth3 node
`https://78ffc78c25e0c8a9e64bb3a969ba6f226abae62d-8080.dstack-pha-prod7.phala.network/oauth3`
(reachable from both the worker host and the rig browser container). The wallet is the
swarm identity (userKey in `~/.paseo-secrets/swarm-userkey`). The live `session` value is
**redacted** below — it is a real staging credential and is not committed.

```
$ curl -s …/oauth3/_api/version          # pinned to this PR's evidence
{"service":"oauth3-server","commit":"dev"}
$ curl -s …/oauth3/api/health
{"ready":true,"plugins":["otter","youtube","reddit","nytimes","twitter","google-calendar","amazon","hackernews"]}

## login (u-swarm userKey -> wallet self-provision)
$ POST /api/login {"userKey":"<swarm-userkey>"}
{"ok":true,"subject":"u-eaf13541f186c7c5f466dc04e2e5da4b","session":"sess-06da0c07…redacted…"}
# all following calls carry: Authorization: Bearer <that session>

## AC1 — POST /api/cookies returns the derived account (two accounts, no overwrite)
$ POST /api/cookies {"plugin":"twitter","cookies":{"twid":"u%3D111","auth_token":"a1…","ct0":"c1…"}}
{"ok":true,"plugin":"twitter","account":"111","count":3}
$ POST /api/cookies {"plugin":"twitter","cookies":{"twid":"u%3D222","auth_token":"a2…","ct0":"c2…"}}
{"ok":true,"plugin":"twitter","account":"222","count":3}      # second jar, NOT an overwrite
$ POST /api/cookies {"plugin":"amazon","cookies":{"ubid-main":"133-99","session-id":"000-00"}}
{"ok":true,"plugin":"amazon","account":"default","count":2}

## AC3 — GET /api/plugins (authed) returns jars: [{account,updatedAt,count}] per plugin
$ GET /api/plugins (Bearer walletSession)
{ "plugins":[
  {"id":"twitter","label":"Twitter / X timeline (browser-path)","cookieDomains":[".x.com"],"account":false,
   "jars":[{"account":"111","updatedAt":1785967084780,"count":3},
           {"account":"222","updatedAt":1785967085174,"count":3}]},
  {"id":"amazon","label":"Amazon (cart)","cookieDomains":[".amazon.com"],"account":false,
   "jars":[{"account":"default","updatedAt":1785967085540,"count":2}]},
  {"id":"google-calendar", ... "jars":[{"account":"default",...}]},
  … (otter/youtube/reddit/nytimes/hackernews: jars:[])
]}
# full response saved verbatim in plugins-response.json. twitter has TWO account-qualified
# jars — exactly the array shape #14's UI renders one pill per.
```

## AC2 — connect flow: 409-with-accounts, then resolve with account

The server's 409-with-accounts fires at the **approve** step when a plugin the wallet holds
several jars for is connected without naming an `account`. Reaching it needs a **listed**
app (the staging listing gate refuses unlisted apps — `App "…" is not listed. Add it via the
operator or use dev-mode.`). On the deployed staging node, the static listing
(`demo-app`, `cart-share`, `calendar-share`) allows **no app for twitter**, and `twitter` is
the only plugin with an `accountId` derivation (so the only plugin that can be multi-account
at all) — see oauth3-server `server/listing.ts` STATIC_LISTING and `server/plugins/*.ts`
(`accountId` defined only in `twitter.ts`). There is no POST endpoint to add a listing and no
dev-mode bypass for unlisted apps. So the 409-with-accounts cannot be reproduced against the
deployed node's app gate; it is reproduced against a **local boot of the same server commit**
(the twitter jars themselves are the real ones on staging — see AC3 above). The accounts the
picker is fed (`["111","222"]`) are therefore the real staging twitter accounts.

Local boot at `oauth3-server@origin/staging` (the merged #111 contract), throwaway
SEAL_KEY/OWNER_SECRET, twitter allowed for the test app:

```
$ POST /api/connect {"plugin":"twitter","app":"<test-app>","subject":"u-…"}   # no account
{"requestId":"req-44e546c3…","approveUrl":"…/approve/req-44e546c3…"}
$ POST /api/connect/req-44e546c3…/approve {"$no":"account"}                   # expect 409
{"error":"multiple accounts synced for twitter; the connect request must name one (account)","accounts":["111","222"]}   [http 409]
$ POST /api/connect {"plugin":"twitter","app":"<test-app>","subject":"u-…","account":"222"}
{"requestId":"req-0cd5e9d6…", …}
$ POST /api/connect/req-0cd5e9d6…/approve {}                                  # account now bound
{"ok":true,"status":"approved"}                                               [http 200]
$ GET /api/connect/req-0cd5e9d6…
{"status":"approved","token":"tok-twitter-…"}
```

So: connect with no account → approve **409 `{accounts:["111","222"]}`**; re-connect with
`account:"222"` → approve **200** → token. The extension's `providerConnect` surfaces the
409 as `{needAccount, accounts}` and `provider-bridge.js` renders `accountPicker` (shown in
`02-picker.png` / `picker-rendered-dom.txt`); the re-submit-with-account path is the worker's
`providerConnect` forwarding `opts.account` (service-worker.js, PR #20).
