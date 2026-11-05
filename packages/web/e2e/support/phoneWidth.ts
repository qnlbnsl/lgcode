import { expect, type Page } from "@playwright/test"

export async function assertPhoneWidth(page: Page, name: string) {
  await expect(page.locator("html")).toHaveJSProperty("clientWidth", 360)
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
  expect(widths.document, `${name}: document overflows`).toBeLessThanOrEqual(widths.viewport)
  expect(widths.body, `${name}: body overflows`).toBeLessThanOrEqual(widths.viewport)
}
