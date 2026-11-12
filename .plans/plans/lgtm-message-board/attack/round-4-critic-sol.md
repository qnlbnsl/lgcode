revise
Grade: 6  B/M/m: 0/3/3  Flags: none

## Review basis

This reviews plan version 5 and board contract version 6 through the plan-critic lens. The read-only checkout is at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. In citations, `board/` means the supplied `board-r4/lgtm-message-board/` directory. `inputs/` means the supplied `board-r4/inputs/` directory. Other paths are relative to the recorded checkout. These are plan findings, not reports of failures in implementation tests that have not been written.

The owner's authorization to edit the engine and lead ruling L26 bind this review. There is no finding for changing existing engine behavior, for placing board code in the existing packages, or for retaining the disclosed security boundaries. L28 resolves the location question in decision row 101, although that append-only log has not yet recorded the ruling. Known gaps concerning scopes, vendor allowances, the four WIDENED exclusions and the documentation lookup are not filed again.

## Findings

### C4-01. MAJOR. The shared sender edit omits the return event that board retries require

Category: Design; Bug (failures). Evidence status: confirmed omitted schema edit. Responsible area: client API engine unit 1b, coordinated with board unit 3a.

Scenario: A board wake reaches the runner with sender `piece { namespace: "board" }`. Its turn fails before acceptance. B5 requires the source rule to keep `DeliveryReturned`, so the board reactor can retry and count delivery failures. The proposed sender schema does not permit that sender in the return event.

Evidence: E15 widens `Delivery.sender` and `PromptSent.sender` to `Sender`, and says that returned piece deliveries follow their source rule (`inputs/client-api-contract.md:833`, `inputs/client-api-contract.md:853`). B5 explicitly keeps `DeliveryReturned` on return (`board/plan.md:328`; decision row 100 at `board/decisions.md:110`). The recorded code constructs that event with the original delivery's sender at `packages/engine/src/routing/deliveries.ts:46`. However, `DeliveryReturned.sender` has its own `Actor` field at `packages/contracts/src/events.ts:162`. E11 deliberately keeps `Actor` as owner or agent (`inputs/client-api-contract.md:772`), and E15 does not list this third sender-bearing field. The log decodes each written envelope at `packages/engine/src/log/EventLog.ts:182`.

Following the enumerated edits therefore leaves a piece sender incompatible with the event used by the retry path. This is an omitted direct engine change, rather than a concern that needs the future reactor implementation to answer. No earlier round's mapped finding addresses this schema omission.

Suggested fix: Amend E15 to widen `DeliveryReturned.sender` to `Sender`, retain existing owner and agent encodings, and record the associated decision and test updates. Name `packages/contracts/test/events-roundtrip.test.ts` and `packages/engine/test/routing/deliveries.test.ts` for piece-return cases, alongside criterion 4.3's board retry test. Preserve the rule that a piece return does not produce an agent-sender notice.

### C4-02. MAJOR. Manager succession can turn a direct pair into a three-member channel

Category: Design. Evidence status: confirmed contradictory channel rules. Responsible area: board contracts, access and lifecycle units 1, 2b and 3b.

Scenario: Sibling agents A and B share a group channel. A opens their direct channel, then crashes. Its parent P is neither member of that direct pair. The general channel-manager rule transfers management to P and makes P a member. Crashes do not remove A, so the channel now contains A, B and P. The direct-channel rule still requires exactly two members and one channel per pair.

Evidence: The manager rule applies to a channel without a kind exception, and says that a new manager becomes a member (`board/contract.md:75`, `board/contract.md:80`). Direct channels have exactly two members and belong to one pair (`board/contract.md:111`). A crash preserves channel membership (`board/contract.md:52`; `board/decisions.md:94`). The lifecycle reactor transfers a channel manager on crash without a direct-channel exception (`board/plan.md:595`), and criterion 2.5 likewise adds the successor as a member (`board/plan.md:461`). Only group channels have a fixed anchor whose membership can account for the original opener and the successor separately (`board/contract.md:97`).

Why the earlier answer is incomplete: Round 3 group 4 correctly fixes availability-dependent management for group channels. Row 85 then expresses succession and automatic membership as a general channel rule. It does not reconcile that rule with direct-channel cardinality. This is a new interaction of the answer, not a request to restore holder-based membership or undo L18/L21.

Suggested fix: Specify management and succession separately for plain, group and direct channels. Preserve the approved group behavior. Take the direct-channel interpretation to the lead if the manager-always-member ruling is intended to cover direct channels too. Add sibling-pair and service-pair crash cases that assert the manager, exact member set, pair identity, readable history and later post permissions.

### C4-03. MAJOR. The pure board condition lacks the delivery facts its definition needs

Category: Design. Evidence status: confirmed incomplete condition-input contract. Responsible area: board contracts/view units 1 and 2a, lifecycle unit 3b, and the E19 input owner.

Scenario: An incoming question Q has never been accepted. Its wake W is queued. Next, the dispatcher withdraws W at send time, before the board reactor rebuilds it. The third hold-unsettled clause must be false before withdrawal and true afterward, because the second state has no queued or sent wake carrying Q. The specified board-only input cannot distinguish those states.

Evidence: The board view holds a wake index but deliberately stores no delivery status; status comes from the engine deliveries view (`board/plan.md:444`, `board/plan.md:446`). Criterion 2.1 folds `DeliveryAccepted` and `DeliveryReturned`, but says that other engine events are ignored (`board/plan.md:457`), so `DeliveryWithdrawn` does not change that board view. Nevertheless, criterion 1.7 specifies `holdsUnsettled(agentId, view)` as a function of that full board view (`board/plan.md:404`), and row 101 places its type and pure conditions in contracts (`board/decisions.md:111`). The condition explicitly tests whether a queued or sent wake carries the question (`board/plan.md:625`; `board/contract.md:350`). In the recorded engine, delivery status is a separate view field (`packages/engine/src/views/apply.ts:74`, `packages/engine/src/views/apply.ts:99`), and withdrawal changes that field (`packages/engine/src/views/apply.ts:290`). E19 promises a small shared input type, but the board does not identify the delivery-status facts passed into its entry (`inputs/client-api-contract.md:924`).

Why the earlier answer does not finish this case: Row 89 answers C3-04 and R3-A4 on the client side by carrying condition results in summaries. It does not supply the server-side pure function with the missing facts needed to compute those results. L28 resolves package placement, not the input shape. The paired states above still require different answers from indistinguishable board inputs.

Suggested fix: Define a contracts-owned input that includes the required delivery/acceptance facts, and build it from the same projected engine snapshot as E19. Alternatively, pass a minimal delivery-status projection as a separate argument. Keep delivery status owned by the engine. Update the function signatures and criterion 1.7, and test the queued-to-withdrawn interval before the reactor runs, including the summary results at each sequence.

### C4-04. MINOR. The fold criterion forbids the stop transition needed to drop existing completion debt

Category: Design (acceptance criteria). Evidence status: confirmed internal inconsistency. Responsible area: board view and lifecycle units 2a and 3b.

Scenario: A closed question already owes agent A a completion. A stops. The plan says that the existing debt disappears, but its board-fold criterion ignores the stop event. Closing A's still-open posts cannot remove debt belonging to this already-closed question.

Evidence: Criterion 2.1 permits only the board events, two delivery events, `AgentStarted` and `AgentGrouped`, and requires ignoring every other event (`board/plan.md:457`). The stop rule drops owed completions (`board/plan.md:378`, `board/plan.md:593`; `board/contract.md:247`). The eight board event kinds contain no separate completion-debt removal event (`board/contract.md:447`). Row 95 specifies the desired cleanup but not a compatible fold observation (`board/decisions.md:105`).

Why the round 3 answer remains incomplete: Logic m6's policy is now explicit and sensible. The exhaustive fold acceptance text was not updated to make that policy rebuildable. This finding concerns that test contract; it does not assert that a future builder will necessarily retain the debt.

Suggested fix: Explicitly include `AgentStopped` in the board fold for this cleanup, or name another durable event that performs it. Extend criterion 2.1 and the view test with a completion owed before stop, a repeated stop observation, and live/rebuilt equality afterward.

### C4-05. MINOR. The disabled-board reason cannot pass the existing API error filter under the named edits

Category: Bug (user-facing state); Design. Evidence status: confirmed omitted public-error edit. Responsible area: board doors unit 4 and the shared API error owner.

Scenario: The owner calls a board command while the board is disabled. The planner returns `board disabled`, but the socket API returns the generic `command refused`, so the client cannot show the promised disabled state.

Evidence: Every command must be refused with `board disabled` (`board/contract.md:444`; criterion 5.10 at `board/plan.md:693`). At the recorded commit, `packages/engine/src/api/server.ts:41` defines the allowed reasons, which do not include that reason. `commandError` replaces an unlisted reason at `packages/engine/src/api/server.ts:46`, and transactional failures use that mapper at `packages/engine/src/api/server.ts:166`. B9 names read, snapshot and switch edits (`board/plan.md:332`). E3 and E4 move dispatch to tables without specifying an extensible public-reason list (`inputs/client-api-contract.md:665`, `inputs/client-api-contract.md:679`). Neither change list names the reason-filter update.

Suggested fix: Add the fixed board-disabled reason to the shared safe public-error vocabulary, or define a typed equivalent and update the criterion. Name the server edit and its regression test. Verify the response through both public transports, rather than only the planner or handler.

### C4-06. MINOR. The shared read-table example contradicts the board's explicit planner classification

Category: Design (contract wording). Evidence status: confirmed cross-contract mismatch. Responsible area: client API contract owner, coordinated with board unit 3a.

Evidence and scenario: E4 names `board.read` as a read-table example and says a read holds no writer permit and writes no receipt (`inputs/client-api-contract.md:679`). E3 requires each command to appear in exactly one of the planner and read tables (`inputs/client-api-contract.md:670`). The board explicitly places all commands except `board.channels` and `board.status` in the planner table (`board/plan.md:328`), and decision row 100 explains that `board.read` is a planner because it may write `board.Read` (`board/decisions.md:110`). A builder following the shared example can register it in the wrong table or twice. Separately, the shared paged-read wording says reads are not deduplicated (`inputs/client-api-contract.md:193`), while the board's one-transaction/receipt rule covers every command (`board/contract.md:425`).

Suggested fix: Replace E4's example with `board.channels` or `board.status`. Explicitly state the board-read exception to ordinary paged-read execution and deduplication, including what a repeated request returns. Keep the already chosen read acknowledgement atomic. This is a small contract reconciliation, not a request for a new board mechanism.

## Risk register

Scores are severity × fallout × probability. These are launched consequences. The reviewer does not accept or defer risks.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Responsible area | Decision and deadline |
|---|---|---|---|---|---|---|---|
| C4-03 | 6: wait and status decisions lack their required input | 3: the owner can inspect or close the obligation | 6: an ordinary send-time withdrawal exposes the missing distinction | 108, schedule | Confirmed input gap | Board conditions; E19 owner | Unset; this phase or a dated owned follow-up |
| C4-01 | 6: the promised failed-wake retry cannot record its return | 3: the owner can repair or flush the work | 4: one unclassified turn failure | 72, schedule | Confirmed schema omission | Client API engine 1b; board 3a | Unset; this phase or a dated owned follow-up |
| C4-02 | 6: a direct channel has incompatible membership and management rules | 3: the owner can create or manage a replacement channel | 4: one direct-channel opener crash | 72, schedule | Confirmed contradiction | Board contracts/access/lifecycle | Unset; this phase or a dated owned follow-up |
| C4-04 | 4: stopped-agent debt can remain in summaries pending repair | 3: the application can clear it with the corrected fold | 6: stopping an agent with owed debt is an ordinary specific action | 72, schedule | Confirmed criterion mismatch | Board view/lifecycle | Unset; this phase or a dated owned follow-up |
| C4-05 | 2: the client gets an unhelpful refusal instead of the disabled reason | 3: the owner can inspect the setting | 10: every disabled-board call encounters this filter | 60, schedule | Confirmed omitted error edit | Board doors; API error owner | Unset; this phase or a dated owned follow-up |
| C4-06 | 1: the implementation brief gives conflicting registration instructions | 1: development and verification only | 10: the two frozen texts disagree on the named command | 10, record | Confirmed wording conflict | Shared contract owner | Unset; review at phase end |

No severity-floor adjustment applies. There is no closing implementation evidence for these plan findings.

## Audit of the earlier answers

An answered item below means that the decision is preserved in the current text. It does not certify future implementation tests.

| Round 3 group or minor finding | Assessment |
|---|---|
| Group 1: R3-A3, C3-01, R3-L1, logic M1 | Row 84 uses non-stopped carriers and separates lifecycle from membership. Criteria 2.6, 2.7, 4.1 and 4.4 preserve crash membership and late replies. The original crash/removal contradiction is answered. |
| Group 2: R3-A1, C3-02, R3-L2, R3-TM-3 | Row 88 bounds each completion and its share of a wake, with `repliesTo` paging. Criterion 3.13 exercises sixteen large replies and several owed completions. The original oversized reply-text case is answered. |
| Group 3: R3-A2, C3-03, R3-L3, R3-TM-2 | Row 89 supplies fixed-size per-agent summaries and paged detail/channel lists. Criteria 5.6, 5.9 and 5.12 retain the bounds. The original unbounded fallback lists are answered. Coherent snapshot/status hydration still needs the post-build check below. |
| Group 4: logic M2, threat T3-2 | Stored manager succession, fixed parent links, no availability transfer and no return of rights answer the group-channel scenario. C4-02 is the unresolved interaction with direct-channel cardinality. |
| Group 5: logic M3, threat T3-1, logic m4 | E18 passes delivery identity, projects the command batch, checks callerless deliveries, and proceeds after withdrawal. Criteria 2.11 and 4.9 retain those requirements. Answered. |
| Group 6: R3-TM-1, threat T3-3 | Row 87 checks reply-text authority separately from outcome-only notification. Criterion 4.9 retains the removal-and-rebuild case, including disabled-board withdrawal. Answered. |
| Group 7: logic M4, threat T3-6 and T3-5 | Row 90 distinguishes a never-received question from an accepted but unanswered question. Criterion 4.6 preserves the latter agent's settlement. C4-03 identifies the remaining input contract for computing the former condition. |
| R3-A4 and C3-04 | Summaries carry computed results rather than pretending omitted metadata is sufficient. That client representation fix holds. The full-board function still needs the explicit inputs in C4-03. |
| C3-05 | Criterion 3.8 permits already-carried unanswered questions in `incoming`. Answered. |
| Logic m1 | Row 91 distinguishes returns before and after acceptance. Criterion 4.3 retains the distinction. C4-01 concerns the return event's omitted sender widening, not that retry policy. |
| Logic m2 | Row 92 stops autonomous retries after two failed completion sends and lets flush carry failed debt. Answered. |
| Logic m3 | Row 93 permits the specified late upgrade from all non-replied dispositions. Criterion 3.12 retains it. Answered. |
| Logic m5 | Services are refused in `to`, including criterion 3.12. Answered. |
| Logic m6 | Row 95 says to drop stopped-agent debt. C4-04 identifies the unamended exhaustive fold criterion. |
| Threat T3-4 | Agent-selected foreign anchors are explicitly refused, including criterion 2.6. Answered. |

The round 1 and round 2 maps retain their remaining answers: sparse read positions, no unsolicited informational wakes, queued-wake merge and cleanup, per-addressee all-mode cleanup, same-channel replies, close authority, structural direct grants, owner-selected group anchors, start ceilings, authenticated headers, encoded byte budgets, receipt-copy inventory, owner alerts, owner/child thread disclosure and disable-in-place rollback. The move into existing packages removes the former package-registration problem; `vitest.config.ts` includes nested tests for both packages. The owner has expressly withdrawn the earlier additive-only constraint. None of those findings is re-filed.

## Engine-change and test-feasibility audit

| Change | Recorded-code check and current assessment |
|---|---|
| B1 | `packages/contracts/src/commands.ts:44` has the closed group; `packages/mcp/src/tools.ts:6` has the explicit tool inventory; `packages/cli/src/commands/registry.ts:10` already derives CLI inventory from the group. E1/E2/E10 cover the necessary common edits. Existing command, parity and inventory test paths resolve. CLI payload/reply fixtures must gain the board cases; P03 deliberately demands a fixture for each new command at `packages/cli/test/parity.test.ts:39`. |
| B2 | The existing event union and separate fields are in `packages/contracts/src/events.ts:88`. Its round-trip test has an explicit inventory at `packages/contracts/test/events-roundtrip.test.ts:18`, so the named test update is necessary. C4-01 identifies the additional sender-bearing event field missed by the shared edit. |
| B3 | The state, initializer and reducer are `packages/engine/src/views/apply.ts:92`, `packages/engine/src/views/apply.ts:114` and `packages/engine/src/views/apply.ts:338`. Comparison recursively covers added fields at `packages/engine/src/views/compare.ts:29`. The listed view/rebuild/comparison test paths and fixture module exist. C4-04 reconciles the board fold's own acceptance list. |
| B4 | The recorded dispatcher reserves under a transaction at `packages/engine/src/routing/deliveries.ts:239`. E18 supplies the new reach table and send-time withdrawal loop. The two named existing dispatcher/account tests resolve. |
| B5 | Existing return and source behavior is at `packages/engine/src/routing/deliveries.ts:45` and `packages/engine/src/routing/deliveries.ts:61`. The named handler and delivery tests exist. C4-01 affects the proposed return path; C4-06 reconciles command classification. |
| B6 | Current settlement checks engine deliveries and held work at `packages/engine/src/routing/waits.ts:39`. E19 and B6 deliberately extend it. Both named wait test files exist. C4-03 requires the precise shared input before implementation. |
| B7 | Blocking wait cancellation is currently level-triggered at `packages/engine/src/routing/waits.ts:83`, and batch projection/rechecking is at `packages/engine/src/routing/waits.ts:110`. E20 fits that mechanism, with new board tests and unchanged engine-only controls. |
| B8 | The service assembles the handler, and current followers actually start in `packages/engine/src/commands/CommandHandler.ts:177`. The plan identifies the future unit-1 reactor list as its target, so its service-level anchor is assembly context, not a claim that the recorded service already has such a list. No new broken anchor is filed. |
| B9 | Current special reads are at `packages/engine/src/api/server.ts:153`; E4/E9 supply the future tables. Tool descriptions and CLI summaries have real neighboring patterns. C4-05 adds the omitted public-error change. |

The named greenfield paths are implementation targets, not falsely claimed existing files. The existing acceptance harness supports real service processes and credentials (`packages/engine/test/support/acceptance.ts:22`). The fake agent's exec step launches Node with inherited agent environment (`packages/testing/src/fakeAgent.ts:203`), so tests should pass the TypeScript CLI entry as Node arguments. They should not pass the shell launcher as a JavaScript module. No new harness is required by the specified board flows.

The ten-gate check finds a named source universe, per-workstream risks, observations for acceptance, one rollout section, guardrail coverage and eight sized units. There is no new screen requiring a visual design artifact. Scopes, vendor allowances and WIDENED exclusions remain the disclosed prerequisites under the supplied rulings. Gate 1 and gate 2 still need the contradictions above reconciled. No additional unmarked scope exclusion was found when comparing the effective scope rows with their quoted sources and later amendments.

## Proposed post-build checks

These checks follow the policy and input corrections above. They do not defer those corrections to implementation review.

| Id | Scenario | Expected result | Required evidence | Responsible area |
|---|---|---|---|---|
| C4-PB1 | Fail a board wake before acceptance, fail its retry, then separately return an accepted wake. | Piece-sender returns encode and rebuild; retry counts and completion debt follow row 91; accepted completions are not recreated. | Public calls, return envelopes, encoded-schema round trips, ordered dispatches and live/rebuilt equality. | Client API 1b; board 3a/3b. |
| C4-PB2 | Crash a sibling direct-channel opener and then its successor; repeat for an agent/service pair. | The reconciled direct-channel policy has one deterministic manager, member set and pair identity, with the chosen read/post authority. | Manager events, exact channel membership, access results and restart replay. | Board 1/2b/3b. |
| C4-PB3 | Pause the reactor between send-time withdrawal and rebuild, and compare queued, sent, accepted and withdrawn versions of the same incoming obligation. | Conditions and status summaries use the documented complete input at the same projected sequence; engine waits do not falsely finish in the retry gap. | Transaction barriers, delivery/view inputs, condition outputs and wait events. | Board conditions; E19 owner. |
| C4-PB4 | Stop an agent with already-closed questions and both ordinary and failed completion debts. | Debts disappear under the chosen durable fold rule, without sending another completion; replay gives the same result. | Before/after debt and status, stop events and rebuilt views. | Board view/lifecycle. |
| C4-PB5 | Disable the board and call all eight commands through socket and network clients; also repeat an acknowledged `board.read` request. | Every disabled call returns the documented fixed reason; read retry and acknowledgement behavior match the reconciled command classification. | Actual client replies, receipts and `board.Read` events. | Board doors; shared API. |
| C4-PB6 | Hydrate a truncated snapshot while the waited agent moves from idle with owed debt to working after completion acceptance, and in the reverse order. | The helper does not combine old lifecycle state with newer cleared board conditions to finish early. | Snapshot/status/stream sequences, controlled read barriers, helper exit point and comparison with an engine wait. | Client wait helper; board summaries. |
| C4-PB7 | Delay catch-up across crash/resume and removal/rejoin, then create a new question before the old event is handled. | Historical terminal events affect the obligations that existed at that transition; later questions and committed replies are preserved. | Event/post creation sequences, transaction snapshots and replay equality. | Board reactor. |

The plan's existing maximum-frame, redaction, source-ownership, queue/send race, disable/re-enable and restart checks remain necessary.

## Noted, not filed

- The owner and lead authorize direct engine edits. The old seam-only and unchanged-test policies are superseded; engine-only regression expectations still have their stated purpose.
- Same-user disk access, parent-thread visibility, non-deletable posts, no timed informational wake, possible duplicate external resend, silent-agent repair through close or the sheepdog, and early settlement while disabled are explicit choices. They are not new findings. Existing engine issues 113, 152 and 194 were not re-filed as board defects.
- The complete condition-id lists in the bounded snapshot should be exercised at the supported maximum agent population. The supplied texts do not state that population; the existing fifty-agent scenario alone does not measure every possible size. This report does not assert a new observed transport failure.
- The lead owns issue-list and feature-list updates. This reviewer writes the assigned result only and does not modify those repository documents.
- Review execution used Node.js 26.13.0 after `nvm use`. The checkout was clean at the last status check. No application tests, installs, repository edits, commits, pushes, delegation or team-board messages ran. No new claim about Effect's library behavior is certified here.
- Some combined reads exceeded output limits. Cited evidence was reread in smaller sections. One exploratory lookup requested the future `packages/contracts/src/settled.ts`; E19 correctly identifies it as a new target, so its absence is not a finding.
- The assigned scratch directory was never created and was checked absent before writing. Only this result file is created. No policy refusal prevented a check.
