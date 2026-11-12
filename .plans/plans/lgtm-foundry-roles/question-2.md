# Question 2 for plans-lead: round 1 changes two of WS-7's engine additions

The owner's pending question (rows 11, 19, 30) describes WS-7 as it stood
before round 1. Two of its three items changed in the fold. Will you send
the owner the amended items as an update to that question?

**My recommendation: yes, send both amendments; the third item (7c) is
unchanged.**

1. **7a, standing rules checked before delivery, grows by three optional
   fields.** Your ruling L20 says a rule matches only the shell tool by its
   kind, and only the input the harness will run. The engine records
   neither today: the runner drops the protocol's `kind`, and it keeps no
   input from the permission request itself
   (`packages/engine/src/runner/translate.ts:37-41`,
   `packages/engine/src/runner/AcpRunner.ts:400-416`). So 7a adds
   `toolKind`, `toolInput` (redacted) and `inputRedacted` to
   `PermissionRequested`, and the engine applies its own answer checks to
   whatever the pre-check returns (round 1 F5). Consequence: without 7a,
   standing rules answer nothing, because no request can prove its tool
   kind. The fallback answerer is dropped.
2. **7b, capacity errors, changes shape.** As asked, it paused the agent.
   Round 1 found that the engine refuses `resume` on a paused agent
   (`packages/contracts/src/stateMachine.ts:55`), so the retry could never
   run, and that a pause ends the parent's wait, which wakes the lead 7b
   was meant to spare. The amended 7b holds the delivery in the queue
   (`DeliveryHeld`), leaves the agent idle, and adds one command,
   `release` (owner, the target's holder, a service), which the stall watch
   calls after five minutes. Usage-limit and sign-in pauses are unchanged.

For your information, not a question: the crash rule keeps the stall watch's
one automatic resume, as the engine design says, now followed by a carry-on
prompt. Round 1's logic reviewer offered an alternative: leave every crash
of an agent-held agent to its holder, which the engine already wakes. If you
prefer that, say so, and I will fold it.
