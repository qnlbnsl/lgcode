revise
Grade: 6  B/M/m: 0/3/2  Flags: none

# Threat-model review of the message board plan, round 4

Lens: security threat model. The plan under review is version 5
(`lgtm-message-board/plan.md`), with `decisions.md`, `contract.md`
version 6 and `scouting.md`. Every code claim was checked at commit
`8ff4c9b` in the read-only worktree, and is cited `file:line` with paths
relative to the repository root. "The client API contract" means
`inputs/client-api-contract.md` (version 3). "Row N" is a row in the
board's `decisions.md`. "Edit EN" is a shared engine edit in section 6 of
the client API contract. "Change BN" is a row of the plan's engine-change
table (`plan.md:322-332`).

Team rule 8 says security does not block in this run, and that fixes for
security findings are deferred to `docs/issues.md` and the manager's attack
list. The labels and scores below are still the consequences as this lens
sees them. Two of the findings below are pre-build decisions under the lens
rules: one is an unresolved access boundary (V4-2), and one is a criterion
that the engine's receipt mechanism makes impossible as written (V4-1).
Whether they wait under rule 8 is for the lead to decide.

## Summary

The rework under lead ruling L26 keeps every round 3 answer. The stored
manager, the per-wake reach check, the split completion rule, the bounded
status replies and the agent anchor refusal all survive the move into the
engine's packages. I checked each engine change B1 to B9 against the code.

Three problems are major, and none is a blocker:

1. **A `board.read` page is stored in the receipts table** (V4-1). Row 100
   makes `board.read` a planner, so it runs in the engine's command
   handler. That handler stores every planner's reply in the receipt and
   returns the reply it reads back from there. So the page's post text is
   stored for every read, and criterion 5.11, `contract.md:420-421` and
   row 75 are false. This was already true in round 3, and round 2's and
   round 3's threat reviews, including this reviewer's, missed it.
2. **The reactor's write path skips the checks that carry the security
   rules** (V4-2). Edits E17, E18 and E22 put their checks in the command
   handler. The plan models the reactor on `accounts/available.ts`, which
   appends directly, as the owner, without the handler. Now that the board
   lives inside `packages/engine`, nothing stops it. The reactor builds
   most of the wakes that have no caller, which is exactly the case lead
   ruling L22 names.
3. **A question left out by the byte cap is never delivered, and holds its
   addressee unsettled for good** (V4-3). This is a liveness bug from
   change B6, outside this lens, filed because it is a consequence of an
   engine change.

Two minor points follow. The service-and-agent direct grant is stated two
ways, and one of them ends it on a crash (V4-4). Two of round 3's proposed
post-build checks were dropped without an answer (V4-5).

## Round 3 answers, checked against version 5

| Round 3 finding | Answer in version 5 | Holds? |
|---|---|---|
| T3-1: the send-time check does not know which wake it judges | Row 86 and L23; edit E18 passes the delivery id and source and projects the batch at queue time (client API contract lines 893-907); `contract.md:140-143`; criteria 2.11, 4.9; post-build checks 14, 15 | Holds for wakes that commands build. It fails for wakes the reactor builds, because the queue-time half lives in the command handler: V4-2. |
| T3-2: "the current manager" moved on a pause | Row 85; `contract.md:75-81`; criterion 2.5; `plan.md:475` says manager rights never use `holderAbove` or `mayActForHolder` | Holds. The engine's helpers do move rights on a pause (`packages/engine/src/routing/holders.ts:35-40`, `available` at lines 14-17 is idle or working only), and the plan no longer uses them for managers. |
| T3-3 and R3-TM-1: a completion carries reply text past the send-time check | Row 87; `contract.md:157-162`; criterion 4.9 | Holds. |
| T3-4: no test refuses an anchor that an agent names | Row 96; criterion 2.6; `contract.md:435` | Holds. |
| T3-5: the bounded snapshot cannot feed the third clause | Row 89; the section and the summary carry the conditions' results (`contract.md:366-372`, `399-402`) | Holds for this lens. Row 101, which places the conditions, is still open, and the client API contract's section 3 (lines 426-428) still says each piece's condition is "a pure function over its own snapshot section". That is a design question for the architect lens. |
| T3-6: any member keeps another agent unsettled | Row 90 narrows the third clause | Holds for a question that reached its addressee. It leaves a stuck case for a question left out by the byte cap: V4-3. |
| R3-TM-2: the fallback lists had no bound | Row 89; criteria 5.6, 5.12 | Holds. |
| R3-TM-3: one completion could exceed a wake | Row 88; criterion 3.13 | Holds. |

Earlier answers that the rework could have broken, re-checked:

- **Board events stay hidden from agents.** No board event has a top-level
  `agentId` (criterion 1.3). The log's agent column comes only from that
  field (`packages/engine/src/log/EventLog.ts:175`), and the agent stream
  drops an envelope without one (`packages/engine/src/api/server.ts:155-158`).
  Edit E8 keeps that rule and adds the `owner-only` class. Holds.
- **Queued wake text stays hidden from agents' streams.** `DeliveryQueued`
  has no top-level `agentId` (`packages/contracts/src/events.ts:158`), so its
  body never reaches an agent through `subscribe` or a log-column thread
  read. `PromptSent` carries the sent text with the target's id
  (`events.ts:112`), as row 55 states. Holds, with V4-5's caveat about the
  views' own thread index.
- **No socket or network caller can be a service.** The server's
  `authenticate` maps a credential only to owner, agent or device
  (`server.ts:87-96`), and edit E13 adds no service branch. Holds
  (criterion 5.5).
- **The ceiling is the start ceiling.** `AgentStarted.permission`
  (`events.ts:99`) is what row 73 names. Holds.
- **Secrets are removed from posts and receipts.** Every event and every
  receipt reply, nested strings and keys included, passes the redactor
  (`EventLog.ts:211-232`, `240-241`). Stored agent tokens and device
  credentials are matched in raw and encoded forms
  (`packages/engine/src/identity/redactor.ts:76-161`). Control characters
  are removed before redaction, so a secret split by an escape code is
  joined first (`plan.md:495-496`). Holds.
- **The data envelope.** Edit E15 wraps every sender but the owner. The
  marker is fresh and redrawn on a collision
  (`packages/engine/src/routing/envelope.ts:14-18`). Holds, for wakes built
  through the helper. V4-2 is about the path that does not use it.

## The engine changes B1 to B9, checked

| Change | What I checked | Result |
|---|---|---|
| B1, commands and access | Today the agent tool list is a hand-written allow-list whose comment says "A new agent command is reviewed before it becomes a tool" (`packages/mcp/src/tools.ts:5-9`). Edit E2 replaces it with the access table, so the board's seven agent commands become tools by table entry. Criterion 5.3 checks that `board.flush` never does. | Holds. The review that the old comment asked for now happens in this plan's criterion 1.4 and 5.3. |
| B2, events and visibility | As above. `packages/contracts/test/no-secret-values.test.ts` walks the whole `Event` union and command group, so it covers the board's schemas; it is not named, and keeps its expectations. | Holds. |
| B3, the view in the views state | `debug.compare-views` returns difference paths only, never values (`server.ts:163-165`), and is owner-only. | Holds. No post text leaks through it. |
| B4, the reach check | Edit E18's queue-time check is in the command handler (client API contract line 903). | Holds for commands. Fails for the reactor: V4-2. |
| B5, the source rule | Today a returned delivery tells only an agent sender (`packages/engine/src/routing/deliveries.ts:45-55`), and a stop or crash returns anything that is not a wake or a moved request (`deliveries.ts:61-77`). The board's rule withdraws on a stop or crash and keeps `DeliveryReturned` on a return. | Holds. |
| B6, hold unsettled | `settled` and `reasonOf` (`packages/engine/src/routing/waits.ts:39-59`). A paused, crashed or non-reloadable interrupted member still resolves before `settled` is asked, so criterion 4.6's control case is right. | Holds, with V4-3. |
| B7, request held | The blocking-wait check (`waits.ts:83`) runs on every batch through `withWaitChecks` (`waits.ts:110-120`). | Holds. |
| B8, the reactor | The named pattern, `followAvailability` and `returnOne`, appends directly with the owner as caller (`packages/engine/src/accounts/available.ts:59-66`). | Fails: V4-2. |
| B9, reads, snapshot and switch | `board.channels` and `board.status` are reads with no receipt (edit E4). `board.read` is a planner (row 100 (3)). | Fails for `board.read`: V4-1. |

## Findings

### V4-1. Every `board.read` page is stored in the receipts table, so criterion 5.11 and the data inventory are false

- **Severity:** MAJOR. **Category:** Security (confidentiality: every
  stored copy); Design (a criterion that cannot pass without an unnamed
  engine change). **Responsibility:** 5, confidentiality; 4, integrity
  (storage growth).
- **Scenario:** Worker W calls `board.read` on channel C, and gets a page
  of 200 posts, up to 512 KiB of text. Row 100 (3) makes `board.read` a
  planner, so it runs in the command handler. The handler appends the
  batch with a reply function (`packages/engine/src/commands/CommandHandler.ts:269-270`).
  The log writer stores `{ envelopes, reply }` as the receipt
  (`EventLog.ts:210-216`). The handler then reads the receipt back and
  returns that stored reply to the caller
  (`CommandHandler.ts:271-275`, comment "Return precisely the redacted
  result that a later retry reads"). The client API contract keeps this:
  "The same caller sending the same id with the same body gets the first
  reply again" (client API contract line 548). So the page's post text is
  written to `receipts.result_json`, under W's caller key, for every page W
  reads. The engine already does this for list replies: `accounts` stores
  the whole accounts list in its receipt (`CommandHandler.ts:109`), and the
  log writer's comment says "Replies may contain list data"
  (`EventLog.ts:219`).

  Three consequences follow. First, criterion 5.11 ("A `board.read`
  receipt holds only its `board.Read` event"), `contract.md:420-421` and
  row 75 are false, and a builder can only make 5.11 pass by changing the
  command handler, which the engine-change table does not name. Second,
  the inventory misses one stored copy of post text per page read, which
  grows without bound: an agent that re-reads a busy channel each turn
  stores up to 512 KiB per call, forever. A full disk latches the log
  writer for the life of the service (`EventLog.ts:143`, `274`), so this
  growth can stop the engine. Third, a resent request id returns the old
  page after the caller has left the channel. The caller saw that page
  already, so this is no new exposure, but it contradicts "leaving a
  channel takes effect at once" for reads.

  This was already true in plan version 3. Row 75 assumed that "a receipt
  stores the command's committed envelopes". Round 3's threat review,
  this reviewer's included, marked row 75 as holding. It does not.
- **Evidence:** `CommandHandler.ts:97-116` (`replyFor`), `:258` (a retry
  returns the stored reply), `:269-275`; `EventLog.ts:210-216`; row 75
  (`decisions.md:85`); row 100 (3) (`decisions.md:110`); criterion 5.11
  (`plan.md:694`); `contract.md:415-421`. The client API contract's paged
  read shape also says a paged read "is not deduplicated" (line 193), which
  a planner is.
- **Suggested fix:** Decide before the build, with the lead, because it
  touches the engine's handler or the client API's read rules. Two
  workable choices:
  1. Make `board.read` a read in the read table (edit E4), with no receipt,
     and record read state with a separate planner command that takes post
     ids only, such as `board.mark`, called by the read path in the same
     request or by the client. The receipt then holds ids only, and 5.11
     becomes true.
  2. Keep `board.read` a planner, accept that its receipt holds the page,
     and say so: correct row 75, `contract.md:420-421` and criterion 5.11,
     add the receipts table's growth to the inventory, and add a receipt
     purge or cap for board reads to `docs/issues.md`.
  Do not return the page through the handler's `afterCommit` result
  (`CommandHandler.ts:275`, `278-279`) to keep it out of the receipt: a retry
  then returns the stored reply without a page (`CommandHandler.ts:258`),
  and the page would come from a later snapshot than the one whose posts
  `board.Read` marked read.

### V4-2. The reactor writes outside the command handler, where edits E17, E18 and E22 put their checks

- **Severity:** MAJOR. **Category:** Security (access); Design (the shared
  contract). **Responsibility:** 3, access; 4, integrity.
- **Scenario:** Worker W loses group label G while a wake for it is
  queued. The reactor handles the `AgentGrouped` and rebuilds W's wake.
  The plan says the reactor "writes through the engine's command
  transaction path" (`plan.md:578-579`), names `followAvailability` as its
  pattern (`plan.md:654`), and checks only that its writes go through the
  wait checks "as `CommandHandler.ts` and `accounts/available.ts` do"
  (post-build check 5, `plan.md:757-760`). That pattern calls
  `log.transact` and `append` directly, with the owner as caller
  (`available.ts:59-66`). The same holds for every other engine follower
  (`deliveries.ts:248`, `259`; `packages/engine/src/recovery/restart.ts:169`;
  `CommandHandler.ts:148`).

  The checks that carry the board's security rules sit in the command
  handler, not in `append`:
  - edit E17: "The command handler checks both inside the transaction"
    (client API contract line 875), so a piece withdraws only its own
    still-queued delivery;
  - edit E18: at queue time, "the command handler refuses the batch that
    carries it" (line 903);
  - edit E22: "the command handler checks every engine event a piece
    returns against the state table" (line 966);
  - edit E15: "A piece queues a delivery only through one helper" (line
    843), which is a convention once the board's code lives in
    `packages/engine`, where it "may import any engine module" (line 101).
    Criterion 6.4 scans board files only for `runner` imports.

  So for every wake the reactor builds (rebuilds after a membership
  change, re-queues after a return, completion wakes, rebuilds after a
  send-time withdrawal), the engine does not run its queue-time reach
  check, its own-namespace withdrawal check or its state-table check.
  These are the "wakes the piece builds with no caller" that lead ruling
  L22 says the engine checks. The send-time check still runs in the
  dispatcher, so a reactor-built wake that fails reach is still withdrawn
  before its target reads it. What is lost is the engine's guard against a
  board defect: a reactor batch that withdraws an engine delivery, such as
  a question's answer, would be committed, and that answer would never
  arrive. A reactor that built its `DeliveryQueued` by hand, not through
  the helper, could send post text with the owner as sender, unwrapped,
  which SECURITY.md rule 7 forbids. The log also names the owner as the
  cause of every reactor close, resolution and withdrawal. Round 2 and
  round 3 noted that last point without filing it.
- **Evidence:** `plan.md:578-583`, `654`, `757-760`; `contract.md:132-138`
  ("runs once when the wake is queued", for every board wake);
  `available.ts:59-66`; `CommandHandler.ts:269` (the handler's own append
  is the only place a plan's events meet the handler's checks); client API
  contract lines 101, 172-176, 843, 875, 903, 966.
- **Suggested fix:** Decide the reactor's write path before the build,
  through the lead, because it changes edits E17, E18 and E22. Recommended:
  one engine entry for piece reactors, such as
  `pieceTransact(namespace, plan)` in `packages/engine/src/commands/`,
  which runs the E17, E18 queue-time and E22 checks and `withWaitChecks`,
  and records a caller that names the piece, such as
  `piece { namespace: "board" }` or a service caller under edit E11. The
  board's reactor writes only through it. Add three criteria: a reactor
  batch that withdraws an engine delivery is refused; a reactor-built wake
  with a post that fails reach is refused at queue time; and no file under
  `packages/engine/src/board/` calls `EventLog.append` or builds a
  `DeliveryQueued` outside `routing/pieceDelivery.ts` (extend the scan of
  criterion 6.4).

### V4-3. A question left out by the byte cap is never re-queued, and holds its addressee unsettled until it is answered

- **Severity:** MAJOR. **Category:** Bug (liveness), outside this lens;
  filed because it follows from engine change B6. **Responsibility:** none
  of the six; a core flow, a `wait`, fails until it is repaired by hand.
- **Scenario:** Lead L posts eight must-reply questions of about 32 KiB
  each to worker W, while W also has a completion owed. The wake carries
  the completion, up to 128 KiB, and as many questions as fit in the rest
  of the 256 KiB. The others are left out, and the body ends with "N more
  posts need your reply; run board.read with incoming set"
  (`plan.md:521-527`). W runs `board.read` with `incoming`, answers some
  questions, and ends its turn. Nothing queues another wake for the
  left-out questions. The reactor's idle rule queues a wake only for owed
  completions (`plan.md:598-599`), and `board.flush` is owner and service
  only. The third hold-unsettled clause covers "a post left out by the byte
  cap" (`contract.md:355-358`, row 90), and nothing ever satisfies it for
  that post: no wake carrying it is queued, and none carrying it is ever
  accepted. Reading it with `board.read` does not count. So W stays not
  settled while it sits idle, and a `wait` on W by its parent never ends.
  This contradicts row 90's own rule: an addressee that received its
  question and ended its turn without replying is settled. W received
  these questions through `board.read`, and is still held.
- **Evidence:** `plan.md:521-527`, `598-599`, `625-631`; `contract.md:295-297`,
  `350-360`; row 90 (`decisions.md:100`); `waits.ts:56` (an idle member
  resolves only when settled).
- **Suggested fix:** Treat a question as reached when a `board.read` page
  that returned it to that addressee is committed, the same as an accepted
  wake. Also add a reactor rule: when an agent is idle, has no queued board
  wake, and has open must-reply posts with no disposition that no wake has
  carried to it, queue one wake for them. Add a case to criterion 3.8 and
  to criterion 4.6.

### V4-4. The service-and-agent direct grant is stated two ways, and one of them ends it on a crash

- **Severity:** MINOR. **Category:** Design; Bug (logic).
  **Responsibility:** 3, access.
- **Scenario:** The stall watch posts a must-reply notice to worker W in their
  direct channel, and W crashes. `contract.md:117-118` and row 84 say "A
  crash does not end a grant". `contract.md:152-155` and row 98 (3) say the
  agent-and-service grant "always holds while T is live", and a crashed
  agent is not live (`contract.md:52-53`). If the reactor follows the
  second sentence, W's crash ends the grant, so W is resolved `removed`
  under the grant rule and `gone` under the crash rule in the same batch.
  That is the double-rule conflict that round 3's group 1 removed for group
  channels. After a resume, W's late reply upgrades `removed` only "once
  the addressee is a member again" (`contract.md:217-220`), which a grant
  that ended may never restore.
- **Evidence:** `contract.md:52-53`, `117-118`, `152-155`, `217-220`; rows
  84 and 98 (`decisions.md:94`, `108`).
- **Suggested fix:** Say "while T is not stopped" in `contract.md:154` and
  in row 98 (3), matching row 84. Add a crash case to criterion 2.7.

### V4-5. Two of round 3's proposed post-build checks were dropped without an answer

- **Severity:** MINOR. **Category:** Test gap. **Responsibility:** 1,
  isolation.
- **Scenario:** Round 3 proposed TM3-2 and TM3-3
  (`attack/round-3-threat-model-opus.md:348-360`). Neither appears in
  version 5's post-build checks (`plan.md:747-788`), and the round 3
  findings map lists only findings, not proposed checks.
  - TM3-2: `resume --fresh` re-queues accepted deliveries
    (`packages/engine/src/commands/resume.ts:27-36`), so an accepted board
    wake is sent again, perhaps after its target has left the channel. The
    send-time check of edit E18 should stop it, but nothing tests it.
  - TM3-3: the engine's views file a `DeliveryQueued` under its target's
    thread (`packages/engine/src/views/apply.ts:118-123`, `342-343`), while
    the log's agent column does not (`EventLog.ts:175`). A thread read, a
    snapshot or a roster built on the views' thread index, not on the log
    column, would show the target and its parent the text of a wake that
    the send-time check withdrew. Edit E21 uses the log column, so
    `client.thread` should be safe. Criterion 6.3 checks the streams and
    snapshot for board events and sections, but not for withdrawn wake
    text.
- **Suggested fix:** Add both as post-build checks, or answer them in a
  decision row. For TM3-3, add a case to criterion 6.3: after a label
  removal that the dispatcher catches, the withdrawn wake's text does not
  appear in the target's or its parent's `subscribe`, `client.subscribe`,
  `client.thread` or `client.snapshot`.

## Risk register

Scores follow the risk-score rule: severity × fallout × probability.

| Id | Description | Severity | Fallout | Probability | Score and band | Evidence status | Owner |
|---|---|---|---|---|---|---|---|
| V4-3 | A question left out by the byte cap holds its addressee unsettled for good | 6: a core feature, a wait, wrong until fixed by hand | 3: the owner or the stall watch closes the post | 4: needs more must-reply text for one agent than one wake holds | 72, schedule | Confirmed by reading | Board units 3a and 3b |
| V4-1 | Every `board.read` page is stored in its receipt; criterion 5.11 is false | 4: extra stored copies and unbounded growth; no other person sees them | 3: one installation; a purge can repair it | 10: every `board.read` | 120, schedule | Confirmed in code | Board unit 4, with the lead for the engine handler |
| V4-2 | Reactor writes skip the handler's E17, E18 and E22 checks | 6: an engine delivery lost, or agent text sent unwrapped, through a board defect | 5: one installation, repaired with help | 2: needs a board defect on a reactor path; the send-time check still guards reach | 60, schedule | Unresolved (pre-build decision) | Client API unit 1b and board unit 3b |
| V4-4 | The service-and-agent grant may end on a crash | 4: a notice resolved `removed` wrongly; repairs on a new post | 3 | 4: a crash with a stall watch notice open | 48, record | Confirmed by reading | Board units 2b and 3c |
| V4-5 | Two proposed checks dropped | 2: a test gap | 3 | 2 | 12, record | Confirmed by reading | Board unit 5 |

No finding reaches the severity floor: none has severity 9 or 10.
Decision, deadline, acceptance and closing evidence are the owner's to set.

## The six responsibilities, traced

- **Isolation.** Board events have no top-level `agentId` and are
  `owner-only`, so no agent stream shows them (`EventLog.ts:175`,
  `server.ts:155-158`, edit E8). An agent's snapshot has no board section
  (criterion 5.9). Queued wake text in `DeliveryQueued` is hidden from the
  log-column streams (`events.ts:158`). Sent text in `PromptSent` reaches
  the target and its parent, as row 55 states. Reads check membership, and
  `board.read` with `repliesTo` refuses non-members (criterion 5.12). The
  per-wake send-time check is decided (L23). Open: V4-2 (the queue-time
  half for reactor wakes), V4-5.
- **Identity across sessions.** LGTM Studio has one owner. A device acts as the
  owner and is recorded in the envelope's `device` field (edit E12). A
  stopped or crashed agent's token is revoked
  (`packages/engine/src/commands/stop.ts:19`, `CommandHandler.ts:162`) and
  refused (`CommandHandler.ts:211`, criterion 5.2); the read table
  relies on the revocation, since `server.ts:113-118` checks the token only.
  Device caches and their clearing are piece 2's. Nothing new.
- **Access.** Every board command is in the access table and the planner or
  read table (edits E2 to E4). Services are in-process only (`server.ts:87-96`;
  edit E13; criterion 5.5). Manager rights, group anchors and start
  ceilings are decided. Open: V4-2, V4-4.
- **Integrity.** A post and its wakes commit in one transaction. The
  reactor re-reads status before it writes (row 62). Completions are
  durable and bounded (rows 69, 88). Open: V4-2 (no engine guard against a
  reactor withdrawing an engine delivery), V4-3 (a liveness gap, not lost
  data), V4-1 (storage growth that can latch the writer).
- **Confidentiality.** The inventory names the log events, receipts of
  posts, the view in memory, device caches and harness session files
  (`contract.md:415-421`). It misses the `board.read` receipts: V4-1. The
  state folder is unencrypted, which the owner accepted on 2026-11-01. An
  owner alert carries no post text (client API contract lines 522-534;
  post-build check 10). Network encryption is piece 2's under SECURITY.md
  rule 5.
- **Secrets and dependencies.** Every event and receipt passes the
  redactor (`EventLog.ts:211-232`, `240-241`), and stored agent and device
  credentials are matched in every encoding (`redactor.ts:76-161`).
  Post-build checks 3 and 6 cover combined text and harness login tokens.
  The board adds no package and no third-party dependency (row 100).

## Judgement on the known gaps

- **Gap 5 (scopes)** has a consequence for V4-2. The scope `board/backend`
  is to cover "the board's entries in the engine files". A scope names
  paths, not lines, so it will cover whole engine files such as
  `routing/reach.ts` and `routing/deliveries.ts`. That lets a board unit
  edit the dispatcher's own check. The attack passes on units 2b and 3a
  should look for any edit outside the board's table entries.
- **Gap 9 (Effect functions)** has no security consequence.
- **Gaps 1 and 7** have no security consequence.
- **Gaps 2, 3, 4, 6 and 8** are closed, and I agree.

## Proposed post-build checks

These need code to answer. They do not replace the decisions above.

- **TM4-1.** Every write the board's reactor commits goes through the
  engine entry that V4-2's decision names: a reactor batch that withdraws
  an engine delivery, or another piece's, is refused; a reactor-built wake
  with a post that fails reach is refused at queue time; and the log names
  the board, not the owner, as the reactor's caller. Evidence: reactor
  tests with a deliberately wrong plan. Area: client API unit 1b and board
  unit 3b.
- **TM4-2.** After V4-1's decision, the receipts table is measured after
  1,000 `board.read` calls of the largest page by one agent: it holds no
  post text (choice 1), or its growth matches the stated inventory and the
  purge rule (choice 2). Evidence: a handler test that reads
  `receipts.result_json`. Area: board unit 4.
- **TM4-3.** TM3-2 again: after `resume --fresh` of an agent removed from a
  channel since its last accepted board wake, the re-sent wake is
  withdrawn at send and never reaches the runner. Evidence: an acceptance
  test. Area: board unit 5.
- **TM4-4.** TM3-3 again: a wake withdrawn at send never appears, by its
  text, in the target's or its parent's `subscribe`, `client.subscribe`,
  `client.thread` or `client.snapshot`. Evidence: an acceptance test with
  real agent tokens. Area: board unit 5 and client API unit 1a.
- **TM4-5.** An agent that reads every left-out question with `board.read`
  and ends its turn without replying is settled, and an idle agent with
  left-out questions gets one wake for them (V4-3). Evidence: settled and
  reactor tests. Area: board unit 3b.

## Refused

None. No check was stopped by a model policy.

## Noted, not filed

- **Turn-cost and blocking-wait amplification.** Change B7 lets any member
  that passes reach rule 4 cancel another agent's blocking wait by asking
  it a question, and a confused member can repeat this. The open-post cap
  limits how many are open at once, not the rate. This is a cost and
  availability concern, outside the six responsibilities, and the same
  trade-off the engine makes for its own requests.
- **Holder-based `board.status` access.** A grandparent becomes an agent's
  holder while the parent is paused, and can then read the agent's board
  ids and counts. The reply holds no text and no channel name (criterion
  5.6), so this is metadata only, and it follows the engine's own rule.
- **Format characters.** Control characters are removed, but Unicode
  bidirectional overrides are not. Headers hold only fixed words and ids.
  Rendering in the web page and the pane viewer is piece 2's job.
- **Rebuilt wakes copy text again.** Each merge or rebuild writes a new
  `DeliveryQueued` with the full body. The inventory covers it.
- **Self-imposed limits.** The board has none, so that exemption does not
  apply.

## How this review ran

I read the reviewer base, the threat-model reviewer file, the four rule
files, the task's inputs, the plan, the contract, the decisions log, the
known gaps, the rulings, the client API contract's sections 1 to 6, the
round 3 findings map and both round 3 threat reviews. I checked code at
`8ff4c9b` by reading files only. No application test, build, attack test
or dependency install ran. No commit, push or team message was made. The
assigned scratch folder was never created and is absent. Only this result
file was written.

One correction to my own earlier work: in round 3 I marked row 75 as
holding. V4-1 shows that it did not, in round 3 as now.
