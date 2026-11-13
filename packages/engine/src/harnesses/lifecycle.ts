import { randomUUID } from "node:crypto"
import { Event, RequestId } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { Runtime } from "../commands/internal.ts"
// Keep this module independent of the API read table's initialization cycle.
export const recoverInstalls = (runtime: Runtime) => Effect.gen(function* () {
  if (!runtime.harnessPrograms?.recover) return
  yield* Effect.tryPromise({ try: () => runtime.harnessPrograms!.recover!(), catch: () => new Error("A leftover harness install could not be stopped.") })
  const rows = yield* runtime.sql<{ payload_json: string }>`SELECT payload_json FROM events WHERE event_type = 'HarnessInstallStarted'
    AND NOT EXISTS (SELECT 1 FROM events finished WHERE finished.event_type = 'HarnessInstallFinished'
      AND json_extract(finished.payload_json, '$.operationRequestId') = json_extract(events.payload_json, '$.operationRequestId'))`
  for (const row of rows) {
    const event = Schema.decodeUnknownSync(Event)(JSON.parse(row.payload_json))
    if (event._tag !== "HarnessInstallStarted") continue
    yield* runtime.log.append({ _tag: "owner" }, Schema.decodeUnknownSync(RequestId)(randomUUID()), randomUUID(),
      [{ _tag: "HarnessInstallFinished", harnessId: event.harnessId, operationRequestId: event.operationRequestId,
        state: "failed", reason: "The service stopped during the install. Leftover processes were stopped and the partial installation was removed." }], {}, false)
  }
})
