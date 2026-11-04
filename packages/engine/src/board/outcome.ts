import type { CloseOutcome, Disposition, ReplyMode } from "@shephrd/contracts/board/ids";

export interface OutcomeInput {
  readonly reply: ReplyMode;
  readonly dispositions: ReadonlyArray<Disposition | undefined>;
  readonly ownerReplied?: boolean;
  readonly withdrawn?: boolean;
}

// Lifecycle and access observations are resolved by the caller. A no-answer
// leaves the question open, so it cannot satisfy an all-targets condition.
export const outcome = (input: OutcomeInput): CloseOutcome | undefined => {
  if (input.withdrawn) return "withdrawn";
  if (input.reply === "none") return undefined;
  if (input.ownerReplied) return "answered";
  const replied = input.dispositions.includes("replied");
  if (input.reply === "any" && replied) return "answered";
  if (input.dispositions.length === 0 || input.dispositions.some((value) => value === undefined || value === "no-answer")) {
    return undefined;
  }
  return replied ? "answered" : "unanswerable";
};
