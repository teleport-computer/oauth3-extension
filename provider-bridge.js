// Bridges the page's window.oauth3 (MAIN world) to the extension worker (ISOLATED
// world has chrome.runtime). On a connect request it shows ONE approval dialog —
// that click is the user gesture — then asks the worker to carry it out (copy the
// jar, connect, approve) and relays the token back to the page.

window.addEventListener("message", async (e) => {
  const d = e.data;
  if (e.source !== window || !d || d.__oauth3 !== "req") return;
  const reply = (r) => window.postMessage({ __oauth3: "resp", id: d.id, token: r?.token, error: r?.error }, "*");

  const ok = await approvalDialog(d.opts);
  if (!ok) return reply({ error: "denied by user" });
  try {
    reply(await chrome.runtime.sendMessage({ action: "provider-connect", opts: d.opts }));
  } catch (err) {
    reply({ error: String(err?.message || err) });
  }
});

function approvalDialog(opts) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.id = "oauth3-approve";
    const sr = wrap.attachShadow({ mode: "open" });
    sr.innerHTML = `
      <style>
        .bk{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center}
        .card{font:14px/1.45 system-ui,sans-serif;background:#fff;color:#111;max-width:360px;border-radius:14px;padding:22px;box-shadow:0 10px 40px rgba(0,0,0,.3)}
        h3{margin:0 0 6px} p{color:#444;margin:0 0 16px} b{color:#111}
        .row{display:flex;gap:8px} button{flex:1;padding:10px;border:0;border-radius:9px;font:600 14px system-ui;cursor:pointer}
        .go{background:#16a34a;color:#fff} .no{background:#f3f4f6;color:#111}
      </style>
      <div class=bk><div class=card>
        <h3>Authorize access</h3>
        <p><b>${(opts.app || "An app")}</b> wants to read your <b>${opts.plugin}</b> — with a scoped, revocable token, never your cookies.</p>
        <div class=row><button class=go>Connect</button><button class=no>Cancel</button></div>
      </div></div>`;
    document.documentElement.appendChild(wrap);
    sr.querySelector(".go").onclick = () => { wrap.remove(); resolve(true); };
    sr.querySelector(".no").onclick = () => { wrap.remove(); resolve(false); };
  });
}
