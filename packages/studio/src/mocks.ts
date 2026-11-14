// Pure translations for recorded mocks, repository designs and local discovery.
import type { MockRevision, MockApproval, MockScreenReview, RepositoryDesignResult, Discovery, ProjectSettings } from "@lgtm/contracts"

type DesignResult = typeof RepositoryDesignResult.Type
type DiscoveryResult = typeof Discovery.Type
const author = (row: MockRevision["author"]) => row._tag === "owner" ? "owner" : row.agentId
export function mapMocks(items: ReadonlyArray<MockRevision>, approval?: MockApproval, reviews: ReadonlyArray<MockScreenReview> = []) {
  const head = items.at(-1)
  const approvedAt = head !== undefined && approval?.revisionId === head.revisionId ? approval.at : null
  const names = (ids: ReadonlyArray<string> = []) => ids.map((id) => head?.bundle.screens.find((s) => s.screenId === id)?.name ?? id)
  return {
    revisionId: head?.revisionId ?? null, designRevision: head?.bundle.designRevision ?? null,
    screens: (head?.bundle.screens ?? []).map((s) => {
      const review = reviews.find((r) => r.projectId === head!.projectId && r.revisionId === head!.revisionId && r.screenId === s.screenId)
      return { id: s.screenId, name: s.name, note: s.summary ?? "", kind: null,
        status: (review?.approval?.approved ?? approvedAt !== null) ? "approved" : "draft", rev: head!.revisionId, updatedAt: head!.at,
        approval: review?.approval ?? null, seen: review?.seen ?? null,
        comments: (review?.comments ?? []).map((c) => ({ id: c.commentId, from: author(c.author), text: c.text, ts: c.at })),
        selection: { _tag: "mock", projectId: head!.projectId, revisionId: head!.revisionId, screenId: s.screenId } }
    }),
    changes: items.slice().reverse().flatMap((r) => r.bundle.screens.map((s) => ({ id: JSON.stringify([r.revisionId, s.screenId]), screen: s.screenId, name: s.name,
      from: null, to: r.revisionId, by: author(r.author), ts: r.at, text: "", seen: reviews.some((v) => v.projectId === r.projectId && v.revisionId === r.revisionId && v.screenId === s.screenId && v.seen !== undefined), compare: false }))),
    data: (head?.comparisons ?? []).map((c) => ({ field: [c.field.entity, c.field.name].filter(Boolean).join("."),
      schema: c.status, on: names(c.field.screens).join(", "), sample: "", note: c.field.description })),
    components: (head?.bundle.components ?? []).map((c) => ({ name: c.name, real: c.provenance === "shared", on: names(c.screens), uses: null, note: "", demo: null })),
    sources: head?.bundle.sources ?? [], artifacts: head?.artifacts ?? [], approvedAt
  }
}
export function mapDesign(result: DesignResult) {
  if (result._tag === "unavailable") return null
  return { file: result.record.design.file, changedAt: result.record.at, changedBy: author(result.record.author),
    revisionId: result.record.revisionId, projectId: result.record.projectId, available: result.file._tag === "available",
    size: null, pages: null, frames: null, commit: null,
    tokens: result.tokens._tag === "available" ? result.tokens.tokens.map((t) => ({ name: t.name, value: t.value })) : [],
    components: result.components.map((c) => ({ id: c.componentId, name: c.name, reference: c.reference, variants: c.variants ?? "",
      available: c.availability._tag === "available", preview: /\.(html|svg)$/i.test(c.reference) })) }
}
export function mapMachineDetails(discovery: DiscoveryResult, settings?: ProjectSettings, port?: number) {
  return { workspace: settings?.workspaceFolder ?? "", port: port ?? null,
    harnesses: discovery.harnesses.map((h) => ({ id: h.harness, installed: h.installed,
      signedIn: h.accounts.filter((a) => a.state === "local-credential").length })),
    reason: discovery.state === "unavailable" ? discovery.reason ?? "Discovery unavailable" : "" }
}
// A frame URL is authority only after the authenticated display endpoint returned it.
export function validDisplayFrame(value: { url: string; displayOrigin: string; expiresAt: number }, hostname: string, now: number) {
  try {
    const origin = new URL(value.displayOrigin), url = new URL(value.url)
    return origin.origin === value.displayOrigin && origin.protocol === "https:" && origin.hostname !== hostname
      && url.origin === origin.origin && !url.username && !url.password && value.expiresAt > now
  } catch { return false }
}

// Search uses only the navigation records already in memory. There is no search RPC.
export function mapSearchText(records: Pick<import("./mapping.ts").EngineRecords, "repos" | "projects" | "sprints" | "agents" | "teams">) {
  const repositories = Object.fromEntries(records.repos.map((r) => [r.id, ""]))
  const projects = Object.fromEntries(records.projects.filter((p) => !p.archived).map((p) => [p.id,
    [records.repos.find((r) => r.id === p.repo)?.name, p.goal, p.branch,
      ...records.sprints.filter((s) => s.project === p.id).flatMap((s) => [s.name, s.goal])].filter(Boolean).join(" ")]))
  const agents = Object.fromEntries(records.agents.flatMap((a) => {
    const p = records.projects.find((p) => p.id === a.project)
    if (!p || p.archived) return []
    return [[a.id, [a.role, records.teams.find((t) => t.id === a.team)?.name, p.name,
      records.repos.find((r) => r.id === p.repo)?.name].filter(Boolean).join(" ")]]
  }))
  return { repositories, projects, agents }
}
