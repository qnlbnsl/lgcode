import * as Schema from 'effect/Schema'
import * as Rpc from 'effect/rpc/Rpc'
import * as RpcGroup from 'effect/rpc/RpcGroup'
import { RequestId } from './ids.ts'
const request = { requestId: RequestId }
const Refused = Schema.TaggedStruct('CommandError', { ...request, reason: Schema.String })
export const ServiceControlRpcGroup = RpcGroup.make(
  Rpc.make('version', { payload: { ...request, check: Schema.optionalKey(Schema.Boolean) }, success: Schema.Struct({ ...request,
    version: Schema.String, commit: Schema.String, dataFolder: Schema.String, checkout: Schema.String,
    comparison: Schema.Literals(['unchecked', 'same', 'different', 'unavailable']), remoteCommit: Schema.optionalKey(Schema.String),
    reason: Schema.optionalKey(Schema.String), updateCommands: Schema.Array(Schema.String),
  }), error: Refused }),
  Rpc.make('restart', { payload: { ...request, confirmed: Schema.Boolean }, success: Schema.Struct({ ...request, restarting: Schema.Boolean }), error: Refused }),
).prefix('client.service.')
export const serviceControlAccess = { 'client.service.version': ['owner'], 'client.service.restart': ['owner'] } as const
