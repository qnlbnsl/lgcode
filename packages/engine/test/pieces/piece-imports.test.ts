import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pieceNamespaces } from "@shephrd/contracts";
import { expect, it } from "vitest";
import { requiredModule } from "../support/callerRules.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
registerRebuildCheck({ noLog: true });

it.each(["scripts/live/driver.ts", "src/client/alerts/reactor.ts", "src/pieces/viewTables.ts"])(
  "FR-157 initializes all piece registrations when %s is the first plain Node import", (entry) => {
    const probe = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      await import(${JSON.stringify(`../../${entry}`)});
      const { engineLists } = await import("../../src/pieces/lists.ts");
      const Effect = await import("effect/Effect");
      for (const namespace of ["client", "board", "roles"]) {
        assert.ok(engineLists.views[namespace].empty());
        assert.equal(typeof engineLists.views[namespace].reduce, "function");
        assert.ok(Effect.isEffect(engineLists.reactors[namespace]));
      }
      for (const name of ["start", "board.post", "client.alerts.dismiss", "roles.record"]) {
        assert.equal(typeof engineLists.planners[name], "function", name);
      }
      assert.equal(typeof engineLists.reads["board.status"], "function");
    `], { cwd: import.meta.dirname, encoding: "utf8", timeout: 15_000, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
    expect({ status: probe.status, stderr: probe.stderr }).toEqual({ status: 0, stderr: "" });
  },
);

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
