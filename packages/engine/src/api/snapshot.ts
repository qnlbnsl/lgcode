import type { Actor } from "@shephrd/contracts";
import { pieceNamespaces } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import { engineLists, type EngineLists } from "../pieces/lists.ts";
import { guardPiece } from "../pieces/guardPiece.ts";
import { Views } from "../views/Views.ts";
import { mayReadAgent } from "./visibility.ts";

export const snapshot = (caller: Actor, lists: EngineLists = engineLists) => Effect.gen(function* () {
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
  const sourceSequence = (agentId: string, tag: string, id: string) => [...(view.threads[agentId] ?? [])].reverse()
    .find(({ event }) => event._tag === tag && ("permissionRequestId" in event ? event.permissionRequestId === id : "questionId" in event && event.questionId === id))?.sequence;
  const requests = filter(view.requests, (row) => row.status === "open" && readable(row.agentId)).map((row) => ({
    id: row.permissionRequestId, agentId: row.agentId, holder: row.holder,
    sourceSequence: sourceSequence(row.agentId, "PermissionRequested", row.permissionRequestId),
  }));
  const questions = filter(view.questions, (row) => row.status === "open" && readable(row.agentId)).map((row) => ({
    id: row.questionId, agentId: row.agentId, holder: row.holder,
    sourceSequence: sourceSequence(row.agentId, "QuestionAsked", row.questionId),
  }));
  return {
    sequence: view.sequence,
    agents: filter(view.agents, (row) => readable(row.agentId)).map(({ reloadable, ...row }) => ({
      ...row, ...(caller._tag === "owner" && reloadable !== undefined ? { reloadable } : {}),
    })),
    requests, questions,
    ...(caller._tag === "owner" ? {
      accounts: Object.values(view.accounts).map((row) => ({
        id: row.id, harness: row.harness, displayName: row.displayName, status: row.status, enabled: row.enabled,
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
