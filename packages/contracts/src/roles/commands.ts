import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import type { CallerKind } from "../commands.ts"
import { AgentId, EpochMilliseconds, EventSequence, RequestId } from "../ids.ts"
import { SheepdogRecord, RolesActionRecord } from "./events.ts"
import { RoleFile, RoleFileHash, RolesSettings } from "./schema.ts"

const request = { requestId: RequestId }
const Ack = Schema.Struct(request)
const Refused = Schema.TaggedStruct("CommandError", { ...request, reason: Schema.String })
// The later read units define their record replies alongside their views.
export const RolesRpcGroup = RpcGroup.make(
  Rpc.make("orient", { payload: request, success: Schema.Unknown, error: Refused }),
  Rpc.make("handoff", {
    payload: { ...request, agentId: AgentId, omissions: Schema.optionalKey(Schema.Struct({
      after: EventSequence, through: EventSequence, requestId: RequestId,
    })) }, success: Schema.Unknown, error: Refused,
  }),
  Rpc.make("role-file.set", {
    payload: { ...request, content: Schema.String },
    success: Schema.Struct({ ...request, roleFileHash: RoleFileHash }), error: Refused,
  }),
  Rpc.make("role-file.get", {
    payload: request,
    success: Schema.Struct({ ...request, file: Schema.NullOr(RoleFile), roleFileHash: Schema.NullOr(RoleFileHash) }), error: Refused,
  }),
  Rpc.make("settings.get", { payload: request, success: Schema.Struct({ ...request, settings: RolesSettings }), error: Refused }),
  Rpc.make("settings.set", { payload: { ...request, settings: RolesSettings }, success: Ack, error: Refused }),
  Rpc.make("snooze", { payload: { ...request, group: Schema.String, until: EpochMilliseconds }, success: Ack, error: Refused }),
  Rpc.make("actions.list", {
    payload: {
      ...request, agentId: Schema.optionalKey(AgentId), before: Schema.optionalKey(EventSequence),
      limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
    }, success: Schema.Struct({ ...request, items: Schema.Array(RolesActionRecord), next: Schema.optionalKey(EventSequence) }), error: Refused,
  }),
  Rpc.make("record", { payload: { ...request, action: SheepdogRecord }, success: Schema.Struct({ ...request, sequence: EventSequence }), error: Refused }),
).prefix("roles.")

export const rolesAccess = {
  "roles.orient": ["agent"], "roles.handoff": ["owner", "agent"],
  "roles.role-file.set": ["owner"], "roles.role-file.get": ["owner"],
  "roles.settings.get": ["owner"], "roles.settings.set": ["owner"],
  "roles.snooze": ["owner"], "roles.actions.list": ["owner"], "roles.record": ["service"],
} satisfies Record<Rpc.Tag<RpcGroup.Rpcs<typeof RolesRpcGroup>>, ReadonlyArray<CallerKind>>
