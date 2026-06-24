// Grabs the WHOLE cookie jar for a plugin's domains (unlike openfeedling, which
// filtered to named YouTube cookies) and syncs it to the plugin server. Syncs on
// demand (popup), on relevant cookie changes (debounced), and on a periodic alarm —
// so the jar the TEE holds stays fresh for always-on polling.

const DEFAULT_HOMESERVER = "https://915c8197b20b831c52cf97a9fb7e2e104cdc6ae8-8080.dstack-pha-prod7.phala.network/oauth3";

// The wallet's identity. Default: a random userKey kept in extension storage (the
// localStorage analog) → a per-user subject on the homeserver. No passkey, no owner
// secret imposed. An owner secret, if set in the popup, overrides for admin use.
// The session is cached and reused (sessions persist on the node's data volume).
async function walletBearer(node) {
  const { secret, walletSession } = await chrome.storage.local.get(["secret", "walletSession"]);
  if (secret) return secret;
  if (walletSession) return walletSession;
  let { userKey } = await chrome.storage.local.get("userKey");
  if (!userKey) {
    userKey = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    await chrome.storage.local.set({ userKey });
  }
  const r = await fetch(`${node}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userKey }) });
  if (!r.ok) throw new Error(`wallet login ${r.status}`);
  const { session, subject } = await r.json();
  await chrome.storage.local.set({ walletSession: session, walletSubject: subject });
  return session;
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
    const s = await fetch(`${node}/api/cookies`, { method: "POST", headers: auth, body: JSON.stringify({ plugin: opts.plugin, cookies: jar }) });
    if (!s.ok) return { error: `cookie sync ${s.status}` };
  }
  const conn = await (await fetch(`${node}/api/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plugin: opts.plugin, app: opts.app, subject: opts.subject }) })).json();
  await fetch(`${node}/api/connect/${conn.requestId}/approve`, { method: "POST", headers: auth, body: "{}" });
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

async function syncCookies() {
  const { serverUrl, plugin } = await chrome.storage.local.get(["serverUrl", "plugin"]);
  const node = (serverUrl || DEFAULT_HOMESERVER).replace(/\/$/, "");
  if (!plugin) {
    await chrome.storage.local.set({ lastSync: Date.now(), lastSyncOk: false, lastSyncError: "not configured" });
    return { skipped: "not-configured" };
  }
  const domains = await pluginDomains(node, plugin);
  await chrome.storage.local.set({ syncDomains: domains }); // cached for cookie-change matching
  const jar = await grabJar(domains);
  const count = Object.keys(jar).length;
  if (!count) {
    await chrome.storage.local.set({ lastSync: Date.now(), lastSyncOk: false, lastSyncError: `no cookies for ${domains.join(",")}`, lastSyncCount: 0 });
    return { skipped: "no-cookies" };
  }
  const bearer = await walletBearer(node);
  const r = await fetch(`${node}/api/cookies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${bearer}` },
    body: JSON.stringify({ plugin, cookies: jar }),
  });
  const ok = r.ok;
  const err = ok ? "" : `${r.status} ${(await r.text().catch(() => "")).slice(0, 100)}`;
  await chrome.storage.local.set({ lastSync: Date.now(), lastSyncOk: ok, lastSyncCount: count, lastSyncError: err, lastSyncPlugin: plugin });
  return { ok, status: r.status, count };
}

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg?.action === "sync-now") {
    syncCookies().then((r) => send({ ok: true, ...r })).catch((e) => send({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg?.action === "provider-connect") {
    providerConnect(msg.opts).then(send).catch((e) => send({ error: String(e.message || e) }));
    return true;
  }
});

// --- Auto-sync: keep the TEE's jar fresh ---

const RESYNC_ALARM = "resync";
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create(RESYNC_ALARM, { periodInMinutes: 30 }); syncCookies().catch((e) => console.warn("[autosync]", e.message || e)); });
chrome.runtime.onStartup.addListener(() => syncCookies().catch((e) => console.warn("[autosync]", e.message || e)));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === RESYNC_ALARM) syncCookies().catch((e) => console.warn("[autosync]", e.message || e)); });

let debounce;
chrome.cookies.onChanged.addListener(async ({ cookie }) => {
  const { syncDomains } = await chrome.storage.local.get("syncDomains");
  if (!syncDomains?.length) return;
  const cd = cookie.domain.replace(/^\./, "");
  const match = syncDomains.some((d) => { const dd = d.replace(/^\./, ""); return cd === dd || cd.endsWith("." + dd); });
  if (!match) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => syncCookies().catch((e) => console.warn("[autosync]", e.message || e)), 1000);
});
