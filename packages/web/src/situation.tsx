import { useEffect, useRef, useState } from "react"
import { displayedState, type ClientSnapshot, type RosterEntry } from "@shephrd/contracts"
import { watchSituation, type ConnectionState } from "./watchSituation.ts"
import { threadHref } from "./thread/links.ts"

function lane(agent: RosterEntry): "Needs you" | "Working" | "Idle" {
  if (agent.openPermissionRequests > 0 || agent.openQuestionsAsked > 0
    || ["paused", "interrupted", "crashed"].includes(agent.state._tag)) return "Needs you"
  return agent.state._tag === "starting" || agent.state._tag === "working" ? "Working" : "Idle"
}

export function Situation({ onSessionExpired }: { readonly onSessionExpired: () => void }) {
  const [snapshot, setSnapshot] = useState<ClientSnapshot>()
  const [connection, setConnection] = useState<ConnectionState>("Connecting")
  const expired = useRef(onSessionExpired)
  expired.current = onSessionExpired

  useEffect(() => {
    const controller = new AbortController()
    void watchSituation({
      onSnapshot: setSnapshot,
      onConnection: setConnection,
      onSessionExpired: () => expired.current()
    }, controller.signal)
    return () => controller.abort()
  }, [])

  return <section aria-label="Situation">
    <h2>Situation</h2>
    <p role="status">{connection}{connection === "Reconnecting" && snapshot !== undefined ? ". Showing the last received state." : ""}</p>
    {(["Needs you", "Working", "Idle"] as const).map((name) => {
      const agents = snapshot?.agents.filter((agent) => lane(agent) === name) ?? []
      return <section key={name} aria-label={name}>
        <h3>{name} ({agents.length})</h3>
        {snapshot === undefined ? <p>Loading agents…</p> : agents.length === 0 ? <p>No agents.</p> : <ul>
          {agents.map((agent) => <li key={agent.agentId}>
            <a href={threadHref(agent.agentId)}><strong>{agent.name}</strong></a>
            <p>{displayedState(agent)} · {agent.role} · {agent.harness}</p>
            {agent.groups.length > 0 && <p>Groups: {agent.groups.join(", ")}</p>}
            {(agent.openPermissionRequests > 0 || agent.openQuestionsAsked > 0) && <p>
              {agent.openPermissionRequests} open permissions, {agent.openQuestionsAsked} open questions.
            </p>}
          </li>)}
        </ul>}
      </section>
    })}
  </section>
}
