import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { appendSetup, seedAgent } from "../support/handlerRig.ts";
import { run as runReadRig, snapshotFor, event, permissionFor, questionFor, bytes } from "./support/readRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const run = <A>(program: Effect.Effect<A, any, any>) => runReadRig(program, registerRebuildCheck());

it("3.1 a 200-agent, 100-request team with full display text stays below 4 MiB and cuts UTF-8 names and teams", async () => run(Effect.gen(function* () {
  for (let i = 0; i < 200; i++) yield* seedAgent({ id: `agent-${i}`, groups: Array.from({ length: 12 }, (_, g) => `team-${g}-${"界".repeat(80)}`) });
  yield* appendSetup([event({ _tag: "AgentStarted", agentId: "long-name", name: "界".repeat(1000), role: "worker", groups: [], parent: { _tag: "owner" }, harness: "first", account: "primary", permission: "ask", folder: "/tmp/project", runMode: "acp" })]);
  for (let i = 0; i < 100; i++) yield* appendSetup([
    permissionFor(`p-${i}`, { agentId: `agent-${i}`, description: "\"\\\n界".repeat(2000), options: Array.from({ length: 20 }, (_, j) => ({ id: `option-${j}`, name: "界".repeat(500), kind: "allow_once", level: "ask", persistent: false })) }),
    questionFor(`q-${i}`, { agentId: `agent-${i}`, text: "界".repeat(2000) }),
  ]);
  const reply = yield* snapshotFor();
  expect(reply.agents).toHaveLength(201);
  expect(reply.requests).toHaveLength(100);
  expect(reply.questions).toHaveLength(100);
  expect(reply.requests.every((row: any) => row.display !== undefined)).toBe(true);
  expect(bytes(reply)).toBeLessThan(4 * 1024 * 1024);
  for (const row of reply.agents) {
    expect(Buffer.byteLength(row.name)).toBeLessThanOrEqual(64);
    expect(row.groups.length).toBeLessThanOrEqual(8);
    expect(row.groups.reduce((n: number, group: string) => n + Buffer.byteLength(group), 0)).toBeLessThanOrEqual(128);
    expect(row.name + row.groups.join("")).not.toContain("\ufffd");
  }
})));
