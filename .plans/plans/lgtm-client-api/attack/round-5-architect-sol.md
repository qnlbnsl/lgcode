revise
Grade: 7  B/M/m: 0/1/0  Flags: none

## Scope and evidence

This is the architect's short final check of contract version 15. I started from `inputs/changes-since-last-review.diff` and reviewed only the password change, the last round's major and re-anchor item, the named changes against engine `9e386b0`, and the new redaction entries. The checkout's full commit is `9e386b0b0fef88a1951a1a088ed5ac78e6b711cc`.

Repository paths below refer to that commit. `plan.md`, `contract.md` and `decisions.md` refer to this review's `lgtm-client-api/` folder. `BoardPlan` means `review/board-r6/lgtm-message-board/plan.md` in the same foundry run. `Effect4` means `/home/qnlbnsl/projects/personal/lgtm-studio/node_modules/.pnpm/effect@4.0.5/node_modules/effect/src/`.

## Finding R5-A1: E12 leaves three existing test files incompatible with the removal

**Severity:** MAJOR. **Category:** Design, build integration. **Evidence status:** Confirmed by reading the recorded code and the prescribed edits. **Responsible builder:** Client API unit 1b.

**Scenario and consequence.** The builder removes the device helpers, table and redaction exemption as E12 directs, and updates only the existing tests that the contract authorizes. The required typecheck then has an import of a deleted helper, and the required test run still expects the deleted table and exemption. Unit 1b cannot meet its build gate as written.

**Plan evidence.** `contract.md:1720` removes the device credential implementation and contracts. `contract.md:1730` drops the table through a new migration. `contract.md:1737` removes the device helpers from `support/handlerRig.ts`. The existing test update list at `contract.md:1739` through `contract.md:1747` omits `api/per-request-credential.test.ts` and `identity/redactor-structure.test.ts`. The other edits that name `log/append.test.ts` prescribe additional cases, rather than changing its existing device-table expectation (`contract.md:1626`, `contract.md:1773`). This matters because `plan.md:285` through `plan.md:290` and criterion 1.1 at `plan.md:306` allow an existing test to change only as its named edit says, while requiring the root `pnpm check` to pass.

**Code evidence at `9e386b0`.**

- `packages/engine/test/api/per-request-credential.test.ts:26` imports `seedDevice` from `support/handlerRig.ts`. Its device cases call it at lines 125, 156 and 173, and use the removed `revokeDevices` side row at lines 131 and 163. E12 removes the helper defined at `packages/engine/test/support/handlerRig.ts:253`, so leaving this file unchanged creates a missing export during typecheck. The engine's typecheck includes its tests (`packages/engine/tsconfig.json:5`).
- `packages/engine/test/log/append.test.ts:180` queries `SELECT COUNT(*) AS n FROM devices` after migration. Once E12's drop migration runs, that query fails because the table no longer exists. Its write-ahead-log assertion at line 179 remains useful and should stay.
- `packages/engine/test/identity/redactor-structure.test.ts:74` still supplies `DeviceRevoked` with `deviceId: "acct"`, and line 80 expects the input to survive unchanged while `acct` is registered as a secret. E12 removes `deviceId` from the exemption at `packages/engine/src/log/redactionStructure.ts:24`, so that obsolete fixture no longer meets the assertion.

**Suggested fix.** Add these three existing files explicitly to E12's authorized changes. Remove the obsolete device cases from the per-request suite while preserving its agent and owner checks. Replace the append test's table-presence assertion with the intended post-removal schema assertion, retaining its journal-mode check. Remove the obsolete device event from the structural-redaction fixture matrix while retaining the other collision cases. Keep the new migration test in criterion 1.34. No restoration of pairing or device credentials is needed.

## Risk register

| Id | Severity label | Risk score | Evidence | Owner | Decision | Deadline | Closing evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R5-A1 | Major | Not scored. This is a required build-gate failure, which the risk rules require to pass independently of scoring. | Confirmed static dependency and assertion conflict. | Client API unit 1b builder. | For the owner or lead to decide. | Before unit 1b merges. | Corrected E12 authorization, followed by successful typecheck and the full required check on the implementation. |

## Answers to the four review questions

1. **Password login and removal.** Apart from R5-A1, I found no further concrete integration failure in the changed login design. `webCaller` returns the handler's existing owner credential after validating the cookie (`contract.md:332`), rather than adding another caller variant. The current handler already resolves that owner credential both before start preemption and inside the transaction (`packages/engine/src/commands/CommandHandler.ts:211`, `packages/engine/src/commands/CommandHandler.ts:243`). Removing the device branches therefore needs no replacement web branch. E34's early capture and deletion match the service's existing inherited-token pattern (`packages/engine/src/service.ts:37`, `packages/engine/src/service.ts:104`). The Agent Client Protocol environment filter and explicit spawn environment support the proposed inheritance check (`packages/engine/src/runner/baseEnvironment.ts:13`, `packages/engine/src/runner/AcpRunner.ts:379`). Interactive spawning remains future work, explicitly assigned a pane-environment check at `contract.md:2389`.

2. **The last major and its ping fix.** R4-A1 is addressed at plan level. E32 passes `pingInterval: "25 seconds"` and `pingTimeout: "50 seconds"` only to the browser's read connection (`contract.md:2332`), retaining default liveness on the stream. The pinned Effect 4.0.5 source accepts these options at `Effect4/rpc/RpcClient.ts:1062`, counts a decoded response at line 1119, and checks elapsed silence on a ping tick at line 1265. Those facts support the proposed 1 mebibyte recovery at 500 kilobits per second. Criterion 7.14 requires the production protocol and records its actual options (`plan.md:648`). The official [RpcClient reference](https://effect.website/docs/v4/api/effect/rpc/RpcClient#makeprotocolsocket), checked on 2026-11-03, agrees on the option names and decoded-frame semantics. Context7 returned a quota error, so I used the official reference and the pinned installed source. The remaining very-large-reply limit is already a known gap.

3. **The re-anchor and unit order.** The second credential branch is now explicitly covered by E12 (`contract.md:1721`). The existing owner-stop and invalid-caller tests really exist at `packages/engine/test/commands/start-setup.test.ts:55` and line 83. Replacing the invalid-device fixture with an invalid agent token preserves the intended negative case. E29 now names the current runner's arbitrary-data cleaner, rather than assuming the event redactor can safely clean tool input (`contract.md:2220`; `packages/engine/src/runner/AcpRunner.ts:173`). I found no additional named re-anchor change that is wrong against this commit. The revised unit order is workable: 1a precedes 1b, unit 2 follows, unit 5 owns both login and the proxy table, and unit 11 owns the setup document and phone proof (`plan.md:399`, `plan.md:507`, `plan.md:733`, `plan.md:767`). New test paths are implementation deliverables; the existing paths cited above resolve in the recorded checkout.

4. **The added id fields.** I found no additional concrete defect in E33, B13 or roles task 1b. E33 extends the shared actor structure and the delivery source before the board and roles consume them (`contract.md:2358`). The receipt envelope already points to the same actor and event structures (`packages/engine/src/log/redactionStructure.ts:35`). B13 explicitly preserves the existing actor fields on `to` while adding array elements (`BoardPlan:411`), so the board's addressees do not overwrite the engine's moved-request identities at `packages/engine/src/log/redactionStructure.ts:26`. Roles task 1b names its extra event and receipt entries and leaves the shared actor entries to E33 (`inputs/roles-plan.md:621`). The renamed `alertKey`, `roleFileHash` and `noticeRecipient` avoid exempting generic free-text fields. R5-A1 still requires removing the obsolete device fixture from the existing collision tests.

## Proposed post-build checks

- After E12, run the root required check, including the per-request credential suite, the append suite and the structural-redaction suite. Require no missing helper imports, no query of the removed table, and preserved agent revocation and owner behavior. Unit 1b owns the command output and changed-test inventory.
- Run criterion 7.14 with the production browser bundle and real encoded frames. Record the read and stream options, one completed slow recovery read, converged control state, and an answer that releases the request. Units 2 and 7b own the protocol and browser evidence.
- Exercise a logged-in web stop during a start whose setup never returns. Require cancellation within the existing five-second test bound, one `AgentStopped`, no late session or spawn, and no preemption by an invalid agent token. Units 1b and 5 own the handler and web evidence.
- Run the three plans' identity-collision checks together. Include event, receipt and rebuilt-view lookups, both engine and board forms of `to`, service rule ids, alert subjects, role-file hashes and harness-id arrays. Require the same secret in titles, tool input, names, generic `key`, `hash` and `recipient` fields to remain redacted. The respective engine, board and roles builders own those results.

## Noted, not filed

The owner's one-password, one-user choice, global logout, absence of rate limits and lockouts, same-user `/proc` limit, deferred mobile login, cookie port limit and dashboard self-lockout are accepted or named gaps. I did not reopen them. Pairing slots, the peer guard and the computer-only command list are removed from the operative contract. The known Codex diff-correlation minor is outside this fold and is not re-filed.

This was a plan review. I did not run an implementation test suite or claim the unbuilt feature passes. Node.js 26 was selected. No repository files were edited, committed or pushed. The designated scratch directory was empty and was removed before writing this result.
