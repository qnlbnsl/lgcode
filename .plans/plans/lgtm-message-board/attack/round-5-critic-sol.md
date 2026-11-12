revise
Grade: 7  B/M/m: 0/1/2  Flags: none

## Review basis

This reviews board plan v9, board contract v10, client API contract v12, and the joins with roles plan v14. `board/` denotes the supplied `board-r5/lgtm-message-board/` directory. `inputs/` denotes the supplied `board-r5/inputs/` directory. Repository citations refer to commit `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`, unless explicitly marked `9e386b0`. Both checkout heads were verified. Findings concern the written implementation brief, not failures observed in an implementation of the board.

The owner's direct-engine-edit authorization, the lead's subsequent rulings, and the listed known gaps bind this review. No additional owner approval is inferred for changing the engine. No accepted security boundary or pending scope exclusion is reopened.

## Findings

### C5-01. MAJOR. The level rules lose a stop's permanent effects when the agent resumes before reconciliation

Category: Design; Bug (lifecycle and repair). Evidence status: confirmed decision gap. Responsible builder: board units 2a and 3b, with unit 3c for the equivalent membership transition.

Scenario: Lead L manages a plain channel and has an open must-reply post Q. Switch the board off, stop L through the engine, resume L with `resume --fresh`, and switch the board on. All these operations are permitted. At the whole-state scan, L is no longer stopped. The specified predicates therefore neither withdraw Q nor move the manager seat. A later reply can create a completion for the old Q, although the stop was supposed to withdraw it without owing a completion. Without a reply or manual close, that old post can also hold the resumed L unsettled indefinitely. The channel keeps L as manager despite the promised permanent succession on its stop.

Evidence:

- An author's stop closes its post `withdrawn`, and a stopped author is owed no completion (`board/plan.md:427`, `board/plan.md:430`). A manager's stop permanently moves its seat (`board/contract.md:84`, `board/contract.md:89`).
- The actual reactor predicates are an author that **is stopped** and a manager that **is stopped** (`board/plan.md:707`, `board/plan.md:710`). They run over current views at switch-on and keep no position (`board/plan.md:670`; `board/contract.md:661`).
- The board view's stopped set follows both `AgentStopped` and the change out of stopped (`board/plan.md:519`). Its stop fold drops already-owed completions; the exhaustive fold criterion does not retain the pending post withdrawals or manager successions (`board/plan.md:536`). Storing a stopped set until resume is insufficient to retain those duties afterward.
- The engine explicitly allows resume from stopped and the transition to starting (`packages/contracts/src/stateMachine.ts:58`, `packages/contracts/src/stateMachine.ts:70`). Fresh resume writes `StateChanged starting` without requiring a reloadable session (`packages/engine/src/commands/resume.ts:21`, `packages/engine/src/commands/resume.ts:26`). The stop planner writes its engine cleanup, not board terminal events (`packages/engine/src/commands/stop.ts:9`).
- Disabling the board stops its reactor while its view continues folding the log (`board/contract.md:714`). Thus the scenario does not depend on winning a narrow scheduler race. With a startup setting, stop and resume can occur during a whole service run with the board disabled, before a subsequent enabled restart.

Why the earlier answer fails: Round 4 group 3, decision row 105, replaces edge handling with level rules to make lost work recoverable. That answer works for a delivery whose terminal status remains visible. It does not work for a lifecycle or membership condition that becomes false again before reconciliation. Row 114 fixes debt that already existed at the stop, but not effects still awaiting the reactor. Round 4 critic check C4-PB7 expressly asked for delayed reconciliation across recovery and rejoining; the present predicates leave its required historical distinction undefined. This finding preserves L30's manager policy and the no-position design choice; it identifies missing durable input for implementing them.

Suggested fix: Retain pending transition effects in the board fold, or define equivalent historical predicates from retained event sequences. A stop must remain actionable for the posts and manager tenure that existed when it occurred, even after resume. Clear the pending duty only through its corresponding board terminal event. Apply the same reasoning to a removal followed by rejoining and a crash followed by resume. Do not let an old transition terminate a new post created afterward, and preserve the agreed late-reply upgrade while a post remains open. Name the additional view fields or event folds, update criteria 2.1 and 4.5, and test the disabled interval as well as a delayed live reactor. A durable pending-duty representation can still use level rules and need not add a reactor cursor.

### C5-02. MINOR. Reading a question does not remove its already-queued duplicate wake

Category: Bug (timing and unnecessary turns); Design (acceptance criteria). Evidence status: confirmed incomplete cleanup rule. Responsible builder: board units 3a, 3b and 4.

Scenario: A full wake W1 omits question Q. W1 is accepted, and the reactor queues W2 for Q while the agent is still in W1's turn. The agent follows the supplied `board.read incoming` hint, reads Q, answers the questions from W1, and ends its turn without answering Q. Reading Q is explicitly sufficient to count as having reached the agent. However, W2 is still queued and is sent for another turn.

Evidence: Acceptance of W1 triggers the next overflow wake (`board/contract.md:342`; `board/plan.md:721`). Criterion 3.8 says that reading the overflow and ending the turn leaves the target settled (`board/plan.md:635`), and the general condition says the same for a read but unanswered question (`board/plan.md:750`). Cleanup is specified for closure or an addressee's disposition, neither of which a read causes (`board/contract.md:365`). The reactor's queued-wake cleanup covers lost reading authority, not posts already read (`board/plan.md:741`). W2 therefore still passes the reach rules at `board/contract.md:174`. The existing engine considers a queued delivery unsettled (`packages/engine/src/routing/waits.ts:41`) and dispatches it once the target is idle (`packages/engine/src/routing/deliveries.ts:230`).

This is the reverse ordering of round 4 group 2's repair: the automatic overflow delivery is queued before the alternative read completes. The new read-state condition avoids a permanent hold, but does not retire that redundant delivery. The limited consequence is an unnecessary turn and delayed settlement, so this is a minor finding.

Suggested fix: Specify how a successful read retires the delivery demand for the marked posts from any still-queued wake, preserving other unread questions and owed completions. Keep the rule that a sent wake cannot be recalled. Add both orderings to `board/wakes.test.ts`: read before the next wake is built, and read after it is queued but before sending. If cleanup is delegated to a reactor, also define the send-time protection needed to prevent the duplicate from winning that race.

### C5-03. MINOR. The final diff gate includes changes from dependencies that the plan requires

Category: Design (verification). Evidence status: confirmed incompatible gate scope. Responsible builder: board acceptance unit 5 and the plan owner.

Scenario: Client API units 1b and 3 land in their prescribed order. The board then completes unit 4 and runs criterion 6.6. Its diff starts at the unit-1b merge, so it also includes the later client API unit's tests. The criterion allows only new board files and files named by the board's engine-change table. Correct dependency work can therefore fail the board's gate.

Evidence: The exact baseline and whitelist are at `board/plan.md:856`. Unit 4 explicitly depends on client API unit 3, and acceptance unit 5 depends on unit 4 (`board/plan.md:1092`). This is also not a purely additive board-test change: task 5.1 explicitly modifies `packages/engine/test/client/snapshot-size.test.ts` (`board/plan.md:828`), while B9's test cell does not name that file (`board/plan.md:396`). The gate does not say to subtract prerequisite commits or to examine the board's own patch instead.

Suggested fix: Apply the existing-test inventory check to the board's changes relative to the integrated prerequisites, or otherwise exclude the recorded dependency changes explicitly. Add the snapshot-size fixture to B9's named test updates. Keep the full integrated `pnpm check` gate.

## Risk register

The scores are severity × fallout × probability. Decisions remain with the owner. No severity-floor adjustment applies.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Responsible area | Decision and deadline |
|---|---|---|---|---|---|---|---|
| C5-01 | 6: stop cleanup and manager succession remain wrong until repaired by hand | 3: one installation; the owner can close posts and stop the manager again | 4: reconciliation is deferred across a stop and resume, including an explicit disabled interval | 72, schedule | Confirmed written predicates lack the durable distinction | Board view and reactor | Unset; this phase or a dated owned follow-up |
| C5-02 | 2: an unnecessary model turn and delayed settlement | 3: the next delivery and turn can clear it | 6: an ordinary explicit read while its delivery is queued | 36, record | Confirmed missing cleanup case | Board wake/read integration | Unset; review at phase end |
| C5-03 | 1: a verification gate attributes dependency changes to the board | 1: development only | 10: the stated comparison includes prerequisite changes when they land after 1b | 10, record | Confirmed gate mismatch | Board acceptance | Unset; review at phase end |

## Proposed post-build checks

These checks follow the decision corrections above. They do not postpone C5-01's missing durable predicate to implementation review.

| Id | Scenario | Expected result | Required evidence | Responsible area |
|---|---|---|---|---|
| C5-PB1 | Disable the board with L managing a channel and Q open, stop and fresh-resume L, then enable the board. Repeat with a delayed live reactor and a restart before its write. | Q is withdrawn without revived debt; the old manager tenure transfers once; a new post after resume survives the historical stop. | Stop/resume and board event sequences, pending duties, manager and post views, live/rebuilt equality. | Board 2a/3b |
| C5-PB2 | Remove and re-add a label while reconciliation is suspended; separately crash and resume an addressee before reconciliation. | Obligations existing at the transition receive the contracted disposition, with the agreed late-reply upgrade; new obligations remain unaffected. | Post creation sequences, transition history, dispositions, queued wakes, rebuilt state. | Board 3b/3c |
| C5-PB3 | Accept the first capped wake, wait until overflow W2 is queued, then read W2's questions during the current turn without answering them. | No redundant send of the read questions; unrelated duties and completions survive; settlement follows the corrected policy. | Read marks, withdrawal/replacement events, runner sends, engine and owner wait results. | Board 3a/3b/4 |
| C5-PB4 | Run the real capacity-hold sequence of criterion 6.7, with roles unit 11b built before and after the board's acceptance unit. | Replacement stays behind the queue hold; an empty held queue remains unsettled; release settles it; both installation orders provide the held cases. | Persisted hold/release/withdrawal events, rebuilt views, sends and both wait results. | Board acceptance; roles 11b |
| C5-PB5 | Integrate on `9e386b0` and exercise the existing setup-preemption and redaction paths while adding the piece tables. | The later engine's authorized stop preemption and credential registration remain intact; typed board identifiers join consistently between wake records, delivery sources and receipts, while text is redacted. | Existing setup/security regressions, board source joins, receipts, secret scans and rebuild comparison. | Shared engine units; board contracts/wakes |

## Noted, not filed

### Round 4 answers and earlier decisions

| Round 4 group | Assessment of the current answer |
|---|---|
| 1: stale owner-wait results | Preserved. Criterion 5.9 uses one views value and a batch-end read before any exit; the API contract's section 3 supplies the gate. No return/acceptance freshness finding is repeated. |
| 2: undelivered overflow and missing condition inputs | The delivery-status input and automatic overflow queue rule are present in criteria 1.7, 3.8 and 4.6. C5-02 concerns the additional read-after-queue ordering, with a limited extra-turn consequence. |
| 3: lost reactor work and unchecked writes | E23 and criteria 4.10–4.12 supply the checked transactional write path, recovery guard and refusal behavior. C5-01 identifies where the no-position repair fails for reversible triggering states. |
| 4: management on crash and direct-channel cardinality | The chosen policy is retained: stops transfer the stored seat, crashes grant acting rights only, plain openers stay members, and direct pairs have no manager. C5-01 concerns carrying out a stop's transfer after resume, not changing that policy. |
| 5: planner replies | E3, B1/B5 and criterion 3.14 provide command-specific replies from the committed batch and idempotent retries. |
| 6: read-page receipts and stale access | `board.read` is a non-deduplicated read with marks. Criterion 5.11 covers no stored page and retry after removal. |
| 7: returned piece sender | E15 now names all three sender-bearing fields, including `DeliveryReturned.sender`; criterion 4.3 uses the real failure path. |
| 8: unbounded reply identifiers | Completions name at most 17 deciding reply ids and a total count, with paged `repliesTo`; criterion 3.13 retains both long and repeated-reply cases. |
| 9: lifecycle table and visibility samples | B2 and criterion 1.10 name the table entry and visibility samples. |
| 10: omitted security post-build checks | Checks 16 and 17 remain, and criterion 6.3 includes the withdrawn-text read controls, now including agent `client.event`. |

The remaining round 4 minors are also retained: accepted-then-returned wakes do not retry; the stop fold removes already-owed debt and resets read state on resume; sent completions cannot be copied into another wake; reloaded withdrawals run wait checks; disabled status returns empty condition lists and the public disabled reason; and the service startup anchor and direct-service wording are corrected. C5-01 distinguishes already-owed debt cleanup from terminal duties not yet recorded.

Rounds 1–3 retain sparse read positions, per-addressee cleanup, same-channel replies, explicit close authority, structural direct grants and fixed group anchors, start ceilings, authenticated author headers, bounded encoded messages, receipt-copy inventory, owner-only board events, the documented parent-thread exception, durable completion debt and its retry/flush repair, late replies, service-address refusals, and no timed informational wake. No earlier policy is silently reopened.

### Engine changes and the newer checkout

| Change | Recorded-code and test-inventory check |
|---|---|
| B1 | The command group and inventories exist at `packages/contracts/src/commands.ts:44` and `packages/mcp/src/tools.ts:6`. E1/E2/E10 supply the group, access table and CLI naming changes. The exact command/MCP tests and CLI parity fixtures exist (`packages/contracts/test/commands.test.ts:46`, `packages/cli/test/parity.test.ts:25`). Keeping expectations permits the named fixture and table adaptations. |
| B2 | The event union is at `packages/contracts/src/events.ts:88`; the exhaustive lifecycle table is at `packages/contracts/src/stateMachine.ts:79`. The visibility sample assertion exists at `packages/engine/test/api/subscribe-visibility.test.ts:149`. The required existing tests are named. |
| B3 | State, initialization and folding exist at `packages/engine/src/views/apply.ts:92`, `:114` and `:338`. The named view/rebuild/comparison files and view fixtures resolve. |
| B4/B5 | Source handling, failed returns and transactional dispatch exist at `packages/engine/src/routing/deliveries.ts:61`, `:130` and `:239`. E15–E18 and E23 cover the proposed changes; handler/delivery/account tests are named. |
| B6/B7 | Settlement and blocking request-held checks are at `packages/engine/src/routing/waits.ts:39` and `:83`; projected batch checks are at `:110`. E19/E20 and the named existing wait tests cover these deliberate behavior changes. |
| B8 | Current followers start at `packages/engine/src/commands/CommandHandler.ts:177`. E6 supplies the future service-level reactor assembly. The plan now identifies the two locations correctly. |
| B9/B10 | Existing special reads and public errors are at `packages/engine/src/api/server.ts:153` and `:41`. E4/E9 supply reads/snapshots, and B10 explicitly adds the disabled reason. C5-03 covers the remaining verification inventory mismatch. |
| B11/B12 | These are explicitly future panel and alert-table entries, supplied by the API dependencies, not claims that corresponding production code exists at the recorded commit. The panel and real first-start alert have named tests. |

I compared the named existing source files and their supporting paths between `8ff4c9b` and `9e386b0b0fef88a1951a1a088ed5ac78e6b711cc`. The contracts' event/lifecycle definitions, engine views, delivery dispatcher, holder rules, stop/resume planners, API server and fake-agent source used above are unchanged. The wait file's change is a comment. The command schema adds a harness-reset payload variant while retaining the same command names (`9e386b0`, `packages/contracts/src/commands.ts:127`). Neither invalidates the board's named edits.

The handler and service assembly have real newer behavior: authorized start preemption (`9e386b0`, `packages/engine/src/commands/CommandHandler.ts:197`), first-default loading (`:128`), live credential registration (`9e386b0`, `packages/engine/src/service.ts:89`) and schema-position-aware redaction (`9e386b0`, `packages/engine/src/log/redactionStructure.ts:23`). Those must be preserved during integration, as C5-PB5 records. I found no demonstrated new conflict between these additions and a board policy, so I file no drift finding based merely on new code or shifted anchors.

### Joins, gates and execution record

The roles service's no-reply direct notices, explicit flushes and reader tracking fit board contract v10. Its view now joins `board.WakeBuilt` source ids to `DeliveryQueued` before acceptance tracking (`inputs/roles-plan.md:548`). The capacity-hold test has the same second-builder ownership in both plans (`board/plan.md:857`; `inputs/roles-plan.md:1210`). The API's agent event recovery, guarded table calls, complete-state wait gate and board subject panel are folded into the board. No additional join contradiction was found.

The ten-gate check finds named source coverage, observations for acceptance, per-workstream risks, one rollout order, current engine targets, and nine sized build units. The subject-panel behavior supplies a text UI brief. The remaining gate corrections are the findings above. Scopes and vendor allowances remain the named launch prerequisites. The four WIDENED exclusions remain known gap 7 under L14. No additional unmarked scope exclusion or unconfirmed blanket scope expansion was found against the effective decision rows and supplied owner rulings.

The supported maximum agent population is still relevant to complete condition lists within the snapshot cap. This was already noted in round 4, and the plan retains its size checks; no new population-limit finding is asserted.

The review used Node.js 26.13.0 after `nvm use`. Some combined file reads exceeded output limits; cited sections were reread in smaller ranges. This was a static plan and source review. No application test suite, dependency installation, application edit, commit, push, delegation or team-board operation ran. No new Effect-library claim was needed. The recorded checkout remained clean. The assigned scratch directory was never created and was checked absent before writing this report. Only this assigned result file was written. No policy refusal prevented a check.
