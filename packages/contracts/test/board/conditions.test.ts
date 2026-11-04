import { describe, expect, it } from "vitest";
import { agent, emptyView, exported, openPost, owner } from "./fixtures.ts";

type View = ReturnType<typeof emptyView>;
type Deliveries = Readonly<Record<string, { readonly target: string; readonly status: string }>>;
type Unsettled = (id: string, view: View, deliveries: Deliveries) => boolean;
type Incoming = (id: string, view: View) => boolean;
const unsettled = (id: string, view: View, deliveries: Deliveries = {}) => exported<Unsettled>("holdsUnsettled")(id, view, deliveries);
const incoming = (id: string, view: View) => exported<Incoming>("holdsIncoming")(id, view);
const single = (patch: Record<string, unknown> = {}): View => ({ ...emptyView(), posts: { "post-1": openPost(patch) } });
const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

describe("holdsUnsettled", () => {
  it("1.7 an empty view does not hold an unrelated agent", () => {
    expect(unsettled("target", emptyView())).toBe(false);
  });
  it.each(["any", "all"])("1.7 an author's open %s question holds it unsettled", (reply) => {
    expect(unsettled("asker", single({ reply }))).toBe(true);
    expect(unsettled("stranger", single({ reply }))).toBe(false);
  });
  it.each([
    ["closed", { status: "closed", outcome: "answered" }],
    ["no reply", { reply: "none" }],
  ])("1.7 an author's %s post does not hold it", (_name, patch) => {
    expect(unsettled("asker", single(patch))).toBe(false);
  });
  it.each([0, 1, 2, 3])("1.7 owed completion after %i returns holds only below the two-return cap", (returns) => {
    const view = emptyView();
    view.completions["post-1"] = { postId: "post-1", authorAgentId: "asker", returns };
    expect(unsettled("asker", view)).toBe(returns < 2);
    expect(unsettled("target", view)).toBe(false);
  });
  it("1.7 an unread uncarried incoming question holds its target through a lost wake or byte-cap omission", () => {
    expect(unsettled("target", single())).toBe(true);
  });
  it.each(["queued", "sent", "accepted", "returned", "withdrawn"])("1.7 consults delivery status %s rather than caching it on the wake", (status) => {
    const view = single();
    view.wakes["wake-1"] = { wakeId: "wake-1", targetAgentId: "target", deliveryId: "delivery-1", carried: ["post-1"], mustReply: ["post-1"], completions: [], reminders: [], noAnswers: [] };
    expect(unsettled("target", view, { "delivery-1": { target: "target", status } })).toBe(!["queued", "sent"].includes(status));
  });
  it("1.7 the same frozen board view changes its answer after send-time withdrawal", () => {
    const view = single();
    view.wakes["wake-1"] = { wakeId: "wake-1", targetAgentId: "target", deliveryId: "delivery-1", carried: ["post-1"], mustReply: ["post-1"], completions: [], reminders: [], noAnswers: [] };
    freeze(view);
    expect(unsettled("target", view, freeze({ "delivery-1": { target: "target", status: "sent" } }))).toBe(false);
    expect(unsettled("target", view, freeze({ "delivery-1": { target: "target", status: "withdrawn" } }))).toBe(true);
  });
  it.each([
    ["another target", { targetAgentId: "other", carried: ["post-1"] }],
    ["another post", { targetAgentId: "target", carried: ["post-other"] }],
    ["no joined delivery yet", { targetAgentId: "target", carried: ["post-1"], deliveryId: undefined }],
  ])("1.7 a wake carrying %s cannot hide an unserved question", (_name, patch) => {
    const view = single();
    view.wakes["wake-1"] = { wakeId: "wake-1", deliveryId: "delivery-1", mustReply: [], completions: [], reminders: [], noAnswers: [], ...patch };
    expect(unsettled("target", view, { "delivery-1": { target: "target", status: "queued" } })).toBe(true);
  });
  it("1.7 a board.read mark counts as reached without a wake or acknowledgement", () => {
    expect(unsettled("target", single({ takenAt: { target: 4 } }))).toBe(false);
    expect(incoming("target", single({ takenAt: { target: 4 } }))).toBe(true);
  });
  it.each([3, 4, 5])("1.7 a turn end at sequence %i owes reminder work only after taking the post at 4", (sequence) => {
    const view = single({ takenAt: { target: 4 } });
    view.lastTurnEnd.target = sequence;
    expect(unsettled("target", view)).toBe(sequence > 4);
  });
  it("1.7 acknowledgements do not settle a question after its target's turn ends", () => {
    const before = single({ takenAt: { target: 4 } });
    before.lastTurnEnd.target = 5;
    const acknowledged = single({ takenAt: { target: 4 }, acknowledged: [agent("target")] });
    acknowledged.lastTurnEnd.target = 5;
    expect(unsettled("target", before)).toBe(true);
    expect(unsettled("target", acknowledged)).toBe(true);
  });
  it("1.7 no-answer settles the target but keeps the asker unsettled and the target incoming", () => {
    const view = single({ dispositions: { target: "no-answer" }, takenAt: { target: 4 }, reminderAcceptedAt: { target: 6 } });
    view.lastTurnEnd.target = 7;
    expect(unsettled("target", view)).toBe(false);
    expect(unsettled("asker", view)).toBe(true);
    expect(incoming("target", view)).toBe(true);
  });
});

describe("holdsIncoming", () => {
  it("1.7 an open question holds only its addressee, even after read or acknowledgement", () => {
    const view = single({ takenAt: { target: 4 }, acknowledged: [agent("target")] });
    expect(incoming("target", view)).toBe(true);
    expect(incoming("asker", view)).toBe(false);
    expect(incoming("stranger", view)).toBe(false);
  });
  it.each(["replied", "gone", "removed", "undeliverable"])("1.7 disposition %s releases incoming and unread repair holds", (disposition) => {
    const view = single({ dispositions: { target: disposition } });
    expect(incoming("target", view)).toBe(false);
    expect(unsettled("target", view)).toBe(false);
  });
  it.each([{ status: "closed", outcome: "withdrawn" }, { reply: "none" }])("1.7 a closed or no-reply post releases incoming: %j", (patch) => {
    expect(incoming("target", single(patch))).toBe(false);
    expect(unsettled("target", single(patch))).toBe(false);
  });
});

describe("ownerHeld", () => {
  it("1.7 lists each direct agent author once, including any-mode questions, without transitive holds", () => {
    const view = emptyView();
    view.posts = {
      one: openPost({ reply: "any" }), two: openPost({ postId: "two" }),
      indirect: openPost({ postId: "indirect", author: agent("indirect"), to: [agent("asker")] }),
      closed: openPost({ author: agent("closed"), status: "closed", outcome: "answered" }),
      owner: openPost({ author: owner }), service: openPost({ author: { _tag: "service", service: "roles.sheepdog" } }),
      nobody: openPost({ author: agent("nobody"), to: [agent("target")] }),
    };
    const get = exported<(view: View) => ReadonlyArray<string>>("ownerHeld");
    expect([...get(freeze(view))]).toEqual(["asker"]);
  });
  it("1.7 a close removes the agent author from ownerHeld", () => {
    const get = exported<(view: View) => ReadonlyArray<string>>("ownerHeld");
    expect(get(single())).toEqual(["asker"]);
    expect(get(single({ status: "closed", outcome: "answered" }))).toEqual([]);
    expect(get(emptyView())).toEqual([]);
  });
  it("1.7 condition functions are deterministic and leave frozen inputs unchanged", () => {
    const view = freeze(single());
    const before = JSON.stringify(view);
    expect(unsettled("target", view)).toBe(true);
    expect(unsettled("target", view)).toBe(true);
    expect(incoming("target", view)).toBe(true);
    expect(incoming("target", view)).toBe(true);
    expect(exported<(view: View) => ReadonlyArray<string>>("ownerHeld")(view)).toEqual(["asker"]);
    expect(JSON.stringify(view)).toBe(before);
  });
});
