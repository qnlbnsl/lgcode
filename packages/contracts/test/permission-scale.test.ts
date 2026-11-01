// Unit 3, criterion 3.3: the permission scale and the mapping from ACP
// (Agent Client Protocol) permission option kinds onto it.
// Rests on decisions rows 35 (b) and 56.
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  acpPermissionOptionKinds,
  comparePermission,
  PermissionLevel,
  permissionForOptionKind,
  permissionLevels
} from "../src/permission.ts"
import * as Schema from "effect/Schema"

const ascending = ["read-only", "ask", "edit", "full"] as const

describe("permission scale order", () => {
  // Catches: a level added, dropped or reordered in `permissionLevels`, which would
  // let `full` sort below `edit` and break every "at or below its own mode" check.
  it("lists the levels from lowest to highest, exactly four", () => {
    expect([...permissionLevels]).toEqual([...ascending])
  })

  // Catches: `comparePermission` comparing names alphabetically (`ask` < `edit` < `full` < `read-only`)
  // instead of by scale position.
  it("orders every pair of levels by scale position", () => {
    for (let a = 0; a < ascending.length; a++) {
      for (let b = 0; b < ascending.length; b++) {
        const result = comparePermission(ascending[a]!, ascending[b]!)
        expect(Math.sign(result), `${ascending[a]} vs ${ascending[b]}`).toBe(Math.sign(a - b))
      }
    }
  })

  // Catches: the literal schema accepting a level outside the scale, or rejecting one inside it.
  it("decodes exactly the four level names", () => {
    const decode = Schema.decodeUnknownSync(PermissionLevel)
    for (const level of ascending) expect(decode(level)).toBe(level)
    for (const bad of ["", "readonly", "Full", "admin", "plan", 3, null]) {
      expect(() => decode(bad), String(bad)).toThrow()
    }
  })
})

describe("ACP permission option kinds", () => {
  // Catches: the contracts' list of option kinds drifting from the protocol's own generated schema
  // (a kind added upstream that nobody mapped). The generated schema also has a catch-all string member.
  it("covers every literal kind the copied ACP schema defines", () => {
    const source = readFileSync(
      new URL("../../../third_party/t3code/effect-acp/src/_generated/schema.gen.ts", import.meta.url),
      "utf8"
    )
    const block = source.slice(source.indexOf("export const PermissionOptionKind = Schema.Union(["))
    const literals = [...block.slice(0, block.indexOf("]).annotate")).matchAll(/Schema\.Literal\("([a-z_]+)"\)/g)]
      .map((match) => match[1]!)
    expect(literals.sort()).toEqual(["allow_always", "allow_once", "reject_always", "reject_once"])
    expect([...acpPermissionOptionKinds].sort()).toEqual(literals)
  })

  // Catches: an option kind with no mapping, or a mapping with a missing or non-boolean persistence flag.
  it("maps every kind to a level on the scale and a persistence flag", () => {
    for (const kind of acpPermissionOptionKinds) {
      const mapped = permissionForOptionKind(kind)
      expect(ascending, kind).toContain(mapped.level)
      expect(typeof mapped.persistent, kind).toBe("boolean")
    }
  })

  // Catches (row 56): an "always" option treated as one-off, so a persisted setting would not be
  // routed to the owner; or a one-off option flagged persistent, sending every approval to the owner.
  it("flags exactly the `*_always` kinds as persistent", () => {
    expect(permissionForOptionKind("allow_once").persistent).toBe(false)
    expect(permissionForOptionKind("reject_once").persistent).toBe(false)
    expect(permissionForOptionKind("allow_always").persistent).toBe(true)
    expect(permissionForOptionKind("reject_always").persistent).toBe(true)
  })

  // Catches (row 35 b): a reject option that raises the asker, so choosing "no" widens an agent.
  it("maps both reject kinds to the lowest level", () => {
    expect(permissionForOptionKind("reject_once").level).toBe("read-only")
    expect(permissionForOptionKind("reject_always").level).toBe("read-only")
  })

  // Catches (row 35 b): "allow always" counting for less than "allow once", which would let an
  // answerer who may only choose `ask` options pick a lasting grant.
  it("never maps an allow-always option below its allow-once option, and both above the rejects", () => {
    const once = permissionForOptionKind("allow_once").level
    const always = permissionForOptionKind("allow_always").level
    expect(comparePermission(always, once)).toBeGreaterThanOrEqual(0)
    expect(comparePermission(once, "read-only")).toBeGreaterThan(0)
  })

  // Catches: the pinned mapping changing unnoticed. The reading (allow once = ask, allow always = edit)
  // is written down in the unit's result file with the rows it rests on.
  it("pins the level of each allow option", () => {
    expect(permissionForOptionKind("allow_once").level).toBe("ask")
    expect(permissionForOptionKind("allow_always").level).toBe("edit")
  })

  // Catches: the catch-all member of the ACP schema (any other string) mapping to a low level, so a
  // harness-invented kind would be answerable by a read-only agent. An unknown kind must need the owner.
  it("maps an unknown kind to the top level, persistent, so only the owner may choose it", () => {
    expect(permissionForOptionKind("allow_session_wide")).toEqual({ level: "full", persistent: true })
    expect(permissionForOptionKind("")).toEqual({ level: "full", persistent: true })
  })
})
