import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const boardRoot = fileURLToPath(new URL("../../src/board/", import.meta.url));
const sourceFiles = (folder: string): ReadonlyArray<string> => readdirSync(folder).flatMap((name) => {
  const path = join(folder, name);
  return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
});

it("6.4 the board leaves mode-specific delivery to the engine interface (breaks if board code imports the runner or event log, reads runMode, or constructs DeliveryQueued)", () => {
  const violations = sourceFiles(boardRoot).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const matches = [
      ...(source.matchAll(/from\s+["'][^"']*(?:\/runner\/|log\/EventLog)[^"']*["']/g)),
      ...(source.matchAll(/\brunMode\b/g)),
      ...(source.matchAll(/_tag\s*:\s*["']DeliveryQueued["']/g)),
    ];
    return [...matches].map((match) => `${path.slice(boardRoot.length)}:${match.index}`);
  });
  expect(violations).toEqual([]);
});
