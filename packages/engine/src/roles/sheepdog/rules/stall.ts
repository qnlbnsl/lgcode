import type { NoticeAction } from "../notices.ts";

// The evaluator accepts a compact projection. The service's adapter below this
// rule supplies these fields from a single engine/board snapshot.
type Party = string | { readonly _tag: string; readonly agentId?: string };
interface Agent {
  readonly state: string | { readonly _tag: string };
  readonly parent: Party;
  readonly role: string;
  readonly capacityHeld?: boolean;
  readonly pause?: { readonly kind: string; readonly resetAt?: number };
  readonly sheepdogTurn?: boolean;
  readonly stallMinutes?: number;
}
export interface StallPost {
  readonly postId: string;
  readonly author: Party;
  readonly reply: string;
  readonly sequence?: number;
  readonly status?: string;
  readonly addressees?: ReadonlyArray<{ readonly agentId: string; readonly disposition?: string | null }>;
  readonly to?: ReadonlyArray<Party>;
  readonly dispositions?: Readonly<Record<string, string>>;
  readonly replies?: ReadonlyArray<{ readonly author: Party }>;
}
export interface StallEpisode {
  readonly post: StallPost;
  readonly addressee: string;
  readonly elapsed: number;
  readonly occurrence?: number;
  readonly originSequence?: number;
}
export interface StallInput {
  readonly now: number;
  readonly snapshot: {
    readonly sequence: number;
    readonly agents: Readonly<Record<string, Agent>>;
    readonly deliveries: Readonly<Record<string, { readonly agentId?: string; readonly target?: string; readonly status?: string;
      readonly sheepdog?: boolean; readonly source?: { readonly _tag: string; readonly namespace?: string } }>>;
    readonly roles: { readonly settings: { readonly sheepdog?: boolean }; readonly actions: ReadonlyArray<{
      readonly _tag: string; readonly agentId: string; readonly stalledPostId?: string; readonly postId?: string; readonly occurrence: number;
    }> };
  };
  readonly status: {
    readonly disabled: boolean;
    readonly sequence?: number;
    readonly posts?: ReadonlyArray<StallPost>;
    readonly own?: ReadonlyArray<StallPost>;
    readonly incoming?: ReadonlyArray<{ readonly postId: string; readonly author?: Party; readonly addressee?: string; readonly disposition?: string }>;
    readonly closed?: ReadonlyArray<string>;
    readonly conditions?: { readonly sequence: number };
  };
  readonly engineWaits?: ReadonlyArray<{ readonly waiter: string; readonly members: ReadonlyArray<string> }>;
  readonly openRequests?: ReadonlyArray<{ readonly agentId: string; readonly holder: Party }>;
  readonly episode?: StallEpisode;
  readonly waitingEpisode?: StallEpisode;
  readonly threadItems?: ReadonlyArray<{ readonly agentId: string; readonly kind: string }>;
  readonly recentPosts?: ReadonlyArray<{ readonly author: Party; readonly sheepdogTurn?: boolean }>;
}
const get = <T>(rows: Readonly<Record<string, T>>, id: string): T | undefined => Object.hasOwn(rows, id) ? rows[id] : undefined;
export const partyId = (party: Party): string => typeof party === "string" ? party : party._tag === "owner" ? "owner" : party.agentId ?? "";
export const stateTag = (agent: Agent): string => typeof agent.state === "string" ? agent.state : agent.state._tag;
const live = (agent: Agent | undefined): agent is Agent => agent !== undefined && !["stopped", "crashed"].includes(stateTag(agent));
export const postAddressees = (post: StallPost): ReadonlyArray<string> => post.addressees !== undefined
  ? post.addressees.filter((row) => row.disposition == null || row.disposition === "no-answer").map((row) => row.agentId)
  : (post.to ?? []).map(partyId).filter((id) => get(post.dispositions ?? {}, id) === undefined || get(post.dispositions ?? {}, id) === "no-answer");
const sheepdogDelivery = (delivery: StallInput["snapshot"]["deliveries"][string]) => delivery.sheepdog === true
  || delivery.source?._tag === "piece" && delivery.source.namespace === "roles";
export const busy = (input: StallInput, id: string): boolean => {
  const agent = get(input.snapshot.agents, id);
  if (!live(agent)) return false;
  if (agent.capacityHeld || agent.pause?.kind === "usage-limit" && agent.pause.resetAt !== undefined) return true;
  const deliveries = Object.values(input.snapshot.deliveries).filter((row) => (row.target ?? row.agentId) === id);
  if (deliveries.some((row) => (row.status === "queued" || row.status === "sent") && !sheepdogDelivery(row))) return true;
  return stateTag(agent) === "starting" || stateTag(agent) === "working" && !agent.sheepdogTurn
    && !(deliveries.length > 0 && deliveries.every(sheepdogDelivery));
};
const ownerHeld = (input: StallInput, id: string): boolean => {
  if (id === "owner") return true;
  const agent = get(input.snapshot.agents, id);
  return live(agent) && agent.pause !== undefined && (agent.pause.kind !== "usage-limit" || agent.pause.resetAt === undefined);
};
export type WaitingTest = (id: string, excluded?: string) => boolean;
// Build the graph once for a snapshot. Thousands of posts may share the same
// author and addressee, so edges and search results are shared across pairs.
export const makeWaitingTest = (input: StallInput): WaitingTest => {
  const graph = new Map<string, Set<string>>();
  const requests = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    if (!live(get(input.snapshot.agents, from))) return;
    let edges = graph.get(from);
    if (edges === undefined) { edges = new Set(); graph.set(from, edges); }
    edges.add(to);
  };
  for (const [id, row] of Object.entries(input.snapshot.agents)) link(partyId(row.parent), id);
  for (const row of input.engineWaits ?? []) for (const member of row.members) link(row.waiter, member);
  for (const row of input.openRequests ?? []) {
    if (!live(get(input.snapshot.agents, row.agentId))) continue;
    const target = partyId(row.holder);
    link(row.agentId, target);
    let holders = requests.get(row.agentId);
    if (holders === undefined) { holders = new Set(); requests.set(row.agentId, holders); }
    holders.add(target);
  }
  for (const posts of [input.status.posts ?? [], input.status.own ?? [],
    [input.episode?.post, input.waitingEpisode?.post].filter((post) => post !== undefined)]) {
    for (const post of posts) if (post.status !== "closed" && post.reply !== "none") {
      for (const target of postAddressees(post)) link(partyId(post.author), target);
    }
  }
  for (const row of input.status.incoming ?? []) if (row.author !== undefined && row.addressee !== undefined) link(partyId(row.author), row.addressee);
  const active = new Map<string, boolean>();
  const cache = new Map<string, boolean>();
  return (id, excluded) => {
    const key = JSON.stringify([id, excluded]);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const hasRequest = (asker: string) => [...requests.get(asker) ?? []].some((holder) => holder !== excluded);
    const seen = new Set([id]);
    const pending = [...graph.get(id) ?? []];
    let waiting = hasRequest(id);
    while (!waiting && pending.length > 0) {
      const next = pending.pop()!;
      if (next === excluded || seen.has(next)) continue;
      seen.add(next);
      let running = active.get(next);
      if (running === undefined) { running = busy(input, next) || ownerHeld(input, next); active.set(next, running); }
      waiting = running || hasRequest(next);
      if (!waiting) pending.push(...graph.get(next) ?? []);
    }
    cache.set(key, waiting);
    return waiting;
  };
};
export const waitingOnOthers = (input: StallInput, id: string, excluded?: string): boolean => makeWaitingTest(input)(id, excluded);
export const stallEligible = (input: StallInput, episode: StallEpisode, waiting: WaitingTest = makeWaitingTest(input)): boolean => {
  const { post, addressee } = episode;
  const agent = get(input.snapshot.agents, addressee);
  if (input.status.disabled || input.snapshot.roles.settings.sheepdog === false
    || input.status.sequence !== undefined && input.status.sequence !== input.snapshot.sequence
    || input.status.conditions !== undefined && input.status.conditions.sequence !== input.snapshot.sequence
    || agent === undefined || stateTag(agent) !== "idle" || agent.pause !== undefined || agent.capacityHeld
    || Object.values(input.snapshot.deliveries).some((row) => (row.target ?? row.agentId) === addressee && (row.status === "queued" || row.status === "sent"))
    || post.status === "closed" || input.status.closed?.includes(post.postId) || post.reply === "none" || !postAddressees(post).includes(addressee)) return false;
  if (!waiting(addressee)) return true;
  const author = partyId(post.author);
  // An idle author blocked solely through this addressee can still ask it to
  // answer, even when the addressee has a different busy child.
  return author !== addressee && live(get(input.snapshot.agents, author)) && !busy(input, author) && !ownerHeld(input, author)
    && !waiting(author, addressee);
};
const holder = (input: StallInput, id: string): string => {
  const seen = new Set([id]);
  let next = partyId(get(input.snapshot.agents, id)?.parent ?? "owner");
  while (next !== "owner" && !seen.has(next)) {
    seen.add(next);
    const row = get(input.snapshot.agents, next);
    if (row === undefined) break;
    if (["idle", "working"].includes(stateTag(row))) return next;
    next = partyId(row.parent);
  }
  return "owner";
};
export const evaluateStall = (input: StallInput): ReadonlyArray<NoticeAction> => {
  const actions: NoticeAction[] = [];
  const waiting = makeWaitingTest(input);
  for (const episode of [input.episode, input.waitingEpisode]) {
    if (episode === undefined || !stallEligible(input, episode, waiting)) continue;
    const agent = get(input.snapshot.agents, episode.addressee)!;
    const limit = agent.stallMinutes ?? (agent.role.startsWith("lead") || agent.role.startsWith("orchestrator") ? 20 : 10);
    if (episode.elapsed < limit * 60_000) continue;
    const progressed = input.threadItems?.some((item) => item.agentId === episode.addressee && item.kind === "file-change")
      || input.recentPosts?.some((post) => partyId(post.author) === episode.addressee && !post.sheepdogTurn)
      || input.status.own?.some((post) => post.postId === episode.post.postId && post.replies?.some((reply) => partyId(reply.author) === episode.addressee));
    const previous = progressed ? 0 : episode.occurrence ?? Math.max(0, ...input.snapshot.roles.actions.filter((action) => action.agentId === episode.addressee
      && (action.stalledPostId ?? action.postId) === episode.post.postId && ["roles.StallSeen", "roles.ReplaceAdvised"].includes(action._tag)).map((action) => action.occurrence));
    if (previous >= 3) continue;
    const occurrence = previous + 1;
    const base = { agentId: episode.addressee, stalledPostId: episode.post.postId,
      triggerSequence: episode.originSequence ?? episode.post.sequence ?? input.snapshot.sequence,
      sourceSequence: input.snapshot.sequence, occurrence };
    const action = (tag: "roles.StallSeen" | "roles.ReplaceAdvised", recipient: string) => ({ ...base, _tag: tag, noticeRecipient: recipient }) as NoticeAction;
    if (occurrence === 3) actions.push(action("roles.ReplaceAdvised", holder(input, episode.addressee)));
    else {
      actions.push(action("roles.StallSeen", episode.addressee));
      if (occurrence === 2) actions.push(action("roles.StallSeen", holder(input, episode.addressee)));
    }
  }
  return actions;
};
