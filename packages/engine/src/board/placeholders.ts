import type { BoardRpcGroup } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import { refused, type Input } from "../commands/internal.ts";

type BoardCommand = Rpc.Tag<RpcGroup.Rpcs<typeof BoardRpcGroup>>;
type BoardRead = "board.read" | "board.channels" | "board.status";
const disabled = (_input: Input, _payload: Record<string, unknown>) => Effect.fail(refused("board disabled"));

// Decision 159: each real handler's unit removes its placeholder here.
// Only the engine's normal refusal path may write a record for these calls.
export const boardPlaceholderPlanners = {
  "board.open": disabled,
  "board.members": disabled,
  "board.post": disabled,
  "board.close": disabled,
  "board.acknowledge": disabled,
  "board.flush": disabled,
} satisfies Partial<Record<Exclude<BoardCommand, BoardRead>, typeof disabled>>;

export const boardPlaceholderReads = {
  "board.read": disabled,
  "board.channels": disabled,
  "board.status": disabled,
} satisfies Partial<Record<BoardRead, typeof disabled>>;
