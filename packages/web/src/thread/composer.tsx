import { useConversation } from "../data/ShellDataProvider.tsx"
import { useId, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ContextReferences } from "@lgcode/contracts"
import { requestId, withClient } from "./client.ts"
import { beforeRequest, durableRefusal } from "./requestOutcome.ts"
import { ContextPicker } from "./contextPicker.tsx"
import { conversationKey, referenceKey, type ContextScope, type ConversationIdentity, type SendPayload } from "./conversationState.tsx"
import { visibleText } from "./text.tsx"

interface ComposerProps {
  readonly identity: Exclude<ConversationIdentity, { readonly _tag: "board" }>
  readonly recipient: string
  readonly scope?: ContextScope
  readonly disabled?: boolean
  readonly halt?: string
  readonly tools?: React.ReactNode
  readonly action?: React.ReactNode
}
export function Composer(props: ComposerProps) {
  return <ConversationComposer key={conversationKey(props.identity)} {...props} />
}
function ConversationComposer({ identity, recipient, scope, disabled = false, halt, tools, action }: ComposerProps) {
  const { state, entry, session } = useConversation(identity)
  const field = useRef<HTMLTextAreaElement>(null)
  const hint = useId()
  const composing = useRef(false)
  const [picker, setPicker] = useState<{ readonly at?: number; readonly draft?: string }>()
  useEffect(() => setPicker(undefined), [halt])
  useEffect(() => { const node = field.current; return () => { if (node) node.value = "" } }, [])
  useLayoutEffect(() => {
    if (!field.current) return
    field.current.style.height = "auto"
    field.current.style.height = `${Math.min(160, Math.max(32, field.current.scrollHeight))}px`
  }, [state.draft])
  const send = async (original?: SendPayload) => {
    if (disabled || halt !== undefined || session.controller.signal.aborted || entry.state.status === "sending") return
    // A lost receipt freezes the original payload. Editing a draft never
    // changes a retry's target, references, body or idempotency key.
    if (entry.state.status === "uncertain" && original === undefined) return
    const draft = field.current?.value ?? entry.state.draft
    if (original === undefined && !draft.trim()) return
    const context = entry.state.context.map((item) => item.reference)
    if (original === undefined && !Schema.is(ContextReferences)(context)) {
      entry.update({ message: "Selected context exceeds the reference limit. Remove an item before sending." }); return
    }
    const payload: SendPayload = original ?? { requestId: requestId(), text: draft,
      ...(context.length === 0 ? {} : { context }), ...(identity._tag === "agent" ? { agentId: identity.agentId }
        : { channelId: identity.channelId, to: [], reply: "none" }) }
    let after = original === undefined ? undefined : entry.state.attemptAfter
    entry.update({ draft, attempt: payload, attemptAfter: after, status: "sending", message: "" })
    const current = () => !session.controller.signal.aborted && entry.state.attempt?.requestId === payload.requestId
    const failed = async () => {
      if (!current()) return
      const reason = await durableRefusal("agentId" in payload ? "prompt" : "board.post", payload.requestId, after, session.controller.signal)
      if (!current()) return
      entry.update(reason === undefined
        ? { status: "uncertain", message: "Could not confirm this message. Recover the original send before sending another." }
        : { attempt: undefined, attemptAfter: undefined, status: "ready", message: `The engine refused this message: ${reason}. Your draft and context are kept.` })
    }
    try {
      if (original === undefined) {
        after = await beforeRequest(session.controller.signal)
        if (!current()) return
        entry.update({ attemptAfter: after })
      }
      const result = await withClient((client) => Effect.result("agentId" in payload
        ? client.prompt(payload).pipe(Effect.asVoid) : client["board.post"](payload).pipe(Effect.asVoid)), session.controller.signal)
      if (!current()) return
      if (result._tag === "Failure") {
        await failed()
        return
      }
      const sameContext = JSON.stringify(entry.state.context.map((item) => item.reference)) === JSON.stringify(payload.context ?? [])
      entry.update({ attempt: undefined, attemptAfter: undefined, status: "ready", message: "agentId" in payload ? "Prompt sent." : "Message posted.",
        ...(entry.state.draft === payload.text && sameContext ? { draft: "", context: [] } : {}) })
    } catch {
      await failed()
    }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void send() }
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }
  const change = (input: HTMLTextAreaElement) => {
    entry.update({ draft: input.value })
    const at = input.selectionStart
    if (!composing.current && at > 0 && input.value[at - 1] === "@" && (at === 1 || /\s/u.test(input.value[at - 2]!))) {
      setPicker({ at: at - 1, draft: input.value })
    }
  }
  return <div className="conversation-composer">
    {halt !== undefined && <p role="status">{visibleText(halt)}{state.draft && " Your draft is kept."}</p>}
    <form aria-label={identity._tag === "agent" ? "Prompt agent" : "Message team"} onSubmit={submit}>
      <div hidden={halt !== undefined}>
      <label className="visually-hidden" htmlFor={`${hint}-input`}>Message {visibleText(recipient)}</label>
      <textarea ref={field} id={`${hint}-input`} name="prompt" aria-label={`Message ${visibleText(recipient)}`}
        aria-describedby={hint} placeholder={`Message ${visibleText(recipient)}…`} value={state.draft}
        onInput={(event) => change(event.currentTarget)} onChange={(event) => entry.update({ draft: event.target.value })}
        onKeyDown={keyDown} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} />
      {state.context.length > 0 && <ul className="composer-context" aria-label="Selected context">{state.context.map((item) => <li key={referenceKey(item.reference)}>
        <span>{visibleText(item.label)}</span><button type="button" aria-label={`Remove ${visibleText(item.label)}`} onClick={() => entry.update({ context: entry.state.context.filter((row) => referenceKey(row.reference) !== referenceKey(item.reference)) })}>×</button>
      </li>)}</ul>}
      </div>
      <div className="composer-tools"><button hidden={halt !== undefined} type="button" aria-label="Add context" title="Add context" onClick={() => setPicker({})}><span aria-hidden="true">＋</span><span className="add-context-label"> Add context</span></button>{tools}
        <div hidden={halt !== undefined}>{action ?? <button aria-label={identity._tag === "agent" ? "Send prompt" : "Send message"}
          title={disabled ? "Sending is unavailable until the conversation reconnects." : state.status === "uncertain" ? "Recover the original send first." : "Send (Enter)"} type="submit"
          disabled={disabled || halt !== undefined || state.status !== "ready" || !state.draft.trim()}>{state.status === "sending" ? "Sending…" : "Send"}</button>}</div>
      </div>
    </form>
    <p id={hint} className="visually-hidden">Enter sends · Shift+Enter adds a line</p>
    {state.message && <p role="status">{state.message}</p>}
    {state.status === "uncertain" && <button disabled={disabled || halt !== undefined} onClick={() => { if (entry.state.attempt) void send(entry.state.attempt) }}>Recover original send</button>}
    {picker !== undefined && <ContextPicker {...(scope === undefined ? {} : { scope })} selected={state.context} close={() => setPicker(undefined)}
      apply={(items) => {
        const draft = entry.state.draft
        entry.update({ context: items, ...(picker.at !== undefined && picker.draft === draft && draft[picker.at] === "@"
          ? { draft: draft.slice(0, picker.at) + draft.slice(picker.at + 1) } : {}) })
        field.current?.focus({ preventScroll: true })
      }} />}
  </div>
}
