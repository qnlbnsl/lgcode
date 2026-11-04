import * as Contracts from "../../src/index.ts";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as RpcSchema from "effect/rpc/RpcSchema";
import { expect, it } from "vitest";
import { accessTable, clientCommands, clientTags, definitions } from "./support.ts";

it("2.1/2.2 client declarations are complete, unique and namespaced alongside the engine", () => {
  const group = definitions();
  expect([...group.requests.keys()].sort()).toEqual([...clientCommands].sort());
  const names = [...Contracts.CommandsRpcGroup.requests.keys()];
  const uninstalled = [...group.requests.keys()].filter((name) => !names.includes(name));
  expect(new Set([...names, ...uninstalled]).size).toBe(names.length + uninstalled.length);
  for (const name of Contracts.engineCommandNames) expect(name === "debug.compare-views" || !name.includes(".")).toBe(true);
  const tags = (ast: SchemaAST.AST): string[] => SchemaAST.isUnion(ast) ? ast.types.flatMap(tags)
    : ast._tag === "Objects" ? ast.propertySignatures.filter((p) => p.name === "_tag")
      .map((p) => SchemaAST.isLiteral(p.type) ? String(p.type.literal) : "INVALID") : [];
  const all = tags(Contracts.Event.ast);
  expect(all.filter((tag) => tag.startsWith("client.")).sort()).toEqual([...clientTags].sort());
  expect(new Set(all).size).toBe(all.length);
  for (const marker of ["client.Checkpoint", "client.Oversized"]) expect(Schema.is(Contracts.Event)({ _tag: marker, sequence: 1 })).toBe(false);
});

it.each(clientCommands)("2.9 %s has exactly the caller kinds specified in contract section 5", (name) => {
  const expected = ["client.snapshot", "client.roster", "client.thread", "client.subscribe", "client.event"].includes(name)
    ? ["owner", "agent", "service"] : name === "client.sequence" ? ["owner", "service"] : ["owner"];
  expect(accessTable()[name]).toEqual(expected);
});

it("2.5 only the four agent reads qualify as client MCP tools, excluding streams and alert dismissal", () => {
  const access = accessTable();
  expect(Object.keys(access).sort()).toEqual([...clientCommands].sort());
  const tools = [...definitions().requests].filter(([tag, rpc]) => access[tag]?.includes("agent")
    && !RpcSchema.isStreamSchema(rpc.successSchema) && !tag.endsWith("set-token")).map(([tag]) => tag);
  expect(tools.sort()).toEqual(["client.event", "client.roster", "client.snapshot", "client.thread"]);
});

it.each(clientTags)("2.9 %s is installed as owner-only visibility", (tag) => {
  expect((Contracts.eventVisibility as Record<string, string>)[tag]).toBe("owner-only");
});
