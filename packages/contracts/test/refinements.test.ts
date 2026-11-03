// Unit 3, fix round 1, item 7: the refinements the first tests never exercised. Each test names the
// refinement it guards (the mutation it would catch). Rests on decisions rows 33, 39 and 61 and plan task 3f.
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import { describe, expect, it } from "vitest"

import { Event, EventEnvelope } from "../src/events.ts"
import { HarnessSettings } from "../src/harnesses.ts"
import { EventSequence } from "../src/ids.ts"
import { LifecycleState } from "../src/stateMachine.ts"

const accepts = (schema: Schema.Top) => {
  const decode = Schema.decodeUnknownOption(schema as Schema.Codec<unknown>)
  return (input: unknown): boolean => Option.isSome(decode(input))
}

// The property signatures named `name` anywhere under an AST, through unions, arrays and nested objects.
const findProperties = (root: SchemaAST.AST, name: string): ReadonlyArray<SchemaAST.PropertySignature> => {
  const found: Array<SchemaAST.PropertySignature> = []
  const seen = new Set<SchemaAST.AST>()
  const visit = (ast: SchemaAST.AST): void => {
    if (seen.has(ast)) return
    seen.add(ast)
    if (SchemaAST.isUnion(ast)) ast.types.forEach(visit)
    else if (SchemaAST.isArrays(ast)) {
      ast.elements.forEach(visit)
      ast.rest.forEach(visit)
    } else if (SchemaAST.isSuspend(ast)) visit(ast.thunk())
    else if (ast._tag === "Objects") {
      for (const property of ast.propertySignatures) {
        if (property.name === name) found.push(property)
        visit(property.type)
      }
      ast.indexSignatures.forEach((index) => visit(index.type))
    }
  }
  visit(SchemaAST.toEncoded(root))
  return found
}

// Every property, anywhere under an AST, whose wire type is a number (or a number or null).
const numericProperties = (root: SchemaAST.AST): ReadonlyArray<readonly [string, SchemaAST.AST]> => {
  const found: Array<readonly [string, SchemaAST.AST]> = []
  const seen = new Set<SchemaAST.AST>()
  const isNumber = (ast: SchemaAST.AST): boolean => {
    const encoded = SchemaAST.toEncoded(ast)
    if (encoded._tag === "Number") return true
    return SchemaAST.isUnion(encoded) &&
      encoded.types.length > 0 &&
      encoded.types.every((member) => member._tag === "Number" || member._tag === "Null") &&
      encoded.types.some((member) => member._tag === "Number")
  }
  const visit = (ast: SchemaAST.AST, path: string): void => {
    if (seen.has(ast)) return
    seen.add(ast)
    if (SchemaAST.isUnion(ast)) ast.types.forEach((member, index) => visit(member, `${path}|${index}`))
    else if (SchemaAST.isArrays(ast)) {
      ast.elements.forEach((element, index) => visit(element, `${path}[${index}]`))
      ast.rest.forEach((element) => visit(element, `${path}[]`))
    } else if (SchemaAST.isSuspend(ast)) visit(ast.thunk(), path)
    else if (ast._tag === "Objects") {
      for (const property of ast.propertySignatures) {
        const at = `${path}.${String(property.name)}`
        if (isNumber(property.type)) found.push([at, property.type])
        else visit(property.type, at)
      }
      ast.indexSignatures.forEach((index) => visit(index.type, `${path}{}`))
    }
  }
  visit(SchemaAST.toEncoded(root), "")
  return found
}

// One fixed sample per kind of bad number: not a number, not finite, not a whole number.
const badNumbers = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5]

describe("numeric fields are whole, finite numbers (mutation M1)", () => {
  // Catches: the sequence typed as a plain `Number` (a fractional or non-finite position would be logged,
  // and subscribers resuming "after" it would skip or repeat events).
  it("EventSequence refuses NaN, infinity and a fraction, and accepts whole numbers", () => {
    const ok = accepts(EventSequence)
    for (const bad of badNumbers) expect(ok(bad), String(bad)).toBe(false)
    expect(ok(1)).toBe(true)
    expect(ok(1_000_000)).toBe(true)
  })

  // Catches: the epoch-milliseconds time typed as a plain `Number`. Checked on the three places it appears:
  // the paused state's reset time, the out-of-usage event's reset time and the envelope's time.
  it("epoch milliseconds (resetAt, occurredAt) refuse NaN, infinity and a fraction", () => {
    const paused = (resetAt: unknown) => ({ _tag: "paused", reason: "limit", midTurn: false, resetAt })
    const state = accepts(LifecycleState)
    const event = accepts(Event)
    for (const bad of badNumbers) {
      expect(state(paused(bad)), `paused.resetAt ${bad}`).toBe(false)
      expect(event({ _tag: "AccountOutOfUsage", accountId: "work", resetAt: bad }), `AccountOutOfUsage.resetAt ${bad}`).toBe(false)
    }
    expect(state(paused(1_700_000_000_000))).toBe(true)
    expect(event({ _tag: "AccountOutOfUsage", accountId: "work", resetAt: 1_700_000_000_000 })).toBe(true)

    const occurredAt = findProperties(EventEnvelope.ast, "occurredAt")
    expect(occurredAt, "EventEnvelope.occurredAt").toHaveLength(1)
    const time = accepts(Schema.make(occurredAt[0]!.type))
    for (const bad of badNumbers) expect(time(bad), `occurredAt ${bad}`).toBe(false)
    expect(time(1_700_000_000_000)).toBe(true)
  })

  // Catches: any other count or number in the events, the paused state or the envelope (a process group
  // id, a user id, a protocol version, an exit code) typed loosely. The walk finds every numeric field
  // by its wire type, so a field added later is covered too. If a field must be fractional, the builder
  // reports it to the lead instead of loosening this test.
  it("every numeric field of the events, the state and the envelope refuses NaN, infinity and a fraction", () => {
    const roots: ReadonlyArray<readonly [string, SchemaAST.AST]> = [
      ["Event", Event.ast],
      ["LifecycleState", LifecycleState.ast],
      ["EventEnvelope", EventEnvelope.ast]
    ]
    const fields = roots.flatMap(([label, ast]) => numericProperties(ast).map(([path, type]) => [`${label}${path}`, type] as const))
    // The walk must see the known fields (it is not vacuous): sequence, the two reset times, the time.
    const paths = fields.map(([path]) => path)
    expect(paths.some((path) => path.endsWith(".resetAt")), "a resetAt field").toBe(true)
    expect(paths.some((path) => path === "EventEnvelope.sequence"), "the envelope sequence").toBe(true)
    expect(paths.some((path) => path === "EventEnvelope.occurredAt"), "the envelope time").toBe(true)
    expect(fields.length).toBeGreaterThan(4)
    for (const [path, type] of fields) {
      const ok = accepts(Schema.make(type))
      for (const bad of badNumbers) expect(ok(bad), `${path} accepted ${bad}`).toBe(false)
    }
  })

  // Catches: the sequence allowing a negative position (mutation M7).
  it("EventSequence refuses a negative number", () => {
    const ok = accepts(EventSequence)
    expect(ok(-1)).toBe(false)
    expect(ok(-1_000_000)).toBe(false)
    expect(ok(Number.MIN_SAFE_INTEGER)).toBe(false)
  })
})

describe("harness settings (rows 39 and 61)", () => {
  const adapterPaths = findProperties(HarnessSettings.ast, "adapterPath")
  const denyMechanisms = findProperties(HarnessSettings.ast, "denyReadMechanism")

  // Catches (mutation M3, row 39): a relative or bare adapter path accepted. A relative path or a PATH
  // lookup lets a changed checkout change what the engine runs.
  it("adapterPath refuses a relative path and accepts an absolute one", () => {
    expect(adapterPaths, "an adapterPath field in HarnessSettings").not.toHaveLength(0)
    for (const property of adapterPaths) {
      const ok = accepts(Schema.make(property.type))
      for (const relative of ["claude-agent-acp", "bin/adapter", "./adapter", "../adapter", "adapter.js", ""]) {
        expect(ok(relative), `adapterPath "${relative}"`).toBe(false)
      }
      expect(ok("/usr/local/bin/claude-agent-acp")).toBe(true)
    }
  })

  // Catches (mutation M11, row 61): the deny-read mechanism open to any tag (a typo would silently mean "no
  // rule"), or one of the two known mechanisms refused. `none` is recorded for a harness without a way to
  // pass the rule at launch; `launch-arguments` carries the arguments for the read and write rules.
  it("denyReadMechanism refuses an unknown tag and accepts none and launch-arguments", () => {
    expect(denyMechanisms, "a denyReadMechanism field in HarnessSettings").not.toHaveLength(0)
    for (const property of denyMechanisms) {
      const ok = accepts(Schema.make(property.type))
      expect(ok({ _tag: "none" }), "none").toBe(true)
      expect(ok({ _tag: "launch-arguments", readArguments: [], writeArguments: [] }), "launch-arguments").toBe(true)
      expect(ok({ _tag: "environment-variable" }), "unknown tag").toBe(false)
      expect(ok({ _tag: "NONE" }), "wrong case").toBe(false)
      expect(ok({}), "no tag").toBe(false)
      expect(ok("none"), "bare string").toBe(false)
    }
  })
})

describe("agent started event (row 33)", () => {
  const started = Event.members.find((member) =>
    member.ast._tag === "Objects" &&
    member.ast.propertySignatures.some((p) => p.name === "_tag" && (p.type as SchemaAST.Literal).literal === "AgentStarted")
  )

  // Catches (mutation M8): the agent's folder accepted as a relative path, so the same start request would
  // mean different folders depending on where the service happens to run.
  it("folder refuses a relative path and accepts an absolute one", () => {
    expect(started, "AgentStarted member of Event").toBeDefined()
    const folders = findProperties(started!.ast, "folder")
    expect(folders, "AgentStarted.folder").toHaveLength(1)
    const ok = accepts(Schema.make(folders[0]!.type))
    for (const relative of ["project", "./project", "../project", "~/project", ""]) {
      expect(ok(relative), `folder "${relative}"`).toBe(false)
    }
    expect(ok("/home/someone/project")).toBe(true)
  })
})
