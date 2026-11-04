revise
Grade: 7  B/M/m: 0/1/0  Flags: none

# Round 5 threat-model review

The plan has one confirmed lifecycle design defect. The round 4 change to a reactor with level rules does not retain a stop's outstanding duties across a resume. A question can remain open without a wake, and a channel can retain the manager whose stop was supposed to transfer its seat. The fix fits the current architecture.

This is a plan review, not a claim that the board implementation has failed a test. There are no new confirmed security findings. The owner's rule that security fixes are deferred still applies. The revision recommendation concerns the promised lifecycle flow, not a security veto.

## Scope and evidence

I checked plan version 9, board contract version 10, their decisions and scouting, the four earlier finding maps, the known gaps, the supplied rulings, client API contract version 12 and design decisions, and the joins with roles plan version 14. Repository guidance, SECURITY.md, the engine design and its amendments, the engine plan and decisions, and the relevant open issues informed the boundary checks.

Unless stated otherwise, repository file anchors below refer to commit `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. The separate comparison checkout is at `9e386b0b0fef88a1951a1a088ed5ac78e6b711cc`. References to `plan.md`, `contract.md` and `decisions.md` mean this review's shepherd-message-board folder. References beginning `inputs/` mean the supplied round 5 inputs.

## Finding R5-TM-1: A resume erases an unperformed stop duty

**Severity:** MAJOR. **Category:** Design, lifecycle and repair policy. **Responsibility:** The integrity and access checks exposed this lifecycle error. The counted consequence is a core flow requiring manual repair, not cross-account exposure or permanent data loss. **Evidence:** Confirmed from the specified fold and predicates; no runtime reproduction claimed. **Builder:** Board backend, units 2a, 3b and 3c.

**Scenario.**

1. A lead posts a question to one paused worker in a plain channel. Its wake remains queued.
2. The engine is restarted with the board disabled. The owner stops the worker and resumes it with `resume --fresh` while the board remains disabled.
3. The engine is restarted with the board enabled. The worker is now available. The original question was neither answered nor closed.

This uses the supported disable path, not a hostile agent or an invalid command. The board's background work stops while disabled, while its log still rebuilds (`plan.md:221`, criterion 5.10 at `plan.md:817`). The engine allows resume from stopped (`packages/contracts/src/stateMachine.ts:58`, transitions at line 70). A stop revokes the agent's tokens and handles its queued deliveries (`packages/engine/src/commands/stop.ts:9`). The board's source rule specifies withdrawal on target stop (`plan.md:392`). A fresh resume writes a change to starting and requeues accepted deliveries; it does not resurrect the withdrawn, unaccepted wake (`packages/engine/src/commands/resume.ts:19`).

The board fold records the worker as stopped, then clears that marker on the change out of stopped. It also advances the worker's read state to the channel's last post (`plan.md:519`, criteria 2.1 and 2.3 at lines 536 and 538; `contract.md:497`). On the eventual scan, the worker is neither stopped nor absent from the plain channel. The current-state lifecycle predicate therefore does not resolve it `gone` (`plan.md:704`). The question is now read, so the unread-question requeue rule does not queue it either (`plan.md:721`). The lead's open outgoing question keeps the lead unsettled (`plan.md:744`). A whole-state scan cannot repair this from those predicates. The owner must find and close the question manually.

The same root cause affects the manager rule. If that worker manages a channel, a stop followed by resume while the reactor is off leaves the old manager in place. The scan asks only whether the stored manager is stopped (`plan.md:710`). This contradicts the contract's explicit rule that a stop transfers the seat for good and rights never return (`contract.md:84`). A stopped author's open posts can similarly escape their required withdrawal (`plan.md:707`).

**Why the earlier answer fails.** Decision row 49 says that a stop is judged when it happens and a later resume does not re-add the addressee (`decisions.md:59`). Row 84 preserves lifecycle resolution separately from channel membership (`decisions.md:94`). Round 4 row 105 then promises that a whole-state run recovers duties missed during downtime or a disabled interval (`decisions.md:115`). Its current-state predicates cannot meet that promise after the condition disappears. Row 114 fixes completion dropping and join positions in the fold, but clears the only specified stopped marker without retaining the other stop duties (`decisions.md:124`). This is a failure of the round 4 answer, not a request to repeat the already answered durability finding.

The engine agents view replaces current lifecycle state (`packages/engine/src/views/apply.ts:198`). The engine does retain thread history (`packages/engine/src/views/apply.ts:338`), so the needed evidence is not irretrievably lost. However, the plan specifies neither a historical predicate nor replayable pending stop duties. Criterion 2.1 explicitly ignores other events, and the reactor is described as acting while the current condition holds (`plan.md:536`, `plan.md:670`; `contract.md:661`). Existing restart tests do not include a stop followed by resume before catch-up (`plan.md:764`).

**Suggested fix.** Keep the lead-approved reactor with level rules. Specify replayable pending lifecycle duties, or an explicit historical predicate, that survives a later resume and is scoped to the affected post or manager tenure. A past stop must not affect posts created after that stop. Clear a pending duty only once its resolution, withdrawal or manager handoff is committed. Define the corresponding crash and reload-failure behavior, preserving the explicit exemption for interruption that recovery successfully reloads.

Add acceptance cases for stop and fresh resume before the first scan, both while disabled and with the reactor held back. Cover an addressee, an author and a manager. Assert the required disposition and completion, withdrawn author posts, irreversible manager handoff, and equality of live and rebuilt views. Retain criterion 4.11's successful-recovery control case. This decision belongs in the plan before building; only the race mechanics belong in post-build checks.

## Risk register

| Finding | Severity | Fallout | Probability | Score and band | Evidence and owner | Decision, deadline and closing evidence |
|---|---|---|---|---|---|---|
| R5-TM-1. Stop duties disappear before catch-up. | 6. A core question or manager lifecycle flow remains wrong until repaired by hand. | 3. One installation; the owner can close and recreate the affected coordination. | 4. A delayed reactor or maintenance interval spans an otherwise valid stop and resume. | 72, Schedule. | Confirmed design counterexample. Board backend. | Owner decision pending. Within this phase or a dated follow-up with an owner under the scoring rule. No acceptance or closing evidence yet. |

This score does not impose an automatic phase block. The grade and verdict record the missing lifecycle decision for adjudication.

## Six security responsibilities

| Responsibility | Trace and result |
|---|---|
| Isolation | Channel membership gates board reads and posts; direct grants and ceiling checks are separate. Queue checks use the projected batch, and send checks judge each carried post again. Board events are owner-only, have no top-level `agentId`, and the agent snapshot omits the section. Resent reads get current authorization. No additional unresolved read boundary found (`plan.md:543`, lines 545–547; `contract.md:482`, lines 509–518). Channels remain routing boundaries under the accepted same-user model. |
| Identity across sessions | Post authors come from authenticated callers. A device is the owner with device attribution; a service uses its own in-process identity. Agent resumption does not invent another owner. The open web server has no sign-out or separate-person sign-in, by the owner's explicit choice; later pairing is not implemented by this board. No extra account-switch promise is inferred (`contract.md:549`, lines 569–570; `inputs/client-api-contract.md:294`, line 1452). |
| Access | Board delivery grants no lifecycle authority. Services have no wire credential and cannot call `board.read`; piece reactor batches use E23 and their own namespace. Manager and acting-manager rights otherwise remain distinct. R5-TM-1 covers the missed final handoff. Check `board.status` separately because it permits a holder to see bounded metadata, not channel text (`contract.md:573`; `inputs/client-api-contract.md:404`, line 441). |
| Integrity | Planner replies, read marks, durable source identity, returns, bounded completions and wait checks now have specified transaction paths. Read marks are monotonic and pages are not deduplicated. The remaining lifecycle catch-up failure is R5-TM-1. The plan's transaction and rebuild checks remain necessary implementation evidence (`plan.md:536`, lines 641–642, 670–697; `contract.md:482`). |
| Confidentiality | The copy inventory names posts in the event log, queued wakes, prompt events, command receipts, memory, device copies and harness sessions. Closing erases none. The shared contract additionally lists the write-ahead log, exports, diagnostics, proxy logs and notification copies. Browser memory is distinct from persistent thread storage. Alerts contain fixed metadata and a link, never post text. Encryption and remote transport follow the accepted client API design; this board adds no independent public listener or sensitive store (`contract.md:534`; `inputs/client-api-contract.md:1117`, line 1433). |
| Secrets and dependencies | Redaction must happen before storing posts and again for assembled wakes. Harness login credentials and split-secret assembly remain named checks. No new library is required by the board plan. The board's secret keep entry is none, so it cannot keep a carrier or account secret alive (`plan.md:633`, lines 919–928; `contract.md:651`). No new dependency or secret-storage decision found. |

## Earlier answers and shared contracts

The round 1–3 protections remain specified: structural anchors, original permission ceilings, separate lifecycle and membership handling, same-channel replies, read-time authorization, per-post send checks, bounded pages and completions, service attribution, and the privacy limits. R5-TM-1 identifies the one retained promise that the later reactor change does not satisfy.

| Round 4 group | Round 5 result |
|---|---|
| 1. Owner wait freshness | Retained through the shared sequence gate and complete `board.status` condition lists, including disabled mode. |
| 2. Left-out questions | Retained through unread-question requeue and marks from both accepted wakes and explicit reads. The stop/resume case above is a different invalidation of those predicates. |
| 3. Reactor durability and checked writes | E23 supplies checked writes with piece attribution. Historical stop duties still fail as described in R5-TM-1. |
| 4. Manager crash | A crash no longer transfers the seat or changes membership. Acting rights are computed. The missed stop handoff is part of R5-TM-1. |
| 5. Planner replies | Five planners supply ids and counts from their own committed batch; no post text is returned in their receipts' reply field. |
| 6. Stored read pages | Reads bypass receipts and deduplication. A read with marks writes marks only, using E4 and E23. |
| 7. Return sender | E15 covers `DeliveryReturned` as well as queued deliveries and prompt text. |
| 8. Completion size | Deciding reply ids and counts replace the unbounded list; text and wake budgets remain explicit. |
| 9. Engine inventories | B2 names the lifecycle table and the exhaustive visibility fixture. |
| 10. Dropped checks | The fresh-resume reach check and all text-bearing stream/read routes are restored as checks 16 and 17. |

The other round 4 answers remain present: accept-then-return does not count toward retries, stopped-agent completions are dropped by the fold, a sent completion cannot be packed twice, disabled status stays readable, and service direct grants remain consistent. No separate finding is charged for any of these answered items.

The client API joins agree on E3 planner replies, E4 reads with marks, E9 coherent snapshots, E15 sender identity and data envelopes, E17 namespace-limited withdrawal, E18 queue/send reach, E19 settled input including delivery statuses, E20 held requests, E23 piece batches, E30 guarded tables, and agent-callable `client.event` with owner-only board events still excluded. The board correctly names no extra `ownerHeld` trigger because its post and close events are already in the shared trigger table (`contract.md:470`).

The roles joins agree on the service's direct notice pair, no service board reads, paged status, board-off suspension, capacity-held queues and the release path. The joint hold test is assigned to the second builder rather than silently left to another plan (`plan.md:857`, criterion 6.7; `inputs/roles-plan.md:1435`). No additional roles contract change is needed to describe R5-TM-1's root cause.

## Named engine edits and later-commit check

| Board change | Recorded-commit check and test impact |
|---|---|
| B1 | The command group already merges another group at `packages/contracts/src/commands.ts:135`. The exact tool inventory is pinned at `packages/contracts/test/commands.test.ts:46`. B1 names that fixture change and the inventory/parity checks. |
| B2 | The exhaustive lifecycle table is at `packages/contracts/src/stateMachine.ts:79`. The visibility samples and exhaustive assertion are at `packages/engine/test/api/subscribe-visibility.test.ts:52` and line 149. B2 names both, plus event round trips. |
| B3 | The central fold is at `packages/engine/src/views/apply.ts:338`. B3 names apply, rebuild, compare-views and the shared view fixture. |
| B4–B5 | Send reservation and delivery execution are at `packages/engine/src/routing/deliveries.ts:239`. Return sender and source treatment are at lines 45 and 61. Planner selection and receipt/reply handling are at `packages/engine/src/commands/CommandHandler.ts:67`, line 97 and line 237. E3, E15–E18 and E23 supply the prerequisite shared changes. The board names handler, delivery and carry-on tests. |
| B6–B7 | Existing held and settled predicates are at `packages/engine/src/routing/waits.ts:33` and line 39; blocking request-held cancellation is at line 83. E19 and E20 provide the shared conditions. The old no-board wait tests retain their expectations by criterion 4.8. |
| B8 | Existing followers start at `packages/engine/src/commands/CommandHandler.ts:177`. The new service registration depends on E6 and E23, as stated. |
| B9–B10 | Existing routing distinguishes subscribe and debug before command execution at `packages/engine/src/api/server.ts:153`. E4/E9 add the new read and snapshot tables. The public error allow-list is at line 41. B10 explicitly adds the disabled reason and transport checks. |
| B11–B12 | These register into tables the client API units will create. Their absence from the baseline is not a defect. The subject fallback test and first-start alert fixture have named owners. |

I compared the touched existing files with `9e386b0`, rather than treating shifted anchors as defects. No additional confirmed change makes B1–B12 wrong. The later command handler adds start preemption and a second credential check before the main command transaction (`9e386b0:packages/engine/src/commands/CommandHandler.ts:202`, line 237). This deserves the composition check below when E12 adds the open-web credential. The current stop-preemption test uses the owner credential (`9e386b0:packages/engine/test/commands/start-setup.test.ts:55`). This is not charged as a defect in the board plan or as proof that the future E12 implementation omits that branch.

## Proposed post-build checks

These supplement the plan's twenty existing checks. None substitutes for deciding R5-TM-1.

| Id | Scenario and expected result | Evidence and responsible area |
|---|---|---|
| R5-TM-PB1 | After the lifecycle policy is fixed, hold the reactor, stop and fresh-resume an addressee, author and manager, then restart and enable the board. Each pending duty commits once; another scan writes nothing. | Real command path, log and live/rebuilt view assertions. Board backend. |
| R5-TM-PB2 | Read as a member, remove access, and repeat the same read request id, including single-post and reply pages. No old page returns from a receipt. Agent `client.event` cannot retrieve board events or a withdrawn wake's text. | Both transports with real caller credentials, including the no-receipt assertion. Board/API backend. Retains checks 16 and 17. |
| R5-TM-PB3 | Change membership or a direct grant while a wake waits for its send transaction. Only allowed posts survive; refused text never appears in delivery, prompt or agent-visible read routes. | Delivery race trace plus API output. Board and dispatcher builders. Retains checks 1, 7 and 15. |
| R5-TM-PB4 | Rotate a harness login secret during the run and combine posts containing planted secret fragments. Check posts, merged wakes, receipts, exports and diagnostics. | Search all specified copies for planted values; inspect fixed diagnostic fields. Board, redactor and harness builders. Retains checks 3 and 6. |
| R5-TM-PB5 | At the later engine commit, an authorized open-web stop cancels a start whose setup never returns. An invalid agent credential cannot preempt it. | Extend the start-preemption scenario through E12's actual caller path, preserving the current bounded-stop expectation. Client API/engine builder. |
| R5-TM-PB6 | Render planted markup, a script URL and copied envelope markers, then open a board alert. No script runs, no author/header is spoofed, and opening the link writes no read mark. | Real browser and log capture. Board web builder. Retains check 20. |

## Verification limits and work log

The two checkout commits and the clean status of the recorded checkout were verified. No repository file was changed, no dependencies were installed, and no commit or push was made. The designated scratch directory was never created.

Node.js 26.13.0 was selected with `nvm use`. A proposed source-import probe could not start because this checkout has no installed `@shephrd/contracts` package; Node returned `ERR_MODULE_NOT_FOUND`. No runtime or test pass is claimed. The finding was checked instead against the transition table, resume writer, fold definition and reactor predicates.

Context7 returned a monthly quota error. I used official documentation as the permitted fallback on 2026-11-03. The current [Effect Schema reference](https://effect.website/docs/v4/api/effect/Schema) documents synchronous unknown decoding, and the [RpcGroup reference](https://effect.website/docs/v4/api/effect/rpc/RpcGroup) lists merge, omit and prefix. These current pages are not proof of every behavior of the repository's pinned 4.0.5 package. No finding relies on an untested duplicate-tag or parser behavior.

## Noted, not filed

- The owner's approved open web server, later pairing, and deferred separate operating-system user are accepted architecture choices. I did not re-file their known consequences.
- Channels do not hide text from a deliberately hostile program running as the owner's user. Parent thread visibility is also stated.
- Infinite retention, lack of post deletion, unencrypted local storage, and harness session copies are existing stated limits, not new board omissions.
- Already delivered text cannot be recalled. An external delivery without replay proof can duplicate after recovery under the engine's accepted guarantee.
- The four WIDENED exclusions, scope provisioning, and the pending owner answer on persistent web permission answers are already tracked. I reviewed the recommended denial as written.
- Service subscription to owner-visible events is intentional in-process trust; its lack of `board.read` is not a secrecy boundary against trusted engine code.
- A user deliberately bypassing a limit they set for themselves is not counted.
- Security issues discovered during implementation still go through the lead to `docs/issues.md` and the manager under run rule 8. This read-only reviewer has not written those files.

refused: none.
