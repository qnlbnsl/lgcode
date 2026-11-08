import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { it } from "@effect/vitest";
import type { ClientStreamItem } from "@lgcode/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { serve } from "../../src/api/server.ts";
import { dispatchQueued } from "../../src/routing/deliveries.ts";
import { agentIdOf, appendSetup, eventOf, freshRequest, makeRig, readLog, removeRig, type Rig } from "../support/handlerRig.ts";
import { currentIncarnation } from "../support/fakeRunner.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually } from "../support/routingRig.ts";
import { connect } from "../support/socketClient.ts";
import { agent, provideBoard, queued, seedBoard, snapshot } from "../board/wakeFixtures.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });

// Park automatic followers so label removal always precedes the dispatcher's
// send-time check. Commands and reads still cross the authenticated socket.
for (const phase of ["catch-up", "live"] as const) {
  it.live(`6.3 ${phase}: a withdrawn group wake is hidden on every agent read, while the owner's thread retains it`, () => provideBoard(rig, (runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const credentials = yield* seedBoard();
    const socket = join(rig.stateFolder, "privacy.sock");
    const bearer = randomBytes(32).toString("base64url");
    yield* serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false });
    const owner = yield* connect(socket, bearer);
    const agents: Array<{ id: string; client: Effect.Success<ReturnType<typeof connect>> }> = [];
    for (const id of ["worker", "lead", "other"]) {
      const credential = credentials[id]!;
      if (credential._tag !== "agent") throw new Error("Expected an agent credential");
      agents.push({ id, client: yield* connect(socket, Redacted.value(credential.token)) });
    }
    const collectors: Array<Fiber.Fiber<ClientStreamItem[], unknown>> = [];
    const collect = () => Effect.gen(function* () {
      for (const { id, client } of agents) for (const command of ["subscribe", "client.subscribe"] as const) {
        const ready = yield* Deferred.make<void>();
        const stream: Stream.Stream<ClientStreamItem, unknown> = client[command]({ requestId: freshRequest(), after: 0 as never });
        const fiber = yield* stream.pipe(
          Stream.tap(() => Deferred.succeed(ready, undefined)),
          Stream.takeUntil((row) => "event" in row && row.event._tag === "ThreadItem" && row.event.itemId === `boundary-${id}`),
          Stream.runCollect, Effect.timeout(10_000), Effect.forkChild,
        );
        collectors.push(fiber);
        yield* Deferred.await(ready);
      }
    });
    if (phase === "live") yield* collect();

    yield* owner.group({ requestId: freshRequest(), agentId: agentIdOf("worker"), add: ["review"], remove: [] });
    const { channelId } = yield* owner["board.open"]({ requestId: freshRequest(), name: "private-review", group: "review", anchorAgentId: agentIdOf("lead") });
    const text = "Withdrawn wake marker: never sent to this agent.";
    const { postId } = yield* owner["board.post"]({ requestId: freshRequest(), channelId, text, to: [agent("worker")], reply: "all" } as never);
    const [wake] = yield* queued("worker");
    expect(wake).toBeDefined();
    expect(JSON.stringify(wake)).toContain(text);
    yield* owner.group({ requestId: freshRequest(), agentId: agentIdOf("worker"), add: [], remove: ["review"] });
    // The board reactor has not cleaned up: this withdrawal must be the
    // dispatcher's own reach check, rather than a prior lifecycle scan.
    expect((yield* snapshot).deliveries[wake!.id]?.status).toBe("queued");
    yield* dispatchQueued(agentIdOf("worker"));
    expect((yield* snapshot).deliveries[wake!.id]?.status).toBe("withdrawn");
    expect(runner.callsOf("prompt")).toEqual([]);

    yield* appendSetup(agents.map(({ id }) => eventOf({ _tag: "ThreadItem", agentId: id,
      itemId: `boundary-${id}`, content: { _tag: "text", text: "Visible stream boundary." }, replay: false })));
    if (phase === "catch-up") yield* collect();
    for (const fiber of collectors) {
      const rows = yield* Fiber.join(fiber);
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toContain(text);
      expect(rows.some((row) => "event" in row && row.event._tag.startsWith("board."))).toBe(false);
    }

    const history = yield* readLog;
    const boardEvents = history.filter((row) => row.event._tag.startsWith("board."));
    const queuedEvent = history.find((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.id === wake!.id)!;
    for (const { client } of agents) {
      const snapshot = yield* client["client.snapshot"]({ requestId: freshRequest() });
      expect(snapshot).not.toHaveProperty("board");
      expect(JSON.stringify(snapshot)).not.toContain(text);
      for (const row of [...boardEvents, queuedEvent]) {
        expect((yield* client["client.event"]({ requestId: freshRequest(), sequence: row.sequence } as never).pipe(Effect.exit))._tag).toBe("Failure");
      }
    }
    for (const { client } of agents.slice(0, 2)) {
      const page = yield* client["client.thread"]({ requestId: freshRequest(), agentId: agentIdOf("worker"), after: 0 as never, limit: 200 });
      expect(JSON.stringify(page)).not.toContain(text);
    }
    const outsider = agents[2]!.client;
    expect((yield* outsider["board.read"]({ requestId: freshRequest(), post: postId } as never).pipe(Effect.exit))._tag).toBe("Failure");
    expect((yield* outsider["board.status"]({ requestId: freshRequest(), agentId: agentIdOf("worker") }).pipe(Effect.exit))._tag).toBe("Failure");
    expect((yield* outsider["board.channels"]({ requestId: freshRequest() })).items.map((row) => row.channelId)).not.toContain(channelId);
    expect((yield* outsider["client.thread"]({ requestId: freshRequest(), agentId: agentIdOf("worker"), after: 0 as never, limit: 200 }).pipe(Effect.exit))._tag).toBe("Failure");
    const ownerThread = yield* owner["client.thread"]({ requestId: freshRequest(), agentId: agentIdOf("worker"), after: 0 as never, limit: 200 });
    expect(JSON.stringify(ownerThread)).toContain(text);

    // Positive control: a member's own words can quote a delivered direct
    // message, and its parent is allowed to read that thread.
    const directText = "Direct message quoted by its recipient.";
    const direct = yield* agents[1]!.client["board.post"]({ requestId: freshRequest(), direct: agent("worker"), text: directText, to: [agent("worker")], reply: "all" } as never);
    const [directWake] = yield* queued("worker");
    yield* dispatchQueued(agentIdOf("worker"));
    expect(runner.callsOf("prompt").some((row) => row.input.delivery.id === directWake!.id && JSON.stringify(row.input.delivery).includes(directText))).toBe(true);
    yield* runner.emit({ _tag: "deliveryUpdate", agentId: agentIdOf("worker"), incarnation: yield* currentIncarnation("worker"),
      deliveryId: directWake!.id, kind: "message", text: directText, content: { _tag: "text", text: directText }, replay: false });
    yield* eventually(readLog, (rows) => rows.some((row) => row.event._tag === "ThreadItem" && row.event.agentId === "worker"
      && row.event.content._tag === "text" && row.event.content.text === directText));
    for (const { client } of agents.slice(0, 2)) {
      const page = yield* client["client.thread"]({ requestId: freshRequest(), agentId: agentIdOf("worker"), after: 0 as never, limit: 200 });
      expect(JSON.stringify(page)).toContain(directText);
    }
    expect(JSON.stringify(yield* agents[0]!.client["board.read"]({ requestId: freshRequest(), post: direct.postId } as never))).toContain(directText);
    expect((yield* outsider["board.read"]({ requestId: freshRequest(), post: direct.postId } as never).pipe(Effect.exit))._tag).toBe("Failure");
  })).pipe(Effect.orDie));
}
