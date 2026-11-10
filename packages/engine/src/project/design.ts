import { extname } from "node:path"
import { DesignRegistration, DesignTokens, type RepositoryDesign, type RepositoryDesignResult } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { agentReadReply, type ReadHandler } from "../api/reads.ts"
import { refused, type Input, type Payload, type PiecePlanner } from "../commands/internal.ts"
import { canReadProject } from "./access.ts"
import { validArtifactPath, fingerprint } from "./artifacts.ts"
import { filePath, smallFile } from "./git/paths.ts"
import { withGit, designWorkspacePath, designWorkspaceReference, checkObservedWorkspace, safePath, workspacePath, workspaceReference } from "./gitApi.ts"
import { cleanName } from "./names.ts"
import { own, projectKey, projectView } from "./view.ts"

const unavailable = { _tag: "unavailable", reason: "artifact unavailable" } as const
const bytes = (input: Input, design: RepositoryDesign["design"], projectId: string | undefined, path: string, maximum: number) => Effect.gen(function* () {
  if (!validArtifactPath(path)) return yield* refused("invalid design artifact reference")
  yield* safePath(input, path)
  return yield* withGit(input, (git) => Effect.gen(function* () {
    const workspace = yield* designWorkspacePath(input, { repoId: design.repoId, worktreeId: design.worktreeId, ...(projectId === undefined ? {} : { projectId }) }, git)
    return yield* Effect.tryPromise({ try: async () => {
      const value = await smallFile(await filePath(workspace.path, path), maximum)
      return { value, fingerprint: fingerprint(value) }
    }, catch: () => refused("artifact unavailable") })
  }))
})
const tokens = (input: Input, design: RepositoryDesign["design"], projectId: string | undefined) => Effect.gen(function* () {
  if (design.tokensPath === undefined || extname(design.tokensPath).toLowerCase() !== ".json") return yield* refused("artifact unavailable")
  const artifact = yield* bytes(input, design, projectId, design.tokensPath, 8192)
  const document = yield* Effect.try({ try: () => Schema.decodeUnknownSync(DesignTokens)(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(artifact.value))), catch: () => refused("artifact unavailable") })
  const clean = { tokens: yield* Effect.forEach(document.tokens, (token) => Effect.gen(function* () {
    return { name: yield* cleanName(input, token.name), value: yield* input.runtime.log.redactText(token.value) }
  })) }
  if (!Schema.is(DesignTokens)(clean) || new Set(clean.tokens.map((row) => row.name)).size !== clean.tokens.length) return yield* refused("artifact unavailable")
  return { _tag: "available" as const, ...clean, fingerprint: artifact.fingerprint }
})
const evidence = (input: Input, record: RepositoryDesign, projectId?: string) => Effect.gen(function* () {
  const file = yield* bytes(input, record.design, projectId, record.design.file, 1024 * 1024).pipe(Effect.result)
  const tokenData = yield* tokens(input, record.design, projectId).pipe(Effect.result)
  const components = yield* Effect.forEach(record.design.components, (component) => Effect.gen(function* () {
    const actual = yield* bytes(input, record.design, projectId, component.reference, 64 * 1024).pipe(Effect.result)
    return { ...component, provenance: "shared" as const, availability: actual._tag === "Success" && actual.success.fingerprint === component.fingerprint
      ? { _tag: "available" as const, fingerprint: actual.success.fingerprint } : unavailable }
  }))
  return { _tag: "registered" as const, record, file: file._tag === "Success" && file.success.fingerprint === record.fileFingerprint
    ? { _tag: "available" as const, fingerprint: file.success.fingerprint } : unavailable,
    tokens: tokenData._tag === "Success" && tokenData.success.fingerprint === record.tokensFingerprint ? tokenData.success : unavailable, components } satisfies typeof RepositoryDesignResult.Type
})
export const verifyDesignEvidence = (input: Input, record: RepositoryDesign, projectId: string) => Effect.gen(function* () {
  const actual = yield* evidence(input, record, projectId)
  if (actual.file._tag !== "available" || record.design.tokensPath !== undefined && actual.tokens._tag !== "available"
    || actual.components.some((row) => row.availability._tag !== "available")) return yield* refused("registered design artifacts changed or are unavailable")
})
type RecordBytes = { readonly fileFingerprint: string; readonly tokensFingerprint?: string }
type RecordObservation = { readonly input: Input; readonly result: import("effect/Result").Result<RecordBytes, ReturnType<typeof refused>> }
const record = (observation?: RecordObservation): PiecePlanner => (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.design.record">, view = projectView(input.snapshot), project = own(view.projects, p.projectId)
  if (project === undefined || project.archiving || project.archivedAt !== undefined || project.repoId !== p.design.repoId
    || !canReadProject(input.snapshot, input.actor, p.projectId)) return yield* refused("repository design is unavailable to this caller")
  // Receipts are caller-scoped; immutable revision identities are repository-scoped.
  if (own(view.designs, projectKey(p.design.repoId, p.requestId)) !== undefined) return yield* refused("design revision identity is already recorded")
  if (own(view.designHeads, p.design.repoId) !== p.expectedRevision) return yield* refused("design revision changed; refresh and retry")
  const workspace = yield* workspaceReference(input, { projectId: p.projectId, worktreeId: p.design.worktreeId })
  if (observation === undefined) return yield* refused("project state changed; refresh and retry")
  const observedWorkspace = own(projectView(observation.input.snapshot).workspaces, workspace.worktreeId)
  if (observedWorkspace === undefined) return yield* refused("project state changed; refresh and retry")
  yield* checkObservedWorkspace(observation.input, input, observedWorkspace, p.projectId)
  if (![".fig", ".pen", ".json"].includes(extname(p.design.file).toLowerCase())) return yield* refused("invalid design artifact reference")
  const design = { ...p.design, components: yield* Effect.forEach(p.design.components, (component) => Effect.gen(function* () {
    return { ...component, name: yield* cleanName(input, component.name), ...(component.variants === undefined ? {} : { variants: yield* cleanName(input, component.variants) }) }
  })) }
  if (!Schema.is(DesignRegistration)(design) || new Set(design.components.map((row) => row.componentId)).size !== design.components.length) return yield* refused("invalid design registration")
  yield* safePath(input, design.file)
  if (design.tokensPath !== undefined) yield* safePath(input, design.tokensPath)
  for (const component of design.components) yield* safePath(input, component.reference)

  const observedBytes = observation.result._tag === "Success" ? observation.result.success : yield* observation.result.failure
  if (input.actor._tag !== "owner" && input.actor._tag !== "agent") return yield* refused()
  const event = { _tag: "project.DesignRecorded" as const, projectId: p.projectId, revisionId: p.requestId, design, author: input.actor,
    fileFingerprint: observedBytes.fileFingerprint, ...(observedBytes.tokensFingerprint === undefined ? {} : { tokensFingerprint: observedBytes.tokensFingerprint }) }
  if (Buffer.byteLength(JSON.stringify(event)) > 48 * 1024) return yield* refused("design registration exceeds the read budget")
  return { events: [event], reply: () => ({ requestId: p.requestId, revisionId: p.requestId }) }
})
// Observations carry byte evidence, never an admitted event plan. Every
// authority, revision and registration check above runs again at append.
export const prepareDesignRecord = (input: Input, raw: Record<string, unknown>) => Effect.gen(function* () {
  const p = raw as Payload<"project.design.record">
  const result = yield* Effect.gen(function* () {
    yield* withGit(input, (git) => workspacePath(input, { projectId: p.projectId, worktreeId: p.design.worktreeId }, git))
    const file = yield* bytes(input, p.design, p.projectId, p.design.file, 1024 * 1024)
    const tokenData = p.design.tokensPath === undefined ? undefined : yield* tokens(input, p.design, p.projectId)
    for (const component of p.design.components) if ((yield* bytes(input, p.design, p.projectId, component.reference, 64 * 1024)).fingerprint !== component.fingerprint) return yield* refused("component evidence unavailable")
    return { fileFingerprint: file.fingerprint, ...(tokenData === undefined ? {} : { tokensFingerprint: tokenData.fingerprint }) }
  }).pipe(Effect.result)
  return record({ input, result })
})
export const prepareDesignEvidence = (observed: Input, record: RepositoryDesign, projectId: string) => Effect.gen(function* () {
  const result = yield* verifyDesignEvidence(observed, record, projectId).pipe(Effect.result)
  const workspace = own(projectView(observed.snapshot).workspaces, record.design.worktreeId)
  return (current: Input, actual: RepositoryDesign) => Effect.gen(function* () {
    if (JSON.stringify(actual) !== JSON.stringify(record)) return yield* refused("design revision changed; refresh and retry")
    yield* designWorkspaceReference(current, { repoId: actual.design.repoId, worktreeId: actual.design.worktreeId, projectId })
    if (workspace === undefined) return yield* refused("registered design workspace is unavailable")
    yield* checkObservedWorkspace(observed, current, workspace, projectId)
    if (result._tag === "Failure") return yield* result.failure
  })
})
const read: ReadHandler = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.design.read">, view = projectView(input.snapshot)
  if (own(view.repositories, p.repoId) === undefined) return yield* refused("registered repository not found")
  if (input.actor._tag !== "owner" || p.projectId !== undefined) {
    const project = p.projectId === undefined ? undefined : own(view.projects, p.projectId)
    if (project?.repoId !== p.repoId || !canReadProject(input.snapshot, input.actor, project.projectId)) return yield* refused("repository design is unavailable to this caller")
  }
  const revisionId = p.revisionId ?? own(view.designHeads, p.repoId)
  const row = revisionId === undefined ? undefined : own(view.designs, projectKey(p.repoId, revisionId))
  const result = row === undefined ? { _tag: "unavailable", reason: "repository design is not registered" } as const : yield* evidence(input, row, p.projectId)
  const reply = { requestId: p.requestId, result }, wrapped = input.actor._tag === "agent" ? agentReadReply(p.requestId, reply) : reply
  if (Buffer.byteLength(JSON.stringify(wrapped)) > 256 * 1024) return yield* refused("design reply exceeds the read budget")
  return { reply: wrapped }
})
export const designPlanners = { "project.design.record": record() }
export const designReads = { "project.design.read": read }
