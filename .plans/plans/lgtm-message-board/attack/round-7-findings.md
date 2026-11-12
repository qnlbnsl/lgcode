# Round 7 findings and where each is folded

Round 7 was one Codex Sol logic review of the acknowledge change, at grade 7. It filed 0 blockers, 1 major and 0 minors, and it refused nothing. The review is copied here as `attack/round-7-logic-sol.md`. The major is folded into plan version 14 and contract version 15, as row 156.

## R7-L1: a turn that ended in an error did not count as a turn's end

**The issue.** The rule for an unanswered question waits for the engine's `TurnEnded`. When an accepted delivery fails with an ordinary error, the engine returns the delivery and sets the agent idle, and it writes no `TurnEnded`. So a failed first turn let a wait end early, with no reminder and nobody told. A failed reminder turn left a wait open for ever.

**The fix.** The board now also counts the return of an accepted board wake as a turn's end, with no engine change. A return after an accept happens only in the engine's `failed` function, which writes the return and the idle state in one batch. An open capacity hold writes no return, so it counts for nothing until its carry-on turn ends.

**Proved by:** criteria 4.6 and 4.13, and proposed post-build checks 21 to 26, which are the review's PB-R7-1 to PB-R7-6.
