import { Event as EventSchema, type Event, type MockRevision } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { CommandUncertain, refused, type Input, type Payload, type PiecePlan, type PiecePlanner } from "../commands/internal.ts"
import { canReadProject } from "./access.ts"
import { fingerprint, sourceArtifact } from "./artifacts.ts"
import { designDisplay } from "./display.ts"
import { verifyDesignEvidence } from "./design.ts"
import { checkObservedWorkspace, withGit, workspacePath } from "./gitApi.ts"
import { own, projectKey, projectView } from "./view.ts"
import { stageMockEditorFile, mockEditorUncertainReason } from "./mockEditorRecovery.ts"
import { readable, worklistFor } from "./mocks.ts"
import { mockEditorFormatMatches } from "./mockEditorFormat.ts"

export const mockEditorSelection = (input: Input, p: Payload<"project.mocks.editor.save">) => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused()
  if (p.confirmed !== true) return yield* refused("mock editor save requires confirmation")
  const view = projectView(input.snapshot), project = own(view.projects, p.projectId)
  if (project === undefined || project.archiving || project.archivedAt !== undefined || !canReadProject(input.snapshot, input.actor, p.projectId)) return yield* refused("project is unavailable to this caller")
  const revision = own(view.mockRevisions, projectKey(p.projectId, p.revisionId))
  if (revision === undefined || own(view.mockHeads, p.projectId) !== p.revisionId) return yield* refused("mock revision changed; refresh and retry")
  const design = own(view.designs, projectKey(project.repoId, p.designRevision))
  if (revision.bundle.designRevision !== p.designRevision || design === undefined || design.projectId !== p.projectId
    || own(view.designHeads, project.repoId) !== p.designRevision || design.design.worktreeId !== p.worktreeId) return yield* refused("mock editor design changed; refresh and retry")
  if (own(view.designs, projectKey(project.repoId, p.requestId)) !== undefined || own(view.mockRevisions, projectKey(p.projectId, p.requestId)) !== undefined)
    return yield* refused("mock revision identity is already recorded")
  return { project, revision, design }
})

// Registered alongside the external mutation planners so the existing request
// and workspace lanes, durable attempt and uncertainty handling also cover saves.
// Raw file content is never stored in an event, receipt, command or Git argument.
export const saveMockEditor: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.mocks.editor.save">, selected = yield* mockEditorSelection(input, p)
  const bytes = yield* Effect.try({ try: () => {
    const value = Buffer.from(p.content, "base64")
    if (value.length === 0 || value.length > 512 * 1024 || value.toString("base64") !== p.content) throw new Error()
    return value
  }, catch: () => refused("mock editor export must be base64 data of at most 512 KiB") })
  const text = new TextDecoder().decode(bytes)
  if ((yield* input.runtime.log.redactText(text)) !== text) return yield* refused("mock editor export contains private data")
  if (!mockEditorFormatMatches(selected.design.design.file, bytes)) return yield* refused("mock editor export does not match the recorded design format")
  const display = yield* designDisplay(input, { repoId: selected.project.repoId, projectId: p.projectId, revisionId: p.designRevision })
  yield* verifyDesignEvidence(input, selected.design, p.projectId)
  for (const source of selected.revision.bundle.sources) {
    const actual = yield* sourceArtifact(input, p.projectId, source)
    if (selected.revision.artifacts.find((a) => a.sourceId === source.sourceId)?.fingerprint !== actual.fingerprint) return yield* refused("mock artifact changed; record a new revision")
  }
  const fileFingerprint = fingerprint(bytes)
  const candidate: MockRevision = { ...selected.revision, revisionId: p.requestId, author: { _tag: "owner" }, at: Number.MAX_SAFE_INTEGER,
    bundle: { ...selected.revision.bundle, designRevision: p.requestId } }
  if (!readable(candidate, { projectId: p.projectId, approvalId: p.requestId, revisionId: p.requestId, leadAgentId: selected.project.leadAgentId,
    worklist: worklistFor(candidate), at: Number.MAX_SAFE_INTEGER })) return yield* refused("mock editor revision exceeds the data budget")
  const events: Event[] = [{ _tag: "project.DesignRecorded", projectId: p.projectId, revisionId: p.requestId, design: selected.design.design,
    author: { _tag: "owner" }, fileFingerprint, ...(selected.design.tokensFingerprint === undefined ? {} : { tokensFingerprint: selected.design.tokensFingerprint }) },
  { _tag: "project.MockRecorded", projectId: p.projectId, revisionId: p.requestId, bundle: { ...selected.revision.bundle, designRevision: p.requestId },
    author: { _tag: "owner" }, artifacts: selected.revision.artifacts, comparisons: selected.revision.comparisons }]
  if (selected.project.stage !== "design") events.push({ _tag: "project.StageChanged", projectId: p.projectId, stage: "design" })
  if (!events.every((event) => Schema.is(EventSchema)(event))) return yield* refused("mock editor revision exceeds the data budget")
  return yield* withGit(input, (git) => Effect.gen(function* () {
    const workspace = yield* workspacePath(input, p, git)
    const current = { ...input, snapshot: yield* input.runtime.views.snapshot }
    yield* checkObservedWorkspace(input, current, workspace, p.projectId)
    yield* mockEditorSelection(current, p)
    yield* stageMockEditorFile(input, p, workspace.path, selected.design.design.file, display.fingerprint, bytes)
    return { events, reply: () => ({ requestId: p.requestId, revisionId: p.requestId }) }
  }))
})

// Recheck placement and revision while holding the final writer. If the file
// effect raced a project change, retain the durable attempt as uncertain.
export const finalizeMockEditorSave = (observed: Input, raw: Record<string, unknown>, plan: PiecePlan): PiecePlanner => (current) => Effect.gen(function* () {
  const p = raw as Payload<"project.mocks.editor.save">
  const workspace = own(projectView(observed.snapshot).workspaces, p.worktreeId)
  if (workspace === undefined) return yield* refused()
  yield* checkObservedWorkspace(observed, current, workspace, p.projectId)
  yield* mockEditorSelection(current, p)
  return plan
}).pipe(Effect.mapError(() => new CommandUncertain({ reason: mockEditorUncertainReason })))
