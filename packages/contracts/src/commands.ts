import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import { Account } from "./accounts.ts"
import { EventEnvelope, WaitMember } from "./events.ts"
import { HarnessSettings, RunMode } from "./harnesses.ts"
import { AccountId, AgentId, DeliveryId, EventSequence, HarnessId, PermissionRequestId, QuestionId, RequestId, WaitId } from "./ids.ts"
import { ClientRpcGroup } from "./client/commands.ts"
import { PermissionLevel } from "./permission.ts"

export const engineCommandNames = [
  "start", "prompt", "answer", "pass-up", "ask", "wait", "stop", "resume", "compact", "group",
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
      model: Schema.optionalKey(Schema.NonEmptyString),
      effort: Schema.optionalKey(Schema.NonEmptyString),
      permission: PermissionLevel,
      folder: Schema.String.check(Schema.isPattern(/^\/.*$/)),
      runMode: Schema.optionalKey(RunMode),
      groups: Schema.optionalKey(Schema.Array(Schema.String)),
      prompt: Schema.optionalKey(Schema.String)
    },
    success: Schema.Struct({ ...request, agentId: AgentId }), error: Refused
  }),
  Rpc.make("prompt", {
    payload: { ...target, text: Schema.String },
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
    payload: { ...request, text: Schema.String },
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
  "client.snapshot", "client.roster", "client.thread", "client.subscribe", "client.event", "client.sequence",
  "client.alerts.list", "client.alerts.dismiss", "client.alerts.settings", "client.alerts.settings.set",
  "client.alerts.carrier.set", "client.alerts.carrier.set-token", "client.alerts.carrier.clear-token"
)
export const CommandsRpcGroup = EngineCommandsRpcGroup.merge(WebRpcGroup)
export const ServiceRpcGroup = CommandsRpcGroup.omit("debug.compare-views")

// A new command requires an access decision at the composition point.
export const commandAccess = {
  start: ["owner", "agent"], prompt: ["owner", "agent", "service"], answer: ["owner", "agent"],
  "pass-up": ["owner", "agent"], ask: ["owner", "agent"], wait: ["owner", "agent"],
  stop: ["owner", "agent"], resume: ["owner", "agent", "service"], compact: ["owner", "agent", "service"], group: ["owner", "agent"],
  accounts: ["owner"], "accounts set-secret": ["owner"], "accounts mark-available": ["owner"],
  harnesses: ["owner"], subscribe: ["owner", "agent", "service"], "debug.compare-views": ["owner"],
  "client.web.settings": ["owner"], "client.web.settings.set": ["owner"]
} satisfies Record<Rpc.Tag<RpcGroup.Rpcs<typeof CommandsRpcGroup>>, ReadonlyArray<CallerKind>>
export const ownerOnlyCommands = [...CommandsRpcGroup.requests.keys()].filter((name) => !(commandAccess[name as keyof typeof commandAccess] as ReadonlyArray<CallerKind>).includes("agent"))
export const commandGroups = [{ namespace: "engine", group: EngineCommandsRpcGroup }, { namespace: "client", group: WebRpcGroup }] as const
