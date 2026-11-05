import { toolText } from "@shephrd/contracts/thread"
import type { Event } from "@shephrd/contracts"
import { DataText } from "./text.tsx"

export type ContentEvent = Extract<Event, { _tag: "ThreadItem" }>
export function Content({ event }: { readonly event: ContentEvent }) {
  const content = event.content
  switch (content._tag) {
    case "text": return <DataText text={content.text} />
    case "plan": return <ol>{content.entries.map((entry, index) => <li key={index}>
      <DataText text={entry.content} /><p>{entry.priority} · {entry.status}</p>
    </li>)}</ol>
    case "tool-call": return <div>
      <DataText text={content.title} /><p>{content.status ?? "pending"}</p>
      {content.input !== undefined && <DataText text={toolText(content.input)} />}
      {content.output !== undefined && <DataText text={toolText(content.output)} />}
    </div>
    case "file-change": return <div><DataText text={content.path} /><DataText text={content.diff} /></div>
  }
}
