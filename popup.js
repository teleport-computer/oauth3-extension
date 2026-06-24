const $ = (id) => document.getElementById(id);
const status = (msg, ok) => { const s = $("status"); s.textContent = msg; s.className = ok ? "ok" : "err"; };

// Default homeserver (the matrix.org-equivalent) — so the instance URL is NOT
// something you paste. Override only in the advanced field if self-hosting.
const DEFAULT_HOMESERVER = "https://915c8197b20b831c52cf97a9fb7e2e104cdc6ae8-8080.dstack-pha-prod7.phala.network/oauth3";

let PLUGINS = [];
// chrome.cookies only returns cookies for sites the extension has host access to,
// so syncing a plugin requires host permission for its cookie domains.
// Need both the apex and the wildcard: "*.otter.ai" does NOT match "otter.ai".
const originsFor = (id) => (PLUGINS.find((p) => p.id === id)?.cookieDomains || [])
  .flatMap((d) => { const h = d.replace(/^\./, ""); return [`https://${h}/*`, `https://*.${h}/*`]; });

// Federation pin: trust the code measurement, not the operator. Check the hosting
// daemon's recorded tree_hash for this project against an allowlist before syncing.
async function verifyInstance(daemon, project, allow) {
  try {
    const r = await fetch(`${daemon}/_api/projects/${project}`);
    if (!r.ok) return { ok: false, error: `verify: daemon ${r.status}` };
    const th = (await r.json()).tree_hash || "";
    if (!allow.includes(th)) return { ok: false, error: `untrusted measurement (${th.slice(0, 10) || "none"})` };
    return { ok: true };
  } catch (e) { return { ok: false, error: `verify failed: ${e.message}` }; }
}

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
  const cfg = await chrome.storage.local.get(["serverUrl", "secret", "plugin", "daemon", "project", "allow", "lastSyncOk", "lastSyncCount", "lastSyncError"]);
  $("serverUrl").value = cfg.serverUrl || DEFAULT_HOMESERVER;
  $("secret").value = cfg.secret || "";
  $("daemon").value = cfg.daemon || "";
  $("project").value = cfg.project || "";
  $("allow").value = cfg.allow || "";
  await loadPlugins($("serverUrl").value, cfg.plugin);
  if (cfg.lastSyncOk) status(`last sync: ${cfg.lastSyncCount} cookies`, true);
  else if (cfg.lastSyncError) status(`last sync: ${cfg.lastSyncError}`, false);

  // Auto-persist EVERY change so the popup never loses what you typed on blur/close.
  for (const id of ["serverUrl", "secret", "plugin", "daemon", "project", "allow"]) {
    const save = () => chrome.storage.local.set(cfgFromForm());
    $(id).addEventListener("input", save);
    $(id).addEventListener("change", save);
  }
})();

$("serverUrl").addEventListener("change", () => loadPlugins($("serverUrl").value, $("plugin").value));

function cfgFromForm() {
  return {
    serverUrl: $("serverUrl").value.replace(/\/$/, ""), secret: $("secret").value, plugin: $("plugin").value,
    daemon: $("daemon").value.replace(/\/$/, ""), project: $("project").value.trim(), allow: $("allow").value.trim(),
  };
}

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set(cfgFromForm());
  status("saved", true);
});

$("sync").addEventListener("click", async () => {
  const c = cfgFromForm();
  const origins = originsFor(c.plugin); // request host access first (preserves the click gesture)
  try { if (c.daemon) origins.push(new URL(c.daemon).origin + "/*"); } catch { /* invalid daemon URL surfaces at verify */ }
  if (origins.length && !(await chrome.permissions.request({ origins }))) {
    status(`host permission needed to read ${c.plugin} cookies`, false);
    return;
  }
  if (c.daemon && c.project && c.allow) {
    const v = await verifyInstance(c.daemon, c.project, c.allow.split(",").map((s) => s.trim()).filter(Boolean));
    if (!v.ok) { status(`instance not trusted — ${v.error}`, false); return; }
  }
  await chrome.storage.local.set(c);
  const r = await chrome.runtime.sendMessage({ action: "sync-now" });
  if (r.ok && r.count) status(`synced ${r.count} cookies`, true);
  else status(r.error || r.skipped || "sync failed", false);
});
