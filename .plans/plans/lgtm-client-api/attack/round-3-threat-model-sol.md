revise
Grade: 7  B/M/m: 0/1/0  Flags: none

## Scope and result

I reviewed contract version 10 and its plan, decisions and scouting against engine commit `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. References to `contract.md`, `plan.md` and `inputs/` below are relative to this review run. Repository references are relative to the recorded checkout. I checked the prior findings, binding rulings, approved security-document changes, engine design and decisions, and known gaps. I compared the shared edits with board contract version 8 and roles plan version 10.

There is one new major design finding about the promised client wait flow. It is an ordinary correctness defect, not a new security violation. The earlier security fixes are coherent at the plan level. The oversized-event recovery also needs a specific post-build backpressure check. Its outcome depends on the new client implementation, so it is not counted as a confirmed plan defect.

The board and roles inputs precede contract version 10. Their missing folds are not findings. The pending answer to owner question 6 is not a finding. No security issue is proposed as a phase blocker.

## Finding TM3-1: The client cannot identify the committed batches on which its wait decision depends

**Severity:** MAJOR. **Category:** Design, with a timing bug as its consequence. **Responsibility:** Shared engine and client wait semantics; none of the six security responsibilities is violated by this scenario. **Responsible builder:** Client API contracts/backend and client-library builders, units 1 to 3. **Evidence status:** Confirmed missing protocol decision, with the existing reducer behavior checked by a local probe. The future helper has not been built or tested.

**Scenario.** Worker W is idle with its own unanswered question. An available agent lead L holds that question. The owner runs `lgtm client wait` for W. This is not the owner's own request-held exit: the holder is L. L answers. The answer closes the question and queues the answer delivery to W in one committed transaction. Between those two events, a client fold sees W as settled and can exit successfully before W receives or processes the answer. The engine's native wait does not resolve at that intermediate state.

This is reachable before the board or roles are installed. Their default entries are explicitly inert (`contract.md:1310` and `contract.md:1874`). Consequently, the piece-list rendezvous in `contract.md:731-746` does not require a read that would bring this particular client decision to a complete engine commit.

**Evidence.** The helper promises the engine's member rule and evaluates its engine part “after every batch it applies” (`contract.md:669-709`). E19 adds a shared fold and compares its state against the engine at every sequence (`contract.md:1861-1872`). Neither the stream contract nor E11/E12 defines how a client recognizes the end of a committed transaction. A remote procedure call (RPC) chunk is not specified to be a transaction.

At the recorded commit:

- `packages/engine/src/routing/questions.ts:25-34` orders `QuestionAnswered`, any withdrawal, and then the reply's `DeliveryQueued` in one planned batch.
- `packages/engine/src/routing/waits.ts:39-45` considers an idle agent settled when it has neither an open question nor queued/sent delivery. `withWaitChecks` evaluates the projected whole batch at `:110-117`. The handler passes the whole command batch through that function at `packages/engine/src/commands/CommandHandler.ts:269`.
- `packages/engine/src/views/Views.ts:41-44` publishes the whole batch into its in-memory reference atomically. `packages/engine/src/log/EventLog.ts:136-140` then publishes the individual envelopes to subscribers.
- `packages/contracts/src/events.ts:184-191` has a sequence and optional request identifier, but no commit-end sequence or batch terminator. `packages/engine/src/log/subscribe.ts:82-95` replays individual rows in pages and follows individual live envelopes. A request identifier alone cannot tell a client that no further event belongs to it.

A probe used the recorded `views/apply.ts` reducer, the repository's ready/question fixtures, and the settled predicate's recorded conditions. With the question held by L, it printed:

```text
before answer: settled=false, state=idle
QuestionAnswered applied: settled=true
DeliveryQueued applied: settled=false
```

This demonstrates why equality of the two folds at every sequence does not prove equality of wait completion. Both folds may correctly represent the same intermediate prefix, while only the client acts on it.

**Suggested fix.** Make the decision boundary explicit. Either carry a durable commit-end fence that survives replay, live streaming, filtering and oversized markers, and evaluate completion only at that fence, or require a coherent engine snapshot confirmation whenever the helper would return a terminal result, including when no piece has a view-dependent hold. Specify how a newer confirmation is reconciled with the stream. Neither option requires an owner `wait` command or polling.

**Existing tests and acceptance.** Preserve `packages/engine/test/routing/waits.test.ts:90-107`, W05, including its question case that waits through delivery and the answering turn. E19 already names that file and `packages/engine/test/acceptance/capability-05-wait.test.ts`; their existing expectations need not change. Add a real client-helper counterpart with L as holder, no board/roles sections, and a transport/page split between `QuestionAnswered` and `DeliveryQueued`. It must not return at the prefix. Check both “any” and “all”, live delivery and catch-up. Keep the per-sequence fold property test, but add this completion-boundary test.

## Risk register

The risk priority number is severity multiplied by fallout multiplied by probability. The owner decides whether to fix, accept or defer.

| Id | Severity | Fallout | Probability | Score and band | Evidence | Owner | Decision and deadline | Acceptance and closing evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TM3-1: A client wait can finish before the answer delivery in the same commit. | 6: A core promised result is wrong and requires the caller to wait again. | 3: One owner's wait is affected; rerunning it can recover. | 6: An idle worker's question answered by its lead is an ordinary specific action. | 108, schedule. | Confirmed protocol gap and reducer-prefix reproduction; future helper unbuilt. | Client API contracts/backend and client-library builders. | Owner decision pending. Within this phase, or a dated follow-up with an owner. | No acceptance or closing evidence yet. |

## Recheck of round 2's blocker and majors

These are plan-level closure assessments, not claims that the future implementation passes its tests.

| Fold and earlier findings | Assessment |
| --- | --- |
| Row 130: R2-L1, R2-A1, R2-TM-1 and the other live-collection reports. | Holds. E27 keeps collection at startup and removes only a specifically named carrier value at runtime. This avoids racing the account store-before-commit gap at `packages/engine/src/commands/accounts.ts:38-48`. Startup-only collection matches the existing seam at `packages/engine/src/commands/SecretStore.ts:13-15`. Criterion 1.39 names real writer/store barriers and extends restart test R22 at `packages/engine/test/recovery/restart.test.ts:606-628`. |
| Row 131: R2-A2, R2-L3, R2-TM-2 and exhausted-alert retries. | Holds. A delivery generation includes the applicable carrier/token change. An older completion cannot settle a newer generation. Carrier changes rearm open nonbaseline alerts; token changes rearm undelivered alerts. Retry continues at the cap. Duplicate sends remain accepted. |
| Row 132: TM2-1, approval without the action. | Holds. E29 carries redacted, bounded input for every tool kind, with absent/redacted/truncated states. The page shows it before Allow or shows the fixed warning. Automatic roles matching remains restricted to execute requests. Check rendering and adapter coverage after build. |
| Rows 133 and 134: TM2-2 and TM2-3, public/local proxy confusion and localhost. | Holds within the approved boundary. A proxy-user peer is always public, missing required headers fail the real-proxy check, and localhost is removed. The indistinguishable same-user proxy remains an explicit known gap. |
| Row 135: C2-03, owner-held changes missed while unsettled. | Holds. Named piece events trigger the list read independently of settlement. The new finding concerns engine commit prefixes, not these piece triggers. |
| Row 136: R2-A3, startup cannot enumerate a piece's open matters. | Holds. The per-piece `openMatters(views)` supplies the scan from the coherent views value. |
| Row 137: C2-01, R2-L2, R2-A2's oversized-read counterpart, and the snapshot/marker reports. | The missing recovery route is supplied: `client.event` can read a state event with no thread, and the cursor advances only after application. Request identity rows and bounded displays are specified. The receive-queue interaction is post-build check TM3-PB1 below. This does not refile loss of state without a recovery route. |
| Row 138: C2-02, token overwritten before commit. | Holds. Each stored value gets a fresh name, and only the committed event selects it. Origin confirmation, canonical origin validation and the reserved reference prefix also address the related minor findings. |
| Row 143: Logic Opus major 2, withdrawal strands a recovered agent. | Holds. The same batch returns the otherwise empty recovered target to idle before wait checks. Both dispatcher and reactor withdrawals are covered by criterion 1.43. |
| Row 144: Logic Opus major 5, resumed question loses its alert. | Holds. The level rule raises an alert again for the live asker; it does not try to restore a dead process's permission request. |

## Shared edit and consumer audit

I checked each E1–E29 against the recorded implementation and the consumers. I found no additional existing test expectation that must change outside the files named in section 6. This assessment does not replace the implementation diff audit required by criterion 1.1.

| Edits | Checked engine seam and consumer consequence |
| --- | --- |
| E1, E2 | The closed command/access lists at `packages/contracts/src/commands.ts:10-22`, and the receipt lookup at `packages/engine/src/commands/CommandHandler.ts:237-258`, require the proposed unified inventory and access-before-replay order. The derived Model Context Protocol tool list remains exactly pinned. Contract tests, CLI parity, authorization and compare-views tests are named. |
| E3, E4 | The planner/reply/hook and read split preserves the existing transaction and after-commit order, including no hook on replay (`CommandHandler.ts:255-270`). Reads with marks retain caller provenance and do not store page text in receipts. Handler, lifecycle, permission, receipt, compare-views and subscribe tests are named. |
| E5, E6 | Event-union, lifecycle, reducer and rebuild changes include piece events while keeping them out of engine threads. The recorded seams are `packages/contracts/src/events.ts:184` and `packages/engine/src/views/Views.ts:44`. The exhaustive event samples, round-trip, state-machine, apply, rebuild, compare-views and fixtures are named. |
| E7 | The migration and side-row seams are `packages/engine/src/log/migrations.ts:11` and `packages/engine/src/log/EventLog.ts:199-205`. Namespace-only tables do not grant a piece another piece's rows. Append and receipt tests are named. |
| E8, E9 | The present direct-child filter at `packages/engine/src/api/server.ts:155-159` is deliberately widened to the effective holder. The changed grandchild expectation in subscribe test 7.3 is expressly named. Building every snapshot section from the same views reference matches `Views.ts:41-44`; a SQL head would not provide that property. |
| E10 | CLI dotted-name expansion uses the existing registry at `packages/cli/src/commands/registry.ts:10`. Command-inventory and parity tests are named. |
| E11, E12 | The full caller and device must survive the old envelope and row paths (`packages/contracts/src/events.ts:184-191`, `packages/engine/src/log/subscribe.ts:82-89`). The migration, shared decoder, reserved device id and live/catch-up/rebuild equality are specified, with handler, authentication, per-request credential, append, gapless, receipt and rebuild tests named. |
| E13, E14 | Services use an in-process path and explicit rights; an inline permission answer records its rule. No service becomes an agent's parent or request holder. The existing permission planner's authorization/after-commit seam is `packages/engine/src/routing/permissions.ts:35-54`. Authentication, permission and event tests are named. |
| E15, E16, E17, E18 | The old sender wrapper covers only agents (`packages/engine/src/routing/envelope.ts:20-23`). The new wrapper covers every nonowner sender. Own-source withdrawal, projected reach at queue time and renewed reach at send time provide the board's required channel/post checks. Move-withdrawal, delivery, permission and event tests are named; the recovered-target case is new coverage. |
| E19, E20 | Board holds include queued and sent wakes and the owner-held list (`inputs/board-contract.md:392-447`). Shared pure predicates fit that consumer, but the client completion boundary needs TM3-1. Existing native wait and capability tests retain their expectations. |
| E21, E22, E23 | Paging includes the true delivery target; piece helpers do not bypass engine authorization. The batch path checks namespaces, engine-event allowlists, lifecycle transitions, reach and waits under one writer transaction. Its anchor is the existing whole-batch projection at `packages/engine/src/routing/waits.ts:110-117`. New fixture tests cover rejected planners, reads and reactors; event round-trip updates are named. |
| E24, E25, E26 | Current streams are hardwired to subscribe and share a connection (`packages/client/src/index.ts:195-219`). Per-tag dispatch, tolerant decoding before strict RPC decoding, and the browser entry address those constraints. Existing client expectations stay; new encoded-frame and import-boundary checks are specified. See TM3-PB1. |
| E27 | Startup retention adds the selected carrier reference without reintroducing runtime collection. The account/environment reserved-prefix checks must agree with the runner and collector. R22 and the new barrier test are named. |
| E28 | The proposed device-only restriction on persistent answers preserves the existing owner path. Existing permission tests keep their expectations; new caller-kind cases implement the proposed choice. Question 6 remains with the owner. |
| E29 | Every permission kind gains action display fields, while roles consume only qualifying execute input (`inputs/roles-plan.md:621-641`). Matcher rejection for unknown, missing, redacted or cut input remains compatible. The older roles execute-only transport wording is version lag, not a new defect. New runner field tests include old logs. |

The board's older WakeBuilt delivery-id wording and its earlier ownerHeld/open-matters integration must receive the stipulated version-10 folds. I did not count that lag as an incompatibility. No new lifecycle authority is needed for either consumer.

## Trace of the six security responsibilities

| Responsibility | Trace and assessment |
| --- | --- |
| Isolation | This is one owner's host, with an explicitly open web control surface. Agent visibility still follows the central function and current holder relation. Piece-specific visibility and namespace checks prevent accidental cross-piece grants. The approved open-server risk remains accepted. |
| Identity across sessions | Real device identifiers cannot be `open-web`; the synthetic caller has no disk or socket credential form. Caller/rule/device provenance survives replay. There is no web sign-out while the page is open. WireGuard peer removal and carrier-token rotation are the documented lost-phone actions; neither is represented as signing out of this page. |
| Access | Access precedes receipt replay. Fresh reads check current access. Service rights, web computer-only exceptions and the proposed persistent-answer restriction remain explicit. Agent text is data, including agent thread reads and nonowner deliveries. E29 improves informed approval without claiming to prevent deceptive action text. |
| Integrity | The log remains authoritative, snapshots use one views value, and piece writes use the checked transaction path. Fresh secret names and startup-only collection close the prior credential-loss race. TM3-1 is a temporary incorrect client conclusion; it does not corrupt stored data. |
| Confidentiality | Stored copies include the event log, receipt rows, derived views, secret file, browser memory and carrier-side notifications. Action input is redacted before storage; snapshots omit it. Alert bodies use fixed fields with bounded sanitized names. Historical logs, ordinary account environment values, unbounded agent counts and carrier-side deletion limits remain recorded gaps. There is no new deletion guarantee to review. |
| Secrets and dependencies | The token value is computer-set, origin-bound and stored separately from its selected reference. It does not follow a new server origin and cannot be selected through an account environment reference. Secrets at rest are the approved mode-600 plaintext file, accessible to the same operating-system user. Dependencies remain pinned; no runtime package fetch is proposed. Real proxy, adapter and carrier behavior still needs the named environment checks. |

Current primary documentation was consulted on 2026-11-03: [Effect RPC source](https://raw.githubusercontent.com/Effect-TS/effect/effect@4.0.5/packages/effect/src/rpc/RpcClient.ts), [Caddy reverse-proxy headers](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), and [ntfy publishing](https://docs.ntfy.sh/publish/). Documentation supports the available mechanisms; it does not certify the owner's actual proxy configuration or ntfy deployment. Existing PB-2 and PB-5 remain necessary.

## Proposed post-build checks

### TM3-PB1: Oversized recovery must not block its own connection's receive loop

**Owner:** Client-library and client API read/stream builders. **Scenario:** The client encounters a state-bearing oversized marker and requests `client.event` while later stream records arrive. Delay the unary response until more than the stream queue's capacity has arrived. Repeat for the wait helper's nested piece-status read.

**Required behavior:** The event is recovered and applied before later state, the cursor advances only then, and neither read stalls behind its own paused stream. Recovery must progress during busy catch-up and after reconnect. Raising a fixed queue size alone does not prove this.

**Why this check is necessary:** The current client reuses one connection for calls and subscriptions (`packages/client/src/index.ts:142-174`, `:195-201`). In the locally installed pinned Effect 4.0.5 source, `src/rpc/RpcClient.ts:350` defaults to a 16-item stream buffer, `:460` creates a bounded queue, and `:577-585` offers the chunk before acknowledging it. The socket receive loop processes responses serially at `:1115-1139` and `:1164-1168`. These dependency anchors are outside the recorded repository and were inspected read-only. The engine's existing chunk deadline is five seconds (`packages/engine/src/api/server.ts:142-145`).

A local `RpcClient.makeNoSerialization` probe serially offered 17 stream values before a pending unary result. It stopped after 16 with both the producer and unary read pending. Draining one value allowed the unary result, 42, to complete. This confirms the queue mechanism, not a defect in the future client. `contract.md:1143-1149` orders application, but does not require pausing transport consumption. A separate recovery connection or a bounded receive/drain design could satisfy it. This is why the concern belongs here rather than in the finding count.

**Evidence:** Extend `packages/client/test/oversized-state.test.ts` and criterion 3.8 with real encoded WebSocket frames, a state event over 256 KiB, a backlog beyond capacity, and the delayed reply. Demonstrate progress without a repeated deadline/reconnect loop. Also exercise cancellation during recovery and confirm that no incomplete cursor is persisted.

### TM3-PB2: Wait completion agrees at commit boundaries

**Owner:** Client API contracts and client-library builders. **Scenario and result:** Implement the TM3-1 acceptance case with the chosen fence or coherent confirmation. Compare the helper's terminal result with the engine's native wait after complete commits. Include no-piece operation, board hold lists, stopped/crashed precedence and replay boundaries. **Evidence:** Real client/helper integration results alongside unchanged W05 and capability-05 assertions; the per-sequence fold property alone is insufficient.

### TM3-PB3: Security folds remain effective through the real adapters and web page

**Owner:** Permission/backend and web builders. **Scenario and result:** An approval page restored from snapshot finds and displays the corresponding bounded action event before Allow. Missing, redacted, truncated and nonexecute tool inputs show their required state. A role matcher never treats those inputs as a qualifying shell command. A settings change closes existing web connections. Reserved carrier references are rejected by both account planning and runner resolution. **Evidence:** The named E27/E29 barrier/adapter tests and web criteria 5.16 and 7.12, plus PB-2/PB-4/PB-5 on the actual host. These are implementation checks of settled decisions, not new findings.

## Execution record

The repository remained read-only and clean at the recorded commit. Node.js 26.13.0 was selected with `nvm use`. I ran two small probes in the assigned scratch directory: the Effect receive-queue probe and the existing reducer prefix probe described above. Neither was a test of the unbuilt feature or an attack against a running service. No dependencies were installed, and no repository suite was run for this plan-only assignment.

Some initial source lookups used a dependency path absent from this worktree and an incorrect account-module path. I located the installed pinned dependency in the parent checkout and the account planner with `rg`, then checked the actual sources. Those lookup failures do not support findings. Temporary probe files and their assigned scratch directory were deleted before this result was written. No repository files, commits, pushes or team messages were produced.

## Refused

None.

## Noted, not filed

The owner-approved open server, same-user state access, deliberate ancestry-guard escapes, same-user proxy ambiguity, lasting settings, ordinary account environment exposure, alert redirection/dismissal, best-effort old-carrier sends, notification duplicates, retained log copies and unbounded agent counts are not new findings. Pending question 6 and the older consumer documents are not findings. A user deliberately bypassing their own configured limits is not a finding. No additional security-boundary defect was established in this review.
