import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { withBrowserWeb } from "../../engine/test/support/browserWeb.ts";

test("5.4 real foreign origin: catches accepting an authenticated cross-origin WebSocket upgrade", async ({ context }) => {
  await withBrowserWeb(async ({ origin, password }) => {
    const own = await context.newPage();
    await own.goto(origin);
    await own.evaluate(async (password) => { await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }); }, password);
    const outside = createServer((_request, response) => { response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><title>Foreign page</title>"); });
    await new Promise<void>((resolve, reject) => { outside.once("error", reject); outside.listen(0, "127.0.0.1", resolve); });
    try {
      const page = await context.newPage();
      const port = (outside.address() as import("node:net").AddressInfo).port;
      // A different port is a different origin but the same site. Chromium's
      // developer protocol may hide HttpOnly cookies in handshake headers.
      // The Node Origin tests separately assert refusal with a valid cookie.
      await page.goto(`http://127.0.0.1:${port}`);
      const network = await context.newCDPSession(page);
      await network.send("Network.enable");
      let upgradeStatus: number | undefined;
      network.on("Network.webSocketFrameError", ({ errorMessage }) => {
        const status = /Unexpected response code: (\d{3})/.exec(errorMessage)?.[1];
        if (status !== undefined) upgradeStatus ??= Number(status);
      });
      network.on("Network.webSocketHandshakeResponseReceived", ({ response }) => { upgradeStatus = response.status; });
      const result = await page.evaluate((target) => new Promise<{ opened: boolean; settled: boolean }>((resolve) => {
        const socket = new WebSocket(`${target.replace("http:", "ws:")}/api`);
        const timer = setTimeout(() => { socket.close(); resolve({ opened: false, settled: false }); }, 3_000);
        socket.onopen = () => { clearTimeout(timer); socket.close(); resolve({ opened: true, settled: true }); };
        socket.onerror = () => { clearTimeout(timer); resolve({ opened: false, settled: true }); };
      }), origin);
      expect(result).toEqual({ opened: false, settled: true });
      await expect.poll(() => upgradeStatus).toBe(403);
      expect(await own.evaluate(async () => (await fetch("/api/session", { method: "POST" })).status)).toBe(204);
    } finally { outside.closeAllConnections(); await new Promise<void>((resolve) => outside.close(() => resolve())); }
  });
});
