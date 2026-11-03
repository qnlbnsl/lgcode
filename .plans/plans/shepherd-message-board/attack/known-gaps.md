# Known gaps: shepherd-message-board

Gaps the planner could not close before the freeze. Reviewers: these are
already known; look for new problems. Updated for plan version 3, after
round 2.

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
5. **New packages, test-runner projects and scopes.** The board's code is
   in two new packages, `packages/board-contracts` and `packages/board`.
   Their manifests, their workspace entries, and their entries in the root
   `vitest.config.ts`, which lists test projects by name, are changes no
   board unit may make. The lead decides whether the seam unit creates
   them or a unit is given that right. Criterion 1.9 checks that the test
   runner lists both packages. The scopes `board/contracts` and
   `board/backend` do not exist; the lead runs the scoping skill for both
   before launch.
6. **The owner's answer to row 9 is pending.** If the owner says no, the
   plan and `contract.md` are withdrawn and rewritten.
7. **The owner's confirmation of four exclusions.** Row 44 marks work
   items, file and branch watches, the test queue and usage meters as
   WIDENED. The lead confirms them with the owner at acceptance (ruling
   L14).
8. **Two wording points in the client API's seam text.** Sent to the lead
   with the round 2 fold. (a) Seam item 15 at `ed1755d` says the engine
   consults a piece's reach check "only ... when the target is outside the
   calling agent's tree". The board needs the send-time re-check for every
   board wake, including one whose target is inside the caller's tree and
   one the reactor built with no caller; criterion 4.9 assumes this.
   (b) Seam item 16 words the board's condition as "has not answered it";
   row 77 makes it "has no disposition". The board defines its own
   condition, so this changes no seam behaviour.
9. **Effect functions.** Shephrd pins Effect 4.0.5 (`pnpm-workspace.yaml`,
   catalog). The plan names no Effect function that the engine does not
   already use at the anchor given. A context7 lookup of Effect 4's
   documentation on 2026-11-03 did not return the `RpcGroup` pages; the
   engine's own working use of `RpcGroup.make`, `.merge` and `.omit`
   (`packages/contracts/src/commands.ts`) is the evidence.

Also closed since version 1: the hold-unsettled hook (now seam item 12);
seam items 13 and 14 (now in the client API contract); group channels
widening with the label (decided by row 45).
