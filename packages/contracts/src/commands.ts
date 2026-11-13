import { QuestionMetadataFields } from "./questions.ts"
import { ChoiceId } from "./agentConfiguration.ts"
import { ContextReferences } from "./project/context.ts"
import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import { BoardRpcGroup, boardAccess } from "./board/commands.ts"
import { Account } from "./accounts.ts"
import { EventEnvelope, WaitMember } from "./events.ts"
import { HarnessSettings, RunMode } from "./harnesses.ts"
import { AccountId, AgentId, DeliveryId, EventSequence, HarnessId, PermissionRequestId, QuestionId, RequestId, WaitId } from "./ids.ts"
import { AlertRpcGroup, ClientRpcGroup, clientCommandAccess } from "./client/commands.ts"
import { PermissionLevel } from "./permission.ts"
import { ProjectRpcGroup, projectAccess } from "./project/commands.ts"
import { RolesRpcGroup, rolesAccess } from "./roles/commands.ts"

export const engineCommandNames = [
  "start", "configure", "prompt", "answer", "pass-up", "ask", "wait", "cancel-reply", "stop", "resume", "release", "compact", "group",
  "accounts", "accounts set-secret", "accounts mark-available", "harnesses", "subscribe", "debug.compare-views"
] as const
// Compatibility for clients that still import the original engine inventory.
export const commandNames = engineCommandNames
type CommandName = typeof engineCommandNames[number]
export type CallerKind = "owner" | "agent" | "service"

const request = { requestId: RequestId }
const target = { ...request, agentId: AgentId }
const Ack = Schema.Struct(request)
const Refused = Schema.TaggedStruct("CommandError", { ...request, reason: Schema.String })
const Subject = Schema.Union([
  Schema.TaggedStruct("permission", { id: PermissionRequestId }),
  Schema.TaggedStruct("question", { id: QuestionId })
])

// The service serves ServiceRpcGroup, plus DebugRpcGroup only after row 74's
// test flag and temporary state-folder checks. CommandsRpcGroup remains the
// complete client/CLI inventory.
export const DebugRpcGroup = RpcGroup.make(Rpc.make("debug.compare-views", {
  payload: request,
  success: Schema.Struct({
    ...request, sequence: EventSequence, equal: Schema.Boolean, differences: Schema.Array(Schema.String)
  }),
  error: Refused
}))

export const EngineCommandsRpcGroup = RpcGroup.make(
  Rpc.make("start", {
    payload: {
      ...request,
      name: Schema.NonEmptyString,
      role: Schema.String,
      harness: HarnessId,
      // A named account may itself be called "any"; selection is unambiguous.
      account: Schema.Union([
        Schema.TaggedStruct("named", { accountId: AccountId }),
        Schema.TaggedStruct("any", {})
      ]),
      model: Schema.optionalKey(ChoiceId),
      effort: Schema.optionalKey(ChoiceId),
      permission: PermissionLevel,
      folder: Schema.String.check(Schema.isPattern(/^\/.*$/)),
      runMode: Schema.optionalKey(RunMode),
      groups: Schema.optionalKey(Schema.Array(Schema.String)),
      prompt: Schema.optionalKey(Schema.String)
    },
    success: Schema.Struct({ ...request, agentId: AgentId }), error: Refused
  }),
  Rpc.make("configure", {
    payload: { ...target, model: Schema.optionalKey(ChoiceId), effort: Schema.optionalKey(ChoiceId) },
    success: Ack, error: Refused
  }),
  Rpc.make("prompt", {
    payload: { ...target, text: Schema.String, context: Schema.optionalKey(ContextReferences) },
    success: Schema.Struct({ ...request, deliveryId: DeliveryId }), error: Refused
  }),
  Rpc.make("answer", {
    payload: Schema.Union([
      Schema.Struct({ ...request, kind: Schema.Literal("permission"), id: PermissionRequestId, optionId: Schema.NonEmptyString }),
      Schema.Struct({ ...request, kind: Schema.Literal("question"), id: QuestionId, text: Schema.String })
    ]),
    success: Ack, error: Refused
  }),
  Rpc.make("pass-up", { payload: { ...request, subject: Subject }, success: Ack, error: Refused }),
  Rpc.make("ask", {
    payload: { ...request, text: Schema.String, ...QuestionMetadataFields },
    success: Schema.Struct({ ...request, questionId: QuestionId }), error: Refused
  }),
  Rpc.make("wait", {
    payload: {
      ...request, members: Schema.Array(AgentId).check(Schema.isMinLength(1)),
      mode: Schema.Literals(["any", "all"]), block: Schema.Boolean
    },
    success: Schema.Struct({
      ...request, waitId: WaitId, members: Schema.Array(WaitMember),
      outcome: Schema.Literals(["opened", "satisfied", "request-held", "cancelled"])
    }), error: Refused
  }),
  Rpc.make("release", { payload: { ...target, expectedHoldSequence: Schema.optionalKey(EventSequence) }, success: Ack, error: Refused }),
  Rpc.make("cancel-reply", { payload: target, success: Ack, error: Refused }),
  Rpc.make("stop", { payload: target, success: Ack, error: Refused }),
  Rpc.make("resume", {
    payload: { ...target, fresh: Schema.optionalKey(Schema.Boolean) }, success: Ack, error: Refused
  }),
  Rpc.make("compact", {
    payload: target, success: Schema.Struct({ ...request, deliveryId: DeliveryId }), error: Refused
  }),
  Rpc.make("group", {
    payload: { ...target, add: Schema.Array(Schema.String), remove: Schema.Array(Schema.String) },
    success: Ack, error: Refused
  }),
  Rpc.make("accounts", {
    payload: Schema.Union([
      Schema.Struct({ ...request, operation: Schema.Literal("list") }),
      Schema.Struct({ ...request, operation: Schema.Literals(["add", "set"]), account: Account }),
      Schema.Struct({ ...request, operation: Schema.Literals(["disable", "remove"]), accountId: AccountId })
    ]),
    success: Schema.Struct({ ...request, accounts: Schema.Array(Account) }), error: Refused
  }),
  Rpc.make("accounts set-secret", {
    // The wire-only credential ingress decodes to Redacted. Its value must
    // never reach an event, reply, receipt hash or transcript (row 55).
    payload: {
      ...request, accountId: AccountId, name: Schema.NonEmptyString,
      nonce: Schema.NonEmptyString,
      value: Schema.RedactedFromValue(Schema.String.check(Schema.isMinLength(16)), { label: "secret value" })
    },
    success: Ack, error: Refused
  }),
  Rpc.make("accounts mark-available", {
    payload: { ...request, accountId: AccountId }, success: Ack, error: Refused
  }),
  Rpc.make("harnesses", {
    payload: Schema.Union([
      Schema.Struct({ ...request, operation: Schema.Literal("list") }),
      Schema.Struct({ ...request, operation: Schema.Literal("set"), harness: HarnessSettings }),
      // Loads the defaults again over the settings of the harnesses they name.
      Schema.Struct({ ...request, operation: Schema.Literal("reset") })
    ]),
    success: Schema.Struct({ ...request, harnesses: Schema.Array(HarnessSettings) }), error: Refused
  }),
  Rpc.make("subscribe", {
    payload: { ...request, after: EventSequence },
    success: EventEnvelope, error: Refused, stream: true
  })
).merge(DebugRpcGroup)

// Later pieces merge their prefixed groups here, in namespace order.
export const WebRpcGroup = ClientRpcGroup.omit(
  "client.snapshot", "client.roster", "client.thread", "client.subscribe", "client.event", "client.sequence", "client.requests", "client.alerts.retry", "client.alerts.test", "client.alerts.prompt.dismiss", "client.agent.configuration", "client.agent.context",
  "client.alerts.list", "client.alerts.dismiss", "client.alerts.settings", "client.alerts.settings.set",
  "client.alerts.carrier.set", "client.alerts.carrier.set-token", "client.alerts.carrier.clear-token"
)
export const ClientReadsRpcGroup = ClientRpcGroup.omit("client.alerts.retry", "client.alerts.test", "client.alerts.prompt.dismiss", "client.alerts.list", "client.alerts.dismiss", "client.alerts.settings", "client.alerts.settings.set", "client.alerts.carrier.set", "client.alerts.carrier.set-token", "client.alerts.carrier.clear-token", "client.web.settings", "client.web.settings.set")
const InstalledClientRpcGroup = ClientReadsRpcGroup.merge(AlertRpcGroup).merge(WebRpcGroup)
export const CommandsRpcGroup = EngineCommandsRpcGroup.merge(InstalledClientRpcGroup).merge(BoardRpcGroup).merge(RolesRpcGroup).merge(ProjectRpcGroup)
export const ServiceRpcGroup = CommandsRpcGroup.omit("debug.compare-views")

// A new command requires an access decision at the composition point.
export const commandAccess = {
  "client.web.settings": ["owner"], "client.web.settings.set": ["owner"],
  "client.alerts.retry": ["owner"], "client.alerts.test": ["owner"], "client.alerts.prompt.dismiss": ["owner"],
  "client.alerts.list": ["owner"], "client.alerts.dismiss": ["owner"],
  "client.alerts.settings": ["owner"], "client.alerts.settings.set": ["owner"],
  "client.alerts.carrier.set": ["owner"], "client.alerts.carrier.set-token": ["owner"],
  "client.alerts.carrier.remove": ["owner"], "client.alerts.quiet.set": ["owner"], "client.alerts.carrier.enabled.set": ["owner"],
  "client.alerts.carrier.clear-token": ["owner"],
  ...boardAccess,
  ...rolesAccess,
  ...projectAccess,
  configure: ["owner"], start: ["owner", "agent"], prompt: ["owner", "agent", "service"], answer: ["owner", "agent"],
  "pass-up": ["owner", "agent"], ask: ["owner", "agent"], wait: ["owner", "agent"],
  release: ["owner", "agent", "service"],
  "cancel-reply": ["owner", "agent"], stop: ["owner", "agent"], resume: ["owner", "agent", "service"], compact: ["owner", "agent", "service"], group: ["owner", "agent"],
  accounts: ["owner"], "accounts set-secret": ["owner"], "accounts mark-available": ["owner"],
  harnesses: ["owner"], subscribe: ["owner", "agent", "service"], "debug.compare-views": ["owner"],
  "client.agent.configuration": ["owner"], "client.agent.context": ["owner"],
  "client.snapshot": clientCommandAccess["client.snapshot"], "client.roster": clientCommandAccess["client.roster"],
  "client.thread": clientCommandAccess["client.thread"], "client.subscribe": clientCommandAccess["client.subscribe"],
  "client.requests": clientCommandAccess["client.requests"],
  "client.event": clientCommandAccess["client.event"], "client.sequence": clientCommandAccess["client.sequence"]
} satisfies Record<Rpc.Tag<RpcGroup.Rpcs<typeof CommandsRpcGroup>>, ReadonlyArray<CallerKind>>
export const ownerOnlyCommands = [...CommandsRpcGroup.requests.keys()].filter((name) => !(commandAccess[name as keyof typeof commandAccess] as ReadonlyArray<CallerKind>).includes("agent"))
export const commandGroups = [{ namespace: "engine", group: EngineCommandsRpcGroup }, { namespace: "client", group: InstalledClientRpcGroup }, { namespace: "board", group: BoardRpcGroup }, { namespace: "roles", group: RolesRpcGroup }, { namespace: "project", group: ProjectRpcGroup }] as const
