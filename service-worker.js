// Grabs the WHOLE cookie jar for a plugin's domains (unlike openfeedling, which
// filtered to named YouTube cookies) and syncs it to the plugin server. Syncs on
// demand (popup), on relevant cookie changes (debounced), and on a periodic alarm —
// so the jar the TEE holds stays fresh for always-on polling.

const DEFAULT_HOMESERVER = "https://915c8197b20b831c52cf97a9fb7e2e104cdc6ae8-8080.dstack-pha-prod7.phala.network/oauth3";

// The wallet's identity. Default: a random userKey kept in extension storage (the
// localStorage analog) → a per-user subject on the homeserver. No passkey, no owner
// secret imposed. An owner secret, if set in the popup, overrides for admin use.
// The session is cached and reused (sessions persist on the node's data volume).
const walletSessionKey = (node) => node.replace(/\/+$/, "");

async function walletBearer(node) {
  const key = walletSessionKey(node);
  const { secret, walletSessions = {}, walletSession, walletSubject } = await chrome.storage.local.get(["secret", "walletSessions", "walletSession", "walletSubject"]);
  if (secret) return secret;
  if (walletSessions[key]) return walletSessions[key];
  if (walletSession) {
    // A pre-node-key version has no way to identify its node. Use it once for the
    // current node, then remove the ambiguous value so the next node logs in.
    walletSessions[key] = walletSession;
    await chrome.storage.local.set({ walletSessions, walletSubject });
    await chrome.storage.local.remove(["walletSession"]);
    return walletSession;
  }
  let { userKey } = await chrome.storage.local.get("userKey");
  if (!userKey) {
    userKey = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    await chrome.storage.local.set({ userKey });
  }
  const r = await fetch(`${node}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userKey }) });
  if (!r.ok) throw new Error(`wallet login ${r.status}`);
  const { session, subject } = await r.json();
  walletSessions[key] = session;
  await chrome.storage.local.set({ walletSessions, walletSubject: subject });
  return session;
}

async function clearWalletSession(node) {
  const walletSessions = (await chrome.storage.local.get("walletSessions")).walletSessions || {};
  delete walletSessions[walletSessionKey(node)];
  await chrome.storage.local.set({ walletSessions });
  await chrome.storage.local.remove(["walletSession"]);
}

async function authRetry(node, auth, doFetch) {
  let r = await doFetch();
  if (r.status === 401 && !(await chrome.storage.local.get("secret")).secret) {
    await clearWalletSession(node);
    auth.Authorization = `Bearer ${await walletBearer(node)}`;
    r = await doFetch();
  }
  return r;
}

async function pluginDomains(serverUrl, pluginId) {
  const r = await fetch(`${serverUrl}/api/plugins`);
  if (!r.ok) throw new Error(`/api/plugins ${r.status}`);
  const { plugins } = await r.json();
  const p = plugins.find((x) => x.id === pluginId);
  if (!p) throw new Error(`server has no plugin "${pluginId}"`);
  return p.cookieDomains;
}

// Provider flow (window.oauth3.connect from an app page): copy this site's jar into
// your room, then connect + approve as the wallet owner, and hand the app a scoped
// token. The user already consented via the approval dialog (the gesture).
async function providerConnect(opts) {
  const { serverUrl } = await chrome.storage.local.get(["serverUrl"]);
  const node = (opts?.node || serverUrl || DEFAULT_HOMESERVER).replace(/\/$/, "");
  const bearer = await walletBearer(node);
  const auth = { "Authorization": `Bearer ${bearer}`, "Content-Type": "application/json" };
  const r = await fetch(`${node}/api/plugins`);
  if (!r.ok) throw new Error(`/api/plugins ${r.status}`);
  const p = (await r.json()).plugins.find((x) => x.id === opts.plugin);
  if (!p) return { error: `unknown plugin "${opts.plugin}"` };
  const jar = {};
  for (const d of p.cookieDomains) for (const c of await chrome.cookies.getAll({ domain: d })) jar[c.name] = c.value;
  if (Object.keys(jar).length) {
    const s = await authRetry(node, auth, () => fetch(`${node}/api/cookies`, { method: "POST", headers: auth, body: JSON.stringify({ plugin: opts.plugin, cookies: jar }) }));
    if (!s.ok) return { error: `cookie sync ${s.status}` };
  }
  // Forward opts.caps so the minted token actually carries the requested scope.
  // The server threads body.caps -> approveConnect -> mint(plugin, subject, app, caps);
  // omitting it here (the bug) mints an unrestricted token that sails past the
  // scope gate. JSON.stringify drops `caps` when undefined, so no-caps callers
  // are unaffected.
  //
  // #14: also forward opts.account. The server keys jars (subject, plugin, account);
  // if the wallet holds several accounts for this plugin and none is named, the
  // approve step 409s with the available accounts. We surface that to the page
  // (provider-bridge shows a picker) and the page re-calls with `account` set.
  const connBody = { plugin: opts.plugin, app: opts.app, subject: opts.subject, caps: opts.caps };
  if (opts.account) connBody.account = opts.account;
  const conn = await (await fetch(`${node}/api/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(connBody) })).json();
  // #18: approve goes through authRetry so a stale (per-node) session refreshes
  // its own bearer instead of replaying another node's — 401 recovery is retained
  // for connect approval. A 409 (account needed) is not a 401, so the retry above
  // never touches the needAccount path below.
  const ap = await authRetry(node, auth, () => fetch(`${node}/api/connect/${conn.requestId}/approve`, { method: "POST", headers: auth, body: "{}" }));
  // #14: multiple accounts synced for this plugin and none named → hand the list
  // back to the page so the user picks one. The page re-runs connect with account.
  if (ap.status === 409) {
    const body = await ap.json().catch(() => ({}));
    if (Array.isArray(body?.accounts) && body.accounts.length) {
      return { needAccount: true, accounts: body.accounts, plugin: opts.plugin };
    }
  }
  if (!ap.ok) throw new Error(`approve ${ap.status}: ${await ap.text()}`);
  const st = await (await fetch(`${node}/api/connect/${conn.requestId}`)).json();
  return st.status === "approved" ? { token: st.token } : { error: "approval failed" };
}

async function grabJar(domains) {
  const jar = {};
  for (const d of domains) {
    for (const c of await chrome.cookies.getAll({ domain: d })) jar[c.name] = c.value;
  }
  return jar;
}

// State is per-jar now: storage.jars = { [pluginId]: { lastSync, ok, count, error } },
// storage.jarDomains = { [pluginId]: [domain,...] } (cached for cookie-change matching).
// A "jar" is a site the user added to keep fresh — no single selected plugin.
async function syncOne(node, plugin) {
  const domains = await pluginDomains(node, plugin);
  const jar = await grabJar(domains);
  const count = Object.keys(jar).length;
  let ok = false, error = "", account;
  if (!count) error = `no cookies for ${domains.join(",")}`;
  else {
    const bearer = await walletBearer(node);
    const auth = { "Content-Type": "application/json", "Authorization": `Bearer ${bearer}` };
    const r = await authRetry(node, auth, () => fetch(`${node}/api/cookies`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ plugin, cookies: jar }),
    }));
    ok = r.ok;
    if (ok) {
      // #14: the server derives the account from the jar (e.g. twitter twid → numeric
      // id) and returns it. Surface it in the UI so a second account is visible, not
      // a silent overwrite.
      const body = await r.json().catch(() => ({}));
      account = body?.account;
    } else {
      error = `${r.status} ${(await r.text().catch(() => "")).slice(0, 100)}`;
    }
  }
  const { jars = {}, jarDomains = {} } = await chrome.storage.local.get(["jars", "jarDomains"]);
  jars[plugin] = { lastSync: Date.now(), ok, count, error, account };
  jarDomains[plugin] = domains;
  await chrome.storage.local.set({ jars, jarDomains });
  return { plugin, ok, count, error, account };
}

async function syncAll() {
  const { serverUrl, jars = {} } = await chrome.storage.local.get(["serverUrl", "jars"]);
  const node = (serverUrl || DEFAULT_HOMESERVER).replace(/\/$/, "");
  const out = [];
  for (const id of Object.keys(jars)) out.push(await syncOne(node, id).catch((e) => ({ plugin: id, ok: false, error: String(e.message || e) })));
  return out;
}

const nodeOf = async () => ((await chrome.storage.local.get("serverUrl")).serverUrl || DEFAULT_HOMESERVER).replace(/\/$/, "");

// --- Per-site activation: the provider ships only where the user opted in (#29) ---
// The static <all_urls> content_scripts made the wallet visible (and fingerprintable)
// on every page the browser visits. Now provider-inject.js (MAIN world) and
// provider-bridge.js are registered dynamically for exactly two sets of origins:
//   1. origins approved via the popup's "Use OAuth3 here" — persisted in
//      storage.approvedOrigins + a per-origin host grant, both of which survive
//      browser restarts, as do the registrations themselves;
//   2. the instance's own origin (login/dashboard) — auto-approved, otherwise
//      extension-mediated sign-in regresses.
// Revoking unregisters the scripts and drops the host permission, taking the page
// back to `typeof window.oauth3 === "undefined"` on the next load.

// One registration per world: `world` applies to the whole registration, so the MAIN
// injector and the ISOLATED bridge are separate entries with derived ids.
const SITE_SCRIPTS = [
  { suffix: "inject", js: "provider-inject.js", world: "MAIN" },
  { suffix: "bridge", js: "provider-bridge.js", world: "ISOLATED" },
];
// Ids must be [A-Za-z0-9_-] — hostnames' dots are NOT legal in script ids
// (Chrome rejects the registration with "Invalid value for id"), so squash
// everything non-alphanumeric into hyphens.
const siteSlug = (origin) => origin.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+/, "");
const sitePattern = (origin) => `${origin}/*`;
const siteIds = (origin) => SITE_SCRIPTS.map((s) => `oauth3-${s.suffix}-${siteSlug(origin)}`);

async function instanceOrigins() {
  const { serverUrl } = await chrome.storage.local.get("serverUrl");
  const origins = [serverUrl, DEFAULT_HOMESERVER].filter(Boolean)
    .map((n) => { try { return new URL(n).origin; } catch { return ""; } }).filter(Boolean);
  return [...new Set(origins)];
}

async function registerOrigin(origin) {
  const have = new Set((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  for (const s of SITE_SCRIPTS) {
    const id = `oauth3-${s.suffix}-${siteSlug(origin)}`;
    if (have.has(id)) continue;
    await chrome.scripting.registerContentScripts([{
      id, matches: [sitePattern(origin)], js: [s.js],
      world: s.world, runAt: "document_start", persistAcrossSessions: true,
    }]);
  }
}

async function activateOrigin(origin) {
  const { approvedOrigins = [] } = await chrome.storage.local.get("approvedOrigins");
  if (!approvedOrigins.includes(origin)) { approvedOrigins.push(origin); await chrome.storage.local.set({ approvedOrigins }); }
  await registerOrigin(origin);
}

async function deactivateOrigin(origin) {
  const { approvedOrigins = [] } = await chrome.storage.local.get("approvedOrigins");
  await chrome.storage.local.set({ approvedOrigins: approvedOrigins.filter((o) => o !== origin) });
  await unregisterOrigin(origin);
}

// Losing the per-origin grant (Chrome's site settings, or a revoke elsewhere)
// must take the provider with it — the scripts cannot inject without it. Only
// origins the user explicitly approved as provider sites are touched, so a jar
// (cookie-read) grant being dropped never affects unrelated site activation.
chrome.permissions.onRemoved.addListener((p) => {
  (async () => {
    for (const o of p.origins || []) {
      const origin = o.replace(/\/\*$/, "");
      if ((await instanceOrigins()).includes(origin)) continue;
      const { approvedOrigins = [] } = await chrome.storage.local.get("approvedOrigins");
      if (!approvedOrigins.includes(origin)) continue;
      await deactivateOrigin(origin);
    }
  })().catch((e) => console.warn("[sites]", e?.message || e));
});

async function unregisterOrigin(origin) {
  // "never registered" is a successful revoke — make it idempotent.
  await chrome.scripting.unregisterContentScripts({ ids: siteIds(origin) }).catch(() => {});
}

// Reconcile registrations with intent: approvedOrigins + instance origins stay
// (re)registered; anything else of ours is retired (e.g. the previous instance
// origin after a serverUrl change).
async function syncSiteActivation() {
  const { approvedOrigins = [] } = await chrome.storage.local.get("approvedOrigins");
  const wanted = new Set([...(await instanceOrigins()), ...approvedOrigins]);
  const wantedIds = new Set([...wanted].flatMap(siteIds));
  const ours = (await chrome.scripting.getRegisteredContentScripts()).filter((s) => s.id.startsWith("oauth3-"));
  for (const s of ours) if (!wantedIds.has(s.id)) await chrome.scripting.unregisterContentScripts({ ids: [s.id] }).catch(() => {});
  let siteError = "";
  for (const o of wanted) {
    try { await registerOrigin(o); }
    catch (e) { console.warn("[sites]", o, e?.message || e); siteError = `${o}: ${e?.message || e}`; }
  }
  // last registration error, if any — surfaced in the popup's site card
  await chrome.storage.local.set({ siteError });
}
chrome.runtime.onInstalled.addListener(syncSiteActivation);
chrome.runtime.onStartup.addListener(syncSiteActivation);
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && (ch.serverUrl || ch.approvedOrigins)) syncSiteActivation();
});

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg?.action === "sync-now") {
    syncAll().then((results) => send({ ok: true, results })).catch((e) => send({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg?.action === "sync-plugin") {
    nodeOf().then((n) => syncOne(n, msg.plugin)).then((r) => send({ ok: true, ...r })).catch((e) => send({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg?.action === "add-jar") {
    (async () => {
      const { jars = {} } = await chrome.storage.local.get("jars");
      if (!jars[msg.plugin]) { jars[msg.plugin] = { lastSync: 0 }; await chrome.storage.local.set({ jars }); }
      return syncOne(await nodeOf(), msg.plugin);
    })().then((r) => send({ ok: true, ...r })).catch((e) => send({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg?.action === "remove-jar") {
    (async () => {
      const { jars = {}, jarDomains = {} } = await chrome.storage.local.get(["jars", "jarDomains"]);
      delete jars[msg.plugin]; delete jarDomains[msg.plugin];
      await chrome.storage.local.set({ jars, jarDomains });
    })().then(() => send({ ok: true })).catch((e) => send({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg?.action === "provider-connect") {
    providerConnect(msg.opts).then(send).catch((e) => send({ error: String(e.message || e) }));
    return true;
  }
  if (msg?.action === "site-info") {
    (async () => {
      const { approvedOrigins = [], siteError = "" } = await chrome.storage.local.get(["approvedOrigins", "siteError"]);
      return { ok: true, instanceOrigins: await instanceOrigins(), approvedOrigins, siteError };
    })().then(send).catch((e) => send({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg?.action === "approve-site") {
    // Direct path (grant already held — no prompt, popup alive): activate now.
    activateOrigin(msg.origin)
      .then(() => { if (msg.tabId) chrome.tabs.reload(msg.tabId); })
      .then(() => send({ ok: true }))
      .catch((e) => send({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg?.action === "arm-approve-site") {
    // The popup fires this BEFORE chrome.permissions.request (fire-and-forget):
    // the "Allow … on <origin>" prompt CLOSES the popup, so the popup's own
    // continuation dies with it. The grant itself drives the activation — poll
    // for it (user-scale wait), then activate + reload the tab. No grant within
    // 90s = the user answered "No"/closed the prompt: do nothing.
    (async () => {
      const pattern = sitePattern(msg.origin);
      for (let i = 0; i < 90; i++) {
        if (await chrome.permissions.contains({ origins: [pattern] })) {
          await activateOrigin(msg.origin);
          if (msg.tabId) chrome.tabs.reload(msg.tabId);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    })().catch((e) => console.warn("[sites]", e?.message || e));
    return false; // no sendResponse — the asking popup may already be gone
  }
  if (msg?.action === "revoke-site") {
    (async () => {
      if ((await instanceOrigins()).includes(msg.origin)) throw new Error("the instance's own origin is always active");
      await deactivateOrigin(msg.origin);
      if (msg.tabId) chrome.tabs.reload(msg.tabId);
    })().then(() => send({ ok: true })).catch((e) => send({ ok: false, error: String(e.message || e) }));
    return true;
  }
});

// --- Auto-sync: keep the TEE's jar fresh ---

const RESYNC_ALARM = "resync";
const autoAll = () => syncAll().catch((e) => console.warn("[autosync]", e.message || e));
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create(RESYNC_ALARM, { periodInMinutes: 30 }); autoAll(); });
chrome.runtime.onStartup.addListener(autoAll);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === RESYNC_ALARM) autoAll(); });

let debounce;
chrome.cookies.onChanged.addListener(async ({ cookie }) => {
  const { jarDomains = {} } = await chrome.storage.local.get("jarDomains");
  const cd = cookie.domain.replace(/^\./, "");
  const hit = Object.keys(jarDomains).filter((pid) => jarDomains[pid].some((d) => { const dd = d.replace(/^\./, ""); return cd === dd || cd.endsWith("." + dd); }));
  if (!hit.length) return;
  clearTimeout(debounce);
  debounce = setTimeout(async () => { const n = await nodeOf(); for (const pid of hit) syncOne(n, pid).catch((e) => console.warn("[autosync]", e.message || e)); }, 1000);
});
