// The whole journey in one service: the owner starts a lead, the lead starts a
// worker, the worker asks permission and the lead answers, the lead is told when
// the worker finishes, the owner asks the lead a question, the worker is stopped
// and resumed by its lead and finishes more work, the service is killed and
// restarted, and the history is still there. Criteria 8.3 to 8.5.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  alive, eventsUntil, isTag, peekEcho, promptsOf, requestId, scenario, since, stopAllServices, tagged, threadText, waitFor,
} from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

const options = [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }];

scenario("flow: owner starts a lead, the lead starts a worker, the worker's permission request is answered by the lead, the lead stops and resumes the worker, which asks again, and after a hard kill and restart the whole history and the views still agree (breaks if any link in the chain start, route, answer, wake, stop, resume, restart is missing or the views drift from the log)", (w) => Effect.gen(function* () {
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
  yield* w.owner.prompt({ requestId: requestId(), agentId: lead.agentId, text: "Status after the restart?" } as never);
  const reply = yield* eventsUntil(w.owner, mark, "the lead's reply after the restart", isTag("DeliveryAccepted", lead.agentId), 30_000);
  expect(tagged(reply, "DeliveryAccepted", lead.agentId).length).toBeGreaterThan(0);
  expect(promptsOf(peekEcho(lead.echo)!).join("\n")).toContain("Status after the restart?");
}));
