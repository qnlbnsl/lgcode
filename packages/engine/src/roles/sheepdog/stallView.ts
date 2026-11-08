import type { Event } from "@lgcode/contracts";
import { settled } from "@lgcode/contracts/settled";
import type { Snapshot } from "../../commands/internal.ts";
import { boardStatus } from "../../board/status.ts";
import type { RolesView, StallClock } from "../view.ts";
import { deliveryIsSheepdogTurn } from "./notices.ts";
import { resolveSettings, roleSettings } from "./settings.ts";
import { makeWaitingTest, postAddressees, stallEligible, type StallInput } from "./rules/stall.ts";

export const stallKey = (postId: string, agentId: string): string => JSON.stringify([postId, agentId]);
const own = <T>(rows: Readonly<Record<string, T>>, id: string): T | undefined => Object.hasOwn(rows, id) ? rows[id] : undefined;
export const stallInput = (snapshot: Snapshot, enabled = true): StallInput => {
  const roles = snapshot.roles as RolesView;
  const deliveries = Object.fromEntries(Object.entries(snapshot.deliveries).map(([id, row]) => [id, {
    target: row.target, status: row.status, sheepdog: deliveryIsSheepdogTurn(snapshot, id),
  }]));
  const agents = Object.fromEntries(Object.entries(snapshot.agents).map(([id, row]) => {
    const account = own(snapshot.accounts, row.account);
    const current = own(roles.agents, id)?.turnStartSequence;
    const turn = current === undefined ? undefined : own(snapshot.threads, id)?.find((envelope) => envelope.sequence === current);
    const sheepdogTurn = turn?.event._tag === "DeliverySent" && deliveryIsSheepdogTurn(snapshot, turn.event.deliveryId);
    return [id, {
      state: row.state, role: row.role, parent: row.parent, capacityHeld: row.capacityHeld, sheepdogTurn,
      stallMinutes: resolveSettings(roles.settings, roleSettings(roles.file, row.role)).stallMinutes,
      ...(row.state._tag === "paused" ? { pause: { kind: row.state.reason === "signed-out" ? "signed-out" : "usage-limit",
        ...(row.state.resetAt === undefined ? {} : { resetAt: row.state.resetAt }) } } : account?.status === "needs-sign-in" ? { pause: { kind: "signed-out" } }
        : account?.status === "out-of-usage" ? { pause: { kind: "usage-limit", ...(account.resetAt === undefined ? {} : { resetAt: account.resetAt }) } } : {}),
    }];
  }));
  return {
    now: 0, snapshot: { sequence: snapshot.sequence, agents, deliveries, roles }, status: { ...boardStatus(snapshot), disabled: !enabled },
    engineWaits: Object.values(snapshot.waits).filter((row) => row.status === "open").map((row) => ({ waiter: row.agentId, members: row.members })),
    openRequests: [...Object.values(snapshot.requests), ...Object.values(snapshot.questions)].filter((row) => row.status === "open"
      && !["stopped", "crashed"].includes(own(snapshot.agents, row.agentId)?.state._tag ?? "stopped")),
  };
};

// Only sequences enter this view. All clocks are re-created by the same pure
// join after a live event, a projection, or a log rebuild. No wall time is read.
export const observeStalls = (snapshot: Snapshot, event: Event, sequence: number): RolesView => {
  const roles = snapshot.roles as RolesView;
  if (roles.baseline === undefined) return roles;
  if (boardStatus(snapshot).posts.length === 0) return Object.keys(roles.stalls).length === 0 ? roles : { ...roles, stalls: {} };
  const input = stallInput(snapshot, roles.boardClock?.on !== false);
  const waiting = makeWaitingTest(input);
  const ready = new Map<string, boolean>();
  const stalls: Record<string, StallClock> = Object.create(null) as Record<string, StallClock>;
  for (const post of input.status.posts ?? []) for (const agentId of postAddressees(post)) {
    if (!Object.hasOwn(snapshot.agents, agentId)) continue;
    const key = stallKey(post.postId, agentId);
    const previous = own(roles.stalls, key);
    let occurrence = previous?.occurrence ?? 0;
    let originSequence = previous?.originSequence;
    const turn = own(roles.agents, agentId)?.turnStartSequence;
    const start = turn === undefined ? undefined : own(snapshot.threads, agentId)?.find((row) => row.sequence === turn);
    const sheepdog = own(roles.agents, agentId)?.turnOpen === true && start?.event._tag === "DeliverySent" && deliveryIsSheepdogTurn(snapshot, start.event.deliveryId);
    const progress = event._tag === "ThreadItem" && event.agentId === agentId && event.content._tag === "file-change" && !event.replay
      || event._tag === "board.PostWritten" && event.author._tag === "agent" && event.author.agentId === agentId
        && (event.replyToPostId === post.postId || !sheepdog);
    if (progress) { occurrence = 0; originSequence = undefined; }
    if ((event._tag === "roles.StallSeen" || event._tag === "roles.ReplaceAdvised") && event.stalledPostId === post.postId
      && event.agentId === agentId && event.occurrence > occurrence) {
      occurrence = event.occurrence;
      originSequence = sequence;
    }
    // The shared engine predicate supplies the lifecycle, hold and queue part.
    // Requests and waits belong to the transitive graph, including its owed-link
    // exception, so they are evaluated by stallEligible rather than twice here.
    let engineReady = ready.get(agentId);
    if (engineReady === undefined) {
      engineReady = settled({ ...snapshot, requests: {}, questions: {}, waits: {} }, agentId);
      ready.set(agentId, engineReady);
    }
    const eligible = roles.baseline.on === true && engineReady && stallEligible(input, { post, addressee: agentId, elapsed: 0 }, waiting);
    if (!eligible) originSequence = undefined;
    else if (originSequence === undefined || event._tag === "TurnEnded" && event.agentId === agentId) originSequence = sequence;
    stalls[key] = { postId: post.postId, agentId, occurrence, ...(originSequence === undefined ? {} : { originSequence }) };
  }
  return { ...roles, stalls };
};
