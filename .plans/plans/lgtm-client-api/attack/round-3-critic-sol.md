revise
Grade: 7  B/M/m: 0/1/1  Flags: none

# Review of client API contract version 10

This review checks the client application programming interface (API) plan against commit `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. Plan references below are relative to `lgtm-client-api/` in this review batch. Consumer and ruling references are relative to the batch's `inputs/` directory. Repository references are relative to the recorded checkout.

The round-two folds substantially resolve the earlier failures. One new access contradiction prevents an agent from recovering an oversized state event. One remaining size calculation does not establish the promised snapshot bound. Both can be corrected within the current design.

## Findings

### C3-01. An agent cannot fetch the oversized state event that its filtered stream requires

Severity: **MAJOR**. Category: **Design**. Evidence status: **Confirmed contract contradiction**. Responsible builder: the client reads and client library areas.

**Scenario.** An authenticated parent agent follows its child's events through `client.subscribe`. The child asks for permission with a description larger than 256 kibibytes (KiB). The event is visible to the parent and is replaced with an oversized marker. The client library must fetch the event before applying later events or advancing its cursor. That fetch is denied to an agent caller. Following the specified failure policy reconnects before the same marker, so the subscription cannot progress. Terminating after a retry limit would still fail the promised subscription.

**Evidence.**

- `contract.md:1178` expressly gives agents access to `client.subscribe`. The read rule includes structural children and agents held while their parent is unavailable (`contract.md:528`).
- `contract.md:1133` replaces every event above the size threshold with a marker. `contract.md:1141` requires automatic `client.event` recovery for a known state event, names `PermissionRequested`, delays cursor advancement, and reconnects before the marker on a failed read.
- Both the prose at `contract.md:648` and the access entry at `contract.md:1179` limit `client.event` to owner, device and service. There is no agent recovery alternative.
- The recovery and cursor policy belongs in the shared client core (`contract.md:2042`), including the Node entry used by agent callers.
- This is a permitted event, rather than a hypothetical malformed transport frame. The current event schema accepts an unrestricted description and permission option strings (`packages/contracts/src/events.ts:38`, `packages/contracts/src/events.ts:121`). The current adapter redacts the title and emits it as the description without a length cap (`packages/engine/src/runner/AcpRunner.ts:411`).
- Criterion 3.8 exercises marker recovery but does not specify an agent caller (`plan.md:473`). Criterion 3.1 explicitly includes agent snapshots and request identity rows (`plan.md:466`); those rows also direct clients to `client.event` for the full request (`contract.md:479`).

**Suggested fix.** Give an agent an authorized way to fetch each visible event that its stream can replace with a marker. The direct fix is to include agents in `client.event`, under the same current visibility rule, with the protection for agent-authored text required by the agent thread-read ruling. Define how the client library handles that reply. Update the access table, the derived Model Context Protocol (MCP) tool pin if applicable, and criterion 3.8 together. Keep unrelated events and owner-only piece events unavailable.

This is a cross-caller regression in the new recovery path. It does not reopen the settled decision to recover owner and device state through a separate whole-event read.

### C3-02. The snapshot display fields do not imply a 4 KiB encoded bound

Severity: **MINOR**. Category: **Design**. Evidence status: **Confirmed counterexample to the stated bound**. Responsible builder: the snapshot reads area.

**Scenario.** A permission option has an 8 KiB opaque identifier and a short name. The snapshot includes that option in its display part. There is only one option, the preview is short, and the name meets its cap, but the display already exceeds 4 KiB.

**Evidence.**

- `contract.md:473` limits the preview to 512 bytes, the number of options to eight, and each option's name to 128 bytes. It retains each option's identifier and kind without limits, then concludes that the display part is at most 4 KiB (`contract.md:477`).
- The existing option schema defines the identifier as `Schema.NonEmptyString` and the kind as `Schema.String` (`packages/contracts/src/events.ts:38`). The adapter's identifier check rejects a redacted identifier, but imposes no length cap (`packages/engine/src/runner/AcpRunner.ts:405`).
- An in-memory probe on the recorded checkout decoded a permission option with an identifier of 8,192 bytes through the actual schema. A display object containing that option, a seven-byte preview, and the specified fixed fields encoded to 8,361 bytes in JavaScript Object Notation (JSON). No escaping or additional options were needed.
- Criterion 3.1 requires a display part of at most 4 KiB, filled to its limits (`plan.md:466`). The design does not define limits for these retained strings. Encoded escaping also needs to be included when enforcing the total.

**Suggested fix.** Define an actual encoded-byte budget for each display part. Omit optional display detail and expose an omission indicator when it cannot fit, preserving the complete identity row and full-event read. Do not truncate an opaque option identifier and later treat it as an answerable identifier. Alternatively, define compatible schema limits for every retained string and prove the resulting encoded maximum. Extend the snapshot test with a long identifier, an unfamiliar long kind, and escaped text.

The limited defect here is the unsupported display-size guarantee. This review does not assert a new socket ceiling, inevitable memory exhaustion, or loss of the complete event. The known gap about an uncapped number of agents (`attack/known-gaps.md:68`) does not cover this per-display bound.

## Risk register

Scores assume real use. The decision column is reserved for the owner. No acceptance or closing evidence exists for these new findings.

| Finding | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Responsible builder | Decision | Deadline | Acceptance | Closing evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| C3-01. Agent state recovery is denied. | 6. A promised subscription remains blocked until the caller changes its workflow or the defect is fixed. | 3. The affected caller can recover through another client workflow; stored events remain intact. | 4. It needs a large visible state event during an agent's filtered subscription. | 72, schedule. | Confirmed contract contradiction. | Client reads and client library. | Unset; owner decides. | Within this phase, or a dated follow-up with an owner. | None. | None. |
| C3-02. A display can exceed its stated bound. | 2. The guaranteed compact response can be larger than promised; no additional user failure is established. | 3. It affects the response containing the unusual option and can be repaired by the application. | 2. The counterexample uses an unusual long adapter identifier. | 12, record. | Confirmed schema and serialization probe. | Snapshot reads. | Unset; owner decides. | Review at the end of this phase. | None. | None. |

## Proposed post-build checks

| Id | Scenario | Expected result | Required evidence | Responsible area |
|---|---|---|---|---|
| C3-PB-01 | Use an actual agent credential with the public Node client. Stream a visible child's large permission event, followed by a small state event. Repeat during effective holding and after the parent recovers. | The large event is fetched and applied exactly in sequence. The later event arrives. Current visibility is enforced on the read and reconnect. A stranger's event and an owner-only event remain refused. | Actual remote procedure call (RPC) frames, caller kind, fetch result, applied event sequences and reconnect cursor. Extend `packages/client/test/oversized-state.test.ts` and `packages/engine/test/client/event-read.test.ts`. | Client reads and client library. |
| C3-PB-02 | Fill a request display using long option identifiers and kinds, escaping, and multibyte text. Include more than 256 open requests and questions. | Every encoded display respects its defined bound. All identity rows remain present. A full request remains retrievable and its identifiers remain exact. | Actual encoded reply sizes and round-trip identifiers in `packages/engine/test/client/snapshot.test.ts`. | Snapshot reads. |
| C3-PB-03 | Delay a whole-event recovery read while later stream events arrive. Exercise a payload that takes longer than five seconds to fetch. | Acknowledgement handling does not repeatedly disconnect a healthy stream merely because recovery is still fetching. Applied state and the durable reconnect cursor never move past an unrecovered state event. | Real transport timing, acknowledgement frames, applied sequences and reconnect observations. This is an implementation check, not an assertion that the planned Effect code is wrong. | Client library and transports. |
| C3-PB-04 | Hold an account secret write between storage and log commit while rotating or clearing the carrier token. Separately fail the token event commit after storing its new value. | The account secret survives. A failed token rotation leaves the prior committed token active. Removal targets only the intended old carrier generation. | The barriers and store/log results named in criterion 1.39 and criterion 6.14; a successful authenticated push after restart. | Accounts and alert carrier. |
| C3-PB-05 | Finish an old carrier send after committing a destination change. Replace a failed token and restart during backoff. Keep the carrier down for an hour. | Old results cannot settle the new generation. Undelivered alerts recover, already delivered alerts obey the token-change rule, and retries continue at the cap. | Fault-injected delivery records and destination/generation assertions from criterion 6.11. | Alert delivery. |
| C3-PB-06 | Withdraw the final queued delivery immediately after a real reload. Exercise both dispatcher reach refusal and a piece reactor's withdrawal. | Idle is written in the same batch before wait checks. The next eligible delivery can proceed, and no wait is stranded in the reloaded working state. | Actual `reloadedEvents`, committed batch order and a completed wait in criterion 1.43. | Routing and piece batch path. |
| C3-PB-07 | Start with open board and roles matters, then create an owner-directed board post while its author remains working. | The initial scan creates baseline alerts without pushes. The later post triggers the owner's early wait exit through the named event read, using results at a coherent sequence. | Fixtures exercising each piece's `openMatters`, `ownerHeld` event table, and criteria 3.6 and 6.16. | Client waits, alerts, board and roles. |
| C3-PB-08 | Send permission requests for every tool kind, including absent, redacted and truncated input, then attempt a standing-rule match. | The page shows the action or the fixed warning before approval. The matcher refuses absent, changed or cut input and unsupported tools. | Runner field tests, page interaction tests and the roles matcher tests using the same event. | Runner, web page and roles. |

## Noted, not filed

### Round-two blocker and major folds

The table accounts for every round-two blocker and major, grouping duplicate reports. These are judgments about the revised decisions and proposed tests. They are not claims that the unbuilt implementation has passed those tests.

| Earlier findings | Assessment of the version 10 fold |
|---|---|
| Logic Sol R2-L1, architect R2-A1, logic Opus major 1, threat model Sol R2-TM-1; also Opus TM2-8 | The startup-only collection rule and dedicated carrier removal resolve the live collection race at the design level (`contract.md:2067`). The barrier test is named at `contract.md:2091`. Today's account planner stores before committing (`packages/engine/src/commands/accounts.ts:38`), so keeping that writer boundary is necessary. |
| Architect R2-A2, logic Sol R2-L3, threat model Sol R2-TM-2, logic Opus major 3 | The generation and indefinite capped retry rules resolve the competing pending rules and permanent exhaustion (`contract.md:919`; `plan.md:600`). Late old-generation results are explicitly covered. |
| Threat model Opus TM2-1 | E29 carries redacted input for every tool kind and the page warns about unavailable input (`contract.md:2119`; `plan.md:357`). The roles matcher already requires that input was neither redacted nor cut (`inputs/roles-plan.md:642`). Its older execute-only field addition is consumer-version lag, not a second shared edit. |
| Threat model Opus TM2-2 | The dedicated proxy-user classification and forwarded-header refusal are explicit (`contract.md:1223`; criteria 10.2 and 10.3). The same-user proxy limitation is honestly retained as a known gap (`attack/known-gaps.md:56`). |
| Threat model Opus TM2-3 | Criterion 5.4 expressly refuses localhost and IPv6 loopback and prints only the bound IPv4 address (`plan.md:535`). |
| Architect R2-A3 | A per-piece `openMatters(views)` supplies the first scan independently of bounded client sections (`contract.md:853`; `plan.md:605`). |
| Critic C2-01, logic Sol R2-L2, logic Opus major 4 | Whole-event recovery resolves the previous owner/device state loss and the event-with-no-thread case (`contract.md:1137`). C3-01 identifies a different caller excluded from the new recovery path. C3-02 records the narrow remaining bound defect, rather than repeating the earlier broad failure. |
| Critic C2-02 | Fresh physical token names and selection by the committed event preserve the old value when a new write fails (`contract.md:1014`, `contract.md:2078`; `plan.md:603`). |
| Critic C2-03 | Named piece events now cause a read while the member is still working (`contract.md:703`; `plan.md:471`). The older board text's settled-only trigger is the specifically delegated consumer fold (`inputs/rulings.md:53`, `inputs/rulings.md:63`). |
| Logic Opus major 2 | E17 and E18 require the reloaded-idle repair in the same batch before wait checks (`contract.md:1794`; `plan.md:358`). The existing reload writes working when retry work exists (`packages/engine/src/recovery/reload.ts:98`), and dispatch explicitly recognizes that recovered state (`packages/engine/src/routing/deliveries.ts:222`). |
| Logic Opus major 5 | The level rule raises a fresh alert for a surviving owner-held question when its asker resumes (`contract.md:912`; criterion 6.2). This does not claim that a request tied to a dead process becomes answerable. |

The round-two critic's two minors also have concrete folds: uniqueness is checked before merging (`contract.md:1336`), and reload receives the optional acting device (`contract.md:1700`). Reads' marks are covered separately by the piece batch write table (`contract.md:1977`).

### Shared engine edits E1 through E29

Every numbered edit was checked against the recorded engine and the supplied board and roles requirements. The audit found no additional concrete shared-engine failure beyond the findings above. In particular, changes to existing semantics must retain their named test updates; existing engine tests are not evidence that the future pieces already work.

| Edits | Recorded engine anchor and review result |
|---|---|
| E1, E10 | Command composition and CLI parsing are concrete edit sites: `packages/contracts/src/commands.ts:135`, `packages/cli/src/commands/registry.ts:10`. The pre-merge uniqueness requirement and namespaced CLI handling are specified in `contract.md:1326` and `contract.md:1591`. No extra transport registry is required. |
| E2 | Today's access check is in planning while receipt replay comes earlier (`packages/engine/src/commands/CommandHandler.ts:70`, `packages/engine/src/commands/CommandHandler.ts:238`). The planned move before receipts and distinct device refusal behavior are explicit (`contract.md:1348`). The exact MCP pin remains a test obligation; today's pin is at `packages/contracts/test/commands.test.ts:92`. |
| E3, E4 | The planner/read split preserves engine `afterCommit`, and read marks do not become cached receipts (`contract.md:1393`, `contract.md:1437`). Current post-commit execution is at `packages/engine/src/commands/CommandHandler.ts:278`; receipt persistence is at `packages/engine/src/log/EventLog.ts:210`. This supports board reads that must recheck current access. |
| E5, E6 | The strict server union and piece view folds have named homes (`contract.md:1466`, `contract.md:1500`). Current event schemas and state live at `packages/contracts/src/events.ts:89` and `packages/engine/src/views/apply.ts:92`. The plan covers lifecycle keep entries and reconstruction rather than assuming new tags work automatically. |
| E7 | Migrations and transactional side rows are explicit (`contract.md:1525`). Current side-row writes share the log transaction (`packages/engine/src/log/EventLog.ts:199`). No separate piece writer is proposed. |
| E8 | The shared read rule preserves management rights and extends visibility during effective holding (`contract.md:1536`). Today's inline stream filter is only self/structural-child (`packages/engine/src/api/server.ts:155`). The changed “never a grandchild” test is named: `packages/engine/test/api/subscribe-visibility.test.ts:154`. |
| E9 | Snapshot sections are filtered per caller and taken from one views value with its own sequence (`contract.md:1571`). Current views publication is separate from committing the log (`packages/engine/src/views/Views.ts:41`, `packages/engine/src/log/EventLog.ts:136`). Board and roles bounded summaries fit the proposed interface. C3-02 concerns the engine request display. |
| E11, E12 | Caller and acting-device storage have one durable representation and explicit migration (`contract.md:1604`, `contract.md:1652`). Today's caller key accepts only Actor (`packages/engine/src/log/EventLog.ts:116`). Reserved open-web identity enforcement is placed in both the event schema and device side-row insert, whose current sites are `packages/contracts/src/events.ts:177` and `packages/engine/src/log/EventLog.ts:202`. |
| E13 | Services use an in-process path and an exact command list, with no wire credential or general `answer` permission (`contract.md:1684`). The roles plan owns its later `release` addition. Board posting rights do not imply board reads. |
| E14 | Only the permission answer's actor widens to identify a rule (`contract.md:1717`); today's field is Actor at `packages/contracts/src/events.ts:132`. Question answer ownership is not silently widened. |
| E15 | The sender changes cover the delivery, sent event and returned event, with the engine data envelope for every non-owner sender (`contract.md:1734`). Current delivery sources and senders are at `packages/contracts/src/events.ts:20`. Board wakes must still name each item's authenticated author. |
| E16 | Piece-source handling covers both queued and sent deliveries when a target is gone (`contract.md:1782`). Today's shared pending predicate includes both (`packages/engine/src/routing/deliveries.ts:24`), and the target-gone path is at `packages/engine/src/routing/deliveries.ts:73`. |
| E17, E18 | Withdrawal is restricted to the piece's own queued source. Reach checks use projected transaction state at queue and send time, continue after a failed delivery, and run wait checks (`contract.md:1794`, `contract.md:1815`). The recovered-idle repair is explicitly included. The board's membership reach rule can use these inputs. |
| E19, E20 | Pure contracts own settled/member rules and piece conditions; engine writers check blocking waits and clients use coherent piece result sequences (`contract.md:1861`, `contract.md:1891`). Today's settled and wait projection are at `packages/engine/src/routing/waits.ts:39` and `packages/engine/src/routing/waits.ts:110`. The board's condition requires delivery status (`inputs/board-contract.md:415`), which the shared input carries. |
| E21, E22 | A separate thread index preserves the old envelope visibility field and covers queued-delivery targets (`contract.md:1905`). Today's log derives envelope agent identity from the event's direct field (`packages/engine/src/log/EventLog.ts:175`), while views already have a separate thread mapping (`packages/engine/src/views/apply.ts:122`). The exported rights and read helpers are specified at `contract.md:1923`. |
| E23 | The piece batch path restricts tags and delivery sources, keeps reads' marks under the calling caller, and projects lifecycle checks per event (`contract.md:1933`). The board can queue after its own source events. Its older delivery-id wording is the delegated source-id fold, not a reason to reintroduce raw delivery writes. |
| E24 | Stream dispatch must use each command's own tag (`contract.md:2009`). Today's library routes every streaming command through `subscribe` (`packages/client/src/index.ts:199`, `packages/client/src/index.ts:219`). The planned change addresses this directly. |
| E25 | Tolerant decoding is placed at the client RPC boundary, before application decoding (`contract.md:2022`). Today's client instantiates the strict command group (`packages/client/src/index.ts:97`). Unknown tags can therefore reach the new decoder without weakening the server union. |
| E26 | Browser and Node entries share a Node-free core (`contract.md:2037`). Current local credential selection is in `packages/client/src/index.ts:120`. The production browser build is the right additional check. The shared recovery policy exposes C3-01. |
| E27 | Startup collection, per-piece keep references, secret command hashing and dedicated carrier generation removal are explicit (`contract.md:2058`). Today's store operations serialize through the store semaphore (`packages/engine/src/accounts/SecretStore.ts:57`); removal must retain that boundary. |
| E28 | The pending owner recommendation is implemented as a device-only option restriction, with a named refusal and a page state (`contract.md:2097`). Today's permission answer checks are at `packages/engine/src/routing/permissions.ts:31`. The proposed test adds device cases while retaining owner expectations. |
| E29 | The runner request and durable event gain optional redacted input fields while the requests view and snapshot exclude raw input (`contract.md:2119`). The actual adapter currently emits no input (`packages/engine/src/runner/AcpRunner.ts:415`). Tests name each tool kind and old-log reconstruction. The roles matcher already refuses altered or cut input. |

### Scope rules, gates and accepted limits

The supplied owner and lead rulings authorize direct engine changes, the initially open web server, and remote access before a separate Unix user (`inputs/rulings.md:9`, `inputs/rulings.md:34`). The approved security document changes are reviewed on those terms. They are not new findings.

The known scope and sizing items remain with the lead: scope files, vendor allowance, owner question 6, and the explicitly WIDENED editor-extension exclusion (`attack/known-gaps.md:9`). I found no additional unmarked scope expansion requiring a new finding. The computer-only exceptions are enumerated, and the pending device-answer restriction is labeled as pending. The limitations of the process guard, same-user proxy, account values in streams, at-least-once push, and old-carrier best effort remain the named known gaps.

Against the ten plan gates, the new defects affect the acceptance and verification story: the caller matrix for recovery is incomplete, and a fixed fixture cannot establish the claimed display bound. The plan otherwise supplies observation paths, UI artifacts, traceability, workstream risks, rollout order, task anchors and guardrails. Gate 1's known open scope item and gate 10's lead-owned prerequisites remain open as disclosed; this review does not certify them as closed. No additional missing existing-test update was found in the engine edits reviewed above.

### Execution record and limits

- Read the assigned brief, reviewer rules, repository guidance, plan and contract, decision records, prior finding folds, known gaps, rulings and relevant consumer requirements. Checked the code anchors against the recorded commit.
- Used Node `v26.13.0` after `nvm use`. The schema/serialization probe reported `acceptedOptionIdBytes: 8192`, `displayEncodedBytes: 8361`, and `permittedRequestEncodedBytes: 315690`.
- The probe used the installed schemas in memory. It did not implement or run the future snapshot or filtered-stream handlers. No implementation test pass is claimed.
- Current Effect documentation was consulted through Context7 during the review. No new carrier or proxy behavior was inferred from live service testing.
- Some initial combined read output was truncated. Critical finding anchors and the probe were read or run again in smaller calls. No finding relies on an unseen truncated passage.
- The checkout remained unchanged. No repository documentation, application code, commits or pushes were made. The assigned scratch directory was never created and was absent before the result write. This result is the only file written.
