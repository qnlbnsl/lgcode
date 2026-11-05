import { useRef, useState } from "react"
import { commandOutcome, type AgentId, type ClientSnapshot } from "@shephrd/contracts"
import { requestId, withClient } from "./client.ts"

type Agent = ClientSnapshot["agents"][number]
export function Lifecycle({ agent, signal }: { readonly agent: Agent; readonly signal: AbortSignal }) {
  const locked = useRef(false)
  const attempt = useRef<{ action: "stop" | "resume"; requestId: ReturnType<typeof requestId> } | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const fresh = agent.session === undefined || agent.reloadable === false
  const run = (action: "stop" | "resume") => {
    if (locked.current || signal.aborted) return
    locked.current = true
    setBusy(true)
    setMessage("")
    if (attempt.current?.action !== action) attempt.current = { action, requestId: requestId() }
    const payload = { agentId: agent.agentId as AgentId, requestId: attempt.current.requestId }
    void withClient((client) => action === "stop" ? client.stop(payload)
      : client.resume({ ...payload, ...(fresh ? { fresh: true } : {}) }), signal)
      .then(() => { if (!signal.aborted) { attempt.current = undefined; setMessage(action === "stop" ? "Agent stopped." : "Resume requested.") } })
      .catch(() => { if (!signal.aborted) setMessage("Could not confirm the action. You can retry.") })
      .finally(() => { if (!signal.aborted) { locked.current = false; setBusy(false) } })
  }
  return <div aria-label="Agent controls">
    {commandOutcome(agent.state._tag, "stop") === "allowed" && <button disabled={busy} onClick={() => run("stop")}>Stop agent</button>}
    {commandOutcome(agent.state._tag, "resume") === "allowed" && <>
      {agent.session !== undefined && agent.reloadable === false && <p>This session cannot be reloaded. Resume starts a new session and loses the old session's context.</p>}
      <button disabled={busy} onClick={() => run("resume")}>Resume agent</button>
    </>}
    {message && <p role="status">{message}</p>}
  </div>
}
