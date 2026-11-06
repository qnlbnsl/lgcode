import type { EventEnvelope } from "@sheprd/contracts";
import { expect, it } from "vitest";
import { apply, emptyViews } from "../../src/views/apply.ts";
import { holderAbove, mayActForHolder } from "../../src/routing/holders.ts";
import { loadLists, productionModule, type Caller, type EngineLists, type View } from "../support/fixturePiece.ts";
import { envelopes, event, started } from "../support/viewFixtures.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

type Visible = (caller: Caller, envelope: EventEnvelope, view: View, lists: EngineLists) => boolean;
const visible = async () => (await productionModule<{ visibleTo: Visible }>("api/visibility.ts")).visibleTo;
const owner = { _tag: "owner" } as const;
const agent = (agentId: string): Caller => ({ _tag: "agent", agentId });
const family = (state = "idle") => {
  const events = [
    event({ ...started, agentId: "root", parent: owner }),
    event({ ...started, agentId: "lead", parent: agent("root") }),
    event({ ...started, agentId: "worker", parent: agent("lead") }),
    event({ _tag: "SessionOpened", agentId: "root", session: { _tag: "acp", sessionId: "root-session" }, protocolVersion: 2, reloadable: true }),
    event({ _tag: "SessionOpened", agentId: "lead", session: { _tag: "acp", sessionId: "lead-session" }, protocolVersion: 2, reloadable: true }),
  ];
  if (state !== "idle") events.push(event({ _tag: "StateChanged", agentId: "lead", state:
    state === "paused" ? { _tag: state, reason: "limit", midTurn: false }
      : state === "interrupted" ? { _tag: state, previous: "idle" } : { _tag: state },
  }));
  return envelopes(events).reduce(apply, emptyViews()) as View;
};
const sample = (agentId?: string): EventEnvelope => envelopes([event({
  _tag: "ThreadItem", agentId: agentId ?? "worker", itemId: "item-a", content: { _tag: "text", text: "Data." }, replay: false,
})])[0]!;

it.each([
  ["root", "root", true], ["root", "lead", true], ["root", "worker", false],
  ["lead", "worker", true], ["worker", "lead", false], ["stranger", "worker", false],
] as const)("1.5 agent-scoped: %s reads %s = %s, without exposing a whole subtree", async (caller, subject, want) => {
  expect((await visible())(agent(caller), sample(subject), family(), await loadLists())).toBe(want);
});

it.each(["starting", "paused", "interrupted", "crashed", "stopped"])("1.28 the root reads a worker while its lead is %s, and loses that read on recovery", async (state) => {
  const rule = await visible();
  const lists = await loadLists();
  expect(rule(agent("root"), sample(), family(state), lists)).toBe(true);
  expect(rule(agent("root"), sample(), family(), lists)).toBe(false);
  expect(rule(agent("lead"), sample(), family(state), lists)).toBe(true);
});

it("1.5 owner sees every class; agents cannot see owner-only or agent-less envelopes", async () => {
  const rule = await visible();
  const base = await loadLists();
  const scoped = sample();
  const { agentId: _id, ...agentless } = scoped;
  expect(rule(agent("lead"), agentless, family(), base)).toBe(false);
  const lists = { ...base, visibility: { ...base.visibility, ThreadItem: "owner-only" as const } };
  expect(rule(owner, scoped, family(), lists)).toBe(true);
  expect(rule(agent("lead"), scoped, family(), lists)).toBe(false);
});

it("1.5 piece-decided visibility is consulted for agents and fails closed when it throws", async () => {
  const rule = await visible();
  const base = await loadLists();
  const lists = { ...base, visibility: { ...base.visibility, ThreadItem: "piece-decided" as const },
    pieceVisibility: { ...base.pieceVisibility, ThreadItem: (caller: Caller) => caller._tag === "agent" && caller.agentId === "lead" },
  };
  expect(rule(agent("lead"), sample(), family(), lists)).toBe(true);
  expect(rule(agent("worker"), sample(), family(), lists)).toBe(false);
  expect(rule(owner, sample(), family(), lists)).toBe(true);
  const throwing = { ...lists, pieceVisibility: { ...lists.pieceVisibility, ThreadItem: () => { throw new Error("agent supplied text"); } } };
  expect(rule(agent("lead"), sample(), family(), throwing)).toBe(false);
});

it("1a E22 read and management helpers do not mutate the snapshot and management follows the effective holder", () => {
  const view = family("paused");
  const before = structuredClone(view);
  expect(holderAbove(view, "worker")).toEqual(agent("root"));
  expect(mayActForHolder(view, agent("root") as never, agent("lead") as never)).toBe(true);
  expect(view).toEqual(before);
});
