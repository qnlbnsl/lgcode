# Round 6 findings and where each is folded

Round 6 was a short final check of plan version 11 and contract version 12, by one Codex Sol logic review, at grade 7. It filed 0 blockers, 1 major and 0 minors, and it refused nothing. The review is copied here as `attack/round-6-logic-sol.md`. The major is folded into plan version 12 and contract version 13, as row 151.

## R6-L1: a secret inside an agent id could rewrite a channel's anchor or a wake's target

**The issue.** The engine's redactor removes registered secrets from every string, unless a table says that the field holds an id. Engine change B13 listed the board's ids, but it did not list a group channel's anchor or a wake's target. So a secret that also occurs inside an agent id would change those two values in the log. The channel would stop recognising that agent and its team as members. The wake would stop matching its real target, which breaks the accounting for carried questions, reads and completions. Rebuilding the views would repeat the damage.

**The fix.** B13 now names every id path in every board event, so nothing is left to inference. The two paths the review found are `board.ChannelOpened.anchorAgentId` and `board.WakeBuilt.targetAgentId`. Writing out the list also found one more that the review did not name: the deciding reply's id in `board.AddresseeResolved`, now `decidingPostId`. The names are specific, because the table exempts a field by its name across all events (client API row 183). None of them holds free text anywhere else in the engine, the client API contract or the roles plan.

**Proved by:** criterion 3.7, which now checks group membership, the wake-target join, the discharge of a completion and rebuilt views through the real log writer and the receipt path.

## The review's four proposed checks

| Check | Answer |
| --- | --- |
| R6-PB1, a stopped and resumed manager with an open question, while disabled and across a restart | Already covered by criteria 4.1 and 4.5 and post-build check 18. |
| R6-PB2, crash and resume, and remove and rejoin, before the reactor runs | Already covered by criteria 4.1 and 4.5. |
| R6-PB3, a secret planted inside each board id | Taken in as the extension of criterion 3.7. |
| R6-PB4, a logged-in dashboard, then logout and retry | The board's half is criteria 5.7 and 7.3. The login and logout half belongs to the client API's plan. |

## One note, not filed as a finding

The review notes that criterion 4.1 calls a stopped author's result `withdrawn` even when a reply closes the post first. The first committed close stands, and what the rule adds is that no completion is owed. The build's test should keep closure outcome and completion debt apart. This is in `attack/known-gaps.md`.
