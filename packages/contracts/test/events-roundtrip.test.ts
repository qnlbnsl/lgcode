// Unit 3, criterion 3.2: every event round-trips through its encoded (wire) form unchanged, and the
// set of event tags is exactly the list of task 3d.
import { it as effectIt } from "@effect/vitest"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import { describe, expect, it } from "vitest"

import { EngineEvent, Event, EventEnvelope } from "../src/events.ts"
import { EventId } from "../src/ids.ts"
import { LifecycleState } from "../src/stateMachine.ts"

// Task 3d, in the plan's order, one tag per event, plus AgentStartFailed from decisions row 70 (a later row
// than 3d, so it wins; the lead confirmed it as the fortieth event), plus AccountOutOfUsage (fix round 1, item 3:
// the forty-first event, written once when an account runs out). Copied here on purpose: the test must not read
// the list it checks from the code under test. Plan wording -> tag:
// "command refused" -> CommandRefused, "agent reload failed" -> AgentReloadFailed, and so on.
const expectedEngineTags = [
  "AgentStarted",
  "AgentStartFailed",
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
  "DeliveryHeld",
  "DeliveryReleased",
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
  "AccountOutOfUsage",
  "HarnessChanged",
  "CommandRefused"
]

// The shared union has the engine inventory plus these client declarations.
// Keep the expected list independent of the production event-tag inventory.
const expectedClientTags = [
  "client.AlertBaseline", "client.AlertRaised", "client.AlertDelivered", "client.AlertDeliveryFailed",
  "client.AlertPromptDismissed", "client.AlertCleared", "client.AlertSettingsChanged", "client.AlertCarrierChanged",
  "client.AlertCarrierTokenSet", "client.AlertCarrierTokenCleared", "client.WebSettingsChanged",
  "client.WebServerDown", "client.WebServerUp"
]
const expectedBoardTags = [
  "board.ChannelOpened",
  "board.ChannelMembersChanged",
  "board.ManagerChanged",
  "board.PostWritten",
  "board.PostAcknowledged",
  "board.AddresseeResolved",
  "board.PostClosed",
  "board.WakeBuilt",
  "board.Read",
]
const expectedRolesTags = [
  "roles.RoleFileSet", "roles.SettingsChanged", "roles.Snoozed", "roles.SheepdogBaseline", "roles.StallNoticePlanned",
  "roles.TeamIdleReported", "roles.StallSeen", "roles.ReplaceAdvised", "roles.RunawayReported",
  "roles.CapacityRetried", "roles.CrashAdmitted", "roles.CrashRetried", "roles.GaveUp",
  "roles.RoleAdviceBroken", "roles.CacheFlushed", "roles.CompactRequested", "roles.StallEnded"
]
const expectedProjectTags = [
  "project.CreationPlanned", "project.CreationClaimed", "project.CreationFinished", "project.GoalChanged", "project.ArchiveStarted", "project.Archived", "project.Restored",
  "project.SettingsChanged", "project.RepositoryAdded", "project.RepositoryLocated", "project.WorktreeCreated",
  "project.Created", "project.Placed", "project.PreferencesChanged", "project.Renamed", "project.StageChanged", "project.TeamAdded",
  "project.SprintAdded", "project.SprintChanged", "project.SprintCompleted", "project.TaskAdded", "project.TaskChanged", "project.TaskNoted"
]
const expectedTags = [...expectedEngineTags, ...expectedBoardTags, ...expectedClientTags, ...expectedRolesTags, ...expectedProjectTags]

const tagOf = (member: { readonly ast: SchemaAST.AST }): string => {
  const ast = member.ast
  if (ast._tag !== "Objects") throw new Error("every event must be a struct")
  const property = ast.propertySignatures.find((candidate) => candidate.name === "_tag")
  if (property === undefined || property.type._tag !== "Literal") throw new Error("every event needs a literal _tag")
  return String(property.type.literal)
}

const members = Event.members
const byTag = new Map(members.map((member) => [tagOf(member), member] as const))

describe("TurnEnded usage (foundry roles 7c)", () => {
  const decode = Schema.decodeUnknownSync(Event)
  const encode = Schema.encodeSync(Event)
  // The plan specifies the values, but not their wire names. These tests
  // propose ACP token names and optional numeric request/lifetime fields.
  const samples = [
    ["U06a old event", { _tag: "TurnEnded", agentId: "agent-usage", compact: false }],
    ["U06b reported context only", { _tag: "TurnEnded", agentId: "agent-usage", compact: false, usage: { used: 0 } }],
    ["U06c last request and cache lifetimes", { _tag: "TurnEnded", agentId: "agent-usage", compact: true, usage: {
      used: 1_234, requestStartedAt: 1_798_761_600_123, inputTokens: 17, cachedReadTokens: 31,
      cachedWriteTokens: 120, cachedWrite5mTokens: 20, cachedWrite1hTokens: 100,
    } }],
  ] as const
  for (const [name, wire] of samples) {
    it(`${name}: decoding and JSON round-trip preserve reported fields without requiring absent ones (catches stripping usage, losing the split or making new fields mandatory)`, () => {
      const decoded = decode(wire)
      expect(decoded).toEqual(wire)
      expect(decode(JSON.parse(JSON.stringify(encode(decoded))))).toEqual(wire)
    })
  }
})

describe("event tags", () => {
  // Catches: an event dropped from, added to, or renamed in the union; two members sharing a tag
  // (the second would never decode).
  it("keeps exactly the engine event inventory, including capacity hold and release, each once", () => {
    const tags = EngineEvent.members.map(tagOf)
    expect(tags).toHaveLength(expectedEngineTags.length)
    expect(new Set(tags).size, "duplicate engine tags").toBe(tags.length)
    expect([...tags].sort()).toEqual([...expectedEngineTags].sort())
  })

  it("contains exactly the engine, board, client, roles and project events, each once", () => {
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

describe("AccountOutOfUsage (fix round 1, item 3)", () => {
  const member = byTag.get("AccountOutOfUsage")
  const decode = Schema.decodeUnknownSync(Event)

  // Catches: the event missing or carrying other fields. The spec skips an out-of-usage account when a
  // start asks for any account, and row 52 step 8 rebuilds account timers from the logged reset times,
  // so the event is exactly the account id and the optional reset time.
  it("has exactly the fields _tag, accountId and an optional resetAt", () => {
    expect(member, "AccountOutOfUsage member of Event").toBeDefined()
    const properties = (member!.ast as SchemaAST.Objects).propertySignatures
    expect(properties.map((property) => String(property.name)).sort()).toEqual(["_tag", "accountId", "resetAt"])
    const optional = (name: string) => properties.find((property) => property.name === name)!.type.context?.isOptional ?? false
    expect(optional("accountId"), "accountId optional").toBe(false)
    expect(optional("resetAt"), "resetAt optional").toBe(true)
  })

  // Catches: a reset time made required (a harness that gives no reset time could not log the event, and
  // the owner would never be alerted), or a reset time that is dropped when present.
  it("decodes with and without a reset time and keeps the time", () => {
    expect(decode({ _tag: "AccountOutOfUsage", accountId: "work" })).toEqual({ _tag: "AccountOutOfUsage", accountId: "work" })
    expect(decode({ _tag: "AccountOutOfUsage", accountId: "work", resetAt: 1_700_000_000_000 })).toEqual({
      _tag: "AccountOutOfUsage",
      accountId: "work",
      resetAt: 1_700_000_000_000
    })
  })

  // Catches: an account id that is not the shared AccountId shape (an empty id would name no account).
  it("refuses an empty or missing account id", () => {
    expect(() => decode({ _tag: "AccountOutOfUsage", accountId: "" })).toThrow()
    expect(() => decode({ _tag: "AccountOutOfUsage" })).toThrow()
  })

  // Catches: the reset time typed differently from the paused state's reset time (a string, a Date, a
  // different unit): both are epoch milliseconds, so they must accept and refuse the same samples.
  it("types resetAt as the same epoch milliseconds as the paused state's resetAt", () => {
    const samples = [0, 1_700_000_000_000, Date.UTC(2026, 10, 1), 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1700000000000", null]
    const decodeState = Schema.decodeUnknownOption(LifecycleState)
    const decodeEvent = Schema.decodeUnknownOption(Event)
    for (const sample of samples) {
      const asState = Option.isSome(decodeState({ _tag: "paused", reason: "limit", midTurn: false, resetAt: sample }))
      const asEvent = Option.isSome(decodeEvent({ _tag: "AccountOutOfUsage", accountId: "work", resetAt: sample }))
      expect(asEvent, `resetAt ${String(sample)}`).toBe(asState)
    }
    // A sample both accept and a sample both refuse, so the comparison is not two refusals of everything.
    expect(Option.isSome(decodeEvent({ _tag: "AccountOutOfUsage", accountId: "work", resetAt: 1_700_000_000_000 }))).toBe(true)
    expect(Option.isSome(decodeEvent({ _tag: "AccountOutOfUsage", accountId: "work", resetAt: 1.5 }))).toBe(false)
  })
})

describe("EventEnvelope (fix round 1, item 5)", () => {
  // Catches: a missing field of the log's columns (plan task 4a): sequence, event id, time, caller, the
  // optional request id and agent id, and the event itself; an optional field made required (a system
  // event has no request) or a required one made optional.
  it("has the log's columns, with requestId and agentId the only optional ones", () => {
    const ast = EventEnvelope.ast
    expect(ast._tag).toBe("Objects")
    const properties = (ast as SchemaAST.Objects).propertySignatures
    expect(properties.map((property) => String(property.name)).sort()).toEqual(
      ["agentId", "caller", "event", "eventId", "occurredAt", "requestId", "sequence"]
    )
    const optional = (name: string) => properties.find((property) => property.name === name)!.type.context?.isOptional ?? false
    for (const name of ["sequence", "eventId", "occurredAt", "caller", "event"]) expect(optional(name), `${name} optional`).toBe(false)
    for (const name of ["requestId", "agentId"]) expect(optional(name), `${name} optional`).toBe(true)
  })

  // Catches: the new event id brand missing from ids.ts.
  it("uses a branded EventId exported from ids.ts", () => {
    expect(Schema.isSchema(EventId)).toBe(true)
    const eventId = (EventEnvelope.ast as SchemaAST.Objects).propertySignatures.find((property) => property.name === "eventId")!
    expect(Option.isSome(Schema.decodeUnknownOption(Schema.make<Schema.Codec<unknown>>(eventId.type))(7)), "a number is not an event id").toBe(false)
  })

  // Catches: an envelope whose encode and decode are not inverse (a transformation on one side only), or
  // a wire form that does not survive the JSON text the log stores.
  // (The property is registered with a stand-in when the export is missing, so a missing export fails this
  // test by name instead of failing the whole file at collection.)
  const envelopeOrStandIn = (EventEnvelope as typeof EventEnvelope | undefined ?? Schema.Literal("no EventEnvelope")) as typeof EventEnvelope
  effectIt.prop("EventEnvelope: encode then decode gives the envelope back", [envelopeOrStandIn], ([envelope]) => {
    expect(EventEnvelope, "EventEnvelope export").toBeDefined()
    const encoded = Schema.encodeSync(EventEnvelope)(envelope)
    expect(Schema.decodeUnknownSync(EventEnvelope)(encoded)).toEqual(envelope)
    const wire = JSON.parse(JSON.stringify(encoded))
    const decoded = Schema.decodeUnknownSync(EventEnvelope)(wire)
    expect(JSON.stringify(Schema.encodeSync(EventEnvelope)(decoded))).toBe(JSON.stringify(wire))
  })

  // Catches: an envelope that accepts a missing event or a missing sequence, so a bare event or a row
  // without its position could be delivered to a subscriber.
  it("refuses a bare event and an envelope with no sequence", () => {
    const decode = Schema.decodeUnknownSync(EventEnvelope)
    expect(() => decode({ _tag: "AgentStopped", agentId: "a" })).toThrow()
    expect(() => decode({})).toThrow()
  })
})
