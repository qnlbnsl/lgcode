# Round 5 findings and where each is folded

Round 5 was the final review round, which the owner asked to be Codex only. Four
Codex Sol seats reviewed the board's plan and contract at `a5e8eb3`: architecture,
critic, logic and threat model. Each gave grade 7. Together they filed 0 blockers,
4 majors and 3 minors, with no refusals. The four majors are one finding. The
reviews are copied here as `attack/round-5-*.md`.

By the lead's ruling (post #266), only the major is folded. The minors are listed
in `attack/known-gaps.md`, under "Round minors, not folded".

## The one major, for the owner

**Findings:** R5-A1, C5-01, R5-L1, R5-TM-1.

**What can go wrong.** If an agent is stopped and then resumed before the board's
background work runs, the board forgets the stop, so the agent keeps its old
questions open and keeps running its channels until someone repairs them by hand.

**The fix.** The board now records when each stop, crash and departure happened
and compares that with when each question was asked or each manager took its
seat, so the effect survives a resume and a later question is not caught.

**Decision:** row 143. **Contract:** version 11. **Proved by:** criteria 2.1, 4.1
and 4.5.

## Re-anchoring to the engine at `9e386b0`

The engine moved 73 commits since the board's first scans. No commit changes a
board design. One line anchor moved (row 144), and the engine's newer redactor
needs one added table entry for the board's ids (row 145).
