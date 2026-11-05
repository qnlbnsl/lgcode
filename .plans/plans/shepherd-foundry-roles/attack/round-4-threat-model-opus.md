revise
Grade: 8  B/M/m: 0/0/6  Flags: none

# Threat-model review of shepherd-foundry-roles plan v5, round 4

Lens: security threat model. The plan reviewed is `plan.md` v5. I checked
that it is identical to `attack/plan-v5.md` with `diff -q`. I also read
`decisions.md` (rows 34, 35, 46, 53, 54, 57, 58 and 67 to 81),
`requests.md`, the known gaps, the rulings, the three earlier findings
maps, my own round 3 review and the other threat-model review of round 3,
and the full diff from `attack/plan-v4.md` to v5. Code claims are checked
at commit `8ff4c9b` (`8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`) in the
read-only worktree. Repository paths below are relative to its root.

Abbreviations used in this file:

- "P" is `plan.md`.
- "CAPI" is `inputs/client-api-contract.md` (client API contract v3).
- "Board" is `inputs/board-contract.md` (board contract v6).
- ACP means the Agent Client Protocol.
- MCP means the Model Context Protocol.

## The threat model this review uses

The threat model is the one the owner accepted. Agents run as the owner's
user (`SECURITY.md:34-44`, known gap 8). Shephrd's rules therefore guard
against an agent's mistakes, against prompt-injected text, and against
defects in Shephrd's own code. They do not guard against a deliberately
hostile agent. Each finding below can be reached through ordinary use, an
ordinary mistake, injected text or a builder's defect.

## Verdict in brief

The rework under the owner's answer and lead rulings L26 and L27 keeps
every security answer from rounds 1 to 3, with one exception that is now
in scope. Lead ruling L27 settles my round 3 finding R3-2. The matcher's
round 3 folds hold.

Six minor problems remain. Two of them are pre-build decisions, so the
verdict is "revise", not "ship":

- **F1.** The symbolic-link fix of round 3 rests on the undefined phrase
  "path-like word". Under a narrow reading, it misses its own example.
- **F2.** After lead ruling L26, the roles' two services are the only
  service callers. They still hold engine and board rights that they never
  use. Among these is a generic `answer`, which is checked more weakly than
  an agent's answer. Round 1's answer to F5 relied on "other consumers"
  that no longer exist.

The other four are smaller:

- **F3.** The package boundary that kept the sheepdog on its narrow path
  is gone.
- **F4.** WS-7a adds blocking file-system work, and a blocking runner
  call, to a path that every agent shares.
- **F5.** A rule answer for an agent whose holder is the owner can still
  raise an approval alert.
- **F6.** The holder check on `release` is not tied to the engine's
  rights helper, and no test refuses a non-holder.

No finding is a blocker or a major.

## Earlier answers checked

### Round 3 answers

| Round 3 finding | Does the answer hold in v5? | Why |
|---|---|---|
| TO-R3-1 (Codex `use_default` taken as the sandbox marker) | Holds | P:551-560 and row 79(1). None of the model's own Codex fields is the marker. Only an approval event saying that the command stays sandboxed counts. Criterion 2.5 (P:620) tests a retry-without-sandbox approval, with and without `reason`. |
| TO-R3-2 (no harness can match, yet WS-7a would be built) | Holds, by lead ruling L27 | Row 81, P:254-262, P:516-519 and the sizing notes (P:1155-1161). The recordings come first, and units 3, 4 and 11a are built only for a harness that qualifies. A wrong "qualifies" call is backstopped by criteria 2.13 and 2.14: an `unsupported` harness gets no rules. See "Noted, not filed". |
| TO-R3-3 (a title used as the shell discriminator) | Holds | P:545-549, criterion 2.4 (M63) and criterion 2.14 (X04). |
| TO-R3-4 (letter case, and the engine's list) | Holds | P:563-570 and criterion 2.6. The names list is inline inside `isHarnessSettings` (`packages/engine/src/identity/ceiling.ts:317-322`), which is not exported. "Imported from the engine's own function" therefore needs a small export refactor. That is not a behaviour change, so it is noted only. |
| TO-R3-5 (a refused mode not counted) | Holds | P:589-593 and criterion 2.8 (M69). |
| TS-R3-TM-1 (an alias through an existing symbolic link) | Holds in intent, with a gap in its definition | P:571-578, P:966 and criterion 2.6. The resolver the plan names, `resolveLikeKernel` (`ceiling.ts:341-379`), keeps a missing final part and still applies the protected-name test. So a link to the `.claude` folder plus a new file name is caught. The gap is which words get resolved. See F1. |
| TS-R3-TM-2 (field maxima over 2 KiB) | Holds | Row 70 and criterion 1.3a. |
| TS-R3-TM-3 (the alert hook cannot classify a turn) | Holds | `roles.StallEnded`, row 76, and criterion 3.11. |

### Earlier answers that the rework could have broken

| Earlier answer | Does it hold in v5? | Why |
|---|---|---|
| N3 (a rule answer must not be recorded as the owner) | Holds | Criterion 7.2 adds a second write whose caller is the service, with `answeredBy` the same service. Today every runner event is written with `{ _tag: "owner" }` (`packages/engine/src/commands/CommandHandler.ts:148`). |
| F5, round 1 (no engine backstop on service answers) | Holds for WS-7a, but fails for the service caller | The pre-check gets the engine's own checks (7.2). The second half of the round 1 answer was "the roles no longer call service `answer`", with other service consumers left to the seam review (`round-2-threat-model-sol.md:359-362`). Under lead ruling L26 there is no seam, and the roles' two services are the only services. See F2. |
| N2 (the pre-check is total) | Holds | Criteria 7.2 and 2.15. |
| N7 and R3-5 (the mode guard) | Holds | Criterion 2.8. |
| N8 (`toolInput` is bounded and kept out of views) | Holds | Criterion 7.1. An agent's `subscribe` shows envelopes only for itself and its direct children (`packages/engine/src/api/server.ts:155-158`). The field therefore reaches no agent that could not already read the same tool call in that thread. |
| N10 (`roles.record` kinds) | Holds | Criterion 3.4 keeps a closed list for each service. |
| Row 46 (the switches, and no downgrade) | Holds | Criterion 3.10 and P:268-272. |
| Device revocation stops a rule | Holds | Criterion 2.9. `DeviceRevoked` is an engine event (`packages/contracts/src/events.ts:177`), which the roles view can fold inside the transaction. |

## Findings

### F1. MINOR. The phrase "path-like word" is undefined, so the round 3 symbolic-link fix can miss its own example

- **Category:** Security (access, and integrity of harness settings).
- **Responsibility:** 3, Access.
- **Where:**
  - P:571-578, the WS-2 bullet "no word … names a path that resolves". It says "WS-7a resolves each such path".
  - P:966, criterion 7.2: "the engine resolves each path-like word, and each part of a word after an `=`".
  - P:621, criterion 2.6.
- **Scenario:**
  - The owner adds the exact rule `cp template.json active-config`.
  - In the asker's folder, `active-config` is a symbolic link to `.claude/settings.json`. This is the example in P:576-578.
  - A builder reads "path-like" in the common way: a word that contains `/` or begins with `.`. Under that reading, `active-config` is never resolved.
  - The word contains no protected name, and the matcher sees no resolution result that marks it protected. The rule answers "allow once", and the harness settings file is overwritten.
- **Why the tests would not catch it:**
  - Criterion 2.6's M66-M68 test the pure matcher. The matcher is given resolution results. It cannot show which words the engine chose to resolve.
  - Criterion 7.2's PC01-PC08 do not name a word without `/` or `.`.
  - Neither criterion names the case of a linked folder followed by a missing file, such as `cfg/settings.json` where `cfg` links to `.claude`. The resolver handles that case today (`ceiling.ts:355-360`), but nothing pins it.
- **Suggested fix (pre-build, because it defines an access boundary):**
  - Replace "path-like word" with "every word, and every part of a word after an `=`". This is cheap, because F4's fix limits resolution to the words of a rule that could match.
  - Add two cases to PC01-PC08:
    - a bare-named link to a protected file;
    - a linked folder followed by a missing final file.
  - Run both cases through the real resolver, not through a stub.
- **Not filed with it:** for a `prefix` rule, an extra word with an attached short option, such as `-oactive-config`, is not resolved as `active-config`. The fixed warning on `prefix` rules already says that extra arguments can make a command run code (P:603-605, lead ruling L20). See "Noted, not filed".

### F2. MINOR. The roles' two services hold rights that they never use, including an `answer` checked more weakly than an agent's

- **Category:** Security (access). It is also a design issue.
- **Responsibility:** 3, Access.
- **Where:**
  - P:112, under Key decisions: "a narrow caller that can nudge, compact, resume, post notices and release held messages, and nothing else".
  - P:412-421, the Services paragraph.
  - Criterion 3.4 (P:677), and the risk row at P:702.
  - CAPI:281-293 and CAPI:797-812 (E13).
  - CAPI:644 (E2).
  - Board:438 (`board.close`).
- **Scenario:**
  - Edit E13 enforces rights by caller kind, not by service name. Any service on the list may `prompt`, `compact` and `resume` any agent, and may `answer` (CAPI:807-811).
  - The board's access table lets "a Shephrd service" close any post (Board:438). So `roles.standing-rules` may prompt any agent, and the sheepdog may answer permission requests and close any post.
  - E13's `answer` refuses only a persistent option and a level above the asker's mode. It says nothing of `settingsWrite`, of unknown option kinds, or of which holder a service may answer for.
  - Today the engine applies `row.settingsWrite` and `canAnswerOption` only when the caller is an agent (`packages/engine/src/routing/permissions.ts:35-43`). The owner-held settings rule therefore depends on how a builder adapts that check for a new caller kind.
  - Suppose a defect in sheepdog code, which runs with no attack pass (units 5-9, P:1140-1144), sends an `answer` for an open request. The engine then accepts a one-time allow that no person and no rule approved, possibly on a settings write.
- **Why criterion 3.4 does not cover it:** 3.4 lists the calls the services make. It does not show that the engine refuses the calls they should not make. The Key decisions sentence "and nothing else" is therefore a property of the roles' code, not of the engine.
- **Why this is in scope now:** Round 1's answer to F5 left the generic `answer` to "a broader seam review" for other consumers. Under lead ruling L26, the roles plan writes the services' entries in `commands/services.ts` (CAPI:798-799, "which the roles plan edits"), and no other service exists.
- **Suggested fix:**
  - Give each service its own command list in `services.ts`.
    - `roles.sheepdog`: `subscribe`, `prompt`, `compact`, `resume`, `release`, `roles.record`, `board.post`, `board.flush` and `board.status`.
    - `roles.standing-rules`: `subscribe` and `roles.record`.
  - Have the service entry point refuse every other command.
  - Since no service calls `answer`, take `service` out of `answer`'s access entry. Rule answers come through WS-7a's second write, which needs no command access.
  - Change criterion 3.4 so that it calls the real entry point under each service name and checks that `answer`, `board.close`, `start` and `stop` are refused.
  - This touches CAPI E13, so the lead should carry it to the client API plan.

### F3. MINOR. With the package boundary gone, nothing stops roles code from bypassing the service path

- **Category:** Security (access, and integrity of attribution).
- **Responsibilities:** 3, Access; 4, Integrity of the record.
- **Where:**
  - CAPI:101: a piece's engine folder "may import any engine module".
  - P:329-340, the roles' code in `packages/engine/src/roles/`.
  - Criterion 3.4.
  - Row 80, which supersedes the package split of row 26.
- **Scenario:**
  - Under v4, the sheepdog lived in its own package and reached the engine through the seam.
  - Under v5, `packages/engine/src/roles/sheepdog/` can import `EventLog`, `Runner` or `SqlClient` directly.
  - A builder working on a medium-complexity sheepdog unit, with no attack pass, could take a shortcut. One example is calling `runner.answerPermission` or `runner.stop`. Another is appending through `log.transact` with the runner path's fixed `{ _tag: "owner" }` caller (`CommandHandler.ts:148`).
  - The action would then skip E13's rights, and the log would record it as the owner's. Lead ruling L8 says that the service caller is the roles' only credential, and the record must name the sheepdog, not the owner.
  - Criterion 3.4's call list cannot see a direct import.
- **Suggested fix:**
  - Add an import-boundary test under `packages/engine/test/roles/`.
    - It fails if any file in `packages/engine/src/roles/sheepdog/`, or the services' files, imports `log/EventLog`, `runner/*`, `effect/sql` or `commands/CommandHandler`.
    - It allows only the service entry point, the views, and the pure helpers named in E22.
  - Name that test in criterion 3.4.

### F4. MINOR. WS-7a adds blocking file-system work and a blocking runner call to the path that every agent's events share

- **Category:** Bug (availability). It is also a design issue in an engine change.
- **Responsibility:** 4, Integrity (the engine keeps working). This is not a data-safety finding.
- **Where:**
  - Criterion 7.2 (P:966): "Before the transaction, for an `execute` request, the engine resolves each path-like word …", and "the runner's `answerPermission` is called after commit".
  - The list of 7a's changes to existing behaviour (P:930-940).
- **Code at `8ff4c9b`:**
  - The resolver is synchronous (`lstatSync` and `readlinkSync`, `ceiling.ts:355` and `ceiling.ts:364`). Node.js documents that its synchronous file-system calls block the event loop until they finish (Node.js `fs` documentation, "Synchronous API", read through context7 on 2026-11-03).
  - Today the engine resolves only `tool.locations` (`packages/engine/src/runner/AcpRunner.ts:416`), and those are usually empty for a shell request.
  - Runner events from every agent are handled one at a time, in one fiber (`CommandHandler.ts:177`, `Stream.runForEach(handleRunnerEvent)`).
  - `answerPermission` waits until the response has been written to the adapter (`AcpRunner.ts:509-516`, and `onOutgoingResponse` at l.301-306).
- **Scenario:**
  - A worker's command names a path on a network mount that has hung, such as an `autofs` path under `/net/<host>`. This can be an ordinary mistake or injected text. It needs no rule, and it can happen with standing rules switched off.
  - Resolving that word freezes the whole Shephrd process until the mount times out. Every agent, the owner's socket and the API wait with it.
  - Separately, if one adapter stops reading its standard input, awaiting the answer inside the shared fiber holds back every other agent's runner events.
  - Neither effect is named in 7a's list of behaviour changes. That list names only the new event fields and the second write.
- **Suggested fix:**
  - Resolve only when all of these hold:
    - the standing-rules switch is on;
    - the asker's harness is supported;
    - the request passes the matcher's lexical checks against at least one enabled rule.

    Then only the words of a rule the owner wrote, plus any `prefix` extras, are resolved.
  - Bound the number of words resolved. Run the resolution off the event loop, with a time limit, and treat a timeout as protected.
  - After commit, start the runner call on its own fiber, on the agent's lane, instead of awaiting it in the shared stream.
  - Add both effects to 7a's list of behaviour changes, each with a test.

### F5. MINOR. A rule answer for an agent whose holder is the owner can still write `OwnerNeeded` and push an approval alert

- **Category:** Bug (alert noise).
- **Responsibility:** 5, Confidentiality (minimal pushes). The impact is noise, not data exposure.
- **Where:**
  - Criteria 2.11 (P:626) and 7.2 (P:966): "no delivery to the holder is queued".
- **Code at `8ff4c9b`:**
  - `permissionRequested` builds its routing events in the same batch as the request (`packages/engine/src/routing/permissions.ts:21-27`).
  - For an owner holder, those routing events are `OwnerNeeded { reason: "request needs the owner" }`, not a delivery (`packages/engine/src/routing/holders.ts:45-50`).
  - CAPI §4 turns that event into an `approval` alert, which is pushed by default (CAPI:438-447 and CAPI:487).
- **Scenario:**
  - An agent with no available ancestor sends a matching request. Examples are a top-level orchestrator in `ask` mode, or a worker whose lead is paused.
  - A builder keeps the existing routing events and appends `PermissionAnswered`, as the `answer` planner does with `withdrawQueued` (`routing/permissions.ts:44-47`).
  - No delivery is queued, so criterion 2.11 passes. But the owner's phone gets an approval alert for something already allowed, and the alert is cleared a moment later.
- **Suggested fix:**
  - State that a rule answer replaces the request's routing events entirely: no `DeliveryQueued` and no `OwnerNeeded`.
  - Add a PC case with an agent whose holder is the owner. It should assert that no `OwnerNeeded` is written and no `client.AlertRaised` follows.

### F6. MINOR. The holder check on `release` is not tied to the engine's rights helper, and no test refuses a non-holder

- **Category:** Security (access).
- **Responsibility:** 3, Access.
- **Where:**
  - P:946-947, "`agent` (the target's holder)".
  - Criterion 7.4 (P:968), RL01-RL03.
- **Scenario:**
  - `release` gains `agent` access, so it becomes an MCP tool for every agent (CAPI E2).
  - CAPI §2 says that a piece's agent-callable command acting on another agent uses the engine's rights helper (CAPI:220-224). The plan names a different rule, "the target's holder", without a function.
  - RL01-RL03 cover the owner, the holder, a service, and a target with no hold. No test covers a sibling or an unrelated agent.
  - A builder who checks only that the caller is an agent lets any agent end another agent's hold. That spends the other agent's retries early and moves it towards `GaveUp`.
- **Suggested fix:**
  - Name the check. Use `mayActForHolder` over the target's `holderAbove` (`holders.ts:21-40`), or the E22 rights helper.
  - Add refusal cases to 7.4 for a sibling, for the held agent's own child, and for an unrelated agent.

## Proposed post-build checks

| Id | Area | Scenario | Expected result | Evidence |
|---|---|---|---|---|
| PB-R4-1 | engine/backend, unit 11a | An `execute` request whose words name a path on a stalled mount. Use a slow resolver injected in the test, or a FUSE (Filesystem in Userspace) stub. Test with standing rules on and off, and for a supported and an unsupported harness. | With standing rules off, or for an unsupported harness, nothing is resolved. Otherwise resolution stops at its time limit and counts as protected. Other agents' runner events and an owner command complete during the stall. | Timings, event order, and the test file. |
| PB-R4-2 | engine/backend, unit 11a | A rule answers a request from a top-level `ask` agent, then from a worker whose lead is paused. | No `OwnerNeeded`, no `DeliveryQueued` and no `client.AlertRaised` is written. `PermissionAnswered` has the service caller. | The ordered events of the transaction, and the output of the alert reactor. |
| PB-R4-3 | engine/backend (E13) and roles/backend, unit 5 | Through the real service entry point, each service calls every command in the group. | Only that service's own list is accepted. `answer`, `board.close`, `start`, `stop` and `board.read` are refused for both services. | `service-caller.test.ts` and `calls.test.ts` output. |
| PB-R4-4 | roles/backend, unit 5 | Scan the imports of `packages/engine/src/roles/**`. | No sheepdog or service file imports the log writer, the runner, the SQL client or the command handler. | The boundary test's output. |
| PB-R4-5 | engine/backend, unit 11a | Through the real resolver, with an empty locations list: a bare-named link to `.claude/settings.json`; a linked folder followed by a missing `settings.json`; a link to the account's configuration folder. | Each is passed to the matcher as protected, and no rule matches. | PC test output. |
| PB-R4-6 | engine/backend, unit 11b | A capacity error on a lead that holds a worker's open permission request. | The request waits behind the hold, and is never answered or moved by the hold. The time it waits is recorded. | The event log of the run. This is for the logic lens to judge (see "Noted, not filed"). |

## Refused

None. No check was stopped by the model's policy.

## Noted, not filed

- **A held lead holds back approvals.** A held agent is idle, and so it is still "available" to `holderAbove` (`holders.ts:14-17`). Its workers' permission requests and questions therefore queue behind the hold for up to about an hour (twelve releases, five minutes apart). This fails safe, because nothing is approved. It is a logic-lens question about flow, recorded as PB-R4-6.
- **Prefix rules and attached short options.** An extra word with an attached short option, such as `-oFILE`, escapes F1's resolution. The owner's warned `prefix` choice already accepts that extra arguments can run code (lead ruling L20).
- **Who judges the "qualifies" gate.** Rollout step 1 and row 81 do not name who decides that a harness qualifies. A wrong call is backstopped: units 3 and 11a still mark the harness `unsupported` through criteria 2.13 and 2.14, so no rule matches it.
- **The plan cites board v5.** The task supplies board v6. Version 6 "changes where the board's code lives and how it joins the engine, and no board rule" (Board:3-9). Every board rule the roles rely on (lead ruling L17's direct pair, `board.status`, `board.flush`, no `board.read` for services) is unchanged.
- **The protected names are not exported.** `isHarnessSettings` is not exported at `8ff4c9b` (`ceiling.ts:317`). Importing its names needs a small export refactor, with no change in behaviour.
- **Accepted risks.** Known gaps 8 (same-user state access) and 20 (a link created after the check) are accepted and correctly scoped. The owner's own switches, snoozes and warned rules are not findings.

## Risk register

| Id | Description | Severity | Fallout | Probability | Score and band | Evidence | Owner |
|---|---|---|---|---|---|---|---|
| F1 | An undefined "path-like word" can leave a bare-named link to a settings file unresolved | 6: a harness's settings are widened until fixed by hand | 5: one owner; undone with help | 2: a narrow reading together with an existing link named in a rule | 60, schedule | unresolved (plan wording; the resolver itself is confirmed sound) | engine/backend, unit 11a; the planner |
| F2 | The services hold unused `answer`, `board.close` and `prompt` rights, and `answer` is checked more weakly than an agent's | 6: an unapproved allow, possibly on a settings write | 5 | 2: needs a service defect together with an open request | 60, schedule | confirmed (CAPI E13, Board:438, `permissions.ts:35-43`) | the lead, carried to the client API plan (E13); roles/backend, unit 5 |
| F4 | Synchronous resolution and an awaited answer can freeze the shared runner path | 4: the service is frozen until the mount times out | 5: may need a restart | 2: a hung network mount named in a command | 40, record | confirmed (code, and the Node.js documentation) | engine/backend, unit 11a |
| F3 | No import boundary keeps the sheepdog on the service path | 6: rights not enforced, and actions recorded as the owner's | 3 | 2: a builder shortcut together with a later wrong action | 36, record | confirmed (CAPI:101, criterion 3.4) | roles/backend, unit 5 |
| F5 | A rule answer for an owner-held agent can raise an approval alert | 2: a spurious push | 3 | 4: a top-level agent or a paused lead | 24, record | confirmed (`holders.ts:45-50`) | engine/backend, unit 11a |
| F6 | `release` has no named rights check and no refusal test | 2: retries spent early | 3 | 2 | 12, record | confirmed (plan text) | engine/backend, unit 11b |

No finding has severity 9 or 10, so the severity floor moves none of them.
The decision, deadline, acceptance and closing-evidence columns are for the
owner and the lead.

## Run log

- **Instructions read:** the reviewer base, the threat-model brief, the plan lenses, the security definition, the finding labels, the risk score and the grading rubric.
- **Plan files read:** the task file and plan v5 in full. I confirmed with `diff -q` that `plan.md` is identical to `attack/plan-v5.md`. I also read the full diff from v4 to v5, and the decision rows listed at the top of this file.
- **Other inputs read:** the known gaps, the rulings, `round-3-findings.md`, my round 3 review and the other threat-model review of round 3. I also read CAPI sections 1, 2, 4 and 6 in full, and Board's header, command table and the section on services.
- **Code checked at `8ff4c9b`:**
  - `commands/CommandHandler.ts:128-177`
  - `routing/permissions.ts`
  - `runner/permissions.ts`
  - `routing/holders.ts:14-55`
  - `identity/ceiling.ts:220-408`
  - `runner/AcpRunner.ts:180-195, 290-318, 370-430 and 505-516`
  - `runner/classify.ts`
  - `routing/deliveries.ts:25-130`
  - `api/server.ts:145-170`
  - `contracts/src/events.ts:150-195`
  - `contracts/src/permission.ts:10-21`
  - I also confirmed that every existing test file that WS-7 names exists.
- **Library claim:** Node.js's synchronous file-system calls block the event loop. I checked this through context7 (`/nodejs/node`, the `fs` documentation) on 2026-11-03.
- **Scope:** I did not open any other reviewer's round 4 file. I sent no messages, and the repository was not changed.
- **Scratch:** I wrote no scratch files. My scratch folder, `scratch/rvr4-tm-opus/`, was never created, so there was nothing to delete.
