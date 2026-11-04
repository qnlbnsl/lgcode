import type { Caller } from "@shephrd/contracts";
import { pieceNamespaces } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import { engineLists, type EngineLists } from "../pieces/lists.ts";
import { guardPiece } from "../pieces/guardPiece.ts";
import { Views } from "../views/Views.ts";
import { mayReadAgent } from "./visibility.ts";
import { roster } from "../client/reads/roster.ts";
import { cutGroups, cutUtf8, display } from "../client/reads/display.ts";

export const snapshot = (caller: Caller, lists: EngineLists = engineLists) => Effect.gen(function* () {
  // Publication can lag COMMIT, so every section and the cursor share this value.
  const view = yield* (yield* Views).snapshot;
  const readable = (id: string) => mayReadAgent(caller, id, view);
  const filter = <T>(rows: Readonly<Record<string, T>>, include: (row: T) => boolean): ReadonlyArray<T> => Object.values(rows).filter(include);
  const failedSections: string[] = [];
  const sections: Record<string, unknown> = {};
  const failed = Symbol("failed section");
  for (const namespace of pieceNamespaces) {
    const section = guardPiece("snapshotSections", namespace, () => lists.snapshotSections[namespace](caller, view), failed);
    if (section === failed) failedSections.push(namespace);
    else if (section !== undefined) sections[namespace] = section;
  }
  // The engine portion contains identities and wait state. The client read
  // unit adds bounded display projections; no prompt or account value belongs here.
  const source = (agentId: string, tag: string, id: string) => [...(view.threads[agentId] ?? [])].reverse()
    .find(({ event }) => event._tag === tag && ("permissionRequestId" in event ? event.permissionRequestId === id : "questionId" in event && event.questionId === id));
  const requests = filter(view.requests, (row) => row.status === "open" && readable(row.agentId)).map((row) => ({
    id: row.permissionRequestId, agentId: row.agentId, holder: row.holder,
    sourceSequence: source(row.agentId, "PermissionRequested", row.permissionRequestId)?.sequence ?? 0,
  }));
  const questions = filter(view.questions, (row) => row.status === "open" && readable(row.agentId)).map((row) => ({
    id: row.questionId, agentId: row.agentId, holder: row.holder,
    sourceSequence: source(row.agentId, "QuestionAsked", row.questionId)?.sequence ?? 0,
  }));
  const withDisplays = (rows: typeof requests, tag: string) => {
    const newest = new Set([...rows].sort((a, b) => b.sourceSequence - a.sourceSequence).slice(0, 256).map((row) => row.id));
    return rows.map((row) => {
      const envelope = caller._tag !== "agent" && newest.has(row.id) ? source(row.agentId, tag, row.id) : undefined;
      const part = envelope === undefined ? undefined : display(envelope);
      return { ...row, ...(part === undefined ? {} : { display: part }) };
    });
  };
  const requestRows = withDisplays(requests, "PermissionRequested");
  const questionRows = withDisplays(questions, "QuestionAsked");
  return {
    sequence: view.sequence,
    agents: roster(caller, view).map((row) => ({
      ...row, name: cutUtf8(row.name, 64), groups: cutGroups(row.groups),
      ...(caller._tag !== "agent" ? { capacityHeld: view.agents[row.agentId]?.capacityHeld === true } : {}),
      ...(row.parentName === undefined ? {} : { parentName: cutUtf8(row.parentName, 64) }),
      ...(caller._tag !== "agent" && view.agents[row.agentId]?.reloadable !== undefined ? { reloadable: view.agents[row.agentId]!.reloadable } : {}),
    })),
    requests: requestRows, questions: questionRows,
    requestsWithoutDisplay: requestRows.filter((row) => row.display === undefined).length,
    questionsWithoutDisplay: questionRows.filter((row) => row.display === undefined).length,
    ...(caller._tag !== "agent" ? {
      accounts: Object.values(view.accounts).map((row) => ({
        id: row.id, status: row.status, enabled: row.enabled,
        environment: Object.entries(row.environment ?? {}).map(([name, value]) => ({ name, secret: value.startsWith("secret:") })),
      })),
      waitState: {
        deliveries: filter(view.deliveries, (row) => row.status === "queued" || row.status === "sent").map((row) => ({
          id: row.id, target: row.target, status: row.status, ...(row.source === undefined ? {} : { source: row.source._tag }),
        })),
        waits: filter(view.waits, (row) => row.status === "open" && !row.blocking).map((row) => ({ agentId: row.agentId, waitId: row.waitId })),
      },
    } : {}),
    ...sections,
    ...(failedSections.length === 0 ? {} : { failedSections }),
  };
});
