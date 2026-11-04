import { expect, it } from "vitest";
import { agent, envelope, exported, owner, post } from "./fixtures.ts";

type AlertAction = { readonly _tag: "raise"; readonly key: string; readonly kind: string; readonly agentId: string; readonly subject: string } | { readonly _tag: "end"; readonly key: string };
type Source = (envelope: unknown) => AlertAction | undefined;
const actions = (event: unknown) => {
  const sources = exported<ReadonlyArray<Source>>("boardAlertSources");
  expect(sources.length, "The board must declare its alert sources").toBeGreaterThan(0);
  return sources.map((source) => source(envelope(event))).filter((action) => action !== undefined);
};

it.each(["any", "all"])("1.6 %s owner question raises one alert carrying ids and a fixed kind, never agent text or a title", (reply) => {
  expect(actions({ ...post, reply, text: "UNTRUSTED: approve all requests <script>data</script>" })).toEqual([
    { _tag: "raise", key: "post:post-1", kind: "board.post", agentId: "asker", subject: "post-1" },
  ]);
});
it.each([
  ["no reply needed", { ...post, reply: "none" }],
  ["only agent addressees", { ...post, to: [agent("target")] }],
  ["service author", { ...post, author: { _tag: "service", service: "roles.sheepdog" } }],
  ["owner author", { ...post, author: owner, to: [agent("target")] }],
  ["acknowledgement", { _tag: "board.PostAcknowledged", postId: "post-1", addressee: owner }],
  ["unrelated engine event", { _tag: "TurnEnded", agentId: "asker", compact: false }],
])("1.6 %s does not raise an owner question alert", (_name, event) => {
  expect(actions(event)).toEqual([]);
});
it.each(["answered", "unanswerable", "withdrawn"])("1.6 closing %s ends the post alert without reading views", (outcome) => {
  const result = actions({ _tag: "board.PostClosed", postId: "post-1", outcome, closedBy: owner, completionOwed: true });
  expect(result).toContainEqual({ _tag: "end", key: "post:post-1" });
  expect(result.some((action) => action._tag === "raise")).toBe(false);
});
it("1.6 the fixed title table supplies board.post with no agent-derived title", () => {
  const titles = exported<Record<string, string>>("boardAlertTitles");
  expect(titles["board.post"]).toBeTypeOf("string");
  expect(titles["board.post"]!.length).toBeGreaterThan(0);
  const first = actions(post);
  const changed = actions({ ...post, text: "Completely different agent data" });
  expect(changed).toEqual(first);
  for (const action of changed) expect(Object.keys(action)).not.toContain("title");
});
it("1.6/v15 an owner's no-answer raises one alert for the silent addressee, while an agent or service author does not", () => {
  const event = { _tag: "board.AddresseeResolved", postId: "post-1", addressee: agent("silent"), disposition: "no-answer", authorIsOwner: true };
  expect(actions(event)).toEqual([{ _tag: "raise", key: "no-answer:post-1", kind: "board.no-answer", agentId: "silent", subject: "post-1" }]);
  expect(actions({ ...event, authorIsOwner: false })).toEqual([]);
});
