import { createHash } from "node:crypto"
import { realpath } from "node:fs/promises"
import { extname, join } from "node:path"
import * as Effect from "effect/Effect"
import { isRepositoryArtifactPath, type MockSource, type MockComponent } from "@lgtm/contracts"
import { refused, type Input } from "../commands/internal.ts"
import { withGit, workspacePath, safePath } from "./gitApi.ts"
import { filePath, smallFile, inside } from "./git/paths.ts"

export const fingerprint = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
export const validArtifactPath = isRepositoryArtifactPath
export const validPreviewOrigin = (raw: string) => {
  try {
    const url = new URL(raw)
    return raw === url.origin && !url.username && !url.password && (url.protocol === "https:" || url.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  } catch { return false }
}
export const validScreenRoute = (raw: string) => raw.startsWith("/") && !raw.startsWith("//") && !/[\\\x00-\x1f\x7f%]/.test(raw)
  && raw.split(/[/?#]/).every((part) => part !== "." && part !== "..") && !/[#{}]/.test(raw)
export const validateSource = (input: Input, source: typeof MockSource.Type) => Effect.gen(function* () {
  if (!validArtifactPath(source.path) || source.previewOrigin !== undefined && !validPreviewOrigin(source.previewOrigin)) return yield* refused("invalid mock artifact reference")
  const extension = extname(source.path).toLowerCase()
  if (![".json", ".html", ".css", ".svg", ".md", ".txt"].includes(extension)
    || ["data", "components"].includes(source.kind) && extension !== ".json"
    || source.kind === "tokens" && ![".json", ".css"].includes(extension)) return yield* refused("mock metadata must be a data artifact")
  yield* safePath(input, source.path)
  if (source.previewOrigin !== undefined) yield* safePath(input, source.previewOrigin)
})
// This reads bytes only. It never imports a component, starts a preview server,
// fetches a URL or exposes the artifact through the application's static root.
export const sourceArtifact = (input: Input, projectId: string, source: typeof MockSource.Type) => withGit(input, (git) => Effect.gen(function* () {
  const workspace = yield* workspacePath(input, { projectId, worktreeId: source.worktreeId }, git)
  return yield* Effect.tryPromise({ try: async () => {
    const path = await filePath(workspace.path, source.path)
    if (!inside(await realpath(workspace.path), await realpath(path))) throw new Error()
    const bytes = await smallFile(path, 8192)
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return { text, fingerprint: fingerprint(bytes) }
  }, catch: (error) => refused(error !== null && typeof error === "object" && "_tag" in error && error._tag === "GitFailure" && "reason" in error && error.reason === "invalid_path" ? "invalid mock artifact reference" : "artifact unavailable") })
}))
export const componentArtifact = (input: Input, projectId: string, source: typeof MockSource.Type, component: typeof MockComponent.Type) => withGit(input, (git) => Effect.gen(function* () {
  const workspace = yield* workspacePath(input, { projectId, worktreeId: source.worktreeId }, git)
  if (!validArtifactPath(component.reference)) return yield* refused("invalid mock artifact reference")
  yield* safePath(input, component.reference)
  return yield* Effect.tryPromise({ try: async () => {
    const path = await filePath(workspace.path, component.reference)
    if (!inside(await realpath(workspace.path), await realpath(path))) throw new Error()
    const bytes = await smallFile(path, 64 * 1024)
    if (fingerprint(bytes) !== component.fingerprint) throw new Error()
    // Reference verification is byte evidence, never executable evaluation.
    return { path: join(workspace.path, component.reference), fingerprint: component.fingerprint }
  }, catch: () => refused("component evidence unavailable") })
}))
