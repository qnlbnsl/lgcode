import { expect, it } from "vitest";
import { pieceViews } from "../../../src/pieces/viewTables.ts";
import { emptyViews } from "../../../src/views/apply.ts";
import { event, envelopes } from "../fixtures.ts";

it("S01 rebuilds the sheepdog baseline position from its event sequence", () => {
  const baseline = event({ _tag: "roles.SheepdogBaseline", position: 4, on: true });
  const envelope = envelopes([baseline])[0]!;
  const live = pieceViews.roles.reduce(pieceViews.roles.empty(), baseline as any, 1) as any;
  expect(live.position).toBe(4);
  let projected = emptyViews().roles;
  projected = pieceViews.roles.reduce(projected, envelope.event as any, envelope.sequence) as any;
  expect(projected).toEqual(live);
});

it("S02 replay ignores envelope fields other than the event and sequence", () => {
  const baseline = event({ _tag: "roles.SheepdogBaseline", position: 4, on: true });
  const [row] = envelopes([baseline]);
  const reduce = pieceViews.roles.reduce;
  const plain = reduce(pieceViews.roles.empty(), row!.event as any, row!.sequence);
  const placeholderEnvelope = { ...row!, occurredAt: -1, caller: { _tag: "owner" }, requestId: "placeholder" };
  const replayed = reduce(pieceViews.roles.empty(), placeholderEnvelope.event as any, placeholderEnvelope.sequence);
  expect(replayed).toEqual(plain);
});

it("S03 a baseline with the sheepdog off closes open crash work in the view", () => {
  const views = pieceViews.roles;
  const agentStart = event({ _tag: "AgentStarted", agentId: "worker", name: "worker", role: "worker", groups: [], parent: { _tag: "owner" }, harness: "test", account: "test", permission: "ask", folder: "/tmp", runMode: "acp", model: "test", effort: "high" });
  const admitted = event({ _tag: "roles.CrashAdmitted", agentId: "worker", noticeRecipient: "owner", triggerSequence: 2, sourceSequence: 2, occurrence: 1, notice: "board-off" });
  const off = event({ _tag: "roles.SheepdogBaseline", position: 3, on: false });
  let state = views.empty();
  state = views.reduce(state, agentStart as any, 1);
  state = views.reduce(state, admitted as any, 2);
  state = views.reduce(state, off as any, 3) as any;
  expect((state as any).agents.worker.openCrash).toBeUndefined();
});
