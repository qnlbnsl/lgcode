import { useEffect } from "react"
import { commandOutcome, type ClientSnapshot } from "@lgcode/contracts"
import { requestId, withClient } from "./client.ts"
import { useConversation, useMutationDisabled } from "../data/ShellDataProvider.tsx"
import * as Effect from "effect/Effect"

type Agent = ClientSnapshot["agents"][number]
export function Lifecycle({ agent, signal, disabled = false }: { readonly agent: Agent; readonly signal: AbortSignal; readonly disabled?: boolean }) {
  const disconnected = useMutationDisabled()
  const { state, entry, session } = useConversation({ _tag: "agent", agentId: agent.agentId })
  disabled = disabled || disconnected
  const busy = state.lifecycleAttempt?.status === "sending"
  const fresh = agent.session === undefined || agent.reloadable === false
  useEffect(() => {
    const attempt = entry.state.lifecycleAttempt
    if (!attempt) return
    // A real snapshot can establish the requested lifecycle outcome even
    // when its command receipt was lost. A refusal string cannot do so.
    if (attempt.action === "stop" && agent.state._tag === "stopped") entry.update({ lifecycleAttempt: undefined, lifecycleMessage: "Agent stopped." })
    else if (attempt.action === "resume" && ["starting", "idle", "working", "paused"].includes(agent.state._tag)) entry.update({ lifecycleAttempt: undefined, lifecycleMessage: "Resume observed." })
  }, [agent.state._tag, entry])
  const run = async (action: "stop" | "resume") => {
    if (disabled || signal.aborted || session.controller.signal.aborted || entry.state.lifecycleAttempt?.status === "sending"
      || commandOutcome(agent.state._tag, action) !== "allowed") return
    const previous = entry.state.lifecycleAttempt
    if (previous !== undefined && previous.action !== action) return
    const attempt = previous ?? { action, payload: { agentId: agent.agentId, requestId: requestId(), ...(action === "resume" && fresh ? { fresh: true as const } : {}) } }
    entry.update({ lifecycleAttempt: { ...attempt, status: "sending" }, lifecycleMessage: "" })
    try {
      const result = await withClient((client) => Effect.result(action === "stop" ? client.stop(attempt.payload) : client.resume(attempt.payload)), session.controller.signal)
      if (session.controller.signal.aborted || entry.state.lifecycleAttempt?.payload.requestId !== attempt.payload.requestId) return
      if (result._tag === "Failure") entry.update({ lifecycleAttempt: { ...attempt, status: "uncertain" }, lifecycleMessage: "Could not confirm the action. You can retry." })
      else entry.update({ lifecycleAttempt: undefined, lifecycleMessage: action === "stop" ? "Agent stopped." : "Resume requested." })
    } catch {
      if (!session.controller.signal.aborted && entry.state.lifecycleAttempt?.payload.requestId === attempt.payload.requestId) entry.update({ lifecycleAttempt: { ...attempt, status: "uncertain" }, lifecycleMessage: "Could not confirm the action. You can retry." })
    }
  }
  return <div aria-label="Agent controls">
    {commandOutcome(agent.state._tag, "stop") === "allowed" && <button disabled={disabled || busy || state.lifecycleAttempt?.action === "resume"} onClick={() => { void run("stop") }}>Stop agent</button>}
    {commandOutcome(agent.state._tag, "resume") === "allowed" && <>
      {agent.session !== undefined && agent.reloadable === false && <p>This session cannot be reloaded. Resume starts a new session and loses the old session's context.</p>}
      <button disabled={disabled || busy || state.lifecycleAttempt?.action === "stop"} onClick={() => { void run("resume") }}>Resume agent</button>
    </>}
    {state.lifecycleMessage && <p role="status">{state.lifecycleMessage}</p>}
  </div>
}
