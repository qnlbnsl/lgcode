import * as Effect from "effect/Effect"
import type { ReadHandler } from "../api/reads.ts"
import { agentReadReply } from "../api/reads.ts"
import { refused } from "../commands/internal.ts"
import { requestRows } from "../client/reads/requests.ts"
import { canLeadProject } from "./access.ts"
import { own, projectView } from "./view.ts"

// This reads W03's current/history fold. It neither creates a conversation turn
// nor advances a board watermark. Visibility never delegates owner authority.
export const projectRequests: ReadHandler = (input, raw) => Effect.gen(function* () {
  const project = own(projectView(input.snapshot).projects, raw.projectId as string)
  if (project === undefined || !canLeadProject(input.snapshot, input.actor, project)) return yield* refused("project is unavailable to this caller")
  const ordered = requestRows(input.snapshot).filter((row) => row.projectId === project.projectId)
  const anchor = raw.after === undefined ? -1 : ordered.findIndex((row) => String(row.sourceSequence) === raw.after)
  if (raw.after !== undefined && anchor === -1) return yield* refused("invalid cursor")
  const rows = ordered.slice(anchor + 1).filter((row) => (raw.kind === undefined || row.kind === raw.kind)
    && (raw.status === undefined || row.status === raw.status))
  const items: typeof rows = []
  const wrap = (reply: Record<string, unknown>) => input.actor._tag === "agent" ? agentReadReply(raw.requestId, reply) : reply
  const reply = (next?: string) => ({ requestId: raw.requestId, items, ...(next === undefined ? {} : { next }) })
  for (const row of rows) {
    if (items.length >= (raw.limit as number | undefined ?? 200)) break
    items.push({ ...row, canAnswer: row.canAnswer && input.actor._tag === "owner" })
    if (Buffer.byteLength(JSON.stringify(wrap(reply(String(row.sourceSequence))))) > 256 * 1024) {
      items.pop()
      if (items.length === 0) return yield* refused("record exceeds the read budget")
      break
    }
  }
  const final = wrap(reply(items.length < rows.length ? String(items.at(-1)!.sourceSequence) : undefined))
  if (Buffer.byteLength(JSON.stringify(final)) > 256 * 1024) return yield* refused("record exceeds the read budget")
  return { reply: final }
})
