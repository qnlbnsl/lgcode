import type { ComponentType } from "react"
import type { AgentId } from "@shephrd/contracts"
import { visibleText } from "../text.tsx"

export interface SubjectProps {
  readonly agentId: AgentId
  readonly id: string
}
// Each piece installs its entry here. Entries must wait for a tap before
// performing a read with marks, such as board.read.
export const subjectPanels: Readonly<Record<string, ComponentType<SubjectProps>>> = {}

export function SubjectPanel({ agentId, subject }: { readonly agentId: AgentId; readonly subject: string }) {
  const separator = subject.indexOf(":")
  const namespace = separator < 0 ? "" : subject.slice(0, separator)
  const id = separator < 0 ? subject : subject.slice(separator + 1)
  const Panel = Object.hasOwn(subjectPanels, namespace) ? subjectPanels[namespace] : undefined
  return <section aria-label="Subject">
    <h3>Subject</h3>
    {Panel === undefined ? <p>{visibleText(subject)} is answered from a terminal.</p> : <Panel agentId={agentId} id={id} />}
  </section>
}
