revise
Grade: 7  B/M/m: 0/1/0  Flags: none

## Review basis

This reviews board plan version 9 and board contract version 10 against client API contract version 12 and roles plan version 14, through the logic and failure-policy lens. The recorded repository is `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. The later comparison is `9e386b0b0fef88a1951a1a088ed5ac78e6b711cc`.

Repository citations refer to the recorded checkout unless another commit is stated. Plan citations are relative to this report: `../plan.md`, `../contract.md`, `../decisions.md`, and `../../inputs/`. This is a review of decisions, not a report that an implemented board passed tests.

## Findings

### R5-L1. Resume can erase a lifecycle duty before the level-rule reactor records it

Severity: **MAJOR**. Category: **Design; Bug (timing and failure policy)**. Evidence status: **Confirmed contradiction between the prescribed state and repair rules**. Responsible builder: board units 2a and 3b, coordinated with the roles crash-retry builder.

**Scenario.** L manages channel C and has an open must-reply post P. Delay the board reactor after the engine commits `stop L`. The board fold drops L's existing completion debt, but P's withdrawal and C's manager change belong to the later reactor transaction. Before that transaction runs, the owner calls `resume --fresh L`. Resume clears the stopped state. Release the reactor. Its current-state rules no longer find a stopped author or manager. P remains open and C remains managed by L, although the contract requires P to be withdrawn and management to pass permanently. If a recipient stays silent, P keeps the restarted L unsettled until someone closes it by hand. If a recipient answers instead, it can create a completion for work that the stop was supposed to end.

The ordinary crash path has the same problem. A question's addressee crashes, and the sheepdog resumes it before the board processes the crash. The current addressee is now starting, working or idle, so the rule no longer resolves it `gone`. This breaks the roles plan's explicit promise to tell the holder that its posts resolved `gone` and must be posted again.

**Evidence.**

- The reactor keeps no position, builds its batch from the current views inside the writer transaction, and uses current-state conditions for a stopped/crashed addressee, stopped author and stopped manager (`../plan.md:670`, `../plan.md:679`, `../plan.md:704`, `../plan.md:707`, `../plan.md:710`; `../contract.md:661`).
- The board view keeps the current set of stopped agents and clears that state on the change out of stopped (`../plan.md:519`). Criterion 2.1 enumerates the fold's engine events and says it ignores every other event. It records no pending lifecycle duty and does not fold `AgentCrashed` (`../plan.md:536`). Neither the stop's required post closure nor its manager change is folded synchronously.
- The promised outcomes remain unconditional: a stopped author's post closes withdrawn, an addressee's stop/crash resolves gone, and management moves on stop and never returns on resume (`../contract.md:85`, `../contract.md:225`, `../contract.md:251`; `../plan.md:540`).
- At `8ff4c9b`, stopping commits `AgentStopped` and engine delivery cleanup, without a board event (`packages/engine/src/commands/stop.ts:9`). Stopped and crashed agents may both resume (`packages/contracts/src/stateMachine.ts:57`, `packages/contracts/src/stateMachine.ts:58`). Resume commits `StateChanged starting` (`packages/engine/src/commands/resume.ts:26`), and the agents view replaces the current lifecycle state (`packages/engine/src/views/apply.ts:201`, `packages/engine/src/views/apply.ts:205`). Publishing a commit applies its views before waking followers; it does not wait for their repair writes (`packages/engine/src/log/EventLog.ts:136`).
- Roles criterion 4.6 explicitly resumes the first crash automatically and tells the holder its posts resolved gone (`../../inputs/roles-plan.md:939`). No ordering barrier between that resume and the board's resolution is specified.
- The cited stop, resume, state-machine and views behavior is unchanged at `9e386b0`. This is a defect against the recorded commit, not a finding caused by shifted lines in the later checkout.

**Why the earlier answer fails.** Round 4 group 3 and decision row 105 replaced edge handling with level rules to preserve unfinished work across restarts (`../attack/round-4-findings.md:68`, `../decisions.md:115`). That repair works only while the triggering condition persists. Resume removes it. Row 114 correctly makes dropping already-owed completions durable, but it also clears the stopped marker without preserving the other unfinished duties (`../decisions.md:124`). Round 4 group 4's stop-only manager policy remains the intended choice; the defect is that its required transition can disappear before it is written. No owner ruling or known gap accepts that loss.

**Suggested fix.** Make each irreversible lifecycle duty durable before a later state change can erase its cause. For example, have the board fold latch pending duties, keyed by the triggering sequence and the affected posts or manager seat, and let the reactor clear them with its existing board events. A resume may reset membership read positions without discarding those duties. An alternative is to perform the required board transitions in the triggering engine batch, with the corresponding engine edit and tests named. Preserve the rule that a later reply cannot be overwritten. Add schedules in which resume commits before the reactor's first write, rather than testing only restart with the target still stopped or crashed.

## Interacting-rule truth table

These rows assume the board is enabled. The engine's lifecycle result takes precedence over a piece hold for a paused, crashed or stopped wait member (`../../inputs/client-api-contract.md:767`). A live member on ownerHeld takes the owner's early exit after the batch-boundary gate (`../../inputs/client-api-contract.md:797`, `../../inputs/client-api-contract.md:828`).

| State and obligation | Required result | Assessment |
| --- | --- | --- |
| Idle asker with an open must-reply post | Unsettled until closure and completion delivery | Defined by the board's first hold clause. |
| Idle recipient with unread incoming work and no carrying delivery | Unsettled; the reactor queues it | The byte-cap and withdrawal repair is retained. |
| Recipient has read its question and ends without replying | Settled if the engine has no other hold; asker remains unsettled | The earlier silent-recipient decision is retained. |
| Completion returned once before acceptance | Remains owed and unsettled; one retry | Defined, including the repair gap. |
| Completion returned twice before acceptance | Failed debt remains visible; no automatic third retry | Defined; flush remains available. |
| Wake accepted and later returned | No new failure count or completion debt | Row 110 is retained. |
| Idle agent with an open capacity hold and an empty queue | Unsettled until release | Agrees across board criterion 6.7, roles criterion 7.3 and client API E19. |
| Live waited author has a post addressed to the owner | Owner's helper exits 2 after its sequence gate | Agrees with the client API's member table. |
| Crash, then board resolution, then resume | Addressee remains gone unless a permitted late reply upgrades it | Defined. |
| Crash, then resume, then board resolution | Must preserve the crash's disposition duty | R5-L1: the current-state predicate has lost its cause. |
| Stop, then manager change and post withdrawal, then resume | Rights stay with the successor; stopped work stays closed | Defined. |
| Stop, then resume, then reactor scan | Must produce the same succession and withdrawal | R5-L1: neither required duty survives in the prescribed state. |

## Earlier answers and the joins

| Round 4 group | Re-review result |
| --- | --- |
| 1. Owner-wait freshness | Retained. The lists carry one views sequence, and the helper has a gate before every exit (`../contract.md:447`, `../contract.md:464`). |
| 2. Questions omitted by the byte cap | Retained. Read marks count as receipt, delivery status is an explicit condition input, and the reactor has a leftover rule (`../contract.md:335`, `../contract.md:423`). |
| 3. Durable reactor work and its write path | The checked piece-batch path is retained. Durability fails for a condition erased by resume, as R5-L1 explains. |
| 4. Manager movement on crash | The acting-manager and stop-only policies are retained. R5-L1 concerns executing the stop duty. |
| 5. Planner replies | Retained as replies computed from each committed batch (`../contract.md:556`; client API E3). |
| 6. Read-page receipts | Retained as reads with marks and no stored page (`../contract.md:482`; client API E4). |
| 7. Returned sender schema | E15 explicitly widens all three sender fields, including DeliveryReturned (`../../inputs/client-api-contract.md:1899`). |
| 8. Completion size | Retained as bounded deciding-reply ids and text, with paged access to all replies (`../contract.md:272`). |
| 9. Lifecycle rows and visibility samples | B2 and criterion 1.10 name both changes (`../plan.md:389`, `../plan.md:479`). |
| 10. Dropped recovery/privacy checks | Checks 16 and 17 remain, and criterion 6.3 covers the privacy case (`../plan.md:853`, `../plan.md:956`). |

The minor-answer policies also remain: accepted returns count toward nothing; stopped completion debt is dropped by the fold; resumed read state has a join point; a queued/sent completion is not packed twice; disabled status remains readable; the public refusal reason is named; and send-time withdrawal runs wait checks. R5-L1 concerns pending closures and succession, not the already-answered removal of existing completion debt.

The earlier rounds' mapped answers still preserve structural group membership, anchored reach, permission ceilings from AgentStarted, per-delivery send checks, same-channel replies, sparse read marks, bounded completions and status pages, and the no-disposition incoming condition. No answered finding about those policies is re-filed.

The capacity join is consistent: roles owns the queue hold and its release, the engine owns its settled clause, and whichever of roles unit 11b and board unit 5 lands second adds the integrated held cases (`../plan.md:857`; `../../inputs/roles-plan.md:1210`). The owner-post join is consistent through board.post and the subject panel; the pending owner decision about engine answer does not alter that flow (`../contract.md:739`). The crash-retry join is the exception identified in R5-L1.

## Engine edits and later-commit comparison

B1 through B12 were checked against their existing-code anchors and the shared edits they rely on. In the recorded engine, the event table really is exhaustive (`packages/contracts/src/stateMachine.ts:79`), delivery status lives in the deliveries view (`packages/engine/src/views/apply.ts:74`), a batch is projected before wait checks (`packages/engine/src/routing/waits.ts:110`), and the dispatcher records a send before calling the runner (`packages/engine/src/routing/deliveries.ts:239`). The planned table entries and checked batch path address those constraints.

The existing-test inventory now names the relevant command pin, event round trips, state matrix, visibility samples, views and fixtures, routing/waits tests, and CLI parity checks. The relied-on E1 to E5, E8/E9, E15 to E23 and E30/E31 spell out the additional shared changes. No further existing test that must change for a board policy was identified.

The comparison with `9e386b0` included the named source paths and their changed dependencies. The command group adds harness reset; CommandHandler adds first-start defaults and start preemption; start adds bounded setup; reload exports its existing bounded helper; redaction gains schema-position metadata and live login-secret coverage; and the runner gains terminal handling. These changes do not remove the board's named delivery, lifecycle, wait, event or visibility mechanisms. E3's promise to preserve engine hooks and lanes still applies to the newer setup path. No additional drift finding is filed. This comparison does not claim those newer features have been tested here.

## Risk register

| Id | Severity | Fallout | Probability | Score and band | Evidence | Owner | Decision and deadline | Acceptance and closing evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R5-L1 | 6: a required closure or succession can remain wrong until manual repair | 3: the owner can close the stuck post and correct the affected channel | 4: a lifecycle transition followed by an ordinary resume before the asynchronous repair | 72, schedule | Confirmed from the prescribed rules and recorded engine behavior | Board units 2a/3b; roles crash-retry integration | Pending owner/lead disposition; within this phase or a dated follow-up with an owner | No acceptance or closing evidence yet. |

## Proposed post-build checks

| Id | Scenario | Expected result | Required evidence and responsible area |
| --- | --- | --- | --- |
| R5-PB1 | Pause the board reactor; stop a manager with an open authored question; resume fresh; then release the reactor. Repeat with a service restart before releasing it. | The original question closes withdrawn without new debt for the stopped work. Succession happens once and never returns to the resumed opener. | Public command trace, persisted events and live/rebuilt board views. Board 2a/3b. |
| R5-PB2 | Let the real sheepdog resume a crashed addressee before the board reactor writes. Include an all-mode post with another recipient still outstanding. | The crash duty still resolves gone. A permitted late reply upgrades only while the post remains open. CrashRetried's statement matches the actual dispositions. | Controlled follower barriers, board dispositions, notice body and rebuild comparison. Board 3b and roles crash-retry builder. |
| R5-PB3 | Return a wake containing questions and completions, accept its retry, and end the turn with no later board event. Exercise a full wake's leftovers too. | Owner and agent waits agree at complete batch boundaries; all unread questions progress; accepted debt is discharged once. | Actual handler/dispatcher events and helper sequences. Board 3a/3b/4 and client helper. |
| R5-PB4 | Replace and finally withdraw a board wake under a capacity hold, across restart, then release an empty queue. | No send or settled result while held. Release with no work settles. No duplicate idle transition. | Board criterion 6.7 against real roles events, both wait paths and rebuild. Whichever integration unit lands second. |
| R5-PB5 | On the later engine base, store and resend a board post with planted registered secrets and use board ids throughout its receipt, wake, status and reply. | Text is redacted while authenticated identities and cross-record references remain consistent. | Stored event/receipt inspection and the real redactor, not its pass-through test layer. Board 1/3a/4 and engine redaction integration. |

## Noted, not filed

- Known gaps concerning scopes, vendor allowance, the four WIDENED exclusions and the recorded Effect lookup remain assigned as stated. None was re-filed.
- Owner and lead rulings authorizing direct engine edits, deferring security fixes, allowing the open web design, and leaving question 6 pending were honored. No finding treats the withdrawn no-engine-changes rule as binding.
- A recipient that read a question and stayed silent is allowed to settle. A completion that failed twice needs flush or a later wake. Disabling the board intentionally stops its holds and reactor. Those are explicit choices.
- The condition lists' universal size guarantee still depends on agent count. This was already noted in round 4, and is not re-filed.
- The repository remained read-only. Node.js 26 was selected. No application tests were run because the board is a frozen plan. No application code, plans, issue lists or feature lists were edited. No subagents, team-board commands, commits or pushes were used.
- Several combined reads exceeded the tool's output limit. The relevant contract, plan, decision and code sections were subsequently read in smaller ranges. No claim of verification rests on an omitted tool-output section.
- The first result-write command could not run because the unversioned python command was unavailable. It wrote no file. The write was retried with python3.
- No scratch folder was created, and the assigned scratch path was absent at the final check. This result file is the only file written.
