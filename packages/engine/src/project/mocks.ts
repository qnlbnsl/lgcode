import { MockBundle, type Event, type MockRevision, type MockSource, type MockApproval } from "@lgcode/contracts"
import * as Schema from "effect/Schema"
import { fieldStructure, eventStructure, type RedactionStructure } from "../log/redactionStructure.ts"
import * as Effect from "effect/Effect"
import { agentReadReply, type ReadHandler } from "../api/reads.ts"
import { refused, type Input, type Payload, type PiecePlanner } from "../commands/internal.ts"
import { canReadProject } from "./access.ts"
import { own, projectKey, projectView } from "./view.ts"
import { sourceArtifact, componentArtifact, validateSource, validScreenRoute } from "./artifacts.ts"
import { mockApprovalSource } from "./mockReach.ts"
import { safePath } from "./gitApi.ts"
import { verifyDesignEvidence } from "./design.ts"

const requireMember = (input: Input, projectId: string) => {
  const project = own(projectView(input.snapshot).projects, projectId)
  return project !== undefined && !project.archiving && project.archivedAt === undefined && canReadProject(input.snapshot, input.actor, projectId)
    ? Effect.succeed(project) : Effect.fail(refused("project is unavailable to this caller"))
}
const unique = (values: ReadonlyArray<string>) => new Set(values).size === values.length
const fieldKey = (field: MockRevision["comparisons"][number]["field"]) => JSON.stringify([field.entity, field.name])
const fieldValue = (field: MockRevision["comparisons"][number]["field"]) => JSON.stringify([field.entity, field.name, field.type, field.description, field.sourceId, field.screens])
// Check the complete raw reference before prose redaction can change its
// meaning. These are claims by the recorded author, never parsed file types.
const validReviews = (bundle: typeof MockBundle.Type) => {
  const reviews = bundle.reviewedComparisons ?? []
  return unique(reviews.map((row) => fieldKey(row.field))) && reviews.every((row) =>
    bundle.draftedFields.some((field) => fieldValue(field) === fieldValue(row.field))
    && (row.status === "unavailable" ? row.known === undefined : row.field.entity !== undefined && row.field.sourceId !== undefined
      && (row.status === "new" ? row.known === undefined : row.known !== undefined
        && (row.status === "matches" ? row.known === row.field.type : row.known !== row.field.type))))
}
const worklistFor = (revision: Pick<MockRevision, "bundle" | "comparisons">): MockApproval["worklist"] => ({
  screens: revision.bundle.screens.map((row) => row.screenId),
  drafts: revision.bundle.components.filter((row) => row.provenance === "draft").map((row) => row.componentId),
  draftedFields: revision.bundle.draftedFields,
  schemaChanges: revision.comparisons.flatMap((row) => (row.status === "new" || row.status === "differs") && row.field.sourceId !== undefined
    ? [{ sourceId: row.field.sourceId, field: `${row.field.entity}.${row.field.name}`, change: row.status === "new" ? "add" as const : "change" as const, description: row.field.description }] : [])
})
// Leave room for the request and cursor in the 256 KiB read envelope. Admit
// both the revision and its eventual approval, including duplicated fields.
const readable = (revision: MockRevision, approval: MockApproval) => Buffer.byteLength(JSON.stringify(agentReadReply("budget", { items: [revision], approval }))) <= 192 * 1024
// Use the production structural positions, so prose is redacted before the
// aggregate budget is admitted, while typed identities remain intact.
const cleanBundle = (input: Input, bundle: typeof MockBundle.Type) => Effect.gen(function* () {
  const clean = (value: unknown, structure?: RedactionStructure): Effect.Effect<unknown> => {
    if (structure?.identity && typeof value === "string") return Effect.succeed(value)
    if (typeof value === "string") return input.runtime.log.redactText(value)
    if (Array.isArray(value)) return Effect.forEach(value, (item) => clean(item, structure?.elements))
    if (value !== null && typeof value === "object") return Effect.forEach(Object.entries(value), ([key, item]) => clean(item, fieldStructure(structure, key)).pipe(Effect.map((result) => [key, result] as const))).pipe(Effect.map(Object.fromEntries))
    return Effect.succeed(value)
  }
  const cleaned = yield* clean(bundle, fieldStructure(eventStructure, "bundle", "project.MockRecorded"))
  if (!Schema.is(MockBundle)(cleaned)) return yield* refused("mock record exceeds the data budget after redaction")
  return cleaned
})
const record: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.mocks.record">, project = yield* requireMember(input, p.projectId), view = projectView(input.snapshot)
  if (input.actor._tag !== "owner" && input.actor._tag !== "agent") return yield* refused()
  // A different caller has no receipt for this request, but cannot reuse its revision.
  if (own(view.mockRevisions, projectKey(p.projectId, p.requestId)) !== undefined) return yield* refused("mock revision identity is already recorded")
  if (own(view.mockHeads, p.projectId) !== p.expectedRevision) return yield* refused("mock revision changed; refresh and retry")
  if (!validReviews(p.bundle)) return yield* refused("invalid reviewed mock comparison")
  // References must keep their exact meaning. Refuse a secret-bearing raw
  // reference before prose redaction can turn it into another local path.
  for (const source of p.bundle.sources) yield* validateSource(input, source)
  for (const component of p.bundle.components) yield* safePath(input, component.reference)
  for (const screen of p.bundle.screens) {
    yield* safePath(input, screen.route)
    for (const binding of screen.scenarioRoutes) yield* safePath(input, binding.route)
  }
  const b = yield* cleanBundle(input, p.bundle)
  if (!validReviews(b)) return yield* refused("invalid reviewed mock comparison after redaction")
  if (!unique(b.sources.map((row) => row.sourceId)) || !unique(b.screens.map((row) => row.screenId))
    || !unique(b.components.map((row) => row.componentId)) || !unique(b.draftedFields.map((row) => JSON.stringify([row.entity, row.name])))
    || !unique(b.scenarios.map((row) => row.scenarioId))) return yield* refused("duplicate mock identity")
  if (b.designRevision !== undefined) {
    const design = own(view.designs, projectKey(project.repoId, b.designRevision))
    if (design === undefined) return yield* refused("design revision is not registered in this repository")
    yield* verifyDesignEvidence(input, design, p.projectId)
  }
  const artifacts: Array<{ sourceId: typeof MockSource.Type.sourceId; fingerprint: string }> = []
  for (const source of b.sources) {
    yield* validateSource(input, source)
    // Membership and checkout identity must be valid even for an absent file.
    // Only the bounded file's unavailability can be retained as unavailable.
    const available = yield* sourceArtifact(input, p.projectId, source).pipe(Effect.result)
    if (available._tag === "Success") {
      artifacts.push({ sourceId: source.sourceId, fingerprint: available.success.fingerprint })
    }
    else if (available.failure.reason !== "artifact unavailable") return yield* available.failure
  }
  const sources = new Map(b.sources.map((row) => [row.sourceId, row]))
  for (const screen of b.screens) {
    if (sources.get(screen.sourceId)?.kind !== "screens" || !validScreenRoute(screen.route)) return yield* refused("invalid mock screen reference")
    if (!unique(screen.scenarioRoutes.map((row) => row.scenarioId))
      || screen.scenarioRoutes.some((row) => !b.scenarios.some((scenario) => scenario.scenarioId === row.scenarioId) || !validScreenRoute(row.route))) return yield* refused("invalid mock scenario route binding")
  }
  const comparisons: Array<MockRevision["comparisons"][number]> = []
  for (const field of b.draftedFields) {
    if (field.screens?.some((id) => !b.screens.some((row) => row.screenId === id)) || field.sourceId !== undefined && sources.get(field.sourceId)?.kind !== "data") return yield* refused("invalid mock field reference")
    const reviewed = b.reviewedComparisons?.find((row) => fieldKey(row.field) === fieldKey(field))
    comparisons.push(reviewed === undefined ? { field, status: "unavailable" } : { ...reviewed, field })
  }
  const previous = p.expectedRevision === undefined ? undefined : own(view.mockRevisions, projectKey(p.projectId, p.expectedRevision))
  for (const component of b.components) {
    const source = sources.get(component.sourceId)
    if (source?.kind !== "components" || component.screens?.some((id) => !b.screens.some((screen) => screen.screenId === id))) return yield* refused("invalid mock component reference")
    const old = previous?.bundle.components.find((row) => row.componentId === component.componentId)
    if (old?.provenance === "draft" && component.provenance === "shared" && old.reference === component.reference) return yield* refused("shared component requires an evidenced repository reference change")
    yield* componentArtifact(input, p.projectId, source, component)
  }
  const candidate: MockRevision = { projectId: p.projectId, revisionId: p.requestId, bundle: b, author: input.actor, artifacts, comparisons, at: Number.MAX_SAFE_INTEGER }
  if (!readable(candidate, { projectId: p.projectId, approvalId: p.requestId, revisionId: p.requestId, leadAgentId: project.leadAgentId, worklist: worklistFor(candidate), at: Number.MAX_SAFE_INTEGER })) return yield* refused("mock record exceeds the read budget")
  const events: Event[] = [{ _tag: "project.MockRecorded", projectId: p.projectId, revisionId: p.requestId, bundle: b, author: input.actor, artifacts, comparisons }]
  if (b.screens.length > 0 && project.stage !== "design") events.push({ _tag: "project.StageChanged", projectId: p.projectId, stage: "design" })
  if (b.screens.length === 0 && project.stage === "design") events.push({ _tag: "project.StageChanged", projectId: p.projectId, stage: "plan" })
  return { events, reply: () => ({ requestId: p.requestId, revisionId: p.requestId }) }
})
const approve: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.mocks.approve">, project = yield* requireMember(input, p.projectId), view = projectView(input.snapshot)
  if (input.actor._tag !== "owner") return yield* refused()
  const revision = own(view.mockRevisions, projectKey(p.projectId, p.revisionId))
  if (revision === undefined || own(view.mockHeads, p.projectId) !== p.revisionId) return yield* refused("mock revision changed; refresh and retry")
  if (Object.values(view.mockApprovals).some((row) => row.projectId === p.projectId && row.revisionId === p.revisionId)) return yield* refused("mock revision is already approved")
  const b = revision.bundle
  if (b.screens.length === 0) return yield* refused("no screens are available for approval")
  if (b.designRevision !== undefined) {
    const design = own(view.designs, projectKey(project.repoId, b.designRevision))
    if (design === undefined) return yield* refused("design revision is not registered in this repository")
    yield* verifyDesignEvidence(input, design, p.projectId)
  }
  for (const source of b.sources) {
    const actual = yield* sourceArtifact(input, p.projectId, source)
    if (revision.artifacts.find((row) => row.sourceId === source.sourceId)?.fingerprint !== actual.fingerprint) return yield* refused("mock artifact changed; record a new revision")
  }
  for (const component of b.components) yield* componentArtifact(input, p.projectId, b.sources.find((row) => row.sourceId === component.sourceId)!, component)
  const worklist = worklistFor(revision)
  if (!readable(revision, { projectId: p.projectId, approvalId: p.requestId, revisionId: p.revisionId, leadAgentId: project.leadAgentId, worklist, at: Number.MAX_SAFE_INTEGER })) return yield* refused("mock approval exceeds the read budget")
  return { events: [{ _tag: "project.MockApproved", projectId: p.projectId, approvalId: p.requestId, revisionId: p.revisionId, leadAgentId: project.leadAgentId, worklist },
    { _tag: "project.StageChanged", projectId: p.projectId, stage: "plan" }], deliveries: [{ target: project.leadAgentId,
      sourceId: mockApprovalSource(p.projectId, p.requestId, p.revisionId),
      body: `The owner approved mock revision ${p.revisionId} for project ${p.projectId}. Continue the default build loop in Plan. Read this exact project.mocks.read revision and its implementation worklist. Do not assume draft components or schema changes are already implemented.\n${JSON.stringify(worklist)}` }], reply: () => ({ requestId: p.requestId }) }
})
const wrap = (input: Input, requestId: unknown, value: Record<string, unknown>) => input.actor._tag === "agent" ? agentReadReply(requestId, value) : value
const read: ReadHandler = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.mocks.read">; yield* requireMember(input, p.projectId)
  const view = projectView(input.snapshot), rows = Object.values(view.mockRevisions).filter((row) => row.projectId === p.projectId)
  const start = p.after === undefined ? 0 : rows.findIndex((row) => row.revisionId === p.after) + 1
  if (p.after !== undefined && start === 0) return yield* refused("invalid cursor")
  const approval = Object.values(view.mockApprovals).find((row) => row.projectId === p.projectId && row.revisionId === own(view.mockHeads, p.projectId))
  const items: MockRevision[] = []
  let next: MockRevision["revisionId"] | undefined
  for (let i = start; i < rows.length; i++) {
    if (items.length >= (p.limit ?? 200)) break
    const row = rows[i]!, candidate = wrap(input, p.requestId, { requestId: p.requestId, items: [...items, row], ...(approval === undefined ? {} : { approval }), next: row.revisionId })
    if (Buffer.byteLength(JSON.stringify(candidate)) > 256 * 1024) {
      if (items.length === 0) return yield* refused("record exceeds the read budget")
      break
    }
    items.push(row); next = i < rows.length - 1 ? row.revisionId : undefined
  }
  const reply = wrap(input, p.requestId, { requestId: p.requestId, items, ...(next === undefined ? {} : { next }), ...(approval === undefined ? {} : { approval }) })
  if (Buffer.byteLength(JSON.stringify(reply)) > 256 * 1024) return yield* refused("mock reply exceeds the read budget")
  return { reply }
})
const artifact: ReadHandler = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.mocks.artifact">; yield* requireMember(input, p.projectId)
  const revision = own(projectView(input.snapshot).mockRevisions, projectKey(p.projectId, p.revisionId))
  const source = revision?.bundle.sources.find((row) => row.sourceId === p.sourceId)
  if (source === undefined) return yield* refused("mock source is unavailable")
  const result = yield* sourceArtifact(input, p.projectId, source).pipe(Effect.result)
  const data = result._tag === "Success" ? { _tag: "available", text: yield* input.runtime.log.redactText(result.success.text), fingerprint: result.success.fingerprint }
    : { _tag: "unavailable", reason: "artifact unavailable" }
  const reply = wrap(input, p.requestId, { requestId: p.requestId, result: data })
  if (Buffer.byteLength(JSON.stringify(reply)) > 256 * 1024) return yield* refused("mock artifact reply exceeds the read budget")
  return { reply }
})
export const mockPlanners = { "project.mocks.record": record, "project.mocks.approve": approve }
export const mockReads = { "project.mocks.read": read, "project.mocks.artifact": artifact }
