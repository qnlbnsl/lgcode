import { expect, type Page } from "@playwright/test"

export async function openNavigation(page: Page) {
  const menu = page.getByRole("button", { name: "Open navigation", exact: true })
  const navigation = page.getByRole("navigation", { name: "Projects", exact: true })
  // Login mounts the shell asynchronously. Wait for its phone or desktop entry.
  await expect(menu.or(navigation).first()).toBeVisible()
  if (await menu.isVisible() && await menu.getAttribute("aria-expanded") !== "true") await menu.click()
}
