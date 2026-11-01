import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageNames = ["contracts", "client", "engine", "cli", "mcp", "testing"];

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 60_000,
    testTimeout: 60_000,
    allowOnly: !process.env["CI"],
    retry: 0,
    setupFiles: [fileURLToPath(new URL("./scripts/test-environment.ts", import.meta.url))],
    fakeTimers: {
      toFake: [
        "setTimeout", "clearTimeout", "setInterval", "clearInterval",
        "setImmediate", "clearImmediate", "Date", "performance",
        "requestAnimationFrame", "cancelAnimationFrame",
        "requestIdleCallback", "cancelIdleCallback",
      ],
    },
    projects: [
      ...packageNames.map((name) => ({
        test: {
          name,
          include: [`packages/${name}/**/*.{test,spec}.ts`],
        },
      })),
      {
        test: {
          name: "third-party",
          include: ["third_party/t3code/**/*.{test,spec}.ts"],
        },
      },
    ],
  },
});
