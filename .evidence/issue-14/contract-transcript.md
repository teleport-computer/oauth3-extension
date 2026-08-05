# Tier 1 contract transcript — oauth3 account-qualified jars (#14)

Driven against a LOCAL boot of oauth3-server at origin/staging (the deployed staging
oauth3 node was returning HTTP 500 on every endpoint, including /api/health, during
this run — an infrastructure issue, not this issue's scope). SEAL_KEY/OWNER_SECRET
were throwaway local values; the server code is the merged #111 contract (PR #113).

```
$ node --version ; deno --version | head -1
v22.23.1
deno 2.9.0 (stable, release, x86_64-unknown-linux-gnu)

## server
$ curl -s http://localhost:14714/_api/version
{"service":"oauth3-server","commit":"dev"}
$ curl -s http://localhost:14714/api/health
{"ready":true,"plugins":["otter","youtube","reddit","nytimes","twitter","google-calendar","amazon","hackernews"]}

## login (wallet self-provision)
$ POST /api/login {userKey}
{"ok":true,"subject":"u-5c76464c3a09fdfcdfef55d904b19680","session":"sess-a7f513ec067340009ad7859ed76e00c5f83c4ea0bd8c4965933d14cb5cb97b23"}


## AC1 — POST /api/cookies returns the derived account
$ POST /api/cookies twitter twid=u%3D111
{"ok":true,"plugin":"twitter","account":"111","count":3}
$ POST /api/cookies twitter twid=u%3D222 (second account — no overwrite)
{"ok":true,"plugin":"twitter","account":"222","count":3}

## AC3 — GET /api/plugins (authed) returns jars[] per plugin
$ GET /api/plugins (Bearer walletSession)
[
  {
    "id": "twitter",
    "jars": [
      {
        "account": "111",
        "updatedAt": 1785958154139,
        "count": 3
      },
      {
        "account": "222",
        "updatedAt": 1785958154145,
        "count": 3
      }
    ]
  }
]

## AC2 — connect flow: 409-with-accounts, then resolve with account
$ POST /api/connect twitter (no account) -> {"requestId":"req-44e546c3c0ef49bab34b842394bb614c","approveUrl":"http://localhost:14714/approve/req-44e546c3c0ef49bab34b842394bb614c"}
$ POST /api/connect/req-44e546c3c0ef49bab34b842394bb614c/approve (no account) -> {"error":"multiple accounts synced for twitter; the connect request must name one (account)","accounts":["111","222"]} [http 409]
$ POST /api/connect twitter account=222 -> requestId req-0cd5e9d63265410c81619c3dd3e00cc5
$ POST /api/connect/req-0cd5e9d63265410c81619c3dd3e00cc5/approve (account bound) -> {"ok":true,"status":"approved"} [http 200]
$ GET /api/connect/req-0cd5e9d63265410c81619c3dd3e00cc5 -> {"status": "approved", "token": "tok-twitter-a8df1826ebc94ad1bb78098d"}
```
