import * as Schema from "effect/Schema"
import { EpochMilliseconds, RequestId } from "../ids.ts"
import { ProjectId, RepositoryId, ProjectName } from "./schema.ts"

// The display API selects existing engine identities, never a browser-supplied
// path, hostname, command, container image or file URL.
export const DisplayOpen = Schema.Union([
  Schema.TaggedStruct("mock", { projectId: ProjectId, revisionId: RequestId, screenId: ProjectName, scenarioId: Schema.optionalKey(ProjectName) }),
  Schema.TaggedStruct("editor", { repoId: RepositoryId, revisionId: Schema.optionalKey(RequestId), projectId: Schema.optionalKey(ProjectId) })
])
export type DisplayOpen = typeof DisplayOpen.Type
export const DisplayClose = Schema.Struct({ id: Schema.NonEmptyString.check(Schema.isMaxLength(100)) })
export const DisplayFrame = Schema.Struct({ id: Schema.NonEmptyString, url: Schema.NonEmptyString,
  displayOrigin: Schema.NonEmptyString, expiresAt: EpochMilliseconds })
export type DisplayFrame = typeof DisplayFrame.Type
