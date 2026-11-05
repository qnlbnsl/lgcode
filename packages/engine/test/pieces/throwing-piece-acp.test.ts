import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it, vi } from "vitest";
import * as Server from "../../src/api/server.ts";
import type { EngineLists } from "../../src/pieces/lists.ts";
import * as AcpRunner from "../../src/runner/AcpRunner.ts";
import { compareViews } from "../../src/views/compare.ts";
import { fixtureClient, fixtureLists, loadLists, withFixture } from "../support/fixturePiece.ts";
import { accountFor, alive, echoFile, harnessFor, makeRunnerRig, readEcho, removeRunnerRig, serviceEnvironment, startPayloadFor, writeFakeAdapter } from "../support/acpRunnerRig.ts";
import { appendSetup, eventOf, freshRequest, makeFakeSecrets } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { provideRestart, recover } from "../support/restartRig.ts";
import { eventually, snapshot } from "../support/routingRig.ts";

it("FR-078 real ACP permissions, socket commands, stop and recovered reload survive a throwing piece", async () => {
  const rig = { ...makeRunnerRig(), outside: "/unused" };
  const base = fixtureLists(await loadLists());
  const lists = { ...base, reactors: {}, views: { ...base.views, client: { ...base.views.client!, reduce() { throw new TypeError("Private piece fault."); } } } };
  const runnerLayer = () => AcpRunner.layer({ socketPath: rig.socket, stateFolder: rig.stateFolder, environment: serviceEnvironment(rig) }).pipe(
    Layer.provide(Layer.merge(NodeServices.layer, makeFakeSecrets().layer)),
  );
  const harness = harnessFor("real-fixture", writeFakeAdapter(rig));
  const stoppedEcho = echoFile(rig);
  const survivingEcho = echoFile(rig);
  const reloadEcho = echoFile(rig);
  const options = [{ optionId: "once", name: "Allow once", kind: "allow_once" }];
  const permission = (toolCallId: string) => ({ step: "permission", toolCallId, title: "Fixture permission", options });
  const firstAccount = accountFor(harness.id, { protocolVersion: 1, turns: [[permission("answer-tool"), permission("stop-tool")]] }, stoppedEcho);
  const nextAccount = accountFor(harness.id, { protocolVersion: 1, turns: [[permission("recover-tool")]] }, survivingEcho);
  const pieceRequest = freshRequest();
  let pieceReply: unknown;
  let stopped = "";
  let surviving = "";
  let pendingId = "";
  let beforeClose: unknown;
  try {
    await withFixture(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* Server.serve({ socketPath: rig.socket, ownerCredential: Redacted.make("fixture-owner-bearer"), debug: false, lists });
      const owner = yield* fixtureClient(rig.socket, "fixture-owner-bearer", lists);
      yield* appendSetup([eventOf({ _tag: "HarnessChanged", harness }), eventOf({ _tag: "AccountChanged", accountId: "primary", account: firstAccount })]);
      pieceReply = yield* owner["client.record"]!({ requestId: pieceRequest, id: "durable-acp", text: "Durable piece request." });
      const a = yield* owner.start!({ ...startPayloadFor(harness, firstAccount, rig.work), requestId: freshRequest() });
      stopped = a.agentId as string;
      yield* owner.prompt!({ requestId: freshRequest(), agentId: stopped, text: "Exercise real adapter permissions." });
      const requests = (tool: string) => snapshot.pipe(Effect.map((state) => Object.values(state.requests).find((row) => row.agentId === stopped && row.toolCallId === tool)));
      const answered = yield* eventually(requests("answer-tool"), (row) => row?.status === "open");
      expect(answered?.status).toBe("open");
      yield* owner.answer!({ requestId: freshRequest(), kind: "permission", id: answered!.permissionRequestId, optionId: "once" });
      expect((yield* eventually(requests("stop-tool"), (row) => row?.status === "open"))?.status).toBe("open");
      yield* owner.stop!({ requestId: freshRequest(), agentId: stopped });
      expect((yield* requests("answer-tool"))?.status).toBe("answered");
      expect((yield* requests("stop-tool"))?.status).toBe("cancelled");
      const echo = yield* readEcho(stoppedEcho, (value) => value.inbound.some((frame) => frame.result?.outcome?.optionId === "once"));
      expect(echo.inbound.some((frame) => frame.result?.outcome?.optionId === "once")).toBe(true);
      expect(yield* eventually(Effect.sync(() => alive(echo.pid)), (running) => !running)).toBe(false);
      yield* appendSetup([eventOf({ _tag: "AccountChanged", accountId: "primary", account: nextAccount })]);
      const b = yield* owner.start!({ ...startPayloadFor(harness, nextAccount, rig.work, { name: "Survivor" }), requestId: freshRequest() });
      surviving = b.agentId as string;
      yield* owner.prompt!({ requestId: freshRequest(), agentId: surviving, text: "Continue after reopening." });
      const pending = yield* eventually(snapshot.pipe(Effect.map((state) => Object.values(state.requests).find((row) => row.agentId === surviving && row.toolCallId === "recover-tool"))), (row) => row?.status === "open");
      expect(pending?.status).toBe("open");
      pendingId = pending!.permissionRequestId;
      // Only the next spawn gets this script; the live adapter stays paused at
      // its permission request until the service scope closes it.
      yield* appendSetup([eventOf({ _tag: "AccountChanged", accountId: "primary", account: accountFor(harness.id, { protocolVersion: 1, turns: [[]] }, reloadEcho) })]);
      expect((yield* snapshot).client).toEqual({ records: [] });
      expect((yield* compareViews()).differences).toEqual([]);
      beforeClose = yield* snapshot;
    }), { rig, runner: { layer: runnerLayer() } });
    vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
    await Effect.runPromise(provideRestart(rig, runnerLayer(), Effect.gen(function* () {
      yield* registerRebuildCheck();
      expect(yield* snapshot).toEqual(beforeClose);
      yield* recover;
      const state = yield* snapshot;
      expect(state.agents[stopped]?.state._tag).toBe("stopped");
      expect(state.requests[pendingId]?.status).toBe("cancelled");
      expect(state.client).toEqual({ records: [] });
      const echo = yield* readEcho(reloadEcho, (value) => value.inbound.some((frame) => frame.method === "session/load"));
      expect(echo.inbound.filter((frame) => frame.method === "session/load")).toHaveLength(1);
      yield* Server.serve({ socketPath: rig.socket, ownerCredential: Redacted.make("fixture-owner-bearer"), debug: false, lists });
      const owner = yield* fixtureClient(rig.socket, "fixture-owner-bearer", lists);
      const sql = yield* SqlClient.SqlClient;
      const durableBefore = yield* sql`SELECT * FROM events WHERE event_type = 'client.FixtureRecorded'`;
      expect(yield* owner["client.record"]!({ requestId: pieceRequest, id: "durable-acp", text: "Durable piece request." })).toEqual(pieceReply);
      expect(yield* sql`SELECT * FROM events WHERE event_type = 'client.FixtureRecorded'`).toEqual(durableBefore);
      expect(yield* sql`SELECT id FROM client_fixture`).toEqual([{ id: "durable-acp" }]);
      expect((yield* compareViews()).differences).toEqual([]);
    }), { lists: lists as unknown as EngineLists }) as Effect.Effect<void, unknown>);
  } finally {
    vi.unstubAllEnvs();
    removeRunnerRig(rig);
  }
});
