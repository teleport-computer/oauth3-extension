// Injected into the page (MAIN world) so app sites can call the wallet directly:
//   const token = await window.oauth3.connect({ plugin: "otter", app: "my-otter" });
// MetaMask-style provider. The actual work (consent, cookie-copy, approval) happens
// in the extension; this just relays the request and awaits the token.
(() => {
  if (window.oauth3) return;
  let seq = 0;
  const pending = new Map();
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.__oauth3 !== "resp") return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    d.error ? p.reject(new Error(d.error)) : p.resolve(d.token);
  });
  window.oauth3 = {
    isOauth3Wallet: true,
    connect(opts = {}) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        window.postMessage({ __oauth3: "req", id, opts }, "*");
      });
    },
  };
})();
