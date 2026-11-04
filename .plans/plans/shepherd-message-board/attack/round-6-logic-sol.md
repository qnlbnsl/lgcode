revise
Grade: 7  B/M/m: 0/1/0  Flags: none

## Review basis

This is the requested short check of board plan version 11 and contract version 12, against client API contract version 15 and engine commit `9e386b0b0fef88a1951a1a088ed5ac78e6b711cc`. It covers only the supplied change diff, the password ruling, the last round's major repair, the re-anchor, and the redaction entries.

Repository citations below were checked in that checkout. Plan citations are relative to this report: `../plan.md`, `../contract.md`, `../decisions.md`, and `../../inputs/`. This reviews the prescribed design. It does not claim that the future board implementation or its tests ran.

## Findings

### R6-L1. B13 omits the group anchor and the wake target from its identity coverage

Severity: **MAJOR**. Category: **Design; Bug (redaction and routing)**. Evidence status: **Confirmed omission in the specified entries, with a structural probe**. Responsible builder: board backend, unit 3a, coordinated with unit 1's event schemas.

**Scenario.** A registered secret occurs inside an existing agent id. Open a group channel anchored on that agent. B13 preserves the opener's actor id but does not prescribe an identity entry for the channel's anchor. The redactor therefore changes the anchor value while leaving the real agent id intact. The stored channel can no longer recognize that agent as its anchor or recognize its labelled descendants through their parent links. Ordinary team-channel posts and reads fail membership checks until the channel is repaired or recreated. Rebuilding repeats the bad anchor rather than repairing it.

The same omission affects the target recorded in `board.WakeBuilt`: B13 does not name that target, and the existing exemption for `delivery.target` applies only inside an engine delivery. A rewritten wake target no longer matches the actual recipient. That can break the target-indexed accounting for carried questions, accepted reads and completions.

This is the exact secret/id collision B13 and criterion 3.7 undertake to handle, rather than a request to change the owner's password or same-user policies.

**Evidence.**

- B13's enumerated additions name post, channel and wake ids, addressees, authors, reply targets, carried lists, readers, openers, closers and managers. They omit the group anchor and the wake target (`../plan.md:411`). The view explicitly needs the anchor and the wake's target (`../plan.md:522`, `../plan.md:541`). The contract requires the group anchor to identify an agent and requires `board.WakeBuilt` itself to name its target (`../contract.md:104`, `../contract.md:108`, `../contract.md:332`).
- At the recorded commit, `eventStructure` has no anchor entry and no top-level target entry. Its target exemption is specifically nested under `delivery` (`packages/engine/src/log/redactionStructure.ts:19`, `packages/engine/src/log/redactionStructure.ts:23`). Shapes do not inherit identity status from another position: `fieldStructure` looks up the current object's field only (`packages/engine/src/log/redactionStructure.ts:39`).
- The actual event walker redacts every string whose current structure is not marked `identity`, and descends through that field lookup (`packages/engine/src/identity/redactor.ts:211`). Receipt traversal follows the same rule (`packages/engine/src/log/EventLog.ts:222`). Branding alone does not protect an id: `AgentId` is a branded nonempty string (`packages/contracts/src/ids.ts:4`).
- Client API E33 adds actor names, delivery-source namespace, alert identities and subject namespace. It supplies neither missing board-specific path (`../../inputs/client-api-contract.md:2356`). Roles task 1b adds its own identities and reuses the board's post id entry; it also supplies neither path (`../../inputs/roles-plan.md:621`).
- A read-only, in-memory probe composed the explicitly listed B13 entries with E33's actor additions and used the recorded `fieldStructure` function in a local model of the string walker. With secret `c0ffee00` and id `c0ffee00-1111-4111-8111-111111111111`, the opener's actor id and nested `delivery.target` remained whole. The unlisted anchor and wake target became `[REDACTED]-1111-4111-8111-111111111111`. This demonstrates the metadata omission; it is not a runtime test of a built board.

**Suggested fix.** Name the exact event-schema paths for the group anchor and the wake target in B13, and preserve them as identities, whether the chosen schema represents them directly or inside an actor. Extend criterion 3.7 to cover these references through the real log writer and receipt path. Verify group membership, wake-target joins, completion discharge and rebuilt views. Keep channel names, labels and ordinary text subject to redaction.

## Interacting-rule truth table

The retained sequence comparisons answer the last round's lifecycle counterexamples. These are conclusions about the written rules, subject to implementation checks below.

| Ordering or interaction | Required result | Assessment |
| --- | --- | --- |
| Post, addressee crash or stop, resume, reactor | Resolve an unresolved addressee `gone`. | The retained lifecycle sequence remains later than the post (`../contract.md:685`). |
| Post, failed reload, successful later resume, reactor | Resolve an unresolved addressee `gone`. | Failed-reload sequences are retained too (`../plan.md:534`). |
| Post, member removal or label loss, rejoin, reactor | Resolve an unresolved addressee `removed`. | Last-left sequences survive the rejoin (`../plan.md:535`, `../plan.md:537`, `../plan.md:760`). |
| Author posts, stops, resumes, reactor | Withdraw the old open post without completion debt. | The stop/post comparison survives resume (`../contract.md:687`). |
| Author stops after posting; a reply closes the post before reconciliation | The close must not recreate completion debt for stopped work. | The completion exception applies whatever closed it (`../plan.md:442`). A committed close is not overwritten (`../contract.md:693`). |
| Author leaves, rejoins, reactor | Withdraw an old open post with a completion, unless a later stop suppresses it. | The retained departure and stop comparisons distinguish these cases (`../contract.md:688`). |
| Manager takes seat, stops, resumes, reactor | Transfer the seat once; resume does not restore it. | Seat assignment and stop sequences retain the duty (`../contract.md:689`). |
| New seat assignment or new post follows an earlier stop | The earlier stop affects neither new obligation. | Its sequence is lower than the new assignment or post (`../plan.md:688`, `../plan.md:796`). |
| Both transitions occur while the board is disabled, then restart and enable | Recover the same outstanding duties from rebuilt state. | The fold retains the sequences and the reactor scans the whole state (`../plan.md:555`, `../contract.md:699`). |
| Addressee replies after a disposition, while the post remains open | Upgrade to `replied`; do not override an already committed reply. | The existing late-reply rule remains (`../contract.md:238`, `../contract.md:693`). |
| Interrupt successfully undone, or direct grant lapses and returns before reconciliation | No retained interrupt or grant-loss duty. | These limits are explicit in decision 143 and the contract (`../decisions.md:153`, `../contract.md:694`). |

Criterion 4.1 calls the stopped author's result `withdrawn` even when a reply closes it first (`../plan.md:792`). Read that case with the explicit first-committed-close rule above: the essential added guarantee is that no completion is owed. The implemented test should distinguish closure outcome from completion eligibility rather than attempting to rewrite an already committed close.

## Results for the other requested checks

**Password login and device removal.** No additional defect found in the board's changes. A logged-in session is the owner; access, snapshot and status text no longer grant a separate device identity; the web post test records the owner; and the browser scenario now logs in (`../contract.md:574`, `../plan.md:407`, `../plan.md:562`, `../plan.md:846`, `../plan.md:916`). This matches the shared owner credential and receipt policy (`../../inputs/client-api-contract.md:309`, `../../inputs/client-api-contract.md:332`). E12 removes the two engine device branches while preserving authorized start preemption (`../../inputs/client-api-contract.md:1720`, `../../inputs/client-api-contract.md:1732`). The current branches exist where that edit names them (`packages/engine/src/commands/CommandHandler.ts:211`, `packages/engine/src/commands/CommandHandler.ts:243`). No missing board-specific login mechanism is inferred.

**Last round's major.** R5-A1, C5-01, R5-L1 and R5-TM-1 are addressed by retained stop, crash, failed-reload and departure sequences, compared with post and seat sequences. The required view inventory and delayed-reactor/restart cases are now named (`../plan.md:533`, `../plan.md:555`, `../plan.md:792`, `../plan.md:796`). No further lifecycle major is filed.

**Re-anchor.** The checkout is exactly the recorded commit. Stop still emits `AgentStopped`, resume writes `StateChanged starting`, and current lifecycle state is replaced by the fold (`packages/engine/src/commands/stop.ts:11`, `packages/engine/src/commands/resume.ts:26`, `packages/engine/src/views/apply.ts:201`). The new historical comparisons therefore address the actual engine behavior. Projection supplies increasing sequences, so it supports those comparisons (`packages/engine/src/routing/waits.ts:28`). The followers are at the revised B8 anchor (`packages/engine/src/commands/CommandHandler.ts:179`). No additional named change is wrong solely because of the re-anchor.

**Redaction join.** B13 correctly preserves `to`'s existing actor fields while adding array elements, avoids a blanket free-text `replyTo` exemption, and relies on E33 for service and namespace identities (`../plan.md:411`, `../decisions.md:158`). The remaining missing paths are R6-L1.

## Risk register

| Id | Severity | Fallout | Probability | Score and band | Evidence and owner | Decision and deadline | Acceptance and closing evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R6-L1 | 6: an affected channel's core membership or wake accounting fails until repaired | 3: one installation; the owner can repair or recreate affected coordination | 4: requires a registered-secret/id collision; explicit secrets may be short, and this is an expressly supported redaction case | 72, schedule | Confirmed prescribed-entry omission; board backend unit 3a | Pending owner/lead disposition; within this phase or a dated follow-up with an owner | No acceptance or closing evidence yet |

## Proposed post-build checks

| Id | Scenario | Expected result | Evidence and responsible area |
| --- | --- | --- | --- |
| R6-PB1 | Hold the reactor; stop and resume a manager that authored an open question; repeat with both transitions while disabled and across restart. Add a post after resume. | One permanent seat transfer; old work closes without debt; new work survives; another scan writes nothing. | Public command trace, persisted sequences, completion counts and live/rebuilt equality. Board units 2a/3b. |
| R6-PB2 | Crash/resume and remove/rejoin addressees before reconciliation, including an all-mode post with another outstanding addressee and a later reply. | Correct gone/removed dispositions and permitted replied upgrade; no overwritten committed reply. | Real lifecycle/group commands, controlled follower barriers and board outcomes. Board units 3b/3c; roles crash-retry integration. |
| R6-PB3 | Plant a registered secret inside each board identity, including the group anchor and wake target. Exercise channel open, post, merged wake, accepted completion and receipt replay. | Every identity remains equal to its original; text is redacted; membership and completion joins work; rebuilt views equal live views. | Real redactor and stored events/receipts, rather than a pass-through layer or the local metadata model. Board unit 3a and integration. |
| R6-PB4 | Use a logged-in dashboard to open/read/post/close and follow an alert link; then log out and retry both API and WebSocket entry. | Owner attribution with no device field; no unauthenticated API or stream; a fresh login restores the same owner access. | Actual browser/server traffic and committed caller records. Board web integration and client API builder. |

## Noted, not filed

- The owner's single password, absent rate limits and lockouts, one-user model, deferred mobile login, and accepted same-Unix-user environment access are settled choices.
- The named known gaps and the three last-round minors are not re-filed. No unchanged, unrelated plan section was reviewed as a new finding.
- The supplied `security-agents-changes.diff` is empty. The password ruling explicitly supplies the approved replacement of the old pairing/device rules; that authorized change was not treated as a security regression.
- The repository remained read-only. Node.js 26.13.0 was selected. No application suite was run for this frozen-plan review. The metadata probe ran in memory and made no files.
- Some broad combined reads exceeded the tool output limit. The decision, lifecycle, redaction and shared-contract sections used as evidence were read separately afterward. Two attempted neighbouring-file reads found no `views/project.ts` or `log/receipt.ts`; the actual implementations were then located in `routing/waits.ts` and `log/EventLog.ts`.
- The first result-write attempt stopped before writing because its check found the assigned scratch directory present. It was empty. The retry removes that empty directory before writing the result. No probe files were created.
- No subagents, team-board commands, commits, pushes, session report or journal entry were used. This result is the only file written.
- refused: none.
