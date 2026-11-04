import { expect, it } from "vitest";

import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import {
  access, agent, board, channel, crash, direct, event, group, history, memberIds, membersChanged,
  noReply, owner, pause, plain, post, question, service, session, snapshot, state, stop, tree, withCeilings,
} from "./accessFixtures.ts";

registerRebuildCheck({ noLog: true }); // Pure rules; history() checks replay at each prefix.

it("2.4 adding members: catches adding a sibling or cousin, or letting an ordinary member manage", async () => {
  const view = snapshot(...tree, plain);
  const rules = await access();
  expect(rules.canAddMember(view, agent("lead"), "room", "new-child")).toBe(true);
  expect(rules.canAddMember(view, agent("lead"), "room", "root")).toBe(true);
  for (const id of ["sibling", "cousin", "grandchild", "stranger"]) {
    expect(rules.canAddMember(view, agent("lead"), "room", id), id).toBe(false);
    expect(rules.canAddMember(view, owner, "room", id), `owner adds ${id}`).toBe(true);
  }
  expect(rules.canAddMember(view, agent("worker"), "room", "grandchild")).toBe(false);
  expect(rules.canAddMember(view, service, "room", "worker")).toBe(false);
});

it("2.5 manager rights pass up: catches treating a pause or account change as a seat transfer", async () => {
  const views = history([...tree, plain, pause("lead"), event({ _tag: "AccountChanged", accountId: "primary",
    account: { id: "primary", harness: "first", displayName: "Primary", enabled: false } }), state("lead", { _tag: "idle" })]);
  const rules = await access();
  for (const view of views.slice(tree.length + 1)) {
    expect(rules.canManage(view, agent("lead"), "room")).toBe(true);
    expect(rules.canManage(view, agent("root"), "room")).toBe(false);
    expect(board(view).channels["room"]?.manager).toEqual(agent("lead"));
  }
});

it("2.5 manager rights pass up: catches permanent inheritance or membership on a recoverable crash", async () => {
  const events = [...tree, group(), post("question", { channelId: "group", author: agent("worker") })];
  const before = snapshot(...events);
  const crashed = snapshot(...events, crash("lead"));
  const resumed = snapshot(...events, crash("lead"), state("lead", { _tag: "starting" }), session("lead", true));
  const rules = await access();
  expect(rules.canManage(crashed, agent("root"), "group")).toBe(true);
  expect(rules.canClose(crashed, agent("root"), "question")).toBe(true);
  expect(rules.canAddMember(snapshot(...tree, plain, crash("lead")), owner, "room", "stranger")).toBe(true);
  expect(rules.canRead(crashed, agent("root"), "group")).toBe(false);
  expect(rules.canManage(resumed, agent("root"), "group")).toBe(false);
  expect(rules.canClose(resumed, agent("root"), "question")).toBe(false);
  expect(rules.canManage(resumed, agent("lead"), "group")).toBe(true);
  expect(rules.channelMembers(crashed, "group")).toEqual(rules.channelMembers(before, "group"));
  expect(board(crashed).channels["group"]?.manager).toEqual(agent("lead"));
});

it.each([false, true])("2.5 manager rights pass up: interrupted manager reloadable=%s catches wrong acting rights", async (reloadable) => {
  const view = snapshot(...tree, plain, session("lead", reloadable),
    event({ _tag: "AgentInterrupted", agentId: "lead", previous: "idle" }));
  const rules = await access();
  expect(rules.canManage(view, owner, "room")).toBe(true);
  expect(rules.canManage(view, agent("root"), "room")).toBe(!reloadable);
  expect(board(view).channels["room"]?.manager).toEqual(agent("lead"));
});

it("2.5 manager rights pass up: catches skipping a paused ancestor when the manager stops", async () => {
  const view = snapshot(...tree, plain, pause("root"), stop("lead"));
  const rules = await access();
  expect(rules.successorManager(view, "room")).toEqual(agent("root"));
  const inherited = snapshot(...tree, plain, pause("root"), stop("lead"),
    event({ _tag: "board.ManagerChanged", channelId: "room", manager: agent("root") }));
  expect(rules.canManage(inherited, agent("root"), "room")).toBe(true);
  expect(memberIds(rules.channelMembers(inherited, "room"))).toEqual(["lead", "other", "root", "worker"]);
  expect(rules.canManage(inherited, agent("lead"), "room")).toBe(false);
});

it.each(["crashed", "stopped", "interrupted"] as const)("2.5 manager rights pass up: catches inheriting to an unavailable %s ancestor", async (kind) => {
  const unavailable = kind === "crashed" ? [crash("root")] : kind === "stopped" ? [stop("root")]
    : [session("root", false), event({ _tag: "AgentInterrupted", agentId: "root", previous: "idle" })];
  const view = snapshot(...tree, plain, ...unavailable, stop("lead"));
  const rules = await access();
  expect(rules.successorManager(view, "room")).toEqual(owner);
  expect(rules.successorManager(snapshot(...tree, plain, session("root", true),
    event({ _tag: "AgentInterrupted", agentId: "root", previous: "idle" }), stop("lead")), "room")).toEqual(agent("root"));
});

it("2.5 manager rights pass up: catches returning a stored seat to its resumed opener", async () => {
  const view = snapshot(...tree, plain, stop("lead"), event({ _tag: "board.ManagerChanged", channelId: "room", manager: agent("root") }),
    state("lead", { _tag: "starting" }));
  const rules = await access();
  expect(rules.canManage(view, agent("root"), "room")).toBe(true);
  expect(rules.canManage(view, agent("lead"), "room")).toBe(false);
  expect(rules.canRead(view, agent("lead"), "room")).toBe(true);
});

it("2.6 group channels: catches admitting label carriers outside the fixed anchor subtree", async () => {
  const view = snapshot(...tree, group(), event({ _tag: "AgentGrouped", agentId: "stranger", groups: ["review"] }));
  const rules = await access();
  expect(memberIds(rules.channelMembers(view, "group"))).toEqual(["lead", "other", "worker"]);
  expect(rules.canPost(view, agent("lead"), question("worker", "group"))).toBe(true);
  expect(rules.canPost(view, agent("cousin"), noReply("group"))).toBe(false);
  expect(rules.canPost(view, agent("stranger"), noReply("group"))).toBe(false);
});

it("2.6 group channels: catches ignoring an owner-chosen anchor or letting an agent choose another", async () => {
  const view = snapshot(...tree, group({ opener: owner, manager: owner, anchorAgentId: "worker" }));
  const rules = await access();
  expect(memberIds(rules.channelMembers(view, "group"))).toEqual(["owner", "worker"]);
  expect(rules.canOpenGroup(view, owner, "review", "worker")).toBe(true);
  expect(rules.canOpenGroup(view, agent("lead"), "review", "lead")).toBe(true);
  expect(rules.canOpenGroup(view, agent("lead"), "review")).toBe(true);
  expect(rules.canOpenGroup(view, agent("lead"), "review", "root")).toBe(false);
  expect(rules.canOpenGroup(view, agent("lead"), "review", "worker")).toBe(false);
});

it("2.6 group channels: catches binding a label carried only by another subtree", async () => {
  const view = snapshot(...tree, event({ _tag: "AgentGrouped", agentId: "cousin", groups: ["external"] }));
  const rules = await access();
  expect(rules.canOpenGroup(view, agent("lead"), "review")).toBe(true);
  expect(rules.canOpenGroup(view, agent("lead"), "external")).toBe(false);
  expect(rules.canOpenGroup(view, agent("lead"), "missing")).toBe(false);
  expect(rules.canOpenGroup(view, service, "review")).toBe(false);
});

it("2.6 group channels: catches missing a child label grant or retaining a removed label", async () => {
  const before = snapshot(...tree, group());
  const joined = snapshot(...tree, group(), event({ _tag: "AgentGrouped", agentId: "grandchild", groups: ["review"] }));
  const left = snapshot(...tree, group(), event({ _tag: "AgentGrouped", agentId: "worker", groups: [] }));
  const rules = await access();
  expect(memberIds(rules.channelMembers(before, "group"))).toEqual(["lead", "other", "worker"]);
  expect(memberIds(rules.channelMembers(joined, "group"))).toEqual(["grandchild", "lead", "other", "worker"]);
  expect(memberIds(rules.channelMembers(left, "group"))).toEqual(["lead", "other"]);
});

it("2.6 group channels: catches membership changes on crash, interrupt, pause or resume", async () => {
  const views = history([...tree, group(), crash("worker"), session("worker", true),
    event({ _tag: "AgentInterrupted", agentId: "worker", previous: "idle" }), session("worker", true), pause("worker"),
    state("worker", { _tag: "idle" }), crash("lead"), pause("root"), state("root", { _tag: "idle" }), session("lead", true)]);
  const rules = await access();
  for (const view of views.slice(tree.length + 1)) {
    expect(memberIds(rules.channelMembers(view, "group"))).toEqual(["lead", "other", "worker"]);
  }
});

it("2.6 group channels: catches widening the anchor subtree when a stopped manager is replaced", async () => {
  const view = snapshot(...tree, group(), post("old", { channelId: "group" }), stop("lead"),
    event({ _tag: "board.ManagerChanged", channelId: "group", manager: agent("root") }));
  const rules = await access();
  expect(memberIds(rules.channelMembers(view, "group"))).toEqual(["other", "root", "worker"]);
  expect(board(view).channels["group"]?.anchorAgentId).toBe("lead");
  expect(board(view).readState["root"]?.["group"]?.watermark).toBe(board(view).posts["old"]?.sequence);
});

it("2.7 direct channels: catches replacing parentage with current holder availability", async () => {
  const view = snapshot(...tree, pause("lead"), direct(agent("lead"), agent("worker")));
  const rules = await access();
  expect(rules.directGrant(view, agent("lead"), agent("worker"))).toBe(true);
  expect(rules.directGrant(view, agent("worker"), agent("lead"))).toBe(true);
  expect(rules.canPost(view, agent("worker"), noReply("direct"))).toBe(true);
  expect(rules.directGrant(view, agent("lead"), agent("grandchild"))).toBe(false);
  expect(rules.directGrant(view, agent("worker"), agent("cousin"))).toBe(false);
});

it("2.7 direct channels: catches keeping a grant after losing the last of two shared channels", async () => {
  const events = [...tree, plain, channel({ channelId: "second", name: "Second" }), direct(agent("worker"), agent("other"))];
  const before = snapshot(...events);
  const oneLeft = snapshot(...events, membersChanged("room", ["worker"]));
  const noneLeft = snapshot(...events, membersChanged("room", ["worker"]), membersChanged("second", ["worker"]));
  const rules = await access();
  for (const view of [before, oneLeft]) {
    expect(rules.directGrant(view, agent("worker"), agent("other"))).toBe(true);
    expect(rules.canPost(view, agent("worker"), noReply("direct"))).toBe(true);
  }
  expect(rules.directGrant(noneLeft, agent("worker"), agent("other"))).toBe(false);
  expect(rules.canPost(noneLeft, agent("worker"), noReply("direct"))).toBe(false);
  expect(rules.canRead(noneLeft, agent("worker"), "direct")).toBe(true);
  expect(memberIds(rules.channelMembers(noneLeft, "direct"))).toEqual(["other", "worker"]);
});

it("2.7 direct channels: catches ending a shared-group grant or adding a manager after a crash", async () => {
  const events = [...tree, group(), direct(agent("worker"), agent("other"))];
  const views = history([...events, crash("worker"), session("worker", true)]);
  const rules = await access();
  for (const view of views.slice(events.length)) {
    expect(rules.directGrant(view, agent("worker"), agent("other"))).toBe(true);
    expect(memberIds(rules.channelMembers(view, "direct"))).toEqual(["other", "worker"]);
    expect(rules.successorManager(view, "direct")).toBeUndefined();
    expect(board(view).channels["direct"]?.manager).toBeUndefined();
  }
});

it("2.7/2.8 direct channels: catches dropping the service grant or giving the service read rights", async () => {
  const events = [...tree, direct(service, agent("worker"))];
  const views = history([...events, crash("worker"), session("worker", true)]);
  const rules = await access();
  for (const view of views.slice(events.length)) {
    expect(rules.directGrant(view, service, agent("worker"))).toBe(true);
    expect(rules.directGrant(view, agent("worker"), service)).toBe(true);
    expect(rules.canPost(view, service, noReply("direct"))).toBe(true);
    expect(rules.canRead(view, service, "direct")).toBe(false);
    expect(memberIds(rules.channelMembers(view, "direct"))).toEqual(["service:sheepdog", "worker"]);
    expect(rules.successorManager(view, "direct")).toBeUndefined();
  }
  expect(rules.directGrant(snapshot(...events, stop("worker")), service, agent("worker"))).toBe(false);
});

it("2.7 direct channels: catches requiring a shared channel for an owner pair", async () => {
  const view = snapshot(...tree, direct(owner, agent("worker")));
  const rules = await access();
  expect(rules.directGrant(view, owner, agent("worker"))).toBe(true);
  expect(rules.canPost(view, agent("worker"), noReply("direct"))).toBe(true);
  expect(rules.canRead(view, owner, "direct")).toBe(true);
  expect(rules.canRead(view, agent("other"), "direct")).toBe(false);
});

it("2.8 read and post: catches leaking channels to nonmembers or making owner and service access identical", async () => {
  const view = snapshot(...tree, plain);
  const rules = await access();
  expect(rules.canRead(view, agent("worker"), "room")).toBe(true);
  expect(rules.canPost(view, agent("worker"), noReply())).toBe(true);
  expect(rules.canRead(view, agent("cousin"), "room")).toBe(false);
  expect(rules.canPost(view, agent("cousin"), noReply())).toBe(false);
  expect(rules.canRead(view, owner, "room")).toBe(true);
  expect(rules.canPost(view, owner, noReply())).toBe(true);
  expect(rules.canRead(view, service, "room")).toBe(false);
  expect(rules.canPost(view, service, noReply())).toBe(true);
});

const ceilings = [
  ["read-only", "read-only", true], ["read-only", "ask", false], ["read-only", "edit", false], ["read-only", "full", false],
  ["ask", "read-only", true], ["ask", "ask", true], ["ask", "edit", false], ["ask", "full", false],
  ["edit", "read-only", true], ["edit", "ask", true], ["edit", "edit", true], ["edit", "full", false],
  ["full", "read-only", true], ["full", "ask", true], ["full", "edit", true], ["full", "full", true],
] as const;
it.each(ceilings)("2.9 ceiling: %s author to %s target catches reversed or incomplete permission ordering", async (author, target, allowed) => {
  const view = snapshot(...withCeilings({ worker: author, other: target }), plain);
  const rules = await access();
  expect(rules.canPost(view, agent("worker"), noReply())).toBe(true);
  expect(rules.canPost(view, agent("worker"), question("other"))).toBe(allowed);
});

it("2.9 ceiling: catches trusting a target's reported narrower mode instead of its start ceiling", async () => {
  const view = snapshot(...withCeilings({ worker: "read-only", other: "full" }), plain,
    event({ _tag: "ModeChanged", agentId: "other", mode: "read-only", level: "read-only" }));
  const rules = await access();
  expect(view.agents["other"]?.permission).toBe("read-only");
  expect(board(view).ceilings["other"]).toBe("full");
  expect(rules.canPost(view, agent("worker"), noReply())).toBe(true);
  expect(rules.canPost(view, agent("worker"), question("other"))).toBe(false);
});

it("2.9 ceiling: catches using current author mode or omitting the fixed ancestor exception", async () => {
  const view = snapshot(...withCeilings({ lead: "read-only", worker: "full" }),
    plain, membersChanged("room", [], ["grandchild"]),
    event({ _tag: "ModeChanged", agentId: "lead", mode: "read-only", level: "read-only" }));
  const rules = await access();
  expect(rules.canPost(view, agent("lead"), question("worker"))).toBe(true);
  expect(rules.canPost(view, agent("lead"), question("grandchild"))).toBe(true);
  expect(rules.canPost(snapshot(...withCeilings({ worker: "read-only" }), plain), agent("worker"), question("lead"))).toBe(true);
  const descendant = snapshot(...withCeilings({ grandchild: "read-only" }), plain, membersChanged("room", [], ["grandchild"]));
  expect(rules.canPost(descendant, agent("grandchild"), question("lead"))).toBe(true);
  const narrowed = snapshot(...withCeilings({ worker: "full", other: "full" }), plain,
    event({ _tag: "ModeChanged", agentId: "worker", mode: "read-only", level: "read-only" }));
  expect(rules.canPost(narrowed, agent("worker"), question("other"))).toBe(true);
});

it("2.9 ceiling: catches checking only the first addressee of a post", async () => {
  const view = snapshot(...withCeilings({ worker: "read-only", other: "full", lead: "read-only" }), plain);
  const rules = await access();
  expect(rules.canPost(view, agent("worker"), question("lead"))).toBe(true);
  expect(rules.canPost(view, agent("worker"), { channelId: "room", to: [agent("lead"), agent("other")], reply: "all" })).toBe(false);
  expect(rules.canPost(view, agent("worker"), { channelId: "room", to: [agent("other"), agent("lead")], reply: "any" })).toBe(false);
});

it("2.10 reply stays in its channel: catches cross-channel replies or a reply after membership removal", async () => {
  const events = [...tree, plain, channel({ channelId: "second", name: "Second" }), post("original")];
  const view = snapshot(...events);
  const rules = await access();
  expect(rules.canPost(view, agent("worker"), { ...noReply(), replyTo: "original" })).toBe(true);
  expect(rules.canPost(view, agent("worker"), { ...noReply("second"), replyTo: "original" })).toBe(false);
  expect(rules.canPost(snapshot(...events, membersChanged("room", ["worker"])), agent("worker"),
    { ...noReply(), replyTo: "original" })).toBe(false);
  expect(rules.canPost(view, agent("worker"), { ...noReply(), replyTo: "missing" })).toBe(false);
});
