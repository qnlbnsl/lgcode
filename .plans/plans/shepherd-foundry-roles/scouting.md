# Scouting — shepherd-foundry-roles

Scout returns, written as they arrived. This file is gate 8's anchor source.
Paths without a prefix are relative to the repository root at commit
`8ff4c9b`. `FOUNDRY` means
`~/.claude/plugins/marketplaces/founder-os/plugins/harness-sessions/skills/software-foundry`.

## Scout S: the Foundry's watcher scripts (returned 2026-11-03)

All paths are under `FOUNDRY/scripts/`. Line numbers are per file.

**pane-input.sh** (sourced by the other five; defines `input_empty` and `safe_to_type`)
- `input_empty <agent>` (l.12-22) runs `herdr agent read <agent> --source visible`. It parses the screen with awk: the lines between the last two `────` rules must be exactly `❯`. Claude panes only.
- `safe_to_type <agent> [focused]` (l.23-31) calls `input_empty` repeatedly. Unfocused: 2 reads, 3 s apart (`PANE_INPUT_GAP`). Focused: 3 reads, 10 s apart (`PANE_INPUT_FOCUSED_GAP`). Any non-empty read returns false.
- Callers skip the check for non-Claude agents (Codex).
- Herdr command: `herdr agent read`.

**collect.sh** (subcommands `start`, `status`, `stop`, `_run`)
- `start <waiter> <label>` (l.9, 81-95) with `--files <path>...`, `--expect-post <author>[:<kind>]`, `--done-marker <text>`, `--timeout-min` (default 90), `--board-team <team>`, `--authors a,b`.
- Env defaults (l.26-30): `POLL_SECONDS` 60, `REPING_SECONDS` 3600, `BUSY_DEFER_POLLS` 10, `FOUNDRY_COLLECT_DIR`, `SYNAPSE_TEAMS_DIR`, `COLLECT_HERDR`.
- Watches (`evaluate`, l.37-77): result files that exist, are non-empty and contain a line equal to the marker; `<teams>/<team>/board.jsonl` posts after the start sequence from a matching author and kind; posts from `--authors` go into the digest (last 20, 160 characters each).
- Fires (`_run`, l.153-170): when everything has arrived, it sends the digest and "Full digest: <path>" to the waiter, writes `done` and exits. After the timeout it sends "TIMEOUT. <digest> ..." and repeats hourly until `stop`.
- `deliver` (l.142-152): defers while the waiter is `working` (up to 10 polls); for a Claude waiter, defers while `safe_to_type` is false, with no cap; logs WAKE-FAILED and retries.
- Herdr calls: `herdr agent get`, `herdr agent prompt`, `herdr agent read`. No `herdr-synapse` command.
- Screen needed: only for the Claude draft guard.

**board-waker.sh**
- Flags (l.186-209): `--interval 120`, `--after 240`, `--after-fast` (default `--after`), `--fast-kinds question,blocked,request`, `--repeat 0`, `--muted-only`, `--once`.
- Watches (l.218-260) every `<teams>/*/board.jsonl`: cursors, `mute.json`, posts addressed by name; ignores `retract`, `direct`, retracted posts, system bookkeeping and self-addressed posts. Fast age for urgent posts, the human's posts and fast kinds.
- Fires (l.261-275): only when the member is idle or done and, for Claude, `safe_to_type` passes. Prompt: "You have unread board posts addressed to you. Run: herdr-synapse board --new, then act on them." One prompt per oldest unread post per member; repeat only after `--repeat` seconds.
- Herdr calls: `herdr agent get`, `herdr agent prompt`, `herdr agent read`.

**team-idle-watch.sh** (subcommands `watch`, `snooze`, `status`)
- `watch <team> <area> <manager>`; `snooze <team> [hours=6]`; `status <team>`. Env `IDLE_SECONDS` 3600, `POLL_SECONDS` 300.
- Watches (l.42-45): `herdr tab list` for tabs ending `:<area>`; `herdr agent list` for the team's agents or agents in those tabs. Only `working` counts as busy; idle, done and blocked count as stopped. Exits when the team folder disappears.
- Fires (l.46-60): after `IDLE` seconds with no busy pane, and at least `IDLE` since the last ping, it prompts the manager "Team X has had no pane working for N min (names=status,...) ... snooze this watcher". Repeats hourly; a snooze suppresses it.
- Herdr calls: `herdr tab list`, `herdr agent list`, `herdr agent get`, `herdr agent prompt`, `herdr agent read`.

**context-keeper.sh**
- Args (l.80-96): `<run folder>`, `--once`. Env: `CTX_TOKENS` 150000, `WANT_MIN_TOKENS` 60000, `WORKER_MAX_MIN` 120, `EVERY` 300, `COOLDOWN` 1200, `ADVISOR_OK`, `HUB_TEAM`.
- Watches (`pass`, l.117-157): `herdr agent list` (name, kind, team role, team, status, session, focus); the Claude transcript via `last_call` (l.105-109); `$RUN/.context-keeper/want-<name>`; each worker's first transcript timestamp; `/proc/<pid>` of Claude processes; settings files for `advisorModel`.
- Fires, compaction (leads, relayers, manager; Claude only): status idle or done; not already compacted at the same last model call; cooldown passed; tokens at least `CTX_TOKENS`, or a `want-` file and tokens at least `WANT_MIN_TOKENS`. Prompts the long `/compact ...` text, guarded by `safe_to_type`.
- Fires, worker cap: a worker whose first transcript timestamp is at least 120 minutes old gets one post to its team, kind request, asking the lead to hand off at a safe point.
- Fires, advisor check (`advisor_check`, l.159-184): posts the hub team about Claude processes with an unapproved advisor, and settings files with `advisorModel`.
- Commands: `herdr agent list`, `herdr agent prompt`, `herdr agent read`, `herdr-synapse post`.

**capacity-retry.sh** (subcommands `watch`, `status`)
- `watch <manager> [workspace]`; env `BACKOFF_SECONDS` 300, `POLL_SECONDS` 30, `MAX_RETRIES` 12, `CAPACITY_RE`.
- Watches (l.239-260): every non-working agent; `stuck` reads the pane (`herdr pane read <pane> --source recent-unwrapped --lines 60`) and matches the last 4 non-empty lines above the input box.
- Fires: prompts `continue` after the backoff and every 5 minutes while the error persists; at 12 retries it prompts the manager once ("... Move its work to the model sheet's alternate.") and stops retrying that pane.

**Answers**
- (a) capacity-retry.sh needs the screen for detection, because the error text exists only on screen. The other four need it only for the draft guard before typing into a Claude pane. Codex panes are exempt from the guard.
- (b) Yes. `last_call` reads the newest `"usage"` record in the Claude transcript and sums `.message.usage.input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, tracking `.message.id`. Codex and Cursor seats are skipped.
- (c) Yes. Default regex `Selected model is at capacity|API Error: 529|overloaded_error|model is currently overloaded`. Usage limits are not matched.

## Scout E: the engine's surface for the roles (returned 2026-11-03)

Paths are under `packages/`.

**1. Commands.** `contracts/src/commands.ts:commandNames`: start, prompt, answer, pass-up, ask, wait, stop, resume, compact, group, accounts, accounts set-secret, accounts mark-available, harnesses, subscribe, debug.compare-views. Schemas are `Rpc.make(...)` entries in `CommandsRpcGroup`; also `DebugRpcGroup`, `ServiceRpcGroup`, `ownerOnlyCommands`, `commandAccess`. Owner-only: accounts, accounts set-secret, accounts mark-available, harnesses, debug.compare-views.
- `start` payload (`commands.ts:45-65`): requestId, name, role (`Schema.String`), harness, account (`named{accountId}` | `any`), model?, effort?, permission (`PermissionLevel`), folder, runMode?, groups?, prompt?. Success `{requestId, agentId}`.
- `permission` is `read-only|ask|edit|full` (`contracts/src/permission.ts:permissionLevels`).
- `role` is a free string; no values are defined.
- `group` {agentId, add[], remove[]}; `wait` {members[min 1], mode any|all, block}; `answer` permission {id, optionId} | question {id, text}; `subscribe` {requestId, after}.

**2. Role behaviour in the engine: no.** `role` is stored only: `engine/src/commands/start.ts:38` (into `AgentStarted`), `engine/src/views/apply.ts:14,178`. Nothing in the engine, CLI, MCP server or client branches on it.

**3. Events** (`contracts/src/events.ts:Event`): AgentStarted, AgentStartFailed, SessionOpened, StateChanged, ModeChanged, ModeRefused, AgentCrashed, AgentInterrupted, AgentReloadFailed, AgentStopped, AgentGrouped; PromptSent, ThreadItem, TurnStarted, TurnEnded; PermissionRequested, PermissionAnswered, PermissionMoved, PermissionCancelled; QuestionAsked, QuestionAnswered, QuestionMoved; OwnerNeeded; WaitOpened, WaitMemberResolved, WaitSatisfied, WaitCancelled; DeliveryQueued, DeliverySent, DeliveryAccepted, DeliveryRequeued, DeliveryReturned, DeliveryWithdrawn; AccountChanged, AccountNeedsSignIn, AccountOutOfUsage, AccountAvailable, HarnessChanged; DeviceAdded, DeviceRevoked, CommandRefused.
- `OwnerNeeded` `{agentId, reason, subject?: permission{id}|question{id}}`.
- `PermissionRequested` `{agentId, permissionRequestId, holder: Actor, deliveryId, toolCallId, description: string, options[min 1], settingsWrite: boolean}`. Option `PermissionOption {id, name, kind, level, persistent}`; kinds from `contracts/src/permission.ts:acpPermissionOptionKinds`, mapped by `permissionForOptionKind`. No separate tool-name field and no command-text field beyond `description`.
- `WaitSatisfied` `{agentId, waitId, members: WaitMember[]}`; `WaitMember` `{agentId, reason: settled|crashed|stopped|paused|interrupted}`; `WaitMemberResolved` `{agentId, waitId, member}`.

**4. Permission answering.** `engine/src/routing/permissions.ts:answer` and `routing/holders.ts:mayActForHolder`: the owner may always answer; an agent only when it is the effective holder (`holderAbove`). Settings writes are held by the owner. Agent answers are gated at `permissions.ts:38-43` by `row.settingsWrite` and `identity/ceiling.ts:canAnswerOption` (l.384-408): unknown kind → owner; `persistent` → owner (l.395); settings or harness config path → owner; above the agent's mode → refuse. An agent cannot answer with allow_always; the answer is refused, and the holder can `pass-up` (`holders.ts:passUp`). Runner side: `runner/permissions.ts:mapPermissionOption`, `settingsWrite`. Questions: `routing/questions.ts:answerQuestion` uses `mayActForHolder` only.

**5. Waits.** `routing/waits.ts:189-192` (inside `wait`): every member's nearest available ancestor (`holderAbove`) must be the caller, or the whole wait is refused. A grandchild qualifies only while its own parent is stopped, crashed, paused or interrupted. Only agents may wait. No timeout field. CLI exit codes (`cli/src/commands/wait.ts:reportWait`): satisfied 1 if any member crashed or stopped, else 2 if any paused or interrupted, else 0; opened 0; request-held 2; cancelled 1.

**6. Subscribe** (`engine/src/api/server.ts:153-160`). Owner and device credentials get every event. An agent gets only events whose `agentId` is itself or a direct child; events without an `agentId` are dropped. No filter by group or event type. Stream: `engine/src/log/subscribe.ts:subscribe`.

**7. Group and read queries.** `commands/group.ts` emits `AgentGrouped`; no routing uses groups. No list-agents, get-agent or read-thread command exists. The only read paths are `subscribe` and the owner-only `accounts list` and `harnesses list`.

**8. Compact and context size: no.** `commands/compact.ts:compact` queues a `{_tag:"compact"}` delivery; `runner/compact.ts:compactPrompt` sends `/compact` when advertised. `TurnEnded` carries only `compact: boolean`. No event carries context size, token counts or cache usage. `runner/translate.ts` ignores every ACP session update except message chunks, plan and tool_call.

**9. Pause and crash.** `contracts/src/stateMachine.ts:LifecycleState` `paused {reason: limit|signed-out, midTurn, resetAt?}`, written by `StateChanged` from `engine/src/routing/deliveries.ts:pauseAgent` and `promptReply`. `AccountOutOfUsage {accountId, resetAt?}`, `AccountNeedsSignIn`, `AccountAvailable`; `OwnerNeeded` when signed out or no reset time. `runner/resetTime.ts:resetTimeFromError`. `AgentCrashed {agentId, exitCode, signal, stderr}` from `recovery/crash.ts:64`. Capacity errors are not told apart: `runner/classify.ts:classifyError` returns only `out-of-usage|signed-out|undefined`; other errors become a generic error reply that `deliveries.ts:failed` returns to the sender (`DeliveryReturned`). No 529 or "overloaded" string in the engine.

**10. MCP tools** (`mcp/src/tools.ts:toolNames`): answer, ask, compact, group, pass-up, prompt, resume, start, stop, wait. Not exposed: subscribe and owner-only commands.

**11. Extension point: no.** `engine/src/service.ts` is a closed top-level program (layers `EventLog`, `Views`, `AcpRunner`, `Restart`, `CommandHandler`, then `application({ownerCredential, debug})`); no subscriber, hook or registry. A later piece must change engine code or run as a separate process. Client library (`client/src/index.ts`): `connect(options)` (l.117) → `Client = RpcClient<Rpcs>`; `subscribe` (~l.192-215) auto-resumes after the last sequence; `unary` (~l.168-183) retries. `client/src/identity.ts:resolveIdentity` knows only agent (`SHEPHRD_SOCKET` + `SHEPHRD_TOKEN`) or owner (`<state>/owner-credential`).

**12. Device credential: unclear, leaning no.** `engine/src/identity/devices.ts:mintDeviceCredential`, `verifyDeviceCredential`; `CommandHandler.ts:205-208` maps a device to `actor = {_tag: "owner"}`, so a device has full owner rights. Nothing mints devices yet. The owner credential is refused when the caller's ancestry includes an adapter (`api/server.ts:107`, `outsideAdapters`).

## Scout L: the Synapse list and Shephrd's issues (returned 2026-11-03)

Source A: `/home/qnlbnsl/projects/personal/herdr-synapse/docs/message-board/features.md` ("Synapse-list"; header l.3-4: "draft list, not approved"; owner decisions marked inline).
- 14 (l.104) "Never type into a box that has text in it". Use Herdr's `prompt_if_idle`; keep the several-reads rule.
- 21 (l.153) "Subscribe to an event": branch moves, merges, test-run ends, `RESULT: done`.
- 22 (l.158) "Collections built in": wake me once when all of these have arrived, one digest, a timeout. Retires `collect.sh`.
- 23 (l.167) "A work state for every member": Off, Assigned, Working, Waiting (on whom), Done; "revised with the owner on 2026-10-25". Owner, 2026-10-25: "I can't really think of a time where things would be waiting on anything other than a different agent or team."
- 24 (l.196) "A stalled member is noticed": assigned stalls after 5 min not started; working stalls when idle with no new transcript action for 10 min (worker) or 20 min (lead); waiting never stalls while the awaited agent works. Wake once ("You have work. Continue, or mark it done."); still stalled 10 min later → lead; stalled lead → manager; stalled manager → owner. Replacement (l.214-221), owner 2026-10-25: "if a worker keeps stalling, then we should tell the lead to recreate it because something's wrong with that worker." Three stalls back to back on the same work, with no progress between, → the lead is told to replace it. "The owner accepted these limits on 2026-10-25." Open question 2 (l.531-535) still lists the time limits and the three-stall rule as open. Retires `team-idle-watch.sh`.
- 26 (l.232) "The manager runs its own teams". Retires `synapse-owner.sh`.
- 28 (l.241) "Only the right people can mute".
- 31 (l.257) "Idle leads are compacted before they get huge". Retires `context-keeper.sh`.
- 44 (l.404) "Approval prompts on by default".
- 46 (l.413) "Compaction on the Foundry's terms": absolute token count per team; compaction prompt per role or per piece of work.
- 47 (l.418) "An agent stuck on an approval prompt is reported" to its lead.
- 48 (l.421-423) work running too long → lead alerted; continues in a fresh agent.
- 50 (l.427) "Finishing work does not wake the lead once per worker".
- 55 (l.456) "Workers talk on a need-to-know basis" (owner quote about the earlier subagent workflow).
- 56-59 (l.463-485): queues of small work, related work to the worker that knows it, focused compaction between items, retire instead of compacting again.
- 60 (l.489) "Turns and tokens are counted and shown".
- "Sheepdog", "standing permission" and "always allow": no match.

Source B: `docs/issues.md`. Highest issue number 211 (l.3169). No issue about roles, piece 4, the sheepdog, prompt cache, context size or standing permission rules. Relevant: #75 (l.1237, open) owner cannot wait; #80 (l.1290, fixed) waits limited to the caller's agents; #113 (l.1704, open) nothing closes a crashed agent's open questions; #114 (l.1719, open); #65 (l.1056, open) no event withdraws an owner alert; #76 (l.1246, open) engine notices name the owner as sender; #90 (l.1392, fixed) and #73 (l.1189) option-kind safety; #91 (l.1403, open), #104 (l.1625, open) deny rules; #134 (l.2040, open) out-of-usage account still sends work to idle siblings; #152 (l.2124, open) paused agent that cannot reload; #162 (l.2246, open) ancestry check rests on the caller's claim; #194 (l.2716) unaccepted prompt sent twice after restart.

## Planner's check: Effect test clock (2026-11-03)

context7, library `/effect-ts/effect/effect_4.0.4`, `packages/vitest/README.md`: `it.effect` provides the test services, including `TestClock`, which starts at 0; `TestClock` is imported from `effect/testing` and advanced with `TestClock.adjust("1000 millis")`; `it.live` uses the real clock. The engine pins 4.0.5; 4.0.4 was the nearest documented version.

## Planner's check: frozen contracts (2026-11-03)

- Client API contract v2: `/home/qnlbnsl/projects/personal/herdr-synapse/sheprd/.claude/worktrees/foundry-plans-api/.plans/plans/shepherd-client-api/contract.md` at `75ab185`. Sections used: 1 (namespaces, five exports, views and reactors, paged reads), 2 (service caller and its allowed commands), 3 (`client.roster`, `client.thread`, visibility classes), 4 (alert sources, the four `roles.` kinds), 5 (request ids), 6 (seam items 8, 9, 10, 12), 7 (answers to requests.md).
- Board contract: `/home/qnlbnsl/projects/personal/herdr-synapse/sheprd/.claude/worktrees/foundry-plans-board/.plans/plans/shepherd-message-board/contract.md` at `aaef08f`. Sections used: "Channels" (group channel), "Posts" (`reply` modes, a collection is a post in `all` mode, service authors), "How a wake reaches an agent", "Commands the board adds to the API" (`board.status`, `board.flush`), "For Shephrd's own services", "What the board refuses".
- Engine anchors spot-checked on disk: `packages/cli/src/commands/sanitize.ts`, `packages/engine/src/routing/envelope.ts`, `packages/engine/test/support/rebuildCheck.ts`, `packages/engine/scripts/live/flow.ts`, `packages/engine/src/recovery/crash.ts`, `packages/engine/src/accounts/timers.ts:startAccountTimers`.
