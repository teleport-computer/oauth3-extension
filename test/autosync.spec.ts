// #15: rate-limit cookie-change auto-sync. The acceptance's observable is the
// node's activity view — every POST /api/cookies appends a `cookies.sync` entry
// to the audit log the dashboard renders. This drives the real extension (popup
// Add jar + per-jar Sync), the real oauth3-server, and the real /dashboard
// activity feed, churning an otter.ai cookie the way Google rewrites .google.com
// cookies every few seconds. The literal 10-minute logged-in-google.com walk is
// operator-run (Google de-auths sessions replayed from a datacenter IP); this
// rig verifies the mechanism end-to-end.
import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = process.env.EXT_PATH || path.resolve(__dirname, "..");
const SERVER = process.env.SERVER_URL || "http://localhost:3100";
const DEBOUNCE_WAIT_MS = 38_000; // auto-sync debounce is 30s; wait past it

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
  // "Logged-in" otter.ai session, same shape e2e.spec.ts seeds.
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

// The observable under test: how many `cookies.sync otter` entries the node's
// audit log (the dashboard's Activity feed) holds for this wallet.
const syncCount = async (bearer: string) => {
  const r = await fetch(`${SERVER}/api/audit`, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!r.ok) throw new Error(`/api/audit ${r.status}`);
  const { audit } = await r.json() as any;
  return audit.filter((e: any) => e.action === "cookies.sync" && e.detail?.plugin === "otter").length;
};

// Rewrite a .otter.ai cookie in place (same name/domain/path → Chrome treats it
// as an overwrite and fires cookies.onChanged with cause "overwrite" — exactly
// what Google's periodic rewrites look like to the listener).
const rewriteCookie = (sw: any, value: string) =>
  sw.evaluate((v: string) => chrome.cookies.set({
    url: "https://otter.ai/", domain: ".otter.ai", name: "sessionid", value: v,
    path: "/", secure: true, httpOnly: true, sameSite: "lax", expirationDate: 4102444800,
  }), value);

// Pretend the last sync is older than the cooldown so the cooldown gate alone
// does not answer for the digest gate (and vice versa).
const backdateLastSync = (sw: any) =>
  sw.evaluate(async () => {
    const { jars = {} } = await chrome.storage.local.get("jars");
    jars.otter = { ...jars.otter, lastSync: Date.now() - 20 * 60_000 };
    await chrome.storage.local.set({ jars });
  });

test("#15: cookie churn stops flooding the activity view; explicit syncs are never rate-limited", async () => {
  test.setTimeout(420_000);
  const { context, extensionId, sw } = await boot();
  await sw.evaluate((url: string) => chrome.storage.local.set({ serverUrl: url }), SERVER);

  const popup = await context.newPage();
  const errs: string[] = [];
  popup.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator("#instText")).toContainText("instance reachable", { timeout: 15_000 });

  // Explicit act 1: add the jar — this POSTs once and records the jar digest.
  await popup.selectOption("#addPlugin", "otter");
  await popup.click("#addBtn");
  await expect(popup.locator('.jar[data-plugin="otter"]')).toBeVisible({ timeout: 15_000 });

  const sessionKey = SERVER.replace(/\/+$/, "");
  const bearer = async () => {
    const { walletSessions = {} } = await sw.evaluate(() => chrome.storage.local.get("walletSessions")) as any;
    return walletSessions[sessionKey] as string;
  };

  // Baseline: exactly the one add-jar sync.
  await expect.poll(bearer, { timeout: 15_000 }).toBeTruthy();
  await expect.poll(async () => syncCount(await bearer()), { timeout: 10_000 }).toBe(1);

  // 1. Cooldown gate: a changed cookie (digest WOULD differ) must not POST while
  //    the plugin synced moments ago. Wait past the 30s debounce so the attempt
  //    really happens and is skipped, not merely starved.
  await rewriteCookie(sw, "churn-1");
  await popup.waitForTimeout(DEBOUNCE_WAIT_MS);
  expect(await syncCount(await bearer()), "churn within cooldown → no POST").toBe(1);

  // 2. Digest gate: cooldown passed (lastSync backdated), cookie rewritten and
  //    rewritten BACK — the grabbed jar is byte-identical to the last POSTed one,
  //    so no POST fires even though a burst of change events landed.
  await backdateLastSync(sw);
  await rewriteCookie(sw, "churn-2a");
  await popup.waitForTimeout(2_000);
  await rewriteCookie(sw, "e2e-sessionid"); // back to the add-jar value
  await popup.waitForTimeout(DEBOUNCE_WAIT_MS);
  expect(await syncCount(await bearer()), "identical jar past cooldown → no POST").toBe(1);

  // 3. Control: a GENUINE change past the cooldown still POSTs — the gates rate-
  //    limit churn, they do not break auto-sync.
  await backdateLastSync(sw);
  await rewriteCookie(sw, "genuinely-new");
  await expect.poll(async () => syncCount(await bearer()), { timeout: DEBOUNCE_WAIT_MS, intervals: [5_000] })
    .toBe(2); // auto-sync landed the real change

  // 4. Manual Sync from the popup is immediate even though the plugin synced
  //    seconds ago and the jar is unchanged — an explicit act is never rate-limited.
  await popup.click('.jar[data-plugin="otter"] .jstat');
  await expect(popup.locator("#status")).toContainText(/cookies/, { timeout: 15_000 });
  await expect.poll(async () => syncCount(await bearer()), { timeout: 10_000 }).toBe(3);

  // 5. The freshness alarm path is never rate-limited either: fire the exact
  //    RESYNC_ALARM handler once (replaces the periodic alarm — throwaway profile).
  await sw.evaluate(() => chrome.alarms.create("resync", { when: Date.now() + 1_500 }));
  await expect.poll(async () => syncCount(await bearer()), { timeout: 20_000 }).toBe(4);

  expect(errs, `popup logged errors:\n${errs.join("\n")}`).toEqual([]);

  // Evidence: the extension surface (popup jar row) and the node's activity view.
  fs.mkdirSync(path.join(__dirname, "playwright-report"), { recursive: true });
  await popup.bringToFront();
  await popup.screenshot({ path: path.join(__dirname, "playwright-report", "issue-15-01-popup.png") });

  const dash = await context.newPage();
  await dash.goto(`${SERVER}/dashboard`); // no token yet → login redirect
  await dash.evaluate((t: string) => localStorage.setItem("oauth3_session", t), await bearer());
  await dash.goto(`${SERVER}/dashboard`);
  await expect(dash.locator("#acts .act", { hasText: "cookies.sync" })).toHaveCount(4, { timeout: 15_000 });
  await dash.locator("#activity").scrollIntoViewIfNeeded();
  await dash.screenshot({ path: path.join(__dirname, "playwright-report", "issue-15-02-activity.png"), fullPage: true });

  await context.close();
});
