import { expect, test } from "@playwright/test"
import { createServer as createViteServer } from "vite"

test("7.3 the 360-pixel login page has no horizontal overflow", async ({ page }) => {
  const server = await createViteServer({
    configFile: false,
    root: new URL("..", import.meta.url).pathname,
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "silent"
  })
  try {
    await server.listen()
    const address = server.httpServer?.address()
    if (address === null || address === undefined || typeof address === "string") throw new Error("Vite did not bind a TCP port")
    await page.setViewportSize({ width: 360, height: 800 })
    await page.route("**/api/session", (route) => route.fulfill({ status: 401 }))
    await page.goto(`http://127.0.0.1:${address.port}/`)
    await expect(page.getByRole("form", { name: "Log in" })).toBeVisible()
    const widths = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth
    }))
    expect(widths.document).toBeLessThanOrEqual(widths.viewport) // catches fixed-width page content that forces sideways phone scrolling
    expect(widths.body).toBeLessThanOrEqual(widths.viewport)
  } finally {
    await server.close()
  }
})
