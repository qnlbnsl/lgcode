import * as Contracts from "../../src/index.ts";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import { expect, it } from "vitest";
import { rolesCommands, rolesEvents } from "./fixtures.ts";

interface RolesContracts {
  readonly RolesRpcGroup: RpcGroup.RpcGroup<any>;
  readonly RolesEvent: Schema.Codec<any, unknown>;
  readonly rolesAccess: Record<string, ReadonlyArray<string>>;
  readonly rolesVisibility: Record<string, string>;
}
const roles = () => Contracts as unknown as RolesContracts;
const sorted = (values: Iterable<string>) => [...values].sort();
const properties = (ast: SchemaAST.AST): ReadonlyArray<ReadonlyArray<SchemaAST.PropertySignature>> =>
  SchemaAST.isUnion(ast) ? ast.types.flatMap(properties) : ast._tag === "Objects" ? [ast.propertySignatures] : [];
const tagsOf = (ast: SchemaAST.AST): ReadonlyArray<string> => {
  if (SchemaAST.isUnion(ast)) return ast.types.flatMap(tagsOf);
  const tag = ast._tag === "Objects" ? ast.propertySignatures.find((field) => field.name === "_tag")?.type : undefined;
  expect(tag !== undefined && SchemaAST.isLiteral(tag), "each roles event needs a literal tag").toBe(true);
  return tag !== undefined && SchemaAST.isLiteral(tag) ? [String(tag.literal)] : [];
};

it("G01 exposes each enabled roles command under the roles prefix in both served groups", () => {
  const group = roles().RolesRpcGroup;
  expect(group, "1b must export RolesRpcGroup").toBeDefined();
  expect(sorted(group.requests.keys())).toEqual(sorted(Object.keys(rolesCommands)));
  for (const [name, rpc] of group.requests) {
    expect(name).toMatch(/^roles\./);
    expect(rpc._tag).toBe(name);
    expect(Contracts.CommandsRpcGroup.requests.get(name)).toBe(rpc);
    expect(Contracts.ServiceRpcGroup.requests.get(name)).toBe(rpc);
  }
  expect(Contracts.commandGroups.filter((entry) => String(entry.namespace) === "roles")).toEqual([
    { namespace: "roles", group },
  ]);
});

it.each(Object.keys(rolesCommands))("G01 request ids: %s requires a nonempty requestId in every payload variant", (name) => {
  const group = roles().RolesRpcGroup;
  expect(group, "1b must export RolesRpcGroup").toBeDefined();
  const rpc = group.requests.get(name);
  expect(rpc, `missing roles RPC ${name}`).toBeDefined();
  const variants = properties(rpc!.payloadSchema.ast);
  expect(variants.length).toBeGreaterThan(0);
  for (const fields of variants) {
    const id = fields.find((field) => field.name === "requestId");
    expect(id, name).toBeDefined();
    expect(id!.type.context?.isOptional ?? false).toBe(false);
    const decode = Schema.decodeUnknownSync(Schema.make<Schema.Codec<string>>(id!.type));
    expect(decode("roles-request")).toBe("roles-request");
    for (const bad of ["", 1, null, undefined]) expect(() => decode(bad), name).toThrow();
  }
});

it("G02 denies agents and services every owner-only roles command", () => {
  expect(roles().rolesAccess).toEqual(rolesCommands);
  for (const [name, access] of Object.entries(rolesCommands)) expect(Contracts.commandAccess[name as keyof typeof Contracts.commandAccess]).toEqual(access);
});

it("G03 declares every enabled roles event owner-only in the engine visibility table", () => {
  const expected = Object.fromEntries(rolesEvents.map((event) => [event._tag, "owner-only"]));
  expect(roles().rolesVisibility).toEqual(expected);
  for (const tag of Object.keys(expected)) expect((Contracts.eventVisibility as Record<string, string>)[tag]).toBe("owner-only");
});

it.each(rolesEvents)("G04/G05 round-trips $_tag through both event unions and keeps all seven lifecycle states", (event) => {
  const declaration = roles().RolesEvent;
  expect(declaration, "1b must export RolesEvent").toBeDefined();
  for (const schema of [declaration, Contracts.Event]) {
    const decoded = Schema.decodeUnknownSync(schema)(event);
    expect(Schema.encodeSync(schema)(decoded)).toEqual(event);
  }
  for (const state of ["starting", "working", "idle", "paused", "interrupted", "crashed", "stopped"] as const) {
    expect(Contracts.eventEffect(state, event._tag as Contracts.Event["_tag"])).toBe("keep");
  }
});

it("G05 registers the roles event declaration before union indexing can hide duplicate tags", () => {
  expect(roles().RolesEvent).toBeDefined();
  expect(Contracts.eventGroups.filter((entry) => String(entry.namespace) === "roles")).toEqual([
    { namespace: "roles", events: roles().RolesEvent },
  ]);
  expect([...tagsOf(roles().RolesEvent.ast)].sort())
    .toEqual(rolesEvents.map((event) => event._tag).sort());
});
