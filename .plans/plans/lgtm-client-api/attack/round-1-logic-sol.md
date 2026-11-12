revise
Grade: 6  B/M/m: 0/4/2  Flags: none

## Review scope and evidence

This is the round 1 logic and failure policy review of the client API (application programming interface) plan and contract v7. Code anchors refer to commit `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. Plan anchors are relative to `lgtm-client-api/` in this review bundle. Input anchors are relative to the bundle's `inputs/` directory.

I re-read the refreshed plan, contract, decisions and inputs after the launcher's correction. In particular, decisions row 90 and criteria 5.4 and 10.1 include the public proxy address and require an Origin on WebSocket upgrades and non-static requests. The review applies those refreshed rules.

The findings below concern decisions that can be corrected before implementation. They do not allege that future acceptance checks have already been run. The checkout remained unchanged. The only executed gate probe was `pnpm -r test`, after selecting Node.js 26 with `nvm use`. It exited 0 and printed `Scope: 11 of 12 workspace projects`, without executing tests. This was a probe of the proposed command, not a run of the engine suite.

## Findings

### R1. MAJOR — E3 removes the effects that perform lifecycle commands

Category: Design. Evidence status: confirmed. Responsible builder: units 1a and 1b, shared command handling.

The contract says that `afterCommit` remains for blocking `wait` only, while also promising unchanged engine command behavior (`contract.md:797-813`). That restriction removes essential work from existing engine planners. `start` calls the runner inside `afterCommit` (`packages/engine/src/commands/start.ts:53-60`). `stop` stops its process there (`packages/engine/src/commands/stop.ts:20`). `resume` reloads and dispatches queued work there (`packages/engine/src/commands/resume.ts:45-56`). The handler currently executes these effects after committing the receipt (`packages/engine/src/commands/CommandHandler.ts:275-279`).

Following the new restriction can commit `AgentStarted` without starting an adapter, or commit `AgentStopped` without stopping its process. A successful receipt then makes retrying the same request return the recorded result without repairing the omitted action. These are core lifecycle failures, rather than a change to a reply shape.

Suggested fix: retain existing engine planners' post-commit effects and their lane ordering. Restrict piece planners from setting `afterCommit`, as intended, without restricting engine planners to `wait`. If only `wait` may override the reply with its eventual result, state that narrower rule separately. Run the lifecycle and start/stop/resume acceptance tests unchanged. The existing stop test explicitly checks that the runner was stopped (`packages/engine/test/commands/lifecycle.test.ts:153-177`). Any deliberate behavior or expectation change must be named in section 6 and the decisions log.

### R2. MAJOR — E9 cannot obtain a coherent snapshot by opening a SQL read transaction

Category: Bug (timing), Design. Evidence status: confirmed. Responsible builder: unit 1a, snapshot handling.

E9 reads the views and database head in one read transaction and concludes that they agree (`contract.md:947-954`). The current views are an in-memory reference, not SQL rows (`packages/engine/src/views/Views.ts:15-23`, `:41-44`). The writer first completes the SQL transaction and then publishes its committed batch into those views (`packages/engine/src/log/EventLog.ts:261-266`). A database read transaction does not isolate that reference.

For example, a reader can capture views at N, then a writer commits N+1, then the reader establishes its SQL read snapshot and obtains head N+1. A client receives state N labelled N+1 and subscribes after N+1. It permanently skips that batch for this client state until it takes another snapshot. There is also a committed-but-not-yet-published window. This breaks criteria 1.7 and 3.1 even if each database read is transactional.

Suggested fix: capture one immutable view value and use that value's own sequence for every engine field and piece section. The view already carries the sequence of the envelopes it applied (`packages/engine/src/views/apply.ts:338-342`). Alternatively, specify a short writer-permit capture that couples all required state, followed by serialization outside the permit. Do not label an in-memory snapshot with an independently sampled database head. Add an interleaving test around commit/publication and snapshot capture.

### R3. MAJOR — The owner wait shares the settled predicate but omits terminal outcomes

Category: Design, Bug (failures). Evidence status: confirmed. Responsible builder: units 1b and 3, contracts, client helper and command-line interface.

The helper is specified to finish only when the agents satisfy `settled`, and its piece reads begin only when the engine part says settled (`contract.md:515-535`; `plan.md:395`). E19 moves only `settled` and `holds` into contracts (`contract.md:1185-1200`). Engine waits also use a separate `reasonOf` function. It resolves crashed, stopped, paused and non-reloadable interrupted members even though none is settled (`packages/engine/src/routing/waits.ts:39-58`).

Consequently, an owner waiting on a crashed or paused member can wait indefinitely under the helper's stated rule. It cannot implement criterion 3.6's promised exit codes by sharing `settled` alone (`plan.md:396`). The current exit mapping requires those reasons, with crash/stop taking precedence (`packages/cli/src/commands/wait.ts:24-29`). The plan also needs an explicit rule for returning `request-held` to the owner when a waited-on agent needs the owner's answer; E20 describes the agent waiter's condition, not this client helper (`contract.md:1208-1215`).

Suggested fix: specify and share the complete member-outcome decision, including terminal reasons and current-state reevaluation for `any` and `all`. Keep the board's same-sequence hold checks for the settled branch. Define the owner's request-held result and its scope explicitly, so an owner question cannot make the blocking client command wait for the answer it prevents the owner from giving. Extend criterion 3.5 to cover the table below, rather than equating completion with `settled`.

| Member state and conditions | Engine member result | Required client behavior |
|---|---|---|
| Idle, no engine or piece hold | `settled` | Eligible to finish; exit 0 if all reported reasons are settled. |
| Idle, queued/sent delivery or engine hold | Unresolved | Continue. |
| Idle, board hold at the agreed sequence | Unresolved | Continue. |
| Starting or working | Unresolved | Continue. |
| Crashed or stopped | `crashed` or `stopped` | Resolve this member; report exit 1 when the wait closes. |
| Paused | `paused` | Resolve this member; report exit 2 unless another reported member requires exit 1. |
| Interrupted, not reloadable | `interrupted` | Resolve this member; report exit 2 unless exit 1 takes precedence. |
| Interrupted, reloadable | Unresolved | Continue while recovery can restore it. |

For `all`, a previously terminal member that returns to working before closure must stop counting as resolved. For `any`, one resolved member suffices. Request-held is an early outcome of the blocking wait, separate from these member outcomes.

### R4. MAJOR — Recording an alert does not settle the external delivery failure window

Category: Design, Bug (failures). Evidence status: confirmed design gap. Responsible builder: units 6a and 6b, alert reactor and sender.

The plan promises that the log prevents both lost and duplicate phone alerts across restart (`plan.md:159-164`, `:528`). The delivery contract records a delivered or failed event for each external attempt (`contract.md:607-613`), but provides no policy for a process death between the carrier accepting the alert and the local delivery result committing.

On restart, retrying an unrecorded attempt can deliver a second notification. Treating the attempt as complete before sending can lose it. This ambiguity also applies when a request reaches the carrier but its response is lost. The durable `AlertRaised` key prevents a second alert record; it does not by itself make the external send atomic with the database. Criterion 6.3 covers source event to alert creation, not this boundary (`plan.md:504`). The bounded retry criterion does not define how in-flight work, attempt counts or retry deadlines are recovered (`plan.md:512`).

Suggested fix: choose an achievable delivery guarantee explicitly. One option is durable at-least-once attempts with stable alert identity, bounded persisted retry state, and an acknowledged possibility of duplicate notifications. A stronger guarantee requires a verified carrier deduplication mechanism and a contract for uncertain results. State how unsent and interrupted attempts are discovered at startup, when attempts time out, and whether clear/dismiss cancels pending sends. Keep a slow carrier from blocking alert creation and clearing. Add failure tests before sending, after remote acceptance but before the local result, and during retry backoff. No claim about ntfy's deduplication capabilities is made by this finding.

### R5. MINOR — The required regression command succeeds without running the suite

Category: Design (verification tooling). Evidence status: confirmed by execution. Responsible builder: lead infrastructure task and every engine-touching unit.

The conventions and criterion 1.1 use successful `pnpm -r test` as evidence that every engine and acceptance test ran (`plan.md:245-266`). In the recorded checkout, the root owns the test script (`package.json:10-13`), while the engine package has only a typecheck script (`packages/engine/package.json:13-15`). The executed recursive command returned success without test output or test execution. The earlier engine plan specifies the root `pnpm check`, including `vitest run` (`.plans/plans/lgtm-engine/plan.md:329`).

Suggested fix: name the root `pnpm test` or `pnpm check` as the regression gate and retain individual focused runs. Require a test summary showing actual executed tests. The lead should also include the new web/viewer projects and `.tsx` files in test discovery where those tests are expected: the current project list and glob cover six existing packages and `.ts` only (`vitest.config.ts:4`, `:22-26`). This is not an allegation that the planner claimed a completed test run.

### R6. MINOR — E21 relies on an index already known to omit queued thread deliveries

Category: Design, Bug (read completeness). Evidence status: confirmed. Responsible builder: unit 1a's paged agent read and unit 3's thread handler.

E21 specifies the existing per-event agent column as the basis for the new paged read and says nothing existing changes (`contract.md:1222-1226`). `DeliveryQueued` has no top-level agent id (`packages/contracts/src/events.ts:158`). The writer therefore stores its `agent_id` as null (`packages/engine/src/log/EventLog.ts:173-184`). A column-only owner thread read omits a queued delivery that the engine's actual thread view includes through `delivery.target` (`packages/engine/src/views/apply.ts:119-123`). Thread export inherits the omission (`contract.md:495-503`).

This is the existing issue 31, not a newly discovered engine defect (`docs/issues.md:519-532`). It is wrongly left outside E21's implementation decision even though E21 introduces precisely the reader that issue 31 warns about.

Suggested fix: define owner/device thread membership consistently with the current thread projection, for example by selecting the nested target for queued deliveries as well as indexed agent ids. Choose any index/backfill separately and name its migration. Preserve the accepted visibility rule for agent-less envelopes; this finding does not request exposing new events to agents. Add a page/export test with a still-queued delivery and compare the owner's result with the rebuilt thread view.

## Shared engine and consumer coverage

| Shared edits | Result of the design check |
|---|---|
| E1-E2 and E5 | The direct registries, explicit caller-kind access and exhaustive event/state rows support the consumers. No additional design finding. |
| E3-E4 | R1 covers lifecycle effects. Current-access reads, fresh read-mark writes and planner receipts are distinguished. Post-build checks below cover races and redaction. |
| E6-E9 | Piece views and migrations have named ownership. E8 follows the revised effective-holder read rule. R2 covers E9's capture mechanism. |
| E10-E14 | Command-line naming, durable caller/device metadata and in-process service allowlists cover the board and roles requirements. Services cannot call `answer`. The standing-rule answer remains inside the permission transaction. No additional design finding. |
| E15-E18 | The piece sender/source, authenticated author header, own-namespace queued withdrawal and projected reach check meet the board's stated needs. Send-time refusal includes wait checks and proceeds to the next queued item. These are implementation checks below. |
| E19-E20 | E19 now supplies delivery statuses and the piece view needed by the board's third hold clause (`inputs/board-contract.md:384-407`). E20 supports incoming board requests. R3 covers the incomplete client completion rule. |
| E21-E23 | R6 covers the paged read. E22's pure rights helpers and E23's sole piece write path support the consumers. The board's level reactor intentionally has no position and retries refused duties only on later touched batches or startup (`inputs/board-contract.md:548-567`). Check its implementation as described below. |

The roles service allowlist and transaction-local standing-rule matcher agree with the refreshed contract (`inputs/roles-plan.md:436-441`, `:713`). The roles' capacity handling is an additional named engine change owned by that plan, rather than an omission from the client API's shared edits (`inputs/roles-plan.md:1065`). No finding requests restoring the withdrawn additive-only restriction.

## Risk register

Scores are severity × fallout × probability. Each score follows the review rubric's anchors. The owner sets fix, accept or defer; this review leaves those decisions open. Acceptance and closing evidence are absent for every row because no finding has been adjudicated or fixed.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence status | Responsible owner | Decision | Deadline |
|---|---|---|---|---|---|---|---|---|
| R1 | 6: a core lifecycle action does not happen until repaired. | 3: the owner can recover through restart or a corrected command path. | 10: removing these effects affects normal lifecycle commands. | 180; fix before release, blocks phase. | Confirmed contract/code contradiction. | Shared engine builder, units 1a/1b. | Owner decision pending. | Before the next release to real users. |
| R3 | 6: a core blocking command can wait indefinitely. | 3: the owner can cancel it and act manually. | 8: pauses and failures are recurring paths for active agent teams. | 144; schedule. | Confirmed incomplete decision rule. | Contracts and client builders, units 1b/3. | Owner decision pending. | Within this phase or a dated follow-up with an owner. |
| R2 | 6: the client can retain an incorrect state until refreshed. | 3: taking another snapshot repairs the client. | 6: connecting while agents write is an ordinary specific action. | 108; schedule. | Confirmed isolation mismatch. | Snapshot builder, unit 1a. | Owner decision pending. | Within this phase or a dated follow-up with an owner. |
| R4 | 6: a promised phone notification can be lost without manual checking. | 3: the owner can inspect the client and act there. | 4: one crash or uncertain network result exposes the window. | 72; schedule. | Confirmed missing delivery policy. | Alert builders, units 6a/6b. | Owner decision pending. | Within this phase or a dated follow-up with an owner. |
| R6 | 2: thread history omits a queued delivery, while the log retains it. | 3: the app can recover it through a corrected read. | 8: queued deliveries occur routinely. | 48; record. | Confirmed existing issue carried into a new reader. | Paged-read and thread builders, units 1a/3. | Owner decision pending. | Review at the end of the phase. |
| R5 | 1: this is a verification tooling gap. | 1: its direct effect is confined to development. | 10: the stated recursive gate currently executes no tests. | 10; record. | Confirmed by command execution and manifests. | Lead infrastructure and gate owners. | Owner decision pending. | Review at the end of the phase. |

## Proposed post-build checks

These checks require built code. They supplement the pre-build corrections above.

| Id | Scenario | Expected result | Required evidence | Responsible area |
|---|---|---|---|---|
| LC-1 | Exercise start, stop and resume through the planner registry, then resend each request id. | Required runner actions and lane ordering remain intact. The receipt replay adds no second action. | Existing lifecycle and acceptance results, plus fake-runner call counts. | Shared engine, units 1a/1b. |
| LC-2 | Pause a writer between SQL commit and view publication, and interleave a snapshot before/after another batch. | Every returned section describes its labelled sequence. Snapshot plus catch-up equals replay. | Deterministic interleaving tests and rebuild comparison, rather than a timing-only stress pass. | Snapshot, unit 1a. |
| LC-3 | Run `any` and `all` waits through every truth-table row, including recovery to working and a board wake withdrawn without a board event. | Complete member outcomes and the agreed-sequence board hold checks match engine policy. Owner request-held behavior follows the clarified contract. | Client helper and command-line tests showing reasons, sequence boundaries and exit precedence. | Units 1b/3 and board integration. |
| LC-4 | Revoke membership between queue and send; put an allowed delivery behind the refused board wake. Also queue using a batch that creates its own `WakeBuilt` record. | Queue checks see projected state. Send refusal withdraws the stale wake, rechecks waits and dispatches the next allowed item in the same pass. | E18/E23 integration tests with committed batches and runner call order. | Shared delivery path and board. |
| LC-5 | Kill the service after a level reactor observes a duty, during a refused batch, and after an accepted reaction. | No partial batch survives. Restart discovers remaining duties. A refusal does not hot-loop, and a later relevant batch retries the duty. | Board reactor restart/refusal tests, log and rebuilt views. | E23 and board reactor. |
| LC-6 | Let a carrier accept a request, drop its response and kill the service before the local result commits. Restart during backoff as well. | Delivery follows the guarantee selected for R4. Attempts and deadlines survive. Alert clear/dismiss and other alert processing remain responsive. | Fake carrier acceptance records, durable attempt state and restart tests. | Alerts, units 6a/6b. |
| LC-7 | Revoke a caller's rights between a read and a repeated request using the same id; inject a rejected read-mark batch. | The repeated read checks current access and returns no stale receipt. Rejected marks produce no successful reply or partial marks. | E4/E23 authorization and read-mark tests. | Read dispatch and board reads. |
| LC-8 | Replay account alerts from two agents on the same account, then mark that account available. | One open alert uses the stable account key, and only that account's closing event clears it. Unknown reasons still become `other`. | Source/closing tests showing how the account identity is obtained from engine events and state. | Alert source mapping. |
| LC-9 | Build the browser client and deliver a future event tag through the actual remote procedure call transport, then reconnect. | Browser code does not require the Node-only socket/identity entry point. Unknown event payloads do not terminate the stream, and their envelope sequence advances the cursor. | Browser build output and transport-level compatibility test, not only a standalone envelope decoder test. | Client library and web page. |
| LC-10 | Page and export an owner's thread containing an unaccepted queued delivery across a page boundary. | The result agrees with the engine thread projection under the unchanged visibility policy. | Paged-read/export test and rebuilt thread comparison. | Units 1a/3. |

## Noted, not filed

- The owner approved an unauthenticated loopback web server, remote access before a separate Unix user, and web callers changing alert carrier settings. The reviewed security and repository-rule diff records those decisions. They are not regressions filed by this review.
- The refreshed Host/Origin policy addresses the earlier proxy rewrite and missing-Origin ambiguity. Criterion 5.4 requires Origin for upgrades and non-static requests, and criterion 10.1 tests both rewritten and preserved proxy Host values. I found no further decision contradiction there. The agent guard's documented bypasses and host `/proc` limitations remain known gaps.
- The public address, listener settings and standing-rule addition remain computer-only actions. Pairing remains deferred. No finding requests authentication or a separate Unix user in this plan.
- The board's incoming condition and its hold-unsettled condition deliberately differ. An agent that read an incoming question and ended its turn can be settled while a blocking wait returns request-held. The author's unanswered post still holds the author unsettled. This is an explicit consumer rule, not a truth-table inconsistency.
- Existing issue 164's agent-less event visibility remains intentional. R6 concerns completeness of an owner's new thread reader and does not reopen that visibility ruling.
- New scopes, vendor allowance, epic wording, and lead-owned documentation updates are already in `attack/known-gaps.md`. The lead should route these review findings through its existing documentation responsibility. I did not edit repository issue or feature lists.
- I did not run a full engine test suite for this document review. I did not verify carrier or proxy implementation behavior. Existing post-build checks PB-1 through PB-4 still apply. The assigned scratch directory was used only to publish this result atomically and was removed.
