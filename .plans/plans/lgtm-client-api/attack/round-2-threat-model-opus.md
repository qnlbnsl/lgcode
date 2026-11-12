revise
Grade: 6  B/M/m: 0/3/10  Flags: none

# Threat-model review of the client API plan, round 2

This review covers the plan and client API contract version 8, which folds round 1. Code claims are checked at commit `8ff4c9b`. Paths under `engine/`, `contracts/` and `mcp/` are under `packages/`. `contract.md`, `plan.md`, and the files under `inputs/` and `attack/` are in the review folder.

This review does not reopen the owner's decision to leave the web server open. It does not file the pendency of owner question 6. It does not file anything in `attack/known-gaps.md`, except to say in TM2-5 that one gap is wrongly scoped.

## Summary

Most folds of round 1 hold, and no blocker remains. Three things need a fix in place before the build, because each is a control that the plan claims and that does not do its job.

- The owner's approval on the phone shows the agent's title for the action, not the action (TM2-1).
- A proxied request can be judged as a local browser, so the allowed client networks do not bind it (TM2-2).
- The name `localhost` is trusted, but only `127.0.0.1` is bound, so another local program can hold the trusted origin (TM2-3).

The ten minor findings are local fixes. TM2-5 and TM2-10 matter most among them, because the first control is claimed as the answer to a named gap, and the second touches binding SECURITY.md rule 7.

## Findings

### TM2-1. MAJOR. The owner approves a title, not the action

- **Category:** Security (integrity).
- **Responsibility:** Access.
- **Fold checked:** TM-16, row 118, and criterion 7.12. This fold does not hold.
- **Scenario:** An agent asks permission for a tool call whose title reads "Run command", and whose real input deletes a folder or sends a key elsewhere. The title may be ordinary because of a prompt injection or because the harness writes short titles. The owner reads an alert on the phone, opens the thread, sees the whole of the request's text, and taps "Allow once". Edit E28 keeps "Allow once" available from the phone. The owner has approved text that does not describe the action. An attacker needs no bypass of the guard for this.
- **Evidence:**
  - Row 118 says that `event.description` is the text the owner approves.
  - `engine/src/runner/AcpRunner.ts:411` builds it as `redactText(tool.title ?? "Permission requested")`.
  - `AcpRunner.ts:416` emits `permissionRequested` with `toolCallId`, `description`, `options` and `settingsWrite`, and with no input.
  - The input exists only on the separate, optional thread item (`engine/src/runner/translate.ts:37-40`).
  - `inputs/roles-plan.md:1063` adds `toolKind`, and `toolInput` only for kind `execute`. Lead ruling L27 and `inputs/roles-plan.md:553` build that part only for a harness that qualifies, so it is no general guarantee.
  - Criterion 7.12 (`plan.md:643`) passes when the title is visible, whatever the title says.
- **Suggested fix:** Make this a pre-build decision. One way is for this plan's engine unit to carry the redacted input for every tool kind on `PermissionRequested`, sized as the roles plan sizes it. The other way is for the page to join the request to its thread item by `toolCallId`. In both, the page shows the input unfolded before "Allow" can be tapped. When the input is absent, redacted or cut, the page shows a fixed warning in LGTM Studio's own styling that the action's input is not visible. Extend criterion 7.12 with a test where the title and the input disagree, and a test where the input is absent.

### TM2-2. MAJOR. The loopback rows treat a proxied request as a local browser

- **Category:** Security (isolation).
- **Responsibility:** Isolation.
- **Fold checked:** TM-1, ruling 1, and rows 89 and 91. Ruling 1 says that a request whose last forwarded address is missing or outside the allowed networks is refused. The fold holds only for a request that names the public address.
- **Scenario A, proxy mode on:** The owner uses nginx or another proxy with a minimal configuration. nginx's defaults send `Host` as the upstream's name, and a plain `proxy_pass` adds no `X-Forwarded-For`. A browser through that proxy sends the public address in `Origin`, gets row 1043, and is refused, so the owner sees a broken page and fixes the browser path. A program outside the allowed networks that can reach the proxy sends `Origin: http://127.0.0.1:8787`. It names no public address, has no forwarded address, and matches "On, Loopback, Missing" (`contract.md:1048`). The peer is the proxy, which passes the guard by `proxyUserId` or by the same user id. The caller then has the owner's control.
- **Scenario B, proxy mode off:** The owner turns proxy mode off, and a proxy running as the owner's user keeps running. A client sends a loopback `Host` and `Origin` through it, on a proxy site that does not match by host name. Row 1041 ignores forwarded headers and accepts. So turning proxy mode off does not close the path.
- **Evidence:**
  - `contract.md:1041` and `contract.md:1048` are the two rows.
  - The nginx documentation, read 2026-11-03, gives the defaults `proxy_set_header Host $proxy_host` and `Connection close`, and it shows `$proxy_add_x_forwarded_for` only as a variable (https://nginx.org/en/docs/http/ngx_http_proxy_module.html).
  - The owner said "a caddy or something" (`inputs/client-api-design.md:23`).
  - Post-build check PB-2 (`plan.md:794-799`) tests what the proxy sends, but no decision says what follows from a proxy that fails it.
- **Suggested fix:**
  - Judge a peer that matches `proxyUserId` under another user id as public always, and never by the loopback rows.
  - In proxy mode off, refuse any request that carries a forwarded header. A local program that forges one only hurts itself.
  - In `docs/remote-access.md`, require the proxy to set `X-Forwarded-For` and `X-Forwarded-Proto`, and recommend that it run as its own user.
  - State the remaining limit for a same-user proxy in proxy mode on: a proxy that adds no forwarded address cannot be told from a local browser. PB-2 must then treat a missing header as a failed check, not a fact to record.

### TM2-3. MAJOR. `localhost` is an allowed name, but the server binds only `127.0.0.1`

- **Category:** Security (isolation).
- **Responsibility:** Isolation.
- **Fold checked:** TM-2 and row 92. Refusing another user's peer holds. This new allowance undoes part of it.
- **Scenario:** Any local process binds `[::1]:8787`, beside the real server on `127.0.0.1:8787`. The owner opens `http://localhost:8787`, and the browser reaches the squatter if it tries `::1` first. The squatter's page has the origin `http://localhost:8787`, which is on the allow-list. Its script opens `ws://127.0.0.1:8787` from the owner's own browser, a peer that is same-user and not an agent, so the guard passes. The attacker gets the owner's control. For another Unix user on the host, this removes the benefit of row 92. For an agent, it gives a simple route, because a command such as `xdg-open` starts a browser outside the question of whether the page's connection has an agent ancestor. A related case is a squatter on `127.0.0.1:8787` while the real server is down: the alert reads `client.web-down`, and the page the owner opens is fake.
- **Evidence:**
  - Row 113 and `contract.md:313-314` list `127.0.0.1` and `localhost` as allowed names.
  - Criteria 5.1 and 5.4 test binding and names, not the other address family.
  - A probe on Node.js v26.13.0 on this host bound `127.0.0.1:48787` and `::1:48787` side by side. `dns.lookup("localhost")` answered `::1` first, and `getent ahosts localhost` listed `::1` first.
  - The browser's own choice of address was not tested. It is a post-build check below.
- **Suggested fix:** Drop `localhost` from the `Host` and `Origin` allow-list, and print and link only `http://127.0.0.1:<port>`. The other acceptable fix is to bind `::1` as well, and to refuse to serve if either bind fails. Add a test to 5.4 that an `Origin` naming a name that was not bound is refused. Tell the owner in the documentation that the page is at `127.0.0.1`.

### TM2-4. MINOR. Narrowing the web settings leaves live connections open

- **Category:** Security (isolation).
- **Responsibility:** Access.
- **Scenario:** The owner suspects a peer and removes its network from `allowedClientNetworks`, or changes `proxyMode` or `proxyUserId`, at the computer. The peer's open WebSocket keeps full control, because the table judges a request once, and a WebSocket is one request.
- **Evidence:** Only `enabled` off closes connections (`contract.md:1027`). `contract.md:1423` says that the per-connection recheck (`engine/src/api/server.ts:119-127`) does not apply to the web caller.
- **Suggested fix:** Any `client.WebSettingsChanged` closes all web connections, so each reconnect is judged by the new settings. Add this to criteria 5.16 and 10.2.

### TM2-5. MINOR. The lasting-setting alert can be turned off by the caller it watches

- **Category:** Security (integrity).
- **Responsibility:** Integrity.
- **Known gap wrongly scoped:** The gap "A caller of the open web server can change the alert carrier's server and topic" speaks of redirecting or silencing alerts. The gap "Lasting settings stay open to the web" then names the `client.lasting-setting` alert as the control. These two cannot both stand as written.
- **Scenario:** A web caller turns off that kind's push, or clears the token so that the owner's server refuses the sends, then changes a harness's adapter path. The owner gets nothing on the phone. The caller can also dismiss the record. A change of carrier sends its own alert through the new carrier, so the owner's phone never hears of it.
- **Evidence:**
  - The sources are `HarnessChanged`, `AccountChanged`, `client.AlertCarrierChanged` and the roles' two events (`contract.md:733-734`).
  - `client.alerts.settings.set` and `client.alerts.carrier.clear-token` have access `owner, device` (`contract.md:1000`, `:1003`), and neither is a source.
  - Open alerts go through the carrier that was just set (`contract.md:818`).
- **Suggested fix:**
  - Add `client.AlertSettingsChanged` and `client.AlertCarrierTokenCleared` as sources.
  - Make the `client.lasting-setting` kind's push not switchable by a device caller.
  - Make the terminal list open and dismissed records, so that dismissing from the web does not hide one from the computer.
  - Rewrite the known gap to say that a carrier-change alert cannot reach the old carrier, or else send that one alert through the old carrier as well.

### TM2-6. MINOR. `set-token` binds the token to whatever server is current

- **Category:** Security (integrity).
- **Responsibility:** Secrets and dependencies.
- **Scenario:** A web caller changes the server to an origin it holds, and the token is cleared, as designed. Alerts stop. The owner sees alerts failing, goes to the computer, and runs `set-token` from a habit or a runbook. The token now goes to the attacker's origin, bound to it. This defeats the purpose of the binding in row 93. The private exception also allows `http://127.0.0.1:<port>`, so a local program can receive it.
- **Evidence:** `contract.md:884-895` takes only a value and a nonce, and records the origin at that moment. Criterion 6.14 (`plan.md:588`) tests no origin confirmation.
- **Suggested fix:** The command takes the origin in its payload, and the planner refuses a mismatch with the current server. The command-line form prints the current server and requires the owner to confirm it or pass it as an argument. Add the refused mismatch to 6.14.

### TM2-7. MINOR. An account's environment can read the carrier's token slot

- **Category:** Security (isolation).
- **Responsibility:** Secrets and dependencies.
- **Fold checked:** TM-3 and row 93. The direction from carrier to account holds. `SecretReference` (`contracts/src/accounts.ts:4`) refuses a dotted name, so `Account.secret` cannot name the slot. The reverse direction is open.
- **Scenario:** A caller sets an account's environment to `FOO=secret:client.alerts.carrier`. The schema passes, because it checks only secret-looking names (`contracts/src/accounts.ts:9-16`). The runner resolves any value that starts with `secret:` into the agent's environment (`engine/src/runner/AcpRunner.ts:219-227`). `collectSecrets` keeps any account's `secret:` value (`engine/src/recovery/restart.ts:145`), so a cleared token is no longer removed. So "No read returns the value" (`contract.md:888`) and "a cleared value goes at once" (`contract.md:1826`) both fail.
- **Fallout today:** This adds no power today, because agents can read `secrets.json` (accepted, row 78). It becomes a real bypass when LGTM Studio gets its own user.
- **Suggested fix:** The planners of account writes refuse an environment value naming a reserved reference, and the runner refuses to resolve one. Extend the boundary test of criterion 6.13 to this direction.

### TM2-8. MINOR. E27's collection at run time can delete a secret that was just committed

- **Category:** Bug.
- **Responsibility:** Integrity.
- **Scenario:** Today's collection runs only during recovery at start-up, when no commands run (`engine/src/commands/CommandHandler.ts:199`). E27 also runs it from the alert worker (`contract.md:1826`). The worker computes its keep list. Then `accounts set-secret` writes a new reference and commits (`engine/src/commands/accounts.ts:42-46`). Then `retainOnly` removes everything outside the list (`engine/src/accounts/SecretStore.ts:51-55`). The log now names a secret with no value, and the agent's start fails with "account secret is unavailable" (`AcpRunner.ts:223`) until the owner enters it again. A quick `set-token` after a clear can lose the new token the same way.
- **Evidence:** The store's semaphore serializes only single file operations (`SecretStore.ts:57-64`). Criterion 1.39 (`plan.md:347`) has no concurrent case.
- **Suggested fix:** Compute the keep list and remove under `log.withWriterPermit` (`engine/src/log/EventLog.ts:287`), or have the worker remove only the one slot under that permit, leaving full collection at start-up. Add a test to 1.39 that interleaves a secret-setting command.

### TM2-9. MINOR. E12's reserved device id names two places that cannot hold it

- **Category:** Design.
- **Responsibility:** Identity across sessions.
- **Fold checked:** TM-6 and row 66. The path of the `open-web` credential is good. The reserved-id part is not testable as written.
- **Scenario:** A later pairing plan writes a device with the id `open-web`, by a route that neither named place sees. Its acts then read in the log as acts of the open web caller, and the lasting-setting rule treats them so.
- **Evidence:**
  - `contract.md:1424-1426` puts the refusal in `mintDeviceCredential` and in `DeviceAdded`'s planner.
  - `mintDeviceCredential` takes no id (`engine/src/identity/devices.ts:12-15`).
  - No planner emits `DeviceAdded` (`scouting.md:81-82`, and a search of `engine/src` at this commit finds only the view at `views/apply.ts:328`).
  - So the last clause of criterion 1.34 (`plan.md:342`) has nothing to test.
- **Suggested fix:** Enforce the refusal where it can hold: in the `DeviceAdded` event schema and in the `sideRows.devices` insert (`engine/src/log/EventLog.ts:202-205`). Test it there.

### TM2-10. MINOR. `client.thread` over MCP hands an agent another agent's raw text, and the allow-list goes

- **Category:** Security (integrity).
- **Responsibility:** Isolation.
- **Scenario:** A lead calls `client.thread` on a child, through the Model Context Protocol (MCP) tool, and the child's output holds text aimed at the lead. It comes back with no data envelope. Engine deliveries wrap agent text (`engine/src/routing/envelope.ts:22-23`), and the board and the roles wrap theirs (`inputs/board-contract.md:194`, `:334`; `inputs/roles-plan.md:525`, `:941`). The roles plan then sends the lead to `client.thread` for the rest of a hand-off (`inputs/roles-plan.md:926`). So the longest part of the text arrives with the fewest protections. SECURITY.md rule 7 is the rule involved, and edit E15 covers deliveries only.
- **Second part:** `mcp/src/tools.ts:5-8` says "Row 55: an explicit allow-list. A new agent command is reviewed before it becomes a tool". Contract `:137-139` and E2 replace it with a list derived from access, so `client.snapshot`, `client.roster`, `client.thread` and every later piece's agent command become tools with no review step. E1 also turns the test "exactly ten commands for the MCP server" into a check that the engine's commands are present (`contract.md:1131-1134`), so no test notices a new tool. The access table is a review of who may call, not of whether its output is safe to hand to a model.
- **Suggested fix:** For an agent caller, return each thread page inside the data envelope, with a fresh marker and an escaped leading slash. Keep an explicit list for each piece, or pin the derived list in the test of `contracts/test/commands.test.ts`, so a new tool shows up as a changed test.

### TM2-11. MINOR. The carrier's server has no canonical form

- **Category:** Security (integrity).
- **Responsibility:** Secrets and dependencies.
- **Scenario:** A server such as `https://user:pass@host` is stored in `client.AlertCarrierChanged`, and comes back through `client.alerts.settings` to every client, and through the log. Forms such as `http://127.1` or `http://[::ffff:192.168.1.1]` may be judged differently by the rule for private literals and by the HTTP client, and the origin comparison of row 93 depends on one spelling.
- **Evidence:** `publicAddress` has one canonical form (`contract.md:1031`). The carrier rules at `contract.md:902-907` have none. Criterion 6.15 (`plan.md:589`) tests the scheme and redirects only.
- **Suggested fix:** Parse with the URL standard's parser. Refuse user information, a path, a query and a fragment. Store the canonical origin. Judge the private exception on the parsed host. Validate the topic's characters. Test the forms above.

### TM2-12. MINOR. "Accounts without secrets" is not defined, and the page is the first path off the host

- **Category:** Security (isolation).
- **Responsibility:** Confidentiality.
- **Scenario:** The owner stores `DATABASE_URL` or `GH_PAT` as a plain environment value. The schema's filter does not catch these names (`contracts/src/accounts.ts:9-16`). The value is stored in `AccountChanged`, and it reaches every web client through `accounts` (`engine/src/commands/CommandHandler.ts:109`), `subscribe` and the snapshot, and so reaches the phone and any proxy log of the traffic.
- **Evidence:** `contract.md:422` says "accounts without secrets" and does not define it. SECURITY.md rule 6 is the rule involved.
- **Suggested fix:** Define the snapshot's account section as names of environment variables and flags saying whether each is a reference, with no values. State that the event stream carries what was entered. Warn in the documentation to use `accounts set-secret`. Add a test with a non-matching name.

### TM2-13. MINOR. The SECURITY.md and AGENTS.md changes state more than the design delivers

- **Category:** Design.
- **Responsibility:** Access.
- **Evidence:**
  - `inputs/security-agents-changes.diff`, AGENTS.md lines 10-15, says that "Three commands are the exception". `set-token` (row 94), `debug.compare-views` and E28 are further exceptions, and the rulings asked for these to be listed for the owner.
  - In SECURITY.md lines 48-71, "Two limits stay in force", the first limit reads as firm, and only the second has a caveat. While the server is open, a web caller can start an agent or set an adapter, and such a program can read the owner credential and claim its ancestry, because the socket trusts "the caller's claimed ancestry" (`engine/src/api/ancestry.ts:6`, `engine/src/api/server.ts:107`). So the computer-only rule is also a guard for now.
  - `inputs/client-api-design.md:152-153` says that it "stops an agent that reaches the page from granting itself a standing allow". A reader will take that as stronger than it is.
- **Scenario:** The owner, or a later planner, relies on "computer only" as a boundary when deciding what may wait for pairing.
- **Suggested fix:** Add one sentence to each document, and tell the owner together with question 6. This does not reopen question 6.

## Folds of round 1 that were checked

| Round-1 item | Result |
| --- | --- |
| TM-1, ruling 1 | Holds for a request naming the public address. See TM2-2 for the loopback rows. |
| TM-2, row 92 | Holds for another user's peer. See TM2-3. |
| TM-3, row 93 | Holds from carrier to account. See TM2-7 for the reverse. |
| TM-4, E27 | Holds: a token used by no account survives a restart. See TM2-8 for the new run-time race. |
| TM-5, E28 | The anchors are correct (`engine/src/routing/permissions.ts:21`, `:25`, `:35-44`; `contracts/src/permission.ts:10-21`). `reject_always` and unknown kinds are covered. The refusal's receipt under `owner` is harmless, unlike E2's access refusal, because it stores no reply that a replay could use to get past a check (`CommandHandler.ts:260-266`). |
| TM-6, E12 | Holds, except the reserved id (TM2-9). |
| TM-7 | The access table is complete for the commands listed. |
| TM-9 | `debug.compare-views` stays out of the web group. Holds. |
| TM-10, TM-11 | Hold for requests naming the public address. |
| TM-12 | The limit is documented. Holds. |
| TM-13 | The bounds hold. |
| TM-15 | The inventory of stored copies is good. It leaves out proxy access logs, the service log and `protocolLog`, which should be listed. |
| TM-16, row 118 | Does not hold. See TM2-1. |
| TM-18, E2 | The reorder is sound (`CommandHandler.ts:238-264`). |
| TM-20 | Holds. |
| Sol TM-1, Sol TM-3 | The same as TM-1 and TM-3. |
| Sol TM-2 | The snapshot is built from one views value. Holds. |
| Sol TM-4 | This gate is not a security control. Nothing to add. |

## Trace of the six responsibilities

- **Isolation.** The web caller is one owner-level identity, by the owner's decision. The remaining isolation is the guard and the proxy table. TM2-2 and TM2-3 are where it fails short of its claim. TM2-7 and TM2-12 concern what crosses between sections.
- **Identity across sessions.** The record `caller: owner, device: open-web` holds for the act itself. Follow-on writes of a web `start` or `resume` carry only the actor (`engine/src/commands/start.ts:79`, `:83`; `engine/src/commands/resume.ts:46`), so the contract's "the log always shows" holds for the act and not for its follow-on writes. No check depends on them today, so this is noted, not filed. TM2-9 covers the reserved id.
- **Access.** E2's table and its order are sound. Computer-only commands are refused on the web. TM2-1 is the gap at the human decision. TM2-4 covers changed settings on live connections. TM2-13 covers how the limits are described.
- **Integrity.** Receipts stay per caller, and the access check runs first. TM2-5 covers a control the watched caller can switch off. TM2-8 covers the secret store race. Agent text as data is held for deliveries by E15, and is not held for `client.thread` (TM2-10).
- **Confidentiality.** Alerts carry no thread text by rule, and the inventory of copies is good. TM2-12 covers plain environment values. TM2-11 covers user information in a carrier address.
- **Secrets and dependencies.** The token slot, its binding and "no redirects" are good design. TM2-6, TM2-7 and TM2-11 are the gaps. No new dependency raises a concern through this lens.

## Check of engine edits E1 to E28

The consumers are board contract version 8 and roles plan version 8. "Consistent" means that the consumer's use matches the edit. All the existing tests that the contract names exist at the commit: `contracts/test/commands.test.ts`, `cli/test/parity.test.ts`, `engine/test/commands/authorization.test.ts`, `engine/test/api/auth.test.ts`, `engine/test/api/per-request-credential.test.ts`, `engine/test/api/compare-views-rpc.test.ts`, `engine/test/routing/text-is-data.test.ts`, `engine/test/live-check/rendered-prompts.test.ts`, and `engine/test/recovery/restart.test.ts` (6.7 R22 at l.606). Through this lens, I found no changed existing test that goes unnamed.

| Edit | Result through this lens |
| --- | --- |
| E1 One command group | The silent replacement in `RpcGroup.merge` is met by the new `contracts/test/unique.test.ts`. E1 also loosens the test "exactly ten commands for the MCP server" (`contract.md:1131-1134`), which is the pin that TM2-10 asks to keep. |
| E2 Access table | Sound, and the order is correct. The automatic tool list is in TM2-10. |
| E3 Planner table | Nothing found. |
| E4 Read table | Nothing found. |
| E5 Event union | Nothing found. |
| E6 Piece views | Nothing found. |
| E7 Migrations and side rows | Nothing found. |
| E8 Visibility function | Nothing found. Today's rule is kept. |
| E9 Snapshot sections | "Accounts without secrets" is in TM2-12. The agent's snapshot sections are a post-build check. |
| E10 Command-line names | Nothing found. |
| E11 Caller schema | The follow-on writes are noted in the trace. |
| E12 Acting device | TM2-9. |
| E13 Service path | Consistent with the roles' `release`, `roles.record` and sheepdog's board commands. |
| E14 A service's answer names its rule | Consistent with the roles plan. |
| E15 Sender and envelope | Sound. Compaction is not affected, because its content is `compact`, not text (`engine/src/commands/compact.ts:9`). The board's sender label `board` is consistent (`inputs/board-contract.md:334`). `client.thread` is outside it (TM2-10). |
| E16 Delivery source | Consistent with the board. |
| E17 Withdraw own delivery | Consistent with the board. |
| E18 Reach check | Consistent with the board's rule 4 and with switching the board off (`inputs/board-contract.md:585`). |
| E19 Settled test | Nothing found. |
| E20 Request held | Consistent with the board's conditions. |
| E21 Paged read | The read is sound for owner and holder under L29. The missing envelope for an agent caller is TM2-10. |
| E22 Helpers | Nothing found. |
| E23 Piece batch path | Consistent with the board and the roles. |
| E24 Stream dispatch | Nothing found. |
| E25 Tolerant wire form | Nothing found. The engine stays strict. |
| E26 Browser entry | Nothing found. The boundary test keeps Node imports, and so the local credential lookup, out of the browser module. |
| E27 Secret collection | The slot is kept. TM2-7 and TM2-8 are the gaps. |
| E28 Web caller's answers | The anchors are correct. The folded answer is reviewed in the fold table, and its usefulness depends on TM2-1, because "Allow once" remains. |

## Proposed post-build checks

These are questions that only a running build can answer. None replaces a fix above.

1. With a program bound to `[::1]:8787`, open `http://localhost:8787` in the owner's browser, and record which server answers. This confirms the browser step of TM2-3, if `localhost` stays.
2. Publish a test alert to the owner's ntfy server with a non-ASCII agent name, and with a name that holds a URL. Confirm that the send does not fail, and that the name is not a tappable link. The ntfy publish page could not be fetched on 2026-11-03, so these are unconfirmed.
3. Flood alerts against ntfy's default visitor limits. The documentation gives a bucket of 60 requests, refilled at one per 5 seconds, with `Retry-After` on the limit (https://docs.ntfy.sh/config/, read 2026-11-03). Confirm that a burst which uses up five attempts does not silently lose a real approval alert, and that the loss shows as `final`.
4. Read an agent's snapshot from a live build, and confirm that it holds no accounts, devices, alerts or harness sections.
5. Grep the service's log after a run with refused credentials and forwarded addresses, and confirm that neither is written.
6. Export a thread with `thread export` over an existing file, and confirm that the result keeps mode 0600 or the command refuses.
7. Confirm that the `open-web` credential has an opaque brand, because a structural `{ _tag: "open-web" }` would compile anywhere in TypeScript.
8. On the owner's phone, confirm that the Content Security Policy's `connect-src 'self'` allows `wss` through the proxy.

## Refused

Refused: none.

## Noted, not filed

- The open server, the guard's bypasses, and the lack of an own user are accepted by the owner, and are in the known gaps.
- The page's build folder is writable by agents, which is one more route past the guard. It could be added to the list of ways the guard fails.
- A holder's read of a whole history under L29 is binding, so it is not filed.
- An agent holder can answer a moved request after its read of the asker has ended. This belongs to the logic lens.
- `enabled` is on by default, by the owner's choice.
- A wide `allowedClientNetworks` is the owner's own choice.
- Plain HTTP to a private ntfy server is allowed by ruling 3.
- A hostile agent can cause load with connection scans (PB-4), but a hostile agent can already stop the engine.
- Harness arguments settable from the web limit what E28 gives. Row 98 accepts this.
- The carrier as a way to reach internal addresses adds no power while the server is open. It should be looked at again with pairing.

## Risk register

Score is severity × fallout × probability, each from 1 to 10. Bands: 400 or more, fix now; 150 to 399, fix before release; 50 to 149, schedule; under 50, record. The floor: severity 9 or 10 with fallout 7 or more is at least "fix before release", unless probability is 1. The decision, the deadline and the closing evidence are left for the owner and the runner.

| ID | S | F | P | Score | Band | Reasons |
| --- | --- | --- | --- | --- | --- | --- |
| TM2-1 | 6 | 5 | 6 | 180 | Fix before release | S: an action runs that the owner did not see. F: one agent's reach. P: short titles are common, and the owner decides on a phone. |
| TM2-2 | 9 | 7 | 2 | 126 | Fix before release (floor) | S: owner's control from outside the allowed networks. F: the whole machine's agents. P: needs a proxy with minimal settings and a caller who can reach it. |
| TM2-3 | 9 | 7 | 2 | 126 | Fix before release (floor) | S: owner's control from the owner's own browser. F: the whole machine's agents. P: needs a squatter, the `localhost` link, and a browser that tries `::1` first. |
| TM2-10 | 6 | 5 | 4 | 120 | Schedule | S: injected instructions reach a lead. F: the lead's children. P: leads are sent to this read by the roles plan. |
| TM2-4 | 6 | 6 | 3 | 108 | Schedule | S: a peer the owner shut out keeps control. F: owner-level. P: needs a live connection at the moment of the change. |
| TM2-12 | 7 | 5 | 3 | 105 | Schedule | S: a credential is exposed. F: one credential's service. P: needs a plain value under a non-matching name. |
| TM2-5 | 5 | 5 | 4 | 100 | Schedule | S: a named control fails silently. F: lasting settings. P: needs a caller who already passed the guard and acts on purpose. |
| TM2-6 | 6 | 4 | 3 | 72 | Schedule | S: a token goes to the attacker. F: the ntfy account. P: needs the owner to re-enter it without checking. |
| TM2-8 | 5 | 3 | 3 | 45 | Record | S: a secret is lost. F: one account until re-entered. P: a short window. |
| TM2-13 | 3 | 3 | 5 | 45 | Record | S: a wrong sentence. F: later decisions. P: documents are read often. |
| TM2-9 | 7 | 6 | 1 | 42 | Record | S: confused log identity. F: the audit record. P: needs a future plan to skip the check. |
| TM2-7 | 5 | 4 | 2 | 40 | Record | S: a token read. F: the ntfy account. P: adds nothing until an own user exists. |
| TM2-11 | 5 | 4 | 2 | 40 | Record | S: a password in the log, or a wrong origin check. F: the ntfy account. P: needs an unusual address. |
