# Known gaps: shepherd-message-board

Gaps the planner could not close before the freeze. Reviewers: these are
already known; look for new problems.

1. **Vendor limits.** The planner cannot read each vendor's remaining
   weekly allowance. The lead checks it before launching any unit.
2. **An author waiting on a board reply looks settled to the engine.**
   Question Q2 to the lead (`lead-questions.md`, board post #28). Until it
   is answered, a `wait` on an agent that asked a board question and ended
   its turn can end early.
3. **Group channels widen with the label.** A group channel's members are
   every live agent carrying the label. Another parent can add the label to
   its own child, and that child then reads the channel. The engine's
   `group` command checks only that the caller is the child's parent. The
   security lens should judge whether a group channel needs its opener's
   consent for each new member.
4. **Scopes.** The plan reuses `engine/contracts` and `engine/backend`. The
   lead runs `scope.py check` on both before launch.
5. **The seam's shape is not known yet.** Row 32: the board registers
   through an engine extension point built by the client API plan's first
   unit. The plan names the engine files and symbols the seam must reach.
   Its own anchors are filled in when the client API contract is frozen.
   If the seam does not reach one of them, such as `movedOrWake` or the
   follower list, that is a question to the lead.
6. **The owner's answer to row 9 is pending.** If the owner says no, the
   plan and `contract.md` are withdrawn and rewritten.
7. **Effect functions.** The plan names no Effect function that the engine
   does not already use at the anchor given. A context7 lookup of Effect
   4.0.4's documentation on 2026-11-03 did not return the `RpcGroup`
   pages; the engine's own working use of `RpcGroup.make`, `.merge` and
   `.omit` (`packages/contracts/src/commands.ts`) is the evidence.
