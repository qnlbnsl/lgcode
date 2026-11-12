import { useMemo, useSyncExternalStore } from "react"
import type { RequestId } from "@lgtm/contracts"

interface AnswerAttempt {
  readonly status: "ready" | "sending" | "sent" | "failed" | "checked"
  readonly locked: boolean
  readonly command?: { readonly value: string; readonly requestId: RequestId }
}
interface Entry {
  state: AnswerAttempt
  readonly listeners: Set<() => void>
  readonly update: (state: AnswerAttempt) => void
  readonly clear: () => void
}
// Submission state is shared by simultaneous Home, bell and conversation
// copies. It is not a request projection: only engine reads decide whether a
// request is open. An uncertain command survives navigation until refreshed.
const attempts = new Map<string, Entry>()
// Session teardown also invalidates captured entries: a late response from the
// old session must not restore its answer text or change a new session's lock.
export function clearRequestAttempts(): void {
  const previous = [...attempts.values()]
  attempts.clear()
  for (const entry of previous) entry.clear()
}
function entryFor(key: string) {
  let entry = attempts.get(key)
  if (entry === undefined) {
    const listeners = new Set<() => void>()
    let active = true
    const created: Entry = { state: { status: "ready", locked: false }, listeners,
      update: (state) => { if (active) { created.state = state; for (const listener of listeners) listener() } },
      clear: () => { active = false; created.state = { status: "ready", locked: false }; for (const listener of listeners) listener() } }
    entry = created
    attempts.set(key, entry)
  }
  return entry
}
export function useRequestAttempt(key: string) {
  const entry = useMemo(() => entryFor(key), [key])
  const subscribe = useMemo(() => (listener: () => void) => {
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
      if (entry.listeners.size === 0 && !["failed", "sending"].includes(entry.state.status) && attempts.get(key) === entry) attempts.delete(key)
    }
  }, [entry, key])
  const state = useSyncExternalStore(subscribe, () => entry.state)
  return { state, entry }
}
