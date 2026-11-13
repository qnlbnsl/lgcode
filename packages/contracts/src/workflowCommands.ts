import * as Schema from 'effect/Schema'
import * as Rpc from 'effect/rpc/Rpc'
import * as RpcGroup from 'effect/rpc/RpcGroup'
import { RequestId } from './ids.ts'
import { WorkflowId, WorkflowScope, WorkflowSummary, WorkflowRecord } from './workflows.ts'
const request = { requestId: RequestId }
const location = { repoId: Schema.optionalKey(Schema.String) }
const reference = { ...location, scope: WorkflowScope, id: WorkflowId }
const Refused = Schema.TaggedStruct('CommandError', { ...request, reason: Schema.String })
export const WorkflowRpcGroup = RpcGroup.make(
  Rpc.make('list', { payload: { ...request, ...location }, success: Schema.Struct({ ...request, items: Schema.Array(WorkflowSummary) }), error: Refused }),
  Rpc.make('read', { payload: { ...request, ...reference }, success: Schema.Struct({ ...request, workflow: WorkflowRecord }), error: Refused }),
  Rpc.make('clone', { payload: { ...request, ...reference, target: Schema.Literals(['user', 'repository']), name: Schema.String }, success: Schema.Struct({ ...request, workflow: WorkflowRecord }), error: Refused }),
  Rpc.make('save', { payload: { ...request, ...reference, definition: Schema.Unknown }, success: Schema.Struct({ ...request, workflow: WorkflowRecord }), error: Refused }),
  Rpc.make('validate', { payload: { ...request, definition: Schema.Unknown }, success: Schema.Struct({ ...request, valid: Schema.Boolean, error: Schema.optionalKey(Schema.String) }), error: Refused }),
  Rpc.make('delete', { payload: { ...request, ...reference }, success: Schema.Struct(request), error: Refused }),
).prefix('client.workflows.')
export const workflowAccess = {
  'client.workflows.list': ['owner'], 'client.workflows.read': ['owner'], 'client.workflows.clone': ['owner'],
  'client.workflows.save': ['owner'], 'client.workflows.validate': ['owner'], 'client.workflows.delete': ['owner'],
} as const

export const workflowCommandNames = ['client.workflows.list', 'client.workflows.read', 'client.workflows.clone', 'client.workflows.save', 'client.workflows.validate', 'client.workflows.delete'] as const
