// Pattern: T3 Code packages/effect-acp/src/client.ts (`loadSession`, line 91;
// MIT licence; the copy here is third_party/t3code/effect-acp/src/client.ts):
// a session is reloaded through whichever method the peer advertised. The
// shape was reused, no code.
import { randomUUID } from "node:crypto";
import { PermissionLevel, type Actor, type AgentId, type Event } from "@shephrd/contracts";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { checkFolder, folderForSpawn } from "../identity/ceiling.ts";
import type { mintAgentToken } from "../identity/tokens.ts";
import type { LogWriteFailed } from "../log/EventLog.ts";
import { freshDelivery } from "../routing/holders.ts";
import { withWaitChecks } from "../routing/waits.ts";
import { RunnerRejected, type Runner, type SessionInfo } from "../runner/Runner.ts";
import {
  freshRequest, readHarnesses, refused, type Agent, type CommandRefused, type Runtime, type Snapshot,
} from "../commands/internal.ts";
import { carryOnText } from "../accounts/available.ts";
import { replayedDelivery, userRuns } from "./replay.ts";

type Spawn = Parameters<Context.Service.Shape<typeof Runner>["start"]>[0];
type Token = ReturnType<typeof mintAgentToken>;

// Issue 103: no adapter setup may hold recovery, a return or a resume for
// ever. A setup that has not finished in time is stopped through the runner.
export const SETUP_TIMEOUT_MILLIS = 120_000;

const RESTART_CARRY_ON = "The engine restarted. Carry on with what you were doing.";

// What the runner needs to start or reload an agent, checked again as for a
// spawn (rows 56 and 65). Any refusal is the fixed "command refused".
export const spawnInput = (
  runtime: Runtime, snapshot: Snapshot, agent: Agent, token: Redacted.Redacted<string>, operation: "resume" | "reload",
): Effect.Effect<Spawn, CommandRefused | LogWriteFailed> => Effect.gen(function* () {
  const parent = agent.parent._tag === "agent" ? snapshot.agents[agent.parent.agentId] : undefined;
  if (agent.parent._tag === "agent" && parent === undefined) return yield* refused();
  const grant = yield* checkFolder({ ...runtime, caller: agent.parent,
    parentFolder: parent?.folder ?? agent.folder, folder: agent.folder,
  }).pipe(Effect.mapError(() => refused()));
  if (grant.realPath !== agent.folder) return yield* refused();
  const folder = yield* folderForSpawn(grant, operation).pipe(Effect.mapError(() => refused()));
  const harness = (yield* readHarnesses(runtime)).find((settings) => settings.id === agent.harness);
  const account = snapshot.accounts[agent.account];
  if (harness === undefined || account === undefined) return yield* refused();
  return { agentId: agent.agentId, token, folder, grant, harness, account,
    permission: Schema.decodeUnknownSync(PermissionLevel)(agent.permission),
    ...(agent.model === undefined ? {} : { model: agent.model }), ...(agent.effort === undefined ? {} : { effort: agent.effort }),
  };
});

// Bounded setup with cleanup (issue 103). The caller holds the agent's send
// lane, which serializes setups for one agent.
const bounded = (runtime: Runtime, agentId: AgentId, timeoutMillis: number, setup: Effect.Effect<SessionInfo, RunnerRejected>) =>
  setup.pipe(
    Effect.timeoutOption(timeoutMillis),
    Effect.flatMap((result) => Option.isSome(result) ? Effect.succeed(result.value)
      : runtime.runner.stop({ agentId }).pipe(
        Effect.catchTag("RunnerRejected", () => Effect.void),
        Effect.andThen(Effect.fail(new RunnerRejected({ reason: "adapter setup timed out" }))),
      )),
  );

// Row 66: what one successful reload commits, in one transaction with the
// session. Each delivery that was sent but not accepted is either accepted,
// when the replayed user content names it, or put back at the head of the
// queue to be sent again. A carry-on goes to an agent that was mid-turn, or
// whose replay showed its delivery accepted, and has nothing left to send
// again; an earlier run's queued carry-on is kept rather than repeated. The
// agent is working when it has something to send again or carry on, so it
// does not count as settled at step 9; otherwise it is idle.
export const reloadedEvents = (
  snapshot: Snapshot, agentId: AgentId, session: SessionInfo, midTurn: boolean, carryText: string,
): ReadonlyArray<Event> => {
  const runs = userRuns(session.replay ?? []);
  const agent = snapshot.agents[agentId]!;
  const rows = Object.values(snapshot.deliveries).filter((row) => row.target === agentId);
  const sent = rows.filter((row) => row.status === "sent");
  const found = sent.filter((row) => replayedDelivery(runs, row.id));
  const unaccepted = sent.filter((row) => !found.includes(row));
  const requeued = rows.filter((row) => row.status === "queued" && row.reason !== undefined && row.content._tag !== "carry-on");
  const carried = rows.some((row) => row.status === "queued" && row.content._tag === "carry-on");
  const retry = unaccepted.length > 0 || requeued.length > 0;
  const carry = !retry && !carried && (found.length > 0 || midTurn);
  const id = freshDelivery();
  return [
    ...(agent.state._tag === "starting" ? [] : [{ _tag: "StateChanged" as const, agentId, state: { _tag: "starting" as const } }]),
    // Named fields only: the replayed text never reaches the log (row 51).
    { _tag: "SessionOpened", agentId, session: session.session, protocolVersion: session.protocolVersion, reloadable: session.reloadable },
    ...found.map((row): Event => ({ _tag: "DeliveryAccepted", agentId, deliveryId: row.id })),
    ...unaccepted.map((row): Event => ({ _tag: "DeliveryRequeued", agentId, deliveryId: row.id, reason: "agent interrupted" })),
    ...(carry ? [{ _tag: "DeliveryQueued" as const, delivery: {
      id, target: agentId, sender: { _tag: "owner" as const }, content: { _tag: "carry-on" as const, text: carryOnText(id, carryText) },
    } }] : []),
    ...(retry || carry || carried ? [{ _tag: "StateChanged" as const, agentId, state: { _tag: "working" as const } }] : []),
  ];
};

export interface Reload {
  readonly runtime: Runtime;
  readonly actor: Actor;
  readonly agent: Agent;
  readonly spawn: Spawn;
  readonly token: Token;
  readonly mode: "load" | "start";
  readonly midTurn: boolean;
  readonly timeoutMillis: number;
  // Whether the success transaction stores the new token. A resume stored it
  // with its command; recovery and a return store it only on success.
  readonly storeToken: boolean;
  readonly carryText?: string;
  // The state the agent must still be in when either result is written.
  readonly still: (agent: Agent | undefined) => boolean;
  readonly failed: (snapshot: Snapshot) => ReadonlyArray<Event>;
}

// Starts or reloads one agent and writes the result. Nothing is committed
// before the setup returns (row 66). A failure writes the caller's fixed
// events and revokes the agent's tokens, and never carries the runner's
// reason. Returns whether the session opened and was recorded.
export const reload = (input: Reload): Effect.Effect<boolean, LogWriteFailed> => Effect.gen(function* () {
  const { runtime, agent, spawn, token } = input;
  const agentId = agent.agentId;
  const setup = Effect.suspend(() => input.mode === "start" || agent.session === undefined
    ? runtime.runner.start(spawn) : runtime.runner.load({ ...spawn, session: agent.session }));
  const outcome = yield* bounded(runtime, agentId, input.timeoutMillis, setup).pipe(Effect.result);
  const recorded = yield* runtime.log.transact((append) => Effect.gen(function* () {
    const snapshot = yield* runtime.views.snapshot;
    if (!input.still(snapshot.agents[agentId])) return false;
    if (outcome._tag === "Failure") {
      yield* append(input.actor, freshRequest(), randomUUID(), withWaitChecks(snapshot, input.failed(snapshot)), { revokeAgentTokens: [agentId] });
      return false;
    }
    const events = reloadedEvents(snapshot, agentId, outcome.success, input.midTurn, input.carryText ?? RESTART_CARRY_ON);
    yield* append(input.actor, freshRequest(), randomUUID(), withWaitChecks(snapshot, events), input.storeToken
      ? { revokeAgentTokens: [agentId], agentTokens: [{ agentId, tokenHash: token.tokenHash, revokedAt: null }] } : {});
    return true;
  })).pipe(Effect.catchTag("RequestIdReused", () => Effect.succeed(false)));
  // A stop or crash won while the session opened: the new process has no
  // record and must not outlive this call.
  if (!recorded && outcome._tag === "Success") yield* runtime.runner.stop({ agentId }).pipe(Effect.catchTag("RunnerRejected", () => Effect.void));
  return recorded;
});
