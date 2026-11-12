import type { ComponentType } from "react"
import type { AgentId, AlertKind } from "@lgtm/contracts"
import { visibleText } from "../text.tsx"
import { Board } from "./board.tsx"

export interface SubjectProps {
  readonly agentId: AgentId
  readonly id: string
  readonly alertKind?: AlertKind
}
// Each piece installs its entry here. Entries must wait for a tap before
// performing a read with marks, such as board.read.
export const subjectPanels: Readonly<Record<string, ComponentType<SubjectProps>>> = { board: Board }

export function SubjectPanel({ agentId, subject, alertKind }: {
  readonly agentId: AgentId; readonly subject: string; readonly alertKind?: AlertKind
}) {
  const separator = subject.indexOf(":")
  const namespace = separator < 0 ? "" : subject.slice(0, separator)
  const id = separator < 0 ? subject : subject.slice(separator + 1)
  const Panel = Object.hasOwn(subjectPanels, namespace) ? subjectPanels[namespace] : undefined
  return <section aria-label="Subject" data-subject={subject} tabIndex={-1}>
    <h3>Subject</h3>
    {Panel === undefined ? <p>{visibleText(subject)} is answered from a terminal.</p>
      : <Panel key={subject} agentId={agentId} id={id} {...(alertKind === undefined ? {} : { alertKind })} />}
  </section>
}
