import { expect, test } from "@playwright/test";

test("provides a browser document for end-to-end tests", async ({ page }) => {
  await page.setContent("<main><h1>LGTM Studio</h1></main>");
  await expect(page.getByRole("heading", { name: "LGTM Studio" })).toBeVisible();
});
