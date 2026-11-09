import { pieceNamespaces } from "@lgcode/contracts";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { loadLists } from "../support/fixturePiece.ts";
import { type Rules } from "../support/callerRules.ts";
import { emptyViews } from "../../src/views/apply.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
registerRebuildCheck({ noLog: true });

it("1.22 default tables refuse delivery and add no holds, requests or kept secrets, with the installed board and roles snapshots", async () => {
  const lists = await loadLists() as Rules;
  const state = { ...emptyViews() };
  expect(lists.reach, "E18 must install an exhaustive refusing table").toBeDefined();
  for (const namespace of pieceNamespaces) {
    expect(lists.reach[namespace]!({ target: "target", deliveryId: "delivery", source: { _tag: "piece", namespace, id: "source" }, snapshot: state })).toBe(false);
    expect(lists.sourceRules[namespace]!()).toBe("withdraw");
    expect(lists.holdUnsettled[namespace]!(state, "target", state[namespace])).toBe(false);
    expect(lists.requestHeld[namespace]!(state, "target", state[namespace])).toBe(false);
    expect(lists.secretKeep[namespace]!(state)).toEqual([]);
    const section = lists.snapshotSections[namespace]!({ _tag: "owner" }, state);
    if (namespace === "roles") expect(section).toEqual({
      roleFile: null, settings: {}, matters: { items: [], truncated: false },
      snoozes: { items: [], truncated: false }, agents: { items: [], truncated: false },
    });
    else if (namespace === "board") expect(section).toEqual({
      sequence: 0, disabled: false, truncated: false,
      holdsUnsettled: [], holdsIncoming: [], ownerHeld: [],
      posts: [], completions: [], noAnswers: [], channels: [], unread: [], wakes: [],
    });
    else if (namespace === "project") expect(section).toEqual({
      sequence: 0, truncated: false, setup: { step: "welcome" }, projects: [], repositories: [], workspaces: [], teams: [], sprints: [], tasks: [], agents: [],
    });
    else expect(section).toEqual({ pushPromptDismissed: false });
    const agentSection = lists.snapshotSections[namespace]!({ _tag: "agent", agentId: "target" }, state);
    if (namespace === "project") {
      expect(agentSection).toEqual({
        sequence: 0, truncated: false, projects: [], repositories: [], workspaces: [], teams: [], sprints: [], tasks: [], agents: [],
      });
      expect(Object.hasOwn(agentSection!, "setup")).toBe(false);
    }
    else expect(agentSection).toBeUndefined();
  }
});

// Compile a temporary fixture against the real exported type. A missing table
// property must not masquerade as the desired missing-namespace diagnostic.
it("1.22 all piece rule tables reject a missing namespace at compile time", async () => {
  const lists = await loadLists() as Rules;
  expect(lists.reach, "E18 supplies the type checked below").toBeDefined();
  const root = mkdtempSync("/tmp/lgcode-table-types-");
  const filename = join(root, "fixture.mts");
  const config = join(root, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    extends: resolve("tsconfig.base.json"),
    compilerOptions: { typeRoots: [resolve("node_modules/@types")], rewriteRelativeImportExtensions: false },
    files: [filename],
  }));
  const prelude = `import { engineLists } from ${JSON.stringify(resolve("packages/engine/src/pieces/lists.ts"))};\n`;
  const tables = ["reach", "sourceRules", "holdUnsettled", "requestHeld", "secretKeep"];
  const compile = (source: string) => {
    writeFileSync(filename, source);
    try { return { status: 0, output: execFileSync(resolve("node_modules/.bin/tsc"), ["-p", config, "--noEmit", "--pretty", "false"], { encoding: "utf8", timeout: 30_000 }) }; }
    catch (error) {
      const failed = error as { status?: number; stdout?: string; stderr?: string };
      return { status: failed.status, output: String(failed.stdout ?? "") + String(failed.stderr ?? "") };
    }
  };
  try {
    const valid = compile(prelude + tables.map((table) => `const valid_${table}: typeof engineLists.${table} = engineLists.${table};`).join("\n"));
    expect(valid.output).toBe("");
    expect(valid.status).toBe(0);
    const invalid = compile(prelude + tables.map((table) => `const { client: removed_${table}, ...missing_${table} } = engineLists.${table}; const invalid_${table}: typeof engineLists.${table} = missing_${table};`).join("\n"));
    expect(invalid.status).not.toBe(0);
    for (const index of tables.keys()) expect(invalid.output).toContain(`fixture.mts(${index + 2},`);
    expect(invalid.output).toContain("client");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
