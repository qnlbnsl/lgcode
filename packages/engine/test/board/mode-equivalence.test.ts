import { expect, it } from "vitest";

import { holdsIncoming, holdsUnsettled } from "@shephrd/contracts/board/conditions";
import { buildWake } from "../../src/board/wake.ts";
import { canReach } from "../../src/routing/reach.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { agentIdOf } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { board, event, plain, post, snapshot, tree } from "./accessFixtures.ts";
import { queue, wake } from "./fixtures.ts";

registerRebuildCheck({ noLog: true });

it("6.4 a recorded interactive member has the same membership, wake and wait behavior as an ACP member", () => {
  const histories = ["acp", "interactive"].map((runMode) => {
    const agents = tree.map((row) => row._tag === "AgentStarted" && row.agentId === "worker" ? event({ ...row, runMode }) : row);
    return snapshot(...agents, plain, post("question"), wake("wake", { carried: ["question"], mustReply: ["question"] }), queue("wake"));
  });
  const observations = histories.map((view) => ({
    board: board(view),
    reachable: canReach({ snapshot: view, target: "worker", deliveryId: "delivery-wake", source: { _tag: "piece", namespace: "board", id: "wake" } }, engineLists),
    unsettled: holdsUnsettled("worker", board(view), view.deliveries),
    incoming: holdsIncoming("worker", board(view)),
  }));
  expect(histories[1]!.agents.worker?.runMode).toBe("interactive");
  // The engine's queued delivery holds the target, so the board's extra
  // unsettled condition is false while that wake remains in the queue.
  expect(observations[0]).toMatchObject({ reachable: true, unsettled: false, incoming: true });
  expect(observations[1]).toEqual(observations[0]);
  const wakes = ["acp", "interactive"].map((runMode) => {
    const agents = tree.map((row) => row._tag === "AgentStarted" && row.agentId === "worker" ? event({ ...row, runMode }) : row);
    const built = buildWake(snapshot(...agents, plain, post("question")), agentIdOf("worker"));
    expect(built).toBeDefined();
    const { wakeId: _wakeId, ...manifest } = built!.event;
    const { sourceId: _sourceId, ...delivery } = built!.delivery;
    const marker = /^Data \[([^\]]+)\]$/m.exec(delivery.body)![1]!;
    expect(delivery.body).toContain(`End data [${marker}]`);
    return { manifest, delivery: { ...delivery, body: delivery.body.replaceAll(marker, "marker") } };
  });
  expect(wakes[0]!.manifest).toMatchObject({ carried: ["question"], mustReply: ["question"] });
  expect(wakes[1]).toEqual(wakes[0]);
});
