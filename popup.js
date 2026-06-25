const $ = (id) => document.getElementById(id);
const status = (msg, ok) => { const s = $("status"); s.textContent = msg; s.className = ok ? "ok" : "err"; };
// A stale/old service worker won't answer new message types → sendMessage resolves
// undefined. Surface that instead of a cryptic "reading 'ok' of undefined".
async function call(msg) {
  const r = await chrome.runtime.sendMessage(msg);
  if (!r) throw new Error("no reply from service worker — reload the extension at chrome://extensions");
  return r;
}

// Default homeserver (the matrix.org-equivalent) — so the instance URL is NOT
// something you paste. Override only in Advanced if self-hosting.
const DEFAULT_HOMESERVER = "https://915c8197b20b831c52cf97a9fb7e2e104cdc6ae8-8080.dstack-pha-prod7.phala.network/oauth3";

let PLUGINS = [];        // from /api/plugins
let REACHABLE = false;

const node = () => ($("serverUrl").value || DEFAULT_HOMESERVER).replace(/\/$/, "");
const labelFor = (id) => PLUGINS.find((p) => p.id === id)?.label || id;
// chrome.cookies only returns cookies for sites the extension has host access to,
// so a jar needs host permission for its cookie domains. Need both apex and
// wildcard: "*.otter.ai" does NOT match "otter.ai".
const originsFor = (id) => (PLUGINS.find((p) => p.id === id)?.cookieDomains || [])
  .flatMap((d) => { const h = d.replace(/^\./, ""); return [`https://${h}/*`, `https://*.${h}/*`]; });

const ago = (ts) => { if (!ts) return "never"; const s = Math.floor((Date.now() - ts) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };

const FRESH_MS = 35 * 60 * 1000; // auto-resync is every 30m; past that a jar is stale
function health(j) {
  if (!j || !j.lastSync) return ["#999", "syncing…"];
  if (!j.ok) return ["#dc2626", j.error || "sync failed"];
  if (Date.now() - j.lastSync > FRESH_MS) return ["#d97706", `stale · ${j.count} cookies · ${ago(j.lastSync)}`];
  return ["#16a34a", `${j.count} cookies · ${ago(j.lastSync)}`];
}

// Federation pin: trust the code measurement, not the operator. If a daemon/project/
// allowlist is configured, check the recorded tree_hash before syncing anything.
async function verifyInstance(daemon, project, allow) {
  try {
    const r = await fetch(`${daemon}/_api/projects/${project}`);
    if (!r.ok) return { ok: false, error: `verify: daemon ${r.status}` };
    const th = (await r.json()).tree_hash || "";
    if (!allow.includes(th)) return { ok: false, error: `untrusted measurement (${th.slice(0, 10) || "none"})` };
    return { ok: true };
  } catch (e) { return { ok: false, error: `verify failed: ${e.message}` }; }
}
async function ensureTrusted() {
  const d = $("daemon").value.replace(/\/$/, ""), p = $("project").value.trim(), a = $("allow").value.trim();
  if (!(d && p && a)) return true;
  const v = await verifyInstance(d, p, a.split(",").map((s) => s.trim()).filter(Boolean));
  if (!v.ok) { status(`instance not trusted — ${v.error}`, false); return false; }
  return true;
}

async function loadPlugins() {
  try { PLUGINS = (await (await fetch(`${node()}/api/plugins`)).json()).plugins; REACHABLE = true; }
  catch { PLUGINS = []; REACHABLE = false; }
}

async function render() {
  const { jars = {} } = await chrome.storage.local.get("jars");
  let host = ""; try { host = new URL(node()).host; } catch { /* shown as empty */ }
  $("instDot").style.background = REACHABLE ? "#16a34a" : "#dc2626";
  $("instText").textContent = REACHABLE ? `instance reachable — ${host}` : `can't reach instance — ${host}`;

  const ids = Object.keys(jars);
  $("empty").hidden = ids.length > 0;
  $("jars").innerHTML = ids.map((id) => { const [color, text] = health(jars[id]);
    return `<div class="jar" data-plugin="${id}"><span class="dot" style="background:${color}"></span>` +
      `<span class="jname">${labelFor(id)}</span><span class="jstat">${text}</span>` +
      `<button class="x" title="remove">✕</button></div>`; }).join("");

  const avail = PLUGINS.filter((p) => !ids.includes(p.id));
  $("addPlugin").innerHTML = avail.length
    ? avail.map((p) => `<option value="${p.id}">${p.label}</option>`).join("")
    : `<option value="">(no more sites)</option>`;
  $("addBtn").disabled = !avail.length;
}

$("jars").addEventListener("click", async (e) => {
  const row = e.target.closest(".jar"); if (!row) return;
  const id = row.dataset.plugin;
  if (e.target.classList.contains("x")) {
    await chrome.runtime.sendMessage({ action: "remove-jar", plugin: id });
    chrome.permissions.remove({ origins: originsFor(id) }); // best-effort cleanup
    return render();
  }
  row.classList.add("busy");
  try {
    const r = await call({ action: "sync-plugin", plugin: id });
    if (!r.ok) status(r.error || "sync failed", false);
  } catch (e) { status(String(e.message || e), false); }
  await render();
});

$("addBtn").addEventListener("click", async () => {
  const id = $("addPlugin").value; if (!id) return;
  try {
    // permissions.request MUST be the first await — Chrome consumes the click
    // gesture on any prior await, then throws "may only be called during a user gesture".
    const origins = originsFor(id);
    if (origins.length && !(await chrome.permissions.request({ origins }))) {
      status(`host permission needed to read ${labelFor(id)} cookies`, false); return;
    }
    if (!(await ensureTrusted())) return;
    const r = await call({ action: "add-jar", plugin: id });
    status(r.ok ? `${labelFor(id)}: ${r.error || `${r.count} cookies`}` : (r.error || "add failed"), r.ok && !r.error);
    await render();
  } catch (e) { status(String(e.message || e), false); }
});

$("syncAll").addEventListener("click", async () => {
  if (!(await ensureTrusted())) return;
  $("syncAll").disabled = true; $("syncAll").textContent = "Syncing…";
  try {
    const r = await call({ action: "sync-now" });
    if (!r.ok) status(r.error || "sync failed", false);
  } catch (e) { status(String(e.message || e), false); }
  $("syncAll").disabled = false; $("syncAll").textContent = "Sync all now";
  await render();
});

const advCfg = () => ({
  serverUrl: $("serverUrl").value.replace(/\/$/, ""), secret: $("secret").value,
  daemon: $("daemon").value.replace(/\/$/, ""), project: $("project").value.trim(), allow: $("allow").value.trim(),
});
$("saveAdv").addEventListener("click", async () => { await chrome.storage.local.set(advCfg()); status("saved", true); await loadPlugins(); await render(); });
$("serverUrl").addEventListener("change", async () => { await chrome.storage.local.set(advCfg()); await loadPlugins(); await render(); });

(async () => {
  const cfg = await chrome.storage.local.get(["serverUrl", "secret", "daemon", "project", "allow", "walletSubject"]);
  $("serverUrl").value = cfg.serverUrl || DEFAULT_HOMESERVER;
  $("secret").value = cfg.secret || ""; $("daemon").value = cfg.daemon || "";
  $("project").value = cfg.project || ""; $("allow").value = cfg.allow || "";
  if (cfg.walletSubject) $("ident").textContent = `wallet identity: ${cfg.walletSubject}`;
  for (const id of ["secret", "daemon", "project", "allow"]) $(id).addEventListener("input", () => chrome.storage.local.set(advCfg()));
  await loadPlugins();
  await render();
})();
