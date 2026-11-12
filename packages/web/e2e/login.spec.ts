import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { withBrowserWeb } from "../../engine/test/support/browserWeb.ts";

test("5.5 browser login: catches a cookie that cannot authenticate a native WebSocket without a custom header", async ({ page }) => {
  await withBrowserWeb(async ({ origin, password }) => {
    await page.goto(origin);
    const status = await page.evaluate(async (password) => (await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
    })).status, password);
    expect(status >= 200 && status < 300).toBe(true);
    expect(await page.evaluate(() => document.cookie)).toBe("");
    expect(await page.evaluate(async () => (await fetch("/api/session", { method: "POST" })).status)).toBe(204);
    const opened = await page.evaluate(() => new Promise<boolean>((resolve) => {
      const socket = new WebSocket(`${location.origin.replace("http:", "ws:")}/api`);
      const timer = setTimeout(() => { socket.close(); resolve(false); }, 3_000);
      socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(true); };
      socket.onerror = () => { clearTimeout(timer); resolve(false); };
    }));
    expect(opened).toBe(true);
  });
});

test("5.5 external link: catches requiring a Strict session cookie on the initial cross-site static navigation", async ({ page }) => {
  await withBrowserWeb(async ({ origin, password }) => {
    await page.goto(origin);
    await page.evaluate(async (password) => { await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }); }, password);
    const outside = createServer((_request, response) => { response.setHeader("Content-Type", "text/html"); response.end(`<a href="${origin}">Open LGTM Studio</a>`); });
    await new Promise<void>((resolve, reject) => { outside.once("error", reject); outside.listen(0, "127.0.0.1", resolve); });
    try {
      const port = (outside.address() as import("node:net").AddressInfo).port;
      // localhost and 127.0.0.1 are different sites. A second port on
      // 127.0.0.1 alone would not exercise SameSite=Strict.
      await page.goto(`http://localhost:${port}`);
      const navigation = page.waitForRequest((request) => request.isNavigationRequest() && request.url().startsWith(origin));
      await page.getByRole("link", { name: "Open LGTM Studio" }).click();
      const firstRequest = await navigation;
      expect((await firstRequest.allHeaders())["cookie"]).toBeUndefined();
      await expect(page).toHaveTitle("LGTM Studio browser fixture");
      expect(await page.evaluate(async () => (await fetch("/api/session", { method: "POST" })).status)).toBe(204);
      expect(await page.evaluate(() => new Promise<boolean>((resolve) => {
        const socket = new WebSocket(`${location.origin.replace("http:", "ws:")}/api`);
        const timer = setTimeout(() => { socket.close(); resolve(false); }, 3_000);
        socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(true); };
        socket.onerror = () => { clearTimeout(timer); resolve(false); };
      }))).toBe(true);
    } finally { outside.closeAllConnections(); await new Promise<void>((resolve) => outside.close(() => resolve())); }
  });
});
