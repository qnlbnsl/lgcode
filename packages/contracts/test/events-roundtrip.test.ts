// Unit 3, criterion 3.2: every event round-trips through its encoded (wire) form unchanged, and the
// set of event tags is exactly the list of task 3d.
import { it as effectIt } from "@effect/vitest"
import * as Schema from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import { describe, expect, it } from "vitest"

import { Event } from "../src/events.ts"

// Task 3d, in the plan's order, one tag per event. Copied here on purpose: the test must not read
// the list it checks from the code under test. Plan wording -> tag:
// "command refused" -> CommandRefused, "agent reload failed" -> AgentReloadFailed, and so on.
const expectedTags = [
  "AgentStarted",
  "SessionOpened",
  "PromptSent",
  "ThreadItem",
  "TurnStarted",
  "TurnEnded",
  "StateChanged",
  "ModeChanged",
  "ModeRefused",
  "PermissionRequested",
  "PermissionAnswered",
  "PermissionMoved",
  "PermissionCancelled",
  "QuestionAsked",
  "QuestionAnswered",
  "QuestionMoved",
  "OwnerNeeded",
  "WaitOpened",
  "WaitMemberResolved",
  "WaitSatisfied",
  "WaitCancelled",
  "DeliveryQueued",
  "DeliverySent",
  "DeliveryAccepted",
  "DeliveryRequeued",
  "DeliveryReturned",
  "DeliveryWithdrawn",
  "AgentCrashed",
  "AgentInterrupted",
  "AgentReloadFailed",
  "AgentStopped",
  "AgentGrouped",
  "AccountChanged",
  "AccountNeedsSignIn",
  "AccountAvailable",
  "HarnessChanged",
  "DeviceAdded",
  "DeviceRevoked",
  "CommandRefused"
]

const tagOf = (member: { readonly ast: SchemaAST.AST }): string => {
  const ast = member.ast
  if (ast._tag !== "Objects") throw new Error("every event must be a struct")
  const property = ast.propertySignatures.find((candidate) => candidate.name === "_tag")
  if (property === undefined || property.type._tag !== "Literal") throw new Error("every event needs a literal _tag")
  return String(property.type.literal)
}

const members = Event.members
const byTag = new Map(members.map((member) => [tagOf(member), member] as const))

describe("event tags", () => {
  // Catches: an event dropped from, added to, or renamed in the union; two members sharing a tag
  // (the second would never decode).
  it("are exactly the 39 events of task 3d, each once", () => {
    const tags = members.map(tagOf)
    expect(tags).toHaveLength(expectedTags.length)
    expect(new Set(tags).size, "duplicate tags").toBe(tags.length)
    expect([...tags].sort()).toEqual([...expectedTags].sort())
  })

  // Catches: the union decoding a tag nobody defined (a newer or malicious writer's event would be
  // accepted), or ignoring the tag and decoding by shape.
  it("refuse an unknown tag and a missing tag", () => {
    const decode = Schema.decodeUnknownSync(Event)
    expect(() => decode({ _tag: "NotAnEvent" })).toThrow()
    expect(() => decode({})).toThrow()
    expect(() => decode("AgentStarted")).toThrow()
  })
})

describe("event round trip", () => {
  for (const tag of expectedTags) {
    const member = byTag.get(tag)
    if (member === undefined) {
      // Catches: the missing event; the exact-set test above names it, this one fails by name too.
      it(`${tag}: the event exists`, () => {
        expect(byTag.has(tag)).toBe(true)
      })
      continue
    }
    const encode = Schema.encodeSync(member)
    const decode = Schema.decodeUnknownSync(member)

    // Catches: a field whose encode and decode are not inverse (a transformation applied on one
    // side only, a brand or refinement the generator can satisfy but decoding refuses, a date or
    // map that comes back as another type).
    effectIt.prop(`${tag}: encode then decode gives the event back`, [member], ([event]) => {
      expect(decode(encode(event))).toEqual(event)
    })

    // Catches: an encoded form that does not survive the JSON text the log stores (`payload_json`):
    // a NaN, a bigint, a Date, an undefined or a symbol. Writing the text and reading it back must
    // reach the same wire value, and the same event.
    effectIt.prop(`${tag}: the encoded event survives the JSON text round trip`, [member], ([event]) => {
      const wire = JSON.parse(JSON.stringify(encode(event)))
      expect(JSON.stringify(encode(decode(wire)))).toBe(JSON.stringify(wire))
      expect(wire._tag).toBe(tag)
    })
  }

  // Catches: the union as a whole decoding to a different member than the one that was encoded
  // (two members with overlapping shapes). The JSON text turns -0 into 0, so the check compares
  // wire forms (and the tag), not the values, after the text trip.
  effectIt.prop("any event round-trips through the whole union", [Event], ([event]) => {
    const encoded = Schema.encodeSync(Event)(event)
    expect(Schema.decodeUnknownSync(Event)(encoded)).toEqual(event)
    const wire = JSON.parse(JSON.stringify(encoded))
    const decoded = Schema.decodeUnknownSync(Event)(wire)
    expect(decoded._tag).toBe(event._tag)
    expect(JSON.stringify(Schema.encodeSync(Event)(decoded))).toBe(JSON.stringify(wire))
  })
})
