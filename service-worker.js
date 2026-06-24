// Grabs the WHOLE cookie jar for a plugin's domains (unlike openfeedling, which
// filtered to named YouTube cookies) and syncs it to the plugin server. Syncs on
// demand (popup), on relevant cookie changes (debounced), and on a periodic alarm —
// so the jar the TEE holds stays fresh for always-on polling.

async function pluginDomains(serverUrl, pluginId) {
  const r = await fetch(`${serverUrl}/api/plugins`);
  if (!r.ok) throw new Error(`/api/plugins ${r.status}`);
  const { plugins } = await r.json();
  const p = plugins.find((x) => x.id === pluginId);
  if (!p) throw new Error(`server has no plugin "${pluginId}"`);
  return p.cookieDomains;
}

async function grabJar(domains) {
  const jar = {};
  for (const d of domains) {
    for (const c of await chrome.cookies.getAll({ domain: d })) jar[c.name] = c.value;
  }
  return jar;
}

async function syncCookies() {
  const { serverUrl, secret, plugin } = await chrome.storage.local.get(["serverUrl", "secret", "plugin"]);
  if (!serverUrl || !secret || !plugin) {
    await chrome.storage.local.set({ lastSync: Date.now(), lastSyncOk: false, lastSyncError: "not configured" });
    return { skipped: "not-configured" };
  }
  const domains = await pluginDomains(serverUrl, plugin);
  await chrome.storage.local.set({ syncDomains: domains }); // cached for cookie-change matching
  const jar = await grabJar(domains);
  const count = Object.keys(jar).length;
  if (!count) {
    await chrome.storage.local.set({ lastSync: Date.now(), lastSyncOk: false, lastSyncError: `no cookies for ${domains.join(",")}`, lastSyncCount: 0 });
    return { skipped: "no-cookies" };
  }
  const r = await fetch(`${serverUrl}/api/cookies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${secret}` },
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
