import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Event } from "@lgtm/contracts";

// Every event passes through here before it is stored or returned (decision
// row 59). Unit 4a provides this pass-through; unit 5a replaces `layer` with
// the real secret removal, so the log needs no change.
export class Redactor extends Context.Service<
  Redactor,
  {
    readonly redact: (event: Event) => Effect.Effect<Event>;
    readonly redactText: (text: string) => Effect.Effect<string>;
    readonly redactChunk?: (itemId: string, text: string, final: boolean) => Effect.Effect<string>;
  }
>()("lgtm/engine/log/Redactor") {}

export const layer = Layer.succeed(Redactor, {
  redact: (event: Event) => Effect.succeed(event),
  redactText: (text: string) => Effect.succeed(text),
});
