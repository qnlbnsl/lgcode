revise
Grade: 5  B/M/m: 1/6/13  Flags: none

# Threat-model review of the client API plan, round 1

This review covers the plan and contract version 7 as refreshed at 15:39 on 2026-11-03, including decision row 90 and criteria 5.4 and 10.1. Code claims are checked at commit `8ff4c9b`. Plan and contract line numbers refer to the refreshed copies. Abbreviations: XFF means the `X-Forwarded-For` header, TLS means Transport Layer Security, CSP means Content Security Policy, and MCP means the Model Context Protocol.

This review does not reopen the owner's decision to leave the web server open. Rulings say that a finding may still show where a plan relies on authentication that the open server does not give, and most findings below do that.

## Summary

The plan's main security limit is who can reach the proxy, and nothing enforces that limit. Its stated protections also have gaps around standing allows and the ntfy token. The Host and Origin rule in row 90 holds, and the shared engine edits are mostly sound. Most fixes are small.

## Findings

### TM-1. BLOCKER: nothing enforces the reach limit that the open server's acceptance rests on

- **Category and responsibility:** Security (isolation); Access.
- **Scenario:** The owner copies the example Caddyfile. Caddy listens on every interface by default, so devices on the home network can reach the proxy, and so can the internet if the host is public or a port is forwarded. Such a caller sends the public `Host` and `Origin` from a program, as row 90 admits any program can. The peer process is the proxy, which passes the guard, and the XFF address is not one of the host's. The caller is now the owner. It starts an agent with full access and runs code on the host, including reading the stored account keys.
- **Evidence:**
  - The owner accepted this risk because "only me on my network" (row 80), and the plan's mitigation is "the owner's WireGuard limits who reaches it" (`plan.md:661`).
  - Criterion 10.3 only checks that the document contains `reverse_proxy` (`plan.md:645`).
  - Criterion 10.4 is positive only: the page opens from the phone (`plan.md:646`).
  - Shephrd has no check on the client's network (rows 84, 89, 90).
  - Caddy's `bind` documentation, read 2026-11-03: "Normally, the listener binds to the empty (wildcard) interface."
- **Suggested fix:** This adds no authentication and changes no owner ruling.
  1. The example Caddyfile uses `bind <WireGuard address>` and a `remote_ip` matcher for the WireGuard network, and criterion 10.3 checks for both.
  2. Proxy mode gains a computer-only setting, "allowed client networks", with no default. A request whose last XFF entry is missing or outside those networks is refused.
  3. Criterion 10.4 gains negative steps: with WireGuard off on mobile data, and from another device on the home network, the upgrade fails.

### TM-2. MAJOR: any other local user or service gets the owner's full control, and the owner was not told

- **Category and responsibility:** Security (isolation); Access.
- **Scenario:** A second account on the host, or a compromised daemon running under its own user, connects to `127.0.0.1` and sends the loopback `Host` and `Origin`. The guard lets it through because "a peer owned by another user id passes". It can then read every thread and act as the owner.
- **Evidence:**
  - Criterion 5.6 (`plan.md:457`) and row 84 allow every other user id.
  - Engine row 37 made the state folder private because "Other users on a shared host could otherwise read every thread."
  - The engine design says "only the owner's user can connect" to the socket (`docs/specs/2026-11-01-engine-design.md:459-465`).
  - The cost the owner was told (`client-api-design.md:107-113`) and the SECURITY.md text (`security-agents-changes.diff:52-54`) name only agents and people reaching the proxy.
  - Known gaps mention another user only as a container an agent runs.
- **Suggested fix:** A peer with another user id passes only in proxy mode, and only when it matches a computer-only "proxy user id" setting. Every other such peer is refused. This keeps Caddy working and also narrows the container bypass. If the plan keeps today's rule instead, SECURITY.md must name this risk and the owner must see it.

### TM-3. MAJOR: a web caller can send any stored secret to any server through the ntfy settings

- **Category and responsibility:** Secrets; Confidentiality. Known gap 3 is wrongly scoped because it covers only redirecting or silencing alerts.
- **Scenario:** A caller reads an account's `secret:<id>` reference from the `accounts` list. It sets the ntfy server to its own address and the ntfy token reference to that account's reference, then waits for any alert. The engine resolves the account's API key and sends it to the caller's server as the carrier's access token. No agent starts, no permission request appears, and the log shows only a settings change.
- **Evidence:**
  - The server, topic and token reference are settable by the web caller (`contract.md:651`, row 88).
  - `SecretStore.resolve` returns any reference (`packages/engine/src/accounts/SecretStore.ts:65`).
  - The `accounts` reply carries account records, which hold the references (`packages/engine/src/commands/CommandHandler.ts:109`, `packages/contracts/src/accounts.ts:23-24`).
  - SECURITY.md rule 6 is not suspended. Row 88's "no new power" is true while the server is open, but the same setting stays on the device list after pairing, and this path needs no agent, so no ceiling or permission request applies.
- **Suggested fix:** Remove the reference from the settings. The carrier has one fixed token slot that is written once and never read back. Changing the server address clears the token. The carrier sends only that slot. A test plants an account's reference and shows it is refused.

### TM-4. MAJOR: the ntfy token has no way in, and restart recovery deletes it

- **Category and responsibility:** Secrets; Integrity.
- **Scenario:** The only command that stores a secret is `accounts set-secret`. It needs an account, and it adds the value to that account's environment, so a token stored this way reaches every agent started on that account. If a unit writes the token to `secrets.json` directly, the next restart deletes it, because recovery keeps only references that accounts name. Pushes then fail at the bounded retry limit, and the owner stops getting phone alerts until the token is set again.
- **Evidence:**
  - `packages/engine/src/commands/accounts.ts:38-50`.
  - `packages/engine/src/runner/AcpRunner.ts:219-227`.
  - `packages/engine/src/recovery/restart.ts:140-147`.
  - Engine row 40 names `accounts set-secret` as the writer. The plan says only "secret references per engine row 19" (`plan.md:520`) and names no write command or change to retention.
  - The redactor learns secrets only from `secrets.json` (`packages/engine/src/service.ts:81-85`), so storing the token elsewhere would leave it unredacted.
- **Suggested fix:** Add a write-only command for the carrier token, and decide whether it is computer-only. Keep the value in `secrets.json`, and add the carrier's reference to the keep set in `collectSecrets`, as a named engine edit with its tests. A test restarts the service and sends an authenticated push. State how the owner rotates or revokes the token.

### TM-5. MAJOR: "Allow always" and settings-write approvals still work from the web, so the computer-only rule does not do what the owner was told

- **Category and responsibility:** Access. This is an unresolved access boundary, so it is a pre-build decision.
- **Scenario:** In ordinary use, the owner taps an agent's "Allow always" option on the phone. The harness keeps a standing allow that was never made at the computer. The plan's mock session may hide that button, but `answer` still accepts any option id, so hiding it binds only the page. An agent's request to write its own harness settings can also be approved from the web.
- **Evidence:**
  - The design note says the computer-only rule "also stops an agent that reaches the page from granting itself a standing allow" (`client-api-design.md:151-153`).
  - The owner path skips the option check (`packages/engine/src/routing/permissions.ts:35-44`, `packages/engine/src/identity/ceiling.ts:391`).
  - Options carry `persistent` (`ceiling.ts:387`), and settings-write requests always go to the owner (`permissions.ts:21`).
  - The plan treats the option as a layout question (`plan.md:570-572`).
  - A device maps to the owner actor before planning (`CommandHandler.ts:205-207`), and E2 uses the caller kind only for the table lookup, so `answer` cannot tell the web from the terminal.
- **Suggested fix:** Ask the owner one question. The recommended answer is that the engine refuses `answer` from a `device` caller for a persistent or always-allow option, and for a settings-write request. That needs the caller kind passed to the planner, as a named edit with tests. It narrows AGENTS.md rule 5 further, so the owner must approve it.

### TM-6. MAJOR: the open-web caller has no named path into the command handler

- **Category and responsibility:** Design; Access.
- **Scenario:** The handler accepts only three credential shapes, and its `device` shape must verify a real `shp_d_` token against the `devices` table. `open-web` has no token. A builder must therefore mint a real device row, which puts a working credential on disk that the Unix socket also accepts. The alternative is to add a no-credential shape to `execute`, the engine's only command entry point. Neither change is named, although the plan says engine behaviour changes only where section 6 names it.
- **Evidence:**
  - `CommandHandler.ts:45-48` and `:205-207`.
  - `packages/engine/src/api/server.ts:87-96`.
  - E12 says the handler "sets it from the device credential" (`contract.md:990`), but `:206` discards the id.
  - Criterion 1.13 covers service credentials only.
  - `DeviceId` accepts any non-empty string (`packages/contracts/src/ids.ts:18`), and no criterion enforces row 81's "never minted".
- **Suggested fix:** Add a named edit: an in-process caller shape that only `webCaller` can build, with no wire or disk form. Add a test that the socket's `authenticate` can never produce it, a boundary test on its constructor, and a test that the id `open-web` is refused for a real device. List the tests it updates.

### TM-7. MAJOR: the client group's own access and visibility table is not written

- **Category and responsibility:** Access; Isolation. This is an unresolved access boundary, so it is a pre-build decision.
- **Scenario:** Unit 2 writes the table, has no attack pass (`plan.md:821`), and has no contract to check against. If `client.alerts.dismiss` includes `agent`, it automatically becomes an MCP tool, and an agent can clear the alert for its own approval. If `client.AlertRaised` is classed `agent-scoped` because it carries an `agentId`, a parent reads its child's alerts. If the alert settings are readable or stored in the log without a class, the ntfy topic leaks, and on a default ntfy server the topic name is enough to read and write alerts.
- **Evidence:**
  - The contract gives access for `client.roster`, `client.thread`, `client.web.settings` and the alert settings only.
  - It gives none for `client.snapshot`, `client.subscribe`, `client.alerts.dismiss`, the alert list or reading settings.
  - It gives no class for any `client.*` event.
  - It does not say where alert settings are stored.
  - Section 1 makes every `agent` entry a tool. E2 says "less `subscribe`", while criterion 2.5 says "exactly the commands whose access includes `agent`" (`plan.md:355`).
- **Suggested fix:** Add one table to the contract, with every `client.*` command and event, its access or class, and where settings live. Default to `owner` and `device`, and to `owner-only`. Resolve the E2 and 2.5 disagreement for streams.

### TM-8. MINOR: other settings that outlast access stay open to the web

- **Category and responsibility:** Access. This is an unaddressed consequence of row 82, not a challenge to it.
- **Scenario:** One moment of reach sets a harness's `adapterPath` and arguments, or an account's environment such as `LD_PRELOAD`. Every later agent start then runs that code. It lives in the log, so it survives closing the proxy and adding pairing. `roles.role-file.set` and `roles.settings.set` persist in the same way.
- **Evidence:**
  - `packages/contracts/src/commands.ts:124-130`.
  - `packages/contracts/src/harnesses.ts:27-28`, `:36`.
  - `packages/engine/src/commands/internal.ts:49-63`.
  - `AcpRunner.ts:219-227`, `:248`.
  - `inputs/roles-plan.md:360`, `:366`.
- **Weight:** A caller with reach can already run code and persist elsewhere, so this adds little power today. It does contradict the reason given for the list: "Each outlives a moment's access."
- **Suggested fix:** Put the question to the owner with TM-5. As a low-cost alternative, push an alert whenever one of these commands arrives with `device: open-web`. The pairing plan should also review every such record when the server closes.

### TM-9. MINOR: `debug.compare-views` is described as device-callable and served on every transport

- **Evidence:**
  - `contract.md:308`, `:688`, `:762`, `:772` and `:839`.
  - The real code offers it only under the test flag and refuses every caller but the owner credential (`server.ts:85`, `:163-165`, engine row 74). So "every engine command that the owner may call, a device may call too" is false for this one.
- **Scenario:** A builder following the text serves a whole-log replay on the open server in production.
- **Suggested fix:** Exclude it from the web server by name, give it `owner` access only, and keep the debug gate in E4.

### TM-10. MINOR: the own-address check passes when the proxy sends no XFF

- **Scenario:** The owner said "a caddy or something". With a proxy that adds no XFF, an agent on the host goes through the proxy and criterion 10.2 never fires.
- **Evidence:**
  - `plan.md:644` and row 89 define only the case where the last entry matches.
  - Caddy itself is fine. Its documentation, read 2026-11-03, says it "sets or augments" XFF and ignores incoming values by default, which answers PB-2 for Caddy only.
- **Suggested fix:** Refuse a public-address request with no XFF. Compare normalized addresses, including IPv4-mapped IPv6 forms and zone suffixes. TM-1's allow-list covers most of this if adopted.

### TM-11. MINOR: Shephrd never checks that remote access is encrypted

- **Evidence:** Row 76 puts TLS at the proxy and SECURITY.md rule 5 requires an encrypted channel, but no criterion checks the public address's scheme or the forwarded protocol (`plan.md:473`, `:643`). The risk row relies on the example alone (`plan.md:663`).
- **Suggested fix:** The settings command refuses a non-`https` public address, and proxy mode refuses a public-address request whose `X-Forwarded-Proto` is not `https`. Caddy sets that header. If the owner wants plain HTTP inside WireGuard, record that as an owner choice.

### TM-12. MINOR: the alert carrier's transport and topic have no stated rules

- **Scenario:** The owner's server is at a home-network address (row 77). If it uses plain HTTP, the token, agent names and links cross the network unencrypted. On a default ntfy server anyone who knows the topic can read alerts or publish fake ones, including a link to a lookalike page.
- **Evidence:** ntfy's configuration documentation, read 2026-11-03, says "everyone can read and write to any topic" by default and that messages are cached for 12 hours. Criteria 6.8 and 6.9 are silent on both points.
- **Suggested fix:** The setup document requires a deny-all default, a write-only token for Shephrd and a read-only one for the phone. The settings command warns on, or refuses, an `http` server with a token. This is the owner's call.

### TM-13. MINOR: alerts do carry agent-chosen text, and its total length is not bounded

- **Evidence:**
  - The overview says alerts never carry an agent's text (`plan.md:65`, `:94`). Row 87 and the contract say the name and team are agent-chosen.
  - Each label is cut to 64 characters, but the number of labels is unlimited (`commands.ts:61`, `:100`, `packages/engine/src/commands/group.ts`).
  - The contract does not say that a piece's alert source cannot supply a title (`contract.md:561`), and criterion 6.5 plants text only in engine sources.
- **Scenario:** A parent starts a child named "Shephrd says safe to Allow", or adds many labels that together form a sentence, and the push shows it.
- **Suggested fix:** Correct the overview. Cap the team field's total length and label count. Show the fields under fixed labels. Type a source's result so that the title comes from a table keyed by kind, and extend 6.5 to piece sources.

### TM-14. MINOR: "every unit that outsiders can reach gets an attack pass" is not what the sizing table says

- **Evidence:** The claim is at `plan.md:65-66`. Units 3, 6b, 7a, 7b and 7c have no attack pass (`plan.md:822-828`).
- **Scenario:** Unit 7b renders untrusted text in the owner's page. A script injection there acts as the owner from the phone, and the guard does not apply.
- **Suggested fix:** Give units 3 and 7b an attack pass, or correct the sentence. Extend 7.4 beyond one `onerror` image to links and any Markdown rendering. Add `base-uri 'none'; form-action 'none'` to the CSP in 5.10, because those two directives do not fall back to `default-src`.

### TM-15. MINOR: the plan has no data inventory, and no plan for deletion or a lost phone

- **Scenario:** A lost phone with WireGuard configured has full owner control, and there is nothing in the page to sign out of. Alerts stay on the phone and the ntfy server after the matter closes, although the overview says Shephrd "clears it" (`plan.md:161`). The `AlertSender` interface has no clear operation. `shephrd thread export` states no file mode.
- **Evidence:**
  - Criteria 3.7, 6.2, 6.7 and 10.3.
  - ntfy's publishing documentation, read 2026-11-03, supports clearing or deleting a delivered notification by sequence id, so the interface can carry this from the start.
- **Suggested fix:** Add one table of every stored copy: log, views, receipts, ntfy cache, phone, browser and export file. Add a criterion that the page keeps no thread data in browser storage. Add a "lost phone" section to `docs/remote-access.md`: remove the WireGuard peer and rotate the ntfy token. Add a clear operation to `AlertSender` and create export files with mode 0600.

### TM-16. MINOR: the mock's list does not protect what the owner reads before approving

- **Evidence:** The mock decides how long tool calls fold and how options are laid out (`plan.md:568-573`), but no rule says a permission request is shown whole. `event.description` is the text the owner approves (`permissions.ts:25`).
- **Scenario:** A long request is folded on a small screen, and the owner approves after seeing only its harmless first lines.
- **Suggested fix:** Add to the mock's list and to criterion 7.4: a request's full text is visible without unfolding before Allow can be tapped, and agent text is visually distinct from Shephrd's own controls.

### TM-17. MINOR: the contract and the roles plan disagree on two access entries

- **Evidence:**
  - The roles plan gives the sheepdog `release` and says the service rights "gain that one command" (`inputs/roles-plan.md:443-448`, `:713`). The contract never mentions `release` and says everything else is refused (`contract.md:344-353`).
  - `inputs/roles-plan.md:363` still reads "owner, and device unless CAPI's question Q2 makes it host-only", and `:695` still treats a stolen phone adding a rule as open, although row 82 decided this.
- **Suggested fix:** Name `release` in section 2 and E13, or state that the roles plan adds it. Fold row 82 into the roles plan.

### TM-18. MINOR: the access check runs after the receipt lookup, not before as the contract says

- **Evidence:**
  - The contract's order is access first, then receipts (`contract.md:168-169`).
  - E2 replaces the check at `CommandHandler.ts:70`, which runs inside `planCommand`, called at `:260`, after the receipt lookup at `:238-259`.
  - A device shares the owner's receipts. So a caller without access that presents an owner's request id and body gets the stored reply. It must know a random UUID, so the risk is low, and the web server's refusal by name comes first.
  - E11's anchor `CommandHandler.ts:236` is off by one; the key is at `:237`.
- **Suggested fix:** Move the check before the receipt lookup in E2, and add a test.

### TM-19. MINOR: SECURITY.md rule 7 is not amended

- **Evidence:** Rule 7 says a message cannot change permissions "unless the owner's credential approves it" (`SECURITY.md:90-92`). The open web server approves with no credential, and the suspension names rule 2 only. The plan's guardrail row lists rule 7 as satisfied (`plan.md:800`).
- **Suggested fix:** Add one sentence to the suspension paragraph, and add TM-2's risk in the same edit if it stays. The owner approves SECURITY.md changes.

### TM-20. MINOR: the connection cap has no number and no fairness, and the guard's scan runs for every connection

- **Evidence:** Criterion 5.11 says only "capped in total" (`plan.md:462`). Row 84 scans the owner's processes on each connection, inside the service process.
- **Scenario:** A reconnect loop or a hostile peer fills the cap, and the owner's phone is locked out while away from the computer.
- **Suggested fix:** State the cap and idle closure. Run the cheap `Host` and `Origin` checks before the scan, and do not let refused connections count against the cap.

## The six responsibilities, traced

| Responsibility | Result |
|---|---|
| Isolation | TM-1, TM-2 and TM-7. Between agents, the read rule (E8) matches L29, `server.ts:155-159` and `holderAbove` (`routing/holders.ts:21`). I found no sibling or stranger path. |
| Identity across sessions | There is no sign-in while the server is open, so sign-out does not apply yet. TM-15 covers what stays on the phone. |
| Access | TM-1, TM-2, TM-5, TM-6, TM-7, TM-8, TM-9 and TM-18. Row 90 holds: `Host` stops DNS rebinding, `Origin` stops other websites, a missing `Origin` is refused, and the public name is accepted only in proxy mode. I found nothing against it. One usability note: a page opened at `localhost` rather than `127.0.0.1` will be refused unless `localhost` is on the list. |
| Integrity | TM-4. E11 and E12's durable caller form, E17's withdrawal check and E23's batch checks are sound on reading. Nothing else found in this lens. |
| Confidentiality | TM-3, TM-11, TM-12, TM-13 and TM-15. The browser-to-proxy hop relies on the owner's setup, and the proxy-to-server hop stays on loopback. |
| Secrets and dependencies | TM-3 and TM-4. Provider revocation has no path for the ntfy token (TM-4). React, Vite, Ink and Playwright each have a stated reason and exact pinning (rows 45, 46, 52). Nothing found on dependencies. |

## Shared engine edits, checked through this lens

- **E1, E3, E5, E6, E7, E10, E16, E19, E20, E21, E22:** nothing found through this lens.
- **E2:** see TM-5, TM-9 and TM-18.
- **E4:** see TM-9. Reads rechecking access on every request is sound, and it keeps read pages out of the receipts.
- **E8:** consistent with L29. Today's filter is as the contract states.
- **E9:** the agent's snapshot sections need TM-7's table.
- **E11, E12:** see TM-6 for the missing open-web path. The anchors resolve, except the one in TM-18.
- **E13, E14:** sound. `authenticate` gains no service branch, and `answer` is refused for services. See TM-17 for `release`.
- **E15:** the claim of exactly three sender fields holds (`events.ts:23`, `:112`, `:162`), as do the named planners and `agentText` (`routing/envelope.ts:22-23`). `deliveries.ts:47` already handles non-agent senders as stated.
- **E17, E18, E23:** consistent with L13, L16, L19, L22 and L23.

## Proposed post-build checks

Each check belongs to the web server or alert unit named.

| Id | Scenario | Expected result | Required evidence | Area |
|---|---|---|---|---|
| TM-PB-1 | A socket is held by both an agent's process and a non-agent process, as after descriptor inheritance or passing | The guard refuses if any holder is an agent, not just the first found | A test with a shared descriptor | Unit 5 |
| TM-PB-2 | The web server starts during restart recovery | It serves no command or stream until recovery is ready, as `server.ts:99` does | A test during recovery | Unit 5 |
| TM-PB-3 | A static request uses `..`, an encoded path or a symbolic link | Nothing outside the page's build folder is served | A test against the real static handler | Unit 5 |
| TM-PB-4 | The ntfy server answers with a redirect, an enormous body or a slow stream | No redirect is followed with the token, reads are bounded, and the reactor keeps running | A test with a fake server | Unit 6b |
| TM-PB-5 | Many upgrades arrive while the writer is busy | The `/proc` scan does not block the service's event loop for long | A timing test on the owner's host | Unit 5 |
| TM-PB-6 | Interactive mode is built | Interactive agents, which do not descend from an adapter, are recorded so that the guard still applies | A test in that plan | Interactive mode plan |

## Refused

None. No check was stopped by a model policy.

## Noted, not filed

- The accepted guard bypasses in known gaps are not refiled, and neither is the open server itself.
- A hostile agent can already read the owner credential and claim any ancestry on the Unix socket (`api/ancestry.ts:6`). SECURITY.md accepts this limit, and it means the computer-only rule is also only a guard until Shephrd has its own user.
- Ruling L29 lets a holder read a worker's whole history while the parent is unavailable. It binds, and the contract states its reason.
- The owner's terminal and the web page share one receipt scope by choice (row 66). Random request ids make a collision unrealistic.

## Risk register

Decision, deadline and closing evidence are left for the owner and the runner. Evidence status is confirmed by reading unless marked.

| Id | Description | Severity (reason) | Fallout (reason) | Probability (reason) | Score and band | Owner |
|---|---|---|---|---|---|---|
| TM-1 | Nothing enforces who can reach the proxy | 9, host control and account keys | 7, data seen, keys exposed | 4, one setup mistake with Caddy's default bind | 252, fix before release | Unit 10 |
| TM-5 | Persistent allows and settings writes work from the web | 6, wrong until fixed by hand | 5, hard to find and undo | 6, an ordinary tap | 180, fix before release | Owner decision, unit 1b |
| TM-4 | The ntfy token has no way in and is deleted at restart | 6, alerts wrong until fixed by hand | 3, the owner can set it again | 8, every restart with a token | 144, schedule | Units 6b and 1b |
| TM-2 | Other local users get full control | 9, full control by another person | 7, data seen | 2, needs a shared host or compromised service | 126, floor moves it to fix before release | Unit 5 |
| TM-3 | A stored secret can be sent to any server | 8, key exposed | 7, cannot be unseen | 2, needs hostile reach | 112, schedule | Unit 6b |
| TM-8 | Persistent settings stay open to the web | 8, lasting code execution | 5, needs manual cleanup | 2, needs hostile reach | 80, schedule | Owner decision |
| TM-16 | A folded request hides what is approved | 4, a wrong approval | 5, an executed command may need manual repair | 4, a long request on a phone | 80, schedule | Unit 7b, mock |
| TM-6 | The open-web caller has no named path | 6, wrong authority path | 3, can be corrected in code | 4, unresolved, scored at worst plausible | 72, schedule | Unit 5 |
| TM-7 | The client access table is unwritten | 4, alerts silenced or read | 3, can be corrected | 6, unresolved, a builder must guess | 72, schedule | Unit 2 |
| TM-12 | The carrier's transport and topic have no rules | 4, names exposed or a fake alert | 3, can be corrected | 6, ntfy's default setup | 72, schedule | Unit 6b |
| TM-15 | No inventory, deletion or lost-phone plan | 6, private text exposed | 5, needs help to recover | 2, a lost phone with access | 60, schedule | Units 6b, 7a, 10 |
| TM-11 | Encryption is not checked | 4, traffic exposed for a while | 3, can be corrected | 4, one setup mistake | 48, record | Unit 10 |
| TM-13 | Agent-chosen alert text is unbounded | 4, a misleading alert | 3, the owner reads the page | 4, specific misuse | 48, record | Unit 6a |
| TM-20 | The connection cap has no number or fairness | 4, locked out for a while | 3, recovers | 4, a reconnect fault | 48, record | Unit 5 |
| TM-10 | No XFF passes the own-address check | 6, an agent past the guard | 3, can be corrected | 2, needs another proxy and a hostile agent | 36, record | Unit 10 |
| TM-14 | The attack-pass claim does not match sizing | 6, injection acts as the owner | 3, can be corrected | 2, needs a rendering defect | 36, record | Lead |
| TM-17 | Contract and roles plan disagree on access | 2, a planning conflict | 3, can be corrected | 6, hit at build time | 36, record | Lead |
| TM-9 | `debug.compare-views` is described wrongly | 2, a heavy read | 3, can be corrected | 4, a builder follows the text | 24, record | Unit 1a |
| TM-19 | SECURITY.md rule 7 is not amended | 2, a document gap | 1, internal | 10, always true | 20, record | Lead, owner approval |
| TM-18 | The access check comes after the receipt lookup | 2, a stored reply shown | 3, can be corrected | 1, needs a known random id | 6, record | Unit 1a |

Read every severity-9 row even where the band is lower. TM-1 and TM-2 are the two rows where a person outside the owner's control gains the owner's full power.
