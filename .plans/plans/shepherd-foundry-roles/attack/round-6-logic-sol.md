ship
Grade: 10  B/M/m: 0/0/0  Flags: none

## Findings

No new finding in the four assigned areas. This is clearance of the scoped plan changes, not implementation approval or a new full-plan review.

References to `plan.md` and `decisions.md` mean the frozen roles files beside this attack folder. `CAPI` means `roles-r6/inputs/client-api-contract.md`, version 15. `Board` means `roles-r6/inputs/board-contract.md`, version 12. Code citations are relative to the repository at the verified commit `9e386b0b0fef88a1951a1a088ed5ac78e6b711cc`.

### The hand-off reads actual prompt sources.

The original brief is written inside `AgentStarted.firstPromptDelivery` (`packages/engine/src/commands/start.ts:44`). A later public prompt writes `DeliveryQueued` (`packages/engine/src/commands/prompt.ts:9`). Dispatch identifies the delivery in `DeliverySent` (`packages/engine/src/routing/deliveries.ts:248`). The revised selection joins these records rather than expecting a `PromptSent` producer (`plan.md:1046`, `plan.md:1049`, `plan.md:1096`). This addresses R5-A1 without adding an engine event.

The agent visibility limit is retained deliberately: CAPI E21 hides an envelope without `agentId`, including `DeliveryQueued` (`CAPI:2016`). The roles now require a cut marker referencing the visible `DeliverySent`, while an owner gets the prompt text (`plan.md:1089`). That is the lead's ruled outcome, not an omission to file again. Public-command fixtures and actual runner updates are specified in H13–H15.

### The crash retry has durable admission and continuation.

The earlier failure remains reachable in today's engine: resume from crashed does not set `midTurn` (`packages/engine/src/commands/resume.ts:48`), and reload queues a carry-on only under its explicit delivery/mid-turn conditions (`packages/engine/src/recovery/reload.ts:82`). A stored resume reply also does not rerun its hook (`packages/engine/src/commands/CommandHandler.ts:294`). Stable request ids alone therefore cannot supply the earlier missing continuation.

The revised plan now records `roles.CrashAdmitted` through `roles.record` before resume, applies the current-crash test only to a new admission, and reconstructs unfinished work after recovery (`plan.md:917`). The event is named in the event inventory, view fold and service allowance (`plan.md:376`, `plan.md:623`, `plan.md:824`). Successful recovery proceeds to any missing carry-on and notice; refusal, reload failure or a later crash gives up. Completion, a stop, or an off baseline ends the admission. An admission consumes the hourly retry (`plan.md:922`, `plan.md:934`). This addresses R5-A2/R5-L1 at the policy level. CR08–CR14 name the principal interruption and cancellation cases (`plan.md:948`).

Engine recovery can finish a committed resume whose hook was interrupted: it records starting agents as interrupted and reloads them (`packages/engine/src/recovery/restart.ts:123`, `packages/engine/src/recovery/restart.ts:150`). The plan's continuation must read those resulting records, as it now specifies.

### The redactor additions have compatible ownership and scope.

The current redactor walks schema positions. An identity exemption on a string does not exempt arbitrary nested text; arrays use their element structure (`packages/engine/src/identity/redactor.ts:214`, `packages/engine/src/log/redactionStructure.ts:39`). Receipt text follows the same structural rule (`packages/engine/src/log/EventLog.ts:222`).

Task 1b assigns the roles' `roleFileHash`, `noticeRecipient`, `postId` and `rule.harnesses` entries, and the role-file setter's receipt field (`plan.md:621`). The existing table already covers top-level `agentId` and receipt-envelope events (`packages/engine/src/log/redactionStructure.ts:24`, `packages/engine/src/log/redactionStructure.ts:34`). CAPI E33 owns the shared actor and source namespace entries (`CAPI:2358`). The board's B13 owns its identifiers and preserves both the actor fields and array elements of `to` (`review/board-r6/shepherd-message-board/plan.md:411`, relative to the foundation-plans-1 run folder). The conditional shared `postId` addition conflicts with neither owner.

The generic `hash` and `recipient` exemptions were replaced by specific names. Rule words, notes, role/group names and role-file text remain subject to value redaction. Criterion 1.8 tests both surviving identifiers and redacted text, including a receipt and the first-use fold (`plan.md:614`). No new redaction-policy defect was found.

### Dashboard standing-rule access matches the password ruling.

A valid web session becomes the owner at the shared boundary (`CAPI:309`, `CAPI:332`). The roles command table grants `roles.rules.add` to the owner, and criterion 2.10 expressly includes a logged-in dashboard while refusing agents and services (`plan.md:364`, `plan.md:755`). `roles.record` remains service-only and limited to the sheepdog's records (`plan.md:370`, `plan.md:808`). The device fields and lasting-setting alert uses have been removed from operative roles text. No computer-only exception remains.

## Interacting-rule truth table

These are required plan outcomes, not executed test results.

| Conditions | Required result |
|---|---|
| A crash is current, retry is enabled, and the hourly allowance remains. | Record admission before resume; consume one retry. |
| A crash is no longer current and has no admission. | Skip it. |
| Admission exists and resume has not committed. | Resume with the stable crash-based id. |
| Resume committed, but its hook was interrupted. | Let engine recovery resolve setup; continue from its durable result. |
| Session opened, with no engine carry-on. | Send the missing carry-on and finish the notice and record. |
| The carry-on command already committed. | Reuse its receipt; do not submit another logical prompt. |
| Resume is refused, reload fails, or another crash ends the attempt. | Give up; do not grant a second automatic retry. |
| A stop or off baseline cancels admission. | Do not continue it after a later resume or switch-on. |
| The board is off but the sheepdog is on. | Crash handling continues; an unsent notice is recorded as board-off. |
| Owner requests a later prompt in the hand-off. | Return its permitted redacted text. |
| Agent requests that later prompt. | Return the specified cut marker; preserve E21 visibility. |
| Dashboard has a valid session. | Treat it as owner, including standing-rule creation. |
| Dashboard lacks a valid session, or an agent/service tries rules.add. | Refuse at the relevant shared authentication/access boundary. |

## Proposed post-build checks

1. **R6-PB1, roles/backend.** Run CR08–CR14 through the real service composition. Also kill after resume's receipt but before its hook, and between board post, flush and the final action record. Show durable admission, receipts, rebuilt view, runner sends, hourly count and notice count. An eligible retry must finish without another logical prompt or notice.
2. **R6-PB2, roles/backend.** Stop and resume the old agent before the sheepdog next runs. Also place off/on changes ahead of an interrupted sheepdog's saved position. Replay the switch history before continuing an admission that it cancels. Show cancellation survives rebuilding and no carry-on is revived. This verifies the stated cancellation policy, rather than introducing a new policy.
3. **R6-PB3, hand-off builder.** Build the thread through public start/prompt calls and runner updates. Page across the queued/sent pair; test owner, lead, recovered parent and replacement callers. Show the first brief, correct delivery correlation, hidden-prompt marker, permitted responses and encoded size limits. No synthetic PromptSent fixture may stand in for a producer.
4. **R6-PB4, contracts and roles/backend with board/backend.** Run RI01–RI03 after merging E33, B13 and task 1b. Register colliding secrets in actor service/rule names, nested harness ids, roleFileHash, noticeRecipient and postId. Show unchanged event/receipt identities, equal live/rebuilt folds and one first-use record. The same strings in notes, words, text and unrelated nested fields must still be removed. Preserve B13's actor-and-array `to` structure.
5. **R6-PB5, client API and roles/backend.** Add a qualifying standing rule from a logged-in dashboard, then replay the same request. Expect one rule and the stored reply. Repeat without a cookie and as an agent and service, including reuse of the owner's request id/body; none may obtain owner authority or add a rule. The harness qualification and matcher restrictions remain in force.

## Noted, not filed

- No named re-anchor change was found wrong against `9e386b0`. WS-7 expressly retains the terminal drain and permission credential coverage (`plan.md:1120`); those operations exist at `packages/engine/src/runner/AcpRunner.ts:263` and `packages/engine/src/runner/AcpRunner.ts:569`. Usage capture still targets the early idle branch (`packages/engine/src/runner/AcpRunner.ts:487`), and rule answers still need the planned transaction change (`packages/engine/src/commands/CommandHandler.ts:140`). Shifted anchors are not findings.
- The four round-5 minors remain listed in known-gaps.md and were not re-filed. The qualifying-harness gate, same-user database and password access, symbolic-link timing limit, and crash/replacement race remain accepted or named gaps. This review neither closes nor renews those acceptances.
- One password, no multi-user support, no rate limits or lockouts, and the /proc limit follow the supplied owner rulings. They are not defects in this review.
- The supplied security-agents-changes.diff is empty. I used SECURITY.md together with the explicit password-login rulings; the old pairing/device wording is not treated as overriding the owner's authorized replacement.

## Risk register

Empty. There is no new confirmed or unresolved finding to score.

## Review record

This was a static plan and source review. The checkout matched the recorded commit, Node.js 26.13.0 was selected with nvm use, and the repository remained clean. The roles' copied client API contract matches the supplied version-15 input byte for byte. No application tests, live harness runs or network attacks were run, and no implementation proof is claimed. No application code, repository documents, commits or pushes were produced. No scratch files were created; the empty assigned scratch directory was removed before writing this result. The only output file is this review.

refused: none.
