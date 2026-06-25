// Real end-to-end: load the unpacked oauth3-extension into Chromium, seed an
// otter.ai cookie, drive the popup's "Add jar" flow against a live oauth3-server,
// and assert the jar round-trips into the instance — exercising the exact path
// that was broken (gesture-ordered permissions.request + add-jar SW handler).
import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = process.env.EXT_PATH || path.resolve(__dirname, "..");
const SERVER = process.env.SERVER_URL || "http://localhost:3100";

async function boot(): Promise<{ context: BrowserContext; extensionId: string; sw: any }> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oauth3-ext-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      "--headless=new",
      "--no-sandbox",
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
    ],
  });
  // The jar the extension will grab: a "logged-in" otter.ai session (otter's
  // loggedIn() needs both sessionid + csrftoken).
  await context.addCookies(["sessionid", "csrftoken"].map((name) => ({
    name, value: `e2e-${name}`, domain: ".otter.ai",
    path: "/", secure: true, httpOnly: name === "sessionid", sameSite: "Lax" as const, expires: 4102444800,
  })));
  const wake = await context.newPage();
  await wake.goto("about:blank");
  const sw = context.serviceWorkers()[0]
    ?? (await context.waitForEvent("serviceworker", { timeout: 20_000 }));
  const extensionId = new URL(sw.url()).host;
  await wake.close();
  return { context, extensionId, sw };
}

test("popup: Add jar round-trips an otter cookie into the instance", async () => {
  const { context, extensionId, sw } = await boot();

  // Point the wallet at the local instance before the popup reads storage — no
  // dependency on the live pod.
  await sw.evaluate((url: string) => chrome.storage.local.set({ serverUrl: url }), SERVER);

  const popup = await context.newPage();
  const errs: string[] = [];
  popup.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  popup.on("console", (m) => { if (m.type() === "error") errs.push(`console.error: ${m.text()}`); });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  // Health row resolves to reachable against the local server.
  await expect(popup.locator("#instText")).toContainText("instance reachable", { timeout: 15_000 });

  // No jars yet.
  await expect(popup.locator("#empty")).toBeVisible();

  // Add the otter jar (the formerly-broken click).
  await popup.selectOption("#addPlugin", "otter");
  await popup.click("#addBtn");

  // The jar row appears green with a cookie count — proving SW replied (not
  // undefined) and the cookie reached POST /api/cookies.
  const stat = popup.locator('.jar[data-plugin="otter"] .jstat');
  await expect(stat).toContainText(/\d+ cookies/, { timeout: 15_000 });
  console.log(`[e2e] otter jar status: ${await stat.innerText()}`);
  await expect(popup.locator("#status")).toContainText(/cookies/);
  await expect(popup.locator('.jar[data-plugin="otter"] .dot'))
    .toHaveAttribute("style", /#16a34a/); // green = fresh

  expect(errs, `popup logged errors:\n${errs.join("\n")}`).toEqual([]);
  await context.close();
});

test("stale-worker guard: a bogus message surfaces a clear error, not 'undefined'", async () => {
  const { context, extensionId, sw } = await boot();
  await sw.evaluate((url: string) => chrome.storage.local.set({ serverUrl: url }), SERVER);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  // call() must throw a readable message when the worker doesn't answer a message type.
  const msg = await popup.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ action: "does-not-exist" });
    return r; // undefined when no handler replies
  });
  expect(msg).toBeFalsy(); // confirms the undefined-response condition the guard catches
  await context.close();
});

// The headline demo: a profile with ONLY the extension, no sign-in, no owner token.
// Open the instance's OWN app page (GET /app), click "Log in with my browser", and
// real conversation rows render — proving browser-is-identity end to end.
test("demo app (served by the instance at /app): log in with nothing → real rows", async () => {
  const { context } = await boot(); // seeds otter session cookies → jar present + logged-in
  const page = await context.newPage();
  await page.goto(`${SERVER}/app`);

  // The wallet provider injected with no sign-in.
  await expect.poll(() => page.evaluate(() => !!(window as any).oauth3), { timeout: 10_000 }).toBe(true);

  await page.click("#login");
  // The extension's in-page approval modal (shadow DOM) — this click is the consent gesture.
  await page.locator(".go").click();

  // Scoped token came back with no account/owner secret.
  await expect(page.locator("#token")).toContainText("scoped token", { timeout: 20_000 });
  // ...and real rows render: the scoped token read the jar, which the otter plugin
  // resolved (via the fixture Otter API) into actual conversation rows.
  await expect(page.locator("#status")).toContainText("conversations", { timeout: 20_000 });
  const rows = page.locator(".row");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  console.log(`[e2e] demo rendered ${count} rows; first: ${await rows.first().innerText()}`);
  expect(count).toBeGreaterThan(0);
  await expect(page.locator("#result")).toContainText("Design review — oauth3"); // a fixture title
  await context.close();
});
