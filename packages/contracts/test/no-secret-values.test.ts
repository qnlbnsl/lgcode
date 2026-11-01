// Unit 3, criterion 3.4: no schema can carry a raw secret value.
// Rests on decisions rows 19 (secrets are references, `secret:<id>`) and 55 ("command refused"
// records only the command name and the reason).
import * as Schema from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import * as RpcSchema from "effect/rpc/RpcSchema"
import { describe, expect, it } from "vitest"

import { Account } from "../src/accounts.ts"
import { CommandsRpcGroup } from "../src/commands.ts"
import { Event } from "../src/events.ts"
import { HarnessSettings } from "../src/harnesses.ts"

// A name is secret-looking when it contains TOKEN, KEY, SECRET or PASSWORD in any case (the globs
// `*TOKEN*`, `*KEY*`, `*SECRET*` and `*PASSWORD*` of criterion 3.4).
const secretLooking = /token|key|secret|password/i

// Values that are not references. Any of them accepted under a secret-looking name is a leak.
const rawProbes = ["abc", "hunter2", "sk-ant-api03-AAAAAAAAAAAAAAAA", "secret", "secret:", "SECRET:x y"]

interface Finding {
  readonly path: string
  readonly kind: "property" | "record-key"
  readonly accepted: string
}

// Walks an AST and reports every place that accepts a raw probe under a secret-looking name:
// a named property whose type accepts a probe string, or a pure record that accepts a probe
// under a secret-looking key. Visits both the type and the encoded (wire) side.
const walk = (root: SchemaAST.AST, label: string): { findings: Array<Finding>; properties: Array<string> } => {
  const findings: Array<Finding> = []
  const properties: Array<string> = []
  const seen = new Set<SchemaAST.AST>()
  const visit = (ast: SchemaAST.AST, path: string): void => {
    if (seen.has(ast)) return
    seen.add(ast)
    if (SchemaAST.isUnion(ast)) {
      ast.types.forEach((member, index) => visit(member, `${path}|${index}`))
    } else if (SchemaAST.isArrays(ast)) {
      ast.elements.forEach((element, index) => visit(element, `${path}[${index}]`))
      ast.rest.forEach((element) => visit(element, `${path}[]`))
    } else if (SchemaAST.isSuspend(ast)) {
      visit(ast.thunk(), path)
    } else if (ast._tag === "Objects") {
      for (const property of ast.propertySignatures) {
        const name = String(property.name)
        properties.push(`${path}.${name}`)
        if (secretLooking.test(name)) {
          const accepts = Schema.is(Schema.make(property.type))
          for (const probe of rawProbes) {
            if (accepts(probe)) findings.push({ path: `${path}.${name}`, kind: "property", accepted: probe })
          }
        }
        visit(property.type, `${path}.${name}`)
      }
      if (ast.propertySignatures.length === 0) {
        for (const index of ast.indexSignatures) {
          const accepts = Schema.is(Schema.make(ast))
          for (const key of ["API_KEY", "github_token", "Db_Password", "AWS_SECRET_ACCESS"]) {
            for (const probe of rawProbes) {
              if (accepts({ [key]: probe })) {
                findings.push({ path: `${path}{${key}}`, kind: "record-key", accepted: probe })
              }
            }
          }
          visit(index.type, `${path}{}`)
        }
      } else {
        // A record mixed with named properties is not probed (its required properties would make
        // every probe fail for another reason); its value type is still walked.
        for (const index of ast.indexSignatures) visit(index.type, `${path}{}`)
      }
    }
  }
  visit(SchemaAST.toEncoded(root), label)
  return { findings, properties }
}

// The schemas a secret must never travel in: events, replies, errors, accounts, harness settings.
// Request payloads are walked too; the only request that must carry a secret is `accounts set-secret`,
// and its value field is not named like a secret, so the name rule holds for it as well.
const roots = (): ReadonlyArray<readonly [string, SchemaAST.AST]> => {
  const list: Array<readonly [string, SchemaAST.AST]> = [
    ["Event", Event.ast],
    ["Account", Account.ast],
    ["HarnessSettings", HarnessSettings.ast]
  ]
  for (const [tag, rpc] of CommandsRpcGroup.requests) {
    list.push([`${tag}.payload`, rpc.payloadSchema.ast])
    const success = rpc.successSchema
    if (RpcSchema.isStreamSchema(success)) {
      list.push([`${tag}.success`, success.success.ast], [`${tag}.streamError`, success.error.ast])
    } else {
      list.push([`${tag}.success`, success.ast])
    }
    list.push([`${tag}.error`, rpc.errorSchema.ast])
  }
  return list
}

describe("schema walk", () => {
  // Catches: a walker that never looks at anything (so every schema "passes"). A hand-built schema
  // with a raw-string token field and a record that takes any key must be reported.
  it("reports a string field named like a token and a record that takes a raw value under a key name", () => {
    const bad = Schema.Struct({
      apiToken: Schema.String,
      extra: Schema.Record(Schema.String, Schema.String),
      fine: Schema.String
    })
    const { findings } = walk(bad.ast, "bad")
    expect(findings.some((f) => f.path === "bad.apiToken" && f.kind === "property")).toBe(true)
    // `extra` is a field of a struct with named properties: its own record node has no named properties.
    expect(findings.some((f) => f.path.startsWith("bad.extra{") && f.kind === "record-key")).toBe(true)
    expect(findings.some((f) => f.path === "bad.fine")).toBe(false)
  })

  // Catches: a walker that stops at the top level of the event union or at a nested struct,
  // so a leaking field one level down is never seen.
  it("reaches the nested fields of the real schemas", () => {
    const names = roots().flatMap(([label, ast]) => walk(ast, label).properties)
    expect(names.length).toBeGreaterThan(100)
    expect(names.some((n) => n.startsWith("Event|") && n.endsWith("._tag"))).toBe(true)
    expect(names.some((n) => n.startsWith("Account.") && n.endsWith(".id"))).toBe(true)
  })

  // Catches: any contract schema (event, reply, error, account, harness settings, request) with a field
  // that takes a raw string under a name like *TOKEN*, *KEY*, *SECRET* or *PASSWORD*.
  it.each(roots().map(([label]) => label))("%s: no secret-looking field can carry a raw string", (label) => {
    const ast = roots().find(([name]) => name === label)![1]
    expect(walk(ast, label).findings).toEqual([])
  })
})

describe("account environment", () => {
  const account = (environment: Record<string, string>) => ({ id: "work", harness: "cursor", environment })
  const decode = Schema.decodeUnknownSync(Account)

  // Catches (the criterion's own example): a raw key accepted in the extra environment, so the
  // service would store it in the database and the log.
  it("refuses CURSOR_API_KEY: \"abc\"", () => {
    expect(() => decode(account({ CURSOR_API_KEY: "abc" }))).toThrow()
  })

  // Catches: the reference form being rejected too (an account could never get a key), or a
  // reference that points at nothing (`secret:`) being accepted.
  it("accepts a secret reference for the same name and refuses an empty reference", () => {
    expect(decode(account({ CURSOR_API_KEY: "secret:cursor-work" })).environment).toEqual({
      CURSOR_API_KEY: "secret:cursor-work"
    })
    expect(() => decode(account({ CURSOR_API_KEY: "secret:" }))).toThrow()
  })

  // Catches: the name check being case-sensitive or only matching a whole name, so
  // `github_token`, `Db_Password` or `MONKEY` (contains KEY, as the glob `*KEY*` does) slip through as plain text.
  it.each([
    "CURSOR_API_KEY",
    "github_token",
    "Db_Password",
    "AWS_SECRET_ACCESS",
    "MONKEY",
    "tokenizer",
    "MY_pAsSwOrD_FILE"
  ])("refuses a raw value under the secret-looking name %s", (name) => {
    expect(() => decode(account({ [name]: "hunter2" }))).toThrow()
    expect(decode(account({ [name]: "secret:ref-1" })).environment).toEqual({ [name]: "secret:ref-1" })
  })

  // Catches: an over-eager check that refuses every environment variable, so no account could set
  // a log level or a region.
  it("accepts plain values under names that do not look secret", () => {
    const environment = { LOG_LEVEL: "debug", AWS_REGION: "eu-west-1", HOME: "/home/someone" }
    expect(decode(account(environment)).environment).toEqual(environment)
  })

  // Catches: an account that works without an environment at all being refused.
  it("accepts an account with no environment", () => {
    expect(decode({ id: "work", harness: "cursor" }).id).toBe("work")
  })

  // Catches: one bad entry among good ones being ignored.
  it("refuses an environment where one entry among several is a raw secret", () => {
    expect(() => decode(account({ LOG_LEVEL: "debug", GEMINI_API_KEY: "hunter2" }))).toThrow()
  })
})

describe("command refused event", () => {
  const decode = Schema.decodeUnknownSync(Event)

  // Catches (row 55): the refused event gaining a field for the request, which would copy the
  // request body (and any secret in it) into the event log.
  it("has exactly the fields _tag, command and reason", () => {
    const member = Event.members.find((candidate) =>
      candidate.ast._tag === "Objects" &&
      candidate.ast.propertySignatures.some((p) => p.name === "_tag" && (p.type as SchemaAST.Literal).literal === "CommandRefused")
    )
    expect(member, "CommandRefused member of Event").toBeDefined()
    const fields = (member!.ast as SchemaAST.Objects).propertySignatures.map((p) => String(p.name))
    expect(fields.sort()).toEqual(["_tag", "command", "reason"])
  })

  // Catches: a request body riding along and being kept: decoding strips or refuses it, and the
  // decoded event never holds the body.
  it("does not keep a request body that is sent along with it", () => {
    const wire = {
      _tag: "CommandRefused",
      command: "accounts set-secret",
      reason: "owner-only",
      request: { account: "work", value: "hunter2" },
      body: "hunter2"
    }
    let decoded: unknown
    try {
      decoded = decode(wire)
    } catch {
      return // refused outright: also fine
    }
    expect(JSON.stringify(decoded)).not.toContain("hunter2")
    expect(Object.keys(decoded as object).sort()).toEqual(["_tag", "command", "reason"])
  })

  // Catches: the event being unable to record a refusal at all.
  it("decodes a refusal that carries only the command name and the reason", () => {
    const refusal = { _tag: "CommandRefused", command: "prompt", reason: "the agent is stopped" }
    expect(decode(refusal)).toEqual(refusal)
  })
})
