const $ = (id) => document.getElementById(id);
const status = (msg, ok) => { const s = $("status"); s.textContent = msg; s.className = ok ? "ok" : "err"; };

let PLUGINS = [];
// chrome.cookies only returns cookies for sites the extension has host access to,
// so syncing a plugin requires host permission for its cookie domains.
const originsFor = (id) => (PLUGINS.find((p) => p.id === id)?.cookieDomains || [])
  .map((d) => `https://*.${d.replace(/^\./, "")}/*`);

async function loadPlugins(serverUrl, selected) {
  const sel = $("plugin");
  sel.innerHTML = "";
  try {
    const r = await fetch(`${serverUrl}/api/plugins`);
    const { plugins } = await r.json();
    PLUGINS = plugins;
    for (const p of plugins) {
      const o = document.createElement("option");
      o.value = p.id; o.textContent = p.label;
      if (p.id === selected) o.selected = true;
      sel.appendChild(o);
    }
  } catch (e) {
    const o = document.createElement("option");
    o.textContent = `(can't reach server: ${e.message})`;
    sel.appendChild(o);
  }
}

(async () => {
  const cfg = await chrome.storage.local.get(["serverUrl", "secret", "plugin", "lastSyncOk", "lastSyncCount", "lastSyncError"]);
  $("serverUrl").value = cfg.serverUrl || "http://localhost:3000";
  $("secret").value = cfg.secret || "";
  await loadPlugins($("serverUrl").value, cfg.plugin);
  if (cfg.lastSyncOk) status(`last sync: ${cfg.lastSyncCount} cookies`, true);
  else if (cfg.lastSyncError) status(`last sync: ${cfg.lastSyncError}`, false);
})();

$("serverUrl").addEventListener("change", () => loadPlugins($("serverUrl").value, $("plugin").value));

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({ serverUrl: $("serverUrl").value.replace(/\/$/, ""), secret: $("secret").value, plugin: $("plugin").value });
  status("saved", true);
});

$("sync").addEventListener("click", async () => {
  const plugin = $("plugin").value;
  const origins = originsFor(plugin); // request host access first (preserves the click gesture)
  if (origins.length && !(await chrome.permissions.request({ origins }))) {
    status(`host permission needed to read ${plugin} cookies`, false);
    return;
  }
  await chrome.storage.local.set({ serverUrl: $("serverUrl").value.replace(/\/$/, ""), secret: $("secret").value, plugin });
  const r = await chrome.runtime.sendMessage({ action: "sync-now" });
  if (r.ok && r.count) status(`synced ${r.count} cookies`, true);
  else status(r.error || r.skipped || "sync failed", false);
});
