import { type Event, rolesActionKinds } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { engineLists } from "../../src/pieces/lists.ts";
import { agentCredential, appendSetup, seedAgent } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { read, run as runReadRig } from "../client/support/readRig.ts";
import { action, bytes, event, fileEvent, fold, owner, section, start, type RolesSection } from "./fixtures.ts";

const run = <A>(program: Effect.Effect<A, any, any>) => runReadRig(program, registerRebuildCheck());
registerRebuildCheck({ noLog: true });

it("SN01 a real client.snapshot has the owner summary and leaves the roles section out for an agent", async () => run(Effect.gen(function* () {
  const agent = yield* seedAgent({ id: "worker" });
  yield* appendSetup([fileEvent("Private advice must not enter the summary."),
    event({ _tag: "roles.SettingsChanged", settings: { sheepdog: false, limits: { stallMinutes: 20 } } }),
    event({ _tag: "roles.Snoozed", group: "build", until: 1_900_000_000_000 }),
    action("StallSeen"), action("StallSeen", { occurrence: 2, sourceSequence: 3 }), action("RunawayReported"),
  ]);
  const snapshot = yield* read("client.snapshot");
  expect(snapshot.roles, "1d must install its snapshotFor in the default engine lists").toBeDefined();
  const summary = snapshot.roles as RolesSection;
  expect(summary).toMatchObject({
    roleFile: { name: "Build team", roleFileHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    settings: { sheepdog: false, limits: { stallMinutes: 20 } },
    snoozes: { items: [{ group: "build", until: 1_900_000_000_000 }], truncated: false },
    matters: { items: expect.arrayContaining([{ key: "stall:worker", kind: "roles.stall", agentId: "worker" }, { key: "runaway:worker", kind: "roles.runaway", agentId: "worker" }]), truncated: false },
    agents: { truncated: false },
  });
  expect(summary.agents.items).toHaveLength(1);
  expect(summary.agents.items[0]?.actions.map((row) => [row._tag, row.occurrence]).sort()).toEqual([
    ["roles.RunawayReported", 1], ["roles.StallSeen", 2],
  ]);
  expect(JSON.stringify(summary)).not.toContain("Private advice");
  expect(bytes(summary)).toBeLessThanOrEqual(128 * 1024);
  expect(yield* read("client.snapshot", {}, agentCredential(agent.token))).not.toHaveProperty("roles");
})));

it("SN01 services receive the bounded owner summary and a stopped agent's history stays out", () => {
  const view = fold([start("old"), action("StallSeen", { agentId: "old" }),
    event({ _tag: "AgentStopped", agentId: "old" }), start("new"), action("CacheFlushed", { agentId: "new" })]);
  const summary = section(view);
  expect(summary.agents.items.map((row) => row.agentId)).toEqual(["new"]);
  expect(section(view, { _tag: "service", service: "roles.sheepdog" })).toEqual(summary);
  expect(engineLists.snapshotSections.roles({ _tag: "agent", agentId: "new" as never }, view)).toBeUndefined();
});

const snoozes = (count: number): Event[] => Array.from({ length: count }, (_, index) => event({
  _tag: "roles.Snoozed", group: `group-${String(index).padStart(3, "0")}`, until: 1_900_000_000_000 + index,
}));

it("SN02 every list reports its own item truncation, and the agent cap keeps the newest 256", () => {
  const view = fold([...snoozes(201), ...Array.from({ length: 257 }, (_, index) => [
    start(`agent-${index}`), action("CacheFlushed", { agentId: `agent-${index}`, noticeRecipient: "lead" }),
  ]).flat()]);
  const summary = section(view);
  expect(summary.snoozes.items).toHaveLength(200);
  expect(summary.snoozes.truncated).toBe(true);
  expect(summary.agents.items).toHaveLength(256);
  expect(summary.agents.truncated).toBe(true);
  expect(summary.agents.items[0]?.agentId).toBe("agent-256");
  expect(summary.agents.items.at(-1)?.agentId).toBe("agent-1");
  expect(summary.matters).toEqual({ items: [], truncated: false });
  expect(bytes(summary)).toBeLessThanOrEqual(128 * 1024);
});

it("SN02 exactly the list maxima do not claim truncation when every item fits", () => {
  const summary = section(fold([...snoozes(200), ...Array.from({ length: 256 }, (_, index) => [
    start(`agent-${index}`), action("CacheFlushed", { agentId: `agent-${index}`, noticeRecipient: "lead" }),
  ]).flat()]));
  expect(summary.snoozes.items).toHaveLength(200);
  expect(summary.snoozes.truncated).toBe(false);
  expect(summary.agents.items).toHaveLength(256);
  expect(summary.agents.truncated).toBe(false);
  expect(bytes(summary)).toBeLessThanOrEqual(128 * 1024);
});

const crowdedRoles = (): Event[] => [
  fileEvent("A full role file's advice stays out of a summary."),
  event({ _tag: "roles.SettingsChanged", settings: { sheepdog: true, limits: { turnMinutes: 180 } } }),
  ...snoozes(200),
  ...Array.from({ length: 256 }, (_, index) => {
    const id = `agent-${String(index).padStart(3, "0")}-${"界".repeat(12)}`;
    return [start(id), ...rolesActionKinds.map((kind) => action(kind, {
      agentId: id, noticeRecipient: "lead", postId: `post-${index}-${kind}-${'"\\界'.repeat(12)}`,
      ...(kind === "GaveUp" ? { engineAlertOpen: true } : {}),
    }))];
  }).flat(),
];

it("SN02 encoded byte pressure preserves file/settings/open matters and snoozes before cutting latest actions", () => {
  const events = [...crowdedRoles(), start("owner-matter"), action("StallSeen", { agentId: "owner-matter" })];
  const summary = section(fold(events));
  expect(summary.roleFile?.name).toBe("Build team");
  expect(summary.settings).toMatchObject({ sheepdog: true, limits: { turnMinutes: 180 } });
  expect(summary.matters).toEqual({ items: [{ kind: "roles.stall", key: "stall:owner-matter", agentId: "owner-matter" }], truncated: false });
  expect(summary.snoozes.items).toHaveLength(200);
  expect(summary.snoozes.truncated).toBe(false);
  expect(summary.agents.truncated).toBe(true);
  expect(summary.agents.items.length).toBeGreaterThan(1);
  expect(summary.agents.items.length).toBeLessThan(256);
  expect(summary.agents.items[0]?.agentId).toBe("owner-matter");
  expect(summary.agents.items[1]?.agentId).toContain("agent-255-");
  expect(bytes(summary)).toBeLessThanOrEqual(128 * 1024);
  expect(bytes(summary)).toBeGreaterThan(100 * 1024);
});

it("SN02 open matters obey the same encoded cap and every shortened list admits truncation", () => {
  const events = [fileEvent(), ...snoozes(1), ...Array.from({ length: 512 }, (_, index) => {
    const agentId = `agent-${index}-${"界".repeat(12)}`;
    return [start(agentId), ...["StallSeen", "ReplaceAdvised", "RunawayReported"].map((kind) => action(kind, { agentId }))];
  }).flat()];
  const summary = section(fold(events));
  expect(summary.roleFile?.name).toBe("Build team");
  expect(summary.matters.items.length).toBeGreaterThan(0);
  expect(summary.matters.items.length).toBeLessThan(512 * 3);
  expect(summary.matters.truncated).toBe(true);
  expect(summary.snoozes.truncated).toBe(summary.snoozes.items.length < 1);
  expect(summary.agents.truncated).toBe(true);
  expect(bytes(summary)).toBeLessThanOrEqual(128 * 1024);
});

it("SN03 paged actions recover every record omitted from a bounded snapshot, newest first without duplicates", async () => run(Effect.gen(function* () {
  yield* appendSetup(crowdedRoles());
  const snapshot = yield* read("client.snapshot");
  expect(snapshot.roles, "1d must install its bounded snapshot section").toBeDefined();
  expect(snapshot.roles.agents.truncated).toBe(true);
  expect(bytes(snapshot.roles)).toBeLessThanOrEqual(128 * 1024);
  const records: any[] = [];
  let after: number | undefined;
  let pages = 0;
  do {
    const page = yield* read("roles.actions.list", { limit: 500, ...(after === undefined ? {} : { after }) });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThanOrEqual(500);
    expect(bytes(page)).toBeLessThan(256 * 1024);
    records.push(...page.items);
    if (page.next !== undefined) expect(page.next).toBeLessThan(after ?? Infinity);
    after = page.next;
    pages++;
    expect(pages).toBeLessThan(20);
  } while (after !== undefined);
  expect(records).toHaveLength(256 * 12);
  expect(new Set(records.map((row) => row.sequence)).size).toBe(records.length);
  for (let i = 1; i < records.length; i++) expect(records[i - 1].sequence).toBeGreaterThan(records[i].sequence);
  for (const row of snapshot.roles.agents.items) {
    for (const record of row.actions) expect(records).toContainEqual(record);
  }
  expect(bytes(snapshot)).toBeLessThan(4 * 1024 * 1024);
})));
