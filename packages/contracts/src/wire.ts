import * as Schema from "effect/Schema"
import type * as SchemaAST from "effect/SchemaAST"
import type * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcSchema from "effect/rpc/RpcSchema"
import { CommandsRpcGroup } from "./commands.ts"
import { ClientRpcGroup } from "./client/commands.ts"
import { EventEnvelope } from "./events.ts"

// Only RPC clients use this form. Durable writes and server encoders retain
// EventEnvelope, including its strict caller and event unions.
export const WireEnvelope = Schema.Struct({
  ...EventEnvelope.fields, caller: Schema.Unknown, event: Schema.Unknown
})
export type WireEnvelope = typeof WireEnvelope.Type

const wireAst = (ast: SchemaAST.AST): SchemaAST.AST =>
  ast === EventEnvelope.ast ? WireEnvelope.ast : "recur" in ast && typeof ast.recur === "function" ? ast.recur(wireAst) : ast
const wireSuccess = (schema: Schema.Top): Schema.Top => RpcSchema.isStreamSchema(schema)
  ? RpcSchema.Stream(Schema.make(wireAst(schema.success.ast)), schema.error)
  : Schema.make(wireAst(schema.ast))

// The type follows the same envelope replacement, including nested pages.
export type WireValue<A> = A extends EventEnvelope ? WireEnvelope
  : A extends string | number | boolean | bigint | symbol | null | undefined ? A
  : A extends ReadonlyArray<infer Item> ? ReadonlyArray<WireValue<Item>>
  : A extends object ? { readonly [K in keyof A]: WireValue<A[K]> } : A
export type WireRpc<R extends Rpc.Any> = R extends Rpc.Rpc<infer Tag, infer Payload, infer Success, infer Error, infer Middleware, infer Requires>
  ? Rpc.Rpc<Tag, Payload,
    Success extends RpcSchema.Stream<infer A, infer E> ? RpcSchema.Stream<Schema.Codec<WireValue<A["Type"]>>, E>
      : Schema.Codec<WireValue<Success["Type"]>>,
    Error, Middleware, Requires> : never

// Walk nested pages as well as streams, preserving payloads, errors and RPC
// metadata. Future groups get the same envelope rule when installed.
export const wireGroup = <R extends Rpc.Rpc<any, any, any, any, any, any>>(group: RpcGroup.RpcGroup<R>): RpcGroup.RpcGroup<WireRpc<R>> =>
  RpcGroup.make(...[...group.requests.values()].map((rpc) => rpc.setSuccess(wireSuccess(rpc.successSchema)))) as unknown as RpcGroup.RpcGroup<WireRpc<R>>
export const WireCommandsRpcGroup = wireGroup(CommandsRpcGroup)
export const WireClientRpcGroup = wireGroup(ClientRpcGroup)
