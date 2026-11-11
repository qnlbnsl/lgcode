import { AgentChoices, AgentConfiguration, ContextUsage } from "../agentConfiguration.ts"
import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import type { CallerKind } from "../commands.ts"
import { EventEnvelope } from "../events.ts"
import { AgentId, EventSequence, RequestId } from "../ids.ts"
import { Alert, AlertDeliveryFailure, AlertId, AlertKind, AlertSettings, CarrierSettings } from "./alerts.ts"
import { ClientFilter, ClientRequest, ClientSnapshot, ClientStreamItem, RosterEntry } from "./reads.ts"
import { WebServerState, WebSettings } from "./settings.ts"

const request = { requestId: RequestId }
const Ack = Schema.Struct(request)
const Refused = Schema.TaggedStruct("CommandError", { ...request, reason: Schema.String })
const page = { after: EventSequence, limit: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)) }
const AgentData = Schema.Struct({ ...request, data: Schema.String })
export const ThreadPage = Schema.Struct({
  ...request, items: Schema.Array(EventEnvelope), next: Schema.optionalKey(EventSequence)
})
export const EventReply = Schema.Struct({ ...request, envelope: EventEnvelope })

// Definitions only. A unit installs its subset into CommandsRpcGroup when it
// supplies the handlers, so the running service never advertises a stub.
export const ClientRpcGroup = RpcGroup.make(
  Rpc.make("agent.configuration", {
    payload: { ...request, agentId: AgentId },
    success: Schema.Struct({ ...request, agentId: AgentId, configuration: AgentConfiguration, ...AgentChoices.fields }), error: Refused
  }),
  Rpc.make("agent.context", {
    payload: { ...request, agentId: AgentId },
    success: Schema.Struct({ ...request, agentId: AgentId, context: ContextUsage }), error: Refused
  }),
  Rpc.make("snapshot", { payload: request, success: Schema.Struct({ ...request, ...ClientSnapshot.fields }), error: Refused }),
  Rpc.make("roster", {
    payload: { ...request, group: Schema.optionalKey(Schema.NonEmptyString), role: Schema.optionalKey(Schema.String), parent: Schema.optionalKey(AgentId) },
    success: Schema.Struct({ ...request, agents: Schema.Array(RosterEntry) }), error: Refused
  }),
  Rpc.make("thread", {
    payload: { ...request, ...page, agentId: AgentId },
    success: Schema.Union([ThreadPage, AgentData]), error: Refused
  }),
  Rpc.make("subscribe", {
    payload: { ...request, after: EventSequence, filter: Schema.optionalKey(ClientFilter) },
    success: ClientStreamItem, stream: true, error: Refused
  }).setError(Refused),
  Rpc.make("event", {
    payload: { ...request, sequence: EventSequence }, success: Schema.Union([EventReply, AgentData]), error: Refused
  }),
  Rpc.make("requests", {
    payload: { ...request, ...page, agentId: Schema.optionalKey(AgentId),
      kind: Schema.optionalKey(Schema.Literals(["permission", "question"])),
      status: Schema.optionalKey(Schema.Literals(["open", "answered", "cancelled"])) },
    success: Schema.Struct({ ...request, sequence: EventSequence, items: Schema.Array(ClientRequest), next: Schema.optionalKey(EventSequence) }), error: Refused
  }),
  Rpc.make("sequence", { payload: request, success: Schema.Struct({ ...request, sequence: EventSequence }), error: Refused }),
  Rpc.make("alerts.list", {
    payload: { ...request, ...page, status: Schema.optionalKey(Schema.Literals(["open", "cleared"])) },
    success: Schema.Struct({ ...request, items: Schema.Array(Alert), next: Schema.optionalKey(EventSequence) }), error: Refused
  }),
  Rpc.make("alerts.retry", {
    payload: { ...request, alertId: AlertId, generation: EventSequence, attempt: Schema.Int.check(Schema.isGreaterThan(0)) },
    success: Schema.Struct({ ...request, accepted: Schema.Boolean, reason: Schema.optionalKey(AlertDeliveryFailure) }), error: Refused
  }),
  Rpc.make("alerts.test", { payload: request,
    success: Schema.Struct({ ...request, accepted: Schema.Boolean, reason: Schema.optionalKey(AlertDeliveryFailure) }), error: Refused }),
  Rpc.make("alerts.prompt.dismiss", { payload: request, success: Ack, error: Refused }),
  Rpc.make("alerts.dismiss", { payload: { ...request, alertId: AlertId }, success: Ack, error: Refused }),
  Rpc.make("alerts.settings", { payload: request, success: Schema.Struct({ ...request, ...AlertSettings.fields }), error: Refused }),
  Rpc.make("alerts.settings.set", { payload: { ...request, kind: AlertKind, push: Schema.Boolean }, success: Ack, error: Refused }),
  Rpc.make("alerts.carrier.set", { payload: { ...request, carrier: CarrierSettings }, success: Ack, error: Refused }),
  Rpc.make("alerts.carrier.set-token", {
    payload: { ...request, origin: Schema.NonEmptyString, nonce: Schema.NonEmptyString,
      value: Schema.RedactedFromValue(Schema.NonEmptyString, { label: "secret value" }) },
    success: Ack, error: Refused
  }),
  Rpc.make("alerts.carrier.clear-token", { payload: request, success: Ack, error: Refused }),
  Rpc.make("web.settings", { payload: request, success: Schema.Struct({ ...request, ...WebSettings.fields, serverState: WebServerState }), error: Refused }),
  Rpc.make("web.settings.set", { payload: { ...request, settings: WebSettings }, success: Ack, error: Refused })
).prefix("client.")

export const clientCommandAccess = {
  "client.agent.configuration": ["owner"], "client.agent.context": ["owner"],
  "client.snapshot": ["owner", "agent", "service"], "client.roster": ["owner", "agent", "service"],
  "client.thread": ["owner", "agent", "service"], "client.subscribe": ["owner", "agent", "service"],
  "client.requests": ["owner"], "client.event": ["owner", "agent", "service"], "client.sequence": ["owner", "service"],
  "client.alerts.retry": ["owner"], "client.alerts.test": ["owner"], "client.alerts.prompt.dismiss": ["owner"],
  "client.alerts.list": ["owner"], "client.alerts.dismiss": ["owner"], "client.alerts.settings": ["owner"],
  "client.alerts.settings.set": ["owner"], "client.alerts.carrier.set": ["owner"], "client.alerts.carrier.set-token": ["owner"],
  "client.alerts.carrier.clear-token": ["owner"], "client.web.settings": ["owner"], "client.web.settings.set": ["owner"]
} satisfies Record<Rpc.Tag<RpcGroup.Rpcs<typeof ClientRpcGroup>>, ReadonlyArray<CallerKind>>

// The alert units install their implemented commands.
export const AlertRpcGroup = ClientRpcGroup.omit(
  "client.snapshot", "client.roster", "client.thread", "client.subscribe", "client.event", "client.sequence", "client.requests", "client.agent.configuration", "client.agent.context",
  "client.web.settings", "client.web.settings.set"
)
