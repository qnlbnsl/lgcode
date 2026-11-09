import { foldSettled, pieceNamespaces, reasonOf, waitSatisfied, type ClientSnapshot, type EventEnvelope, type PieceNamespace, type SettledInput, type WaitMember, type RequestId } from "@lgcode/contracts"
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
// A failed snapshot hook must not hide the piece's independent condition read.
const conditionReads = {
  client: undefined, board: "board.status", roles: undefined, project: undefined,
} as const satisfies Record<PieceNamespace, keyof Client | undefined>
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
  let state = inputs(snapshot)
  let sequence: number = snapshot.sequence
  const conditions = new Map<PieceNamespace, ConditionLists>()
  const namespaces = new Set(pieceNamespaces.filter((namespace) => conditionReads[namespace] !== undefined
    && (snapshot[namespace] !== undefined || snapshot.failedSections?.includes(namespace))))
  const call = client as unknown as Record<string, (payload: unknown) => Effect.Effect<any, unknown>>
  const readGate = (): Effect.Effect<number, unknown> => Effect.gen(function* () {
    if (namespaces.size === 0) return (yield* client["client.sequence"]({ requestId: requestId() })).sequence
    // More than one piece must name the same published state. Reread the older
    // lists, rather than mixing holds computed at different sequences.
    for (const namespace of namespaces) {
      const read = call[conditionReads[namespace]!]
      if (read === undefined) return yield* new ClientError({ message: "a wait condition read is unavailable" })
      conditions.set(namespace, yield* read({ requestId: globalThis.crypto.randomUUID() }))
    }
    for (;;) {
      const latest = Math.max(...[...conditions.values()].map((lists) => lists.sequence))
      const older = [...conditions].filter(([, lists]) => lists.sequence < latest)
      if (older.length === 0) return latest
      for (const [namespace] of older) conditions.set(namespace, yield* call[conditionReads[namespace]!]!({ requestId: globalThis.crypto.randomUUID() }))
    }
  })
  const candidate = (includePieceHolds = true): ClientWaitReply | undefined => {
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
      // A client receives the piece's computed condition lists, not its full
      // private view. Apply those lists after their sequence gate is current.
      const held = includePieceHolds && reason === "settled" && [...conditions.values()].some((lists) => lists.holdsUnsettled.includes(id))
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
        if (namespaces.size > 0) {
          let gate = yield* readGate()
          while (gate < sequence) gate = yield* readGate()
          while (sequence < gate) yield* advance
        }
        initial = false
        const result = candidate()
        if (result !== undefined) return result
      } else if (candidate(false) !== undefined) {
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
        const pieceChanged = namespaces.has(tag.split(".")[0] as PieceNamespace)
        // Cached piece holds must not suppress the read that can clear them.
        // Use engine eligibility to trigger a gate, then apply every fresh hold.
        if (candidate(false) === undefined && !pieceChanged) continue
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
