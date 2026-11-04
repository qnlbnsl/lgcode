import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";

import { runFoundryRun } from "../../support/foundryRun.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

// FR01-FR12 exercise the service as one Foundry run. The fixture must compose
// the production service in this process with it.effect's test clock, start
// fake agents, and expose only clients connected to its real Unix socket.
it.effect("FR01-FR12: the Foundry completes its team run through the client API", () => Effect.gen(function* () {
  const run = yield* runFoundryRun();

  // FR01: the production roster contains the orchestrator, both leads, and
  // each lead's two workers, with their parent and role attribution intact.
  expect(run.roster, "start or roster wiring lost an agent or its parent").toEqual([
    { name: "orchestrator", role: "orchestrator", parent: null },
    { name: "lead-a", role: "lead", parent: "orchestrator" },
    { name: "worker-a1", role: "worker", parent: "lead-a" },
    { name: "worker-a2", role: "worker", parent: "lead-a" },
    { name: "lead-b", role: "lead", parent: "orchestrator" },
    { name: "worker-b1", role: "worker", parent: "lead-b" },
    { name: "worker-b2", role: "worker", parent: "lead-b" },
  ]);

  // FR02: every role can orient itself through the roles command; this catches
  // a broken roles.orient registration or a roster scoped to the wrong parent.
  expect(run.orientations, "roles.orient did not return each agent's own allowed view").toEqual({
    orchestrator: ["orchestrator", "lead-a", "lead-b"],
    "lead-a": ["lead-a", "worker-a1", "worker-a2"],
    "lead-b": ["lead-b", "worker-b1", "worker-b2"],
    "worker-a1": ["worker-a1"],
    "worker-a2": ["worker-a2"],
    "worker-b1": ["worker-b1"],
    "worker-b2": ["worker-b2"],
  });

  // FR03: each team has its own group channel and posts stay in that channel.
  expect(run.teamChannels, "team messages crossed groups or a group channel was not created").toEqual({
    "lead-a": ["worker-a1", "worker-a2"],
    "lead-b": ["worker-b1", "worker-b2"],
  });

  // FR04: the lead's all-mode wait returns once both workers have replied,
  // and it remains open while either worker is still working.
  expect(run.allModeWait, "all-mode wait woke early or did not collect both replies").toEqual({
    outcome: "satisfied",
    replies: ["worker-a1", "worker-a2"],
    leadReportedStalledWhileWorking: false,
    wakeCount: 1,
  });

  // FR05: a worker asking its idle lead a question makes both participants
  // stalled; this catches a missing wait-chain traversal in the stall rule.
  expect(run.questionStall, "the question and its idle lead were not both reported stalled").toEqual({
    workerStalled: true,
    leadStalled: true,
  });

  // FR06: three separate work episodes cross the production stall threshold
  // and produce one report for the worker.
  expect(run.repeatedStall, "three stall episodes did not produce one report").toEqual({
    episodes: 3,
    reportCount: 1,
    reportedAgent: "worker-b1",
  });

  // FR07: a capacity failure is held and later released so work continues.
  expect(run.capacity, "capacity failure was lost or did not release the held delivery").toEqual({
    held: true,
    released: true,
    workerContinued: true,
  });

  // FR08: after a crash, resume admits a fresh working turn. FR09: a second
  // crash is reported rather than silently retried again.
  expect(run.crashes, "crash resume or the one-retry limit changed").toEqual({
    first: { resumed: true, newWorkingTurn: true },
    second: { resumed: false, reportCount: 1 },
  });

  // FR10: an idle team reaches its lead's holder through the roles notice path.
  expect(run.teamIdle, "the lead's holder was not told when the team idled").toEqual({
    lead: "lead-b",
    holder: "orchestrator",
    noticeCount: 1,
  });

  // FR11: the replacement receives a cut hand-off and can ask its lead for
  // the omitted portion, which the lead returns through the board.
  expect(run.replacement, "replacement hand-off omitted or exposed the wrong part").toEqual({
    cutPartRequested: true,
    cutPartReceived: true,
    receivedFrom: "lead-a",
  });

  // FR12: wrap-up reads client.roster for the attribution table and exports
  // every agent's thread through the client API.
  expect(run.wrapUp, "wrap-up missed roster attribution or a thread export").toEqual({
    attributionRows: 7,
    exportedThreads: 7,
    allThreadsNonEmpty: true,
  });
}) as Effect.Effect<void, unknown, Scope.Scope>);

it.effect("FR13: a capacity error causes no lead wake and no blocking-wait return", () => Effect.gen(function* () {
  const run = yield* runFoundryRun({ scenario: "capacity" });

  // Capacity hold/release is delivered through the socket, and its internal
  // retry must not count as a new reason to wake the lead or return from wait.
  expect(run.capacityRetry, "capacity retry woke the lead or returned its blocking wait").toEqual({
    leadWakeCount: 0,
    blockingWaitReturns: 0,
  });
}) as Effect.Effect<void, unknown, Scope.Scope>);
