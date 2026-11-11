import { EventEnvelope, EventSequence, type RequestId } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { requestId, withClient } from "./client.ts"

// Evidence belongs to the existing authenticated conversation attempt. Failure
// to read it never establishes refusal, including on a later recovery call.
export const beforeRequest = async (signal: AbortSignal): Promise<EventSequence | undefined> => {
  try {
    const id = requestId()
    const head = await withClient((client) => client["client.sequence"]({ requestId: id }),
      AbortSignal.any([signal, AbortSignal.timeout(2000)]))
    return head.requestId === id && Schema.is(EventSequence)(head.sequence) ? head.sequence : undefined
  } catch { return undefined }
}

export const durableRefusal = async (command: "prompt" | "board.post" | "configure", original: RequestId,
  after: EventSequence | undefined, signal: AbortSignal): Promise<string | undefined> => {
  if (after === undefined || signal.aborted) return undefined
  try {
    return await withClient((client) => Effect.gen(function* () {
      const id = requestId()
      const head = yield* client["client.sequence"]({ requestId: id })
      if (head.requestId !== id || !Schema.is(EventSequence)(head.sequence)) return undefined
      for (let sequence = after + 1; sequence <= Math.min(head.sequence, after + 64); sequence++) {
        const readId = requestId()
        const row = yield* client["client.event"]({ requestId: readId, sequence: sequence as EventSequence })
        if (row.requestId !== readId || !("envelope" in row) || !Schema.is(EventEnvelope)(row.envelope)) continue
        const envelope = row.envelope
        if (envelope.sequence === sequence && envelope.requestId === original && envelope.caller._tag === "owner"
          && envelope.event._tag === "CommandRefused" && envelope.event.command === command) return envelope.event.reason
      }
      return undefined
    }), AbortSignal.any([signal, AbortSignal.timeout(2000)]))
  } catch { return undefined }
}
