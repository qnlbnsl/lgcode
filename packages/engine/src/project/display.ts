import { realpath, stat } from "node:fs/promises"
import { dirname, extname, relative } from "node:path"
import type { ProjectId, RepositoryId, RequestId } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import { refused, type Input } from "../commands/internal.ts"
import { sourceArtifact, fingerprint, validScreenRoute, validArtifactPath } from "./artifacts.ts"
import { designWorkspacePath, safePath, withGit, workspacePath } from "./gitApi.ts"
import { filePath, inside, smallFile } from "./git/paths.ts"
import { own, projectKey, projectView } from "./view.ts"

export type MockDisplaySelection = {
  readonly projectId: ProjectId
  readonly revisionId: RequestId
  readonly screenId: string
  readonly scenarioId?: string
}
export type DesignDisplaySelection = {
  readonly repoId: RepositoryId
  readonly revisionId?: RequestId
  readonly projectId?: ProjectId
}

// These readers are an engine boundary, not a browser HTML transport. Their
// executable bytes must only enter the separately authenticated frame service.
export const mockDisplay = (input: Input, selection: MockDisplaySelection) => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused("display requires the owner session")
  const view = projectView(input.snapshot), project = own(view.projects, selection.projectId)
  if (project === undefined || project.archiving || project.archivedAt !== undefined) return yield* refused("project display is unavailable")
  const revision = own(view.mockRevisions, projectKey(selection.projectId, selection.revisionId))
  const screen = revision?.bundle.screens.find((row) => row.screenId === selection.screenId)
  const source = screen === undefined ? undefined : revision?.bundle.sources.find((row) => row.sourceId === screen.sourceId)
  const route = selection.scenarioId === undefined ? screen?.route : screen?.scenarioRoutes.find((row) => row.scenarioId === selection.scenarioId)?.route
  if (revision === undefined || screen === undefined || source?.kind !== "screens" || route === undefined || !validScreenRoute(route)
    || ![".html", ".svg"].includes(extname(source.path).toLowerCase())) return yield* refused("recorded screen display is unavailable")
  const artifact = yield* sourceArtifact(input, selection.projectId, source)
  const expected = revision.artifacts.find((row) => row.sourceId === source.sourceId)?.fingerprint
  if (expected === undefined || artifact.fingerprint !== expected) return yield* refused("recorded screen artifact changed or is unavailable")
  // The same secret registration rule used by ordinary artifact reads applies
  // before bytes reach even an isolated browser. Never silently change the
  // recorded byte identity by redacting executable markup in place.
  if ((yield* input.runtime.log.redactText(artifact.text)) !== artifact.text) return yield* refused("recorded screen artifact contains private data")
  yield* safePath(input, route)
  const folder = yield* withGit(input, (git) => Effect.gen(function* () {
    const workspace = yield* workspacePath(input, { projectId: selection.projectId, worktreeId: source.worktreeId }, git)
    return yield* Effect.tryPromise({ try: async () => realpath(dirname(await filePath(workspace.path, source.path))), catch: () => refused("recorded screen folder is unavailable") })
  }))
  return { folder, projectId: project.projectId, revisionId: revision.revisionId, screenId: screen.screenId,
    ...(selection.scenarioId === undefined ? {} : { scenarioId: selection.scenarioId }),
    sourceId: source.sourceId, route, text: artifact.text, fingerprint: artifact.fingerprint,
    contentType: extname(source.path).toLowerCase() === ".svg" ? "image/svg+xml" : "text/html; charset=utf-8" }
})

export const designDisplay = (input: Input, selection: DesignDisplaySelection) => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused("display requires the owner session")
  const view = projectView(input.snapshot)
  const revisionId = selection.revisionId ?? own(view.designHeads, selection.repoId)
  const record = revisionId === undefined ? undefined : own(view.designs, projectKey(selection.repoId, revisionId))
  const project = record === undefined ? undefined : own(view.projects, record.projectId)
  if (record === undefined || project === undefined || project.repoId !== selection.repoId || project.archiving || project.archivedAt !== undefined
    || selection.projectId !== undefined && selection.projectId !== project.projectId) return yield* refused("registered project design is unavailable")
  const design = record.design
  // The pinned browser file-link surface accepts these two actual formats.
  // A registered JSON design remains metadata; it is not relabelled as .fig.
  if (!validArtifactPath(design.file) || ![".fig", ".pen"].includes(extname(design.file).toLowerCase())) return yield* refused("registered design format cannot open in the editor")
  yield* safePath(input, design.file)
  return yield* withGit(input, (git) => Effect.gen(function* () {
    const workspace = yield* designWorkspacePath(input, { repoId: selection.repoId, worktreeId: design.worktreeId, projectId: project.projectId }, git)
    const resolved = yield* Effect.tryPromise({ try: async () => {
      const workspaceRoot = await realpath(workspace.path)
      const file = await filePath(workspaceRoot, design.file)
      const folder = await realpath(dirname(file))
      // A root-level design file does not grant the editor the whole checkout.
      if (folder === workspaceRoot || !inside(workspaceRoot, folder) || !(await stat(folder)).isDirectory()) throw new Error()
      const bytes = await smallFile(file, 1024 * 1024)
      if (fingerprint(bytes) !== record.fileFingerprint) throw new Error()
      return { folder, file: relative(folder, file), fingerprint: record.fileFingerprint }
    }, catch: () => refused("registered design needs an unchanged file in a dedicated design folder") })
    yield* safePath(input, resolved.folder)
    return { projectId: project.projectId, repoId: design.repoId, worktreeId: design.worktreeId,
      revisionId: record.revisionId, ...resolved }
  }))
})


export type ComponentDisplaySelection = {
  readonly repoId: RepositoryId
  readonly revisionId: RequestId
  readonly componentId: string
}

// A component identity resolves only inside an explicitly registered immutable
// Design revision. It grants the component's dedicated folder, not a caller
// path or the checkout root. Every document/asset read revalidates this binding.
export const componentDisplay = (input: Input, selection: ComponentDisplaySelection) => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused("display requires the owner session")
  const view = projectView(input.snapshot)
  const record = own(view.designs, projectKey(selection.repoId, selection.revisionId))
  const project = record === undefined ? undefined : own(view.projects, record.projectId)
  const component = record?.design.components.find((row) => row.componentId === selection.componentId)
  if (record === undefined || project === undefined || project.repoId !== selection.repoId || project.archiving || project.archivedAt !== undefined
    || component === undefined || !validArtifactPath(component.reference)
    || ![".html", ".svg"].includes(extname(component.reference).toLowerCase())) return yield* refused("registered component preview is unavailable")
  // Resolve after module initialization; design readers also register API reads.
  const { verifyDesignEvidence } = yield* Effect.promise(() => import("./design.ts"))
  yield* verifyDesignEvidence(input, record, project.projectId)
  yield* safePath(input, component.reference)
  return yield* withGit(input, (git) => Effect.gen(function* () {
    const workspace = yield* designWorkspacePath(input, { repoId: selection.repoId, worktreeId: record.design.worktreeId, projectId: project.projectId }, git)
    const artifact = yield* Effect.tryPromise({ try: async () => {
      const root = await realpath(workspace.path), file = await filePath(root, component.reference), folder = await realpath(dirname(file))
      if (folder === root || !inside(root, folder)) throw new Error()
      const bytes = await smallFile(file, 64 * 1024)
      if (fingerprint(bytes) !== component.fingerprint) throw new Error()
      return { folder, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }
    }, catch: () => refused("registered component artifact changed or is unavailable") })
    if ((yield* input.runtime.log.redactText(artifact.text)) !== artifact.text) return yield* refused("registered component artifact contains private data")
    yield* safePath(input, artifact.folder)
    return { ...artifact, route: extname(component.reference).toLowerCase() === ".svg" ? "/component.svg" : "/component.html",
      contentType: extname(component.reference).toLowerCase() === ".svg" ? "image/svg+xml" : "text/html; charset=utf-8" }
  }))
})
