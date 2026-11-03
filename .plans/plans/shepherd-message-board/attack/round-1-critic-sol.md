revise
Grade: 6  B/M/m: 0/7/2  Flags: none

## Review basis

This is the plan-critic review of the frozen message-board plan. Repository code was checked at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. The checkout was clean. No repository files were changed, and no agents were delegated work.

In citations below, `board/` means the supplied `board-r1/shepherd-message-board/` directory. `inputs/` means its sibling `board-r1/inputs/` directory. Repository paths are relative to the recorded checkout. The review distinguishes missing design decisions from implementation checks. No future board test is claimed to have run.

## Findings

### C01. MAJOR — The verification plan does not register either new package with the test runner

Category: Design. Evidence status: confirmed. Responsible builder: the lead and the extension-seam infrastructure builder.

Scenario: Units 1 through 4 put their tests under `packages/board-contracts/test/` and `packages/board/test/`. The required root check runs the existing Vitest configuration, which creates projects from a fixed list of six package names. Neither new package is listed. Adding their manifests does not make their tests discoverable under those project include patterns. The claimed targeted verification also has no project that includes these paths.

Evidence: `vitest.config.ts:4`, `vitest.config.ts:22`, and `vitest.config.ts:26` define the fixed projects. `package.json:13` runs Vitest from the root check. The proposed new test locations and commands are at `board/plan.md:225`, `board/plan.md:273`, and `board/plan.md:362`. The proposed edit scopes at `board/plan.md:529` do not include the root test configuration.

Fix: Expand known gap 4 explicitly to cover test-project registration, and assign the root configuration edit to the seam unit or another authorized infrastructure unit. Add an acceptance observation that test listing includes both new packages and that the root check actually executes their tests. This finding is about the test configuration omitted from that known gap, not a second filing of the missing manifests or scopes.

### C02. MAJOR — The board's wake projection ignores real delivery transitions

Category: Bug (failures). Evidence status: confirmed. Responsible builder: board view and posts/wakes builders.

Scenario: A board wake is sent but not accepted. A usage pause requeues it. The proposed board projection ignores `DeliveryRequeued`, so its index still calls the wake sent. A second post during the pause therefore cannot merge with that queued wake, contrary to the one-waiting-wake rule. Recovery can produce the same transition. A returned delivery similarly remains sent in the proposed index.

Evidence: `board/plan.md:261` makes the board maintain queued/sent wake state. Criterion 2.1 at `board/plan.md:272` explicitly folds only queued, sent, accepted and withdrawn deliveries, and ignores every other event. The engine writes `DeliveryRequeued` on a pause at `packages/engine/src/routing/deliveries.ts:149` and during reload at `packages/engine/src/recovery/reload.ts:94`. Its real delivery reducer handles both requeue and return at `packages/engine/src/views/apply.ts:284` and `packages/engine/src/views/apply.ts:287`. The board's merge guarantee is at `board/contract.md:120`.

Fix: Specify the complete delivery-state transition table for the board index, including requeues and returns, or derive current status from the engine's delivery view instead of maintaining a partial duplicate. Add pause and recovery cases to the fold and merge criteria.

### C03. MAJOR — Removing a live addressee can strand a question indefinitely

Category: Design; Bug (failures). Evidence status: confirmed gap in the contract. Responsible builder: board access and reactor builders.

Scenario: An author asks B a question. The manager removes B from the plain channel while both agents remain live. B can no longer post its answer. The post does not meet the stopped/crashed closure rule, and the seven commands provide no withdrawal or retarget operation. The author remains unsettled indefinitely unless someone restores membership, intervenes with an owner reply, or stops an agent. This also affects an unfinished collection when an unanswered member loses its group label.

Evidence: Managers may remove any member at `board/contract.md:44`. Non-members cannot read or post at `board/plan.md:278`. The stated failure closures cover stopped/crashed addressees and authors at `board/contract.md:88`. The open post holds its author unsettled at `board/contract.md:130`. The complete command list is at `board/contract.md:159`.

Fix: Decide what membership removal does to outstanding reply obligations before building. Options include refusing removal while obligations remain, closing the affected obligation with an explicit reason, or providing an authorized withdrawal/retarget operation. Specify how an `all` collection reports missing members. Include membership changes in the reactor's acceptance scenarios. This is separate from known gap 3, which concerns new agents gaining access through group labels.

### C04. MAJOR — Closing a question leaves obsolete queued wakes actionable

Category: Bug (timing). Evidence status: confirmed gap in the planning algorithm. Responsible builder: posts/wakes and reactor builders.

Scenario: An `any` question addresses B and C. C is busy, so its board wake stays queued. B answers and closes the question. The documented close algorithm wakes the author but never removes that question from C's queued wake. When C becomes idle, it spends a turn on a question that no longer needs its answer. The same omission applies when an author stops and its open questions are withdrawn. Combined wakes require removing only the obsolete obligations while preserving unrelated work.

Evidence: The close and wake-set algorithm at `board/plan.md:307` through `board/plan.md:317` withdraws/replaces wakes only for agents in the newly computed wake set. It does not include other addressees whose question just closed. Criteria 3.3 and 3.9 at `board/plan.md:330` and `board/plan.md:336` do not check those outstanding wakes. The owner criterion at `inputs/rulings.md:4` requires waking only the agent that needs to answer. The engine dispatches the next queued delivery once its target is ready, at `packages/engine/src/routing/deliveries.ts:230` and `packages/engine/src/routing/deliveries.ts:248`.

Fix: Define atomic cleanup of every affected still-queued board wake when a post closes or is withdrawn. Rebuild combined wakes with the remaining obligations, and withdraw a wake that no longer has a reason to run. Keep the stated rule that already-sent wakes are immutable. Test both a wake containing only the closed question and one also containing an unrelated open question.

### C05. MAJOR — Sibling messaging conflicts with the frozen API authority rule

Category: Design. Evidence status: unresolved contract contradiction. Responsible builder: the lead, with the client API and board planners.

Scenario: A common parent puts sibling agents A and B in one channel. The board permits A to question B and to open a direct channel with B. The frozen API says a piece command acting on another agent must use the engine's self/parent-rights rule and must not invent another tree rule. A holds no parent's rights over B. Following that rule literally denies the central board flow; bypassing it silently contradicts the frozen contract.

Evidence: The board explicitly allows existing channel peers at `board/contract.md:55` and queues addressed wakes at `board/contract.md:77`. The frozen restriction is `inputs/client-api-contract.md:222` through `inputs/client-api-contract.md:226`. The actual parent-rights check for the engine's targeted commands is `packages/engine/src/commands/CommandHandler.ts:73` through `packages/engine/src/commands/CommandHandler.ts:76`, using `holderAbove`. The board proposes that same helper at `board/plan.md:285`.

Fix: Obtain a lead ruling that distinguishes authority to manage another agent from authority to exchange board messages with an admitted channel peer. Write the board messaging rule or its explicit exception into the frozen API contract before the board units build on it. Preserve the engine's existing targeted-command rights. This does not ask to reconsider the owner's pending general seam decision.

### C06. MAJOR — The scope exclusions are broader than the owner quotations on their row

Category: Design (scope traceability). Evidence status: confirmed documentation defect. Responsible builder: the board planner and lead.

Scenario: The roles planner is refused work-state support because work items are declared out of scope. Decisions row 4 also excludes watches on files and branches and the test queue. Its actual quotations establish the interactive-mode and team/workflow exclusions. Its references to the other epic slices explain pairing and roles placement, but do not supply the owner's words for those additional exclusions. The row is closed and does not mark that extension of the exclusion list `WIDENED`.

Evidence: `board/decisions.md:14` contains the scope row, its exclusions and its quotations. The work-state refusal relies on that row at `board/contract.md:193`. The mandatory scope-quote rule is in the canonical `plugins/engineering/skills/world-class-plan/SKILL.md:212` and the supplied `agents/plan-reviewer.md`, under “Plan critic.”

Fix: Split the exclusions by their actual source. Supply the dated owner quotation for each additional binding scope exclusion, or mark the extra exclusion `WIDENED` and leave it open for confirmation. Implementation choices may remain explicitly proposed choices. This finding establishes missing scope evidence in the frozen decision row; it does not assert that an unseen conversation never authorized the exclusions.

### C07. MAJOR — Selective wake delivery has no defined rule for read-position holes

Category: Design; Bug (timing). Evidence status: unresolved design decision. Responsible builder: board view and read-position builders.

Scenario: A channel contains 21 unread informational posts, followed by a question addressed to B. B's wake carries the question and at most 20 informational posts. Accepting it must mark those included posts read while leaving the omitted informational post unread. A single channel cursor advanced to the question skips the omitted post. Leaving the cursor behind requires an additional rule to avoid counting or delivering already accepted posts again. Reading a later page directly creates a similar hole.

Evidence: The proposed state has one read position per member/channel and a wake index at `board/plan.md:260`. The 20-post limit is `board/contract.md:123`. Explicit reads move the channel position, while accepted wakes mark their included posts read, at `board/contract.md:137` through `board/contract.md:142`. Neither the contract nor criterion 3.10 at `board/plan.md:337` defines how these sparse reads combine.

Fix: Specify the read-state invariant before building. For example, use a contiguous watermark plus sparse accepted post ids, with a defined rule for advancing that watermark. Alternatively, define an equivalent invariant using the wake index. State how arbitrary pages, repeated reads, merged wakes and late acceptance interact. Add a bounded-backlog case that proves the omitted post remains unread after restart. The eventual data-structure implementation is a post-build check; whether unseen posts may be marked read is a pre-build decision.

### C08. MINOR — The wait criterion overstates what the settled hook controls

Category: Design. Evidence status: confirmed. Responsible builder: the board planner.

Scenario: An agent has an open board question and then pauses. Criterion 3.12 says a waiter is not woken until the question and wake clear. The unchanged engine instead resolves a paused member with reason `paused`, independently of its settled predicate.

Evidence: `board/plan.md:339` states the universal criterion. `packages/engine/src/routing/waits.ts:49` through `packages/engine/src/routing/waits.ts:56` resolve paused, stopped, crashed and nonreloadable interrupted members without consulting `settled`. The approved design expressly preserves those outcomes at `docs/specs/2026-11-01-engine-design.md:481`.

Fix: Limit the criterion to preventing a false `settled` result for an idle member. Add a control case showing that pause/failure results still work with an open board post. Do not change existing wait semantics.

### C09. MINOR — The document-update assignment conflicts with the lead-only ruling

Category: Design (guardrails). Evidence status: confirmed. Responsible builder: the board planner and lead.

Scenario: A unit follows the convention that it must edit `docs/issues.md` in its own change, while the frozen ruling reserves that file to the lead. The feature-list handoff is already described differently, so builders receive inconsistent instructions about the two lists.

Evidence: `board/plan.md:200` assigns issue recording to every unit, and `board/plan.md:502` repeats that division. `inputs/rulings.md:15` says only the lead writes both lists.

Fix: State that each unit reports issues and feature ideas to the lead, and that the lead makes the required list update in the same integrated change. Keep the repository's same-change requirement.

## Risk register

Scores describe launched use. S means severity, F means fallout, and P means probability. Decisions remain pending the owner or lead; this review accepts no risk on their behalf.

| Id | S and reason | F and reason | P and reason | Score and band | Evidence | Owner | Decision and deadline |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C05 | 6: a core messaging flow fails | 5: fixing the frozen boundary needs maintainer help | 10: every sibling-directed use if the generic rule applies | 300; fix before release | Unresolved | Lead and both planners | Pending; before release |
| C02 | 6: wake state and coalescing remain wrong until repaired | 5: repair requires a projection change | 6: an ordinary usage pause or recovery | 180; fix before release | Confirmed | Board view/wakes | Pending; before release |
| C03 | 6: an author can remain blocked indefinitely | 5: a manager must restore or repair the situation | 6: an ordinary membership change | 180; fix before release | Confirmed gap | Board access/reactor | Pending; before release |
| C07 | 4: unread accounting is wrong until reread or repair | 3: the owner can reread the channel | 6: an ordinary backlog or out-of-order page | 72; schedule | Unresolved | Board view/reads | Pending; within phase or owned follow-up |
| C04 | 2: an unnecessary paid agent turn | 3: another turn or owner action corrects stale work | 8: busy peers and first-answer collections are common | 48; record | Confirmed gap | Board posts/reactor | Pending; review at phase end |
| C08 | 2: misleading wait expectations | 3: the owner can interpret the actual reason | 6: a normal pause while awaiting an answer | 36; record | Confirmed | Board planner | Pending; review at phase end |
| C06 | 1: missing authorization trace in a planning artifact | 1: internal planning scope | 10: every reading of the affected row | 10; record | Confirmed | Board planner/lead | Pending; review at phase end |
| C09 | 1: conflicting builder instructions | 1: internal execution only | 10: the written conventions always conflict | 10; record | Confirmed | Board planner/lead | Pending; review at phase end |
| C01 | Required verification gate | Not scored | Not scored | Gate must pass regardless of risk score | Confirmed | Lead/seam infrastructure | Pending; before build verification is accepted |

No acceptance or closing evidence exists for these findings.

## Proposed post-build checks

These checks follow the decisions above. They do not replace resolving the contract gaps.

| Id | Scenario | Expected result | Required evidence | Responsible area |
| --- | --- | --- | --- | --- |
| PB-C01 | Discover and run tests through the root configuration. | Both board packages appear in test listing and execute in the root check. | Test listing, targeted output and full check output. | Seam infrastructure and board tests |
| PB-C02 | Send a wake, pause before acceptance, add another post, then resume; repeat through reload without replay evidence of acceptance. | The board status matches the engine, with one merged queued board wake. Returns clear sent status. | Ordered delivery events, board status, runner calls and rebuild comparison. | Board view/wakes |
| PB-C03 | Close an `any` question while another recipient is busy; repeat with author withdrawal and with a combined wake containing other work. | Obsolete queued obligations disappear; unrelated obligations survive; no empty wake starts a turn. Already-sent wakes remain immutable. | Transaction events and fake-agent prompt/turn counts after release. | Board posts/reactor |
| PB-C04 | Remove the sole unanswered member and remove an unanswered group member during an `all` collection. | The chosen removal/closure rule runs durably and the author has an actionable result. | Public commands, post status, author wake and restart/rebuild evidence. | Board access/reactor |
| PB-C05 | A parent admits two siblings; one posts to the other and opens a direct channel. Repeat with an unrelated unadmitted agent. | The admitted peer flow succeeds under the clarified contract; the unadmitted flow fails. Engine lifecycle rights stay unchanged. | Real agent-token API calls, deliveries, refusals and existing authorization tests. | Seam and board access |
| PB-C06 | Accept a selective wake with more than 20 earlier informational posts; read a later page first; restart and read the remainder. | Only included/read posts count as read. Every omitted post remains discoverable and unread. | Returned post ids, unread counts, accepted-wake mapping and rebuild equality. | Board reads/view |
| PB-C07 | A waited-on agent has an open board question, then becomes idle, paused, crashed or nonreloadably interrupted. | Idle is held unsettled; the existing failure/pause reasons still resolve the wait. | Wait events and actual wake contents through the public API. | Board settled hook |
| PB-C08 | Race a merge with dispatch; replay a stop/post batch; build a wake from text split around a planted secret. | No withdrawn wake is sent, rebuild equals live state, and the assembled body contains no registered secret. | Controlled scheduling trace, runner inputs, stored events and rebuild comparison. | Board wakes/reactor |

PB-C08 gives explicit evidence and ownership to the plan's three existing post-build checks at `board/plan.md:433`.

## Gate assessment

1. Decisions and scope evidence need revision: C03, C05, C06 and C07. The pending owner seam decision is already disclosed and is not re-filed.
2. Done-statements generally have named observations. C01 prevents the proposed new-package observations from running, and C08 states an incompatible expectation.
3. No screen is added. A visual design artifact is unnecessary.
4. The source universe and mapping are present. The map includes all six current message-board feature bullets, despite the prose calling them five. No additional orphan was confirmed within the declared universe.
5. Every workstream has risks and mitigations.
6. Every workstream has verification and environment guidance. C01 is the material feasibility gap.
7. This is the first attack round. Findings have not yet been adjudicated.
8. The inspected existing code anchors resolve at the recorded commit. Proposed board paths are clearly greenfield.
9. The guardrail table is present. C09 needs a consistent lead handoff.
10. Units have work areas, complexity and dependencies. Missing scopes and vendor-limit checks are already known gaps. C01 extends the infrastructure work that needs an assigned owner.

## Noted, not filed

- Known gaps 1 through 7 were read. No duplicate finding is raised for vendor limits, the pending general seam authorization, group-label admission, package manifests/scopes, or unwritten approved seam items. C01 identifies the narrower test-discovery omission, and C03 concerns losing membership rather than gaining it.
- Known gap 2 is stale relative to the supplied frozen API copy: item 12 is present in `inputs/client-api-contract.md`. The board correctly depends on that approved hook.
- The plan's unconditional “exactly once” overview at `board/plan.md:37` should be read with the engine's documented replay limit. The approved design at `docs/specs/2026-11-01-engine-design.md:530` permits duplicate delivery when replay lacks proof, and issue 194 already records it. This review does not reopen that accepted engine behavior or count it again.
- Actual composed-service startup, paired-device posting, sender labels and the interactive test runner cannot be proved before the seam exists. Their implementation belongs in post-build evidence.
- The existing fake agent supports an executable helper step. It launches Node with the supplied arguments at `packages/testing/src/fakeAgent.ts:203`; the real shell launcher is `bin/shephrd:1`. A test can use a Node helper or the CLI TypeScript entry selected at `bin/shephrd:57`; it should not feed the shell launcher directly to Node. No fundamental harness blocker was found.
- Current Effect version 4 documentation was retrieved through Context7 on 2026-11-03. The official [RpcGroup API](https://effect.website/docs/v4/api/effect/rpc/RpcGroup) documents `make`, `merge`, `prefix` and `omit`. This confirms the named composition APIs, not the correctness of the future seam.
- The broad multi-file reads initially exceeded the output budget; relevant files and anchors were reread separately. One read-only issue-filter command used unavailable `python`; it was rerun with `python3`. Neither failure changed any file.
- Node.js 26.13.0 was selected with `nvm use`. No application tests were run for this read-only plan review. The designated scratch directory was never created and is absent.
