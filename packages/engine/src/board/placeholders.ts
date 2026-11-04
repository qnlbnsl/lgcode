import * as Effect from "effect/Effect";
import { refused, type Input } from "../commands/internal.ts";

const disabled = (_input: Input, _payload: Record<string, unknown>) => Effect.fail(refused("board disabled"));

// Decision 159: each real handler's unit removes its placeholder here.
// Only the engine's normal refusal path may write a record for these calls.
// Keep the empty list until unit 4 removes this file and its inventory test.
export const boardPlaceholderPlanners = {};

export const boardPlaceholderReads = {
  "board.read": disabled,
} satisfies Record<"board.read", typeof disabled>;
