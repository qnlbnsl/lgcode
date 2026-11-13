import { test } from "@playwright/test"
import * as Effect from "effect/Effect"
import { readLog } from "../../../engine/test/support/handlerRig.ts"

// Keep the engine's durable timeline beside the browser trace before the
// fixture removes its database. Do not attach account data or credentials.
export const attachEngineEvents = Effect.gen(function* () {
  const result = yield* Effect.result(readLog)
  const events = result._tag === "Failure" ? { unavailable: "The engine event read failed." }
    : result.success.map(({ sequence, requestId, event }) => ({ sequence, requestId, tag: event._tag,
    ...(event._tag === "project.GitAttempted" ? { command: event.attempt.command, operationRequestId: event.attempt.requestId } : {}),
    ...(event._tag === "project.GitFinished" ? { operationRequestId: event.operationRequestId, outcome: event.outcome, refusal: event.refusal } : {}) }))
  yield* Effect.promise(() => test.info().attach("engine-events", { body: JSON.stringify(events, null, 2), contentType: "application/json" }))
})
