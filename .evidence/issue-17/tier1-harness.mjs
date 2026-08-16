// Tier 1 harness — PR #18 / issue #17: wallet sessions keyed by homeserver node.
//
// Drives the REAL service-worker.js at this branch's HEAD (not a copy, not a mock)
// through its real chrome.runtime.onMessage entrypoint — the same {action:"sync-plugin"}
// messages the popup sends — over REAL HTTP against two DEPLOYED nodes:
//   A = webhost-staging oauth3 core (deployed staging)
//   B = the extension's DEFAULT_HOMESERVER (a second deployed instance)
// Only chrome.* is shimmed (in-memory storage.local, a sample cookie jar, inert
// listeners). fetch is WRAPPED for logging — never stubbed; every request below
// hits the network. Run from the repo root:  node .evidence/issue-17/tier1-harness.mjs
//
// Assertions map 1:1 onto issue #17's ## Acceptance (AC1..AC5). Sessions and the
// userKey are redacted in the transcript (credentials — public repo).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Node loads the .js service worker as CommonJS (no package.json "type"), and the CJS
// cache keys on the resolved PATH — query-string cache-busting silently no-ops. To get
// a fresh execution of the SAME file against a fresh chrome shim per phase, evict the
// CJS cache entry and require() it again. The code run is the repo file, verbatim.
const cjsRequire = createRequire(import.meta.url);
const loadSW = () => { const r = cjsRequire.resolve(ROOT + "/service-worker.js"); delete cjsRequire.cache[r]; cjsRequire(r); };

const A = "https://78ffc78c25e0c8a9e64bb3a969ba6f226abae62d-8080.dstack-pha-prod7.phala.network/oauth3";
const B = "https://915c8197b20b831c52cf97a9fb7e2e104cdc6ae8-8080.dstack-pha-prod7.phala.network/oauth3";
const PLUGIN = "youtube"; // present on BOTH nodes (verified in the transcript)
const keyOf = (n) => n.replace(/\/+$/, "");
const redact = (s) => (s ? s.slice(0, 12) + "…" + s.slice(-6) : "(none)");

// ---- fetch logging (real network, recorded) ----------------------------------
const netlog = [];
const netlogFull = []; // never reset — the committed transcript's fetch log
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const r = await realFetch(url, init);
  const authz = init.headers?.Authorization || "";
  netlogFull.push({
    node: String(url).startsWith(A) ? "A" : String(url).startsWith(B) ? "B" : "?",
    method: init.method || "GET",
    url: String(url).replace(A, "A").replace(B, "B"),
    status: r.status,
    bearer: redact(authz.replace(/^Bearer /, "")),
  });
  netlog.push(netlogFull.at(-1));
  return r;
};
const logins = (n) => netlog.filter((e) => e.node === n && e.url.endsWith("/api/login")).length;
const lastLoginBody = {}; // subject per node, from the raw phase (filled below)

// ---- chrome shim --------------------------------------------------------------
function makeChrome(storage) {
  const store = storage;
  const listeners = { message: null };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  return {
    __messageHandler: () => listeners.message,
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const k of typeof keys === "string" ? [keys] : keys ?? Object.keys(store)) if (k in store) out[k] = store[k];
          return clone(out);
        },
        async set(obj) { for (const [k, v] of Object.entries(obj)) { if (v === undefined) delete store[k]; else store[k] = clone(v); } },
        async remove(keys) { for (const k of typeof keys === "string" ? [keys] : keys) delete store[k]; },
      },
    },
    runtime: {
      onMessage: { addListener: (fn) => (listeners.message = fn) },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
    },
    alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
    cookies: {
      onChanged: { addListener: () => {} },
      // A sample browser jar for any requested domain — the harvest itself is not
      // under test; what the client SENDS and how it AUTHENTICATES is.
      getAll: async () => [{ name: "VISITOR_INFO1_LIVE", value: "rw18-tier1" }, { name: "PREF", value: "rw18" }],
    },
  };
}

// Drive the service worker exactly as the popup does.
async function send(chrome, msg) {
  return new Promise((res) => {
    const done = (r) => res(r);
    chrome.__messageHandler()(msg, {}, done);
  });
}

const SHA = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"],
  { cwd: ROOT, encoding: "utf8", env: { ...process.env, PATH: `/usr/bin:/bin:/usr/local/bin:${process.env.PATH || ""}` } }).trim();
const out = [];
const say = (s = "") => (out.push(s), console.log(s));
let failures = 0;
const check = (ok, label, detail = "") => {
  say(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};
const assertRealPR = (await import("node:fs")).readFileSync(ROOT + "/service-worker.js", "utf8");
if (!/walletSessionKey/.test(assertRealPR)) { console.error("service-worker.js at HEAD lacks walletSessionKey — wrong tree, abort"); process.exit(2); }

say(`# Tier 1 transcript — issue #17 / PR #18 — generated ${new Date().toISOString()}`);
say(`Extension code under test: service-worker.js @ ${SHA.slice(0, 7)} (this branch's HEAD, imported verbatim)`);
say(`Node A (deployed staging): ${A}`);
say(`Node B (deployed, DEFAULT_HOMESERVER): ${B}`);
say("");

// ---- PHASE 0: pin the deployed cores ------------------------------------------
say("## Phase 0 — pin both nodes");
say(`GET A/_api/version → ${(await (await realFetch(`${A}/_api/version`)).text()).trim()}`);
const bVer = await realFetch(`${B}/_api/version`);
say(`GET B/oauth3/_api/version → HTTP ${bVer.status} ${(await bVer.text()).trim().slice(0, 80)} (older core: no version route under its mount)`);
const bHost = await realFetch(B.replace("/oauth3", "") + "/_api/version");
say(`GET B host daemon /_api/version → HTTP ${bHost.status} ${(await bHost.text()).trim().slice(0, 120)}`);
say("");

// ---- PHASE 1: A → B → A --------------------------------------------------------
say("## Phase 1 — A → B → A (AC1 AC2 AC3)");
const store1 = {};
globalThis.chrome = makeChrome(store1);
loadSW();
netlog.length = 0;

await chrome.storage.local.set({ serverUrl: A });
let r = await send(chrome, { action: "sync-plugin", plugin: PLUGIN });
check(r.ok === true, "sync on A #1 ok", JSON.stringify(r));
const subjA1 = store1.walletSubject;

await chrome.storage.local.set({ serverUrl: B });
r = await send(chrome, { action: "sync-plugin", plugin: PLUGIN });
check(r.ok === true, "sync on B ok", JSON.stringify(r));
const subjB = store1.walletSubject;

await chrome.storage.local.set({ serverUrl: A });
r = await send(chrome, { action: "sync-plugin", plugin: PLUGIN });
check(r.ok === true, "sync on A #2 (return) ok", JSON.stringify(r));

check(logins("A") === 1 && logins("B") === 1, "AC3 exactly one /api/login per instance", `logins A=${logins("A")} B=${logins("B")} (want 1/1)`);
check(Object.keys(store1.walletSessions).sort().join() === [keyOf(A), keyOf(B)].sort().join(), "AC1 walletSessions keyed by node", Object.keys(store1.walletSessions).map(redact).join(" , "));
check(!("walletSession" in store1), "no legacy walletSession key left", String("walletSession" in store1));
check(!!store1.userKey && subjA1 === subjB && subjA1.startsWith("u-"), "AC2 one userKey, identical subject on both nodes", `subject A=${subjA1} B=${subjB}`);
const cookiePostsA = netlog.filter((e) => e.node === "A" && e.url.endsWith("/api/cookies"));
check(cookiePostsA.length === 2 && cookiePostsA[0].status === 200 && cookiePostsA[1].status === 200, "both A /api/cookies POSTs → 200");
check(cookiePostsA[0].bearer === cookiePostsA[1].bearer, "A reused the SAME cached bearer on return (no re-mint)", `${cookiePostsA[0].bearer} == ${cookiePostsA[1].bearer}`);
say(`  subject (both nodes): ${subjA1}; userKey: ${redact(store1.userKey)}`);
say("");

// ---- PHASE 2: stale session on A → real 401 → self-heal, B untouched ----------
say("## Phase 2 — stale A session: real 401, refresh A only (AC4)");
const bKeyBefore = store1.walletSessions[keyOf(B)];
store1.walletSessions[keyOf(A)] = "sess-stale-0000000000000000000000000000"; // server will really 401 this
netlog.length = 0;
r = await send(chrome, { action: "sync-plugin", plugin: PLUGIN });
check(r.ok === true, "sync on A self-healed ok", JSON.stringify(r));
const aPosts = netlog.filter((e) => e.node === "A" && e.url.endsWith("/api/cookies"));
check(aPosts.length === 2 && aPosts[0].status === 401 && aPosts[1].status === 200, "AC4 real 401 then retried 200", aPosts.map((e) => e.status).join(" → "));
check(logins("A") === 1 && logins("B") === 0, "AC4 exactly one re-login for A, none for B", `logins A=${logins("A")} B=${logins("B")}`);
check(store1.walletSessions[keyOf(B)] === bKeyBefore, "B's session byte-identical after A's refresh");
check(redact(store1.walletSessions[keyOf(A)]) !== redact("sess-stale-0000000000000000000000000000"), "A's slot now holds the fresh session", redact(store1.walletSessions[keyOf(A)]));
say("");

// ---- PHASE 3: legacy walletSession migrates with zero logins ------------------
say("## Phase 3 — legacy single-key walletSession migrates, no re-auth (AC5)");
const store2 = {};
globalThis.chrome = makeChrome(store2);
// Re-import the same module against the new global (fresh module registry via cache-bust query)
loadSW();
netlog.length = 0;
// Seed a pre-#18 install: one userKey + one unkeyed session minted directly from
// the deployed node (this seeding POST /api/login is labeled, not part of the sync).
const seedLogin = await (await realFetch(`${A}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userKey: store1.userKey }) })).json();
netlog.length = 0; // seeding excluded from the sync-phase count
await chrome.storage.local.set({ serverUrl: A, userKey: store1.userKey, walletSession: seedLogin.session });
r = await send(chrome, { action: "sync-plugin", plugin: PLUGIN });
check(r.ok === true, "sync with legacy session ok (no visible re-auth)", JSON.stringify(r));
check(logins("A") === 0 && logins("B") === 0, "AC5 ZERO /api/login during migration sync", `logins A=${logins("A")} B=${logins("B")}`);
check(!("walletSession" in store2) && store2.walletSessions[keyOf(A)] === seedLogin.session, "legacy value moved under its node key, old key removed", `walletSessions[${redact(keyOf(A))}]=${redact(store2.walletSessions[keyOf(A)])}`);
const p3post = netlog.find((e) => e.url.endsWith("/api/cookies"));
check(!!p3post && p3post.status === 200 && p3post.bearer === redact(seedLogin.session), "migrated session accepted by the deployed node (200, same bearer)");
say("");

say("## Fetch log (every request this run made, real network, cumulative across phases)");
for (const e of netlogFull) say(`  ${e.node} ${e.status} ${e.method} ${e.url}  bearer=${e.bearer}`);
say("");
say(failures === 0 ? `ALL CHECKS PASSED (${SHA.slice(0, 7)})` : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
