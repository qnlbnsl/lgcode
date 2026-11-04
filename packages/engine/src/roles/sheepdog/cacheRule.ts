import { join, resolve } from "node:path";
import type { AgentId, EventEnvelope, EventSequence, TurnUsage } from "@shephrd/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type { Snapshot } from "../../commands/internal.ts";
import { executeService, serviceCacheSettings } from "../../commands/services.ts";
import { Views } from "../../views/Views.ts";
import type { RolesView } from "../view.ts";
import type { RuleContext, SheepdogRule } from "./loop.ts";
import { recordAction, sheepdogCaller } from "./notices.ts";
import { actionRequestId } from "./requests.ts";
import { cacheAction, cacheExpiry, cacheLifetime } from "./rules/cache.ts";
import { resolveSettings, roleSettings } from "./settings.ts";
import type { TimerOrigin } from "./timers.ts";
import { readTranscriptUsage, transcriptPath } from "./usage.ts";

interface Target {
  readonly agentId: string;
  readonly sequence: number;
  readonly session: string | undefined;
  readonly expiry: number;
  readonly contextTokens: number;
}
const sessionOf = (snapshot: Snapshot, agentId: string): string | undefined => {
  const session = snapshot.agents[agentId]?.session;
  return session?._tag === "acp" ? session.sessionId : undefined;
};
const lastEnd = (snapshot: Snapshot, agentId: string) => snapshot.threads[agentId]?.findLast((row) => row.event._tag === "TurnEnded");
const limitsFor = (snapshot: Snapshot, agentId: string) => {
  const roles = snapshot.roles as RolesView;
  return resolveSettings(roles.settings, roleSettings(roles.file, snapshot.agents[agentId]!.role));
};
const guards = (snapshot: Snapshot, target: Target) => ({
  idle: snapshot.agents[target.agentId]?.state._tag === "idle",
  capacityHold: snapshot.agents[target.agentId]?.capacityHeld === true,
  compacting: snapshot.agents[target.agentId]?.compacting === true,
  queued: Object.values(snapshot.deliveries).some((row) => row.target === target.agentId && row.status === "queued"),
  sent: Object.values(snapshot.deliveries).some((row) => row.target === target.agentId && row.status === "sent"),
  openRequest: Object.values(snapshot.requests).some((row) => row.agentId === target.agentId && row.status === "open"),
  openQuestion: Object.values(snapshot.questions).some((row) => row.agentId === target.agentId && row.status === "open"),
  blockingWait: Object.values(snapshot.waits).some((row) => row.agentId === target.agentId && row.status === "open" && row.blocking),
  newerTurn: lastEnd(snapshot, target.agentId)?.sequence !== target.sequence
    || sessionOf(snapshot, target.agentId) !== target.session
    || ((snapshot.roles as RolesView).agents[target.agentId]?.turnStartSequence ?? 0) > target.sequence,
});

// State belongs to one loop subscription. Restart derives it again from the
// log and one bounded transcript read per current agent, never from a timer log.
export const makeCacheRule = (): SheepdogRule => {
  const targets = new Map<string, Target>();
  let lifetimes = new Map<string, number | undefined>();
  let home = "";
  const loadSettings = (context: RuleContext) => Effect.gen(function* () {
    const settings = yield* serviceCacheSettings(sheepdogCaller, context.lists);
    home = settings.home;
    lifetimes = new Map(settings.harnesses.map((harness) => [harness.id, harness.cacheLifetime]));
  });
  const refresh = (context: RuleContext, agentId: string) => Effect.gen(function* () {
    targets.delete(agentId);
    const { snapshot } = context;
    const agent = snapshot.agents[agentId];
    const end = lastEnd(snapshot, agentId);
    if (agent === undefined || end?.event._tag !== "TurnEnded" || end.event.compact) return;
    if ((snapshot.roles as RolesView).actions.some((action) => action.agentId === agentId && action.triggerSequence === end.sequence
      && (action._tag === "roles.CacheFlushed" || action._tag === "roles.CompactRequested"))) return;
    const start = snapshot.threads[agentId]?.findLast((row) => row.sequence < end.sequence && row.event._tag === "DeliverySent");
    if (start === undefined) return;
    const usage = end.event.usage;
    const session = sessionOf(snapshot, agentId);
    let transcript;
    // The normalized last-request fields and `used` win independently. The
    // adapter's terminal input/cache counters can cover an entire turn.
    const hasSplit = usage?.cachedWrite5mTokens !== undefined || usage?.cachedWrite1hTokens !== undefined;
    if (agent.harness === "claude" && session !== undefined && (!hasSplit || usage?.used === undefined)) {
      const account = snapshot.accounts[agent.account];
      const configured = account?.home ?? account?.environment?.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
      if (!configured.startsWith("secret:")) {
        const path = transcriptPath(resolve(agent.folder, configured), agent.folder, session);
        if (path !== undefined) transcript = readTranscriptUsage(path, session);
      }
    }
    const contextTokens = usage?.used ?? (transcript?.inputTokens === undefined ? undefined
      : transcript.inputTokens + (transcript.cachedReadTokens ?? 0)
        + (transcript.cachedWriteTokens ?? (transcript.cachedWrite5mTokens ?? 0) + (transcript.cachedWrite1hTokens ?? 0)));
    if (contextTokens === undefined || !Number.isSafeInteger(contextTokens)) return;
    const source = hasSplit ? usage : transcript;
    if (source === undefined && usage?.used === undefined) return;
    let priorWriteLifetimeMinutes: number | undefined;
    // Only the current session's proven writes establish a read-only TTL.
    let activeSession: string | undefined;
    for (const row of snapshot.threads[agentId] ?? []) {
      if (row.sequence >= end.sequence) break;
      if (row.event._tag === "SessionOpened") {
        const next = row.event.session._tag === "acp" ? row.event.session.sessionId : undefined;
        if (next !== activeSession) priorWriteLifetimeMinutes = undefined;
        activeSession = next;
      }
      if (row.event._tag !== "TurnEnded" || activeSession !== session) continue;
      const previous: TurnUsage | undefined = row.event.usage;
      if ((previous?.cachedWrite5mTokens ?? 0) > 0 || (previous?.cachedWrite1hTokens ?? 0) > 0) {
        priorWriteLifetimeMinutes = cacheLifetime({ written5m: previous?.cachedWrite5mTokens, written1h: previous?.cachedWrite1hTokens });
      }
    }
    const expiry = cacheExpiry({
      requestStartedAt: source?.requestStartedAt ?? usage?.requestStartedAt,
      turnStartedAt: start.occurredAt, turnEndedAt: end.occurredAt,
      written5m: source?.cachedWrite5mTokens, written1h: source?.cachedWrite1hTokens,
      priorWriteLifetimeMinutes: hasSplit ? priorWriteLifetimeMinutes : transcript?.lastWriteLifetimeMinutes,
      cacheLifetimeMinutes: lifetimes.get(agent.harness),
    });
    const now = yield* Clock.currentTimeMillis;
    if (expiry === undefined || now > expiry - (limitsFor(snapshot, agentId).flushLeadMinutes ?? 2) * 60_000) return;
    targets.set(agentId, { agentId, sequence: end.sequence, session, expiry, contextTokens });
  });
  return {
    onStart: (context) => Effect.gen(function* () {
      targets.clear();
      yield* loadSettings(context);
      for (const agentId of Object.keys(context.snapshot.agents)) yield* refresh(context, agentId);
    }),
    onEvent: (context, envelope: EventEnvelope) => Effect.gen(function* () {
      const event = envelope.event;
      if (event._tag === "HarnessChanged") {
        yield* loadSettings(context);
        for (const agent of Object.values(context.snapshot.agents)) if (agent.harness === event.harness.id) yield* refresh(context, agent.agentId);
      } else if (event._tag === "TurnEnded") yield* refresh(context, event.agentId);
      else if (event._tag === "DeliverySent" || event._tag === "AgentStopped" || event._tag === "AgentCrashed") targets.delete(event.agentId);
      else if (event._tag === "SessionOpened" && targets.get(event.agentId)?.session !== sessionOf(context.snapshot, event.agentId)) targets.delete(event.agentId);
    }),
    timers: (context): ReadonlyArray<TimerOrigin> => [...targets.values()].map((target) => ({
      key: JSON.stringify(["cache", target.agentId, target.sequence]), rule: "compact-cache", originSequence: target.sequence,
      delayMillis: 0, absoluteDueAt: target.expiry - (limitsFor(context.snapshot, target.agentId).flushLeadMinutes ?? 2) * 60_000,
    })),
    onTimer: (context, timer) => Effect.gen(function* () {
      const target = [...targets.values()].find((target) => timer.key === JSON.stringify(["cache", target.agentId, target.sequence]));
      if (target === undefined) return;
      targets.delete(target.agentId);
      const id = (command: string) => actionRequestId({ rule: "cache", subject: target.agentId, triggerSequence: target.sequence,
        kind: command, recipient: target.agentId, occurrence: 1 });
      const status = yield* executeService(sheepdogCaller, "board.status", { requestId: id("status"), agentId: target.agentId }, context.lists);
      // Re-read after the status command; queued work, questions and new turns
      // may have arrived while it ran. Engine idle checks remain the final gate.
      const snapshot = yield* (yield* Views).snapshot;
      const limits = limitsFor(snapshot, target.agentId);
      const action = cacheAction({ expiry: target.expiry, now: yield* Clock.currentTimeMillis, armed: true,
        contextTokens: target.contextTokens, floor: limits.compactionTokens === "off" ? 150_000 : limits.compactionTokens ?? 150_000,
        compaction: limits.compactionTokens === "off" ? "off" : "on", flushLeadMinutes: limits.flushLeadMinutes,
        unreadPosts: typeof status.unread === "number" ? status.unread : 0, boardOn: context.lists.boardEnabled !== false,
        ...guards(snapshot, target),
      });
      if (action === undefined || (snapshot.roles as RolesView).settings.sheepdog === false) return;
      const command = action === "flush" ? "board.flush" : "compact";
      const accepted = yield* executeService(sheepdogCaller, command, { requestId: id(command), agentId: target.agentId }, context.lists).pipe(
        Effect.as(true), Effect.catchTag("CommandRefused", () => Effect.succeed(false)),
      );
      if (accepted) yield* recordAction({ _tag: action === "flush" ? "roles.CacheFlushed" : "roles.CompactRequested",
        agentId: target.agentId as AgentId, noticeRecipient: "owner", triggerSequence: target.sequence as EventSequence,
        sourceSequence: context.sourceSequence as EventSequence, occurrence: 1,
        notice: context.lists.boardEnabled === false ? "board-off" : "sent",
      }, "cache", context.lists);
    }),
  };
};
