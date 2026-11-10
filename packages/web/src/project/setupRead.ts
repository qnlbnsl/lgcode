import type { Client } from "@lgcode/client/browser"
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
