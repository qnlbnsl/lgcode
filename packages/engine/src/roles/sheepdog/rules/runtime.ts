import type { EventEnvelope, RolesActionRecord } from "@shephrd/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type { Snapshot } from "../../../commands/internal.ts";
import { executeService } from "../../../commands/services.ts";
import { applyWith, emptyViews } from "../../../views/apply.ts";
import { Views } from "../../../views/Views.ts";
import type { RolesView } from "../../view.ts";
import { callForAction } from "../actions.ts";
import type { RuleContext, SheepdogRule } from "../loop.ts";
import { deliveryIsSheepdogTurn, idleNoticeIdentity, noticeRecipient, sendNotice, sheepdogCaller } from "../notices.ts";
import { actionRequestId, actionSubject } from "../requests.ts";
import type { TimerOrigin } from "../timers.ts";
import { actionBase, ageLimitFor, agentRoles, limitsFor, own, turnIsExcluded, type AdviceKind, type RuleInput } from "./context.ts";
import { engineAlertOpen, evaluateCrash } from "./crash.ts";
import { adviceKind, evaluateRoleAdvice } from "./roleAdvice.ts";
import { evaluateRunaway } from "./runaway.ts";
import { evaluateTeamIdle, idleGroups, latestIdleReport } from "./teamIdle.ts";

const CARRY_ON = "You were resumed after a crash. Carry on with what you were doing.";
interface TurnClock { readonly sequence: number; readonly excludedMillis: number; readonly heldSince?: number }
interface RecoveryMark { readonly session?: number; readonly failed?: number; readonly carry?: number }

// Clock state is transient. Startup reconstructs it from the authenticated
// event read, including account events that belong to no agent thread. Only
// event sequences enter the durable roles view; no reducer reads a clock.
export const makeRules = (): ReadonlyArray<SheepdogRule> => {
  let replay: Snapshot | undefined;
  let clockFloorSequence = 0;
  const times: Record<string, number> = Object.create(null);
  const groups: Record<string, number> = Object.create(null);
  const turns: Record<string, TurnClock> = Object.create(null);
  const recovery: Record<string, RecoveryMark> = Object.create(null);
  const kinds: Record<string, AdviceKind[]> = Object.create(null);
  const eventKinds = new Map<number, { readonly agentId: string; readonly kind: AdviceKind }>();
  const sentDeliveries = new Map<string, string>();
  const input = (snapshot: Snapshot, now: number, sourceSequence: number): RuleInput => {
    const roles = snapshot.roles as RolesView;
    const deliveries = Object.fromEntries(Object.entries(snapshot.deliveries).map(([id, delivery]) => [id, {
      ...delivery, sheepdog: deliveryIsSheepdogTurn(snapshot, id),
    }]));
    return { ...snapshot, now, sourceSequence, roles, client: snapshot.client as NonNullable<RuleInput["client"]>, eventTimes: times,
      clockFloorMillis: own(times, String(clockFloorSequence)) ?? -Infinity,
      noticeRecipients: Object.fromEntries(Object.keys(snapshot.agents).map((id) => [id, noticeRecipient(snapshot, id)])),
      groupOrigins: groups, adviceKinds: kinds,
      agents: Object.fromEntries(Object.entries(snapshot.agents).map(([id, agent]) => {
        const row = own(deliveries, sentDeliveries.get(id) ?? "");
        const pending = Object.values(deliveries).filter((delivery) => delivery.target === id && delivery.status === "queued");
        return [id, { ...agent, sheepdog: row?.sheepdog ?? (pending.length > 0 && pending.every((delivery) => delivery.sheepdog)) }];
      })), deliveries,
      turnExcluded: Object.fromEntries(Object.entries(turns).map(([id, turn]) => [id, turn.heldSince !== undefined])),
      turnExcludedMillis: Object.fromEntries(Object.entries(turns).map(([id, turn]) => [id,
        turn.excludedMillis + (turn.heldSince === undefined ? 0 : Math.max(0, now - turn.heldSince))])),
    };
  };
  const remember = (envelope: EventEnvelope, context: RuleContext) => {
    if (replay === undefined) replay = emptyViews(context.lists.views);
    if (envelope.sequence <= replay.sequence) return;
    const before = input(replay, envelope.occurredAt, envelope.sequence);
    const eligible = new Set(idleGroups(before).map(([group]) => group));
    const previous = replay;
    const event = envelope.event;
    const restartClocks = event._tag === "roles.SheepdogBaseline" && (previous.roles as RolesView).baseline?.on !== event.on;
    if (restartClocks) clockFloorSequence = envelope.sequence;
    // This is an ephemeral replay of the same pure projections used by Views.
    // Do not retain a second copy of thread text in the service.
    replay = { ...applyWith(replay, envelope, context.lists.views), threads: Object.create(null) };
    if (envelope.event._tag === "DeliverySent") sentDeliveries.set(envelope.event.agentId, envelope.event.deliveryId);
    times[envelope.sequence] = envelope.occurredAt;
    const after = input(replay, envelope.occurredAt, envelope.sequence);
    const next = new Set(idleGroups(after).map(([group]) => group));
    for (const group of Object.keys(groups)) if (!next.has(group)) delete groups[group];
    for (const group of next) {
      const membership = (event._tag === "AgentGrouped" || event._tag === "AgentStarted")
        && [...(previous.agents[event.agentId]?.groups ?? []), ...event.groups].includes(group);
      if (!eligible.has(group) || groups[group] === undefined || membership || event._tag === "roles.SheepdogBaseline") groups[group] = envelope.sequence;
    }
    for (const agent of Object.values(after.agents)) {
      const role = agentRoles(after, agent);
      if (!role.turnOpen || role.turnStartSequence === undefined) { delete turns[agent.agentId]; continue; }
      let turn = own(turns, agent.agentId);
      if (turn?.sequence !== role.turnStartSequence || restartClocks) turn = { sequence: role.turnStartSequence, excludedMillis: 0 };
      const held = turnIsExcluded(after, agent) || after.roles.settings?.sheepdog === false;
      turns[agent.agentId] = held
        ? { ...turn, heldSince: turn.heldSince ?? envelope.occurredAt }
        : { sequence: turn.sequence, excludedMillis: turn.excludedMillis
          + (turn.heldSince === undefined ? 0 : Math.max(0, envelope.occurredAt - turn.heldSince)) };
    }
    if ("agentId" in event) {
      const mark = own(recovery, event.agentId) ?? {};
      if (event._tag === "SessionOpened") recovery[event.agentId] = { ...mark, session: envelope.sequence };
      if (event._tag === "AgentReloadFailed") recovery[event.agentId] = { ...mark, failed: envelope.sequence };
    }
    if (event._tag === "DeliveryQueued" && event.delivery.content._tag === "carry-on") recovery[event.delivery.target] = {
      ...own(recovery, event.delivery.target), carry: envelope.sequence,
    };
    const kind = adviceKind(envelope);
    if (kind !== undefined && envelope.caller._tag === "agent") eventKinds.set(envelope.sequence, { agentId: envelope.caller.agentId, kind });
    if (event._tag === "roles.RoleAdviceBroken") {
      const broken = eventKinds.get(event.triggerSequence);
      if (broken !== undefined) kinds[broken.agentId] = [...new Set([...(own(kinds, broken.agentId) ?? []), broken.kind])];
    }
    // Keep times only for live origins and action records, rather than all log
    // envelopes. Request ids and advice kinds need no untrusted text.
    const roles = replay.roles as RolesView;
    const keep = new Set<number>([envelope.sequence, clockFloorSequence, ...Object.values(groups),
      ...Object.values(roles.agents).flatMap((agent) => [agent.startedSequence, agent.turnStartSequence ?? 0]),
      ...roles.actions.map((record) => record.sequence)]);
    for (const sequence of Object.keys(times)) if (!keep.has(Number(sequence))) delete times[sequence];
    for (const [sequence] of eventKinds) if (sequence < (roles.position ?? 0)) eventKinds.delete(sequence);
  };
  const synchronize = (context: RuleContext) => Effect.gen(function* () {
    for (let sequence = (replay?.sequence ?? 0) + 1; sequence <= context.snapshot.sequence; sequence++) {
      const reply = yield* executeService(sheepdogCaller, "client.event", { requestId: `roles:rules-clock:${sequence}`, sequence }, context.lists);
      remember(reply.envelope as EventEnvelope, context);
    }
  });
  const current = (context: RuleContext) => Effect.gen(function* () {
    const snapshot = yield* (yield* Views).snapshot;
    yield* synchronize({ ...context, snapshot });
    // Refresh lifecycle and action guards, but keep the switch at the loop's
    // cursor. Views may already include a later off/on transition.
    const roles = snapshot.roles as RolesView;
    return input({ ...snapshot, roles: { ...roles, settings: { ...roles.settings,
      sheepdog: (context.snapshot.roles as RolesView).settings?.sheepdog,
    } } }, yield* Clock.currentTimeMillis, context.sourceSequence);
  });
  const giveUp = (context: RuleContext, admission: RolesActionRecord, cause: "crash" | "reload-failed" | "resume-refused") => Effect.gen(function* () {
    const live = yield* current(context);
    const agent = own(live.agents, admission.agentId);
    if (agent === undefined || own(live.roles.agents, agent.agentId)?.openCrash === undefined) return;
    yield* sendNotice({ _tag: "roles.GaveUp", ...actionBase(live, agent, admission.triggerSequence), cause,
      engineAlertOpen: engineAlertOpen(live, admission.agentId) }, "crash", context.lists);
  });
  const continueCrash = (context: RuleContext, admission: RolesActionRecord) => Effect.gen(function* () {
    let live = yield* current(context);
    let agent = own(live.agents, admission.agentId);
    if (agent === undefined || own(live.roles.agents, admission.agentId)?.openCrash === undefined) return;
    const crash = own(live.roles.agents, admission.agentId)?.crashSequence;
    if (crash !== admission.triggerSequence) { yield* giveUp(context, admission, "crash"); return; }
    if (agent.state?._tag === "crashed") {
      const resumed = yield* callForAction(admission, "crash", "resume", {}, context.lists).pipe(Effect.result);
      if (resumed._tag === "Failure") {
        if (resumed.failure._tag !== "CommandRefused") return yield* resumed.failure;
        yield* giveUp(context, admission, "resume-refused"); return;
      }
      live = yield* current(context);
      agent = own(live.agents, admission.agentId);
      if (own(live.roles.agents, admission.agentId)?.crashSequence !== admission.triggerSequence) {
        yield* giveUp(context, admission, "crash"); return;
      }
    }
    if (agent === undefined || own(live.roles.agents, admission.agentId)?.openCrash === undefined || agent.state?._tag === "starting") return;
    const mark = own(recovery, admission.agentId);
    if ((mark?.failed ?? 0) > admission.triggerSequence && (mark?.failed ?? 0) > (mark?.session ?? 0)) {
      yield* giveUp(context, admission, "reload-failed"); return;
    }
    if ((mark?.session ?? 0) <= admission.triggerSequence) return;
    // A reload may preserve the admitted attempt's queued engine carry-on
    // while opening a later session. The crash, rather than the newest
    // session, separates that continuation from a previous attempt's carry.
    if ((mark?.carry ?? 0) <= admission.triggerSequence) {
      const carried = yield* callForAction(admission, "crash", "prompt", { text: CARRY_ON }, context.lists).pipe(Effect.result);
      if (carried._tag === "Failure") {
        if (carried.failure._tag !== "CommandRefused") return yield* carried.failure;
        yield* giveUp(context, admission, "resume-refused"); return;
      }
    }
    yield* sendNotice({ _tag: "roles.CrashRetried", ...actionBase(live, agent, admission.triggerSequence) }, "crash", context.lists);
  });
  const recover = (context: RuleContext) => Effect.gen(function* () {
    for (const agent of Object.values((context.snapshot.roles as RolesView).agents)) {
      if (agent.openCrash !== undefined) yield* continueCrash(context, agent.openCrash);
    }
  });
  const checkTimers = (context: RuleContext) => Effect.gen(function* () {
    let live = yield* current(context);
    if (context.lists.boardEnabled !== false) for (const action of evaluateTeamIdle(live)) {
      // Each top gets a nudge; shared holders receive one notice per group.
      const id = (kind: string) => actionRequestId({ rule: "team-idle", subject: actionSubject(action),
        triggerSequence: action.triggerSequence, kind: `${action._tag}.nudge.${kind}`,
        recipient: action.agentId, occurrence: action.occurrence });
      const status = yield* executeService(sheepdogCaller, "board.status", { requestId: id("status") }, context.lists);
      if (status.disabled === true) continue;
      const nudged = yield* executeService(sheepdogCaller, "board.post", {
        requestId: id("post"), direct: { _tag: "agent", agentId: action.agentId },
        to: [{ _tag: "agent", agentId: action.agentId }], reply: "none",
        text: "The team has no running work. Check the board and carry on, or report what is blocking it.",
      }, context.lists).pipe(Effect.result);
      if (nudged._tag === "Failure") {
        if (nudged.failure._tag !== "CommandRefused") return yield* nudged.failure;
      } else yield* executeService(sheepdogCaller, "board.flush", {
        requestId: id("flush"), agentId: action.agentId,
      }, context.lists).pipe(Effect.catchTag("CommandRefused", () => Effect.void));
      const group = action._tag === "roles.TeamIdleReported" ? action.group : "";
      yield* sendNotice(action, "team-idle", context.lists, idleNoticeIdentity(context.snapshot, group));
    }
    live = yield* current(context);
    for (const action of evaluateRunaway(live)) yield* sendNotice(action, "runaway", context.lists);
  });
  const rule: SheepdogRule = {
    onStart: (context) => synchronize(context).pipe(Effect.andThen(recover(context))),
    onEvent: (context, envelope) => Effect.gen(function* () {
      const live = yield* current(context);
      for (const action of evaluateRoleAdvice(live, envelope)) yield* sendNotice(action, "role-advice", context.lists);
      for (const action of evaluateCrash({ ...live, event: { ...envelope.event, sequence: envelope.sequence, occurredAt: envelope.occurredAt } })) {
        if (action._tag !== "roles.CrashAdmitted") { yield* sendNotice(action, "crash", context.lists); continue; }
        // Unlike notices, a refused admission MUST stop the resume.
        const admitted = yield* executeService(sheepdogCaller, "roles.record", {
          requestId: actionRequestId({ rule: "crash", subject: action.agentId, triggerSequence: action.triggerSequence,
            kind: "roles.CrashAdmitted.record", recipient: action.noticeRecipient, occurrence: 1 }),
          action: { ...action, notice: "board-off" },
        }, context.lists).pipe(Effect.result);
        if (admitted._tag === "Failure") {
          if (admitted.failure._tag !== "CommandRefused") return yield* admitted.failure;
          continue;
        }
        const next = yield* current(context);
        const admission = own(next.roles.agents, action.agentId)?.openCrash;
        if (admission !== undefined) yield* continueCrash(context, admission);
      }
      yield* recover({ ...context, snapshot: yield* (yield* Views).snapshot });
    }),
    timers: (context) => {
      if (replay === undefined) return [];
      const live = input(context.snapshot, 0, context.sourceSequence);
      const origins: TimerOrigin[] = [];
      if (context.lists.boardEnabled !== false) for (const [group, members] of idleGroups(live)) {
        const origin = own(groups, group);
        if (origin === undefined) continue;
        for (const agent of members) {
          const parent = agent.parent;
          if (parent?._tag === "agent" && members.some((member) => member.agentId === parent.agentId)) continue;
          const report = latestIdleReport(live, group, agent.agentId, origin);
          origins.push({ key: `team-idle:${group}:${agent.agentId}`, rule: "team-idle", originSequence: report?.sequence ?? origin,
            delayMillis: Math.max(limitsFor(live, agent).teamIdleMinutes * 60_000,
              (own(live.roles.snoozes, group) ?? -Infinity) - (own(times, String(report?.sequence ?? origin)) ?? 0)) });
        }
      }
      // Age and turn clocks have separate origins and action identities.
      const roles = context.snapshot.roles as RolesView;
      for (const [id, agent] of Object.entries(roles.agents)) {
        const row = own(live.agents, id);
        if (row === undefined || row.state?._tag === "stopped" || row.state?._tag === "crashed") continue;
        const limits = limitsFor(live, row);
        if (agent.turnOpen && agent.turnStartSequence !== undefined && !own(live.turnExcluded, id)) origins.push({
          key: `runaway:turn:${id}`, rule: "runaway", originSequence: Math.max(agent.turnStartSequence, clockFloorSequence),
          delayMillis: limits.turnMinutes * 60_000 + (own(live.turnExcludedMillis, id) ?? 0) + 1,
        });
        const age = ageLimitFor(live, row);
        if (age !== undefined) origins.push({ key: `runaway:age:${id}`, rule: "runaway", originSequence: Math.max(agent.startedSequence, clockFloorSequence), delayMillis: age * 60_000 + 1 });
      }
      return origins;
    },
    onTimer: (context) => checkTimers(context),
  };
  return [rule];
};
