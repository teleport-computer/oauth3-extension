const $ = (id) => document.getElementById(id);
const status = (msg, ok) => { const s = $("status"); s.textContent = msg; s.className = ok ? "note" : "note bad"; };
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
// Freshness maps to design-system pill states (ok/warn/bad); "" = neutral pending.
function health(j) {
  if (!j || !j.lastSync) return ["", "syncing…"];
  if (!j.ok) return ["bad", j.error || "sync failed"];
  if (Date.now() - j.lastSync > FRESH_MS) return ["warn", `stale · ${j.count} · ${ago(j.lastSync)}`];
  return ["ok", `${j.count} · ${ago(j.lastSync)}`];
}

// #14: a plugin may now hold several account-qualified jars. The server is the source
// of truth — GET /api/plugins returns jars: [{account, updatedAt, count}] — so render
// one pill per account instead of a single present/absent badge. pill state from the
// jar's updatedAt (auto-resync keeps it fresh); a jar with no updatedAt isn't synced yet.
function jarHealth(j) {
  if (!j || !j.updatedAt) return ["", j?.account ? `${j.account} · pending` : "no jar"];
  const stale = Date.now() - j.updatedAt > FRESH_MS;
  return [stale ? "warn" : "ok", `${j.account} · ${j.count} · ${ago(j.updatedAt)}`];
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
  // #14: jar status is per-identity — the server returns jars: [] for an anonymous
  // caller. Authenticate with the wallet session (cached on first sync) so the
  // subject's account-qualified jars actually come back.
  const { walletSession, secret } = await chrome.storage.local.get(["walletSession", "secret"]);
  const headers = secret ? { Authorization: `Bearer ${secret}` } : walletSession ? { Authorization: `Bearer ${walletSession}` } : {};
  try { PLUGINS = (await (await fetch(`${node()}/api/plugins`, { headers })).json()).plugins; REACHABLE = true; }
  catch { PLUGINS = []; REACHABLE = false; }
}

async function render() {
  const { jars = {} } = await chrome.storage.local.get("jars");
  let host = ""; try { host = new URL(node()).host; } catch { /* shown as empty */ }
  $("instDot").className = "dot " + (REACHABLE ? "ok" : "bad");
  $("instText").textContent = REACHABLE ? `instance reachable — ${host}` : `can't reach instance — ${host}`;

  const ids = Object.keys(jars);
  $("empty").hidden = ids.length > 0;
  $("jars").innerHTML = ids.map((id) => {
    const serverJars = PLUGINS.find((p) => p.id === id)?.jars || [];
    // #14: one pill per account the server holds for this plugin. When the server
    // lists none yet (never synced, or wallet not authed), fall back to the local
    // subscription state so the row still reports the last sync / error.
    const acct = serverJars.length
      ? serverJars.map((j) => { const [st, txt] = jarHealth(j); return `<span class="pill ${st}">${txt}</span>`; }).join("")
      : `<span class="pill ${health(jars[id])[0]}">${health(jars[id])[1]}</span>`;
    return `<div class="jar" data-plugin="${id}">` +
      `<div class="jhead"><span class="jname">${labelFor(id)}</span><button class="x" title="remove">✕</button></div>` +
      `<div class="jstat">${acct}</div></div>`;
  }).join("");

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
    // #14: name the account the jar was stored under (from the sync response).
    if (!r.ok) status(r.error || "sync failed", false);
    else status(`${labelFor(id)}: account ${r.account ?? "default"} · ${r.count} cookies`, true);
  } catch (e) { status(String(e.message || e), false); }
  await loadPlugins(); // #14: re-fetch so the new account-qualified jar renders.
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
    // #14: surface the account the jar landed under, not just the cookie count.
    status(r.ok ? `${labelFor(id)}: account ${r.account ?? "default"} · ${r.error || `${r.count} cookies`}` : (r.error || "add failed"), r.ok && !r.error);
    await loadPlugins();
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
  await loadPlugins(); // #14: re-fetch so account-qualified jars reflect the sync.
  await render();
});

const advCfg = () => ({
  serverUrl: $("serverUrl").value.replace(/\/$/, ""), secret: $("secret").value,
  daemon: $("daemon").value.replace(/\/$/, ""), project: $("project").value.trim(), allow: $("allow").value.trim(),
});
// #29: if the instance moves off the statically-granted hosts (localhost/phala),
// ask for its origin now — the wallet must inject there (login/dashboard) without a
// manual site-approve. permissions.request is the first await: the click is the
// gesture, and it resolves silently when the grant already holds.
$("saveAdv").addEventListener("click", async () => {
  let origin = ""; try { origin = new URL($("serverUrl").value).origin; } catch { /* invalid URL: saved as-is, surfaced by the health line */ }
  if (origin && !(await chrome.permissions.request({ origins: [`${origin}/*`] }))) {
    status(`no host permission for ${origin} — the wallet can't inject there`, false); return;
  }
  await chrome.storage.local.set(advCfg()); status("saved", true); await loadPlugins(); await render(); await renderSite();
});
// No permission prompt on auto-save (a change event isn't a gesture the prompt
// accepts) — the registration follows via storage.onChanged; the grant is what
// Save asks for.
$("serverUrl").addEventListener("change", async () => { await chrome.storage.local.set(advCfg()); await loadPlugins(); await render(); await renderSite(); });

// --- #29: per-site activation ("Use OAuth3 here") ---
// The provider (window.oauth3) is injected only on origins approved here (dynamic
// content-script registration + a per-origin host grant, both restart-durable) and
// on the instance's own origin. Opening the popup is the activeTab gesture that
// makes the active tab's URL visible.
let SITE = { origin: "", tabId: 0, instance: false, approved: false };

async function renderSite() {
  const info = await call({ action: "site-info" }).catch(() => null);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let origin = ""; try { origin = tab?.url ? new URL(tab.url).origin : ""; } catch { /* chrome://, file:// … */ }
  const instance = !!info?.instanceOrigins?.includes(origin);
  const approved = !!info?.approvedOrigins?.includes(origin);
  SITE = { origin, tabId: tab?.id || 0, instance, approved };
  $("siteOrigin").textContent = origin || "(no page)";
  const st = $("siteState");
  if (!origin) { st.textContent = "not a site"; st.className = "pill"; }
  else if (instance) { st.textContent = "instance · always on"; st.className = "pill ok"; }
  else if (approved) { st.textContent = "active"; st.className = "pill ok"; }
  else { st.textContent = "not active"; st.className = "pill"; }
  $("useHere").hidden = !origin || instance || approved;
  $("revokeSite").hidden = !origin || instance || !approved;
  const perm = origin ? await chrome.permissions.contains({ origins: [`${origin}/*`] }) : false;
  $("sitePerm").textContent = origin ? `host permission: ${perm ? "granted" : "none"}` : "";
}

$("useHere").addEventListener("click", async () => {
  const { origin, tabId } = SITE; if (!origin) return;
  // permissions.request MUST be the first await — the click is the gesture, and the
  // "Allow OAuth3 to read and change <site>?" prompt IS the approval. Registration
  // and the reload run in the worker so they survive the popup closing on the prompt.
  if (!(await chrome.permissions.request({ origins: [`${origin}/*`] }))) {
    status(`no host permission — the wallet stays off ${origin}`, false); return;
  }
  try {
    const r = await call({ action: "approve-site", origin, tabId });
    if (!r.ok) { status(r.error || "could not approve site", false); return; }
    status(`${origin} approved — reloading…`, true);
  } catch (e) { status(String(e.message || e), false); }
  await renderSite();
});

$("revokeSite").addEventListener("click", async () => {
  const { origin, tabId } = SITE; if (!origin) return;
  try {
    await chrome.permissions.remove({ origins: [`${origin}/*`] }); // drop the grant first…
    const r = await call({ action: "revoke-site", origin, tabId }); // …then scripts + list in the worker
    if (!r.ok) { status(r.error || "could not revoke site", false); return; }
    status(`${origin} revoked — reloading…`, true);
  } catch (e) { status(String(e.message || e), false); }
  await renderSite();
});

(async () => {
  const cfg = await chrome.storage.local.get(["serverUrl", "secret", "daemon", "project", "allow", "walletSubject"]);
  $("serverUrl").value = cfg.serverUrl || DEFAULT_HOMESERVER;
  $("secret").value = cfg.secret || ""; $("daemon").value = cfg.daemon || "";
  $("project").value = cfg.project || ""; $("allow").value = cfg.allow || "";
  if (cfg.walletSubject) $("ident").textContent = `wallet identity: ${cfg.walletSubject}`;
  for (const id of ["secret", "daemon", "project", "allow"]) $(id).addEventListener("input", () => chrome.storage.local.set(advCfg()));
  await loadPlugins();
  await render();
  await renderSite();
})();
