import * as Contracts from "../src/index.ts";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { expect, it } from "vitest";

import { fixtureLists, loadLists, type EngineLists } from "../../engine/test/support/fixturePiece.ts";
import { definitions } from "./client/support.ts";
import { commandNames as boardCommands, samples as boardEvents } from "./board/fixtures.ts";

it("board 1.8 every real board declaration is registered once in the full API with its namespace intact", async () => {
  const lists = await loadLists();
  assertDeclarations(lists);
  const commands = lists.commandGroups.filter((entry) => entry.namespace === "board").flatMap((entry) => [...entry.group.requests.keys()]);
  const events = lists.eventGroups.filter((entry) => entry.namespace === "board").flatMap((entry) => declaredTags(entry.events));
  expect(commands.sort()).toEqual([...boardCommands].sort());
  expect(events.sort()).toEqual(boardEvents.map((event) => event._tag).sort());
});

const engineNames = [
  "start", "prompt", "answer", "pass-up", "ask", "wait", "cancel-reply", "stop", "resume", "release", "compact", "group",
  "accounts", "accounts set-secret", "accounts mark-available", "harnesses", "subscribe", "debug.compare-views",
];
// Walk member declarations, rather than toTaggedUnion().cases, which has
// already collapsed duplicate tags. The same rule applies before RPC merge.
const declaredTags = (schema: Schema.Top): string[] => {
  if ("members" in schema) return (schema.members as ReadonlyArray<Schema.Top>).flatMap(declaredTags);
  const ast = schema.ast;
  if (ast._tag !== "Objects") throw new Error("Event declaration must be a tagged struct");
  const tag = ast.propertySignatures.find((p) => p.name === "_tag")?.type;
  if (tag === undefined || !SchemaAST.isLiteral(tag) || typeof tag.literal !== "string") throw new Error("Event needs a literal tag");
  return [tag.literal];
};
const assertDeclarations = (lists: EngineLists) => {
  const names = lists.commandGroups.flatMap(({ namespace, group }) => [...group.requests.keys()].map((name) => {
    if (namespace !== "engine") expect(name, `Command in ${namespace}`).toMatch(new RegExp(`^${namespace}\\.`));
    return name;
  }));
  const tags = lists.eventGroups.flatMap(({ namespace, events }) => declaredTags(events).map((tag) => {
    if (namespace !== "engine") expect(tag, `Event in ${namespace}`).toMatch(new RegExp(`^${namespace}\\.`));
    return tag;
  }));
  expect(names.length, "Duplicate command declaration before merge").toBe(new Set(names).size);
  expect(tags.length, "Duplicate event declaration before union indexing").toBe(new Set(tags).size);
  expect([...lists.commands.requests.keys()].sort()).toEqual([...names].sort());
  expect(declaredTags(lists.event).sort()).toEqual([...tags].sort());
};

it("1a E1 preserves the engine inventory independently of later piece commands", () => {
  expect((Contracts as unknown as { engineCommandNames: unknown }).engineCommandNames).toEqual(engineNames);
});

it("FR-052 E1 composes declarations and merged request blocks in engine, client, board, roles, project order", async () => {
  const lists = await loadLists();
  const order = ["engine", "client", "board", "roles", "project"];
  expect(Contracts.commandGroups.map(({ namespace }) => namespace)).toEqual(order);
  expect(lists.commandGroups.map(({ namespace }) => namespace)).toEqual(order);
  const blockOrder = (names: ReadonlyArray<string>) => names.map((name) => {
    if (name.startsWith("client.")) return "client";
    if (name.startsWith("board.")) return "board";
    if (name.startsWith("roles.")) return "roles";
    if (name.startsWith("project.")) return "project";
    return "engine";
  }).filter((namespace, index, all) => index === 0 || namespace !== all[index - 1]);
  expect(blockOrder([...Contracts.CommandsRpcGroup.requests.keys()])).toEqual(order);
  expect(blockOrder([...lists.commands.requests.keys()])).toEqual(order);
});

it("1.3 checks every constituent declaration before merge, with a real prefixed fixture group", async () => {
  assertDeclarations(fixtureLists(await loadLists()));
});

it("2.1/2.2 checks the full client definitions against every other group before merge, including commands not yet installed", async () => {
  const lists = await loadLists();
  const client = definitions();
  assertDeclarations({ ...lists,
    commandGroups: [...lists.commandGroups.filter(({ namespace }) => namespace !== "client"), { namespace: "client", group: client }],
    commands: lists.commands.merge(client),
  });
  for (const { namespace, events } of lists.eventGroups) {
    if (namespace === "engine") for (const tag of declaredTags(events)) expect(tag.includes("."), `Engine tag ${tag}`).toBe(false);
  }
});

it("1.3 duplicate commands are detected even though Effect merge silently replaces them", async () => {
  const lists = fixtureLists(await loadLists());
  const duplicate = RpcGroup.make(Rpc.make("record", { success: Schema.Void })).prefix("client.");
  expect(() => assertDeclarations({ ...lists,
    commandGroups: [...lists.commandGroups, { namespace: "client", group: duplicate }],
    commands: lists.commands.merge(duplicate),
  })).toThrow(/Duplicate command declaration/);
});

it("1.3 duplicate event tags are detected before the tagged-union lookup loses them", async () => {
  const lists = fixtureLists(await loadLists());
  const duplicate = Schema.TaggedStruct("client.FixtureRecorded", {});
  expect(() => assertDeclarations({ ...lists,
    eventGroups: [...lists.eventGroups, { namespace: "client", events: duplicate }],
    event: Schema.Union([lists.event, duplicate]),
  })).toThrow(/Duplicate event declaration/);
});

it.each(["command", "event"])("1.3 rejects a %s declaration outside its owning namespace", async (kind) => {
  const lists = await loadLists();
  const bad = kind === "command" ? {
    ...lists, commandGroups: [...lists.commandGroups, { namespace: "board", group: RpcGroup.make(Rpc.make("roles.write", { success: Schema.Void })) }],
  } : {
    ...lists, eventGroups: [...lists.eventGroups, { namespace: "board", events: Schema.TaggedStruct("roles.Written", {}) }],
  };
  expect(() => assertDeclarations(bad)).toThrow(/Command in board|Event in board/);
});
