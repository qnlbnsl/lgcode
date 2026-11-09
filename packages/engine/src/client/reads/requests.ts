import type { ClientRequest, EventEnvelope, ProjectRequestLink } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import type { ReadHandler } from "../../api/reads.ts";
import { refused } from "../../commands/internal.ts";
import type { Snapshot } from "../../commands/internal.ts";
import { own, projectView } from "../../project/view.ts";
import { cutUtf8, display, encodedBytes } from "./display.ts";

// The same fold is rebuilt from the durable log at startup. Never derive the
// owner's index from the subset of threads a browser happened to open.
export const requests: ReadHandler = (input, payload) => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused();
  const { snapshot } = input;
  const after = payload.after as number;
  if (after > snapshot.sequence) return yield* refused("cursor ahead of snapshot");
  const limit = Math.min(payload.limit as number, 200);
  const rows = requestRows(snapshot).filter((row) => row.sourceSequence > after
    && (payload.agentId === undefined || row.agentId === payload.agentId)
    && (payload.kind === undefined || row.kind === payload.kind)
    && (payload.status === undefined || row.status === payload.status))
    .sort((a, b) => a.sourceSequence - b.sourceSequence);
  const items: ClientRequest[] = [];
  const reply = (next?: number) => ({ requestId: payload.requestId, sequence: snapshot.sequence, items,
    ...(next === undefined ? {} : { next }) });
  for (const row of rows) {
    if (items.length >= limit) break;
    items.push(row);
    if (encodedBytes(reply(row.sourceSequence)) > 512 * 1024) {
      items.pop();
      if (items.length === 0) return yield* refused("request identity exceeds page limit");
      break;
    }
  }
  return { reply: reply(items.length < rows.length ? items.at(-1)?.sourceSequence : undefined) };
});

const requestLink = (snapshot: Snapshot, row: ProjectRequestLink & { readonly agentId: string }): ProjectRequestLink => {
  const projectId = own(projectView(snapshot).agentProjects, row.agentId) as ProjectRequestLink["projectId"];
  if (projectId === undefined || row.projectId !== undefined && row.projectId !== projectId) return {};
  // Old provisional task strings do not acquire completion authority on replay.
  return { projectId, ...(row.projectId === undefined ? {} : {
    ...(row.taskId === undefined ? {} : { taskId: row.taskId }), ...(row.sprintId === undefined ? {} : { sprintId: row.sprintId }),
  }) };
};
export const requestRows = (snapshot: Snapshot): ClientRequest[] => [
    ...Object.values(snapshot.requests).map((row): ClientRequest => ({
      ...requestLink(snapshot, row), id: row.permissionRequestId, kind: "permission", agentId: row.agentId, holder: row.holder,
      status: row.status, sourceSequence: row.sourceSequence, openedAt: row.openedAt,
      ...(row.closedSequence === undefined ? {} : { closedSequence: row.closedSequence, answeredAt: row.answeredAt! }),
      ...(row.answeredBy?._tag === "owner" || row.answeredBy?._tag === "agent" ? { answeredBy: row.answeredBy } : {}),
      ...(row.answer?._tag === "selected" && Buffer.byteLength(row.answer.optionId) <= 128 ? { optionId: row.answer.optionId } : {}),
      ...(row.reason === undefined ? {} : { reason: cutUtf8(row.reason, 512) }),
      canAnswer: row.status === "open" && row.holder._tag === "owner",
    })),
    ...Object.values(snapshot.questions).map((row): ClientRequest => ({
      ...requestLink(snapshot, row), id: row.questionId, kind: "question", agentId: row.agentId, holder: row.holder,
      status: row.status, sourceSequence: row.sourceSequence, openedAt: row.openedAt,
      ...(row.closedSequence === undefined ? {} : { closedSequence: row.closedSequence, answeredAt: row.answeredAt! }),
      ...(row.answeredBy === undefined ? {} : { answeredBy: row.answeredBy }),
      ...(row.answer === undefined ? {} : { answer: cutUtf8(row.answer, 512) }),
      canAnswer: row.status === "open" && row.holder._tag === "owner",
    })),
  ].map((row) => {
  const source = snapshot.threads[row.agentId]?.find((event) => event.sequence === row.sourceSequence);
  const part = source === undefined ? undefined : display(source as EventEnvelope);
  return { ...row, ...(part === undefined ? {} : { display: part }) };
}).sort((a, b) => a.sourceSequence - b.sourceSequence);
