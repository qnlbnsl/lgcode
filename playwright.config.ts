import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./packages/web/e2e",
  testMatch: "**/*.{test,spec}.{ts,tsx}",
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  // Browser fixtures build bundles and start engine processes. Bound the
  // acceptance gate as well as direct Playwright invocations.
  workers: 2,
  use: {
    browserName: "chromium",
    headless: true,
  },
});
