revise
Grade: 7  B/M/m: 0/2/2  Flags: none

# Architecture review of plan v5, round 4

The direct engine approach is consistent with the owner's answer and rulings L26 to L28. Two shared-contract gaps still prevent the promised integration from being specified coherently: command replies have no extension path, and read visibility conflates structural children with inherited management rights. Both can be fixed in place.

The repository was checked at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. In this report, repository paths are relative to that checkout. P means the supplied `shepherd-foundry-roles/plan.md`; C means `inputs/client-api-contract.md`; B means `inputs/board-contract.md`. Those paths are relative to this round's directory. The supplied board v6 and the binding rulings take precedence over the plan's older board reference.

This is a plan and source review. No implementation tests or live harness sessions were run. Node.js 26.13.0 was selected with `nvm use`. The checkout remained clean.

## Findings

### R4-A1. MAJOR, Design: new transactional commands cannot supply their promised durable replies through the specified planner contract

**Scenario.** The sheepdog calls `board.post`, then records the returned post id so that it can track whether that notice was read. The board promises that return value (B:437), and the roles action record requires it (P:364 to 368, P:461 to 464). The frozen shared edits explain how a new planner returns events, but omit how its command-specific reply reaches the receipt and caller.

**Evidence.** C:143 to 154 specifies an event-producing planner and an atomic receipt. E3 replaces the supported set and planner switch, retaining the existing planners (C:665 to 677). At the recorded commit, `packages/engine/src/commands/internal.ts:41` defines a Plan with events, side rows and an after-commit effect, without a reply producer. `packages/engine/src/commands/CommandHandler.ts:97` constructs replies with a closed list of engine-specific cases. It can return an agent id, question id, delivery id, wait result, accounts or harnesses; it cannot return a board post id or a roles-specific mutation result.

The transaction passes that closed reply builder into append at `packages/engine/src/commands/CommandHandler.ts:269`. It immediately decodes the stored reply against the command's success schema at `packages/engine/src/commands/CommandHandler.ts:250`. A required post-id field therefore cannot be supplied merely by adding the board's RPC and planner. The after-commit facility does not solve this: receipt replay explicitly omits it at `packages/engine/src/commands/CommandHandler.ts:258`, and a fresh command decodes the stored reply before invoking it at `packages/engine/src/commands/CommandHandler.ts:275`.

This is an incomplete shared contract, rather than a claim that the unbuilt implementation already contains this failure. It is separate from A-R3-A1: the notice read-state projection is now specified, but its required post-id reply still lacks a producer in the prerequisite engine changes.

**Suggested fix.** Extend E3 with a per-command reply constructor, or a reply constructor returned by Plan, and identify its types and transaction call site. Feed its result through the existing receipt callback and redaction path. The existing callback already accepts committed envelopes and stores the redacted reply atomically (`packages/engine/src/log/EventLog.ts:148`, `packages/engine/src/log/EventLog.ts:210`), so a separate extension framework is unnecessary. Require the first result and every replay to return the same post id and command-specific data. Name `packages/engine/test/commands/transaction-receipts.test.ts` in the changed-test inventory and add piece-command cases alongside its existing durable-reply cases at line 34.

**Evidence status:** confirmed contract omission. **Owner:** client API shared-engine builder, coordinated with the board and roles builders. **Risk:** 6 × 3 × 10 = **180**, fix before release.

### R4-A2. MAJOR, Design: read visibility has incompatible structural and inherited-rights definitions

**Scenario.** An orchestrator O has lead L, and L has worker W. L becomes paused or crashes. O gains management rights over W. The new hand-off read admits a caller with those rights and promises that the caller can retrieve omitted sequences through `client.thread` (P:878 to 886, P:896). The shared contract does not consistently decide whether O may read W's thread.

**Evidence.** C:343 calls self-or-held-parent-rights the engine's existing agent visibility rule. C:389 repeats that rule for the roster, while C:393 says an agent never sees grandchildren. E8 promises to reproduce the existing subscription filter exactly with no engine-event behaviour change (C:732 to 746).

Those policies differ at this commit. `packages/engine/src/api/server.ts:155` filters by self or the direct structural parent from the snapshot. It does not consult parent availability. In contrast, `packages/engine/src/routing/holders.ts:14` considers only idle and working ancestors available, and `packages/engine/src/routing/holders.ts:21` walks past unavailable ancestors. Targeted command authorization uses that effective holder at `packages/engine/src/commands/CommandHandler.ts:75`. Thus O acquires rights over W without becoming W's structural parent. An effective-rights read rule would let O read a grandchild and could remove L's access while L is unavailable; the current stream rule does neither.

The existing test expressly fixes structural visibility for catch-up and live streams: `packages/engine/test/api/subscribe-visibility.test.ts:154`, with expected rows selected at line 162. Its event samples even include paused states at line 60. The contract cannot both retain that expectation and describe all agent-scoped reads as effective-holder reads.

**Suggested fix.** State separately the management-rights policy and the read-visibility policy. Either retain structural reads and specify how inherited-holder hand-offs and their cut markers work, or deliberately change the shared read policy and name the changed engine expectations and decision. Apply the chosen rule consistently to subscriptions, snapshots, roster, thread, orient and hand-off. Add the three-generation pause/crash/recovery cases to `subscribe-visibility.test.ts`, the client read tests and `roles/handoff.test.ts`. Direct engine edits are authorized; the issue is the unresolved choice and its consequences, not a requirement to preserve today's behaviour.

**Evidence status:** confirmed contradiction against the recorded code. **Owner:** client API visibility builder and roles hand-off builder. **Risk:** 6 × 3 × 4 = **72**, schedule.

### R4-A3. MINOR, Design: the shared and WS-7 edit inventories omit required readers and writers

**Scenario.** Builders follow the listed direct edits, then discover additional schema and state-machine changes at integration. The assignment specifically requires the existing-code changes and affected tests to be identified before these engine units are built.

**Evidence.**

- E5 adds piece tags to the global Event union (C:693 to 702), and WS-7b adds `DeliveryHeld` and `DeliveryReleased` (P:967). The exhaustive event-effect table is `packages/contracts/src/stateMachine.ts:79`, typed over every Event tag. Neither the shared edits nor WS-7 names that mandatory edit. Its existing test derives every tag and exercises every state at `packages/contracts/test/state-machine.test.ts:285` and line 333. The plan should specify whether each new tag keeps or changes lifecycle state, rather than leave that decision to integration.
- WS-7b names classification, delivery routing and recovery; WS-7c names translation and the public TurnEnded event (P:975 to 977). The intervening runner schema and producer also need edits. `packages/engine/src/runner/Runner.ts:67` has no turn usage, and its prompt outcome at line 93 allows only the two pause reasons. `packages/engine/src/runner/AcpRunner.ts:54` restricts the injectable classifier to those same reasons. Its finish path maps any recognized classification into a pause at line 174 and emits a usage-free turn end at line 178. Its idle-update branch returns before translation at line 354. Merely extending translate cannot carry the usage on the cited fixture's idle update into TurnEnded.
- E15 names widening Delivery.sender and PromptSent.sender (C:833 to 855), but the existing returned-delivery producer also copies that sender into `DeliveryReturned` at `packages/engine/src/routing/deliveries.ts:46`. That event still types sender as Actor at `packages/contracts/src/events.ts:162`. Account for that field when introducing piece and service senders.
- Every additional event also requires a sample in `packages/engine/test/api/subscribe-visibility.test.ts:52`, because the existing test asserts sample coverage of the entire union at line 149. E8 names this file, but describes only retaining expectations and adding a service case. Explicitly include the new engine and piece tags, and class-aware expectations where a piece's owner-only event carries a subject agent.

**Suggested fix.** Complete the file and existing-test inventory in E5, E8, E15 and WS-7. Add the state table, Runner.ts, the AcpRunner capture/finish path and DeliveryReturned.sender. Name `packages/contracts/test/state-machine.test.ts` for lifecycle decisions and verification; identify any expectation edits after deciding those cells. Extend the already named `runner/stream.test.ts` through the actual runner boundary, alongside the new capacity and usage tests. Include the contracts tests in WS-7's verification; its current command at P:990 runs only the engine package.

This finding concerns missing integration ownership and verification. It does not assume how the future builder will implement capacity or usage, nor assert that every state-machine test must need a manual expectation change.

**Evidence status:** confirmed inventory omissions. **Owner:** client API shared-contract builder and WS-7 engine builders. **Risk:** 1 × 1 × 10 = **10**, record. A subsequent failing build or required test remains a mandatory gate independently of this planning score.

### R4-A4. MINOR, Design: the stall unit still depends on a removed package location

**Scenario.** Unit 7 implements the stall rule against its named board status export. Its anchor directs it to a package the direct-engine layout does not create.

**Evidence.** P:783 still names the pure status export from `packages/board`. The frozen board v6 locates schemas and pure conditions under contracts and runtime code under the engine (B:24 to 26). It explicitly locates the pure status answer in `packages/engine/src/board/` (B:472). No `packages/board/` exists in the recorded checkout. The same task also names the old `routing/waits.ts:settled` location, although C:924 to 929 moves that function to contracts with no re-export.

**Suggested fix.** Point task 4b at the board v6 status function in `packages/engine/src/board/` and the new contracts settled function where needed. Keep L28's view types and pure settled/request-held conditions in contracts. This is the stale task anchor left by the layout rework, not a re-filing of known gap 3's unbuilt-board dependency.

**Evidence status:** confirmed stale anchors. **Owner:** roles planner. **Risk:** 1 × 1 × 10 = **10**, record.

## Risk register

The decision column is deliberately unset; accepting or deferring a risk belongs to its owner.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Responsible owner | Decision | Deadline | Acceptance and closing evidence |
|---|---|---|---|---|---|---|---|---|---|
| R4-A1 | 6. A core notice/post correlation flow cannot obtain its result. | 3. One installation can recover through a corrected build and receipt handling. | 10. Every normal piece command needing its own result uses this path. | 180, fix before release. | Confirmed omission. | Client API shared-engine builder. | Unset. | Before the next release to real users. | None; needs a revised contract, fix commit and receipt/replay proof. |
| R4-A2 | 6. Recovery hand-off reads can be refused or disagree with the stream. | 3. One team; the owner can perform the read. | 4. One parent crash or availability fault exposes the disagreement. | 72, schedule. | Confirmed contradiction. | Client API visibility and roles hand-off builders. | Unset. | Within this phase, or a dated follow-up with an owner. | None; needs a chosen policy and three-generation read tests. |
| R4-A3 | 1. Integration and test inventory gap. | 1. Development only. | 10. Adding the specified tags reaches exhaustive consumers. | 10, record. | Confirmed omissions. | Shared-contract and WS-7 builders. | Unset. | Review at the end of the phase. | None; needs updated file ownership and passing relevant checks. |
| R4-A4 | 1. A task points at superseded locations. | 1. Development only. | 10. Following the named task reaches those anchors. | 10, record. | Confirmed stale anchors. | Roles planner. | Unset. | Review at the end of the phase. | None; needs corrected task references. |

## Audit of the direct engine changes

All E1 to E22 were checked against the recorded checkout. This table records the result without treating authorized behaviour changes as defects. Test names below refer to the existing files named in the frozen contract, unless a finding identifies missing coverage.

| Edit | Source checked and audit result |
|---|---|
| E1, command groups | `packages/contracts/src/commands.ts:10`, line 44 and line 137. The current inventory and service/debug split match the baseline. C names the exact-list, group-size and MCP-count changes in `packages/contracts/test/commands.test.ts`, plus uniqueness coverage. WS-7 explicitly adds release to that inventory. |
| E2, caller access | `packages/contracts/src/commands.ts:16` and `packages/engine/src/commands/CommandHandler.ts:70`. Replacing the owner/agent table is a real shared edit. Existing contracts, CLI parity and authorization tests are named. |
| E3, planners | `packages/engine/src/commands/CommandHandler.ts:67`. The switch exists as described; handler and authorization tests are named. The reply half is missing: R4-A1. |
| E4, reads | `packages/engine/src/api/server.ts:153`. The subscription and compare-views handlers are inline as described. Existing compare-views RPC and visibility tests are named. |
| E5, event union | `packages/contracts/src/events.ts:88`. Optional additions can preserve old event decoding. Events-roundtrip is named; the exhaustive state-table integration is missing: R4-A3. |
| E6, projections | `packages/engine/src/views/apply.ts:114` and line 338. The initial state and central fold are appropriate attachment points. Apply, rebuild, compare, fixture support and rebuild-registration guard tests are named. |
| E7, migrations and side rows | `packages/engine/src/log/migrations.ts:71` and `packages/engine/src/log/EventLog.ts:195`. The single migration path and transactional side rows exist. Append and receipts tests are named. |
| E8, visibility | `packages/engine/src/api/server.ts:155`. There is one structural filter to extract, but the written policy disagrees with that filter: R4-A2. Every-tag test changes also need accounting: R4-A3. |
| E9, snapshots | `packages/engine/src/views/apply.ts:114` and `packages/engine/src/log/EventLog.ts:153` establish the current views/writer context. The consistent-head snapshot is new work, not existing capability. No additional plan defect found beyond the shared visibility choice. |
| E10, command-line names | `packages/cli/src/commands/registry.ts:10` derives the current inventory from the RPC group. Existing inventory and parity tests are named for the new names. |
| E11, caller schema and receipt keys | `packages/contracts/src/events.ts:8`, line 184; `packages/engine/src/log/EventLog.ts:116`; `packages/engine/src/log/subscribe.ts:36`. The contract correctly distinguishes Caller from parent/holder Actor and names both writer and reader changes. Roundtrip and log receipt tests are named. |
| E12, acting device | `packages/engine/src/commands/CommandHandler.ts:207`. Adding optional device attribution while retaining the owner actor is compatible with existing owner checks. Handler and per-request credential tests are named. |
| E13, in-process services | `packages/engine/src/api/server.ts:87` and `packages/engine/src/routing/permissions.ts:31`. A new internal entry path and service-specific restrictions are required; it is not an existing wire credential. Existing auth tests and a new service-rights suite are named. |
| E14, answer attribution | `packages/contracts/src/events.ts:130` and `packages/engine/src/views/apply.ts:224`. Event, projection and planner changes are named, as are permission and roundtrip tests. |
| E15, sender and wrapping | `packages/engine/src/routing/envelope.ts:22` and `packages/engine/src/routing/deliveries.ts:46`. Widening sender and wrapping every non-owner is explicit; existing text-as-data, rendered-prompts and delivery tests are named. Returned-event schema coverage is missing: R4-A3. |
| E16, delivery sources | `packages/contracts/src/events.ts:20` and `packages/engine/src/routing/deliveries.ts:62`. A fourth source and its lifecycle policy are genuinely new. Existing delivery tests are named. |
| E17, withdrawal ownership | `packages/engine/src/routing/holders.ts:57` shows the existing queued-only withdrawal helper. The new piece-namespace transaction check is explicit; existing move-withdrawal tests and new refusal tests are named. |
| E18, reach | `packages/engine/src/routing/deliveries.ts:217` and `packages/engine/src/routing/waits.ts:28`. Queue-time projection and send-time revalidation have identified owners and inputs. Delivery and carry-on dispatch regression tests are named. |
| E19, settled | `packages/engine/src/routing/waits.ts:33` and line 39. Moving the pure predicate to contracts respects L28 and avoids a contracts-to-engine import. Existing waits and wait acceptance tests are named. The later board change to settling is explicit. |
| E20, request held | `packages/engine/src/routing/waits.ts:181` and its batch recheck at line 110. The extra piece condition and refusing initial entry are specified; existing waits tests are named. |
| E21, thread pages | `packages/engine/src/log/subscribe.ts:25` supplies the existing per-event agent column. The paged per-agent reader is new work. No further finding. |
| E22, rights/planning helpers | `packages/engine/src/routing/holders.ts:21` and `packages/engine/src/commands/CommandHandler.ts:73`. The effective-holder rule exists; it must not be described as the current structural stream rule. See R4-A2. |

WS-7a correctly identifies a change to the permission path rather than treating the matcher as an outside caller. The baseline routes the request immediately in `packages/engine/src/routing/permissions.ts:21`; the baseline answer performs ceiling checks and defers runner delivery until commit at line 38 and line 49. P:965 to 966 specifies bounded optional fields, same-transaction matching, independent engine checks, service attribution and the unmatched fallback. The existing permissions acceptance test is named. L27 makes this work conditional on qualifying recordings.

WS-7b accurately describes today's unclassified-error return in `packages/engine/src/routing/deliveries.ts:130`. Its accepted/unaccepted distinction is real at line 111; reload's existing requeued/carried calculation is at `packages/engine/src/recovery/reload.ts:84`. The plan names classify-errors, delivery, undeliverable acceptance and all three restart regression files, and separately names new hold/release scenarios. The missing runner and lifecycle-table inventory is R4-A3.

WS-7c's public optional-field and old-log compatibility promises are explicit. Events-roundtrip and stream tests are named. The last-request usage producer still needs the runner-boundary work described in R4-A3 and the post-build check below.

## Earlier-answer audit

I checked the round-1, round-2 and round-3 finding maps against the revised plan. The earlier answers remain represented. A-R3-A1's chosen projection survives; R4-A1 identifies a missing prerequisite reply path rather than asking again for a board status read-state API.

| Round-3 finding ids | Answer retained in v5 |
|---|---|
| TO-R3-2 | P:516 to 519 and P:1153 to 1159 implement L27: record first; drop units 3, 4 and 11a and the standing-rule acceptance step if none qualifies. |
| TO-R3-1, TO-R3-3 | WS-2 requires adapter-provided sandbox evidence and a shell discriminator the model cannot choose. Unsupported harnesses do not match; known gaps 14, 17, 18 and 21 remain acknowledged. |
| TS-R3-TM-1 | P:966 resolves candidate paths with the ceiling resolver before matching, treats resolution failures conservatively, and retains the residual link-swap limitation in known gap 20. |
| A-R3-A1 | P:461 to 464 and criterion 3.7 retain the post-id projection over board.Read, board.WakeBuilt and DeliveryAccepted, without service board.read. |
| C-R3-C1, A-R3-A2, Lo-R3-L8, Ls-R3-L3, TS-R3-TM-2 | P:398 to 410 and criterion 1.3a measure aggregate encoded rule and snapshot size, truncate in order, and preserve paged recovery. |
| Lo-R3-L1, Lo-R3-L4 | WS-4 retains transitive waiting with cycle detection and counts a usage-limit pause with a known reset as busy. Its specific waiting and paused-team tests remain in the criteria. |
| Lo-R3-L2, Lo-R3-L3, Ls-R3-L1 | P:967 retains a whole-agent queue hold, engine-owned per-agent/per-outage counting, every release counted, idle reload/account return, and board-wake replacement behind the hold. P:683 releases startup holds when the sheepdog is off. |
| Ls-R3-L2, Lo-R3-L6, TS-R3-TM-3 | P:377 to 380 and P:684 retain StallEnded, distinguish sheepdog compact/notice turns, and test the client alert reactor. |
| C-R3-C2 | P:316 to 319 now places code and tests in existing registered engine/contracts packages. This solves test discovery through the authorized layout rework. |
| C-R3-C3 | Unit 3p and P:1137 retain recorder preparation before owner-run evidence collection. |
| C-R3-C4 | P:372 to 374 and P:679 retain the board-off give-up alert exception and the worker-with-live-lead case. |
| C-R3-C5 | The crash setting remains restricted to zero or one, with zero giving up immediately. |
| Lo-R3-L5, Lo-R3-L7 | Criterion 4.4 excludes blocking waits from runaway time. WS-4's progress definition excludes sheepdog-only posts and accepts a file change, reply to the stalled post or ordinary post. |
| Lo-R3-L9, TO-R3-4, TO-R3-5 | WS-2 retains case-insensitive protected-name comparison and blocks matching after ModeRefused. |

The retained round-1 and round-2 answers include advisory role rules; owner-approved exact argv matching; engine-owned permission ceilings; fixed-data notice bodies; holder routing; direct service notices without an engine-prompt fallback; caller-separated stable request ids; owner alert suppression; bounded snapshots and paged lists; bounded hand-off with markers readable through the lead; no sibling thread access; turn attribution through DeliverySent; accepted-message protection; durable switches and timers; board-off suspension; and acceptance through an in-process service and real socket on the test clock. These are present in the corresponding WS-1 to WS-8 criteria. The direct layout removes the old registration/package obstacle without requiring a seam.

The known-gaps list was checked before filing. The unbuilt board/service dependency, absent qualifying harness evidence, accepted same-user database access, residual symbolic-link race, existing crash/holder race, and absent usage fallback are not new findings here.

## Proposed post-build checks

These are checks for the implementation, not allegations about code that has not been written.

| Id | Scenario | Expected result | Evidence needed | Owner |
|---|---|---|---|---|
| PB-R4-1 | Post a sheepdog notice, kill between board.post and the roles action record, restart, then resend the identical request. | One post and wake; the first and replayed replies contain the same post id; its action record correlates correctly; no secret-bearing reply bypasses redaction. | Public/in-process command replies, receipt row, committed events and rebuilt roles view; extend transaction-receipts and notices tests. | Shared-engine and roles builders. |
| PB-R4-2 | O → L → W, with L working, paused, crashed and recovered; attempt roster, thread, snapshot, subscribe, orient and hand-off reads as O and L. | Every surface follows the explicitly chosen read policy; hand-off markers are retrievable by their authorized recipient; a replacement sibling remains refused. | A caller/state truth table and catch-up/live/read assertions at the same view sequence. | Client API and hand-off builders. |
| PB-R4-3 | Feed a recorded capacity error through the actual AcpRunner, both before and after delivery acceptance. | Capacity reaches the hold path, never the usage/sign-out pause path; unaccepted text is queued once, accepted text is not re-sent, and turn end cannot accidentally reset the outage budget. | Raw fixture, RunnerEvent sequence and committed delivery/state events, with classifier injection disabled. The current finish path is at AcpRunner.ts:162. | WS-7b. |
| PB-R4-4 | Send multiple model-request usage frames, then the idle state frame, through the actual runner; repeat with no usage and with incomplete fields. | TurnEnded carries only validated last-request usage when available; idle-frame data reaches the capture path; missing evidence remains absent and triggers only the specified fallback. | Raw fixture to emitted RunnerEvent to stored TurnEnded assertions, then an old-log rebuild. | WS-7c and cache-timing builder. |
| PB-R4-5 | Replace a board wake during a hold; release as owner; restart with an unaccepted held delivery and an accepted held carry-on; return an account; start with the sheepdog off. | Nothing bypasses the queue hold, every release counts, reload remains idle while held, and shutdown/off recovery releases once without re-sending accepted work. | K09 to K12 plus switch tests and event-log rebuild comparison. | WS-7b and sheepdog builders. |
| PB-R4-6 | No harness qualifies after the owner-run recordings. | Recorder evidence is retained; units 3, 4 and 11a are skipped; recipe and acceptance continue without their standing-rule step. Dependencies on the skipped units are treated consistently with L27. | The reduced execution graph and an acceptance report for the 14-unit path. | Lead and acceptance builder. |
| PB-R4-7 | Maximal Unicode role data, 500 rules, 200 snoozes, 256 agents and large hand-off items. | Aggregate encoded bounds include wrappers; truncation markers and paged recovery retrieve omitted data under the caller's chosen rights. | Serialized byte counts and subsequent page reads, not field-size arithmetic alone. | Contracts, snapshot and hand-off builders. |
| PB-R4-8 | Run the composed service with TestClock over its Unix socket, then one representative child-process scenario with real minutes. | Roles timers use the supplied clock; production composition and the real-process result agree; transport heartbeats do not make accelerated tests misleading. | Acceptance output, clock-service composition and the separate real-process log. | Acceptance builder. |
| PB-R4-9 | Rebuild a pre-roles log, then append each new engine/piece event and restart with both roles switches off. | Existing events still decode; every event has a defined lifecycle/visibility treatment; projections reproduce the log; switching off stops actions without removing event support. Downgrade is not used as rollback. | Contracts roundtrip/state-table results, every-tag visibility tests and rebuilt-view equality. | Shared-contract and roles builders. |
| PB-R4-10 | Compile the merged RPC groups against the workspace's pinned Effect 4.0.5 and exercise the real CLI/MCP inventories. | Groups merge and omit as specified; duplicate names are rejected by the explicit uniqueness check; every command has exactly one planner/read handler. | Typecheck output and contract/CLI/MCP inventory tests. | Shared-contract builder. |

## Noted, not filed

- The direct-engine changes are expressly authorized. No finding asks to restore the removed seam or treats a change to old behaviour as a scope breach. The remaining pure contracts/runtime split follows L28, apart from R4-A4's stale task references.
- Migration and rollback are adequately directed at plan level: old optional fields remain decodable, views rebuild from the log, switches disable roles, and a binary lacking recorded event types is not used as rollback (P:272 to 277). The exact implementation remains subject to PB-R4-9.
- Existing issues 58 to 60 concern refusal receipts, read failures and legacy envelope-only receipts. R4-A1 concerns the new command-result producer, not those accepted baseline issues. Issue 164's agent-less event visibility is explicitly retained by C:347 to 350; it is not re-filed.
- Effect's test-clock convention was checked through context7 against the official [Effect 4.0.4 Vitest README](https://github.com/Effect-TS/effect/blob/effect@4.0.4/packages/vitest/README.md), accessed 2026-11-03. The plan's in-process clock approach is supported; it still needs composition evidence.
- The cache timing basis was checked through context7's Anthropic SDK material and the official [prompt caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), accessed 2026-11-03. Cache timing and refresh depend on the relevant model request and access, so the last-request provenance check remains appropriate.
- Context7's focused RPC queries returned unrelated GraphQL material. Direct retrieval of the exact tagged RPC source also failed. No claim of pinned-version signature verification is made; PB-R4-10 covers it. This does not invalidate a named check the planner claimed to have run.
- Some broad source reads were truncated by the tool's output budget. Relevant source and contract sections were subsequently read in smaller ranges before findings were finalized. A mistaken CommandHandler path was corrected to `packages/engine/src/commands/CommandHandler.ts`. No probe files were created, the assigned scratch directory is absent, and this result is the only file written. No cyber-policy check was refused.
