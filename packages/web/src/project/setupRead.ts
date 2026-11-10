import type { Client } from "@lgcode/client/browser"
import { EventEnvelope, type EventSequence } from "@lgcode/contracts"
import * as Schema from "effect/Schema"
import type { ProjectId, ProjectSettings, RequestId, SetupState } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import { requestId } from "../thread/client.ts"

export const readSetup = (client: Client) => Effect.gen(function* () {
  const { setup } = yield* client["project.setup"]({ requestId: requestId() })
  const { settings } = yield* client["project.settings"]({ requestId: requestId() })
  const { result: discovery } = yield* client["project.setup.discover"]({ requestId: requestId() })
  return { setup, ...(settings === undefined ? {} : { settings }), discovery }
})

export const advanceSetup = (client: Client, step: SetupState["step"]) => Effect.gen(function* () {
  yield* client["project.setup.advance"]({ requestId: requestId(), step })
  return (yield* client["project.setup"]({ requestId: requestId() })).setup
})

export const completeSetup = (client: Client, attempt: { readonly projectId: ProjectId; readonly requestId: RequestId }) => Effect.gen(function* () {
  const current = yield* client["project.setup"]({ requestId: requestId() })
  if (current.setup.completedAt !== undefined) return current.setup
  yield* client["project.setup.complete"](attempt)
  return (yield* client["project.setup"]({ requestId: requestId() })).setup
})

// Read the saved settings immediately before editing one field, preserving
// explicit displayName and unrelated lead choices rather than a stale draft.
export const changeSetupSettings = (client: Client, change: Partial<ProjectSettings>) => Effect.gen(function* () {
  const current = yield* client["project.settings"]({ requestId: requestId() })
  const settings = { ...current.settings, ...change }
  if (settings.workspaceFolder === undefined || settings.shell === undefined) return false
  yield* client["project.settings.set"]({ requestId: requestId(), settings: { ...settings, workspaceFolder: settings.workspaceFolder, shell: settings.shell } })
  return true
})

// The exact durable owner refusal permits a new completion attempt after the
// existing lead is repaired. An ambiguous transport/database failure does not.
export const setupCompletionRefused = (client: Client, original: RequestId) => Effect.gen(function* () {
  const headId = requestId(), head = yield* client["client.sequence"]({ requestId: headId })
  if (head.requestId !== headId) return false
  for (let sequence = head.sequence; sequence > Math.max(0, head.sequence - 64); sequence--) {
    const readId = requestId(), reply = yield* client["client.event"]({ requestId: readId, sequence: sequence as EventSequence })
    if (reply.requestId !== readId || !("envelope" in reply) || !Schema.is(EventEnvelope)(reply.envelope)) continue
    const row = reply.envelope
    if (row.sequence === sequence && row.requestId === original && row.caller._tag === "owner"
      && row.event._tag === "CommandRefused" && row.event.command === "project.setup.complete") return true
  }
  return false
}).pipe(Effect.catch(() => Effect.succeed(false)))
