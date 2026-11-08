import { randomUUID } from "node:crypto";
import { PermissionRequestId, type Event } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { EngineLists } from "../pieces/lists.ts";
import type { Snapshot } from "../commands/internal.ts";
import type { RunnerEvent } from "../runner/Runner.ts";
import { targetGone } from "../routing/deliveries.ts";
import { freshDelivery, holderAbove, moveHeld, withdrawQueued } from "../routing/holders.ts";
import { project } from "../routing/waits.ts";

export const stderrTailLines = 30;
// Also bound a child that writes indefinitely without a newline.
const maxLineCharacters = 16_384;

export const makeStderrTail = (options: {
  readonly maxLines: number;
  readonly redactChunk: (itemId: string, text: string, final: boolean) => Effect.Effect<string>;
}) => Effect.sync(() => {
  const itemId = randomUUID();
  const limit = Math.max(1, Math.floor(options.maxLines));
  const lines: Array<string> = [];
  let partial = "";
  let finished = false;
  const append = (text: string) => {
    const pieces = (partial + text).split("\n");
    partial = pieces.pop()!.slice(-maxLineCharacters);
    for (const line of pieces) {
      lines.push(line.slice(-maxLineCharacters));
      if (lines.length > limit) lines.shift();
    }
  };
  return {
    push: (chunk: string) => Effect.gen(function* () {
      if (!finished) append(yield* options.redactChunk(itemId, chunk, false));
    }),
    finish: () => Effect.gen(function* () {
      if (!finished) {
        append(yield* options.redactChunk(itemId, "", true));
        if (partial !== "") {
          lines.push(partial);
          if (lines.length > limit) lines.shift();
        }
        partial = "";
        finished = true;
      }
      return lines.join("\n");
    }),
  };
});

// Called inside the writer transaction, before its wait checks. An open
// wait naming the child supplies the ancestor's notice. Queue any other
// ancestor notice first, so it counts against that ancestor being settled.
export const crashEvents = (
  snapshot: Snapshot, event: Extract<RunnerEvent, { _tag: "exited" }>, lists?: EngineLists,
): ReadonlyArray<Event> => {
  const cancelled = Object.values(snapshot.requests)
    .filter((row) => row.agentId === event.agentId && row.status === "open")
    .flatMap((row): ReadonlyArray<Event> => [{
      _tag: "PermissionCancelled", agentId: event.agentId,
      permissionRequestId: Schema.decodeUnknownSync(PermissionRequestId)(row.permissionRequestId), reason: "agent crashed",
    }, ...withdrawQueued(snapshot, row.deliveryId)]);
  const crashed: Array<Event> = [{
    _tag: "AgentCrashed", agentId: event.agentId, exitCode: event.exitCode, signal: event.signal, stderr: event.stderr,
  }, ...cancelled];
  crashed.push(...moveHeld(project(snapshot, crashed), [event.agentId]));
  crashed.push(...targetGone(project(snapshot, crashed), event.agentId, "crashed", lists));
  const holder = holderAbove(snapshot, event.agentId);
  if (holder._tag === "owner") return [...crashed, { _tag: "OwnerNeeded", agentId: event.agentId, reason: "agent crashed" }];
  const waiting = Object.values(snapshot.waits).some((wait) => wait.status === "open"
    && wait.agentId === holder.agentId && wait.members.includes(event.agentId));
  if (waiting) return crashed;
  const id = freshDelivery();
  return [...crashed, { _tag: "DeliveryQueued", delivery: {
    id, target: holder.agentId, sender: { _tag: "owner" },
    // This notice contains only engine-owned text and an engine-issued id.
    content: { _tag: "prompt", text: `Agent ${event.agentId} crashed.` },
  } }];
};
