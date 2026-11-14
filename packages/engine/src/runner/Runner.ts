import {
  AgentChoice, AgentId, DeliveryId, EpochMilliseconds, ThreadContent, PermissionActionFields, PermissionOption, PermissionRequestId, TurnUsage,
  type AgentChoices, type AgentConfiguration, type ContextUsage, type Account, type Delivery, type HarnessSettings, type PermissionLevel, type SessionReference,
} from "@lgtm/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";

import type { folderForSpawn } from "../identity/ceiling.ts";

import type { StartFailure } from "@lgtm/contracts/startFailure";

export class RunnerRejected extends Data.TaggedError("RunnerRejected")<{
  readonly reason: string;
  readonly startFailure?: StartFailure;
  readonly configurationUncertain?: boolean;
}> {}

export interface RunnerCapabilities {
  readonly loadSession: boolean;
  readonly resumeSession: boolean;
  readonly setModeConfigOption: boolean;
}

// Rows 51 and 66 and issue 154: what a reload replayed, in order, returned
// with the load result so the replay scan never waits on the event stream.
// A user item is redacted user-message text; a break stands for any other
// replayed update (an agent message, a plan, a tool call, a file change), so
// user chunks are joined only when nothing else came between them.
export type ReplayItem = { readonly _tag: "user"; readonly text: string } | { readonly _tag: "break" };

export interface SessionInfo {
  readonly session: SessionReference;
  readonly protocolVersion: number;
  readonly reloadable: boolean;
  readonly configuration?: AgentChoice;
  // Present on a load; absent on a start, which replays nothing.
  readonly replay?: ReadonlyArray<ReplayItem>;
}

// Every event belongs to the spawn identified by its unrevoked token hash.
// The runner takes agentId, incarnation and deliveryId from its own process
// table, never from child data (issue 61): deliveryId names the delivery the
// runner itself sent with `prompt` or `compact`. permissionRequestId is the
// runner's own id, unique across agents; it must mint that id rather than
// forward a child-supplied id. `deliveryUpdate` reports a notice for the
// sent delivery; `promptReply` reports the reply to it, and a successful
// reply that ends the turn comes before that turn's `turnEnded`.
// `turnEnded` names the delivery whose `session/prompt` reply ended, also
// from the runner's own process table, so a repeated old turn end cannot end
// a later turn. `sentSequence` is the sequence of the reserved DeliverySent,
// so a delayed end cannot end a retry of the same delivery in the same spawn.
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
    ...PermissionActionFields,
  }),
  Schema.TaggedStruct("turnEnded", {
    agentId: AgentId, incarnation: Schema.NonEmptyString, deliveryId: DeliveryId,
    sentSequence: Schema.Int.check(Schema.isGreaterThan(0)),
    stopped: Schema.optionalKey(Schema.Boolean),
    usage: Schema.optionalKey(TurnUsage),
  }),
  Schema.TaggedStruct("deliveryUpdate", {
    agentId: AgentId,
    incarnation: Schema.NonEmptyString,
    deliveryId: DeliveryId,
    kind: Schema.Literals(["message", "plan", "tool-call", "file-change", "available_commands_update"]),
    replay: Schema.Boolean,
    // Issue 144: who spoke a message, so a reload's replay scan reads only
    // the user's content (row 66).
    role: Schema.optionalKey(Schema.Literals(["user", "agent"])),
    text: Schema.String,
    itemId: Schema.optionalKey(Schema.NonEmptyString),
    content: Schema.optionalKey(ThreadContent),
  }),
  Schema.TaggedStruct("configurationReported", { agentId: AgentId, incarnation: Schema.NonEmptyString, applied: AgentChoice }),
  Schema.TaggedStruct("modeReported", {
    agentId: AgentId, incarnation: Schema.NonEmptyString, mode: Schema.String,
    level: Schema.optionalKey(Schema.Literals(["read-only", "ask", "edit", "full"])),
    ceiling: Schema.Literals(["read-only", "ask", "edit", "full"]),
  }),
  Schema.TaggedStruct("promptReply", {
    agentId: AgentId,
    incarnation: Schema.NonEmptyString,
    deliveryId: DeliveryId,
    outcome: Schema.Union([
      Schema.TaggedStruct("success", {}),
      // Issue 105: `resetAt` is the provider's reported reset time, when it gave one.
      Schema.TaggedStruct("pause", {
        reason: Schema.Literals(["out-of-usage", "signed-out"]), error: Schema.String,
        resetAt: Schema.optionalKey(EpochMilliseconds),
      }),
      Schema.TaggedStruct("capacity", { error: Schema.String }),
      Schema.TaggedStruct("error", { error: Schema.String }),
    ]),
  }),
]);
export type RunnerEvent = typeof RunnerEvent.Type;

interface Spawn {
  readonly agentId: AgentId;
  readonly token: Redacted.Redacted<string>;
  readonly folder: string;
  readonly grant: Parameters<typeof folderForSpawn>[0];
  readonly harness: HarnessSettings;
  readonly account: Account;
  readonly permission: PermissionLevel;
  readonly model?: string;
  readonly effort?: string;
}

// `prompt` and `compact` return once the request is sent; the reply arrives
// later as a `promptReply` event. Each send names the incarnation the engine
// reserved it for, the SHA-256 hash of the target's live token; the runner
// refuses with `RunnerRejected` when that is not its live process's
// incarnation, so a send reserved for an earlier run never reaches a later one.
export class Runner extends Context.Service<Runner, {
  // Opens only a temporary session and closes its process before returning.
  readonly discover: (input: Spawn) => Effect.Effect<AgentChoices, RunnerRejected>;
  readonly start: (input: Spawn) => Effect.Effect<SessionInfo, RunnerRejected>;
  readonly load: (input: Spawn & { readonly session: SessionReference }) => Effect.Effect<SessionInfo, RunnerRejected>;
  readonly prompt: (input: { readonly agentId: AgentId; readonly incarnation: string; readonly delivery: Delivery; readonly sentSequence: number }) => Effect.Effect<void, RunnerRejected>;
  readonly choices: (input: { readonly agentId: AgentId; readonly incarnation: string }) => Effect.Effect<AgentChoices, RunnerRejected>;
  readonly context: (input: { readonly agentId: AgentId; readonly incarnation: string }) => Effect.Effect<ContextUsage, RunnerRejected>;
  readonly configure: (input: { readonly agentId: AgentId; readonly incarnation: string; readonly desired: AgentChoice }) => Effect.Effect<Pick<AgentConfiguration, "applied" | "status" | "reason">, RunnerRejected>;
  readonly cancel: (input: { readonly agentId: AgentId; readonly deliveryId?: DeliveryId; readonly sentSequence?: number }) => Effect.Effect<void, RunnerRejected>;
  readonly answerPermission: (input: { readonly agentId: AgentId; readonly requestId: string; readonly optionId: string }) => Effect.Effect<void, RunnerRejected>;
  readonly setMode: (input: { readonly agentId: AgentId; readonly permission: PermissionLevel }) => Effect.Effect<void, RunnerRejected>;
  readonly compact: (input: { readonly agentId: AgentId; readonly incarnation: string; readonly delivery: Delivery; readonly sentSequence: number }) => Effect.Effect<void, RunnerRejected>;
  readonly stop: (input: { readonly agentId: AgentId }) => Effect.Effect<void, RunnerRejected>;
  readonly capabilities: RunnerCapabilities;
  readonly events: Stream.Stream<RunnerEvent>;
}>()("lgtm/engine/runner/Runner") {}
