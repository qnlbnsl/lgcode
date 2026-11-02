// Criterion 7.12 (unit 7a; rows 23, 62, 74): `debug.compare-views` exists
// only when the service runs with `SHEPHRD_TEST_DEBUG=1`, is owner-only,
// and returns no difference after a flow. "Exists" is read as served: without
// the flag the request tag is unknown to the server (a defect from Effect
// RPC, "Unknown request tag"), which differs from a refusal (`CommandError`).
// The service is a real child process whose state folder is under /tmp, its
// temporary folder.
import { afterEach, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";

import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { connect } from "../support/socketClient.ts";
import {
  agentToken, compareViews, kindOf, makeServiceRoot, ownerClient, requestId, startFakeAgent, startService, stopAllServices, turnEnded, waitServing,
  type ServiceRoot,
} from "../support/serviceProcess.ts";

registerRebuildCheck({ noLog: true });

// Every requirement is provided inside the test; the cast keeps the missing
// production modules from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>, timeout: number) =>
  it.live(name, () => test() as Effect.Effect<void, unknown, never>, timeout);
afterEach(async () => { await stopAllServices(); });

const flow = (root: ServiceRoot) => Effect.scoped(Effect.gen(function* () {
  const owner = yield* ownerClient(root);
  const agent = yield* startFakeAgent(root, owner, owner, {
    script: { turns: [[{ step: "text", text: "Working." }, { step: "end_turn", stopReason: "end_turn" }]] },
    prompt: "Do one turn.",
  });
  yield* turnEnded(owner, agent.agentId);
  return agent;
}));

live("7.12 with SHEPHRD_TEST_DEBUG=1 the owner's debug.compare-views reports no difference at the current head after a flow, and an agent is refused (breaks if the RPC compares stale views, is not served under the flag, or is callable by an agent)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    const service = startService(root, { env: { SHEPHRD_TEST_DEBUG: "1" } });
    yield* waitServing(root, service);
    const agent = yield* flow(root);
    const token = (yield* agentToken(agent)).token;
    yield* Effect.scoped(Effect.gen(function* () {
      const owner = yield* ownerClient(root);
      const exit = yield* compareViews(owner);
      expect(kindOf(exit)).toBe("success");
      const result = (exit as Exit.Success<{ sequence: number; equal: boolean; differences: ReadonlyArray<string> }>).value;
      expect(result.equal).toBe(true);
      expect(result.differences).toEqual([]);
      expect(result.sequence).toBeGreaterThan(0);
      const asAgent = yield* connect(root.socket, token);
      expect(kindOf(yield* compareViews(asAgent))).toBe("refused");
    }));
  }), 120_000);

live("7.12 without SHEPHRD_TEST_DEBUG=1, including with any other value, debug.compare-views is not served at all, to the owner either (breaks if the debug group is always served and only refused, or any truthy value turns it on)", () =>
  Effect.gen(function* () {
    for (const value of [undefined, "0", "true", "yes", " 1"]) {
      const root = makeServiceRoot();
      const service = startService(root, { env: { SHEPHRD_TEST_DEBUG: value } });
      yield* waitServing(root, service);
      yield* Effect.scoped(Effect.gen(function* () {
        const owner = yield* ownerClient(root);
        expect([String(value), kindOf(yield* compareViews(owner))]).toEqual([String(value), "not served"]);
        // The rest of the service is served normally.
        yield* owner.harnesses({ requestId: requestId(), operation: "list" } as never);
      }));
      expect(service.output()).not.toContain("debug RPC group enabled");
    }
  }), 180_000);
