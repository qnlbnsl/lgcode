// The whole journey in one service. The first scenario follows the spec's
// "One request, start to finish" (docs/specs/2026-11-01-engine-design.md), all
// eight steps, with an explicit observation per link. The second keeps the
// owner's stop, resume and hard-restart journey: the lead stops and resumes its
// worker, answers its second request, the service is killed, and the history is
// still there. Criteria 8.3 to 8.5.
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect } from "@effect/vitest";
import type { EventEnvelope } from "@shephrd/contracts";
import * as Effect from "effect/Effect";

import {
  alive, eventsUntil, isTag, peekEcho, promptsOf, refusal, requestId, scenario, since, stopAllServices, tagged, threadText, waitFor,
} from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

const options = [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }];

type Actor = { _tag: string; agentId?: string };
const eventOf = <T>(envelope: EventEnvelope): T => envelope.event as unknown as T;
// The responses the adapter received for its own requests (the permission answer).
const responsesTo = (echoFile: string) => (peekEcho(echoFile)?.inbound ?? []).filter((frame) => (frame as { result?: unknown }).result !== undefined);

scenario("flow (spec steps 1 to 8): the lead starts a worker with its own token, the worker's permission request goes to the lead, the lead passes it up, the owner answers from a second connection, a later answer is refused, and the lead, which waited before the worker finished, is woken exactly once (breaks if any link of 'one request, start to finish' is missing: parent, account, token, tool grant, sender, live view, routing, pass-up, owner alert, first answer wins, wake)", (w) => Effect.gen(function* () {
  // The lead's second turn (the routed permission request) is held open until the test releases it.
  const gate = join(w.root.root, "gate-lead");
  const lead = yield* w.start(w.owner, {
    name: "Lead", role: "lead", permission: "edit", prompt: "Plan the work.",
    script: { turns: [[], [{ step: "wait_for_file", path: gate }], []] },
  });
  yield* eventsUntil(w.owner, 0, "the lead's first turn", isTag("TurnEnded", lead.agentId));
  const leadToken = (yield* w.token(lead)).token;
  const leadClient = yield* w.asAgent(leadToken);
  const watcher = yield* w.reopenOwner();
  const phone = yield* w.reopenOwner();
  const mark = yield* w.watermark();

  // Step 1: the lead asks, with its own token, for a worker on any account of the harness, in a
  // folder, in the group "auth", asking before every change, with a first prompt.
  const folder = join(realpathSync(w.root.work), "project");
  mkdirSync(folder);
  const prepared = yield* w.prepare({
    name: "Worker", role: "worker", permission: "ask", groups: ["auth"], folder, anyAccount: true, prompt: "Write the file.",
    script: { turns: [[{ step: "text", text: "starting the write. " }, { step: "permission", toolCallId: "call-flow", title: "Write the file", options }, { step: "text", text: "file written" }]] },
  });

  // Step 2: the command handler checks. A mode wider than the lead's own is refused, and nothing starts.
  const tooWide = yield* refusal(leadClient.start({ ...prepared.request, requestId: requestId(), permission: "full" } as never));
  expect(tooWide, "a permission mode wider than the lead's own was accepted").toBeDefined();
  expect(tagged(yield* since(w.owner, mark), "AgentStarted"), "a refused start still started an agent").toHaveLength(0);
  const started = (yield* leadClient.start(prepared.request as never)) as unknown as { agentId: string };
  const worker = { agentId: started.agentId, echo: prepared.echo, accountId: prepared.accountId };
  // An identical replay of the same request is the same result, not a second agent.
  const replay = (yield* leadClient.start(prepared.request as never)) as unknown as { agentId: string };
  expect(replay.agentId, "an identical replay of a start made a second agent").toBe(worker.agentId);
  const afterStart = yield* since(w.owner, mark);
  const startedEvents = tagged(afterStart, "AgentStarted");
  expect(startedEvents, "the start was recorded other than once").toHaveLength(1);
  expect(startedEvents[0]!.agentId).toBe(worker.agentId);
  const recorded = eventOf<{ parent: Actor; account: string; groups: string[]; permission: string; folder: string; firstPromptDelivery?: unknown }>(startedEvents[0]!);
  expect(recorded.parent, "the worker's recorded parent is not the lead").toEqual({ _tag: "agent", agentId: lead.agentId });
  expect(recorded.account, "the engine picked another account than the only unused one of the harness").toBe(worker.accountId);
  expect(recorded.groups).toEqual(["auth"]);
  expect(recorded.permission).toBe("ask");
  expect(recorded.folder).toBe(folder);
  expect(recorded.firstPromptDelivery, "the first prompt was not queued with the start").toBeDefined();

  // Step 3: the runner starts the worker with its own token and the tools, and opens a session.
  const workerEcho = (yield* w.token(worker)).echo;
  const workerToken = workerEcho.env.SHEPHRD_TOKEN!;
  expect(workerToken, "the worker was given the lead's token").not.toBe(leadToken);
  expect(workerEcho.env.SHEPHRD_SOCKET, "the worker's tools do not reach this service").toBe(w.root.socket);
  expect(workerEcho.env.FAKE_AGENT_ECHO, "the account's own variables did not reach the adapter").toBe(worker.echo);
  const opened = tagged(yield* eventsUntil(w.owner, mark, "the worker's session", isTag("SessionOpened", worker.agentId)), "SessionOpened", worker.agentId);
  expect(opened, "no session was recorded for the worker").toHaveLength(1);
  const sessionNew = (peekEcho(worker.echo)!.inbound.find((frame) => frame.method === "session/new")?.params ?? {}) as { cwd?: string; mcpServers?: Array<{ name: string; env: Array<{ name: string; value: string }> }> };
  expect(sessionNew.cwd, "the session was opened in another folder").toBe(folder);
  expect(sessionNew.mcpServers?.map((server) => server.name), "the worker was not given Shephrd's tools").toEqual(["shephrd"]);
  const grant = Object.fromEntries(sessionNew.mcpServers![0]!.env.map((entry) => [entry.name, entry.value]));
  expect(Object.keys(grant).sort()).toEqual(["SHEPHRD_SOCKET", "SHEPHRD_TOKEN"]);
  expect(grant.SHEPHRD_TOKEN, "the tools carry another token than the worker's").toBe(workerToken);
  // The worker's token works as the worker's own: it can see only what it holds.
  const workerClient = yield* w.asAgent(workerToken);
  expect(yield* refusal(workerClient.wait({ requestId: requestId(), members: [lead.agentId], mode: "all", block: false } as never)),
    "the worker could wait on its own lead").toBeDefined();

  // Step 4: the first prompt is recorded as sent by the lead, and a second owner connection
  // sees the streamed work while the worker is still waiting on its permission.
  const first = (recorded.firstPromptDelivery as { id: string; target: string; sender: Actor; content: { text: string } });
  expect(first.sender, "the first prompt is not recorded as sent by the lead").toEqual({ _tag: "agent", agentId: lead.agentId });
  expect(first.content.text).toContain("Write the file.");
  yield* eventsUntil(w.owner, mark, "the first prompt to be taken", (envelope) =>
    envelope.event._tag === "DeliveryAccepted" && envelope.agentId === worker.agentId
    && (envelope.event as unknown as { deliveryId: string }).deliveryId === first.id);
  expect(promptsOf(peekEcho(worker.echo)!)[0], "the adapter did not receive the first prompt").toContain("Write the file.");
  const live = yield* eventsUntil(watcher, mark, "the worker's streamed text on the second connection", (envelope) =>
    envelope.event._tag === "ThreadItem" && envelope.agentId === worker.agentId);
  expect(threadText(live, worker.agentId)).toContain("starting the write.");
  expect(tagged(live, "TurnEnded", worker.agentId), "the worker finished before its permission was answered").toHaveLength(0);

  // Step 5: the permission request is held by the lead.
  const requested = tagged(yield* eventsUntil(w.owner, mark, "the permission request", isTag("PermissionRequested", worker.agentId)), "PermissionRequested", worker.agentId);
  expect(requested).toHaveLength(1);
  const request = eventOf<{ permissionRequestId: string; holder: Actor }>(requested[0]!);
  expect(request.holder, "the request did not go to the worker's lead").toEqual({ _tag: "agent", agentId: lead.agentId });

  // Step 6: the routed prompt reaches the lead's adapter. The lead opens its wait on the worker
  // (earlier than the finish), then passes the request up.
  const routed = yield* waitFor("the routed permission request in the lead's adapter", () =>
    promptsOf(peekEcho(lead.echo)!).find((text) => text.includes(`Permission request ${request.permissionRequestId} from agent ${worker.agentId}`)));
  expect(routed).toContain("Write the file");
  const wait = (yield* leadClient.wait({ requestId: requestId(), members: [worker.agentId], mode: "all", block: false } as never)) as unknown as { waitId: string; outcome: string };
  expect(wait.outcome, "the wait on a worker that was still working did not stay open").toBe("opened");
  const passMark = yield* w.watermark();
  yield* leadClient["pass-up"]({ requestId: requestId(), subject: { _tag: "permission", id: request.permissionRequestId } } as never);
  const passed = yield* eventsUntil(w.owner, passMark, "the owner to be told", isTag("OwnerNeeded", worker.agentId));
  const moved = tagged(passed, "PermissionMoved", worker.agentId);
  expect(moved).toHaveLength(1);
  expect(eventOf<{ from: Actor; to: Actor }>(moved[0]!)).toMatchObject({ from: { _tag: "agent", agentId: lead.agentId }, to: { _tag: "owner" } });
  const alerts = tagged(passed, "OwnerNeeded", worker.agentId);
  expect(alerts, "the owner was not told exactly once").toHaveLength(1);
  expect(eventOf<{ subject?: unknown }>(alerts[0]!).subject).toEqual({ _tag: "permission", id: request.permissionRequestId });
  writeFileSync(gate, "go");

  // Step 7: the owner answers Allow from a second connection; the adapter gets it; the first answer wins.
  yield* phone.answer({ requestId: requestId(), kind: "permission", id: request.permissionRequestId, optionId: "allow-once" } as never);
  const reached = yield* waitFor("the answer in the worker's adapter", () => (responsesTo(worker.echo).length > 0 ? responsesTo(worker.echo) : undefined));
  expect(reached, "the adapter did not get exactly one answer").toHaveLength(1);
  expect((reached[0] as unknown as { result: { outcome: unknown } }).result.outcome).toMatchObject({ outcome: "selected", optionId: "allow-once" });
  expect(yield* refusal(phone.answer({ requestId: requestId(), kind: "permission", id: request.permissionRequestId, optionId: "allow-once" } as never)),
    "a second answer from the owner was accepted").toBeDefined();
  expect(yield* refusal(leadClient.answer({ requestId: requestId(), kind: "permission", id: request.permissionRequestId, optionId: "allow-once" } as never)),
    "an answer from the lead was accepted after the owner's").toBeDefined();

  // Step 8: the worker finishes; the lead is woken exactly once, with the result.
  const finished = yield* eventsUntil(w.owner, mark, "the worker's turn", isTag("TurnEnded", worker.agentId));
  expect(threadText(finished, worker.agentId)).toContain("permission:selected:allow-once");
  const woken = yield* waitFor("the wake in the lead's adapter", () => (promptsOf(peekEcho(lead.echo)!).length >= 3 ? promptsOf(peekEcho(lead.echo)!) : undefined));
  yield* Effect.sleep(1_000);
  const all = yield* since(w.owner, mark);
  const answers = tagged(all, "PermissionAnswered", worker.agentId);
  expect(answers, "the request was answered other than once").toHaveLength(1);
  expect(eventOf<{ answeredBy: Actor }>(answers[0]!).answeredBy).toEqual({ _tag: "owner" });
  const satisfied = tagged(all, "WaitSatisfied");
  expect(satisfied, "the lead's wait was not satisfied exactly once").toHaveLength(1);
  expect(eventOf<{ waitId: string; members: Array<{ agentId: string; reason: string }> }>(satisfied[0]!)).toMatchObject({ waitId: wait.waitId, members: [{ agentId: worker.agentId, reason: "settled" }] });
  const wakes = tagged(all, "DeliveryQueued").filter((envelope) => {
    const delivery = eventOf<{ delivery: { target: string; source?: { _tag: string } } }>(envelope).delivery;
    return delivery.target === lead.agentId && delivery.source?._tag === "wait";
  });
  expect(wakes, "the lead was not woken exactly once").toHaveLength(1);
  expect(promptsOf(peekEcho(lead.echo)!), "the lead's adapter got a prompt too many or too few").toHaveLength(3);
  expect(woken[2]).toContain(`Wait ${wait.waitId} finished.`);
  expect(woken[2]).toContain(`agent ${worker.agentId}: settled`);
  expect(tagged(all, "OwnerNeeded", worker.agentId), "the owner was called more than once").toHaveLength(1);
}));

scenario("flow (stop, resume, restart): the lead stops and resumes its worker, which asks again and is answered by the lead, and after a hard kill and restart the whole history and the views still agree (breaks if stop, resume or restart loses a link or the views drift from the log)", (w) => Effect.gen(function* () {
  // The lead keeps its second turn open until the test releases it, so it still holds the request when it arrives.
  const gate = join(w.root.root, "gate-flow");
  const lead = yield* w.start(w.owner, {
    name: "Lead", role: "lead", permission: "edit", prompt: "Plan the work.",
    script: { turns: [[], [{ step: "wait_for_file", path: gate }]] },
  });
  yield* eventsUntil(w.owner, 0, "the lead's first turn", isTag("TurnEnded", lead.agentId));
  const leadClient = yield* w.asAgent((yield* w.token(lead)).token);

  const worker = yield* w.start(leadClient, {
    name: "Worker", permission: "ask", prompt: "Write the file.",
    script: { turns: [[{ step: "permission", toolCallId: "call-flow", title: "Write the file", options }, { step: "text", text: "file written" }]] },
  });
  const requested = yield* eventsUntil(w.owner, 0, "the permission request", isTag("PermissionRequested", worker.agentId));
  const request = tagged(requested, "PermissionRequested", worker.agentId)[0]!.event as unknown as { permissionRequestId: string; holder: { _tag: string; agentId?: string } };
  expect(request.holder, "the request did not go to the worker's lead").toMatchObject({ _tag: "agent", agentId: lead.agentId });

  yield* leadClient.answer({ requestId: requestId(), kind: "permission", id: request.permissionRequestId, optionId: "allow-once" } as never);
  const finished = yield* eventsUntil(w.owner, 0, "the worker's first turn", isTag("TurnEnded", worker.agentId));
  expect(threadText(finished, worker.agentId)).toContain("permission:selected:allow-once");
  expect(tagged(finished, "OwnerNeeded", worker.agentId), "the owner was called although the lead answered").toHaveLength(0);

  // The lead stops and resumes the worker, then gives it a second job.
  yield* leadClient.stop({ requestId: requestId(), agentId: worker.agentId } as never);
  yield* eventsUntil(w.owner, 0, "the worker to stop", isTag("AgentStopped", worker.agentId));
  const workerPid = peekEcho(worker.echo)!.pid;
  yield* waitFor("the stopped worker's process to be gone", () => (alive(workerPid) ? undefined : true));
  const resumeMark = yield* w.watermark();
  yield* leadClient.resume({ requestId: requestId(), agentId: worker.agentId } as never);
  yield* eventsUntil(w.owner, resumeMark, "the session to reopen", isTag("SessionOpened", worker.agentId));
  // The resumed process runs its script from the start, so the worker asks again and its lead answers again.
  yield* leadClient.prompt({ requestId: requestId(), agentId: worker.agentId, text: "Do the second job." } as never);
  const again = yield* eventsUntil(w.owner, resumeMark, "the second request", isTag("PermissionRequested", worker.agentId));
  const secondRequest = tagged(again, "PermissionRequested", worker.agentId)[0]!.event as unknown as { permissionRequestId: string; holder: { agentId?: string } };
  expect(secondRequest.holder.agentId).toBe(lead.agentId);
  yield* leadClient.answer({ requestId: requestId(), kind: "permission", id: secondRequest.permissionRequestId, optionId: "allow-once" } as never);
  const second = yield* eventsUntil(w.owner, resumeMark, "the second turn", isTag("TurnEnded", worker.agentId));
  expect(threadText(second, worker.agentId)).toContain("permission:selected:allow-once");
  writeFileSync(gate, "go");

  // A hard kill and a restart keep the history and bring the lead and worker back.
  const before = yield* since(w.owner, 0);
  yield* w.kill("SIGKILL");
  yield* w.boot();
  const after = yield* since(w.owner, 0);
  expect(after.slice(0, before.length).map((envelope) => envelope.sequence), "the restart changed history").toEqual(before.map((envelope) => envelope.sequence));
  expect(tagged(after, "PermissionAnswered", worker.agentId)).toHaveLength(2);
  expect(tagged(after, "AgentStarted").map((envelope) => envelope.agentId).sort()).toEqual([lead.agentId, worker.agentId].sort());
  const mark = yield* w.watermark();
  const status = (yield* w.owner.prompt({ requestId: requestId(), agentId: lead.agentId, text: "Status after the restart?" } as never)) as { deliveryId: string };
  // Not the first delivery the lead takes after the restart (a carry-on could come first), but this one.
  const reply = yield* eventsUntil(w.owner, mark, "the lead to take the status question after the restart", (envelope) =>
    envelope.event._tag === "DeliveryAccepted" && envelope.agentId === lead.agentId
    && (envelope.event as unknown as { deliveryId: string }).deliveryId === status.deliveryId, 30_000);
  expect(tagged(reply, "DeliveryAccepted", lead.agentId).length).toBeGreaterThan(0);
  expect(promptsOf(peekEcho(lead.echo)!).join("\n")).toContain("Status after the restart?");
}));
