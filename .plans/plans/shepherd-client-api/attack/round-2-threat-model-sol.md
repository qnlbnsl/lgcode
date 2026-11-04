revise
Grade: 7  B/M/m: 0/2/0  Flags: none

## Scope and disposition

This reviews client API contract v8 and its plan at engine commit `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. References to `contract.md`, `plan.md`, and `attack/` are relative to this plan bundle. Repository code references are to the recorded commit.

The round 1 folds substantially repair the plan. Two interactions still need a decision: secret collection during normal operation, and retry exhaustion across credential rotation. Both are fixable within the existing units. This verdict does not turn either into a security veto. Team rule 8 directs the lead to record security fixes in `docs/issues.md` and notify the manager for the owner's attack to-do list. The reviewer has not edited those files or sent a separate message.

## Findings

### R2-TM-1. Runtime secret collection can remove a newly committed account credential

**MAJOR. Category:** Security (integrity; secrets), Design. **Responsibilities:** integrity, secrets and dependencies. **Evidence status:** confirmed plan omission, with a counterexample using the existing primitives; no runtime reproduction claimed. **Builder:** shared engine unit 1b.9 / E27, with client unit 6b.2.

**Scenario.** An alert token is cleared. The alert worker starts the E27 collector and captures a keep set K. Meanwhile, the owner successfully runs `accounts set-secret`, which stores a new reference R and commits the account event naming it. The worker then calls `retainOnly(K)`. R was absent from K, so collection deletes the newly stored value. The account view now points to a missing credential. Collection can also fall between the secret write and its event commit. The command can succeed in either interleaving while leaving authentication broken until the owner supplies the credential again.

**Evidence.** `contract.md:1818-1835` moves the startup collector into a shared module, adds piece references, and explicitly makes the alert worker call it after a token clears. It also says that accounts have no behaviour change. The existing collector builds references from `views.snapshot` and subsequently calls `retainOnly` without a writer transaction (`packages/engine/src/recovery/restart.ts:139-147`). `accounts set-secret` deliberately writes its fresh reference before committing the event (`packages/engine/src/commands/accounts.ts:38-49`). Its comment promises never to leave a committed reference without a value. `SecretStore` serializes individual file mutations, but `retainOnly` receives a previously computed set and filters the latest file using it (`packages/engine/src/accounts/SecretStore.ts:49-64`). That file semaphore cannot protect the interval between the views read and collection. Startup gating previously avoided this particular overlap; the new runtime invocation removes that protection.

A closely related clear-then-set race can remove a newly written carrier token from the fixed slot. Origin binding does not solve collection ordering.

**Suggested fix.** Specify one ordering for reference capture, collection, and all secret-setting commands. For example, compute the current keep set and prune while holding the same writer exclusion that covers secret writes and their event commits. An equivalent protocol that protects in-progress references is acceptable. Do not hold that exclusion across an outbound push. A stale keep set must never be passed to a later destructive prune after another secret-setting transaction has progressed.

E27 already names `packages/engine/test/recovery/restart.test.ts`, test `6.7 R22 issue 119` at lines 606-626. Preserve its abandoned and replaced secret checks and the planned token-retention checks. Add deterministic runtime interleavings around snapshot capture, `put`, append, and `retainOnly`; the existing restart-only extension cannot establish this property. Record this new security issue through the lead under team rule 8.

### R2-TM-2. Replacing a revoked token has no defined recovery for exhausted alerts

**MAJOR. Category:** Design; Bug (failures). **Responsibility:** secrets and dependencies, specifically provider revocation and recovery. **Evidence status:** unresolved transition in the contract. **Builder:** client unit 6b.1 and 6b.2.

**Scenario.** The provider revokes a token, or the owner enables authentication before setting a valid token locally. An open approval alert fails five sends and becomes final. The owner then repairs the credential with `client.alerts.carrier.set-token`, keeping the same server and topic. Under the written pending predicate, the original alert still has five attempts since the carrier last changed. It remains undelivered, including after restart, although new alerts can use the repaired credential. An approval can therefore remain waiting without the notification that the credential repair was intended to restore.

**Evidence.** `contract.md:794-819` defines pending as fewer than five attempts since the carrier last changed, makes the fifth failure final, and rearms alerts when the carrier is set. `contract.md:884-899` separately defines token replacement and its `client.AlertCarrierTokenSet { origin }` event, and expressly says a revoked token makes attempts fail. Neither section says that this token event resets the attempt budget or rearms exhausted alerts. Attempts carry a carrier name and number (`contract.md:751-757`), with no stated credential generation. Reading “carrier last changed” to include token rotation could resolve the first ambiguity, but the contract must say so and define how an old in-flight result interacts with the new budget.

**Suggested fix.** Define a durable delivery generation or equivalent retry reset on successful token replacement for open, non-baseline, undelivered alerts. Specify whether old failures and late old-generation completions count, and keep the reset stable across restart. Previously delivered alerts need not be resent merely because credentials changed. If intentional finality across token repair is the desired product behaviour, give the owner an explicit retry operation and document the repair path. Merely retrying five times with the old credential does not supply that operation.

Add a test for five authorization failures, token replacement on the same origin, and recovery of the original alert. Restart immediately before and after replacement, and delay an old send result across replacement. This is an ordinary recovery gap, distinct from the accepted ability of an open-web caller to redirect or silence alerts.

## Risk register

The scores rank work; they do not override the owner's security deferral. Decisions remain the owner's. No finding is closed by a proposed test.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Responsible builder | Decision and deadline | Closing evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R2-TM-2 | 6: an owner-needed notification remains broken until manually repaired | 3: the owner can repair or explicitly retry it | 6: credential replacement after provider rejection is an ordinary, specific recovery action; the unresolved transition is scored at its worst plausible probability | 108, Schedule | Unresolved contract transition | Client 6b | Owner decision unset. Resolve within this phase or assign a dated follow-up and owner. | None |
| R2-TM-1 | 6: account authentication breaks until a replaceable credential is supplied again | 3: one installation, repairable by its owner | 4: one adverse overlap between runtime collection and a secret-setting transaction | 72, Schedule | Confirmed ordering omission in the plan and existing primitives | Shared engine 1b.9 and client 6b.2 | Defer under team rule 8. Lead records the issue and manager note; an individual follow-up owner and date remain to be assigned. | None |

## Round 1 blocker and major folds

The following covers every blocker and major in `attack/round-1-findings.md`. “Holds” means that the revised plan specifies the needed boundary or behaviour; implementation remains subject to the proposed checks.

| Original findings | Assessment of the fold |
| --- | --- |
| Opus threat model TM-1 | Holds at plan level: the proxy example binds the WireGuard address, restricts client networks, and uses computer-only configuration with no permissive default. The real proxy remains the acknowledged post-build check. |
| Opus threat model TM-2 | Holds: another local user is accepted only as the configured proxy user in proxy mode. |
| Opus threat model TM-3; Sol threat model TM-3 | Holds as a stated outbound boundary: a fixed token reference, origin binding, clear on origin change, restricted transport, no redirects, and a response-size bound. Concurrent rotation and sending still require implementation checks. |
| Opus threat model TM-4; Sol threat model TM-1; critic C06 | Startup retention and an owner-only token setter are now specified. R2-TM-1 identifies the new runtime collection interaction introduced by this fold. |
| Opus threat model TM-5 | E28 states a conservative rule for persistent, unknown, and settings-writing options. The pending owner answer is already recorded and is not a new finding. |
| Opus threat model TM-6 | Holds: E12 defines the in-process open-web credential, excludes a wire representation, and reserves its device id. |
| Opus threat model TM-7 | Holds: section 5 gives access entries, owner-only client events, and tool exclusions for streams and secret setters. |
| Architect A1; logic Sol R1 | Holds: E3 preserves all engine after-commit actions and their ordering, including permission delivery; pieces cannot supply that hook. The current hook executes after append (`packages/engine/src/commands/CommandHandler.ts:269-279`). |
| Sol threat model TM-2; logic Sol R2; critic C02; logic Opus LOGIC-4 | Holds: E9 reads one views value and its own sequence, rather than joining a database head with an in-memory view. Publication is separate from commit (`packages/engine/src/views/Views.ts:41-44`; `packages/engine/src/log/EventLog.ts:136-140`). |
| Architect A2; critic C04 | Holds: E24 replaces the generic client's hard-wired engine subscription with dispatch by command tag. The present client routes streams through that helper (`packages/client/src/index.ts:199,218-219`). |
| Architect A3; critic C05 | Holds: E25 puts the tolerant wire representation before the typed event decoder. This is the correct boundary for Effect RPC chunk decoding. |
| Architect A4-A5; logic Sol R3; logic Opus LOGIC-1-2 | Holds: the snapshot includes wait inputs and E19 shares `holds`, `settled`, `reasonOf`, and any/all outcomes. These are distinct existing rules (`packages/engine/src/routing/waits.ts:33-59,83-92`). |
| Architect A6; critic C03 | Holds: the 1 MiB limit is inbound, old large events get a whole-event page escape and stream marker, and a 4 MiB snapshot fixture is named. |
| Architect A7; logic Sol R4; critic C07; logic Opus LOGIC-5 | Holds for restart/crash policy: attempts and backoff are durable, delivery is at least once, and duplicates are accepted. R2-TM-2 concerns the separate credential-repair transition. |
| Architect A8 | Holds: the client subject-panel registry and board-owned entry provide a route to the post. Consumer version lag is not refiled. |
| Sol threat model TM-4; critic C01 | Holds: the gate is root `pnpm check`, with evidence that tests ran, plus the lead's web/viewer and TSX test discovery setup. The current root command includes the runner (`package.json:13`); current discovery is explicitly configured (`vitest.config.ts:4,26`). |
| Critic C08 | Holds: E26 provides a browser-safe core and separate Node/browser entries while preserving the existing Node root entry. |
| Critic C09 | Recorded WIDENED and open as instructed. No new allegation or blocker. |
| Logic Opus LOGIC-3 | Holds: the closing table handles stopped askers, agent recovery, both account levels, and dismissal. The surviving engine question row is an acknowledged engine issue. |
| Logic Opus LOGIC-6-8 | Holds: baseline startup, refusal source sequence, stopping on log-write failure, recovery readiness, and HTTP 503 before readiness are explicit. |

## Shared engine edits and consumer requirements

All E1-E28 were reviewed as changes to the recorded engine, including the existing-test update lists in section 6. The material new regression is E27's claim of no account behaviour change despite introducing concurrent collection.

| Edits | Boundary and consumer assessment |
| --- | --- |
| E1-E7, E10 | Explicit command/event inventories, namespaced extension, planner/read exclusivity, preserved engine hooks, typed lifecycle rows, piece views, migrations, side rows, and command-line registration supply the board and roles extension points. Default piece entries refuse or contribute nothing until replaced. Existing enum, authorization, lifecycle, receipt, view, and visibility tests are named. |
| E8-E9, E21 | One current-view visibility rule and one snapshot value serve reads and streams. Durable thread indexing includes nested queued-delivery targets and excludes unrelated piece events. Board snapshot summaries remain bounded and omit post text and agent sections. The changed grandchild visibility expectation is expressly named rather than silently weakened. |
| E11-E14 | Caller, acting device, service rule, durable columns, and one row decoder preserve attribution across live/catch-up/rebuild. Services have an internal allowlist and no wire credential. Roles can write rule attribution inside the permission transaction without receiving a general service right to `answer`. |
| E15-E18 | Piece and service text receives the data envelope; author headers use authenticated identity. Withdrawals are limited to a piece's own queued source. Reach checks use projected state at queue time and current transactional state at send time, including deliveries with no caller. Withdrawal continues dispatch and reruns wait checks. This supplies the board's delivery contract without granting management rights. |
| E19-E20 | Shared terminal outcomes and per-piece hold/request-held hooks supply the board's unsettled and blocking-wait clauses. Delivery status remains available to the board condition. The roles capacity hold does not require a second, independent roles hold registry. |
| E22-E23 | Pure rights helpers and the checked batch path constrain planners, marks, and reactors. Own namespace, projected lifecycle checks, withdrawal ownership, reach, and wait checks apply atomically. Refusal writes and recovery gating are now explicit. Roles adds its engine `release` command in its own unit rather than bypassing these rules. |
| E24-E26 | Command-specific streaming, tolerant wire decoding, and the browser entry close the three client-library integration defects. |
| E27-E28 | The startup retention and device-answer boundaries are specified, with existing restart and permission tests named. Runtime collection needs R2-TM-1. E28's pending decision is already disclosed. |

## Security responsibility trace

| Responsibility | Result |
| --- | --- |
| Isolation | Owner-only client records and common visibility rules are specified. Open-web callers deliberately share the owner's authority. This is the accepted single-owner design, not evidence of isolation between separate authenticated people. |
| Identity across sessions | This phase has no web sign-in or sign-out. The stored-copies and lost-phone sections correctly rely on proxy/network access and provider steps. The page promises no thread data in browser storage. Later pairing must revisit retained records. |
| Access | Host/origin checks, proxy user and network checks, the same-machine guard, caller-kind access before receipt replay, and internal-only service credentials state the required boundaries. The guard's bypasses and the open server remain accepted. |
| Integrity | One snapshot value, atomic batch checks, durable attribution, and replay rules are specified. Runtime secret pruning introduces R2-TM-1. |
| Confidentiality | Transport restrictions, bounded fixed push text, redaction, browser rendering policy, and the inventory of server/phone/browser copies are explicit. The shared Unix identity and readable local state remain accepted. Notification clearing is best effort, not erasure of all stored copies. |
| Secrets and dependencies | Fixed-slot access and origin binding address secret substitution. Provider revocation exposes R2-TM-2. Existing Effect RPC behaviour was checked against version 4.0.5 source; this review requests no dependency change. |

## Proposed post-build checks

These checks verify implementation. They are not substitutes for deciding the two lifecycle rules above.

1. Exercise every caller/command pair, including service allowlists, external attempts to acquire service/open-web credentials, and owner-only command replay through an owner's existing receipt. Cover every E28 option kind and settings-write request. Compare live, catch-up, and rebuilt caller/rule/device attribution after restart.
2. Hold view publication after a log commit and check snapshot-plus-stream continuity. Change the effective holder during live and catch-up reads. Check the last scanned checkpoint through hidden events, group filters, and oversized events.
3. Run board reach checks against same-batch projected changes and against membership changes before dispatch. Verify withdrawal continues with the next delivery and updates waits. Verify service/piece envelopes, fixed author headers, board unsettled clauses, and roles capacity/release integration.
4. After resolving R2-TM-1, pause collection and secret writes at each relevant boundary. Preserve newly committed account references and a newly reset carrier token. Retain the original R22 abandoned/replaced-secret cases and restart retention cases.
5. After resolving R2-TM-2, exhaust attempts with provider rejection, replace the token, and restart on either side of the reset. Cross an in-flight send with token rotation and an origin change; inspect which origin receives which token and which generation accepts the result. Check no token appears in events, receipts, errors, redirects, or response logs. Verify timeout and response limits.
6. On the owner's actual proxy and host, test the documented Host/Origin/forwarded-address truth table, proxy user restriction, missing headers, allowed networks, local-address rejection, and restricted `/proc` behaviour. Check settings changes against already-open connections as well as new requests. Keep these distinct from the accepted absence of web authentication.
7. On the owner's ntfy version, verify sequence-id replacement and deletion, best-effort clear failure, and accepted duplicate behaviour. Inspect fixed notification text and links, browser storage, Markdown/link rendering, full request text before Allow, and the page content policy. A cleared notification must not be presented as proof that upstream or phone copies were erased.

## External evidence and review execution

Checked on 2026-11-03. Effect RPC decodes chunks before passing values to the client queue, supporting the E25 placement requirement: [Effect 4.0.5 RpcClient source](https://github.com/Effect-TS/effect/blob/effect%404.0.5/packages/effect/src/rpc/RpcClient.ts), lines 733-755. Context7's broad results did not establish that version-specific claim, so the exact installed 4.0.5 source and official source were inspected. No dependency was installed or changed.

[Caddy's documented proxy defaults](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults) explain forwarded-header handling; they do not prove the owner's deployment. [ntfy's publishing documentation](https://docs.ntfy.sh/publish/) documents custom sequence identities, replacement, and clearing/deletion; the owner's deployed server still needs its named check.

This was a read-only plan and code review. Node 26.13.0 was selected. No application tests, attack probes, or builds were run. The worktree remained clean. No scratch directory was created. The only written artifact is this result file.

refused: none.

## Noted, not filed

The owner accepted the open web server, the shared Unix user, and the resulting ability to redirect or silence alerts and change lasting settings. A user deliberately defeating their own controls is not a finding. Existing same-machine guard bypasses, question 6, the VS Code scope gap, consumer fold timing, duplicate notification delivery, provider ACL enforcement, historical stored copies, and real-host verification remain as recorded known gaps. None is silently declared fixed by this review.
