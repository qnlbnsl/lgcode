import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import type { CallerKind } from "../commands.ts"
import { EventEnvelope } from "../events.ts"
import { AgentId, EventSequence, RequestId } from "../ids.ts"
import { Alert, AlertId, AlertKind, AlertSettings, CarrierSettings } from "./alerts.ts"
import { ClientFilter, ClientSnapshot, ClientStreamItem, RosterEntry } from "./reads.ts"
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
  Rpc.make("sequence", { payload: request, success: Schema.Struct({ ...request, sequence: EventSequence }), error: Refused }),
  Rpc.make("alerts.list", {
    payload: { ...request, ...page, status: Schema.optionalKey(Schema.Literals(["open", "cleared"])) },
    success: Schema.Struct({ ...request, items: Schema.Array(Alert), next: Schema.optionalKey(EventSequence) }), error: Refused
  }),
  Rpc.make("alerts.dismiss", { payload: { ...request, alertId: AlertId }, success: Ack, error: Refused }),
  Rpc.make("alerts.settings", { payload: request, success: Schema.Struct({ ...request, ...AlertSettings.fields }), error: Refused }),
  Rpc.make("alerts.settings.set", { payload: { ...request, kind: AlertKind, push: Schema.Boolean }, success: Ack, error: Refused }),
  Rpc.make("alerts.carrier.set", { payload: { ...request, carrier: CarrierSettings }, success: Ack, error: Refused }),
  Rpc.make("alerts.carrier.set-token", {
    payload: { ...request, origin: Schema.NonEmptyString, nonce: Schema.NonEmptyString,
      value: Schema.RedactedFromValue(Schema.NonEmptyString, { label: "carrier token" }) },
    success: Ack, error: Refused
  }),
  Rpc.make("alerts.carrier.clear-token", { payload: request, success: Ack, error: Refused }),
  Rpc.make("web.settings", { payload: request, success: Schema.Struct({ ...request, ...WebSettings.fields, serverState: WebServerState }), error: Refused }),
  Rpc.make("web.settings.set", { payload: { ...request, settings: WebSettings }, success: Ack, error: Refused })
).prefix("client.")

export const clientCommandAccess = {
  "client.snapshot": ["owner", "agent", "service"], "client.roster": ["owner", "agent", "service"],
  "client.thread": ["owner", "agent", "service"], "client.subscribe": ["owner", "agent", "service"],
  "client.event": ["owner", "agent", "service"], "client.sequence": ["owner", "service"],
  "client.alerts.list": ["owner"], "client.alerts.dismiss": ["owner"], "client.alerts.settings": ["owner"],
  "client.alerts.settings.set": ["owner"], "client.alerts.carrier.set": ["owner"], "client.alerts.carrier.set-token": ["owner"],
  "client.alerts.carrier.clear-token": ["owner"], "client.web.settings": ["owner"], "client.web.settings.set": ["owner"]
} satisfies Record<Rpc.Tag<RpcGroup.Rpcs<typeof ClientRpcGroup>>, ReadonlyArray<CallerKind>>
