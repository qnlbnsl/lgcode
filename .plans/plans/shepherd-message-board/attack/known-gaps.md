# Known gaps: shepherd-message-board

Gaps the planner could not close before the freeze. Reviewers: these are
already known; look for new problems.

1. **Vendor limits.** The planner cannot read each vendor's remaining
   weekly allowance. The lead checks it before launching any unit.
2. **The hold-unsettled hook is not in the client API contract yet.** The
   lead answered Q2 (row 33) with a seam hook and asked plans-api to add it
   to contract v2. Criterion 3.12 depends on it.
3. **Group channels widen with the label.** A group channel's members are
   every live agent carrying the label. Another parent can add the label to
   its own child, and that child then reads the channel. The engine's
   `group` command checks only that the caller is the child's parent. The
   security lens should judge whether a group channel needs its opener's
   consent for each new member.
4. **New packages and scopes.** The board's code is in two new packages,
   `packages/board-contracts` and `packages/board`. Their manifests and the
   workspace entries are a `package.json` change, which no unit may make;
   the lead decides whether the seam unit creates them or a unit is given
   that right. The scopes `board/contracts` and `board/backend` do not
   exist; the lead runs the scoping skill for both before launch.
5. **The seam is written against draft v1.** The plan follows the client
   API contract as read on 2026-11-03 (rows 34 to 40). Two board needs are
   not in v1: a piece withdrawing its own still-queued delivery, and a
   piece setting a delivery's text and shown sender (asked of the lead,
   post #37). The seam has no file anchors yet; tasks give greenfield paths
   and today's engine patterns.
6. **The owner's answer to row 9 is pending.** If the owner says no, the
   plan and `contract.md` are withdrawn and rewritten.
7. **Effect functions.** The plan names no Effect function that the engine
   does not already use at the anchor given. A context7 lookup of Effect
   4.0.4's documentation on 2026-11-03 did not return the `RpcGroup`
   pages; the engine's own working use of `RpcGroup.make`, `.merge` and
   `.omit` (`packages/contracts/src/commands.ts`) is the evidence.
