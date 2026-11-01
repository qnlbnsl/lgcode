// Unit 3, criterion 3.5: the one state machine. Every (lifecycle state, command) cell, every
// (lifecycle state, event) cell, every legal state change, and every row of the displayed-state
// derivation table. Rests on decisions rows 24, 53 and 62 and the spec's "One state machine".
import * as Schema from "effect/Schema"
import type * as SchemaAST from "effect/SchemaAST"
import { describe, expect, it } from "vitest"

import { Event } from "../src/events.ts"
import {
  canTransition,
  commandOutcome,
  DisplayedState,
  displayedState,
  eventEffect,
  LifecycleState,
  lifecycleStateNames
} from "../src/stateMachine.ts"

type StateName = "starting" | "working" | "idle" | "paused" | "interrupted" | "crashed" | "stopped"
const states: ReadonlyArray<StateName> = ["starting", "working", "idle", "paused", "interrupted", "crashed", "stopped"]

describe("lifecycle states", () => {
  // Catches: a state added or dropped (row 24 names exactly seven; "waiting on a permission" and
  // "waiting on an answer" are derived from counts, so they must not appear here).
  it("are exactly the seven of row 24", () => {
    expect([...lifecycleStateNames].sort()).toEqual([...states].sort())
  })

  const decode = Schema.decodeUnknownSync(LifecycleState)

  // Catches: pause reasons or the mid-turn flag missing (row 53: a mid-turn agent gets a carry-on),
  // or the state that an interrupted agent was in being lost (3d: "agent interrupted (with previous state)").
  it("carry the pause reason, the mid-turn flag and the previous state where the spec says", () => {
    expect(decode({ _tag: "working" })).toEqual({ _tag: "working" })
    expect(decode({ _tag: "paused", reason: "limit", midTurn: true })).toEqual({
      _tag: "paused",
      reason: "limit",
      midTurn: true
    })
    expect(decode({ _tag: "paused", reason: "signed-out", midTurn: false })).toMatchObject({ reason: "signed-out" })
    expect(decode({ _tag: "interrupted", previous: "idle" })).toEqual({ _tag: "interrupted", previous: "idle" })
  })

  // Catches: a pause with no recorded reason (the displayed state could not be derived), an invented
  // reason, an interrupted agent with no previous state, and a state outside the seven.
  it("refuse an incomplete or invented state", () => {
    expect(() => decode({ _tag: "paused" })).toThrow()
    expect(() => decode({ _tag: "paused", reason: "limit" })).toThrow()
    expect(() => decode({ _tag: "paused", reason: "tired", midTurn: false })).toThrow()
    expect(() => decode({ _tag: "interrupted" })).toThrow()
    expect(() => decode({ _tag: "interrupted", previous: "stopped" })).toThrow()
    expect(() => decode({ _tag: "waiting-on-a-permission" })).toThrow()
  })
})

describe("displayed state derivation (first match wins)", () => {
  type Shown = typeof DisplayedState.Type

  const variants = {
    starting: { _tag: "starting" },
    working: { _tag: "working" },
    idle: { _tag: "idle" },
    "paused (limit)": { _tag: "paused", reason: "limit", midTurn: false },
    "paused (signed-out)": { _tag: "paused", reason: "signed-out", midTurn: false },
    interrupted: { _tag: "interrupted", previous: "working" },
    crashed: { _tag: "crashed" },
    stopped: { _tag: "stopped" }
  } as const

  // The return type is annotated on purpose: `tsc` fails here if `displayedState` returns a plain string
  // union instead of `DisplayedState` (fix round 1, item 8).
  const show = (state: (typeof variants)[keyof typeof variants], permissions: number, questions: number): Shown =>
    displayedState({
      state: state as never,
      openPermissionRequests: permissions,
      openQuestionsAsked: questions
    })

  // The ten display strings in the plan's table order (criterion 3.5, the derivation table).
  // Catches: a string reworded, dropped, added or reordered in the exported `DisplayedState` schema,
  // so a client that switches on it would miss a case.
  it("exports DisplayedState with the ten strings of the table, in the table's order", () => {
    expect([...DisplayedState.literals]).toEqual([
      "Stopped",
      "Crashed",
      "Interrupted",
      "Signed out",
      "Paused for a limit",
      "Starting",
      "Waiting on a permission",
      "Waiting on an answer",
      "Working",
      "Idle"
    ])
  })

  // Catches: `displayedState` returning a string that `DisplayedState` does not accept (the type and the
  // function drifting apart). Every state with every count combination must give a member.
  it("returns only members of DisplayedState", () => {
    const isDisplayed = Schema.is(DisplayedState)
    for (const state of Object.values(variants)) {
      for (const [permissions, questions] of [[0, 0], [1, 0], [0, 1], [2, 2]] as const) {
        expect(isDisplayed(show(state, permissions, questions)), `${JSON.stringify(state)} ${permissions} ${questions}`).toBe(true)
      }
    }
  })

  // Rows of the plan's table, one per row, with no counts open.
  // Catches: a row missing or wrongly worded in the derivation.
  it.each([
    ["stopped", "Stopped"],
    ["crashed", "Crashed"],
    ["interrupted", "Interrupted"],
    ["paused (signed-out)", "Signed out"],
    ["paused (limit)", "Paused for a limit"],
    ["starting", "Starting"],
    ["working", "Working"],
    ["idle", "Idle"]
  ] as const)("%s with nothing open shows %s", (name, expected) => {
    expect(show(variants[name], 0, 0)).toBe(expected)
  })

  // Catches: "Waiting on a permission" or "Waiting on an answer" derived for an agent that is not
  // working or idle (rows 4 and 5 of the table name only working or idle).
  it.each([
    [{ permissions: 1, questions: 0 }, "Waiting on a permission"],
    [{ permissions: 0, questions: 1 }, "Waiting on an answer"]
  ] as const)("working or idle with %j shows %s", (counts, expected) => {
    expect(show(variants.working, counts.permissions, counts.questions)).toBe(expected)
    expect(show(variants.idle, counts.permissions, counts.questions)).toBe(expected)
  })

  // Catches: the order of the rows. A stopped, crashed, interrupted, paused or starting agent with open
  // requests still shows its lifecycle state, because those rows come first.
  it.each(["stopped", "crashed", "interrupted", "paused (signed-out)", "paused (limit)", "starting"] as const)(
    "%s with open requests and questions still shows its own state",
    (name) => {
      expect(show(variants[name], 3, 2)).toBe(show(variants[name], 0, 0))
      expect(show(variants[name], 1, 0)).toBe(show(variants[name], 0, 0))
      expect(show(variants[name], 0, 1)).toBe(show(variants[name], 0, 0))
    }
  )

  // Catches (the plan's named ordering cases): a stopped agent showing "Waiting on a permission",
  // and an idle agent with both open showing "Waiting on an answer" instead of the permission.
  it("shows Stopped for a stopped agent with open permission requests", () => {
    expect(show(variants.stopped, 2, 0)).toBe("Stopped")
  })
  it("shows Waiting on a permission when permission and question are both open", () => {
    expect(show(variants.idle, 1, 1)).toBe("Waiting on a permission")
    expect(show(variants.working, 1, 1)).toBe("Waiting on a permission")
  })

  // Catches: counts above one treated differently from one (the test is "> 0", not "== 1").
  it("treats any positive count as open", () => {
    expect(show(variants.idle, 7, 0)).toBe("Waiting on a permission")
    expect(show(variants.idle, 0, 9)).toBe("Waiting on an answer")
  })

  // Catches: the pause's mid-turn flag leaking into the display (row 53 uses it for the carry-on only).
  it("does not change with the mid-turn flag", () => {
    for (const reason of ["limit", "signed-out"] as const) {
      const a = displayedState({
        state: { _tag: "paused", reason, midTurn: true } as never,
        openPermissionRequests: 0,
        openQuestionsAsked: 0
      })
      const b = displayedState({
        state: { _tag: "paused", reason, midTurn: false } as never,
        openPermissionRequests: 0,
        openQuestionsAsked: 0
      })
      expect(a).toBe(b)
    }
  })
})

describe("command table: (lifecycle state, command) cells", () => {
  type Outcome = "allowed" | "queued" | "refused"
  type Command = "prompt" | "compact" | "resume" | "stop" | "group"
  const commands: ReadonlyArray<Command> = ["prompt", "compact", "resume", "stop", "group"]

  // The table, one row per state, in the order of `commands`.
  // Row 24: `prompt` to idle or working (queued while working), refused to crashed and stopped;
  //   `compact` only when idle; `resume` for stopped, crashed and interrupted; `stop` for any non-stopped state.
  // Row 62: `prompt` to a starting agent is queued; `group` is allowed in every state.
  // Readings (the plan is silent): `prompt` to a paused or interrupted agent is queued (it is delivered
  //   when the agent returns; refusing would lose the owner's message); `resume` is refused while paused
  //   (a pause ends by "account available", not by `resume`).
  const table: Record<StateName, readonly [Outcome, Outcome, Outcome, Outcome, Outcome]> = {
    starting: ["queued", "refused", "refused", "allowed", "allowed"],
    working: ["queued", "refused", "refused", "allowed", "allowed"],
    idle: ["allowed", "allowed", "refused", "allowed", "allowed"],
    paused: ["queued", "refused", "refused", "allowed", "allowed"],
    interrupted: ["queued", "refused", "allowed", "allowed", "allowed"],
    crashed: ["refused", "refused", "allowed", "allowed", "allowed"],
    stopped: ["refused", "refused", "allowed", "refused", "allowed"]
  }

  const cells = states.flatMap((state) =>
    commands.map((command, index) => [state, command, table[state][index]!] as const)
  )

  // Catches: any cell of the table answered differently: a prompt accepted by a stopped agent, a
  // compact sent to a working agent, `stop` allowed on a stopped agent, `resume` on a running one.
  it.each(cells)("%s + %s -> %s", (state, command, expected) => {
    expect(commandOutcome(state, command)).toBe(expected)
  })

  // Catches (row 62): a prompt to a starting agent refused instead of queued.
  it("queues a prompt for a starting agent (row 62)", () => {
    expect(commandOutcome("starting", "prompt")).toBe("queued")
  })

  // Catches (row 62): `group` refused in some state (it only renames a label).
  it("allows group in every state (row 62)", () => {
    for (const state of states) expect(commandOutcome(state, "group")).toBe("allowed")
  })

  // Catches (row 24): `compact` allowed anywhere but idle.
  it("allows compact only in idle (row 24)", () => {
    expect(states.filter((state) => commandOutcome(state, "compact") === "allowed")).toEqual(["idle"])
  })

  // Catches (row 24): `resume` allowed anywhere but stopped, crashed and interrupted.
  it("allows resume only in stopped, crashed and interrupted (row 24)", () => {
    expect(states.filter((state) => commandOutcome(state, "resume") === "allowed").sort()).toEqual([
      "crashed",
      "interrupted",
      "stopped"
    ])
  })

  // Catches (row 24): `stop` allowed on a stopped agent, or refused on any other state.
  it("allows stop in every state but stopped (row 24)", () => {
    expect(states.filter((state) => commandOutcome(state, "stop") === "refused")).toEqual(["stopped"])
  })

  // Catches: the command table and the transition table disagreeing: a command allowed but the state
  // change it causes not legal.
  it("agrees with the transition table for stop and resume", () => {
    for (const state of states) {
      if (commandOutcome(state, "stop") === "allowed") expect(canTransition(state, "stopped"), `${state} -> stopped`).toBe(true)
      if (commandOutcome(state, "resume") === "allowed") expect(canTransition(state, "starting"), `${state} -> starting`).toBe(true)
    }
  })
})

describe("transition table: which state change is legal", () => {
  // From each state, the states it may change to. Readings (the plan gives no list):
  //  - a running agent (starting, working, idle) can pause, be interrupted by a restart, crash or be stopped;
  //  - starting -> idle (session opened) and idle -> working (message sent); working -> idle (turn ended);
  //  - paused -> starting (cleared before the session opened), idle or working (cleared; a mid-turn agent
  //    gets a carry-on), crashed, stopped, and paused again (the reason changed, row 53);
  //  - crashed and stopped only restart (`resume`, to starting) or, if not stopped, get stopped;
  //  - interrupted: restarted (to starting), or stopped, or, after a successful reload, the transaction written
  //    at the end of recovery sets the agent's state: working if it was mid-turn or has an unaccepted delivery,
  //    idle otherwise (row 66, row 52 step 6). So interrupted -> idle and interrupted -> working are legal;
  //    starting -> working stays illegal, because an agent caught starting is started again
  //    (interrupted -> starting) and then opens its session;
  //  - no state changes to itself except paused (reason change).
  const legal: Record<StateName, ReadonlyArray<StateName>> = {
    starting: ["idle", "paused", "interrupted", "crashed", "stopped"],
    working: ["idle", "paused", "interrupted", "crashed", "stopped"],
    idle: ["working", "paused", "interrupted", "crashed", "stopped"],
    paused: ["starting", "idle", "working", "crashed", "stopped", "paused"],
    interrupted: ["starting", "idle", "working", "stopped"],
    crashed: ["starting", "stopped"],
    stopped: ["starting"]
  }

  const cells = states.flatMap((from) => states.map((to) => [from, to, legal[from].includes(to)] as const))

  // Catches: any of the 49 state changes answered wrongly: a stopped agent going straight to working,
  // a crashed agent going idle without a restart, an agent "changing" to its own state, and (row 66) an
  // interrupted agent that recovered being unable to go to idle or working.
  it.each(cells)("%s -> %s is %s", (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected)
  })
})

describe("event table: (lifecycle state, event) cells", () => {
  type Effect = "invalid" | "keep" | "transition" | StateName

  const tags = Event.members.map((member) => {
    const ast = member.ast as SchemaAST.Objects
    const tag = ast.propertySignatures.find((property) => property.name === "_tag")!.type as SchemaAST.Literal
    return String(tag.literal)
  })

  const allStates = (effect: Effect): Record<StateName, Effect> => ({
    starting: effect,
    working: effect,
    idle: effect,
    paused: effect,
    interrupted: effect,
    crashed: effect,
    stopped: effect
  })

  // What an event does to an agent that is in a given state. `invalid` means the log must never hold
  // this event for an agent in this state (the writer refuses it); `keep` means valid and the lifecycle
  // state stays; `transition` means valid and the event itself carries the new state (checked against
  // the transition table); a state name means valid and the agent is in that state afterwards.
  // Rows: 24 (the seven states), 53 (pauses), 62 (a delivery to a stopped agent is withdrawn; a prompt to a
  // starting agent is queued). Events not listed here are valid and change nothing in every state.
  const overrides: Record<string, Record<StateName, Effect>> = {
    // An agent that exists has already started: `start` creates it, so this event is never valid for one.
    AgentStarted: allStates("invalid"),
    // Row 70: if the adapter rejects a value, "agent start failed" is written and the agent becomes stopped.
    // Only an agent that is starting can fail to start.
    AgentStartFailed: { ...allStates("invalid"), starting: "stopped" },
    // Fix round 1, item 3: an account event, so it is valid and changes nothing in every state.
    AccountOutOfUsage: allStates("keep"),
    SessionOpened: { ...allStates("invalid"), starting: "idle" },
    TurnStarted: { ...allStates("invalid"), working: "keep" },
    TurnEnded: { ...allStates("invalid"), working: "idle" },
    StateChanged: allStates("transition"),
    AgentCrashed: { ...allStates("invalid"), starting: "crashed", working: "crashed", idle: "crashed", paused: "crashed" },
    AgentInterrupted: { ...allStates("invalid"), starting: "interrupted", working: "interrupted", idle: "interrupted" },
    AgentStopped: { ...allStates("stopped"), stopped: "invalid" },
    AgentReloadFailed: { ...allStates("invalid"), interrupted: "keep", paused: "keep" },
    DeliveryQueued: { ...allStates("keep"), crashed: "invalid", stopped: "invalid" },
    DeliverySent: { ...allStates("invalid"), idle: "working", working: "keep" }
  }

  const expectedFor = (tag: string, state: StateName): Effect => overrides[tag]?.[state] ?? "keep"

  const cells = tags.flatMap((tag) => states.map((state) => [tag, state, expectedFor(tag, state)] as const))

  // Catches: the table missing a cell, or an event added to the union that the table does not know
  // (every event must have an answer in every state, 41 events by 7 states).
  it("has a defined answer for every event in every state", () => {
    expect(cells.length).toBe(tags.length * states.length)
    for (const [tag, state] of cells) {
      const effect = eventEffect(state, tag as never)
      expect(["invalid", "keep", "transition", ...states], `${tag} in ${state}`).toContain(effect)
    }
  })

  // Catches: any cell answered differently, for example `TurnStarted` valid on an idle agent,
  // `DeliveryQueued` valid for a stopped agent (row 62 says it is withdrawn instead), a crash event
  // accepted for a stopped agent, `AgentStopped` accepted twice.
  it.each(cells)("%s in %s -> %s", (tag, state, expected) => {
    expect(eventEffect(state, tag as never)).toBe(expected)
  })

  // Catches (row 62): a delivery to a stopped agent being kept in its queue instead of withdrawn:
  // a queue event is invalid for it, and the withdrawal event is valid.
  it("withdraws, rather than queues, a delivery to a stopped agent (row 62)", () => {
    expect(eventEffect("stopped", "DeliveryQueued")).toBe("invalid")
    expect(eventEffect("stopped", "DeliveryWithdrawn")).toBe("keep")
  })

  // Catches (row 62): a prompt to a starting agent being refused: its delivery is queued.
  it("queues a delivery for a starting agent (row 62)", () => {
    expect(eventEffect("starting", "DeliveryQueued")).toBe("keep")
  })

  // Catches: an event table that forces a state the transition table forbids (two tables that drift
  // apart): every forced change must be a legal state change.
  it("forces only state changes the transition table allows", () => {
    for (const [tag, state] of cells) {
      const effect = eventEffect(state, tag as never)
      if (effect !== "invalid" && effect !== "keep" && effect !== "transition") {
        expect(canTransition(state, effect), `${tag}: ${state} -> ${effect}`).toBe(true)
      }
    }
  })
})
