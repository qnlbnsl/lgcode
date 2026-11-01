import {
  AgentId, PermissionOption, PermissionRequestId,
  type Account, type Delivery, type HarnessSettings, type PermissionLevel, type SessionReference,
} from "@shepherd/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";

export class RunnerRejected extends Data.TaggedError("RunnerRejected")<{
  readonly reason: string;
}> {}

export interface RunnerCapabilities {
  readonly loadSession: boolean;
  readonly resumeSession: boolean;
  readonly setModeConfigOption: boolean;
}

export interface SessionInfo {
  readonly session: SessionReference;
  readonly protocolVersion: number;
  readonly reloadable: boolean;
}

// Every event belongs to the spawn identified by its unrevoked token hash.
// The runner takes agentId and incarnation from its own process table, never
// from child data. permissionRequestId is the runner's own id, unique across
// agents; it must mint that id rather than forward a child-supplied id.
export const RunnerEvent = Schema.Union([
  Schema.TaggedStruct("exited", {
    agentId: AgentId,
    incarnation: Schema.NonEmptyString,
    exitCode: Schema.NullOr(Schema.Int),
    signal: Schema.NullOr(Schema.String),
    stderr: Schema.String,
  }),
  Schema.TaggedStruct("permissionRequested", {
    agentId: AgentId,
    incarnation: Schema.NonEmptyString,
    permissionRequestId: PermissionRequestId,
    toolCallId: Schema.NonEmptyString,
    description: Schema.String,
    options: Schema.Array(PermissionOption).check(Schema.isMinLength(1)),
    settingsWrite: Schema.Boolean,
  }),
  Schema.TaggedStruct("turnEnded", { agentId: AgentId, incarnation: Schema.NonEmptyString }),
]);
export type RunnerEvent = typeof RunnerEvent.Type;

interface Spawn {
  readonly agentId: AgentId;
  readonly token: Redacted.Redacted<string>;
  readonly folder: string;
  readonly harness: HarnessSettings;
  readonly account: Account;
  readonly permission: PermissionLevel;
  readonly model?: string;
  readonly effort?: string;
}

export class Runner extends Context.Service<Runner, {
  readonly start: (input: Spawn) => Effect.Effect<SessionInfo, RunnerRejected>;
  readonly load: (input: Spawn & { readonly session: SessionReference }) => Effect.Effect<SessionInfo, RunnerRejected>;
  readonly prompt: (input: { readonly agentId: AgentId; readonly delivery: Delivery }) => Effect.Effect<void, RunnerRejected>;
  readonly cancel: (input: { readonly agentId: AgentId }) => Effect.Effect<void, RunnerRejected>;
  readonly answerPermission: (input: { readonly agentId: AgentId; readonly requestId: string; readonly optionId: string }) => Effect.Effect<void, RunnerRejected>;
  readonly setMode: (input: { readonly agentId: AgentId; readonly permission: PermissionLevel }) => Effect.Effect<void, RunnerRejected>;
  readonly compact: (input: { readonly agentId: AgentId; readonly delivery: Delivery }) => Effect.Effect<void, RunnerRejected>;
  readonly stop: (input: { readonly agentId: AgentId }) => Effect.Effect<void, RunnerRejected>;
  readonly capabilities: RunnerCapabilities;
  readonly events: Stream.Stream<RunnerEvent>;
}>()("shepherd/engine/runner/Runner") {}
