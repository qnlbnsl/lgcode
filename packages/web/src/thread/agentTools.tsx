import { useConversation } from "../data/ShellDataProvider.tsx"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { AccountId, AgentChoices, AgentConfiguration, AgentId, ContextUsage, HarnessId } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import { requestId, withClient } from "./client.ts"
import { beforeRequest, durableRefusal } from "./requestOutcome.ts"

import { visibleText } from "./text.tsx"

interface AgentToolsProps {
  readonly agentId: AgentId
  readonly sequence?: number
  readonly disabled: boolean
  readonly account?: { readonly id: AccountId; readonly harness: HarnessId }
}
export function AgentTools(props: AgentToolsProps) {
  return <AgentConfigurationTools key={props.agentId} {...props} />
}
function AgentConfigurationTools({ agentId, sequence, disabled, account }: AgentToolsProps) {
  const { state, entry, session } = useConversation({ _tag: "agent", agentId })
  const [facts, setFacts] = useState<{ configuration: AgentConfiguration; choices: AgentChoices; context: ContextUsage }>()
  const [refresh, setRefresh] = useState(0)
  const [available, setAvailable] = useState(false)
  const [menu, setMenu] = useState<"model" | "effort">()
  const tools = useRef<HTMLDivElement>(null)
  const modelButton = useRef<HTMLButtonElement>(null), effortButton = useRef<HTMLButtonElement>(null)
  const menuNode = useRef<HTMLDivElement>(null)
  const closeMenu = (focus = false) => {
    if (focus) (menu === "model" ? modelButton : effortButton).current?.focus({ preventScroll: true })
    setMenu(undefined)
  }
  useLayoutEffect(() => {
    if (!menu) return
    const node = menuNode.current
    ;(node?.querySelector<HTMLElement>('[aria-checked="true"]') ?? node?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus()
  }, [menu])
  useEffect(() => {
    if (!menu) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !tools.current?.contains(event.target)) setMenu(undefined) }
    document.addEventListener("pointerdown", outside)
    return () => document.removeEventListener("pointerdown", outside)
  }, [menu])
  useEffect(() => { if (disabled || !available || state.configurationAttempt) setMenu(undefined) }, [disabled, available, state.configurationAttempt])
  useEffect(() => {
    const controller = new AbortController()
    let busy = false
    const read = async () => {
      if (busy || document.hidden) return
      busy = true
      try {
        const [configuration, context] = await Promise.all([
          withClient((client) => client["client.agent.configuration"]({ requestId: requestId(), agentId }), controller.signal),
          withClient((client) => client["client.agent.context"]({ requestId: requestId(), agentId }), controller.signal)
        ])
        if (!controller.signal.aborted) {
          setFacts({ configuration: configuration.configuration, choices: { models: configuration.models, efforts: configuration.efforts }, context: context.context })
          setAvailable(true)
        }
      } catch { if (!controller.signal.aborted) setAvailable(false) }
      finally { busy = false }
    }
    void read()
    const timer = setInterval(() => { void read() }, 5000)
    const visible = () => { if (!document.hidden) void read() }
    document.addEventListener("visibilitychange", visible)
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible) }
  }, [agentId, sequence, refresh])
  const choose = async (axis: "model" | "effort", value: string, recover = false) => {
    if (disabled || session.controller.signal.aborted || entry.state.configurationAttempt?.status === "sending") return
    if (!recover && (entry.state.configurationAttempt !== undefined || !available || !facts?.choices[axis === "model" ? "models" : "efforts"].options.some((option) => option.id === value))) return
    const attempt = recover ? entry.state.configurationAttempt : { requestId: requestId(), [axis]: value }
    if (attempt === undefined) return
    const payload = { requestId: attempt.requestId, agentId, ...(attempt.model === undefined ? {} : { model: attempt.model }), ...(attempt.effort === undefined ? {} : { effort: attempt.effort }) }
    let after = recover ? entry.state.configurationAttempt?.after : undefined
    entry.update({ configurationAttempt: { ...payload, after, status: "sending" }, configurationMessage: "" })
    const current = () => !session.controller.signal.aborted && entry.state.configurationAttempt?.requestId === payload.requestId
    const failed = async () => {
      if (!current()) return
      const reason = await durableRefusal("configure", payload.requestId, after, session.controller.signal)
      if (!current()) return
      entry.update(reason === undefined
        ? { configurationAttempt: { ...payload, after, status: "uncertain" }, configurationMessage: "Could not confirm the configuration." }
        : { configurationAttempt: undefined, configurationMessage: `The engine refused this configuration: ${reason}. Choose another setting.` })
    }
    try {
      if (!recover) {
        after = await beforeRequest(session.controller.signal)
        if (!current()) return
        entry.update({ configurationAttempt: { ...payload, after, status: "sending" } })
      }
      const result = await withClient((client) => Effect.result(client.configure(payload)), session.controller.signal)
      if (!current()) return
      if (result._tag === "Failure") {
        await failed()
      } else entry.update({ configurationAttempt: undefined, configurationMessage: "Selection recorded. Applied settings follow engine acknowledgement." })
    } catch {
      await failed()
    } finally { if (!session.controller.signal.aborted) setRefresh((value) => value + 1) }
  }
  return <div className="agent-tools" aria-label="Agent configuration" ref={tools} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setMenu(undefined)
  }}>
    <Subscription account={account} sequence={sequence} />
    {(["model", "effort"] as const).map((axis) => {
      const choices = facts?.choices[axis === "model" ? "models" : "efforts"]
      const value = facts?.configuration.desired[axis] ?? ""
      const known = choices?.options.some((option) => option.id === value)
      const label = known ? choices?.options.find((option) => option.id === value)?.label ?? value : value || `${axis === "model" ? "Model" : "Effort"} unavailable`
      return <button key={axis} type="button" ref={axis === "model" ? modelButton : effortButton}
        hidden={state.configurationAttempt?.status === "uncertain"}
        aria-label={axis === "model" ? "Model" : "Effort"} aria-haspopup="menu" aria-expanded={menu === axis}
        title={`${axis === "model" ? "Model" : "Effort"}: ${visibleText(label)} · ${available ? facts?.configuration.status : "unavailable"}`}
        disabled={disabled || !available || !choices?.options.length || state.configurationAttempt !== undefined}
        onClick={() => setMenu(menu === axis ? undefined : axis)}
        onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setMenu(axis) } }}>
        {visibleText(label)} <span aria-hidden="true">⌄</span>
      </button>
    })}
    {menu && <div className="configuration-menu" role="menu" aria-label={menu === "model" ? "Model choices" : "Effort choices"} ref={menuNode}
      style={{ left: (menu === "model" ? modelButton : effortButton).current?.offsetLeft ?? 0 }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(true); return }
        const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        const current = options.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === "ArrowDown" ? (current + 1) % options.length : event.key === "ArrowUp" ? (current - 1 + options.length) % options.length : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : undefined
        if (next !== undefined) { event.preventDefault(); options[next]?.focus() }
      }}>
      {facts?.choices[menu === "model" ? "models" : "efforts"].options.map((option) => <button key={option.id} type="button" role="menuitemradio"
        aria-checked={facts.configuration.desired[menu] === option.id} tabIndex={-1}
        onClick={() => { closeMenu(true); void choose(menu, option.id) }}>{visibleText(option.label ?? option.id)}</button>)}
    </div>}
    <details className="configuration-evidence"><summary title={available && facts?.context._tag === "available" ? `${facts.context.used.toLocaleString()} of ${facts.context.window.toLocaleString()} tokens${facts.context.model === undefined ? "" : ` · ${visibleText(facts.context.model)}`}` : "Configuration and context evidence"}>
      {available && facts?.context._tag === "available" ? <>{Math.round(facts.context.percent)}%<span className="context-word"> context</span></> : "Context unavailable"}</summary>
      <div className="configuration-evidence-body"><p>{available ? `Configuration: ${facts?.configuration.status}` : "Configuration unavailable"}</p>
      {state.configurationMessage && <p role="status">{state.configurationMessage}</p>}
      {facts && <><p>{available ? "Current evidence" : "Last received evidence"}</p>
        <p>Desired model: {visibleText(facts.configuration.desired.model ?? "unavailable")} · effort: {visibleText(facts.configuration.desired.effort ?? "unavailable")}</p>
        <p>Applied model: {visibleText(facts.configuration.applied?.model ?? "unavailable")} · effort: {visibleText(facts.configuration.applied?.effort ?? "unavailable")}</p>
        {facts.configuration.reason && <p>{visibleText(facts.configuration.reason)}</p>}
        {facts.context._tag === "unavailable" && <p>Context: {facts.context.reason}</p>}
      </>}
      <p>Provider quota is unavailable.</p>
      <button type="button" onClick={() => setRefresh((value) => value + 1)}>Refresh configuration</button>
      </div>
    </details>
    {state.configurationAttempt?.status === "uncertain" && <button type="button" disabled={disabled} onClick={() => { void choose("model", "", true) }}>Recover configuration</button>}
  </div>
}

function Subscription({ account, sequence }: { readonly account: AgentToolsProps["account"]; readonly sequence: number | undefined }) {
  const [received, setReceived] = useState<{ id: AccountId; name: string }>()
  useEffect(() => {
    if (!account) return
    const controller = new AbortController()
    void withClient((client) => client.accounts({ requestId: requestId(), operation: "list" }), controller.signal)
      .then((reply) => {
        if (controller.signal.aborted) return
        const found = reply.accounts.find((row) => row.id === account.id && row.harness === account.harness)
        setReceived(found ? { id: found.id, name: found.displayName ?? found.id } : undefined)
      }).catch(() => { if (!controller.signal.aborted) setReceived(undefined) })
    return () => controller.abort()
  }, [account?.id, account?.harness, sequence])
  const name = received?.id === account?.id ? received?.name : undefined
  return <span className="conversation-subscription" title={name && account ? `${visibleText(account.harness)} · ${visibleText(name)}` : "Subscription unavailable"}>
    {name && account ? <><span className="subscription-harness">{visibleText(account.harness)} · </span>{visibleText(name)}</> : "Subscription unavailable"}
  </span>
}
