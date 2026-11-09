import type { ClientRequest, EventEnvelope } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import type { ReadHandler } from "../../api/reads.ts";
import { refused } from "../../commands/internal.ts";
import { cutUtf8, display, encodedBytes } from "./display.ts";

// The same fold is rebuilt from the durable log at startup. Never derive the
// owner's index from the subset of threads a browser happened to open.
export const requests: ReadHandler = (input, payload) => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused();
  const { snapshot } = input;
  const after = payload.after as number;
  if (after > snapshot.sequence) return yield* refused("cursor ahead of snapshot");
  const limit = Math.min(payload.limit as number, 200);
  const rows: ClientRequest[] = [
    ...Object.values(snapshot.requests).map((row): ClientRequest => ({
      id: row.permissionRequestId, kind: "permission", agentId: row.agentId, holder: row.holder,
      status: row.status, sourceSequence: row.sourceSequence, openedAt: row.openedAt,
      ...(row.closedSequence === undefined ? {} : { closedSequence: row.closedSequence, answeredAt: row.answeredAt! }),
      ...(row.answeredBy?._tag === "owner" || row.answeredBy?._tag === "agent" ? { answeredBy: row.answeredBy } : {}),
      ...(row.answer?._tag === "selected" && Buffer.byteLength(row.answer.optionId) <= 128 ? { optionId: row.answer.optionId } : {}),
      ...(row.reason === undefined ? {} : { reason: cutUtf8(row.reason, 512) }),
      canAnswer: row.status === "open" && row.holder._tag === "owner",
    })),
    ...Object.values(snapshot.questions).map((row): ClientRequest => ({
      id: row.questionId, kind: "question", agentId: row.agentId, holder: row.holder,
      status: row.status, sourceSequence: row.sourceSequence, openedAt: row.openedAt,
      ...(row.closedSequence === undefined ? {} : { closedSequence: row.closedSequence, answeredAt: row.answeredAt! }),
      ...(row.answeredBy === undefined ? {} : { answeredBy: row.answeredBy }),
      ...(row.answer === undefined ? {} : { answer: cutUtf8(row.answer, 512) }),
      canAnswer: row.status === "open" && row.holder._tag === "owner",
    })),
  ].filter((row) => row.sourceSequence > after
    && (payload.agentId === undefined || row.agentId === payload.agentId)
    && (payload.kind === undefined || row.kind === payload.kind)
    && (payload.status === undefined || row.status === payload.status))
    .sort((a, b) => a.sourceSequence - b.sourceSequence);
  const items: ClientRequest[] = [];
  const reply = (next?: number) => ({ requestId: payload.requestId, sequence: snapshot.sequence, items,
    ...(next === undefined ? {} : { next }) });
  for (const row of rows) {
    if (items.length >= limit) break;
    const source = snapshot.threads[row.agentId]?.find((event) => event.sequence === row.sourceSequence);
    const part = source === undefined ? undefined : display(source as EventEnvelope);
    items.push({ ...row, ...(part === undefined ? {} : { display: part }) });
    if (encodedBytes(reply(row.sourceSequence)) > 512 * 1024) {
      items.pop();
      if (items.length === 0) return yield* refused("request identity exceeds page limit");
      break;
    }
  }
  return { reply: reply(items.length < rows.length ? items.at(-1)?.sourceSequence : undefined) };
});
