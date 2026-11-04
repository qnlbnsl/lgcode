import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
registerRebuildCheck({ noLog: true });

it("B01 sheepdog services use the in-process entry point and cannot reach a raw writer, runner or SQL client", () => {
  const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []);
  const violations: string[] = [];
  for (const path of files(resolve("packages/engine/src/roles/sheepdog"))) {
    const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    for (const match of source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)(["'])([^"']+)\1/g)) {
      if (/(?:log\/EventLog|runner\/|effect\/sql|commands\/CommandHandler)/.test(match[2]!)) violations.push(`${path}: ${match[2]}`);
    }
  }
  expect(violations).toEqual([]);
});
