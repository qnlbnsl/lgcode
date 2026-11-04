// Unit 3, criterion 3.1: the command list, the owner-only list, and the request and reply
// schemas of every command. Rests on decisions rows 55 and 62.
import * as Schema from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import * as RpcSchema from "effect/rpc/RpcSchema"
import { describe, expect, it } from "vitest"

import {
  commandAccess,
  engineCommandNames as commandNames,
  CommandsRpcGroup,
  DebugRpcGroup,
  ownerOnlyCommands,
  ServiceRpcGroup
} from "../src/commands.ts"
import { EventEnvelope } from "../src/events.ts"

// The lists as written in plan criterion 3.1 and decisions row 55. They are copied here on purpose:
// the test must not read the lists it checks from the code under test.
const expectedCommands = [
  "start",
  "prompt",
  "answer",
  "pass-up",
  "ask",
  "wait",
  "stop",
  "resume",
  "compact",
  "group",
  "accounts",
  "accounts set-secret",
  "accounts mark-available",
  "harnesses",
  "subscribe",
  "debug.compare-views"
]

// Row 55 names `accounts set-secret`, `accounts mark-available` and `debug.compare-views` outright
// and says every other owner-only command is excluded too. Reading: the owner-only commands are the
// three named ones plus the two that change accounts and harness settings as a whole (`accounts`,
// `harnesses`). `subscribe` is agent-callable (criterion 7.3: an agent's `subscribe` sees its own
// events) but is not offered as an MCP tool because a stream cannot be a tool.
const expectedWebCommands = ["client.web.settings", "client.web.settings.set"]
const expectedAllCommands = [...expectedCommands, ...expectedWebCommands]
const expectedOwnerOnly = ["client.web.settings", "client.web.settings.set", "accounts", "accounts set-secret", "accounts mark-available", "harnesses", "debug.compare-views"]

const expectedMcpOffered = ["start", "prompt", "answer", "pass-up", "ask", "wait", "stop", "resume", "compact", "group"]

const sorted = (values: ReadonlyArray<string>) => [...values].sort()

// The property names of every variant of an object schema (a plain struct is one variant,
// a union of structs is one per member). Anything else gives no variants.
const variantsOf = (ast: SchemaAST.AST): ReadonlyArray<ReadonlyArray<SchemaAST.PropertySignature>> => {
  if (SchemaAST.isUnion(ast)) return ast.types.flatMap(variantsOf)
  if (ast._tag === "Objects") return [ast.propertySignatures]
  return []
}

const rpcFor = (name: string) => {
  const rpc = CommandsRpcGroup.requests.get(name)
  if (rpc === undefined) throw new Error(`no Rpc for command "${name}"`)
  return rpc
}

describe("command lists", () => {
  // Catches: a command dropped, renamed or added in `commandNames` (the list is exact, with no duplicates).
  it("lists exactly the sixteen commands of row 55", () => {
    expect(commandNames).toHaveLength(expectedCommands.length)
    expect(sorted(commandNames)).toEqual(sorted(expectedCommands))
    expect(new Set(commandNames).size).toBe(commandNames.length)
  })

  // Catches: a command made owner-only by mistake (an agent loses it) or made agent-callable
  // by mistake (an agent could set a secret or change a harness).
  it("lists exactly the owner-only commands, with no duplicates", () => {
    expect(sorted(ownerOnlyCommands)).toEqual(sorted(expectedOwnerOnly))
    expect(new Set(ownerOnlyCommands).size).toBe(ownerOnlyCommands.length)
  })

  // Catches: a command with no access tag, a tag naming something else, or a tag that
  // disagrees with the owner-only list (two sources of truth that drift apart).
  it("assigns caller kinds to every command, agreeing with the owner-only list", () => {
    expect(sorted(Object.keys(commandAccess))).toEqual(sorted(expectedAllCommands))
    for (const name of expectedAllCommands) {
      const kinds = commandAccess[name as keyof typeof commandAccess]
      expect(kinds).toEqual(expectedOwnerOnly.includes(name) ? ["owner"] : ["prompt", "compact", "resume", "subscribe"].includes(name) ? ["owner", "agent", "service"] : ["owner", "agent"])
    }
  })

  // Catches: a secret-setting command offered to agents. Row 55 asserts the MCP list against an
  // explicit list; this derives it the way unit 7 will (agent-callable, minus the stream).
  it("leaves exactly ten commands for the MCP server once subscribe and the owner-only ones are removed", () => {
    const offered = commandNames.filter((name) => (commandAccess[name] as ReadonlyArray<string>).includes("agent") && name !== "subscribe")
    expect(sorted(offered)).toEqual(sorted(expectedMcpOffered))
    for (const excluded of ["subscribe", "accounts set-secret", "accounts mark-available", "debug.compare-views"]) {
      expect(offered, excluded).not.toContain(excluded)
    }
  })
})

describe("command RPC group", () => {
  // Catches: a command with no `Rpc` (the API cannot serve it) or an `Rpc` for a command not in the list.
  it("has one Rpc per command, tagged with the command name", () => {
    expect(sorted([...CommandsRpcGroup.requests.keys()])).toEqual(sorted(expectedAllCommands))
    for (const name of expectedAllCommands) expect(rpcFor(name)._tag).toBe(name)
  })

  // Catches: a request that carries no request id (a retried request could not be matched to its
  // reply, and the idempotency of writes is lost), or one where the id is optional.
  it.each(expectedAllCommands)("%s: every variant of the request carries a required request id", (name) => {
    const variants = variantsOf(rpcFor(name).payloadSchema.ast)
    expect(variants.length, "payload must be a struct or a union of structs").toBeGreaterThan(0)
    for (const properties of variants) {
      const id = properties.find((property) => property.name === "requestId")
      expect(id, "requestId property").toBeDefined()
      expect(id!.type.context?.isOptional ?? false, "requestId must not be optional").toBe(false)
    }
  })

  // Catches: a request id typed as anything (a number, an empty string) instead of the shared
  // `RequestId` shape: a non-empty string.
  it.each(expectedAllCommands)("%s: the request id accepts a non-empty string and rejects other values", (name) => {
    for (const properties of variantsOf(rpcFor(name).payloadSchema.ast)) {
      const id = properties.find((property) => property.name === "requestId")!
      const decode = Schema.decodeUnknownSync(Schema.make<Schema.Codec<string>>(id.type))
      expect(decode("req-1")).toBe("req-1")
      expect(() => decode(""), "empty").toThrow()
      expect(() => decode(7), "number").toThrow()
    }
  })

  // Catches: a reply that does not echo the request id, so a client cannot pair a reply with its
  // request. `subscribe` is exempt: its reply is a stream of events (checked below).
  it.each(expectedAllCommands.filter((name) => name !== "subscribe"))(
    "%s: every variant of the reply carries a request id",
    (name) => {
      const variants = variantsOf(rpcFor(name).successSchema.ast)
      expect(variants.length, "reply must be a struct or a union of structs").toBeGreaterThan(0)
      for (const properties of variants) {
        expect(properties.map((property) => property.name), name).toContain("requestId")
      }
    }
  )

  // Catches: `subscribe` modelled as a single reply (a client would get one snapshot and no live
  // events), or any other command accidentally modelled as a stream (it would never complete).
  it("makes subscribe, and only subscribe, a streaming command", () => {
    for (const name of expectedAllCommands) {
      expect(RpcSchema.isStreamSchema(rpcFor(name).successSchema), name).toBe(name === "subscribe")
    }
  })
})

describe("the groups the service serves (fix round 1, item 4)", () => {
  const debugCommand = "debug.compare-views"
  const withoutDebug = expectedAllCommands.filter((name) => name !== debugCommand)

  // Catches: the production group being only a comment: `ServiceRpcGroup` missing, or still holding the
  // debug command (row 74: it is served only behind the test flag), or missing another command.
  it("ServiceRpcGroup has the 17 commands and not debug.compare-views", () => {
    expect(ServiceRpcGroup, "ServiceRpcGroup export").toBeDefined()
    expect(ServiceRpcGroup.requests.size).toBe(17)
    expect(ServiceRpcGroup.requests.has(debugCommand)).toBe(false)
    expect(sorted([...ServiceRpcGroup.requests.keys()])).toEqual(sorted(withoutDebug))
  })

  // Catches: the full inventory (the CLI and clients) losing the debug command when the service group was cut.
  it("CommandsRpcGroup keeps all 18 commands", () => {
    expect(CommandsRpcGroup.requests.size).toBe(18)
    expect(CommandsRpcGroup.requests.has(debugCommand)).toBe(true)
  })

  // Catches: the debug group holding anything but the one debug command (it would be served behind the
  // flag with other commands).
  it("DebugRpcGroup has only debug.compare-views", () => {
    expect([...DebugRpcGroup.requests.keys()]).toEqual([debugCommand])
  })
})

describe("subscribe items (fix round 1, item 5)", () => {
  // Catches: `subscribe` streaming bare events, so a client gets no sequence number to resume from and no
  // time or caller. Its stream items are the shared `EventEnvelope`.
  it("streams EventEnvelope items", () => {
    const success = rpcFor("subscribe").successSchema
    expect(RpcSchema.isStreamSchema(success)).toBe(true)
    if (!RpcSchema.isStreamSchema(success)) return
    expect(success.success.ast).toBe(EventEnvelope.ast)
  })
})
