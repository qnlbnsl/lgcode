import { toolText } from "@lgtm/contracts/thread"
import type { Event } from "@lgtm/contracts"
import { DataText, visibleText } from "./text.tsx"
import { BoundedText, textPreview } from "./boundedText.tsx"

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
      <BoundedText text={content.title} label="Tool title" /><p>{content.status ?? "pending"}</p>
      {content.input !== undefined && text(toolText(content.input))}
      {content.output !== undefined && text(toolText(content.output))}
    </div>
      const title = textPreview(content.title)
      return compact ? <details className="tool-activity"><summary>{visibleText(title)}{title.length < content.title.length && "…"} · {content.status ?? "pending"}</summary>{action}</details> : action
    }
    case "file-change": return <div><BoundedText text={content.path} label="File path" />{text(content.diff)}</div>
  }
}
