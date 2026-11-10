import { toolText } from "@lgcode/contracts/thread"
import type { Event } from "@lgcode/contracts"
import { DataText, visibleText } from "./text.tsx"
import { BoundedText } from "./boundedText.tsx"

export type ContentEvent = Extract<Event, { _tag: "ThreadItem" }>
export function Content({ event, compact = false }: { readonly event: ContentEvent; readonly compact?: boolean }) {
  const content = event.content
  const text = (value: string) => compact ? <BoundedText text={value} /> : <DataText text={value} />
  switch (content._tag) {
    case "text": return text(content.text)
    case "plan": return <ol>{content.entries.map((entry, index) => <li key={index}>
      {text(entry.content)}<p>{entry.priority} · {entry.status}</p>
    </li>)}</ol>
    case "tool-call": {
      const action = <div>
      <DataText text={content.title} /><p>{content.status ?? "pending"}</p>
      {content.input !== undefined && text(toolText(content.input))}
      {content.output !== undefined && text(toolText(content.output))}
    </div>
      return compact ? <details className="tool-activity"><summary>{visibleText(content.title)} · {content.status ?? "pending"}</summary>{action}</details> : action
    }
    case "file-change": return <div><DataText text={content.path} />{text(content.diff)}</div>
  }
}
