import type { ClientEnvelope } from "@lgtm/client/browser"
import type { EventSequence } from "@lgtm/contracts"
import { requestId, withClient } from "../thread/client.ts"

// Only immutable request sources are retained, never a holder/status projection.
// The owner session bounds their lifetime; count and byte limits bound memory.
const sourceLimit = 64
const byteLimit = 8 * 1024 * 1024
export type RequestSources = ReturnType<typeof createRequestSources>
export function createRequestSources() {
  const controller = new AbortController()
  const sources = new Map<EventSequence, { envelope: ClientEnvelope; bytes: number }>()
  const pending = new Map<EventSequence, Promise<ClientEnvelope>>()
  let bytes = 0
  const remember = (envelope: ClientEnvelope) => {
    if (controller.signal.aborted || !["PermissionRequested", "QuestionAsked"].includes(envelope.event._tag)) return
    const size = new TextEncoder().encode(JSON.stringify(envelope)).byteLength
    if (size > byteLimit) return
    const previous = sources.get(envelope.sequence)
    if (previous !== undefined) { sources.delete(envelope.sequence); bytes -= previous.bytes }
    while (sources.size >= sourceLimit || bytes + size > byteLimit) {
      const oldest = sources.keys().next().value!
      bytes -= sources.get(oldest)!.bytes
      sources.delete(oldest)
    }
    sources.set(envelope.sequence, { envelope, bytes: size })
    bytes += size
  }
  const read = (sequence: EventSequence): Promise<ClientEnvelope> => {
    if (controller.signal.aborted) return Promise.reject(new Error("Owner session ended"))
    const cached = sources.get(sequence)
    if (cached !== undefined) {
      sources.delete(sequence); sources.set(sequence, cached)
      return Promise.resolve(cached.envelope)
    }
    const existing = pending.get(sequence)
    if (existing !== undefined) return existing
    if (pending.size >= sourceLimit) return Promise.reject(new Error("Request source reads are busy; try again"))
    const result: Promise<ClientEnvelope> = withClient((client) => client["client.event"]({ requestId: requestId(), sequence }), controller.signal)
      .then((reply) => {
        if (controller.signal.aborted) throw new Error("Owner session ended")
        if (!("envelope" in reply) || reply.envelope.sequence !== sequence) throw new Error("Request source unavailable")
        remember(reply.envelope)
        return reply.envelope
      }).finally(() => { if (pending.get(sequence) === result) pending.delete(sequence) })
    pending.set(sequence, result)
    return result
  }
  const discard = (envelope: ClientEnvelope) => {
    const cached = sources.get(envelope.sequence)
    if (cached?.envelope === envelope) { sources.delete(envelope.sequence); bytes -= cached.bytes }
  }
  return { read, remember, discard, close: () => { controller.abort(); sources.clear(); pending.clear(); bytes = 0 } }
}
