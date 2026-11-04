import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageNames = ["contracts", "client", "engine", "cli", "mcp", "testing", "web", "viewer"];

export default defineConfig({
  test: {
    environment: "node",
    // Integration tests spawn adapters, so leave capacity for their children
    // instead of starting a test worker for almost every available CPU.
    maxWorkers: Math.min(4, availableParallelism()),
    hookTimeout: 60_000,
    testTimeout: 60_000,
    allowOnly: !process.env["CI"],
    retry: 0,
    // Keep project names visible when Vitest detects an agent's environment.
    reporters: ["default"],
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
          environment: name === "web" ? "jsdom" : "node",
          include: [`packages/${name}/**/*.{test,spec}.{ts,tsx}`],
          exclude: [`packages/${name}/e2e/**`, "**/node_modules/**"],
        },
      })),
      {
        test: {
          name: "third-party",
          include: ["third_party/t3code/**/*.{test,spec}.{ts,tsx}"],
        },
      },
    ],
  },
});
