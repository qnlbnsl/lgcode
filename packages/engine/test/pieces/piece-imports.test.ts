import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pieceNamespaces } from "@shephrd/contracts";
import { expect, it } from "vitest";
import { requiredModule } from "../support/callerRules.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
registerRebuildCheck({ noLog: true });

it("1.32 piece code cannot import or re-export the log writer or the delivery helper's internals", async () => {
  await requiredModule("commands/pieceBatch.ts");
  const files = (directory: string): string[] => {
    try { return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  };
  const violations: string[] = [];
  for (const namespace of pieceNamespaces) for (const file of files(resolve("packages/engine/src", namespace))) {
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    for (const match of source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)(["'])([^"']+)\1/g)) {
      if (/(?:log\/EventLog|routing\/pieceDelivery)(?:\.ts)?$/.test(match[2]!)) violations.push(`${file}: ${match[2]}`);
    }
  }
  expect(violations).toEqual([]);
});
