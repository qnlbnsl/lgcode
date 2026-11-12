# Round 5 findings and how each major was folded

Round 5 was a Codex-only round on `attack/plan-v14.md` (commit `3ad961b`). Four reviews found 0 blockers, 3 majors and 4 minors, graded 7, 7, 8 and 10, with no refusals. The reviews are copied into this folder as `round-5-*.md`. The folded plan is frozen as `attack/plan-v15.md`.

Under the manager's rule, only majors are folded. The minors are listed in `known-gaps.md`, under "Round minors, not folded".

## R5-A1: the hand-off selects a prompt event that the engine does not write

- **What can go wrong:** a replacement worker's hand-off leaves out the original brief and the user side of the last exchange, because it looks for `PromptSent`, which the engine never writes.
- **The fix:** the hand-off reads the brief from `AgentStarted.firstPromptDelivery` and later prompts from their `DeliveryQueued`, and where the existing visibility rule hides a prompt from an agent caller, the section says so with the cut marker.
- **Decision row:** 133. Tests H13 to H15.

## R5-A2 and R5-L1: a restart after a crash resume loses the carry-on

- **What can go wrong:** if LGTM Studio dies after the stall watch resumes a crashed worker and before it sends the carry-on, the worker sits idle with no carry-on and its holder is never told.
- **The fix:** the stall watch records `roles.CrashAdmitted` before the `resume`, and after a restart it finishes that retry under the same request ids, unless a stop cancelled it, which keeps the rule of one automatic retry.
- **Decision row:** 134. Tests CR08 to CR14.

## The engine re-anchor

The plan's anchors moved from engine `8ff4c9b` to `9e386b0`. Only line numbers changed, and no mismatch changed a design. Both majors exist at both commits. Decision row 135 gives the details.
