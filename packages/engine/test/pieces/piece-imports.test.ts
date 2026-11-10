import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pieceNamespaces } from "@lgcode/contracts";
import { expect, it } from "vitest";
import { requiredModule } from "../support/callerRules.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
registerRebuildCheck({ noLog: true });

it.each(["src/project/design.ts", "src/project/lifecycle.ts", "src/pieces/lists.ts", "scripts/live/driver.ts", "src/client/alerts/reactor.ts", "src/pieces/viewTables.ts"])(
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
      const planners = engineLists.planners, reads = engineLists.reads;
      assert.equal(engineLists.planners, planners, "planner table identity must be stable");
      assert.equal(engineLists.reads, reads, "read table identity must be stable");
      for (const name of ["start", "board.post", "client.alerts.dismiss", "roles.record", "project.design.record", "project.create", "project.archive"]) {
        assert.ok(Object.hasOwn(planners, name), name);
        assert.equal(typeof planners[name], "function", name);
      }
      const { planners: corePlanners } = await import("../../src/commands/planners.ts");
      for (const name of ["project.create", "project.archive"]) {
        assert.equal(planners[name], corePlanners[name], name + " keeps its actual registration");
        // Construction must remain safe after either import order. Do not run
        // the Effect, acquire a writer or create/archive anything in this child.
        assert.ok(Effect.isEffect(planners[name](undefined, {})), name + " returns an Effect");
      }
      for (const name of ["board.status", "project.design.read"]) {
        assert.ok(Object.hasOwn(reads, name), name);
        assert.equal(typeof reads[name], "function", name);
      }
      assert.ok(engineLists.commands.requests.has("project.design.record"));
      assert.ok(engineLists.commands.requests.has("project.design.read"));
      assert.deepEqual(engineLists.access["project.design.record"], ["owner", "agent"]);
      assert.deepEqual(engineLists.access["project.design.read"], ["owner", "agent"]);
      const declared = [...engineLists.commands.requests.keys()].sort();
      assert.deepEqual([...Object.keys(planners), ...Object.keys(reads)].sort(), declared);
      assert.deepEqual(Object.keys(engineLists.access).sort(), declared);
      assert.deepEqual(Object.keys(planners).filter((name) => Object.hasOwn(reads, name)), []);
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
