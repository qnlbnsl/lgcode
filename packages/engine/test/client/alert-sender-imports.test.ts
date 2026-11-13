import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

export const alertFiles = () => {
  const root = "packages/engine/src/client";
  const files: string[] = [];
  const walk = (path: string) => { for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) walk(child); else if (entry.name.endsWith(".ts")) files.push(child);
  } };
  walk(root); return files;
};

it("6.7 alert rules cannot import concrete carriers; only carrier configuration can import the registry", () => {
  registerRebuildCheck({ noLog: true });
  expect(existsSync("packages/engine/src/client/alerts/AlertSender.ts"), "6b must introduce the carrier boundary").toBe(true);
  const bad: string[] = [];
  for (const file of alertFiles().filter((path) => !path.includes("/carriers/"))) {
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
      (token) => token.startsWith("//") || token.startsWith("/*") ? " " : token);
    const imports = source.matchAll(/(?:\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?|\b(?:import|require)\s*\(\s*)["']([^"']+)["']/g);
    for (const match of imports) {
      // Configuration validates destinations and binds secrets through the
      // registry. Alert source and delivery rules still use AlertSender only.
      if (file.endsWith("/alerts/token.ts") && match[1] === "./carriers/index.ts") continue;
      if (/(?:^|\/)(?:carriers|ntfy)(?:\/|\.|$)/.test(match[1]!)) bad.push(relative("packages/engine/src/client", file));
    }
  }
  expect(bad).toEqual([]);
});
