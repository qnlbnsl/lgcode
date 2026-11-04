revise
Grade: 6  B/M/m: 0/3/1  Flags: none

## Review basis

This is the architect review of plan version 3 and board contract version 4. Repository evidence was checked at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. The checkout remained clean.

In citations, `board/` means the supplied `board-r3/shepherd-message-board/` directory. `inputs/` means the supplied `board-r3/inputs/` directory. Other paths are relative to the recorded checkout. API means application programming interface. JSON means JavaScript Object Notation. KiB and MiB mean kibibytes and mebibytes.

The registered piece, shared contracts, engine transaction and existing delivery interface remain suitable. Three conflicting decisions need correction in place. None requires a separate board process, another dispatcher or a new owner wait command. The pending authorization for the extension seam remains pending.

## Findings

### R3-A1. MAJOR. One completion can exceed the entire wake budget

Category: Design; Bug (failures). Evidence status: confirmed incompatible bounds. Responsible builder: the board planner, contracts unit 1 and wake unit 3a, with lifecycle unit 3b for acknowledgement.

Scenario: An agent opens an `all` question with sixteen addressees. Each addressee returns one valid reply containing 16,384 ordinary ASCII characters. The question closes. The required completion contains every reply and disposition, but the replies alone occupy 262,144 bytes, exactly the entire wake-body budget. The outcome, dispositions, identifiers, separators and markers necessarily make the completion larger. Quotes or multibyte characters increase the excess. A single completion therefore cannot be delivered in the promised form, even with no other questions or digest posts in the wake.

Evidence: `board/contract.md:53` defines a completion as the outcome, every disposition and the replies. The permitted limits are 16,384 characters and sixteen addressees at `board/contract.md:161` and `board/contract.md:162`. Criterion 3.3 requires the asker to receive every reply and disposition (`board/plan.md:471`). The body is capped at 256 KiB encoded and puts completions first (`board/plan.md:453`; `board/contract.md:249`). The overflow rule leaves omitted posts open and directs the target to `board.read` with `incoming` (`board/contract.md:255`). A completion concerns a closed post authored by the target, so that incoming-open-question query cannot recover an omitted completion. Acceptance discharges the entire named completion, with no partial-completion acknowledgement (`board/plan.md:314`; `board/plan.md:392`).

An in-memory Node.js calculation found that just `{outcome:"answered", replies:[sixteen maximum ASCII strings]}` encodes to 262,226 bytes. This is an illustrative lower-content representation, not a proposed schema or an execution of future board code. The replies' raw text already exhausts the cap independently of that representation.

Suggested fix: Define a bounded completion payload and overflow retrieval rule before building. A compact outcome, dispositions and reply identifiers, with a precise authorized paged read for the text, is simpler than splitting one logical completion across several wakes. Alternatively, specify fragments and durable acknowledgement of them. State which completion identifiers may be recorded in `WakeBuilt.completions`, what acceptance proves, and how an oversized completion eventually clears its hold. Preserve the selected once-at-close notification policy rather than silently truncating answers or adding timer wakes.

Round 2 answer: Row 69 correctly makes completion debt durable through merging, cleanup, return and crash. It does not close the payload-size interaction introduced by making completions mandatory and first in the body. This is a remaining boundary of R2-A2/C2-02/R2-L4, not another report that the completion debt is absent.

### R3-A2. MAJOR. The truncated snapshot falls back to an unbounded status reply

Category: Design; Bug (failures). Evidence status: confirmed missing response bound with a concrete size counterexample. Responsible builder: board contracts and status handlers, registration unit 4, and the client wait-helper owner through the lead.

Scenario: A group channel has thirty-two question authors and sixteen recipients, for forty-eight agents in total. Each author has its permitted sixty-four open `all` posts, all addressed to those sixteen recipients. One recipient therefore has 2,048 incoming open posts. No individual author, addressee list or group limit is exceeded. A status response enumerating those posts and their addressees exceeds the one-MiB transport budget without containing any post text. When the bounded snapshot truncates, the prescribed fallback encounters the same transport failure that the snapshot change was intended to avoid. The owner's wait helper cannot obtain that target's complete condition inputs through the stated fallback.

Evidence: Group channels have no independent member limit (`board/contract.md:89`). Each author may have sixty-four open must-reply posts (`board/contract.md:171`), and each post may name sixteen addressees (`board/contract.md:162`). `board.status` returns incoming and authored open-post identifiers, channel identifiers, reply modes, addressees, dispositions and owed completions, without pagination or an encoded cap (`board/contract.md:383`; `board/plan.md:607`). The snapshot explicitly delegates overflow to `board.channels` and `board.status` (`board/contract.md:342`; `board/contract.md:349`). L21 specifically makes `waitForAgents` read `board.status` after truncation (`inputs/rulings.md:24`; `board/decisions.md:81`). The network contract requires every piece's largest event or reply to fit one MiB (`inputs/client-api-contract.md:570`).

An in-memory calculation using engine-shaped 36-character identifiers measured 1,556,494 JSON bytes for 2,048 records containing only `id`, `channelId`, `reply`, sixteen `to` identifiers and empty `dispositions`, inside an `incoming` array. It omitted the request id, counts, authored posts, completions and protocol envelope. Today's engine mints its agent identifiers with `randomUUID()` at `packages/engine/src/commands/start.ts:34`. No future status schema or network listener was executed.

The per-author open-question cap does not bound incoming questions per target. Owed completions can also accumulate across successive closes. `board.channels`, the other fallback, likewise has no declared page or lifetime channel bound. Removing post text is useful but does not establish a bound on these replies.

Suggested fix: Keep L21's bounded snapshot and status fallback. Make the condition inputs available as a small per-agent summary, independent of the full lists. Bound and page the detailed status collections and channel listing. Specify how the wait helper obtains a complete condition result without assembling an unlimited response, and how its read/subscription sequence prevents a stale fallback from ending a wait early. Add maximum-response criteria for these commands, not only for `board.read` and the initial snapshot. No larger finite transport limit solves an unlimited list.

Round 2 answer: Row 71 and L21 remove full-history text from the snapshot and cap its section. That part of R2-A1/threat S1/R2-TM-2 holds. The answer fails at its newly prescribed overflow destination. This finding does not request returning the full view again or reopen the approved 256-KiB cap.

### R3-A3. MAJOR. A group-channel crash invokes the rule that withdraws the author's preserved questions

Category: Design; Bug (failures). Evidence status: confirmed conflict between membership and outcome rules. Responsible builder: board access unit 2b and reactor units 3b/3c, with the planner reconciling the contract.

Scenario: Worker A is a labelled member of its lead's group channel. A authors an open question there, then crashes before the answer arrives. The lifecycle rule preserves A's question and allows replies while A recovers. But group membership admits only live label carriers, and “live” excludes crashed agents. A has consequently left the computed member set. The membership reactor explicitly handles crashes that change this set and withdraws a leaving author's posts. The same engine crash thus requires both preserving and withdrawing A's question. If removal wins, the question is permanently withdrawn; resuming A does not restore the promised pending conversation. If preservation wins, the membership cleanup rule has an unstated exception.

Evidence: “Live agent” excludes crashed and stopped agents (`board/contract.md:44`), and group admission requires a live label carrier (`board/contract.md:74`; `board/plan.md:382`). The outcome table says an author's crash leaves its posts open (`board/plan.md:308`; `board/contract.md:202`). The lifecycle reactor repeats that rule at `board/plan.md:519`. The membership reactor responds to a crash that changes computed membership and withdraws a leaving author's posts (`board/plan.md:534`). Row 65 expressly includes a member's stop or crash among membership changes (`board/decisions.md:75`). Existing engine code supplies a real crash transition: `packages/engine/src/views/apply.ts:202` passes `AgentCrashed` through its lifecycle transition, whose crashed result is at `packages/engine/src/views/apply.ts:165`.

The manager case also needs consistent wording. The contract and criterion 2.6 claim that manager crash and resume change nobody's membership (`board/contract.md:82`; `board/plan.md:395`), while L21 explicitly adds the inheriting manager as a member (`inputs/rulings.md:24`). An unlabelled former manager also loses the “current manager” exception unless its retained membership is specified. The lead's allowed inheritance is not itself a defect; the unchanged-membership assertion is too broad.

Suggested fix: Distinguish an actual channel departure or label revocation from a temporary lifecycle failure. State the precedence of crash preservation over membership cleanup, or retain membership across crashes while separately denying delivery to unavailable agents. Keep the fixed anchor and the inheriting manager's membership required by L21. Describe the exact member-set change at inheritance. Add a group-channel authored-question case, with a crash before reply, reply during recovery and resume, alongside a genuine label-removal control.

Round 2 answer: Structural ancestry fixes holder-availability changes for the other labelled workers, and the fixed anchor prevents cousin admission. Those portions of C2-01/R2-L3/logic M2/threat S4 hold. The remaining `live` filter creates a different interaction for the crashed member's own authored posts. This does not reopen the fixed-anchor ruling or require returning to dynamic holder-chain membership.

### R3-A4. MINOR. The pure-condition criteria still require complete answers from an incomplete snapshot

Category: Design (acceptance contract). Evidence status: confirmed wording conflict. Responsible builder: the board planner and client wait-helper owner.

Evidence: Criterion 1.7 requires both pure conditions to give the same answers over the bounded section as over the full view (`board/plan.md:343`). Criterion 5.9 repeats that requirement (`board/plan.md:610`). But the section can omit open-post metadata and completions once they alone exceed its cap (`board/contract.md:345`), while those records determine the conditions (`board/contract.md:305`). A pure function of the incomplete section cannot distinguish omitted work from no work. L21 already supplies the appropriate recovery decision: fetch condition inputs through status when `truncated` (`inputs/rulings.md:24`). The frozen helper description still speaks only of pure functions over each snapshot section (`inputs/client-api-contract.md:413`).

Suggested fix: Make the criteria distinguish a complete section from a truncated one. For a complete section, assert pure-function equivalence. For a truncated section, assert that the helper obtains the bounded status condition result before deciding that an agent is settled. Assign that helper integration and its test to the responsible client unit. R3-A2 separately covers the status response's functional size defect.

This is minor because the binding ruling already chooses the fallback. The remaining problem is that the written acceptance criteria do not express it. It is not a false verification claim: no one says these future tests have run.

## Risk register

Scores are severity × fallout × probability. Decisions remain with the owner or lead. No risk is accepted or closed by this review. No severity-floor adjustment applies.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Responsible area | Decision, deadline and closing evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R3-A1 | 6: completion delivery has no defined successful outcome until repaired | 3: retained replies allow recovery through the application | 6: a specific permitted collection with long replies | 108, schedule | Confirmed contract conflict | Board contracts, wakes and lifecycle | Unset; within this phase or a dated follow-up with an owner. No acceptance or closing evidence. |
| R3-A2 | 6: device status and wait fallback cannot complete until repaired | 3: retained state permits recovery after the API is corrected | 6: a specific permitted active-team backlog | 108, schedule | Confirmed sizing counterexample | Board status/registration; client helper | Unset; within this phase or a dated follow-up with an owner. No acceptance or closing evidence. |
| R3-A3 | 6: a promised recoverable conversation is withdrawn until handled manually | 3: the owner can inspect history and post again | 4: one author crash in a group channel | 72, schedule | Confirmed rule conflict | Board access and both reactor units | Unset; within this phase or a dated follow-up with an owner. No acceptance or closing evidence. |
| R3-A4 | 1: acceptance criteria contradict the chosen fallback | 1: the demonstrated consequence is a planning/test gap | 10: every truncation case exposes the wording conflict | 10, record | Confirmed | Board planner; client helper | Unset; review at phase end. No acceptance or closing evidence. |

These findings concern functional and shared-contract failures. The run's security-deferral ruling is not needed to reach the verdict.

## Round 2 answers checked

The supplied finding maps and all six round 2 reports were checked against the revised clauses. “Holds” below means a sufficient written plan decision, not a passed implementation test.

| Round 2 findings | Assessment |
| --- | --- |
| C2-01, R2-L3, logic M2, threat S4: group manager and holder availability | The manager exception, fixed parent links and fixed anchor answer the original failures. R3-A3 identifies the residual crash/removal interaction and the overbroad unchanged-membership criterion. |
| Threat S3: owner-opened channel admission | Holds: the owner names an anchor, and reused labels outside its subtree do not admit members (`board/contract.md:70`). |
| C2-04, R2-TM-1, logic M3: unsent revocation and old carried posts | Holds as a design: the dispatcher rechecks reach at send, the guard remains when disabled, and per-post failures resolve or omit the relevant demand (`board/contract.md:109`). L22 covers every delivery, including same-tree and no-caller wakes (`inputs/client-api-contract.md:648`). |
| R2-A4, C2-03, R2-L2: direct grant loss | Holds: the reactor resolves outstanding demands when the last non-direct grant ends (`board/contract.md:103`; `board/plan.md:540`). The immutable-disposition rule and outcome table must govern a partly answered `all` collection as well. |
| R2-A2, C2-02, R2-L4, logic m1/m5: completion debt | The independent debt, wake index, acceptance, crash survival, retry exhaustion and unsettled guard are now explicit (`board/plan.md:310`). R3-A1 concerns packing this mandatory debt. |
| R2-A3, R2-L1, logic M4/m3: interruption and late replies | Holds: `AgentInterrupted` with `reloadable !== true` and startup catch-up are covered, and a late reply may upgrade `gone` while open (`board/plan.md:288`; `board/plan.md:516`). The referenced engine predicate resolves at `packages/engine/src/routing/waits.ts:55`. |
| R2-A1, threat S1, R2-TM-2: oversized snapshot | The bounded no-text section answers the original full-view defect. R3-A2 concerns the overflow destination; R3-A4 reconciles the conditions test with L21. |
| C2-05, threat m1, R2-TM-3: JSON expansion | Holds for wake bodies: the cap now counts encoded bytes, and the test cases include quotes, backslashes and controls (`board/plan.md:476`). The full-envelope post-build check remains necessary. |
| Threat S2, logic m7, threat m4: permission ceilings | Holds: `AgentStarted.permission` is retained separately and compared, and the claim is narrowed to wake authority (`board/plan.md:376`; `board/contract.md:146`). Today's current-mode overwrite is at `packages/engine/src/views/apply.ts:190`. |
| Logic M1: cleanup across addressees | Holds: one addressee's resolution cleans only that target; closing the post cleans all queued demands (`board/plan.md:320`). |
| Logic m2/m4/m6 and R2-L5: incoming condition, self-address, join position and recovery hint | Holds: no-disposition incoming condition, self-address refusal, join watermark and `incoming` read are explicit (`board/contract.md:310`; `board/contract.md:162`; `board/contract.md:330`; `board/contract.md:328`). |
| Threat m2/m3/m5, R2-TM-4: status projection, channel header and receipts | Holds: status has no text or channel names; headers use channel ids; the store inventory includes receipt copies (`board/contract.md:383`; `board/contract.md:260`; `board/contract.md:357`). Receipt-envelope storage resolves at `packages/engine/src/log/EventLog.ts:210`. R3-A2 concerns size, not projection privacy. |
| C2-06: privacy criterion and parent thread exception | Holds: criterion 6.3 now includes the documented positive control (`board/plan.md:642`). The current own/direct-child stream filter resolves at `packages/engine/src/api/server.ts:155`. |

## Proposed post-build checks

These require implementation evidence after the conflicting decisions above are reconciled.

| Id | Scenario | Expected result | Required evidence | Responsible area |
| --- | --- | --- | --- | --- |
| R3-PB-1 | Close an `all` collection with sixteen maximum-size replies; repeat with several completions and an incoming question. | Every completion fits the chosen protocol or has a precise retrieval path. No acceptance discards undisclosed text, and no completion blocks forever because it can never fit. | Encoded bodies, completion acknowledgements, exact public recovery calls, settled outcomes and rebuilt views. | Board wakes, contracts and lifecycle. |
| R3-PB-2 | Use the forty-eight-agent, 2,048-incoming-post case. Bootstrap a device, obtain status and run the owner wait helper. | Every response stays within its declared bound. Truncation and paging preserve complete condition results. | Actual protocol byte counts, status pages/summaries and wait results over a paired-device connection. | Board status/registration and client helper. |
| R3-PB-3 | A labelled non-manager authors a group question, crashes, receives a reply during recovery and resumes. Separately remove its label deliberately. Repeat manager inheritance. | Crash and genuine departure follow their separately chosen policies. The anchor stays fixed, and only the permitted inheritance changes membership. | Exact member sets, post outcomes, owed completions, real-token calls and replay equality. | Board access and reactors. |
| R3-PB-4 | Obtain a truncated snapshot while a waited agent has an omitted outgoing question or completion. Commit another change between snapshot, fallback read and subscription. | The helper never treats missing inputs as settled, and its recovery read cannot overwrite a newer condition state. | Controlled ordering, response sequence information, stream trace and public wait result. | Client helper and board condition projection. |
| R3-PB-5 | Queue one previously sent/requeued wake and one fresh wake for a target, revoke access to only one carried channel, then race dispatch with the reactor. Repeat with the board disabled. | Validation judges the selected delivery and its carried content. No inaccessible text is sent, and authorized work survives when the enabled reactor repairs the failed wake. | Reservation transactions, delivery/source ids, `WakeBuilt` records and actual runner bodies. | Seam dispatch and board reach/reactor. |
| R3-PB-6 | Exercise acceptance, an error after content acceptance, return retry, crash and cleanup for mixed completions and questions. Restart after each boundary. | The selected debt and retry policy has one durable interpretation, without losing a completion or generating an unbounded retry loop. | Ordered engine/board events, captured deliveries, retry counts and live/rebuilt comparison. | Board view, wakes and lifecycle. |

Retain the plan's existing checks for redaction, full-envelope size, agent snapshot omission, namespace-limited withdrawal, wait checks over projected batches, token revocation and restart replay proof.

## Noted, not filed

- Known gaps 1 through 9 remain excluded. Package manifests, test-runner registration, missing scopes, vendor allowances, the owner's seam answer and the WIDENED exclusions are disclosed lead dependencies. L22 in the supplied inputs answers known gap 8's two wording questions; they are not new findings.
- The board's package boundaries and shared delivery path are sound. The current runner receives a delivery through `Runner.prompt` at `packages/engine/src/runner/Runner.ts:122`. Dispatch reserves `DeliverySent` before calling it at `packages/engine/src/routing/deliveries.ts:248` and `packages/engine/src/routing/deliveries.ts:255`. Source-specific stop handling remains an explicit seam dependency, not an existing board feature.
- Switch-based rollback retains schemas, view and the reach guard. The plan does not promise rollback to a binary without board schemas after board events exist. No separate database migration is required by the board as presently scoped; its projection is rebuilt from the shared log. Cold replay of that composed schema set remains necessary release evidence.
- Current official [Effect RpcGroup documentation](https://effect.website/docs/v4/api/effect/rpc/RpcGroup), checked on 2026-11-03, lists `make`, `merge`, `omit` and `prefix`. Context7 was consulted first; its versioned 4.0.4 query returned adjacent HTTP API material rather than the requested RPC reference. The official page identifies 4.1.1, so it confirms the current surface rather than proving pinned 4.0.5 behavior. Existing repository usage of `make`, `merge` and `omit` resolves at `packages/contracts/src/commands.ts:44`, `packages/contracts/src/commands.ts:135` and `packages/contracts/src/commands.ts:137`. The dependency pin is at `pnpm-workspace.yaml:6`. No new library behavior is assumed by the findings.
- Node.js 26.13.0 was selected with `nvm use`. Verification consisted of document and source inspection plus the two in-memory size calculations. No application tests, future board tests, dependency installation, live-agent calls, commits, pushes, delegation or team-board messages ran. No check was refused by model policy.
- Some broad reads exceeded the output budget. The relevant source and review sections were reread in smaller ranges before use. No probe changed a repository file. The assigned scratch directory was never created and was confirmed absent. Only this result file is written. The plans lead owns issue-list updates; no session report or journal entry is produced.
