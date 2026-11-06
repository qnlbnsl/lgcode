import type { CloseOutcome, Disposition, ReplyMode } from "@sheprd/contracts/board/ids";
import { expect, it } from "vitest";

import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { freeze, requiredModule } from "./fixtures.ts";

registerRebuildCheck({ noLog: true });

// A missing disposition is an addressee that has not resolved. Lifecycle and
// authority checks belong to the reactor and planners, not this pure table.
interface OutcomeInput {
  readonly reply: ReplyMode;
  readonly dispositions: ReadonlyArray<Disposition | undefined>;
  readonly ownerReplied?: boolean;
  readonly withdrawn?: boolean;
}
interface OutcomeModule {
  readonly outcome: (input: OutcomeInput) => CloseOutcome | undefined;
}

const cases: ReadonlyArray<{ readonly name: string; readonly input: OutcomeInput; readonly expected: CloseOutcome | undefined }> = [
  { name: "any: the first reply closes even with another target pending", input: { reply: "any", dispositions: ["replied", undefined] }, expected: "answered" },
  { name: "any: a later target's reply closes after an earlier target is gone", input: { reply: "any", dispositions: ["gone", "replied"] }, expected: "answered" },
  { name: "any: losing only one target cannot close while another is pending", input: { reply: "any", dispositions: ["gone", undefined] }, expected: undefined },
  { name: "all: one reply cannot close while another target is pending", input: { reply: "all", dispositions: ["replied", undefined] }, expected: undefined },
  { name: "all: replies from every target close answered", input: { reply: "all", dispositions: ["replied", "replied"] }, expected: "answered" },
  { name: "all: a reply and a gone target close answered", input: { reply: "all", dispositions: ["replied", "gone"] }, expected: "answered" },
  { name: "all: a reply and a removed target close answered", input: { reply: "all", dispositions: ["removed", "replied"] }, expected: "answered" },
  { name: "all: a reply and an undeliverable target close answered", input: { reply: "all", dispositions: ["replied", "undeliverable"] }, expected: "answered" },
  { name: "none: a digest never needs automatic closure", input: { reply: "none", dispositions: [] }, expected: undefined },
  { name: "owner reply: any closes immediately with every target pending", input: { reply: "any", dispositions: [undefined, undefined], ownerReplied: true }, expected: "answered" },
  { name: "owner reply: all closes immediately with every target pending", input: { reply: "all", dispositions: [undefined, undefined], ownerReplied: true }, expected: "answered" },
  { name: "withdrawal: board.close or author stop/removal closes a pending question", input: { reply: "all", dispositions: [undefined, undefined], withdrawn: true }, expected: "withdrawn" },
  { name: "author crash: absent a withdrawal or resolved targets the question stays open", input: { reply: "all", dispositions: [undefined, undefined] }, expected: undefined },
];

for (const reply of ["any", "all"] as const) {
  for (const disposition of ["gone", "removed", "undeliverable"] as const) {
    it(`outcome table: ${reply} with only ${disposition} closes unanswerable`, async () => {
      const { outcome } = await requiredModule<OutcomeModule>("outcome");
      expect(outcome(freeze({ reply, dispositions: [disposition, disposition] }))).toBe("unanswerable");
    });
  }
  it(`outcome table: ${reply} with mixed terminal failures closes unanswerable`, async () => {
    const { outcome } = await requiredModule<OutcomeModule>("outcome");
    expect(outcome(freeze({ reply, dispositions: ["gone", "removed", "undeliverable"] }))).toBe("unanswerable");
  });
  it(`outcome table: ${reply} with no-answer and a failed target stays open`, async () => {
    const { outcome } = await requiredModule<OutcomeModule>("outcome");
    expect(outcome(freeze({ reply, dispositions: ["no-answer", "gone"] }))).toBeUndefined();
  });
  it(`outcome table: ${reply} with every target at no-answer stays open`, async () => {
    const { outcome } = await requiredModule<OutcomeModule>("outcome");
    expect(outcome(freeze({ reply, dispositions: ["no-answer", "no-answer"] }))).toBeUndefined();
  });
}

it("outcome table: all cannot treat no-answer as a terminal disposition even when another target replied", async () => {
  const { outcome } = await requiredModule<OutcomeModule>("outcome");
  expect(outcome(freeze({ reply: "all", dispositions: ["replied", "no-answer"] }))).toBeUndefined();
});

it("outcome table: any closes on a reply even if another target is at no-answer", async () => {
  const { outcome } = await requiredModule<OutcomeModule>("outcome");
  expect(outcome(freeze({ reply: "any", dispositions: ["no-answer", "replied"] }))).toBe("answered");
});

it.each(cases)("outcome table: $name", async ({ input, expected }) => {
  const { outcome } = await requiredModule<OutcomeModule>("outcome");
  const before = structuredClone(input);
  expect(outcome(freeze(input))).toBe(expected);
  expect(outcome(input)).toBe(expected);
  expect(input).toEqual(before);
});
