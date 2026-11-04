import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as StateMachine from "../src/stateMachine.ts";
import { expect, it } from "vitest";

it("1.29 every piece event keeps all seven lifecycle states, without an unknown-tag fallback", () => {
  const keep = (StateMachine as unknown as { keepInEveryState: (tags: ReadonlyArray<string>) => Record<string, Record<string, string>> }).keepInEveryState;
  expect(keep, "E5 needs a typed row constructor for each piece's declared tags").toBeTypeOf("function");
  const rows = keep(["client.FixtureRecorded", "board.FixtureRecorded"]);
  const want = { starting: "keep", working: "keep", idle: "keep", paused: "keep", interrupted: "keep", crashed: "keep", stopped: "keep" };
  expect(rows).toEqual({ "client.FixtureRecorded": want, "board.FixtureRecorded": want });
  expect(Object.hasOwn(rows, "unknown.Event")).toBe(false);
});

it("1.5/1.22 tables reject missing visibility and namespace entries, and a piece planner rejects afterCommit", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const namespaces = join(root, "packages/contracts/src/namespaces.ts");
  const visibility = join(root, "packages/contracts/src/visibility.ts");
  const lists = join(root, "packages/engine/src/pieces/lists.ts");
  expect(existsSync(namespaces), "E1 must define PieceNamespace").toBe(true);
  expect(existsSync(visibility), "E8 must define eventVisibility").toBe(true);
  expect(existsSync(lists), "E22 must expose the default typed lists").toBe(true);
  const home = mkdtempSync("/tmp/shephrd-piece-types-");
  try {
    const fixture = join(home, "fixture.mts");
    writeFileSync(fixture, `
      import type { PieceNamespace } from ${JSON.stringify(namespaces)};
      import { eventVisibility } from ${JSON.stringify(visibility)};
      import { engineLists } from ${JSON.stringify(lists)};
      import type { PiecePlan } from ${JSON.stringify(join(root, "packages/engine/src/commands/internal.ts"))};
      type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
      const exactNamespaces: Equal<PieceNamespace, "client" | "board" | "roles"> = true;
      const complete = engineLists.snapshotSections;
      const { roles, ...missingSection } = complete;
      // @ts-expect-error Every namespace needs its own refusing entry.
      const missing: typeof complete = missingSection;
      const { ThreadItem, ...missingVisibility } = eventVisibility;
      // @ts-expect-error Every event tag needs an explicit visibility class.
      const incomplete: typeof eventVisibility = missingVisibility;
      const valid: PiecePlan = { events: [], reply: () => ({ count: 0 }) };
      // @ts-expect-error A piece's reply must come from its committed batch.
      const noReply: PiecePlan = { events: [] };
      // @ts-expect-error A piece must not acquire an engine after-commit hook.
      const hook: PiecePlan = { events: [], reply: () => ({}), afterCommit: undefined };
      void [exactNamespaces, complete, missing, incomplete, valid, noReply, hook, roles, ThreadItem];
    `);
    // A successful compilation proves the positive fixture and every expected
    // rejection. Removing a required table key check produces TS2578.
    let output = "";
    let status = 0;
    try {
      output = execFileSync(join(root, "node_modules/.bin/tsc"), [
        "--noEmit", "--strict", "--exactOptionalPropertyTypes", "--skipLibCheck", "--target", "ESNext",
        "--module", "NodeNext", "--moduleResolution", "NodeNext", "--allowImportingTsExtensions",
        "--types", "node", "--typeRoots", join(root, "node_modules/@types"), fixture,
      ], { cwd: root, encoding: "utf8", timeout: 60_000, stdio: "pipe" });
    } catch (error) {
      const failed = error as { status?: number; stdout?: unknown; stderr?: unknown };
      status = failed.status ?? -1;
      output = String(failed.stdout ?? "") + String(failed.stderr ?? "");
    }
    expect({ status, output }, "Positive fixtures must compile and each @ts-expect-error must reject its mutation")
      .toEqual({ status: 0, output: "" });
  } finally { rmSync(home, { recursive: true, force: true }); }
});
