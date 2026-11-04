revise
Grade: 7  B/M/m: 0/1/1  Flags: none

## Review scope and evidence

Reviewed plan version 9 and board contract version 10 against client API contract version 12 and roles plan version 14. Repository evidence is from `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. I also inspected the changes to the named engine files at `9e386b0`.

In the references below, `board/` means `/home/qnlbnsl/projects/personal/herdr-synapse/sheprd/.scratch/foundry-runs/foundation-plans-1/review/board-r5/shepherd-message-board/`. `inputs/` means the sibling `inputs/` directory. Repository paths refer to the recorded checkout unless a different commit is explicitly named. This report does not claim that future board code or its tests were run.

## Findings

### R5-A1. MAJOR. A stop followed by a resume erases work the positionless reactor must still perform

Category: Design and bug (recovery). Evidence status: Confirmed plan defect. Responsible builder: Board units 2a and 3b, with unit 3c checking the same lifecycle boundary.

Scenario: A manages a plain channel and has an unanswered post Q in it. While the board is disabled, the owner stops A and resumes it with a fresh session. When the board is enabled again, A is live and Q is still open. The whole-state scan finds neither a stopped manager nor a stopped author. It therefore leaves A in the manager seat and leaves Q open. An idle A remains unsettled on Q until someone answers or manually closes an obligation that stopping A was supposed to withdraw. A quick stop and resume while the reactor is delayed produces the same result without disabling the board.

The missing durable fact is explicit in the plan. Every reactor rule is evaluated over current views, the reactor keeps no position, and each write builds from the views inside its current writer transaction (`board/plan.md:670`, `board/plan.md:679`). The two relevant conditions are that the author is stopped and that the current manager is stopped (`board/plan.md:708`, `board/plan.md:711`). The board view retains a set of stopped agents only until the change out of stopped (`board/plan.md:519`, criterion 2.1 at `board/plan.md:536`). Its stop fold drops existing owed completions, but does not preserve pending post withdrawals, addressee resolutions or manager succession. Rebuilding that view after the resume loses the same pending work.

This ordering is legal in today's engine. At `8ff4c9b`, `stop` emits `AgentStopped` (`packages/engine/src/commands/stop.ts:11`), the state table permits resume from stopped (`packages/contracts/src/stateMachine.ts:58`), and resume emits `StateChanged starting` (`packages/engine/src/commands/resume.ts:26`). The agents reducer replaces the lifecycle state as those events are folded (`packages/engine/src/views/apply.ts:201`, `packages/engine/src/views/apply.ts:205`). Views expose their latest value, rather than a historical value for each reactor trigger (`packages/engine/src/views/Views.ts:43`). Reading trigger events in sequence does not restore the missing fact when the batch is deliberately built from the latest views.

This also applies to an addressee that crashes and is resumed before the reconciliation: the current-state test sees a live addressee, although the chosen disposition rule says its crash ends that part as gone. The plan's table does not retain that pending resolution (`board/plan.md:705`). The roles plan's automatic crash resume makes this join worth covering explicitly, although the disabled-board stop scenario alone proves the defect.

Why this reopens an answered finding: Round 4 group 3, row 105, claims that changing every rule to a level rule makes all duties survive disabled operation and restarts. The claimed answer fails because these particular conditions can become false before their consequences are recorded. It also fails to preserve the earlier row 49 decision that a departure is judged when it happens, and the round 4 group 4 promise that a stop permanently moves the manager seat. The contract still promises that a stop is final for the seat (`board/contract.md:84`) and withdraws the author's questions (`board/contract.md:251`). No owner ruling or named known gap accepts losing these consequences.

The defect is present against both commits. At `9e386b0`, stop still emits `AgentStopped` at `packages/engine/src/commands/stop.ts:11`, and resume still replaces the state at `packages/engine/src/commands/resume.ts:26`. This is not a finding caused by shifted lines or by later engine drift.

Suggested fix: Keep the reactor positionless, but make the relevant consequences durable. When the board fold sees a stop or crash, retain pending duties for the affected posts and channels until their corresponding board resolution, closure or manager-change event discharges them. A resume must not erase those duties. Distinguish an old stopped incarnation's questions from questions posted after resume. Apply the same reasoning to a removal followed by rejoining. Amend the view inventory, outcome rules and criteria 4.1 and 4.5 to cover both transitions occurring before the reactor's next transaction, including while disabled. This needs a decision before implementation; a test of only the existing current-state conditions cannot repair it.

### R5-A2. MINOR. The agent form of board.read omits the promised data envelope

Category: Design (agent-text handling). Evidence status: Confirmed contract omission. Responsible builder: Board units 1 and 4. Severity is minor because the established defect is the missing representation rule; no model executing a planted instruction was demonstrated.

Scenario: A posts text that needs no reply. B obtains it through the board.read tool. The contract returns a normal page of records containing A's text, and does not specify the random-marker data envelope for this path. Wrapping the board's queued wakes does not cover this read.

Evidence: The engine design requires text reaching one agent from another to be wrapped and labelled as data (`docs/specs/2026-11-01-engine-design.md:600`). The board specifies the wrapping for wake bodies (`board/contract.md:347`, `board/contract.md:354`), but its read contract defines ordinary paged items and read marks (`board/contract.md:482`), and its API table returns those posts to members (`board/contract.md:579`). The plan names no agent-specific wrapping or success shape for board.read. In contrast, it explicitly carries the agent-specific envelope for client.thread and client.event (`board/contract.md:511`).

The existing transport does not provide a general automatic fix. At `8ff4c9b`, the Model Context Protocol tool handler returns the client's command reply (`packages/mcp/src/server.ts:82`), and the command-line path prints the reply as sanitized JSON (`packages/cli/src/commands/run.ts:31`). The existing envelope helper is invoked by callers; it is not a reply serializer (`packages/engine/src/routing/envelope.ts:14`). Those three files are unchanged at `9e386b0`. Client API edit E15 is specifically a delivery helper (`inputs/client-api-contract.md:1922`), and edit E4's read-with-marks path adds no blanket reply envelope (`inputs/client-api-contract.md:1609`).

Suggested fix: State and test an agent-specific board.read response that labels the returned text as data, using the same helper and representation chosen for agent thread reads. Preserve the owner's structured page for the phone panel. Measure the final encoded agent response against the page budget, and keep marks tied to the actual returned posts. Report this guard omission to the lead for the issues list under the run's lead-only documentation rule.

## Risk register

The scores use severity × fallout × probability. Decisions remain for the owner or lead.

| Id | Severity | Fallout | Probability | Score and band | Evidence | Owner | Decision and deadline | Acceptance and closing evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R5-A1 | 6: an abandoned question can hold a resumed agent unsettled until manually repaired | 3: the owner can close the question and repair the channel | 6: a supported stop and resume while the board is disabled deterministically reaches the case | 108, schedule | Confirmed plan defect | Board view and reactor | Unset; within this phase or a dated follow-up with an owner | None |
| R5-A2 | 2: a stated text-labelling guard is omitted; no executed instruction was shown | 3: the response contract can be corrected | 8: reading another member's ordinary posts is a common path | 48, record | Confirmed contract omission | Board reads and contracts | Unset; review at phase end, following the run's security-deferral rule where applicable | None |

## Earlier answers and shared boundaries

I checked the four finding maps against the current rules. The round 4 answers stand as written except for the lifecycle persistence failure in R5-A1.

| Round 4 group | Result |
| --- | --- |
| 1. Fresh board results for the owner's wait | The result lists, delivery-status input and final batch-end gate are present in board criteria 1.7 and 5.9 and client API edits E19 and E23. |
| 2. Questions left out of a full wake | Read marks count as receipt, and an uncovered unread obligation queues its next wake. The queue-status guard prevents repeated rebuilding of a full queued wake. |
| 3. Durable reactor work and the checked write path | The write path is answered by edit E23. The durability claim fails for reversible lifecycle predicates, as R5-A1 explains. |
| 4. Temporary crash versus permanent manager succession | Acting managers gain no membership, and direct pairs gain no manager. Those answers remain. The stop's permanent consequence needs R5-A1's durable duty. |
| 5. Planner replies | Edit E3 supplies a reply from the committed redacted batch, and the board chooses small replies from its own events. |
| 6. Read storage and reauthorization | Edit E4 supplies reads with marks and no receipt. Board criterion 5.11 retains the lost-reply and lost-access case. |
| 7. A returned wake's sender | Edit E15 widens all three sender positions, including DeliveryReturned. Board criterion 4.3 checks the real return path. |
| 8. Completion metadata size | Deciding reply identifiers replace the unlimited reply-id list. Text is bounded separately and replies remain paged. |
| 9. Lifecycle table and visibility fixtures | B2 names both the keep-in-every-state addition and the existing exhaustive visibility fixture test. |
| 10. Dropped checks | Post-build checks 16 and 17 and criterion 6.3 retain them, including client.event. |

The round 4 minor answers for stopped-agent completion discharge, fresh-session read state, accepted-return counting, duplicate completion packing, disabled status, public refusal text, and withdrawal wait checks are retained. Earlier answers for structural membership, fixed anchors, direct grants, ceilings, sparse read positions, completion debt, size limits and rollback are also retained, subject to R5-A1 when a transient lifecycle or membership change is supposed to create a lasting consequence.

The joins with the other two plans agree on the main interfaces: board.Read now names its reader; both the board and roles learn a wake's delivery id from DeliveryQueued after WakeBuilt; services cannot read board posts; board alert sources and openMatters agree; the board panel uses board.post rather than engine answer; and the capacity hold belongs to the engine. The roles plan's criterion 7.3 and the board's criterion 6.7 name the same held-queue test and assign it to whichever unit lands second (`inputs/roles-plan.md:1210`, `board/plan.md:857`). There is no circular dependency in that assignment. The board panel waits for the client thread page and alerts, and rollback retains schemas and reach checks.

## Existing engine changes and the later commit

I checked B1 through B12 and the shared edits they rely on. The command group is closed at `packages/contracts/src/commands.ts:44`, the handler has the named fixed planner inventory at `packages/engine/src/commands/CommandHandler.ts:54`, and its reply path is at `packages/engine/src/commands/CommandHandler.ts:97`. The event union and complete lifecycle table are at `packages/contracts/src/events.ts:88` and `packages/contracts/src/stateMachine.ts:79`. The initial views are at `packages/engine/src/views/apply.ts:114`. These support the named list and view edits.

The delivery reducer supplies accepted, requeued, returned and withdrawn states at `packages/engine/src/views/apply.ts:281`. The dispatcher reserves a delivery before calling the runner (`packages/engine/src/routing/deliveries.ts:239`, `packages/engine/src/routing/deliveries.ts:255`). Runner.prompt accepts an engine delivery without board-specific fields (`packages/engine/src/runner/Runner.ts:122`). Settled and blocking request-held checks exist at `packages/engine/src/routing/waits.ts:39` and `packages/engine/src/routing/waits.ts:83`. The three existing followers start where B8 says (`packages/engine/src/commands/CommandHandler.ts:177`). The public-reason filter exists where B10 says (`packages/engine/src/api/server.ts:41`). The event writer already has the no-receipt path that the shared read edit needs (`packages/engine/src/log/EventLog.ts:210`).

The named existing test paths resolve. The new uniqueness, size-limit, guarded-piece, read, snapshot and web tests are correctly dependencies or future targets, rather than tests claimed to exist at the recorded commit. I found no additional existing test expectation that the board's listed changes necessarily alter but fail to name.

The comparison from `8ff4c9b` to `9e386b0` found no additional invalid named board change. The event union, lifecycle table, views reducer, dispatcher, server, runner interface and tool forwarding discussed above are unchanged. The later handler adds default loading and a start-preemption wrapper (`9e386b0`, `packages/engine/src/commands/CommandHandler.ts:127`, `packages/engine/src/commands/CommandHandler.ts:202`, `packages/engine/src/commands/CommandHandler.ts:237`). The contract adds a harness reset variant (`9e386b0`, `packages/contracts/src/commands.ts:129`). The shared planner edit's rule to preserve engine hooks and send lanes remains compatible with them. I did not file either addition or a line-number shift as a defect. The later redactor's structure metadata is at `9e386b0`, `packages/engine/src/log/redactionStructure.ts:23`; its registration coverage belongs in the post-build redaction check below.

## Proposed post-build checks

| Id | Scenario | Expected result | Required evidence and responsible area |
| --- | --- | --- | --- |
| R5-PB1 | Delay the board reactor, stop and fresh-resume a channel manager that authored an unanswered post, then release the reactor. Repeat across disabled operation and a service restart. | Old posts close withdrawn, their queued demands disappear, and the seat moves exactly once according to the stop rule. New posts after resume remain independent. | Public command trace, committed board events, live/rebuilt view equality, and both wait results. Board units 2a, 3b and 5. This verifies the decision required by R5-A1. |
| R5-PB2 | Crash and resume an addressee, or remove and re-add a member, before the reactor can write. Include an all collection with another outstanding member. | The chosen gone or removed disposition survives the transient change; the documented late-reply upgrade still works. | Controlled transaction barriers, dispositions, deciding reply ids, cleanup events and completion counts. Board units 3b and 3c. |
| R5-PB3 | An agent reads another agent's planted instruction text through every board.read mode, through both its tool and command-line path. | Agent text has the chosen data envelope; the owner's page keeps its structured shape; only returned posts get marks; the final encoded reply fits its budget. | Actual returned frames and tool results, read events, size measurement and a rebuild comparison. Board units 1 and 4. |
| R5-PB4 | Run the real board with the current engine redactor, including secrets that occur in post text and values resembling identifiers. Exercise author, channel, post, wake and deciding-reply references in events and receipts. | Text is redacted, identity links remain consistent, and replay equals the live view. | Stored events and receipts, replies and both views. Board integration with the current log writer. Retains the existing secret checks without assuming future structure registration. |
| R5-PB5 | Run criterion 6.7 with the real capacity hold, with withdrawal, replacement and an empty queue across restart. | No send or settled result while held; release of the empty queue ends the wait; persisted, engine and client states agree. | The shared acceptance test named by both plans, with batch-end sequences and runner send counts. Board unit 5 or roles unit 11b, whichever lands second. |

Retain the plan's existing checks for send-time reach, namespace-limited withdrawals, redaction, final encoded sizes, replay proof, the owner's final wait gate, and the phone alert-to-reply flow.

## Noted, not filed

- The owner's decisions on direct engine edits, open web access, deferred pairing and the own-user boundary were applied. Question 6's pending answer and the named scope exclusions were not reopened. The lead-only issue-list rule was followed; this report is the handoff for the findings.
- Rollback by disabling the board, retaining old event definitions and continuing send-time reach checks, is explicitly decided. No migration is needed for a new state rebuilt entirely from retained events. R5-A1 concerns the work that must survive disabling, not the rollback choice itself.
- Node.js 26 was selected with nvm before the probes. A read-only in-memory probe using the recorded state table and reducer returned `{"resumeFromStopped":"allowed","afterStop":"stopped","afterResumeCommit":"starting"}`. Its first invocation failed because this checkout lacks the workspace alias for @shephrd/contracts; an in-memory Node resolution hook supplied the existing contracts entry point, and the rerun passed. No files were installed or edited.
- Context7 discovery succeeded, but its Effect lookup returned a monthly-quota error. I used the official Effect 4 RpcGroup source instead, checked on 2026-11-03: [RpcGroup](https://raw.githubusercontent.com/Effect-TS/effect-smol/main/packages/effect/src/unstable/rpc/RpcGroup.ts). It documents make, merge and omit. This is consistent with the recorded engine's working use. I also checked the official [React common-component reference](https://react.dev/reference/react-dom/components/common) for string children and raw HTML handling, and the official [Agent Client Protocol prompt-turn documentation](https://agentclientprotocol.com/protocol/v1/prompt-turn) for the prompt lifecycle. Runtime behavior remains a post-build check.
- No full test suite was run for this frozen-plan review. The repository remained read-only. The assigned scratch directory was never created, so no scratch files remain. The only written artifact is this result file.
