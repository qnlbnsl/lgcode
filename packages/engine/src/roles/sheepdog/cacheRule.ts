import { join, resolve } from "node:path";
import type { AgentId, EventEnvelope, EventSequence, TurnUsage } from "@shephrd/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type { Snapshot } from "../../commands/internal.ts";
import { cacheActionFor, lastEnd, sessionOf, type CacheTarget } from "../../commands/cache.ts";
import { executeService, serviceCacheAction, serviceCacheSettings } from "../../commands/services.ts";
import { Views } from "../../views/Views.ts";
import type { RolesView } from "../view.ts";
import type { RuleContext, SheepdogRule } from "./loop.ts";
import { recordAction, sheepdogCaller } from "./notices.ts";
import { actionRequestId } from "./requests.ts";
import { cacheExpiry, cacheLifetime } from "./rules/cache.ts";
import { resolveSettings, roleSettings } from "./settings.ts";
import type { TimerOrigin } from "./timers.ts";
import { readTranscriptUsage, transcriptPath } from "./usage.ts";

const limitsFor = (snapshot: Snapshot, agentId: string) => {
  const roles = snapshot.roles as RolesView;
  return resolveSettings(roles.settings, roleSettings(roles.file, snapshot.agents[agentId]!.role));
};
// State belongs to one loop subscription. Restart derives it again from the
// log and one bounded transcript read per current agent, never from a timer log.
export const makeCacheRule = (): SheepdogRule => {
  const targets = new Map<string, CacheTarget>();
  let lifetimes = new Map<string, number | undefined>();
  let home = "";
  const completeAccepted = (context: RuleContext) => Effect.gen(function* () {
    const roles = context.snapshot.roles as RolesView;
    // A committed command can make the target busy before its action record
    // is written. Recover that successful effect before applying idle guards.
    for (let sequence = roles.position + 1; sequence <= context.snapshot.sequence; sequence++) {
      const reply = yield* executeService(sheepdogCaller, "client.event", { requestId: `roles:cache-recover:${sequence}`, sequence }, context.lists);
      const row = reply.envelope as EventEnvelope;
      if (row.caller._tag !== "service" || row.caller.service !== "roles.sheepdog" || row.requestId === undefined) continue;
      const event = row.event;
      if (event._tag !== "DeliveryQueued" || event.delivery.cache === undefined) continue;
      const { agentId: target, sequence: trigger, action } = event.delivery.cache;
      if (event.delivery.target !== target || row.requestId !== actionRequestId({ rule: "cache", subject: target,
        triggerSequence: trigger, kind: "accept", recipient: target, occurrence: 1 })) continue;
      const tag = action === "compact" ? "roles.CompactRequested" : "roles.CacheFlushed";
      if (roles.actions.some((action) => action._tag === tag && action.agentId === target && action.triggerSequence === trigger)) continue;
      yield* recordAction({ _tag: tag, agentId: target, noticeRecipient: "owner", triggerSequence: trigger as EventSequence,
        sourceSequence: context.sourceSequence as EventSequence, occurrence: 1,
        notice: context.lists.boardEnabled === false ? "board-off" : "sent",
      }, "cache", context.lists);
    }
  });
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
    const session = sessionOf(snapshot, agentId);
    if (session === undefined) return;
    // A repeated reload of the same session preserves its interval. A fresh
    // session cannot relabel an earlier turn's evidence on any refresh path.
    let activeSession: string | undefined;
    let sessionStart = 0;
    for (const row of snapshot.threads[agentId] ?? []) {
      if (row.event._tag !== "SessionOpened") continue;
      const next = row.event.session._tag === "acp" ? row.event.session.sessionId : undefined;
      if (next !== activeSession) sessionStart = row.sequence;
      activeSession = next;
    }
    if (activeSession !== session || end.sequence <= sessionStart) return;
    const start = snapshot.threads[agentId]?.findLast((row) => row.sequence < end.sequence && row.event._tag === "DeliverySent");
    if (start === undefined || start.sequence <= sessionStart) return;
    const usage = end.event.usage;
    let transcript;
    // The normalized last-request fields and `used` win independently. The
    // adapter's terminal input/cache counters can cover an entire turn.
    const hasSplit = usage?.cachedWrite5mTokens !== undefined || usage?.cachedWrite1hTokens !== undefined;
    if (agent.harness === "claude" && session !== undefined && (!hasSplit || usage?.used === undefined)) {
      const account = snapshot.accounts[agent.account];
      const configured = account?.home ?? account?.environment?.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
      if (!configured.startsWith("secret:")) {
        const path = transcriptPath(resolve(agent.folder, configured), agent.folder, session);
        if (path !== undefined) transcript = readTranscriptUsage(path, session, {
          startedAt: start.occurredAt, endedAt: end.occurredAt, requestStartedAt: usage?.requestStartedAt,
        });
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
    activeSession = undefined;
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
      yield* completeAccepted(context);
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
      yield* executeService(sheepdogCaller, "board.status", { requestId: id("status"), agentId: target.agentId }, context.lists);
      const snapshot = yield* (yield* Views).snapshot;
      if (cacheActionFor(snapshot, target, yield* Clock.currentTimeMillis, context.lists) === undefined) return;
      // The preflight read is advisory. The internal service selects the
      // action and rechecks every guard in the acceptance transaction.
      const action = yield* serviceCacheAction(sheepdogCaller, target, context.lists).pipe(
        Effect.catchTag("CommandRefused", () => Effect.succeed(undefined)),
      );
      if (action !== undefined) yield* recordAction({ _tag: action === "flush" ? "roles.CacheFlushed" : "roles.CompactRequested",
        agentId: target.agentId as AgentId, noticeRecipient: "owner", triggerSequence: target.sequence as EventSequence,
        sourceSequence: context.sourceSequence as EventSequence, occurrence: 1,
        notice: context.lists.boardEnabled === false ? "board-off" : "sent",
      }, "cache", context.lists);
    }),
  };
};
