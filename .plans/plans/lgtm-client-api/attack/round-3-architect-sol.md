revise
Grade: 7  B/M/m: 0/1/2  Flags: none

# Architect review of the client API contract, version 10

The plan needs an authorized recovery route for agent subscribers. Two smaller revisions concern the snapshot's stated byte bound and the order in which commands enter the production group. These are local changes to this plan.

The review uses the read-only checkout at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. Repository paths below are relative to that checkout. `plan.md`, `contract.md`, `decisions.md` and `attack/` refer to the frozen lgtm-client-api folder. `inputs/` refers to the review run's inputs folder.

I read the assignment, reviewer rules, owner and lead rulings, design outcome, approved document diff, known gaps, and the earlier finding folds. I checked the shared edits against the recorded engine and the board and roles inputs. Node.js 26.13.0 was selected with `nvm use`. The checkout remained clean. No implementation tests were run. The checkout has no installed dependencies, and this assignment reviews a plan. The proposed checks below are not passing test results.

## Findings

### R3-A1. An agent's filtered subscription cannot recover an oversized state event

Severity: MAJOR. Category: Design and Bug. Evidence status: Confirmed contract contradiction. Responsible builder: the contracts and client library lane, with the read-handler lane.

Scenario: An agent subscribes to `client.subscribe`, then starts a child with a 300 KiB first prompt. The child is visible to that agent. Its `AgentStarted` event exceeds 256 KiB and becomes a marker. The library must fetch the event before applying later events or advancing its cursor. Its fetch is refused because `client.event` excludes agents. Reconnection encounters the same marker and the same refusal. Depending on retry exhaustion, the subscription loops or fails; it cannot converge through the promised recovery procedure.

Evidence:

- `contract.md:1178` grants `client.subscribe` to an agent. `contract.md:1179` and `contract.md:648` grant `client.event` only to the owner, a device and a service.
- `contract.md:1133` replaces events over 256 KiB. `contract.md:1141` requires automatic recovery of every known state-bearing tag through `client.event`, and `contract.md:1145` prohibits advancing the cursor on a failed read.
- At the recorded commit, `packages/contracts/src/events.ts:102` embeds the first delivery in `AgentStarted`. Its prompt text is an unrestricted string at `packages/contracts/src/events.ts:25`. The start planner actually constructs that embedded delivery at `packages/engine/src/commands/start.ts:42`.
- The existing visibility filter permits structural children at `packages/engine/src/api/server.ts:155`. E8 preserves that case and adds the effective-holder case (`contract.md:1547`).
- The agent row is created by `AgentStarted` at `packages/engine/src/views/apply.ts:177`. Skipping it is not a content-only omission.

Suggested fix: Give an agent subscription an authorized recovery route for every state-bearing marker it can receive. One option is to permit agent `client.event` under the same event visibility rule, with the appropriate protection for agent-visible text and a deliberate update to the derived Model Context Protocol tool pin. Another is to specify automatic recovery through the already authorized thread read for agents. Preserve the rule that agents cannot read global engine events without an `agentId`. Add a real agent-credential case to `event-read.test.ts` and `oversized-state.test.ts`: the large child start, a later small event, and a reconnect must all converge with no skipped state.

This is a consequence of the round 2 marker repair's new dependency on `client.event`. The owner's recovery route itself is supplied.

### R3-A2. A permission display part is not bounded to 4 KiB

Severity: MINOR. Category: Design. Evidence status: Confirmed sizing contradiction. Responsible builder: the snapshot and contracts lanes.

Scenario: A request has one permission option whose id contains 8,192 ordinary ASCII characters. The snapshot includes the option's id whole. That id alone exceeds the promised 4 KiB display-part limit, regardless of the preview or option name. A larger id or kind can grow the part further. Restricting the display to eight options does not bound their strings.

Evidence:

- `contract.md:473` caps previews, option count and option names, but includes each option's id and kind without a byte cap. `contract.md:477` concludes that the entire display part is at most 4 KiB. `contract.md:1150` relies on construction, rather than only the fixture, for this bound.
- At the recorded commit, `packages/contracts/src/events.ts:38` defines option ids as non-empty strings and kinds as unrestricted strings.
- `packages/engine/src/runner/permissions.ts:14` preserves both values. `packages/engine/src/runner/AcpRunner.ts:403` checks identifiers against redaction, and `packages/engine/src/runner/AcpRunner.ts:412` maps the options without a length limit.
- The copied Agent Client Protocol schema also defines an unrestricted option id at `third_party/t3code/effect-acp/src/_generated/schema.gen.ts:1043`.
- The uncapped number of agents in `attack/known-gaps.md` is a separate issue. This counterexample needs one request and one option.

Suggested fix: Define the budget over the fully encoded display part, including its string fields and escaping. If a part cannot fit, omit that optional display part, retain the complete identity row, and require the existing full-event read for display and approval. Account for the omission in the display count. Do not truncate an authoritative option id into a different answer id. Add long-id, long-kind and escaped-string cases alongside the ordinary snapshot fixture.

The limited consequence is an unsupported size guarantee and extra snapshot traffic. The plan intentionally sends whole single replies, so the evidence does not establish a dropped record or a permanently wrong view.

### R3-A3. Unit 2 installs commands whose handlers belong to its dependent units

Severity: MINOR. Category: Design. Evidence status: Confirmed dependency contradiction. Responsible builder: the plan lead and the contracts lane.

Scenario: Unit 1a establishes the invariant that every production command has exactly one planner or read handler. Unit 2 then merges the whole client group. Its read handlers arrive in unit 3, web settings handlers in unit 5, and alert and token handlers in units 6a and 6b. Those units depend on unit 2. The required coverage check therefore cannot remain green at the completion of unit 2 as scoped.

Evidence:

- `contract.md:1398` requires every command to appear in exactly one handler table. `plan.md:318` makes this criterion 1.3 and names `packages/engine/test/commands/planner-table.test.ts`.
- `plan.md:434` defines the client group, and `plan.md:435` merges it into `CommandsRpcGroup`.
- `plan.md:479` assigns the client read handlers to unit 3. `plan.md:556` assigns web settings work to unit 5. `plan.md:612` and `plan.md:614` assign alert and token planners to units 6a and 6b.
- `plan.md:967` through `plan.md:971` place those units after unit 2. `plan.md:298` requires root `pnpm check` for each affected unit.
- Today the server enumerates the served group's requests at `packages/engine/src/api/server.ts:153`, dispatches them at `packages/engine/src/api/server.ts:166`, and supplies that group to the server at `packages/engine/src/api/server.ts:168`. Installing a declaration is part of server composition.
- The current Effect version 4 API exposes the group's requests and derives its handler context from the group. See the [RpcGroup reference](https://effect.website/docs/v4/api/effect/rpc/RpcGroup), checked on 2026-11-03.

Suggested fix: Separate schema definition from installation into the production group. Move installation and the corresponding integration criteria after the required handlers exist, or move the required handler work into the unit that installs the group. Reassign unit 2's snapshot and visibility integration tests to match. Keep the exact handler-coverage check and avoid temporary unsupported handlers. Also put unit 3 before unit 7a's situation view, whose live data comes from those reads (`plan.md:972`).

This is a build-order defect with development impact. No failing build was executed.

## Risk register

The owner sets fix, accept or defer decisions. Those decisions remain unset. No acceptance or closing evidence exists for these new findings.

| Id | Severity score and reason | Fallout score and reason | Probability score and reason | Product and band | Evidence | Responsible builder | Owner decision | Deadline |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R3-A1 | 6. The advertised subscription stops converging until a caller changes its route or the contract is fixed. | 3. The affected caller can use the engine stream as a workaround; stored events remain intact. | 6. A large initial prompt or permission event is a specific legal use, and the access failure is deterministic once it occurs. | 108. Schedule. | Confirmed contract contradiction. | Contracts, client library and read handlers. | Unset. | Within this phase, or a dated follow-up assigned by the owner. |
| R3-A2 | 2. A promised traffic bound is exceeded; no hard outbound cap makes this proof a data-loss case. | 3. The affected client can still read the reply, with more traffic. | 4. An unusually long adapter option is uncommon, but requires no second fault. | 24. Record. | Confirmed sizing contradiction. | Snapshot and contracts. | Unset. | Review at the end of this phase. |
| R3-A3 | 1. The consequence is a build and unit-completion gap. | 1. It affects development. | 10. The written merge order encounters the coverage invariant every time. | 10. Record. | Confirmed dependency contradiction. | Plan lead and contracts. | Unset. | Review at the end of this phase; required checks must pass before merge regardless of this score. |

## Round 2 blocker and major folds

These are checks of the revised design. They are not implementation verification.

| Earlier finding group | Result of checking version 10 |
| --- | --- |
| R2-L1; R2-A1; R2-TM-1; logic Opus major 1; the shared live-collection concern | The repair holds at plan level. Collection is startup-only; runtime removal names one fresh carrier value (`contract.md:1051`, E27). The account barrier test is explicit at `contract.md:2092`. This addresses the actual store-before-commit window at `packages/engine/src/commands/accounts.ts:42` and the file-only semaphore at `packages/engine/src/accounts/SecretStore.ts:57`. |
| R2-A2; R2-L3; R2-TM-2; logic Opus major 3 | The repair holds. Generation comes from committed carrier or token events, old-generation results cannot settle current delivery, destination replacement re-pends open alerts, token replacement preserves delivered marks, and retry continues at the cap (`contract.md:925`, `contract.md:950`). Criterion 6.11 includes an hour-long outage. |
| R2-A3 | The repair holds. `openMatters(views)` is an explicit per-piece table over rebuilt views (`contract.md:860`). It is independent of bounded snapshot sections and of the one-envelope source function. The baseline and scan remain one batch under the reactor rules. |
| TM2-1 | The repair holds. E29 carries the request's redacted input for every tool kind, with absence and truncation flags (`contract.md:2119`). The page must read the event and show the action before Allow. Current title-only construction is confirmed at `packages/engine/src/runner/AcpRunner.ts:411`. Roles match only execute input. |
| TM2-2 and TM2-3 | The repair holds within the accepted guard's limits. A proxy-user peer is public, forwarded headers are refused with proxy mode off, the public rows require the forwarded client and HTTPS, and only 127.0.0.1 is a trusted local name (`contract.md:1230`; `decisions.md:141`, `decisions.md:142`). The same-user proxy limit is already disclosed. |
| C2-01; R2-L2; logic Opus major 4 | Whole-event repair addresses the owner's missing-state case (`contract.md:1137`). The agent access consequence is R3-A1. Complete identity rows address missing open requests; the claimed per-display byte bound still has the limited defect R3-A2. |
| C2-02 | The repair holds. A fresh physical value is stored before its selecting event commits, so a failed commit leaves the earlier token selected (`contract.md:1041`). The nonce and named origin remain part of the command. |
| C2-03 | The repair holds. The helper reads piece lists at open, on candidate settlement, and on each named event that can change `ownerHeld` (`contract.md:703`). Thus a post written while its author stays working can trigger the read. The sequence agreement rule remains at `contract.md:740`. |
| Logic Opus major 2 | The repair holds. E17 and E18 require a withdrawal to restore idle in the same batch when the existing reloaded predicate holds and no queued or sent delivery remains (`contract.md:1805`, `contract.md:1844`). This covers both reactor and dispatcher withdrawals. |
| Logic Opus major 5 | The repair holds. Leaving stopped or crashed re-runs the raise rule for still-open owner-held questions (`contract.md:912`). Permission requests retain their process-specific distinction. |

The smaller folds also have concrete homes: source-less dismisses, device propagation through reload and read marks, the reserved device id at the event and side-row boundaries, uniqueness before merge, the client's shared wait fold, and the web-outage supervisor. I found no additional contradiction in those folds. They still require the named build tests.

## Audit of the shared engine edits and consumers

All E1 to E29 were checked. The table groups related edits to show their writer and reader boundaries. No additional confirmed omission of a required existing-test update was found beyond the installation ordering in R3-A3.

| Edits | Recorded engine and revised boundary | Consumer and test assessment |
| --- | --- | --- |
| E1, E2, E10 | The group and access lists become composed declarations. The credential kind is retained before the owner mapping and before receipt lookup (`packages/engine/src/commands/CommandHandler.ts:197`, `packages/engine/src/commands/CommandHandler.ts:238`). | Board and roles can add their groups without changing their engine rights. The existing contracts command test, command inventory and CLI parity files are named. The Model Context Protocol list is derived and pinned. R3-A3 concerns installation order. |
| E3, E4 | The planner switch at `packages/engine/src/commands/CommandHandler.ts:67` and the inline reads at `packages/engine/src/api/server.ts:153` have explicit replacement tables. Stored replies and engine after-commit hooks remain distinct from fresh reads. | This supplies board reads with marks and deduplicated piece commands. Handler, authorization, lifecycle, permission, receipt, compare-views and subscription test changes are named. The read-marks test covers access loss before resend. |
| E5, E6 | The event union and lifecycle table are exhaustive (`packages/contracts/src/events.ts:88`, `packages/contracts/src/stateMachine.ts:79`). Views currently thread events by `threadAgent` and apply reducers (`packages/engine/src/views/apply.ts:122`, `packages/engine/src/views/apply.ts:338`). | Piece tags receive explicit keep rows and stay outside engine threads. Apply, rebuild, compare-views, fixtures, event round trips and complete visibility samples are named. Roles' later engine tags still need explicit lifecycle rows. |
| E7 | The current migration ledger uses one integer key (`packages/engine/src/log/migrations.ts:73`). E7 adds piece migrations and transactional side rows. | Board and roles can add prefixed tables. Global migration identity and restart idempotence are implementation checks below. Existing append and receipt tests are named. |
| E8, E9 | Visibility is extracted from `packages/engine/src/api/server.ts:155`. Snapshot sequence comes from the same views value; views are published before committed-event notification (`packages/engine/src/log/EventLog.ts:136`). | This supplies the board's caller-specific summary and full-view hold inputs. The exact existing grandchild visibility assertion is named and deliberately changed. The snapshot publication barrier is an explicit new test. R3-A1 and R3-A2 concern new client behavior. |
| E11, E12 | Actor stays suitable for parents and holders (`packages/contracts/src/events.ts:8`). Caller, rule and device acquire a durable form and one decoder, replacing the current limited decoder (`packages/engine/src/log/subscribe.ts:36`). | This supplies both service attribution and device attribution without making services holders. Append, catch-up, receipt, rebuild, handler and authentication tests are named. Live, catch-up, rebuild and paged reads must agree. |
| E13, E14 | Services use an in-process allow-list. Permission answer attribution widens, while ordinary answer authorization remains at the holder check (`packages/engine/src/routing/permissions.ts:35`). | The roles' standing-rule service needs no command rights. The sheepdog's exact engine commands and later release command are accounted for; a service still cannot call answer. Roles' two-write pre-check stays engine code and receives one combined wait check (`inputs/roles-plan.md:1034`). Authentication, service caller, permission and round-trip cases are named. |
| E15, E16, E17 | Sender widening covers all three event fields. The old return path special-cases an agent sender (`packages/engine/src/routing/deliveries.ts:45`). The recovered-working predicate is explicit (`packages/engine/src/routing/deliveries.ts:222`). | This supplies board wake wrapping, own-namespace withdrawal, source-specific return behavior and correct idle repair. Round-trip, text-is-data, rendered-prompts, delivery and move-withdrawal tests are named. |
| E18, E23 | Every piece delivery is checked on its projected queue state and fresh send state. The writer remains serialized at `packages/engine/src/log/EventLog.ts:242`; existing send reservation occurs before external delivery (`packages/engine/src/routing/deliveries.ts:239`). | This meets board reach checks for inside-tree, outside-tree and caller-less wakes (`inputs/board-contract.md:147`). Own events precede generated deliveries, so WakeBuilt is visible to the check. Planner, read marks and reactor batches have explicit refusal and receipt behavior. Delivery and carry-on tests are named, with fixture-piece and import-boundary tests added. |
| E19, E20, E22 | Settled, held and member reasons currently live at `packages/engine/src/routing/waits.ts:33` and `packages/engine/src/routing/waits.ts:49`. They move as pure functions, alongside the shared client fold. | Board conditions receive both its view and delivery statuses, as required by `inputs/board-contract.md:415`. Request-held checks cover blocking agent waits. Owner waits obtain sequenced piece lists. Existing waits and capability-05 tests are named. The roles capacity hold remains an engine queue condition owned by that later unit (`inputs/roles-plan.md:1123`). |
| E21 | The current envelope's agent id and the thread rule differ for queued deliveries (`packages/engine/src/log/EventLog.ts:175`, `packages/engine/src/views/apply.ts:122`). The new indexed thread column preserves that distinction. | The backfill and shared decoder cover old and new reads. The plan deliberately retains the agent visibility limit for a no-agent-id queued envelope. New tests compare paged owner threads with rebuilt threads. |
| E24, E25, E26 | The current stream helper always invokes subscribe and updates its cursor in the stream tap (`packages/client/src/index.ts:199`, `packages/client/src/index.ts:201`). Tag dispatch, tolerant wire decoding and browser construction have explicit homes. | These are needed by the web page and pane viewer. Existing client behavior is retained, with real-frame compatibility and browser-boundary tests added. R3-A1 covers an authorization dependency of marker repair. |
| E27 | Startup collection currently keeps only account references (`packages/engine/src/recovery/restart.ts:140`). Account writes use fresh names before the log commit (`packages/engine/src/commands/accounts.ts:42`). | The client token keep entry, reserved-prefix checks and narrow removal satisfy the new token lifecycle without broad runtime collection. Restart test R22 is named, and the real-file store barrier is explicit. |
| E28, E29 | Device-specific answers narrow the current permission path; optional action fields extend the current runner event (`packages/engine/src/routing/permissions.ts:35`, `packages/engine/src/runner/AcpRunner.ts:415`). | Permission test updates and new action-field tests are named. E29 owns the all-tool input capture once; the roles matcher consumes execute only. Question 6 remains an explicit owner decision and is not a finding. |

The board and roles inputs were frozen on contract version 9. Their older references to lazy marker recovery, owner-held refresh, and execute-only input capture need the lead's stated version 10 fold. I have not filed that declared version lag as a new defect.

The split keeps schema and pure predicates in contracts and writers in the engine, as ruling L28 requires. It supplies the board and roles with the needed narrow tables and delivery requests. I found no additional mechanism that needs removal. The simpler remedies for R3-A1 and R3-A3 use the reads and static composition already planned.

## Migration, release and rollback assessment

The release has three persistent changes to coordinate: new event tags, wider caller forms with rule and device columns, and the thread index with its backfill. The plan names each writer and routes catch-up, rebuild and paged reads through one decoder (`contract.md:1659`, `contract.md:1905`). Nullable new fields preserve old rows.

The rollback text correctly stops promising an old-binary rollback after a new tag or caller is written. The current reader is strict (`packages/engine/src/log/subscribe.ts:36`), and rebuilt views use decoded envelopes. Disabling the web listener and setting the carrier to none while keeping the new readers is a credible operational rollback (`plan.md:257`). Deleting events or restoring an old database would lose work and is not proposed. R3-A3 is the remaining composition-order issue.

## Library and service documentation checks

These checks used Context7 on 2026-11-03. They support feasibility, rather than proving the unbuilt transport.

- Effect's current [RpcGroup reference](https://effect.website/docs/v4/api/effect/rpc/RpcGroup) describes merge, the request map and handler derivation. Its [Socket reference](https://effect.website/docs/v4/api/effect/Socket) describes the global WebSocket constructor and its browser limitations. The browser split is therefore necessary. Context7's pinned index supplied 4.0.4, while the current reference is newer. Attempts to retrieve the exact 4.0.5 source through the documentation fetch failed. Exact pinned serialization and acknowledgement behavior remains a build check.
- [Vite's browser compatibility guidance](https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility) supports the requirement to remove Node imports from the browser graph. A production bundle is still needed.
- [ntfy publishing](https://docs.ntfy.sh/publish/) documents sequence-id updates and deletion by sequence id. [ntfy configuration](https://docs.ntfy.sh/config/) documents the configurable 12-hour default cache duration. These support the carrier protocol and retention wording. The owner's deployed version and phone behavior still require PB-5.
- [Caddy reverse proxy defaults](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults) support the forwarded-header assumptions. Its [remote_ip matcher](https://caddyserver.com/docs/caddyfile/matchers#remote-ip) concerns the immediate peer. The real proxy configuration, process user and address normalization still require PB-2.
- [Ink's testing guidance](https://github.com/vadimdemedes/ink#testing) supports testing terminal render output. It does not prove Herdr's pane launch or terminal behavior, which remains a real integration check.

## Proposed post-build checks

| Check | Scenario and expected result | Evidence needed |
| --- | --- | --- |
| Agent marker recovery | Use an actual agent credential, a visible child's oversized start and permission request, then later small events and a reconnect. Recover each state event before advancing; deny unrelated and global events. | Real encoded frames, the read authorization result and applied cursor trace. Include R3-A1's chosen repair route. |
| Snapshot encoded budget | Use long option ids, unknown kinds, Unicode and escaping. Every included display part fits its declared encoded budget. Identity rows remain complete and answer ids remain exact. | Encoded byte measurements and a successful full-event answer using the original option id. |
| Unit composition | Run root checks at each revised integration boundary. Every installed command has one handler; no stub is needed to complete an earlier unit. | Actual unit dependency graph, production-group inventory and root check summaries. |
| Snapshot publication | Hold a commit between SQL completion and views publication. Snapshot plus resumed stream contains every transition exactly once. | The E9 barrier test through the real read and stream handlers. |
| Transaction boundaries in owner waits | Split one committed batch across network chunks, including QuestionAnswered followed by its reply DeliveryQueued. Also exercise a roles auto-answer with two writes. The helper never returns on a transient intermediate state. Repeat with no board installed. | Engine wait result compared with client wait result and the exact applied/decision sequences. The current log publishes individual envelopes (`packages/engine/src/log/EventLog.ts:130`), so transport chunk boundaries alone are insufficient evidence of transaction boundaries. |
| Marker download and acknowledgement | Delay a full state-event read beyond five seconds while its marker arrives promptly. Preserve cursor ordering and keep recovery progressing without a permanent acknowledgement/reconnect cycle. | Installed Effect 4.0.5 transport traces, including acknowledgements and separate RPC replies. Do not infer this from decoded-object tests. |
| Piece batches and fresh reach | Revoke board membership between queue and reservation. Withdraw the invalid wake, continue to the next queued delivery, and judge waits after idle repair. Race this with a reactor withdrawal. | One committed event sequence, dispatcher calls and views/rebuild equality. Exercise both a normal idle target and a recovered-working target. |
| Durable callers and migrations | Upgrade a database from the recorded commit. Run engine, client, board and roles migrations twice, including a crash during an entry. Preserve old rows, unique migration identities, caller rule and device, and indexed thread contents. | Migration ledger, database rows, and equality across live, catch-up, rebuild and paged reads. The existing global integer ledger at `packages/engine/src/log/migrations.ts:73` makes identity allocation worth checking. |
| Token lifecycle | Hold an account secret after store and before commit; clear and rotate the carrier token; fail a token event commit; restart. Preserve the account secret and last committed token, and collect only abandoned values at startup. | Real-file SecretStore barrier tests, selected references and successful resolutions. Include a redaction check without printing secret values. |
| Alert generation and outages | Hold an old send result across destination and token changes. Keep a carrier down for an hour, restart during backoff, then recover it. Each currently eligible open alert eventually delivers in the right generation. | Fake-clock committed delivery history, late-result barriers and real ntfy sequence-id/delete checks on the owner's version. |
| First start and returning questions | Install client alerts after board and roles matters already exist. Kill the baseline transaction, restart, then resume a stopped asker whose owner-held question remains open. | Baseline/position history, one open key per matter, zero baseline sends, and a newly raised question alert after resume. |
| Real browser, proxy and pane | Build the browser entry for production; exercise the real Effect web transport's inbound cap, Caddy header cases, settings-change connection closure, and Herdr's pane action. | Existing PB checks on the owner's host, production import graph, real proxy request captures with secrets excluded, and pane launch evidence. |

## Noted, not filed

- The open web server, lack of a separate Unix user, same-user proxy ambiguity, process-tree bypasses, lasting settings, and plain account values on the stream are declared or accepted limits. I have not reopened them as new security objections.
- The question 6 answer, extension scope confirmation, new scope files, dependency setup and issue-list updates belong to the owner or lead as the known-gaps file says. They do not justify a new implementation finding here.
- The stopped-asker question row and the no-agent-id delivery visibility limit are known engine gaps. The alert lifecycle and thread index do not claim to repair those engine semantics.
- The number of agents and complete identity rows remain uncapped. R3-A2 concerns the separate, explicit bound on an individual display part.
- The real proxy, ntfy deployment, Herdr action, browser transport and filesystem guarantees cannot be certified from this frozen plan. Their named post-build checks remain necessary.
- Forward the three new findings to the lead for `docs/issues.md` in the change that resolves or records them. This reviewer has written no repository issue entry, feature entry, code change, commit, session report or journal.
