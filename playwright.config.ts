import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./packages/web/e2e",
  testMatch: "**/*.{test,spec}.{ts,tsx}",
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  use: {
    browserName: "chromium",
    headless: true,
  },
});
