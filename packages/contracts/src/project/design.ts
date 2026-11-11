import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import { EpochMilliseconds, RequestId } from "../ids.ts"
import { MockAuthor, MockComponentId } from "./mocks.ts"
import { ProjectId, ProjectName, ProjectPath, RepositoryId, WorkspaceId, isRepositoryArtifactPath } from "./schema.ts"

export const DesignFingerprint = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
export const DesignTokensPath = ProjectPath.check(Schema.isPattern(/\.json$/i), Schema.makeFilter(isRepositoryArtifactPath))
export const DesignComponent = Schema.Struct({ componentId: MockComponentId, name: ProjectName, reference: ProjectPath,
  fingerprint: DesignFingerprint, variants: Schema.optionalKey(ProjectName) })
export const DesignRegistration = Schema.Struct({ repoId: RepositoryId, worktreeId: WorkspaceId, file: ProjectPath,
  tokensPath: Schema.optionalKey(DesignTokensPath), components: Schema.Array(DesignComponent).check(Schema.isMaxLength(64)) })
  .check(Schema.makeFilter((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 32 * 1024))
export const DesignToken = Schema.Struct({ name: ProjectName, value: Schema.String.check(Schema.isMaxCodePoints(256)) })
export const DesignTokens = Schema.Struct({ tokens: Schema.Array(DesignToken).check(Schema.isMaxLength(64)) })
export const RepositoryDesign = Schema.Struct({ projectId: ProjectId, revisionId: RequestId, design: DesignRegistration,
  author: MockAuthor, at: EpochMilliseconds, fileFingerprint: DesignFingerprint, tokensFingerprint: Schema.optionalKey(DesignFingerprint) })
export type RepositoryDesign = typeof RepositoryDesign.Type
const unavailable = Schema.TaggedStruct("unavailable", { reason: Schema.Literal("artifact unavailable") })
export const DesignAvailability = Schema.Union([Schema.TaggedStruct("available", { fingerprint: DesignFingerprint }), unavailable])
export const RepositoryDesignResult = Schema.Union([
  Schema.TaggedStruct("unavailable", { reason: Schema.Literal("repository design is not registered") }),
  Schema.TaggedStruct("registered", { record: RepositoryDesign, file: DesignAvailability,
    tokens: Schema.Union([Schema.TaggedStruct("available", { ...DesignTokens.fields, fingerprint: DesignFingerprint }), unavailable]),
    components: Schema.Array(Schema.Struct({ ...DesignComponent.fields, provenance: Schema.Literal("shared"), availability: DesignAvailability })).check(Schema.isMaxLength(64)) })
])
const request = { requestId: RequestId }
const error = Schema.TaggedStruct("CommandError", { ...request, reason: Schema.String })
export const ProjectDesignRpcGroup = RpcGroup.make(
  Rpc.make("design.record", { payload: { ...request, projectId: ProjectId, expectedRevision: Schema.optionalKey(RequestId), design: DesignRegistration },
    success: Schema.Struct({ ...request, revisionId: RequestId }), error }),
  Rpc.make("design.read", { payload: { ...request, repoId: RepositoryId, projectId: Schema.optionalKey(ProjectId), revisionId: Schema.optionalKey(RequestId) },
    success: Schema.Union([Schema.Struct({ ...request, result: RepositoryDesignResult }), Schema.Struct({ ...request, data: Schema.String })]), error })
).prefix("project.")
export const projectDesignAccess = { "project.design.record": ["owner", "agent"], "project.design.read": ["owner", "agent"] } as const
export const ProjectDesignEvent = Schema.TaggedStruct("project.DesignRecorded", { projectId: ProjectId, revisionId: RequestId,
  design: DesignRegistration, author: MockAuthor, fileFingerprint: DesignFingerprint, tokensFingerprint: Schema.optionalKey(DesignFingerprint) })
