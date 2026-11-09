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
  const home = mkdtempSync("/tmp/lgcode-piece-types-");
  try {
    const fixture = join(home, "fixture.mts");
    writeFileSync(fixture, `
      import type { PieceNamespace } from ${JSON.stringify(namespaces)};
      import { eventVisibility } from ${JSON.stringify(visibility)};
      import { engineLists } from ${JSON.stringify(lists)};
      import type { PiecePlan, Plan } from ${JSON.stringify(join(root, "packages/engine/src/commands/internal.ts"))};
      type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
      const exactNamespaces: Equal<PieceNamespace, "client" | "board" | "roles" | "project"> = true;
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
      import * as importEffect from ${JSON.stringify(join(root, "node_modules/effect/dist/Effect.js"))};
      import type { TestPlan, EngineLists as FixtureLists } from ${JSON.stringify(join(root, "packages/engine/test/support/fixturePiece.ts"))};
      type Registered = typeof engineLists.planners;
      // Compile real registration functions, including structural wider values.
      const make = <A,>(value: A) => importEffect.succeed(value);
      const validRegistration: Registered = { "client.fixture": () => make(valid) };
      const engineRegistration: Registered = { stop: () => make({ events: [], afterCommit: importEffect.void }) };
      const missingReply = { events: [] };
      const widerHook = { events: [], reply: () => ({}), afterCommit: importEffect.void };
      const broad: Plan = { events: [], reply: () => ({}) };
      // @ts-expect-error Piece registration must require a reply, even for wider variables.
      const badMissing: Registered = { "client.fixture": () => make(missingReply) };
      // @ts-expect-error Piece registration must reject a hook on a wider variable.
      const badHook: Registered = { "board.fixture": () => make(widerHook) };
      // @ts-expect-error The engine Plan type is too broad for a roles registration.
      const badBroad: Registered = { "roles.fixture": () => make(broad) };
      // @ts-expect-error Fixtures must also reject a wider hook as a PiecePlan.
      const badFixture: PiecePlan = widerHook;
      const validFixture: TestPlan = { events: [], reply: () => ({}) };
      // @ts-expect-error The fixture seam must reject a hook on a wider variable.
      const badTestFixture: TestPlan = widerHook;
      type FixtureRegistered = FixtureLists["planners"];
      const validFixtureRegistration: FixtureRegistered = { "client.fixture": () => make(validFixture) };
      const validEngineFixture: FixtureRegistered = { stop: () => make({ events: [], afterCommit: importEffect.void }) };
      // @ts-expect-error A piece fixture registration must require its reply.
      const badFixtureMissing: FixtureRegistered = { "client.fixture": () => make(missingReply) };
      // @ts-expect-error A piece fixture registration must reject a wider hook.
      const badFixtureHook: FixtureRegistered = { "roles.fixture": () => make(widerHook) };
      void [validFixture, badTestFixture, validFixtureRegistration, validEngineFixture, badFixtureMissing, badFixtureHook];
      void [validRegistration, engineRegistration, badMissing, badHook, badBroad, badFixture];
      void [exactNamespaces, complete, missing, incomplete, valid, noReply, hook, roles, ThreadItem];
    `);
    // A successful compilation proves the positive fixture and every expected
    // rejection. Removing a required table key check produces TS2578.
    let output = "";
    let status = 0;
    try {
      output = execFileSync(join(root, "node_modules/.bin/tsc"), [
        "--ignoreConfig", "--noEmit", "--strict", "--exactOptionalPropertyTypes", "--skipLibCheck", "--target", "ESNext",
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
