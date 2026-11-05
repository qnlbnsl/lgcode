import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { connect, type Client } from "@shephrd/client";
import type { AgentId, EventEnvelope, RosterEntry } from "@shephrd/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { exportThread } from "../../../cli/src/commands/threadExport.ts";
import { resolveHarnessDefaults } from "../../src/runner/harnesses.ts";
import { liveConfig, registerAccounts } from "./driver.ts";
import { parseArguments } from "./run.ts";
import { createReporter, type Reporter } from "./reporter.ts";
import { FLUSH_MARKER, ROLES_GROUP, rolesLeadPrompt, STALL_MARKER, WAVE_MARKER } from "./rolesPrompts.ts";
import { startLiveService, type LiveService } from "./service.ts";
import { eventsUntil, findLeaks, head, readOwnerCredentialFrom, redactSecrets, redactShapes, requestId, since } from "./support.ts";

const HELP = `Usage: pnpm live-check:roles [--help] [--dry-run]

Owner-only live check for roles plan WS-8, task 8c. Uses the signed-in Claude
Code lead and two signed-in Codex workers through their real adapters. Starts
an isolated engine under /tmp; it does not use or stop an existing engine.
Saves a private report, roster and thread exports under .scratch/live-check-roles/.

Checks orientation, group membership, an all-mode board collection with one
completion wake, a sheepdog-timed cache flush on the Claude lead, and one
worker's first stall with an idle unanswered post. The stall uses the unchanged
production limit (normally ten minutes), followed by exactly one nudge and reply.
The cache step needs real cache usage evidence and can take several minutes (or an hour
with a one-hour cache). Missing evidence or a timeout fails the step. It never
invents usage or directly flushes in place of the sheepdog.

Standing rules are skipped because the owner deferred tasks 2a-2g and 7a.
Capacity, crash, repeated-stall and cut-hand-off fault scenarios remain in
the composed-service acceptance check; this script does not manufacture
provider failures or kill real agent sessions to simulate them.

--dry-run prints the exact prompts and steps without starting anything or
reading the account homes. --help prints this text. Model, effort and timeout
variables are the same SHEPHRD_LIVE_* variables as pnpm live-check.
The default total limit is 30 minutes; set SHEPHRD_LIVE_TOTAL_TIMEOUT_SECONDS
above 4200 when checking a one-hour cache plus the first stall. No permission is auto-approved.`;

const STEPS = [
  { id: "service", title: "the isolated engine serves its authenticated socket" },
  { id: "setup", title: "real adapters and signed-in accounts are configured" },
  { id: "wave", title: "the real lead collects both workers through one all-mode post" },
  { id: "timed-flush", title: "the sheepdog flushes an unread post at the cache timer" },
  { id: "first-stall", title: "an idle worker's unanswered post receives exactly one first-stall nudge after production minutes" },
  { id: "wrap-up", title: "the roster and every thread are exported" },
  { id: "shutdown", title: "roles switches are off and the run's agents are stopped" },
] as const;

class CheckFailed extends Error {}
const requireCheck = (condition: boolean, reason: string): void => {
  if (!condition) throw new CheckFailed(reason);
};

// Only our own fixed assertion messages reach the report. A command refusal,
// transport error or adapter exception may contain arbitrary provider text.
const checked = <A, E, R>(reporter: Reporter, spec: typeof STEPS[number], body: Effect.Effect<A, E, R>) => Effect.gen(function* () {
  const started = Date.now();
  const exit = yield* Effect.exit(body);
  if (Exit.isSuccess(exit)) {
    reporter.pass(spec, "", Date.now() - started);
    return exit.value;
  }
  const error = Cause.squash(exit.cause);
  reporter.fail(spec, error instanceof CheckFailed ? error.message : spec.id === "timed-flush"
    ? "no completed sheepdog cache flush was observed; check adapter usage support, cache lifetime and the total time limit; provider error text is withheld"
    : "the operation failed or timed out; provider error text is withheld", Date.now() - started);
  return yield* Effect.fail(new CheckFailed(`${spec.id} failed`));
});

const waitIdle = (owner: Client, ids: ReadonlyArray<string>, limit: number) => Effect.gen(function* () {
  const deadline = Date.now() + limit;
  for (;;) {
    const snapshot = yield* owner["client.snapshot"]({ requestId: requestId() } as never);
    if (ids.every((id) => snapshot.agents.some((row) => row.agentId === id && row.state._tag === "idle"))
      && !snapshot.requests.some((row) => ids.includes(row.agentId))
      && !snapshot.questions.some((row) => ids.includes(row.agentId))
      && !snapshot.waitState?.deliveries.some((row) => ids.includes(row.target))) return;
    requireCheck(Date.now() < deadline, "the real agents did not settle without pending permissions, questions or deliveries");
    yield* Effect.sleep(250);
  }
});

const orientation = (events: ReadonlyArray<EventEnvelope>, agentId: string, marker: string, parentId?: string,
  wave?: { readonly postId: string; readonly channelId: string }) =>
  events.find(({ event, caller }) => {
    if (event._tag !== "board.PostWritten" || event.author._tag !== "agent" || event.author.agentId !== agentId
      || caller._tag !== "agent" || caller.agentId !== agentId
      || wave !== undefined && (event.channelId !== wave.channelId || event.replyToPostId !== wave.postId)) return false;
    try {
      const evidence = JSON.parse(event.text) as { marker?: string; agentId?: string; parent?: { _tag?: string; agentId?: string } };
      return evidence.marker === marker && evidence.agentId === agentId
        && (parentId === undefined ? evidence.parent?._tag === "owner"
          : evidence.parent?._tag === "agent" && evidence.parent.agentId === parentId);
    } catch { return false; }
  });

const waveReply = (events: ReadonlyArray<EventEnvelope>, agentId: string, parentId: string,
  wave: { readonly postId: string; readonly channelId: string }): boolean => {
  const answer = orientation(events, agentId, WAVE_MARKER, parentId, wave)?.event;
  return answer?._tag === "board.PostWritten" && events.some(({ event }) => event._tag === "board.AddresseeResolved"
    && event.postId === wave.postId && event.addressee._tag === "agent" && event.addressee.agentId === agentId
    && event.disposition === "replied" && event.decidingPostId === answer.postId);
};

const runWave = (owner: Client, service: LiveService, environment: Readonly<Record<string, string | undefined>>) => Effect.gen(function* () {
  const config = liveConfig(environment);
  const mark = yield* head(owner);
  const folders = [join(service.work, "worker-1"), join(service.work, "worker-2")];
  for (const folder of folders) mkdirSync(folder, { mode: 0o700 });
  const lead = yield* owner.start({
    requestId: requestId(), name: "Roles lead", role: "lead", harness: config.leadHarness,
    account: { _tag: "named", accountId: config.leadAccount }, permission: "ask",
    folder: service.work, runMode: "acp", groups: [ROLES_GROUP],
    model: config.leadModel, effort: config.leadEffort, prompt: rolesLeadPrompt(config, folders),
  } as never);
  const posted = yield* eventsUntil(owner, mark, "the lead's all-mode wave", ({ event }) =>
    event._tag === "board.PostWritten" && event.author._tag === "agent" && event.author.agentId === lead.agentId
      && event.reply === "all" && event.text === WAVE_MARKER, config.agentTimeout);
  const batch = posted.findLast(({ event }) => event._tag === "board.PostWritten" && event.text === WAVE_MARKER)!.event;
  if (batch._tag !== "board.PostWritten") return yield* Effect.die(new CheckFailed("the wave post was not recorded"));
  const collected = yield* eventsUntil(owner, mark, "both real worker replies", ({ event }) =>
    event._tag === "board.PostClosed" && event.postId === batch.postId, config.agentTimeout);
  const closed = collected.find(({ event }) => event._tag === "board.PostClosed" && event.postId === batch.postId)!.event;
  requireCheck(closed._tag === "board.PostClosed" && closed.outcome === "answered", "the wave closed without both answers");
  const roster = yield* owner["client.roster"]({ requestId: requestId() } as never);
  const workers = roster.agents.filter((row) => row.parent._tag === "agent" && row.parent.agentId === lead.agentId);
  requireCheck(workers.length === 2 && workers.every((row) => row.role === "worker"
    && row.harness === config.workerHarness && row.groups.includes(ROLES_GROUP) && folders.includes(row.folder))
    && new Set(workers.map((row) => row.folder)).size === 2, "the two Codex workers lost their roles, folders, groups or parent");
  requireCheck(batch.to.length === 2 && workers.every((worker) => batch.to.some((to) => to._tag === "agent" && to.agentId === worker.agentId)),
    "the all-mode wave does not address exactly the two workers");
  yield* eventsUntil(owner, mark, "the lead's completion wake", ({ event }) => event._tag === "board.WakeBuilt"
    && event.targetAgentId === lead.agentId && event.completions.includes(batch.postId), config.agentTimeout);
  yield* waitIdle(owner, [lead.agentId, ...workers.map((row) => row.agentId)], config.agentTimeout);
  yield* Effect.sleep(5_000);
  const all = yield* since(owner, mark);
  requireCheck(orientation(all, lead.agentId, "roles-live-orient") !== undefined, "the lead did not return its orientation identity and parent");
  for (const worker of workers) {
    requireCheck(waveReply(all, worker.agentId, lead.agentId, batch), "a worker has no authenticated orientation reply and replied disposition for this wave and channel");
    requireCheck(all.some(({ event }) => event._tag === "board.PostAcknowledged" && event.postId === batch.postId
      && event.addressee._tag === "agent" && event.addressee.agentId === worker.agentId), "a worker did not acknowledge the wave");
  }
  const wakes = all.filter(({ event }) => event._tag === "board.WakeBuilt" && event.targetAgentId === lead.agentId
    && event.completions.includes(batch.postId));
  requireCheck(wakes.length === 1, "the lead received other than one wave completion wake");
  requireCheck(!all.some(({ event }) => event._tag === "roles.StallSeen" && event.agentId === lead.agentId),
    "the lead was reported stalled while collecting its workers");
  const channel = all.find(({ event }) => event._tag === "board.ChannelOpened" && event.channelId === batch.channelId)?.event;
  requireCheck(channel?._tag === "board.ChannelOpened" && channel.kind === "group" && channel.group === ROLES_GROUP
    && channel.anchorAgentId === lead.agentId, "the team channel is not bound to the lead's group");
  return { leadId: lead.agentId, workerId: workers[0]!.agentId, channelId: batch.channelId };
});

const timedFlush = (owner: Client, leadId: AgentId, channelId: string, totalTimeout: number) => Effect.gen(function* () {
  // A reply:none post remains unread without waking its recipient. Only the
  // sheepdog may flush it. No manufactured usage, shortened clock, board.flush
  // command or compact fallback can satisfy this check.
  const mark = yield* head(owner);
  const post = yield* owner["board.post"]({ requestId: requestId(), channelId, text: FLUSH_MARKER, to: [], reply: "none" } as never);
  const before = yield* owner["board.status"]({ requestId: requestId(), agentId: leadId } as never);
  requireCheck("unread" in before && before.unread > 0, "the timed step has no unread post to flush");
  const recorded = yield* eventsUntil(owner, mark, "the sheepdog's timed cache flush (real usage is required)", ({ event }) =>
    event._tag === "roles.CacheFlushed" && event.agentId === leadId, totalTimeout);
  const action = recorded.findLast(({ event }) => event._tag === "roles.CacheFlushed" && event.agentId === leadId)!;
  const origins = yield* since(owner, 0);
  const origin = origins.find((row) => row.sequence === (action.event as { triggerSequence: number }).triggerSequence);
  requireCheck(origin?.event._tag === "TurnEnded" && origin.agentId === leadId && origin.sequence <= mark,
    "the cache flush was not scheduled from the lead's prior real turn");
  requireCheck(action.occurredAt > origin!.occurredAt, "the cache flush has no elapsed real time");
  const wake = origins.find(({ event }) => event._tag === "board.WakeBuilt" && event.targetAgentId === leadId && event.carried.includes(post.postId));
  requireCheck(wake !== undefined, "the timed flush did not carry the unread marker post");
  yield* eventsUntil(owner, wake!.sequence, "the lead to finish the timed flush", ({ event }) =>
    event._tag === "TurnEnded" && event.agentId === leadId, 300_000);
  yield* waitIdle(owner, [leadId], 30_000);
});

const firstStall = (owner: Client, workerId: AgentId, totalTimeout: number, reporter: Reporter) => Effect.gen(function* () {
  const settings = yield* owner["roles.settings.get"]({ requestId: requestId() } as never);
  // A plain worker has no named role override. Read the configured production
  // limit and leave it unchanged; no TestClock, fake usage or manual flush.
  const stallMillis = (settings.settings.limits?.stallMinutes ?? 10) * 60_000;
  const mark = yield* head(owner);
  const post = yield* owner["board.post"]({ requestId: requestId(), direct: { _tag: "agent", agentId: workerId },
    to: [{ _tag: "agent", agentId: workerId }], text: STALL_MARKER, reply: "all" } as never);
  yield* eventsUntil(owner, mark, "the worker to acknowledge its idle obligation", ({ event }) =>
    event._tag === "board.PostAcknowledged" && event.postId === post.postId && event.addressee._tag === "agent"
      && event.addressee.agentId === workerId, 300_000);
  yield* waitIdle(owner, [workerId], 300_000);
  const idle = yield* since(owner, mark);
  requireCheck(!idle.some(({ event }) => event._tag === "board.AddresseeResolved" && event.postId === post.postId)
    && !idle.some(({ event }) => event._tag === "roles.StallSeen" && event.stalledPostId === post.postId),
    "the worker did not leave a genuine idle unanswered obligation");
  reporter.note(`Waiting for the first stall with the unchanged ${stallMillis / 60_000}-minute production limit.`);
  const stalled = yield* eventsUntil(owner, mark, "the first production-minute stall", ({ event }) =>
    event._tag === "roles.StallSeen" && event.agentId === workerId && event.stalledPostId === post.postId, totalTimeout);
  const action = stalled.find(({ event }) => event._tag === "roles.StallSeen" && event.agentId === workerId
    && event.stalledPostId === post.postId)!;
  if (action.event._tag !== "roles.StallSeen") return yield* Effect.die(new CheckFailed("the stall action is missing"));
  const stall = action.event;
  const obligation = stalled.find(({ event }) => event._tag === "board.PostWritten" && event.postId === post.postId)?.event;
  if (obligation?._tag !== "board.PostWritten") return yield* Effect.die(new CheckFailed("the idle obligation is missing"));
  const origin = stalled.find((row) => row.sequence === stall.triggerSequence);
  requireCheck(origin?.event._tag === "TurnEnded" && origin.agentId === workerId
    && action.occurredAt - origin.occurredAt >= stallMillis, "the first stall did not wait production minutes after the worker became idle");
  requireCheck(stall.occurrence === 1 && stall.noticeRecipient === workerId && stall.notice === "sent"
    && stall.postId !== undefined, "the first stall did not record its one worker nudge");
  yield* eventsUntil(owner, mark, "the worker's answer after its first-stall nudge", ({ event }) =>
    event._tag === "board.PostClosed" && event.postId === post.postId && event.outcome === "answered", 300_000);
  yield* waitIdle(owner, [workerId], 300_000);
  yield* Effect.sleep(5_000);
  const all = yield* since(owner, mark);
  requireCheck(all.filter(({ event }) => event._tag === "roles.StallSeen" && event.agentId === workerId
    && event.stalledPostId === post.postId).length === 1, "the first-stall scenario recorded other than one stall action");
  const wakes = all.filter(({ event }) => event._tag === "board.WakeBuilt" && event.targetAgentId === workerId
    && event.carried.some((id) => id === stall.postId));
  requireCheck(all.filter(({ event }) => event._tag === "board.PostWritten" && event.postId === stall.postId
    && event.author._tag === "service" && event.author.service === "roles.sheepdog").length === 1
    && wakes.length === 1, "the first-stall nudge did not reach its worker exactly once");
  const reply = all.find(({ event, caller }) => event._tag === "board.PostWritten" && event.channelId === obligation.channelId
    && event.replyToPostId === post.postId && event.author._tag === "agent" && event.author.agentId === workerId
    && caller._tag === "agent" && caller.agentId === workerId);
  requireCheck(reply !== undefined && reply.sequence > wakes[0]!.sequence, "the worker did not reply after its first-stall nudge");
  reporter.note(`First-stall evidence: obligation ${post.postId}; action sequence ${action.sequence}; origin sequence ${origin!.sequence}; elapsed ${action.occurredAt - origin!.occurredAt} ms; nudge ${stall.postId}; reply sequence ${reply!.sequence}.`);
});

export const rolesMain = async (argv: ReadonlyArray<string>, environment: Readonly<Record<string, string | undefined>>): Promise<number> => {
  const args = parseArguments(argv);
  if (args.kind === "error") { process.stdout.write(`${HELP}\nUnknown argument.\n`); return 2; }
  if (args.kind === "help") { process.stdout.write(`${HELP}\n`); return 0; }
  const config = liveConfig(environment);
  if (args.kind === "dry-run") {
    process.stdout.write(`${HELP}\n\nNothing is started, sent or read.\nModels: ${config.leadModel} (${config.leadEffort}), ${config.workerModel} (${config.workerEffort}).\n`
      + `${rolesLeadPrompt(config, ["/tmp/shephrd-live-EXAMPLE/work/worker-1", "/tmp/shephrd-live-EXAMPLE/work/worker-2"])}\n`
      + `Owner's later board post: ${FLUSH_MARKER}, reply:none, to:[], on the team channel.\n`
      + STEPS.map((step) => `${step.id}: ${step.title}`).join("\n") + "\n");
    return 0;
  }

  const parent = resolve(".scratch/live-check-roles");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const archive = mkdtempSync(join(parent, "run-"));
  let service: LiveService | undefined;
  const lines: string[] = [];
  const secrets = (): ReadonlyArray<string> => {
    if (service === undefined) return [];
    try { return readOwnerCredentialFrom(service.state); } catch { return []; }
  };
  const safe = (line: string) => redactShapes(redactSecrets(line, secrets()));
  const reporter = createReporter((line) => { lines.push(line); process.stdout.write(`${line}\n`); }, Date.now, safe);
  reporter.note("SKIP standing-rules: owner deferred tasks 2a-2g and 7a pending recordings; no harness qualifies.");
  reporter.note("Fault scenarios (capacity, crashes, repeated stalls and cut hand-offs) belong to the composed-service acceptance suite; this live run checks real team delivery, the cache timer and the first production-minute stall.");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const timer = setTimeout(cancel, config.totalTimeout);
  try {
    const result = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
      const owner = yield* checked(reporter, STEPS[0], Effect.gen(function* () {
        service = startLiveService(environment);
        const deadline = Date.now() + 60_000;
        for (;;) {
          const probe = yield* Effect.exit(Effect.scoped(connect({ environment: { SHEPHRD_HOME: service.state }, attempts: 1 })));
          if (Exit.isSuccess(probe)) break;
          requireCheck(!service.exited() && Date.now() < deadline, "the isolated service did not start");
          yield* Effect.sleep(100);
        }
        return yield* connect({ environment: { SHEPHRD_HOME: service.state }, attempts: 1 });
      }));
      const live = service!;
      const journey = yield* Effect.exit(Effect.gen(function* () {
        yield* checked(reporter, STEPS[1], Effect.gen(function* () {
          const defaults = yield* resolveHarnessDefaults({ binDirectory: fileURLToPath(new URL("../../node_modules/.bin", import.meta.url)), path: environment.PATH ?? "" }).pipe(Effect.provide(NodeServices.layer));
          yield* registerAccounts(owner, config, defaults.harnesses, environment);
          const current = yield* owner["roles.settings.get"]({ requestId: requestId() } as never);
          yield* owner["roles.settings.set"]({ requestId: requestId(), settings: { ...current.settings, sheepdog: true, standingRules: false } } as never);
        }));
        const wave = yield* checked(reporter, STEPS[2], runWave(owner, live, environment));
        reporter.note("Observed one Claude lead, two Codex children, three matching orientation identities, two acknowledgments, two authenticated replies to the selected wave and one completion wake.");
        yield* checked(reporter, STEPS[3], timedFlush(owner, wave.leadId, wave.channelId, config.totalTimeout));
        yield* checked(reporter, STEPS[4], firstStall(owner, wave.workerId, config.totalTimeout, reporter));
      }));
      // Export evidence even if a journey assertion failed. Owner reads only,
      // with the production paged thread exporter and its 0600 file handling.
      const wrapUp = yield* Effect.exit(checked(reporter, STEPS[5], Effect.gen(function* () {
        const roster = yield* owner["client.roster"]({ requestId: requestId() } as never);
        requireCheck(roster.agents.length > 0, "there are no agents to attribute or export");
        const credential = readOwnerCredentialFrom(live.state);
        const attribution: Array<RosterEntry & { exportPath: string }> = [];
        for (const [index, agent] of roster.agents.entries()) {
          const path = join(archive, `thread-${index + 1}.ndjson`);
          yield* exportThread(owner, agent.agentId, path);
          const text = readFileSync(path, "utf8");
          requireCheck(text.trim().length > 0, "an exported thread is empty");
          requireCheck(findLeaks(credential, [{ label: "export", text }]).length === 0, "an exported thread contains the run's owner credential");
          attribution.push({ ...agent, exportPath: path });
        }
        const text = JSON.stringify(attribution, null, 2);
        requireCheck(findLeaks(credential, [{ label: "roster", text }]).length === 0, "the attribution contains the run's owner credential");
        writeFileSync(join(archive, "roster.json"), text, { mode: 0o600 });
        reporter.note(`Exported ${attribution.length} attributed threads with private file permissions.`);
        const views = yield* owner["debug.compare-views"]({ requestId: requestId() } as never);
        requireCheck(views.equal && views.differences.length === 0, "the live roles views differ from their rebuilt views");
      })));
      yield* checked(reporter, STEPS[6], Effect.gen(function* () {
        const current = yield* owner["roles.settings.get"]({ requestId: requestId() } as never);
        yield* owner["roles.settings.set"]({ requestId: requestId(), settings: { ...current.settings, sheepdog: false, standingRules: false } } as never);
        const roster = yield* owner["client.roster"]({ requestId: requestId() } as never);
        // Children before their parent. The service is private to this run.
        for (const agent of [...roster.agents].sort((a, b) => Number(a.role === "lead") - Number(b.role === "lead"))) {
          yield* owner.stop({ requestId: requestId(), agentId: agent.agentId } as never);
        }
        const stopped = yield* owner["client.roster"]({ requestId: requestId() } as never);
        requireCheck(stopped.agents.every((row) => row.state._tag === "stopped"), "an agent remained running after stop");
      }));
      if (Exit.isFailure(journey) || Exit.isFailure(wrapUp)) return yield* Effect.fail(new CheckFailed("the journey or export failed"));
    })), { signal: controller.signal });
    if (Exit.isFailure(result) && !reporter.failed()) reporter.fail({ id: "run", title: "the live roles journey completes" }, "run failed or was cancelled; error details withheld");
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    if (service !== undefined) {
      try { await service.stop(); }
      catch { reporter.fail({ id: "cleanup", title: "the isolated service and its adapters stopped" }, "process cleanup could not be confirmed"); }
      // Keep the private service folder for diagnosis; never copy its owner
      // credential or raw service output into the report or the archive.
    }
    const ran = new Set(reporter.results().map((row) => row.id));
    for (const step of STEPS) if (!ran.has(step.id)) reporter.skip(step, "an earlier failure or cancellation prevented this step");
    reporter.note(controller.signal.aborted ? "The run was cancelled or exceeded its total time limit." : "The run ended.");
    reporter.note(`Report and exports: ${archive}`);
    const code = reporter.exitCode(STEPS);
    reporter.note(`Result: ${code === 0 ? "PASS" : "FAIL"}. This is the real-account check; no phone check was performed.`);
    writeFileSync(join(archive, "report.md"), `${lines.map(safe).join("\n")}\n`, { mode: 0o600 });
  }
  return reporter.exitCode(STEPS);
};
