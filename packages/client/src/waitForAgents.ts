import { foldSettled, holdUnsettled, pieceNamespaces, reasonOf, waitSatisfied, type ClientSnapshot, type EventEnvelope, type SettledInput, type WaitMember, type RequestId, type HoldCondition } from "@shephrd/contracts"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { Client, ClientEnvelope } from "./core.ts"
import { ClientError } from "./errors.ts"

export interface WaitOptions {
  readonly members: ReadonlyArray<string>
  readonly mode: "any" | "all"
}
export interface ClientWaitReply {
  readonly outcome: "satisfied" | "request-held"
  readonly members: ReadonlyArray<WaitMember>
}
interface ConditionLists {
  readonly sequence: number
  readonly holdsUnsettled: ReadonlyArray<string>
  readonly ownerHeld?: ReadonlyArray<string>
}
const keyed = <A>(rows: ReadonlyArray<A>, id: (row: A) => string) => Object.fromEntries(rows.map((row) => [id(row), row]))
const requestId = () => globalThis.crypto.randomUUID() as RequestId
const inputs = (snapshot: ClientSnapshot): SettledInput => ({
  agents: keyed(snapshot.agents, (row) => row.agentId),
  requests: keyed(snapshot.requests.map((row) => ({ ...row, status: "open" })), (row) => row.id),
  questions: keyed(snapshot.questions.map((row) => ({ ...row, status: "open" })), (row) => row.id),
  deliveries: keyed(snapshot.waitState!.deliveries, (row) => row.id),
  waits: keyed(snapshot.waitState!.waits.map((row) => ({ ...row, status: "open", blocking: false })), (row) => row.waitId),
})

// Consume the unfiltered stream one event at a time. A pull's unused suffix
// stays buffered while a gate applies exactly through a published sequence.
export const waitForAgents = (client: Client, options: WaitOptions): Effect.Effect<ClientWaitReply, unknown> => Effect.gen(function* () {
  if (options.members.length === 0 || !["any", "all"].includes(options.mode)) return yield* new ClientError({ message: "wait needs members and mode any or all" })
  const snapshot = yield* client["client.snapshot"]({ requestId: requestId() })
  if (snapshot.waitState === undefined) return yield* new ClientError({ message: "client wait requires an owner or service identity" })
  if ((snapshot.failedSections?.length ?? 0) > 0) return yield* new ClientError({ message: "a wait snapshot section is unavailable" })
  let state = inputs(snapshot)
  let sequence: number = snapshot.sequence
  const conditions = new Map<string, ConditionLists>()
  for (const namespace of pieceNamespaces) {
    const section = snapshot[namespace] as ConditionLists | undefined
    if (section !== undefined && Array.isArray(section.holdsUnsettled)) conditions.set(namespace, section)
  }
  const call = client as unknown as Record<string, (payload: unknown) => Effect.Effect<any, unknown>>
  const readGate = (): Effect.Effect<number, unknown> => Effect.gen(function* () {
    if (conditions.size === 0) return (yield* client["client.sequence"]({ requestId: requestId() })).sequence
    // More than one piece must name the same published state. Reread the older
    // lists, rather than mixing holds computed at different sequences.
    for (const namespace of conditions.keys()) {
      const read = call[`${namespace}.status`]
      if (read === undefined) return yield* new ClientError({ message: "a wait condition read is unavailable" })
      conditions.set(namespace, yield* read({ requestId: globalThis.crypto.randomUUID() }))
    }
    for (;;) {
      const latest = Math.max(...[...conditions.values()].map((lists) => lists.sequence))
      const older = [...conditions].filter(([, lists]) => lists.sequence < latest)
      if (older.length === 0) return latest
      for (const [namespace] of older) conditions.set(namespace, yield* call[`${namespace}.status`]!({ requestId: globalThis.crypto.randomUUID() }))
    }
  })
  const candidate = (): ClientWaitReply | undefined => {
    const resolved: WaitMember[] = []
    let ownerHeld = false
    for (const id of options.members) {
      const agent = Object.hasOwn(state.agents, id) ? state.agents[id] : undefined
      if (agent === undefined) continue
      if (agent.state._tag !== "stopped" && agent.state._tag !== "crashed") {
        ownerHeld ||= [...Object.values(state.requests), ...Object.values(state.questions)].some((row) => row.agentId === id && row.status === "open" && row.holder._tag === "owner")
          || [...conditions.values()].some((lists) => lists.ownerHeld?.includes(id))
      }
      const reason = reasonOf(state, id)
      const held = reason === "settled" && (pieceNamespaces.some((namespace) => {
        try { return (holdUnsettled[namespace] as HoldCondition)(state, id, conditions.get(namespace)) }
        catch { return true }
      })
        || [...conditions.values()].some((lists) => lists.holdsUnsettled.includes(id)))
      if (reason !== undefined && !held) resolved.push({ agentId: id as WaitMember["agentId"], reason })
    }
    if (ownerHeld) return { outcome: "request-held", members: resolved }
    return waitSatisfied(options.mode, options.members, resolved) ? { outcome: "satisfied", members: resolved } : undefined
  }
  let initial = true
  // Failed gates cancel their subscription and reopen from the applied cursor.
  // They never turn an unverified candidate into a result.
  for (;;) {
    const attempt = yield* Effect.scoped(Effect.gen(function* () {
      const pull = yield* Stream.toPull(client.subscribe({ requestId: requestId(), after: sequence as EventEnvelope["sequence"] }))
      let buffered: ReadonlyArray<ClientEnvelope> = []
      let offset = 0
      const advance = Effect.gen(function* () {
        if (offset === buffered.length) { buffered = yield* pull; offset = 0 }
        const next = buffered[offset++]!
        if (next.event._tag !== "UnknownEvent") state = foldSettled(state, next as EventEnvelope)
        sequence = next.sequence
        return next
      })
      if (initial) {
        if (conditions.size > 0) {
          let gate = yield* readGate()
          while (gate < sequence) gate = yield* readGate()
          while (sequence < gate) yield* advance
        }
        initial = false
        const result = candidate()
        if (result !== undefined) return result
      } else if (candidate() !== undefined) {
        // A failed gate may be followed by a quiet stream. Recheck that
        // candidate after reconnect without requiring another log event.
        let gate = yield* readGate()
        while (gate < sequence) gate = yield* readGate()
        while (sequence < gate) yield* advance
        const result = candidate()
        if (result !== undefined) return result
      }
      for (;;) {
        const next = yield* advance
        const tag = next.event._tag === "UnknownEvent" ? next.event.tag : next.event._tag
        const pieceChanged = conditions.has(tag.split(".")[0]!)
        if (candidate() === undefined && !pieceChanged) continue
        let gate = yield* readGate()
        while (gate < sequence) gate = yield* readGate()
        while (sequence < gate) yield* advance
        const result = candidate()
        if (result !== undefined) return result
      }
    })).pipe(Effect.result)
    if (attempt._tag === "Success") return attempt.success
    yield* Effect.sleep(100)
  }
})
