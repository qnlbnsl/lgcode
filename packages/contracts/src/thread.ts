import type { Event } from "./events.ts"

type Item = { readonly sequence: number; readonly event?: unknown }
type ContentEvent = Extract<Event, { _tag: "ThreadItem" }>

// Fold durable deltas only for display. Keep the first envelope's identity so
// live updates grow the same block. Sequence deduplication also covers replay.
export function groupThreadItems<T extends Item>(items: ReadonlyArray<T>): T[] {
  const result: T[] = []
  const groups = new Map<string, number>()
  const seen = new Set<number>()
  for (const item of [...items].sort((a, b) => a.sequence - b.sequence)) {
    if (seen.has(item.sequence)) continue
    seen.add(item.sequence)
    const event = item.event as Event | undefined
    if (event?._tag === "SessionOpened" || event?._tag === "DeliverySent") {
      for (const key of groups.keys()) if (key.startsWith(`${event.agentId}:`)) groups.delete(key)
    }
    if (event?._tag !== "ThreadItem") { result.push(item); continue }
    const content = event.content
    const key = content._tag === "text" ? `${event.agentId}:message:${event.itemId}`
      : content._tag === "tool-call" ? `${event.agentId}:tool:${content.callId}` : undefined
    const index = key === undefined ? undefined : groups.get(key)
    if (index === undefined) {
      if (key !== undefined) groups.set(key, result.length)
      result.push(item)
      continue
    }
    const first = result[index]!
    const prior = first.event as ContentEvent
    const previous = prior.content
    if (content._tag === "text" && previous._tag === "text") {
      result[index] = { ...first, event: { ...prior, content: { ...content, text: previous.text + content.text } } }
    } else if (content._tag === "tool-call" && previous._tag === "tool-call") {
      result[index] = { ...first, event: { ...prior, content: {
        ...previous, ...content, title: content.title || previous.title,
      } } }
    }
  }
  return result
}

// Adapter tool payloads are data. Extract their text without interpreting HTML
// or terminal escape sequences; each viewer still applies its output escaping.
export function toolValueText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(toolValueText).filter(Boolean).join("\n")
  if (value !== null && typeof value === "object") {
    const row = value as Record<string, unknown>
    if (row.type === "content") return toolValueText(row.content)
    if (row.type === "text" && typeof row.text === "string") return row.text
    if (typeof row.command === "string") return row.command
    if (typeof row.output === "string") return row.output
      + (row.exitCode === undefined ? "" : `\nExit code: ${row.exitCode}`)
      + (row.signal === undefined ? "" : `\nSignal: ${row.signal}`)
      + (row.truncated === true ? "\nEarlier output was truncated." : "")
  }
  return JSON.stringify(value, null, 2) ?? ""
}
export function toolText(text: string): string {
  try { return toolValueText(JSON.parse(text)) } catch { return text }
}
