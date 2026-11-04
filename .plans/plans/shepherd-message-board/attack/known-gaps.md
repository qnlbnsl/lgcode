# Known gaps: shepherd-message-board

Gaps the planner could not close before the freeze. Reviewers: these are
already known; look for new problems. Updated for plan version 13, after
the owner's acknowledge change.

1. **Vendor limits.** The planner cannot read each vendor's remaining
   weekly allowance. The lead checks it before launching any unit.
2. **Closed: seam text for the board's round-1 requests.** The lead
   approved them as ruling L15, and the client API contract holds them at
   `296b1c3` as seam items 15 to 17 (row 63).
3. **Closed: the board's contract change.** The lead approved version 3 as
   ruling L16 (board post #75); it is now `contract.md` (row 63).
4. **Closed: a board wake's envelope sender.** Ruling L16: the sender
   label is `board`, and each post's header names its author from fixed
   words and the engine-authenticated id (row 63). The client API's
   section 2 no longer says the envelope names the calling agent
   (`ed1755d`).
5. **Scopes.** The board now adds no package: its code is in
   `packages/contracts/src/board/` and `packages/engine/src/board/`
   (row 100), so no manifest, workspace entry or test project is needed.
   Criterion 1.9 checks that the test runner lists the board's test
   folders. The scopes `board/contracts`, `board/backend` and `board/web`
   do not exist; the lead runs the scoping skill for all three before
   launch. They must cover the board's lines in the files that the
   engine-change table names.
6. **Closed: the owner's answer to row 9.** The owner said to edit the
   engine directly (row 99).
7. **The owner's confirmation of four exclusions.** Row 44 marks work
   items, file and branch watches, the test queue and usage meters as
   WIDENED. The lead confirms them with the owner at acceptance (ruling
   L14).
8. **Closed: the client API's seam text.** Lead ruling L22 (`586a7ff`)
   makes the reach check run on every board delivery and uses the "no
   disposition" wording; lead ruling L23 (`ced973b`) passes the delivery
   to the check and moves the dispatcher on after a withdrawal (row 98).
10. **Closed: question Q6.** Lead ruling L30 approved the four client API
    changes, now in its version 5 at `09018d6`, and contract version 7
    (row 120).
9. **Effect functions.** Shephrd pins Effect 4.0.5 (`pnpm-workspace.yaml`,
   catalog). The plan names no Effect function that the engine does not
   already use at the anchor given. A context7 lookup of Effect 4's
   documentation on 2026-11-03 did not return the `RpcGroup` pages; the
   engine's own working use of `RpcGroup.make`, `.merge` and `.omit`
   (`packages/contracts/src/commands.ts`) is the evidence.

Also closed since version 1: the hold-unsettled hook (now seam item 12);
seam items 13 and 14 (now in the client API contract); group channels
widening with the label (decided by row 45).

## Round minors, not folded

The lead ruled that the final round folds majors only (post #266). These stay
open for the build's units to read.

- **Closed: R5-A2** (architecture). An agent's `board.read` page now has the data
  envelope (row 154).
- **Closed: C5-02** (critic). Reading still does not remove a queued wake, on purpose,
  and acknowledging a post now does (row 152).
- **Criterion 4.1's wording** (noted by the round 6 review, not filed). It calls a
  stopped author's result `withdrawn` even when a reply closes the post first. The
  first committed close stands, and no completion is owed, so the test should keep
  closure outcome and completion debt apart.
- **C5-03** (critic). Criterion 6.6's diff starts at client API unit 1b's merge,
  so it also counts test changes from later client API units that this plan
  depends on.
