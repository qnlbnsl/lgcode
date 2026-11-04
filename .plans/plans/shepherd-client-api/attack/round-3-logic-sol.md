revise
Grade: 7  B/M/m: 0/2/1  Flags: none

## Scope and evidence

This is the round 3 logic and failure-policy review of client API contract version 10, its plan, decisions and scouting. The consumer inputs are board contract version 8 and roles plan version 10. The recorded engine commit is `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`.

References to `contract.md`, `plan.md`, `decisions.md` and `attack/` are relative to the reviewed `api-r3/shepherd-client-api/` directory. References beginning `inputs/` are relative to `api-r3/`. References beginning `packages/` are to the recorded engine checkout. The owner rulings, approved security-document changes and known gaps bind this review.

There are two major gaps in otherwise local fixes. The filtered stream promises recovery that an allowed caller cannot perform. The owner wait promises evaluation after a committed batch, but the protocol cannot identify that boundary. A separate minor defect invalidates the snapshot's stated display bound.

## Findings

### R3-L1. MAJOR. An agent cannot recover an oversized state event from its allowed filtered stream.

Category: Design; Bug (failures). Evidence status: confirmed contract mismatch. Responsible area: client API contracts and client library.

`contract.md:1178` permits an agent to call `client.subscribe`. For any known state-bearing event over 256 KiB, `contract.md:1137` requires the client library to fetch `client.event`, apply the event before later events, and reconnect from before the marker if fetching fails. Both `contract.md:648` and the access table at `contract.md:1179` exclude agents from `client.event`.

A lead subscribes to its structural child, whose start event contains a 300 KiB initial prompt. That is a valid engine input: `packages/contracts/src/commands.ts:62` leaves the prompt unbounded, and `packages/engine/src/commands/start.ts:37` embeds its first delivery in `AgentStarted`. The recorded visibility rule allows a parent to read that child's events (`packages/engine/src/api/server.ts:155`). The filtered stream therefore supplies a state-bearing marker. Recovery is refused by caller kind. Following the specified failure policy repeats the same marker and prevents progress beyond it.

This is a consequence of the round 2 recovery fix, rather than a repeat of the original missing-recovery finding. The owner and device paths now have recovery. The newly specified recovery path is incomplete for another expressly permitted subscriber.

Suggested fix: decide the agent recovery path before building it. One option is agent access to `client.event`, with exactly the existing visibility check and an appropriate data envelope, followed by the corresponding reviewed tool-list decision. Another is an explicit recovery path through an already permitted read, provided it covers every state tag an agent can see and preserves the cursor rule. Skipping the event or widening visibility is not a repair.

### R3-L2. MAJOR. The owner wait has no durable way to distinguish an intermediate event from the end of a transaction.

Category: Design; Bug (timing). Evidence status: confirmed missing protocol decision, with a counterexample in the recorded reducer. Responsible area: engine event protocol and client wait helper, coordinated with roles.

The owner's helper evaluates its engine state after each batch (`contract.md:703`). A live member with an owner-held request causes exit 2 immediately (`contract.md:717`). Edit E19 has the client fold individual stream events into the same wait inputs and compare the fold with the engine at every sequence (`contract.md:1861`). That establishes reducer parity, but it does not identify when a transaction's intermediate states may be used to decide a wait.

The recorded engine deliberately evaluates complete batches. `packages/engine/src/views/Views.ts:44` updates the views with the whole batch. `packages/engine/src/log/EventLog.ts:133` then publishes its individual envelopes. The envelope has no batch identifier, size or ending sequence (`packages/contracts/src/events.ts:184`). Catch-up reads pages of 512 rows, which can split a transaction (`packages/engine/src/log/subscribe.ts:82`). Live delivery is also a stream of individual envelopes (`packages/engine/src/log/subscribe.ts:94`). The proposed envelope and durable-column changes do not add a transaction boundary (`contract.md:1466`, `contract.md:1622`). A remote procedure call (RPC) chunk or a page is not specified to be a database transaction.

There are two concrete counterexamples:

- A resumed agent has a single committed sequence of `SessionOpened`, `DeliveryQueued` for a carry-on, and `StateChanged working` (`packages/engine/src/recovery/reload.ts:89`). After the first event, its reducer state can be idle with no pending delivery. After the complete transaction it is working and has work queued. A client that evaluates the first prefix can finish its wait successfully too early. The engine checks only the complete projected batch (`packages/engine/src/routing/waits.ts:110`).
- The roles consumer deliberately writes `PermissionRequested` and a service's `PermissionAnswered` in one transaction. It suppresses routing and checks waits only once over both writes, so a rule-answered request never counts as held (`inputs/roles-plan.md:1034`, criterion 7.2 at line 1122). A stream prefix containing only the request makes the owner helper exit 2 for a request that was already answered at commit. A subsequent answer cannot undo a process exit. Reading board lists on named events does not resolve this engine-only early-exit case.

An in-memory probe using the recorded `apply` reducer confirmed the first intermediate state: `SessionOpened` produced idle/no pending delivery; adding `DeliveryQueued` produced idle/pending; adding `StateChanged` produced working/pending. This is evidence about the recorded reducer and the missing contract boundary, not a claim that the unbuilt helper has been executed.

Suggested fix: define a durable commit boundary that survives catch-up pagination, filtering, reconnect and RPC chunking. For example, carry a transaction ending sequence and enough boundary information for each subscriber to know that its complete visible batch has arrived. Buffer and evaluate waits only at that boundary. Define snapshot and checkpoint behavior consistently. Alternatively, specify an authoritative complete-state read before a terminal wait decision. Do not infer a transaction from a change in `requestId`: the roles transaction expressly contains two writes with different callers, and a final write need not be followed promptly by another event.

### R3-L3. MINOR. The snapshot's 4 KiB display bound leaves option identifiers and kinds unbounded.

Category: Design. Evidence status: confirmed counterexample. Responsible area: client snapshot contracts and projection.

`contract.md:473` limits a display part to eight options and cuts each option name to 128 bytes. It retains each option's `id` and `kind` without a bound, then concludes that the display part is at most 4 KiB. The recorded schema allows any nonempty option identifier and any kind string (`packages/contracts/src/events.ts:38`). The adapter checks option identifiers for secret content, but does not impose a size bound (`packages/engine/src/runner/AcpRunner.ts:405`).

A schema-valid option with an 8,192-character identifier, name `Allow`, kind `allow_once` and `persistent: false` produces 8,255 encoded JSON bytes for those four retained fields alone. I checked that counterexample with the recorded schema. One option already exceeds the claimed bound. Increasing the fixture team does not prove a bound over this input space.

The immediate consequence is an unreliable response-size budget, rather than lost records or an authorization bypass. The event can still be read whole. This is narrower than the original round 2 oversized-state defect and the accepted lack of an agent-count cap.

Suggested fix: bound the actual encoded display part. Omit options or the whole display part when it cannot fit, while keeping request identity and the full-event read. Another option is an explicit compatible input-schema limit. Do not truncate an actionable identifier and treat the truncated value as the original identifier. Measure encoded JSON, including escaping, rather than only source-string bytes.

## Interacting-rule truth table

| Conditions | Required result | Review result |
| --- | --- | --- |
| Owner or device receives a known state marker and its whole-event read succeeds. | Apply it before later events and advance the cursor afterward. | The round 2 repair supplies this path. |
| Agent receives the same class of visible marker. | Recover without widening read rights. | Recovery command refuses this caller. R3-L1. |
| A transaction contains a request and its automatic answer. | No owner-held exit from the intermediate prefix. | The helper lacks a transaction boundary. R3-L2. |
| A reload transaction opens a session and queues carry-on work. | Wait remains open while the committed state is working. | An intermediate prefix can look settled. R3-L2. |
| One snapshot option has an identifier larger than 4 KiB. | Preserve identity while keeping the display bound. | The specified projection exceeds its bound. R3-L3. |
| Carrier changes with an old token and an old-carrier warning pending. | Keep the previous token until the bounded old-carrier attempts end. | The explicit lifetime rule at `contract.md:842` supplies precedence. No new finding. |
| Carrier destination changes versus token-only rotation, with a late old result. | Destination generation governs delivery; token rotation restores pending attempts without accepting an old-generation result. | The generation rules at `contract.md:925` cover the distinction. |

## Round 2 fold audit

Every blocker and major from the round 2 fold table was checked. The following groups cover the duplicated reports as well as the independent findings.

| Earlier findings | Result in contract version 10 |
| --- | --- |
| Sol logic R2-L1; architect R2-A1; Sol threat R2-TM-1; Opus logic Major 1. | The runtime collection hazard is removed by startup-only collection and narrow carrier-value deletion. E27 at `contract.md:2058` preserves the existing store-before-commit lifecycle (`packages/engine/src/commands/SecretStore.ts:13`). Criterion 1.39 names the barrier test. No repeat finding. |
| Architect R2-A2; Sol logic R2-L3; Sol threat R2-TM-2; Opus logic Major 3. | Delivery generations, token-change retry restoration and continuing capped retries distinguish replacement from exhaustion (`contract.md:925`). Criterion 6.11 tests the transitions. No repeat finding. |
| Opus threat TM2-1. | E29 carries the action and flags, with a fixed warning when it cannot be shown (`contract.md:2119`). No repeat finding. |
| Opus threat TM2-2 and TM2-3. | Proxy-user peers are public, forwarded headers are refused with proxy mode off, and the local address is explicitly 127.0.0.1 (`contract.md:1223`, `contract.md:328`). No repeat finding. |
| Critic C2-02. | Fresh token names are selected by committed events; origin is part of the request (`contract.md:1021`). Failed commit preserves the earlier selected value. No repeat finding. |
| Critic C2-03. | Named stream events trigger piece-list reads, fixing the settled-only trigger (`contract.md:703`). R3-L2 concerns the separate absence of an engine transaction boundary. |
| Architect R2-A3. | Per-piece `openMatters` supplies the first-start scan (`contract.md:855`). No repeat finding. |
| Critic C2-01; Sol logic R2-L2; Opus logic Major 4. | Whole-event recovery and identity/display separation address the original state-loss scenarios (`contract.md:470`, `contract.md:1137`). R3-L1 identifies a caller excluded from that recovery. R3-L3 identifies a residual bound error. |
| Opus logic Major 2. | E17/E18 explicitly add idle in the transaction when withdrawing the last recovered queued item (`contract.md:1803`). This addresses the working-with-no-delivery counterexample. |
| Opus logic Major 5. | The resumed-question level rule re-raises the alert while the question is still open (`contract.md:912`). No repeat finding. |

## Shared engine edits and consumer audit

The static audit covered E1 through E29, including their named existing tests. No additional confirmed omission of an existing test was found through this lens. This is not a claim that those tests ran or that the planned implementation passes them. The missing cross-component scenarios are listed below.

| Edits | Recorded behavior and consumer fit |
| --- | --- |
| E1–E4 | The current group, explicit Model Context Protocol (MCP) tool list, command dispatch, receipt replay and subscription special case were checked at `packages/contracts/src/commands.ts:44`, `packages/mcp/src/tools.ts:6`, `packages/engine/src/commands/CommandHandler.ts:67`, line 237, and `packages/engine/src/api/server.ts:153`. The proposed access-before-receipt check and fixture tables give board and roles a shared path. The read/recovery exception is R3-L1. |
| E5–E7 | The event union, lifecycle rows, reducers, rebuild coverage, migrations and transactional side rows are the extension points described by the plan (`packages/contracts/src/events.ts:184`, `packages/engine/src/views/Views.ts:44`, `packages/engine/src/log/migrations.ts:11`, `packages/engine/src/log/EventLog.ts:199`). The plan names the existing tag-inventory, visibility, view, rebuild, compare, fixture, append and receipt tests. Piece events must stay out of engine threads; roles lifecycle events need explicit engine rows. |
| E8–E10 | The extracted visibility rule matches the current structural-child rule (`packages/engine/src/api/server.ts:155`). Atomic snapshots use the same views value. The current command-line registry derives names from the group but parses at most two words (`packages/cli/src/commands/registry.ts:10`, line 35); E10 explicitly changes dotted names and names inventory/parity tests. |
| E11–E14 | Caller migration, acting-device propagation and the service answer path are explicit. They address today's restricted caller decoder (`packages/engine/src/log/subscribe.ts:38`), caller key (`packages/engine/src/log/EventLog.ts:116`) and reload actor (`packages/engine/src/recovery/reload.ts:104`). The roles request-plus-answer transaction exposes R3-L2. |
| E15–E18 | Sender preservation, piece delivery sources, withdrawal and queue/send reach checks fit board wake replacement and the existing delivery-return behavior (`packages/engine/src/routing/deliveries.ts:45`, line 61, line 73). The recovered last-item idle amendment is necessary and is now explicit. |
| E19–E23 | The shared predicates and rights helpers correspond to `packages/engine/src/routing/waits.ts:33`, line 110, and `packages/engine/src/routing/holders.ts:21`, line 35. The batch path has refusal and source-position ownership. Predicate parity alone does not repair R3-L2. Board owner-held lists remain distinct from engine rows. |
| E24–E26 | The current client hardwires stream calls to `subscribe` (`packages/client/src/index.ts:190`, line 219) and imports Node facilities (`packages/client/src/index.ts:1`). Stream-specific dispatch, tolerant decoding before strict event decoding, and the browser/core split address those constraints. The agent recovery path remains incomplete. |
| E27–E29 | Startup collection, account-secret write order, permission options and runner permission fields were checked against `packages/engine/src/commands/SecretStore.ts:13`, `packages/engine/src/commands/accounts.ts:38`, `packages/engine/src/routing/permissions.ts:31`, and `packages/engine/src/runner/AcpRunner.ts:400`. Tool input remains outside snapshot/request projections. E29 intentionally supersedes the roles input's older execute-only wording. |

## Risk register

Scores use severity × fallout × probability. Decisions belong to the owner. No acceptance or closure is asserted.

| Finding | Severity and reason | Fallout and reason | Probability and reason | Product and band | Evidence; responsible owner | Decision; deadline; closing evidence |
| --- | --- | --- | --- | --- | --- | --- |
| R3-L2 | 6: a core wait can terminate incorrectly and must be run again. | 3: affects one owner's wait and is reversible by that owner. | 6: reload and automatic permission answers are ordinary specific operations. | 108; Schedule. | Confirmed contract gap; engine event protocol and client API builders, with roles. | Unset; within this phase or a dated follow-up; no closing evidence. |
| R3-L1 | 6: a permitted stream cannot progress through the required recovery path. | 3: one subscriber can change its input or use another authorized stream. | 4: requires an uncommon large state event, with no second fault. | 72; Schedule. | Confirmed; client API contracts and client library builders. | Unset; within this phase or a dated follow-up; no closing evidence. |
| R3-L3 | 2: the stated display-size budget is unreliable. | 3: affects one snapshot and is reversible by changing the projection. | 4: requires uncommon but valid harness option metadata. | 24; Record. | Confirmed schema/projection counterexample; client snapshot builder. | Unset; review at phase end; no closing evidence. |

Acceptance fields are not applicable because none of these findings has an owner acceptance.

## Proposed post-build checks

These checks verify the fixes and their implementation. They do not defer the missing decisions in R3-L1 and R3-L2.

| Stable identifier | Scenario and expected result | Required evidence | Responsible area |
| --- | --- | --- | --- |
| R3-PB-01 | An agent subscribes to its child through `client.subscribe`. A visible start/request exceeds 256 KiB, followed by an ordinary state event. Recovery succeeds once, applies events in order and resumes without gaps. A sibling remains unreadable. | Real encoded RPC traffic using an agent credential, cursor assertions, and refusal of the sibling read. | Client API and client library. |
| R3-PB-02 | Split a reload transaction after `SessionOpened`, and a roles automatic-answer transaction after `PermissionRequested`. Deliver the prefixes separately during catch-up and live operation. The owner wait neither succeeds nor exits 2 on a prefix. | Actual transport frames, a catch-up page-boundary case, complete-batch wait results and a disconnect/reconnect between the two parts. | Engine protocol, client wait helper and roles. |
| R3-PB-03 | Build snapshot display rows with long option identifiers/kinds and heavily escaped or multibyte labels. Every display part meets its actual encoded bound, and approval reads the original identifier from the full event. | Schema-valid inputs, measured encoded replies and an answer using the original identifier. | Client snapshot and web client. |
| R3-PB-04 | Hold a large state-event fetch on a slow connection while later stream events arrive. Do not advance the applied cursor before the fetch succeeds. Reconnection must preserve ordering without repeatedly losing state. | Real frame/chunk acknowledgment timing and resulting client state, rather than sums of payload constants. | Client library and transport. |
| R3-PB-05 | Withdraw and replace a board wake while roles holds the target's capacity queue. Repeat across restart and then withdraw the last queued wake. Dispatch and settlement honor the hold even when the queue becomes empty. | Persisted events, rebuilt views, engine wait result and owner-helper result at the same complete-state boundary. | Board, roles and shared wait integration. |
| R3-PB-06 | Change carrier origin while its old-carrier warning needs a token; race the normal cleanup worker with warning retries. Keep the old value until those attempts end, remove it afterward, and preserve the new active generation. | Worker barriers, token-resolution observations without secret values, and deletion assertions. | Alert carrier and secret lifecycle. |

## Noted, not filed

The explicit old-carrier lifetime rule is compatible with the general instruction to remove a value after a clear commits. Removal after its bounded attempts is also after commit. I therefore did not file the initially suspected cleanup conflict. R3-PB-06 checks that the implementation preserves the specified ordering.

The consumer inputs deliberately precede contract version 10. New E29 permission fields, board owner-held change tags and the source-id amendment require consumer folds, but their documented version lag is not itself another defect. The approved open-web authentication posture, same-user proxy limitation, pending owner question 6, unbounded agent count and accepted provider limitations are not reopened here. No money base or period applies to this plan. Retry periods, generation ownership, source positions, failure refusal and recovery lifetimes were the corresponding logic checks.

Official service/library documentation was checked on 2026-11-03: [ntfy publishing](https://docs.ntfy.sh/publish/#updating--deleting-notifications), [ntfy subscription API](https://docs.ntfy.sh/subscribe/api/), and [Effect 4 RpcGroup documentation](https://effect.website/docs/v4/api/effect/rpc/RpcGroup). Claims about the pinned Effect 4.0.5 implementation were also checked against its installed source, including group merging at `rpc/RpcGroup.ts:269` and RPC chunk decoding at `rpc/RpcClient.ts:733`. Current documentation was not treated as proof of a different pinned version.

Validation used Node.js 26.13.0 after `nvm use`. The first reducer probe could not resolve the worktree's workspace package. An in-memory Node resolver hook then mapped that package to the recorded checkout and Effect to the installed pinned 4.0.5 dependency; the probe succeeded without creating files. Some exploratory searches used nonexistent candidate filenames; resolving source paths from the repository inventory corrected those searches. No application test-suite result is claimed. The recorded checkout remains clean. The assigned scratch directory was never created and is absent. No repository edits, commits, board actions or external messages were made.
