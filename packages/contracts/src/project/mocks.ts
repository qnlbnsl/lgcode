import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import { AgentId, EpochMilliseconds, RequestId } from "../ids.ts"
import { ProjectId, ProjectLeadDefaults, ProjectName, ProjectPath, ProjectText, WorkspaceId } from "./schema.ts"

export const MockSourceId = ProjectName.pipe(Schema.brand("MockSourceId"))
export const MockScreenId = ProjectName.pipe(Schema.brand("MockScreenId"))
export const MockComponentId = ProjectName.pipe(Schema.brand("MockComponentId"))
export const MockScenarioId = ProjectName.pipe(Schema.brand("MockScenarioId"))
export const MockSource = Schema.Struct({ sourceId: MockSourceId, worktreeId: WorkspaceId, path: ProjectPath,
  kind: Schema.Literals(["screens", "data", "tokens", "components"]), command: Schema.optionalKey(ProjectText), previewOrigin: Schema.optionalKey(ProjectPath) })
export const MockScreen = Schema.Struct({ screenId: MockScreenId, sourceId: MockSourceId, name: ProjectName, route: ProjectPath, summary: Schema.optionalKey(ProjectText),
  scenarioRoutes: Schema.Array(Schema.Struct({ scenarioId: MockScenarioId, route: ProjectPath })).check(Schema.isMaxLength(64)) })
export const MockScenario = Schema.Struct({ scenarioId: MockScenarioId, name: ProjectName, description: ProjectText })
export const MockDraftField = Schema.Struct({ name: ProjectName, type: ProjectName, description: ProjectText,
  entity: Schema.optionalKey(ProjectName), sourceId: Schema.optionalKey(MockSourceId), screens: Schema.optionalKey(Schema.Array(MockScreenId).check(Schema.isMaxLength(64))) })
export const MockFieldComparison = Schema.Struct({ field: MockDraftField, status: Schema.Literals(["new", "matches", "differs", "unavailable"]), known: Schema.optionalKey(ProjectName) })
export const MockSchemaChange = Schema.Struct({ sourceId: MockSourceId, field: ProjectPath,
  change: Schema.Literals(["add", "change"]), description: ProjectText })
// Shared provenance requires actual repository evidence, not a promotion flag.
export const MockComponent = Schema.Struct({ componentId: MockComponentId, name: ProjectName, sourceId: MockSourceId,
  provenance: Schema.Literals(["draft", "shared"]), reference: ProjectPath,
  fingerprint: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)), screens: Schema.optionalKey(Schema.Array(MockScreenId).check(Schema.isMaxLength(64))) })
const array = <S extends Schema.Constraint>(item: S) => Schema.Array(item).check(Schema.isMaxLength(64))
export const MockBundle = Schema.Struct({ sources: array(MockSource), screens: array(MockScreen), scenarios: array(MockScenario),
  draftedFields: array(MockDraftField), components: array(MockComponent), designRevision: Schema.optionalKey(RequestId),
  // Caller-reviewed metadata, not an engine-verified application schema.
  // Omission preserves historical decoding and means unavailable on new records.
  reviewedComparisons: Schema.optionalKey(array(MockFieldComparison)),
  // Public decoding normally strips excess properties. Explicitly forbid the
  // removed experimental input so a declared change cannot be accepted/lost.
  schemaChanges: Schema.optionalKey(Schema.Never) })
  .check(Schema.makeFilter((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 64 * 1024))
export const MockAuthor = Schema.Union([Schema.TaggedStruct("owner", {}), Schema.TaggedStruct("agent", { agentId: AgentId })])
export const MockArtifactIdentity = Schema.Struct({ sourceId: MockSourceId, fingerprint: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)) })
export const MockRevision = Schema.Struct({ projectId: ProjectId, revisionId: RequestId, bundle: MockBundle, author: MockAuthor,
  at: EpochMilliseconds, artifacts: array(MockArtifactIdentity), comparisons: array(MockFieldComparison) })
export type MockRevision = typeof MockRevision.Type
export const MockWorklist = Schema.Struct({ screens: array(MockScreenId), drafts: array(MockComponentId),
  schemaChanges: array(MockSchemaChange), draftedFields: array(MockDraftField) })
export const MockApproval = Schema.Struct({ projectId: ProjectId, approvalId: RequestId, revisionId: RequestId, leadAgentId: AgentId,
  worklist: MockWorklist, at: EpochMilliseconds })
export type MockApproval = typeof MockApproval.Type
export const SetupStep = Schema.Literals(["welcome", "found", "project"])
export const SetupState = Schema.Struct({ step: SetupStep, completedAt: Schema.optionalKey(EpochMilliseconds), projectId: Schema.optionalKey(ProjectId) })
export type SetupState = typeof SetupState.Type
export const DiscoveryAccount = Schema.Struct({ accountId: Schema.NonEmptyString,
  state: Schema.Literals(["missing-executable", "signed-out", "local-credential", "unavailable"]), remoteAuthentication: Schema.Literal("not-checked") })
export const DiscoveryHarness = Schema.Struct({ harness: Schema.NonEmptyString, installed: Schema.Boolean, configured: Schema.Boolean,
  accounts: array(DiscoveryAccount) })
export const Discovery = Schema.Struct({ state: Schema.Literals(["available", "unavailable"]), reason: Schema.optionalKey(Schema.Literal("discovery unavailable; retry or change the workspace folder")),
  repositories: array(Schema.Struct({ name: ProjectName, path: ProjectPath })), truncated: Schema.Boolean,
  harnesses: array(DiscoveryHarness), readyDefaults: Schema.optionalKey(ProjectLeadDefaults), ownerNameSuggestion: Schema.optionalKey(ProjectName) })
const request = { requestId: RequestId }, project = { ...request, projectId: ProjectId }
const error = Schema.TaggedStruct("CommandError", { ...request, reason: Schema.String })
const ack = Schema.Struct(request)
const page = { after: Schema.optionalKey(RequestId), limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200))) }
export const ProjectMockRpcGroup = RpcGroup.make(
  Rpc.make("setup", { payload: request, success: Schema.Struct({ ...request, setup: SetupState }), error }),
  Rpc.make("setup.advance", { payload: { ...request, step: SetupStep }, success: ack, error }),
  Rpc.make("setup.complete", { payload: project, success: ack, error }),
  Rpc.make("setup.discover", { payload: request, success: Schema.Struct({ ...request, result: Discovery }), error }),
  Rpc.make("mocks.record", { payload: { ...project, expectedRevision: Schema.optionalKey(RequestId), bundle: MockBundle },
    success: Schema.Struct({ ...request, revisionId: RequestId }), error }),
  Rpc.make("mocks.read", { payload: { ...project, ...page }, success: Schema.Union([
    Schema.Struct({ ...request, items: Schema.Array(MockRevision), next: Schema.optionalKey(RequestId), approval: Schema.optionalKey(MockApproval) }),
    Schema.Struct({ ...request, data: Schema.String })]), error }),
  Rpc.make("mocks.artifact", { payload: { ...project, revisionId: RequestId, sourceId: MockSourceId }, success: Schema.Union([
    Schema.Struct({ ...request, result: Schema.Union([Schema.TaggedStruct("available", { text: Schema.String.check(Schema.isMaxCodePoints(96 * 1024)), fingerprint: Schema.String }),
      Schema.TaggedStruct("unavailable", { reason: Schema.Literal("artifact unavailable") })]) }), Schema.Struct({ ...request, data: Schema.String })]), error }),
  Rpc.make("mocks.approve", { payload: { ...project, revisionId: RequestId }, success: ack, error })
).prefix("project.")
const owner = ["owner"] as const, member = ["owner", "agent"] as const
export const projectMockAccess = { "project.setup": owner, "project.setup.advance": owner, "project.setup.complete": owner,
  "project.setup.discover": owner, "project.mocks.record": member, "project.mocks.read": member, "project.mocks.artifact": member, "project.mocks.approve": owner }
export const ProjectMockEvent = Schema.Union([
  Schema.TaggedStruct("project.SetupAdvanced", { step: SetupStep }),
  Schema.TaggedStruct("project.SetupCompleted", { projectId: ProjectId }),
  Schema.TaggedStruct("project.MockRecorded", { projectId: ProjectId, revisionId: RequestId, bundle: MockBundle, author: MockAuthor, artifacts: array(MockArtifactIdentity), comparisons: array(MockFieldComparison) }),
  Schema.TaggedStruct("project.MockApproved", { projectId: ProjectId, approvalId: RequestId, revisionId: RequestId, leadAgentId: AgentId, worklist: MockWorklist })
])
export const projectStages = (hasScreens: boolean) => hasScreens ? ["design", "plan", "build", "review", "handover"] as const : ["plan", "build", "review", "handover"] as const
export const stageLabel = (stage: string) => ({ design: "Design", plan: "Plan", build: "Build", review: "Review", handover: "Hand over" })[stage]
