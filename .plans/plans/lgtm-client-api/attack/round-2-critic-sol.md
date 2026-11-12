revise
Grade: 6  B/M/m: 0/3/2  Flags: none

## Review scope and evidence

This is the round 2 plan-critic review of client API contract version 8. Repository code references below were checked at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. References to `plan.md`, `contract.md` and `decisions.md` mean the frozen files beside this attack folder. References beginning `inputs/` mean the round's supplied inputs.

The owner and lead rulings bind this review. The open web server, deferred pairing, deferred Unix user, computer-only commands and pending question 6 are not findings. The remaining changes can be made in place.

## Findings

### C2-01. MAJOR. An oversized state event advances the page's cursor without supplying the state or a complete recovery path.

Category: Design and Bug (state synchronization). Evidence status: confirmed plan gap. Responsible builder: client API units 2, 3 and 7a/7b.

Scenario: A page takes its snapshot, then an agent produces a permission request with an encoded description above 256 KiB. The filtered stream substitutes `client.Oversized` and advances its cursor. That marker contains no permission request id, holder or options. The situation view therefore cannot fold the request into its current state. The plan's only retrieval behavior is a tap on a thread marker. There is no rule requiring the page to recover omitted control state before it continues applying later events.

There is a second, definite hole in the retrieval contract. An oversized `HarnessChanged` or `AccountChanged` has no thread. `client.thread` cannot retrieve that event at all. These are possible inputs below the new 1 MiB inbound ceiling.

Evidence: `contract.md:954` acknowledges unbounded engine data. `contract.md:964` applies the substitution to every oversized event and directs retrieval through `client.thread`. `plan.md:459` tests cursor movement, while `plan.md:635` specifies retrieval on a tap. The live situation view is promised at `plan.md:633`. At the recorded commit, a permission description is unbounded (`packages/contracts/src/events.ts:126`). Harness argument arrays are unbounded (`packages/contracts/src/harnesses.ts:28`). Account environment values are unbounded (`packages/contracts/src/accounts.ts:9`). The existing thread rule expressly excludes account and harness events (`packages/engine/src/views/apply.ts:119`). E5 and E21 preserve that exclusion (`contract.md:1259`, `contract.md:1672`).

Suggested fix: Define how clients recover state when a marker replaces a state-bearing event. Keep bounded state metadata in the stream, or require an explicit resnapshot/reconciliation before the client proceeds. Define an authorized retrieval or refresh path for events that have no thread. Add acceptance cases for a large `PermissionRequested` after the initial snapshot and for a large event with no agent. Assert the resulting state, actionable request and reconnect behavior, rather than cursor movement alone.

Risk: severity 6, because the current situation and approval state can remain wrong until a manual refresh; fallout 3, because the owner can recover through a fresh snapshot; probability 4, because a single unusually large request or setting triggers it. Score: 72, schedule within this phase or assign a dated follow-up.

### C2-02. MAJOR. Rotating the fixed token slot overwrites the committed credential before its log event commits.

Category: Design and Bug (failure recovery). Evidence status: confirmed conflict with the named storage pattern. Responsible builder: client API units 1b and 6b.

Scenario: A working carrier has token A in the fixed slot. The owner runs `set-token` with token B. The planner overwrites the slot, then the command is interrupted or the log commit fails. After restart, the log still describes the earlier token configuration, but the slot contains B. Token A has been destroyed. The new credential can also be used before its setting event commits. If B is invalid, previously working phone alerts stop despite the failed rotation.

Evidence: `contract.md:878` fixes the reference, `contract.md:884` requires replacement on rotation, and `contract.md:1828` explicitly stores the value before committing by following `setSecret`. At `8ff4c9b`, `SecretStore.put` replaces an existing reference immediately (`packages/engine/src/accounts/SecretStore.ts:49`, `packages/engine/src/accounts/SecretStore.ts:57`). The account pattern avoids overwriting the active credential by minting a fresh reference for every write (`packages/engine/src/commands/accounts.ts:42`). Its failure guarantee relies on that distinction (`packages/engine/src/commands/accounts.ts:44`). E27 adopts the ordering while removing that protection. Its acceptance cases cover restart retention and ordinary rotation, but not this failure window (`plan.md:347`, `plan.md:588`).

Suggested fix: Keep the lead's single logical token slot, but define a staged or versioned update inside it. A committed token generation must select the active value, and a failed update must leave the previous committed generation usable. State how recovery and secret collection handle each side of the commit. Add a fault-injection case after the replacement value is stored and before its event commits. Include initial token installation as well as rotation. Do not claim the account pattern's crash behavior for an in-place overwrite.

Risk: severity 6, because phone alerts require manual credential repair; fallout 3, because the owner can set a working token again; probability 4, because one interruption or storage failure during rotation is sufficient. Score: 72, schedule within this phase or assign a dated follow-up.

### C2-03. MAJOR. The settled-only refresh rule cannot deliver the newly promised immediate board-owner exit from a blocking client wait.

Category: Design and Bug (deadlock). Evidence status: confirmed contradiction between two contract rules. Responsible builder: client API unit 3, coordinated with the board's condition-list read.

Scenario: The owner starts a blocking client wait while lead L is working. The snapshot's `ownerHeld` list is empty. L then posts a board question to the owner and remains working, for example while its turn blocks waiting for a child. The helper receives the board event, but it does not hold the board's complete view and obtains the board's conditions through its condition-list read. The stated rule invokes that read only when the engine's part says the waited agents are settled. L is still working, so the helper never discovers the new `ownerHeld` condition. It continues waiting for work that needs its caller's answer.

Evidence: `contract.md:624` requires the helper to end early for an owner-held board condition, checked at open and after every batch. `contract.md:637` says the client lacks a piece's full view and uses the piece's results. However, `contract.md:643` triggers the list read only when the engine's settled test succeeds. `plan.md:461` requires exit 2 at once with no hang. The supplied board contract has the same settled-only read rule at `inputs/board-contract.md:408`; this is a real interaction with the API's new early-exit promise, not a complaint about its older version number. Working agents are not settled in the recorded engine (`packages/engine/src/routing/waits.ts:39`, `packages/engine/src/routing/waits.ts:49`).

Suggested fix: Give `ownerHeld` an event-driven refresh trigger that is independent of settled candidates. For example, refresh it when relevant piece batches arrive, while retaining the agreed sequence check before a successful settled result. The lead's no-polling rule need not change. Add a test that opens the helper while L is working, creates an owner-addressed post afterward, never makes L idle, and requires prompt exit 2. A test with `ownerHeld` already present in the initial snapshot does not cover this case.

Risk: severity 6, because the promised blocking helper can deadlock until the owner intervenes; fallout 3, because cancelling the wait and answering the question recovers it; probability 6, because asking the owner during an active turn is an ordinary specific action. Score: 108, schedule within this phase or assign a dated follow-up.

### C2-04. MINOR. The command-uniqueness acceptance criterion needs a check before the merge.

Category: Design (verification). Evidence status: confirmed insufficient criterion, demonstrated with the pinned library. Responsible builder: client API units 1a and 2.

Evidence: `contract.md:90` correctly explains that merging replaces a duplicate. However, `contract.md:1135` and `plan.md:410` require uniqueness in the resulting full group. A group's request map is already unique by construction. Inspecting that map cannot prove that no declaration was overwritten.

A read-only Node.js 26 probe against installed Effect 4.0.5 merged two groups with the same `client.fixture` command and different success schemas. It returned:

```json
{"inputNames":["client.fixture","client.fixture"],"mergedNames":["client.fixture"],"finalGroupUniquenessCheck":true}
```

The official [Effect 4.0.5 merge implementation](https://github.com/Effect-TS/effect/blob/effect@4.0.5/packages/effect/src/rpc/RpcGroup.ts#L269-L276), checked 2026-11-03, inserts each tag into a map. Context7's 4.0.4 material did not answer this exact question, so the pinned source was also inspected directly.

Suggested fix: Require the test to compare the constituent groups' declarations before merging, including declarations within a namespace. Add a negative fixture proving that an intentional duplicate fails. This is a criticism of the written observation, not an allegation about tests that have not been built.

Risk: severity 1, because this finding is a verification gap; fallout 1, because it affects development; probability 2, because an intentional or accidental duplicate is a specific developer setup. Score: 2, record.

### C2-05. MINOR. The device audit field is not carried through the named resume follow-up path.

Category: Design (audit provenance). Evidence status: confirmed missing propagation in the proposed edits. Responsible builder: client API unit 1b.

Scenario: The web caller resumes an interrupted agent. The initial command's events receive `device: open-web`. The subsequent reload commits session and lifecycle events using only the owner actor. Those events then appear to have come from the owner's terminal. E13 explicitly fixes this path for a service caller, but the parallel device context is omitted.

Evidence: `contract.md:1409` sets the device field in the command handler. Its durable append form accepts the full caller and optional device (`contract.md:1445`). The edit for reload forwards only `Caller` (`contract.md:1482`), whose device case is still the owner. The recorded resume passes only `actor` into reload (`packages/engine/src/commands/resume.ts:47`). Reload retains only that actor in its input (`packages/engine/src/recovery/reload.ts:104`) and uses it in both later appends (`packages/engine/src/recovery/reload.ts:134`, `packages/engine/src/recovery/reload.ts:138`). The original command handler discards the device identity when mapping to owner (`packages/engine/src/commands/CommandHandler.ts:205`).

Suggested fix: Carry the optional acting device alongside the caller into command-owned follow-up writes, or state an explicit narrower audit policy. Add a device-initiated resume case covering both successful and failed reloads, plus catch-up equality. Background work that is independently initiated by the engine can retain its own attribution.

Risk: severity 2, because the defect loses audit attribution; fallout 3, because one owner's history is affected; probability 6, because resuming an agent from the phone is an ordinary specific action. Score: 36, record.

## Risk register

All decisions below remain for the owner or lead. A review does not accept or defer a risk on their behalf.

| Id | Severity | Fallout | Probability | Score and band | Evidence | Responsible builder | Decision | Deadline | Acceptance or closing evidence |
|---|---:|---:|---:|---|---|---|---|---|---|
| C2-03. Owner-held board wait can hang. | 6 | 3 | 6 | 108, schedule | Confirmed contract conflict. | Client API unit 3. | Unset. | Within this phase, or a dated follow-up. | None. |
| C2-01. Oversized state events lack recovery. | 6 | 3 | 4 | 72, schedule | Confirmed plan gap. | Client API units 2, 3 and 7. | Unset. | Within this phase, or a dated follow-up. | None. |
| C2-02. Token rotation precedes its commit. | 6 | 3 | 4 | 72, schedule | Confirmed storage-pattern conflict. | Client API units 1b and 6b. | Unset. | Within this phase, or a dated follow-up. | None. |
| C2-05. Resume loses the acting device. | 2 | 3 | 6 | 36, record | Confirmed missing propagation. | Client API unit 1b. | Unset. | Review at phase end. | None. |
| C2-04. Uniqueness after merging is insufficient. | 1 | 1 | 2 | 2, record | Confirmed by a read-only probe. | Client API units 1a and 2. | Unset. | Review at phase end. | None. |

Each score's reasons are stated with its finding. The lead owns entries in `docs/issues.md` under this run's ruling; the reviewer has not edited that file.

## Proposed post-build checks

| Id | Scenario | Expected result | Required evidence | Responsible area |
|---|---|---|---|---|
| PC-01 | Hold publication between the database commit and views update, then snapshot on both sides. | The snapshot sequence comes from the same views value; subsequent subscription misses and repeats no transition. | A real snapshot/read/subscribe test with a controlled publication barrier. | Client API units 1a and 3. |
| PC-02 | Open a client wait while a member is working, then create an owner-addressed board question without making that member idle. | Exit 2 without waiting for an engine-settled candidate. | The public helper and CLI over a composed service; check the exit and retained open post. | Client API unit 3 and board. |
| PC-03 | Interrupt token installation and rotation after the secret-file write and before the log commit; interleave token clear, collection and another installation. | The committed active credential remains usable; collection removes no active or pending value needed by a committing command. | Fault injection at the real secret store and writer boundaries, followed by restart and a fake authenticated push. | Client API units 1b and 6b. |
| PC-04 | Send large control events after the initial snapshot, including one with no thread. | The page reconciles state, shows the actionable request, and reconnects without permanently skipping it. | Real encoded frames through the production browser bundle, with state assertions. | Client API units 2, 3 and 7. |
| PC-05 | Start the alert reactor on an old log while a new matter opens at its baseline boundary. | Old open matters are baseline-only; the new matter is pushed once logically, with the documented duplicate allowance. | A barrier around baseline initialization and a restart at each boundary. | Client API unit 6a. |
| PC-06 | Delay the carrier's send acceptance until after the subject clears, then fail a send during backoff and restart. | No new send begins for a cleared alert; send/clear ordering and retry records match the stated policy. | A controllable fake carrier and the persisted alert events. | Client API unit 6b. |
| PC-07 | Decode an unknown event and a known event from real frames, then reconnect; build and run the browser entry without Node shims. | Unknown tags advance the cursor; malformed known tags fail; Node behavior remains unchanged. | The E24/E25 frame tests and the E26 production browser test. | Client API unit 2 and web unit 7a. |
| PC-08 | Add a duplicate command before composition and resume an agent through a device caller. | The duplicate fixture fails; both resume phases retain the chosen device audit context. | The negative uniqueness fixture and live/catch-up/restart audit assertions. | Client API units 1a and 1b. |

## Noted, not filed

### Round 1 blocker and major folds

The following table accounts for every blocker and major in the supplied round 1 register. “Holds” means the revised planning decision addresses the earlier finding; it is not a claim that unbuilt code passes tests.

| Earlier findings | Fold checked | Assessment |
|---|---|---|
| Threat model Opus TM-1, the blocker. | Allowed client networks, proxy settings and negative remote-access steps (`contract.md:1020`, `plan.md:733`). | Holds as a plan. Caddy's documented defaults were checked on 2026-11-03. |
| Threat model Opus TM-2. | Other-user refusal with an explicit proxy user id (`contract.md:301`). | Holds. The known guard bypasses are not re-filed. |
| Threat model Opus TM-3; threat model Sol TM-3. | Fixed token slot, origin binding, transport restrictions and no redirects (`contract.md:871`). | The earlier arbitrary-reference leak is addressed. C2-02 concerns the newly selected slot's rotation lifecycle. |
| Threat model Opus TM-4; threat model Sol TM-1; critic C06. | Computer-side token ingress and E27 retention (`contract.md:1818`). | The missing command and restart keep-set are addressed. C2-02 is an additional failure window. |
| Threat model Opus TM-5. | E28 and criterion 1.41 (`contract.md:1841`, `plan.md:349`). | Reviewed as the recommended answer, exactly as instructed. Its pendency is not a finding. |
| Threat model Opus TM-6; logic LOGIC-14, which was minor. | E12's in-process open-web credential (`contract.md:1415`). | Holds. The socket cannot mint that shape under the named design. |
| Threat model Opus TM-7. | The explicit client command access and event visibility table (`contract.md:985`). | Holds. |
| Threat model Sol TM-2; architect A4's snapshot portion; logic Sol R2; critic C02; logic Opus LOGIC-4. | One views value and its own sequence, plus the wait-state section (`contract.md:1359`, `contract.md:429`). | Holds against `packages/engine/src/views/Views.ts:41` and `packages/engine/src/log/EventLog.ts:136`. |
| Threat model Sol TM-4; critic C01. | Root `pnpm check`, web/viewer discovery, JSX tests and browser setup (`decisions.md:119`, `plan.md:292`). | Holds as a lead-owned prerequisite. The recorded root script actually invokes Vitest (`package.json:13`); the setup change must still land. |
| Architect A1; logic Sol R1. | All engine after-commit hooks preserved in E3 (`contract.md:1200`). | Holds against the recorded start, stop, resume and permission paths. |
| Architect A2; critic C04. | E24 dispatches by the streaming command's tag (`contract.md:1769`). | Holds against the original hard-coded dispatch at `packages/client/src/index.ts:199`. |
| Architect A3; critic C05. | E25 tolerates unknown event payloads at the decoder boundary (`contract.md:1782`). | Holds as a plan. The pinned RPC source decodes chunks before application handling. |
| Architect A4's wait-input portion; architect A5; logic Sol R3; logic Opus LOGIC-1 and LOGIC-2. | Wait-state snapshot, shared `reasonOf`, and current any/all outcomes (`contract.md:598`, `contract.md:1631`). | The original missing inputs and terminal outcomes are addressed. C2-03 is the interaction introduced by the new owner-held board exit. |
| Architect A6; critic C03. | Inbound-only 1 MiB ceiling, one-item page exception and oversized markers (`contract.md:954`). | The impossible outbound bound is removed. C2-01 covers the marker's incomplete state-recovery contract. |
| Architect A7; logic Sol R4; critic C07; logic Opus LOGIC-5. | At-least-once delivery, recorded retries and explicit exhaustion (`contract.md:788`). | Holds. A duplicate is accepted; five failures are visibly final. This review does not reinterpret that as an unlimited delivery guarantee. |
| Architect A8. | Thread subject-panel ownership and board integration (`contract.md:830`). | Holds as a cross-plan assignment. The supplied consumers' version lag is not re-filed. |
| Critic C08. | Browser core/Node/browser split in E26 (`contract.md:1797`). | Holds against the original Node imports at `packages/client/src/index.ts:1`. Real browser evidence remains required. |
| Critic C09. | The VS Code exclusion is WIDENED and open (`decisions.md:59`, `decisions.md:129`). | Accounted for in known gaps, not re-filed. |
| Logic Opus LOGIC-3. | The level closing table and account-specific sources (`contract.md:674`, `contract.md:765`). | Holds. The stopped-asker engine gap is already disclosed. |
| Logic Opus LOGIC-6, LOGIC-7 and LOGIC-8. | Reactor baseline, durable source positions/refusals, recovery gate and write-failure policy (`contract.md:198`, `contract.md:1744`). | Holds as a plan. PC-05 checks the baseline boundary that needs implementation evidence. |

The other minor folds were also inspected. They now name read-mark callers, exact refusal writes, thread membership/indexing, scan checkpoints, the debug credential restriction, service reload attribution, sender wording, rollback and the missing security-document amendments. C2-05 is the remaining parallel device-attribution path.

The official [Caddy reverse-proxy defaults](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults) support the single-proxy header assumptions. The official [ntfy publishing documentation](https://docs.ntfy.sh/publish/#updating-deleting-notifications) supports sequence identifiers and notification deletion where the clients support them. Both were checked on 2026-11-03. The owner's actual proxy and ntfy version remain the plan's declared environment checks.

### Shared engine edits and consumers

| Edits | Recorded behavior and consumer need checked | Result |
|---|---|---|
| E1 and E10. | The fixed command group, CLI registry and command inventory tests; both consumers need generic namespaced commands. | Named changes and existing tests are present. C2-04 strengthens the uniqueness observation. |
| E2. | Credential-to-owner mapping, authorization before receipts, debug restriction and MCP exclusions. | The access/refusal change and existing authorization/parity tests are named. |
| E3 and E4. | Transactional planners, stored replies, engine hooks and separate reads with marks; the board needs fresh reads and deduplicated writes. | The hook regression is repaired. The named handler, lifecycle, permission, receipt and read tests are appropriate. |
| E5 and E6. | Closed event schemas, exhaustive state table, thread membership, views and rebuild guard. | Piece keep-rows and consumer view fields are accounted for. The existing state test derives tags dynamically (`packages/contracts/test/state-machine.test.ts:285`), so its unchanged expectations are feasible. |
| E7. | The migration list and side-row transaction path. | New piece table ownership is stated. Existing append and receipt tests are named. |
| E8 and E9. | The inline visibility filter, effective-holder read change, coherent snapshots and bounded consumer sections. | The changed three-generation visibility expectation is named. C2-01 concerns later marker reconciliation, not the coherent snapshot fix. |
| E11 and E12. | Actor/caller distinction, durable columns, shared row decoder and open-web identity. | Both consumers can record real authors without a service credential. C2-05 identifies the uncarried device context. |
| E13 and E14. | Per-service command lists, read dispatch and rule-attributed permission answers. | The stall watch's later `release` is explicitly owned by the roles plan. The standing-rule service has no `answer` command. The existing affected tests are named. |
| E15 and E16. | Sender wrapping, all three sender fields, failed-send returns and the piece-source rule. | The board's sender, completion and returned-wake needs fit the declared shapes. Named routing tests retain existing agent expectations. |
| E17 and E18. | Own-namespace withdrawal, projected queue-time reach, send-time withdrawal and continuing dispatch. | The board's membership check and wake replacement have the required inputs. The dispatch and account tests are named. |
| E19 and E20. | Engine settled/member functions and blocking request-held checks. | The board's delivery-status/view inputs fit. The roles' held queue remains unsettled through queued deliveries (`inputs/roles-plan.md:425`, `inputs/roles-plan.md:1065`). C2-03 concerns the client helper's additional refresh trigger. |
| E21 and E22. | Thread indexing, hidden agent-less envelopes and exported rights helpers. | Thread/read ownership agrees with consumers. The queued-delivery case is explicitly tested. |
| E23. | One piece batch path, projected checks, caller identity and exact refusal writes. | Board planners, marks and level reactors can use it. The roles' additional engine changes remain in its own units. New boundary tests are named. |
| E24, E25 and E26. | Original stream routing, strict RPC decode boundary and Node-only client entry. | Each original blocker to the promised client behavior now has a named edit and an appropriate test. |
| E27. | Account-only secret collection and special secret-command handling. | The existing restart test is named and the keep-set is extended. C2-02 requires the distinct fixed-slot write lifecycle to be decided. |
| E28. | Existing answer option checks and caller-kind propagation. | The proposed device restriction and permission tests are named. The review follows the instructed pending version. |

No additional existing test whose changed expectation must be named was identified beyond the paths already enumerated in section 6. This is an audit of the planned edits, not a prediction that no setup or fixture edits will be needed during implementation.

The ten-gate check found the source universe, workstream acceptance observations, risks, rollout and rollback, anchors, guardrails, sizing and mock prerequisites. The unfinished scopes, vendor allowance, widened extension exclusion, issue-list delegation and pending owner answer are disclosed known gaps. No new scope decision without an owner source was found beyond those disclosures. The approved `SECURITY.md` and `AGENTS.md` changes were read as supplied; their approved suspensions were not treated as defects.

### Execution record

Node.js 26.13.0 was selected with `nvm use`. The repository remained unchanged. The only runtime probe was the in-memory command-group merge above. No full build or test suite was run for this frozen-plan review, and no implementation pass is claimed. One initial installed-source lookup used this worktree's absent `node_modules/effect` path; resolving the module located the pinned source in the parent repository, where it was read successfully. The RPC-client web source lookup also returned a cache miss, so the pinned installed source was inspected instead. No probe files were created. The assigned scratch folder did not exist and needed no deletion. This result file is the sole written artifact. There were no policy refusals.
