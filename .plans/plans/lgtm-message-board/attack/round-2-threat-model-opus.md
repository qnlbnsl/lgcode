revise
Grade: 6  B/M/m: 0/4/5  Flags: none

# Threat-model review of the message board plan, round 2

Lens: security threat model. The plan under review is version 2
(`lgtm-message-board/plan.md`), with `decisions.md`, `contract.md`
version 3 and `scouting.md`. Code claims are checked at commit `8ff4c9b`
in the read-only worktree and cited `file:line`, with paths relative to
the repository root. "The client API contract" means
`inputs/client-api-contract.md`. "Design" means
`docs/specs/2026-11-01-engine-design.md`. "Row N" is a row in the board's
`decisions.md`, which sits at line N + 10 of that file.

## Summary

Version 2 answers most of round 1 well. The reply-in-another-channel
hole, the direct-message reach, the forged author line, the returned
wake, the agent snapshot leak and the queued-text revocation are all
closed by a written rule and a criterion. I checked each answer against
the code, and the table below says which hold.

Four new or partly failed answers remain, and none is a blocker:

1. The answer to round 1's snapshot finding (M0) made the board's
   snapshot section its whole view, with every post's text, for every
   device. Posts are never deleted, so that reply grows without bound and
   soon passes the network listener's 1 MiB limit. The owner's phone then
   cannot take a snapshot at all (S1).
2. The permission-ceiling rule (rule 4) names no field. The engine's
   agents view overwrites an agent's `permission` with its current,
   harness-reported mode, so a target that is briefly in a lower mode
   passes the check (S2).
3. An owner-opened group channel admits every carrier of its label.
   Labels are free strings that any agent can put on a child it starts,
   so any agent's child can join the owner's team channel (S3).
4. Group membership follows the current chain of holders. A manager
   that pauses for usage drops its whole team from the channel, and a
   manager that crashes widens the channel to its holder's whole subtree
   (S4).

Five minor points follow: a byte cap that is measured before JSON
(JavaScript Object Notation) escaping, an unfixed `board.status` reply,
an agent-chosen channel name inside the author header, a ceiling claim
wider than the rule, and a store inventory that leaves out receipts.

## Round 1 answers, checked

| Round 1 finding | Answer in version 2 | Holds? |
|---|---|---|
| Opus M0, agent snapshot unfiltered | Row 51 (3), seam item 17, criteria 5.9 and 6.3 | Holds for isolation. It creates S1. |
| Opus M1, group channel reaches outside the opener's branch | Row 45 (c), criterion 2.6 | Holds for agent-opened channels. Fails for owner-opened channels (S3). The holder-chain wording adds S4. |
| Opus M2, direct reach outlives the shared channel | Row 45 (b), criterion 2.7: checked on every post | Holds. |
| Opus M3, wakes skip the ceiling | Row 45 (d), criterion 2.9 | Partly. The level compared is not fixed, and the obvious field is the transient mode (S2). The claim is wider than the rule (m4). |
| Opus M4, a name forges the author line | Rows 52 and 63, criterion 3.6 | Holds for the author. An agent id is an engine-minted UUID (universally unique identifier), `packages/engine/src/commands/start.ts:34`. The channel name is a residual (m3). |
| Opus M5, no byte limits | Row 53, criteria 3.8 and 5.8, post-build check 9 | Partly. The cap is in UTF-8 bytes, not encoded bytes (m1). The snapshot reply is not sized at all (S1). |
| Opus M6, a returned wake is ignored | Row 46 (4), criterion 4.3 | Holds. |
| Opus m1, owner alert flood | Row 54, criterion 3.9 | Holds. |
| Opus m2, the on-disk edge | Row 55 | Holds. |
| Opus m3, store inventory | Row 55 | Partly. Receipts are missing from the inventory (m5). `board.Read` only on change holds. |
| Opus m4, name squatting | Row 56 | Holds. |
| Opus m5, service read access | Criterion 2.8 | Holds. |
| Opus m6, queued wake keeps a left channel | Row 50 (3), criterion 4.4 | Holds. The withdrawn `DeliveryQueued` stays in the log, but it is hidden from agents: the event has no top-level `agentId` (`packages/contracts/src/events.ts:158`), and the envelope's agent comes only from that field (`packages/engine/src/log/EventLog.ts:175`). Post-build check TM2-6 pins this. |
| Opus m7 and Sol TM-1, a reply in another channel | Row 57, criterion 2.10 | Holds. |
| Sol TM-2, revocation on removal | Row 50 (2) to (4), criterion 4.4 | Holds for explicit removal and label loss. The reactor does not watch the state changes that move membership under S4. |

## Findings

### S1. The board's snapshot section carries every post's text, so a device's `client.snapshot` outgrows the 1 MiB message limit

- **Severity:** MAJOR. **Category:** Design; Bug (failures).
  **Responsibility:** 3, access (the owner's client surface).
- **Scenario:** The owner pairs a phone. After a few days of normal team
  use, the board holds more than 1 MiB of post text. That is 64 posts at
  the 16,384-character limit, or about 500 posts of 2 KB. The phone
  calls `client.snapshot` at start-up, and again whenever its cursor is
  refused. The reply holds the board's whole view, and it cannot cross
  the network listener. The phone can no longer start, and
  `waitForAgents` cannot run on it. Posts cannot be deleted, so this
  never heals without a code change.
- **Evidence:** The board's section is "its whole view for the owner,
  devices and services" (`contract.md:250-254`; row 51 (3); client API
  contract lines 299-307). The view holds each post's text (plan lines
  325-329). "Posts cannot be deleted" (`contract.md:166`). The network
  listener refuses any message over 1,048,576 bytes, and its sizing test
  checks only "every piece's stated maxima" (client API contract lines
  570-577). The board states only its wake and its read page
  (`contract.md:180-184`, `241-244`), so the test passes while the
  snapshot fails. `waitForAgents` needs the snapshot section (client API
  contract lines 413-422).
- **Suggested fix:** Decide before the build what the board's snapshot
  section holds, and bound it. Recommended: the inputs of `holdsUnsettled`
  and `holdsIncoming` (open posts' ids, authors, addressees, modes and
  dispositions), the channel list with members, and unread counts, with
  no post text. Clients page text with `board.read`. State the section's
  largest size in `contract.md`, so the client API's size test covers it.
  Consider keeping post text out of the in-memory view as well, since
  the view also grows without bound in the engine's memory. Add a
  criterion: a device's `client.snapshot` after 1,000 posts of maximum
  size stays under the limit.

### S2. The ceiling rule names no field, and the engine's agents view holds the agent's current mode, not its ceiling

- **Severity:** MAJOR. **Category:** Security (access).
  **Responsibility:** 3, access.
- **Scenario:** A builder runs with a `full` ceiling. Its harness
  switches it into a planning mode, which reports a lower level. While it
  is there, a read-only reviewer sibling posts a question that needs the
  builder's reply. Rule 4 compares the reviewer's level with the
  builder's current level, which is equal, so the post is allowed. The
  builder's harness then returns to `full`, and the builder acts on the
  reviewer's request. This is the case the ceiling exists to stop, and it
  happens by ordinary use, not by an attack.
- **Evidence:** Rule 4 says "an author whose permission level is at
  least as wide as T's" (`contract.md:92-94`; row 45 (d); criterion 2.9,
  plan line 349). Neither the plan nor the contract says which value is
  T's level. Task 2b.1 points at `permission.ts` and `ceiling.ts` (plan
  line 358). In the agents view, `ModeChanged` overwrites the row's
  `permission` with the new level (`packages/engine/src/views/apply.ts:190-191`).
  The engine writes `ModeChanged` whenever the harness reports a mode
  within the ceiling (`packages/engine/src/commands/CommandHandler.ts:153-157`).
  So `snapshot.agents[T].permission` is T's current mode. The ceiling
  itself is only in `AgentStarted.permission`
  (`packages/contracts/src/events.ts:89-101`). The design states the rule
  as "a wider permission mode" (design lines 223-224), and the engine
  keeps it structurally, because a child's start level is at most its
  parent's (`packages/engine/src/identity/ceiling.ts:311-312`). A sideways
  wake has no such structure, so the board must compare ceilings.
- **Suggested fix:** Decide this before the build. Compare T's ceiling,
  the `permission` in T's `AgentStarted`, with the author's ceiling or
  current level. The board's view, or a seam helper, must keep that
  start value, because the engine's view loses it. Add the case to
  criterion 2.9: a target that reports a lower mode is still refused.

### S3. An owner-opened group channel admits any agent's child that carries the label

- **Severity:** MAJOR. **Category:** Security (isolation between agents;
  access). **Responsibility:** 1, isolation; 3, access.
- **Scenario:** The owner opens a group channel bound to the label
  `review`, for one team. In another branch of the tree, a lead starts a
  worker with `groups: ["review"]` for its own purpose. That worker is
  now a member of the owner's channel. It can read the channel's whole
  history with `board.read`. It can be woken by, and can wake, every
  member that passes rule 4. It can open a direct channel with each
  member, because they share a channel. The lead never held those
  agents, and nobody agreed to the join. Round 1's M1 scenario B (a
  child started with the label) is closed for agent-opened channels and
  still open here. The same widening applies to a channel opened by the
  root orchestrator, since every agent's chain passes through it.
- **Evidence:** "In a channel the owner opened, every live agent that
  carries the label is a member" (`contract.md:59-60`; row 45 (c)). The
  `start` payload takes free-form labels
  (`packages/contracts/src/commands.ts:61`). `start` writes them unchecked;
  its only check is the permission ceiling
  (`packages/engine/src/commands/start.ts:19`, `38`). `group` lets any
  holder add any label to its child (`packages/engine/src/commands/group.ts:3-7`;
  `CommandHandler.ts:72-76`). Row 11 promises that "the board gives no
  agent a reach the engine denies it".
- **Suggested fix:** Decide this before the build. Tie admission to the
  channel's authority, not to a label any parent can mint. Recommended:
  an owner-opened group channel names a root agent, and admits only
  carriers in that root's subtree, by the same rule as an agent-opened
  channel. An owner-opened channel with no root admits only carriers
  whose label was set by the owner or a service; the board's view can
  record who set each label from the envelope's `caller` on
  `AgentStarted` and `AgentGrouped`. Add both cases to criterion 2.6.

### S4. Group membership follows the current chain of holders, so it narrows when the manager pauses and widens when it crashes

- **Severity:** MAJOR. **Category:** Bug (timing); Security (access).
  **Responsibility:** 3, access; 4, integrity.
- **Scenario A, narrowing:** Lead L opens a group channel for its team.
  L's account runs out of usage, so L is paused for hours. A holder is
  "the nearest ancestor that is idle or working", so L's workers' chain
  of holders now skips L. Every worker drops out of L's channel. Their
  `board.read` calls are refused, and a post that needs a reply from one
  of them is refused. The reactor does not see this, because it watches
  only `board.ChannelMembersChanged`, `AgentStarted` and `AgentGrouped`.
  Usage pauses are a weekly event in real runs.
- **Scenario B, widening:** L crashes. Its manager rights pass to its
  holder, the orchestrator O. Membership now uses "the channel's current
  manager", O, so every carrier of the label under O joins. If a sibling
  team reused the label, its workers now read L's channel history.
- **Evidence:** "A live agent that carries the label is a member only if
  its chain of holders passes through the channel's current manager"
  (`contract.md:61-64`; criterion 2.6, plan line 346). "Holder of an
  agent: the agent's nearest ancestor that is idle or working, as the
  engine's `holderAbove` finds it" (`contract.md:37-39`). `holderAbove`
  skips every ancestor that is not available
  (`packages/engine/src/routing/holders.ts:14-17`, `21-33`). Manager
  rights pass up on a stop or crash (`contract.md:54-55`). The reactor's
  membership triggers are in plan lines 459-463.
- **Suggested fix:** Decide this before the build. Anchor group
  membership to the static parent links of the agent that opened the
  channel: a carrier is a member if the opener is among its ancestors.
  Do not move it when manager rights pass up. Keep `holderAbove` only for
  who holds the manager's rights. Add a paused-manager case and a
  crashed-manager case to criterion 2.6.

### m1. The wake byte cap is measured before JSON escaping, so a wake event can pass 1 MiB

- **Severity:** MINOR. **Category:** Bug (failures).
  **Responsibility:** 3, access (the owner's client surface).
- **Scenario:** Workers paste raw tool output into posts, with dense
  terminal escape codes and other control characters. A wake fills its
  256 KiB of UTF-8 with such posts. Both transports encode messages as
  JSON (`packages/engine/src/api/server.ts:128`), and JSON writes each C0
  control character other than `\b`, `\f`, `\n`, `\r` and `\t` as six
  bytes (`\u001b`). The wake's `DeliveryQueued` and `PromptSent` events
  can then reach about 1.5 MiB. A device's live stream stops at that
  event, and a reconnect meets it again. This is the failure that round
  1's M5 named, through a different character class.
- **Evidence:** "A wake's body is plain text, at most 256 KiB of UTF-8"
  (`contract.md:180`; row 53). The client API contract relies on that
  cap to keep the largest message under 1 MiB (lines 573-576). Post-build
  check 9 builds its worst case from 4-byte characters (plan lines
  595-597). Those are written unescaped, so they are the wrong worst case.
- **Suggested fix:** Measure the cap on the encoded event, or remove C0
  and C1 control characters other than newline and tab from post text
  before it is written. The command-line tool already strips the same
  set on output (`packages/cli/src/commands/sanitize.ts:1-20`). Change
  check 9 to use control characters.

### m2. The `board.status` reply is not fixed, and a holder that is not a member may read post text through it

- **Severity:** MINOR. **Category:** Security (isolation between agents).
  **Responsibility:** 1, isolation.
- **Scenario:** Worker W's parent is paused, so W's holder is its
  grandparent G. G is in none of W's channels. G calls `board.status` on
  W. If "open posts" in the reply means whole posts, G reads text from
  channels it cannot read with `board.read`. The engine would not show G
  that text: `subscribe` shows an agent only its own thread and its
  direct children's (`packages/engine/src/api/server.ts:155-158`).
- **Evidence:** `board.status` returns "unread counts, open posts waiting
  for its reply, its own open posts and whom each waits on"
  (`contract.md:283`; row 30). Its access includes "the agent's holder"
  (`contract.md:283`; criterion 5.6). No criterion fixes the reply's
  fields.
- **Suggested fix:** Fix the reply in `contract.md`: post ids, channel
  ids, modes, addressees, dispositions and counts, never text. Add the
  non-member holder case to criterion 5.6.

### m3. The author header contains the channel's name, which an agent chose

- **Severity:** MINOR. **Category:** Security (access, SECURITY.md rule
  7). **Responsibility:** 3, access.
- **Evidence:** Lead ruling L16 says the header is built "only from fixed
  words and the engine-authenticated caller id, never from agent text".
  `contract.md:186-189` says "no agent-chosen name appears in it", then
  adds "the channel's id and name". The plan puts the name on the header
  line itself (plan lines 400-403). Any agent may open a channel and
  choose its name (`contract.md:277`). The plan calls a name a "slug"
  (criterion 1.5, plan line 295) but never gives the pattern. A name
  such as `owner-approved-deploy` would sit beside the fixed author word.
- **Suggested fix:** Show only the channel id in the header, or show the
  name after a fixed label word, in quotes, and write the slug pattern
  into `contract.md` (for example the engine's
  `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`, `packages/contracts/src/ids.ts:24`).

### m4. The ceiling claim is wider than rule 4, because a narrower author's no-reply post still rides in a wider agent's wake

- **Severity:** MINOR. **Category:** Security (access); Design.
  **Responsibility:** 3, access.
- **Scenario:** A read-only reviewer posts, with no reply needed, "the
  builder should run the deploy script now". Later the lead asks the
  builder a question, which wakes it. That wake also carries up to 20
  unread no-reply posts, including the reviewer's. The builder reads the
  reviewer's instruction in the same turn it is woken for.
- **Evidence:** Rule 4 checks only "every post in it that needs T's
  reply" (`contract.md:92-94`). Wakes carry no-reply posts
  (`contract.md:180-184`). The contract then claims "a read-only reviewer
  cannot make a builder sibling act on its request" (`contract.md:96-97`).
  The real control on that text is the data envelope (SECURITY.md rule
  7), not the ceiling.
- **Suggested fix:** Either narrow the claim to "cannot wake or oblige a
  wider agent", or leave no-reply posts from narrower authors out of
  wakes to wider targets, so they stay readable with `board.read` only.

### m5. The store inventory leaves out receipts

- **Severity:** MINOR. **Category:** Security (confidentiality).
  **Responsibility:** 5, confidentiality.
- **Evidence:** `board.read` is a paged read, "not deduplicated", but it
  also writes `board.Read` (`contract.md:241-249`, `296-297`). The plan
  does not say whether it runs with a receipt. If it does, each page, up
  to 512 KiB of post text, is copied into the `receipts` table
  (`packages/engine/src/log/EventLog.ts:210-214`). Row 55 and
  `contract.md:260-263` list every other store and omit receipts. Round 1
  named this store (opus m3; sol, "Confidentiality, copies and
  deletion").
- **Suggested fix:** State whether `board.read` is receipted. If it is,
  add `receipts` to the inventory, so a later purge path covers it.

## Risk register

Scores follow `risk-score.md`: severity × fallout × probability. No
finding has severity 9 or 10, so no severity floor applies. An
unresolved access boundary is scored at its worst plausible probability.
Decision, deadline, acceptance and closing evidence are for the owner and
the lead.

| Id | Description | Severity | Fallout | Probability | Score, band | Evidence status | Owner |
|---|---|---|---|---|---|---|---|
| S1 | A device's `client.snapshot` grows past 1 MiB; the phone cannot start | 6: a core owner flow fails until code changes | 5: posts cannot be deleted, so only a code change undoes it | 8: every active install crosses 1 MiB of posts within days | 240, fix before release | Confirmed in plan and contract text | Board planner, with the client API seam |
| S2 | Rule 4 can compare a target's transient mode instead of its ceiling | 6: a core access rule is wrong | 5: an action the target takes may be hard to undo | 4: needs a mode switch at the moment a narrower author asks | 120, schedule (an access boundary: decide before the build) | Unresolved; code confirms the view overwrites the level | Board, access rules (unit 2b) |
| S4 | Group membership narrows on a manager's pause and widens on its crash | 4: wrong for hours, heals on resume (widening case: 6) | 3 | 8: usage pauses are weekly (widening case: 2) | 96, schedule (widening case 36) | Confirmed in contract text and code | Board, access rules (unit 2b) and reactor (unit 3c) |
| S3 | Any agent's labelled child joins an owner-opened group channel | 6: private channel text shown to another agent | 3 | 4: a reused label needs no hostile intent | 72, schedule (an access boundary: decide before the build) | Confirmed in code and contract | Board, access rules (unit 2b) |
| m4 | A narrower author's no-reply post rides in a wider agent's wake | 6 | 5 | 2: needs a mistaken instruction and a wider agent acting on data | 60, schedule | Confirmed in contract text | Board planner |
| m1 | Control characters push a wake event past 1 MiB | 6: a device stream stalls until repaired by hand | 3 | 2: needs many control-heavy posts in one wake | 36, record | Confirmed in contract and code | Board, posts and wakes (unit 3a) |
| m2 | `board.status` may give post text to a non-member holder | 6 | 3 | 2: needs a paused parent and text in the reply | 36, record | Unresolved | Board, doors (unit 4) |
| m5 | Receipts missing from the store inventory | 2 | 3 | 6 | 36, record | Unresolved | Board planner |
| m3 | Agent-chosen channel name inside the author header | 2 | 3 | 4 | 24, record | Confirmed in plan and contract text | Board, posts and wakes (unit 3a) |

## The six responsibilities, traced

- **Isolation.** Board events have no top-level `agentId`, so `subscribe`
  hides them from agents (`EventLog.ts:175`; `server.ts:155-158`). An
  agent's snapshot has no board section (criterion 5.9). Queued wake text
  is hidden from agents, because `DeliveryQueued` has no top-level
  `agentId`; sent text, in `PromptSent`, reaches the target and its
  parent, as row 55 states. Open: S3, S4, m2.
- **Identity across sessions.** LGTM Studio has one owner. Devices act as the
  owner and are revoked by piece 2 (SECURITY.md rule 4). The board adds
  no sign-in path.
- **Access.** Every board command runs through the engine's command
  handler, with identity and receipts (criteria 5.1, 5.2). Service
  authors are in-process only (criterion 5.5). Open: S2, S3, S4, m3, m4.
- **Integrity.** One transaction per post and its wakes; the reactor
  re-reads status before writing (row 62). Open: S4, where membership
  moves without a reactor event.
- **Confidentiality.** The local socket carries no network traffic. The
  network listener's encryption is piece 2's, under SECURITY.md rule 5.
  The state folder is unencrypted, which the owner accepted on
  2026-11-01. The board's alert carries no post text (post-build check
  10). Open: S1 (availability of the owner's client), m1, m5.
- **Secrets and dependencies.** Every event passes the engine's redactor
  before it is written (`EventLog.ts`, `transact`); criterion 3.7 and
  post-build checks 3 and 6 cover the board's combined text. The plan
  adds no third-party dependency. The two new workspace packages are
  known gap 5.

## Judgement on the known gaps

- **Gap 4** is stale but harmless. The supplied client API contract
  already carries the L16 sentence (lines 237-243).
- **Gaps 1, 5, 6, 7 and 8** have no security consequence I can see. Gap
  5 adds no third-party dependency.
- **Row 9 (the owner's answer on the seam)** stays open. Every finding
  above assumes the seam exists.

## Proposed post-build checks

These need code to answer. They do not replace the decisions above.

- **TM2-1.** After 1,000 posts of maximum size, a device's
  `client.snapshot` reply stays under the network listener's limit.
  Evidence: a measured encoded size. Area: board unit 4, with the client
  API seam.
- **TM2-2.** A target that has reported a lower mode is still refused a
  needs-reply post from a narrower author. Evidence: a test that writes
  `ModeChanged` before the post. Area: board unit 2b.
- **TM2-3.** A child started with an owner-opened group channel's label,
  in another branch, is not a member. Evidence: an access test. Area:
  board unit 2b.
- **TM2-4.** Pausing, then crashing, a group channel's manager leaves the
  channel's members unchanged. Evidence: an access test and a reactor
  test. Area: board units 2b and 3c.
- **TM2-5.** The largest wake event, built from posts dense in control
  characters, and the largest `board.read` page each stay under 1 MiB
  when JSON-encoded. Evidence: a measured encoded size. This replaces the
  character choice in check 9. Area: board unit 3a.
- **TM2-6.** A queued or withdrawn board wake's text never reaches its
  target or the target's parent through `subscribe`, `client.subscribe`,
  `client.thread` or `client.snapshot`. The engine's agents view files
  `DeliveryQueued` under the target's thread
  (`packages/engine/src/views/apply.ts:122-123`, `344-346`), so a seam
  that reads the views' threads instead of the log's agent column would
  leak it. Evidence: an acceptance test with a real agent token. Area:
  the client API seam (item 9) and board unit 5.
- **TM2-7.** `board.status`, called by a non-member holder, returns no
  post text. Evidence: a handler test. Area: board unit 4.

## Refused

None. No check was stopped by a model policy.

## Noted, not filed

- **The incoming hold reaches across the tree.** Any channel member that
  passes rule 4 can end a sibling's blocking `wait` with "request held",
  again and again. This is the stated price of avoiding the deadlock in
  row 51, and the sibling can answer and wait again.
- **The owner-alert cap is per agent.** An agent can multiply it by
  starting children. Each child costs a start and a turn, so this stays
  bounded by cost.
- **The off switch stops the reactor.** A label lost while the board is
  off does not rebuild that agent's queued wakes, and the engine still
  sends them. The reactor catches up when the board is switched on.
- **Reactor writes may be recorded as the owner.** The engine's own
  followers write with the caller `owner`
  (`packages/engine/src/commands/CommandHandler.ts:148`). If the board's
  reactor does the same, the log names the owner as the cause of
  reactor-built wakes. Recording a service caller, which seam item 10
  adds, would keep the audit trail true.
- **Devices are the owner.** A stolen device can post as `owner` and pass
  rule 4. Revoking a device is piece 2's job.
- **Terminal output is safe.** The command-line tool strips control
  characters and escape sequences from every string it prints
  (`packages/cli/src/commands/sanitize.ts:1-24`). Rendering in the web
  page and the pane viewer belongs to piece 2.
- **Self-imposed limits.** The board has none, so that exemption does not
  apply here.
