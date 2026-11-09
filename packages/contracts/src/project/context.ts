import * as Schema from "effect/Schema"
import { ProjectId, RepositoryId, TaskId, TeamId, WorkspaceId } from "./schema.ts"

// Identities only. Labels are display data from a read, never send authority.
export const ContextPath = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096),
  Schema.isPattern(/^(?!\/)(?!.*\\)(?!.*[\x00-\x1f\x7f])[^/]+(?:\/[^/]+)*$/),
  Schema.makeFilter((path) => !path.split("/").some((part) => part === "." || part === ".." || part.toLowerCase() === ".git")))
export const ContextReference = Schema.Union([
  Schema.TaggedStruct("task", { projectId: ProjectId, taskId: TaskId }),
  Schema.TaggedStruct("file", { projectId: ProjectId, repoId: RepositoryId, worktreeId: WorkspaceId, path: ContextPath })
])
export type ContextReference = typeof ContextReference.Type
export const ContextReferences = Schema.Array(ContextReference).check(Schema.isMaxLength(16),
  Schema.makeFilter((refs) => new TextEncoder().encode(JSON.stringify(refs)).byteLength <= 16 * 1024))
// A bounded board wake can carry references from several admitted posts.
export const DeliveryContextReferences = Schema.Array(ContextReference).check(Schema.isMaxLength(1024),
  Schema.makeFilter((refs) => new TextEncoder().encode(JSON.stringify(refs)).byteLength <= 128 * 1024))
export const ContextSearchFields = {
  projectId: ProjectId, worktreeId: WorkspaceId, teamId: Schema.optionalKey(TeamId),
  query: Schema.String.check(Schema.isMaxLength(256)),
  scope: Schema.optionalKey(Schema.Literals(["tasks", "files"])),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)))
}
export const ContextSearchResult = Schema.Struct({
  items: Schema.Array(Schema.Struct({ reference: ContextReference, label: Schema.String.check(Schema.isMaxLength(4096)) })).check(Schema.isMaxLength(100)),
  truncated: Schema.Boolean
})
// Canonical descriptions are data. Consumers must render this as plain text.
export const describeContext = (refs: ReadonlyArray<ContextReference>): string =>
  `Selected context references (identities only; no file contents):\n${JSON.stringify(refs)}`
