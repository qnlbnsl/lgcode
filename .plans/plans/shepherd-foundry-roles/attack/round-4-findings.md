# Round 4 findings and how each was folded

Round 4 was the full review round after the rework under lead rulings L26
and L27. It reviewed `attack/plan-v5.md` (commit `d7ccaf6`). Six reviews
found 0 blockers, 13 majors and 19 minors, graded 6 to 8, with no
refusals. The reviews are copied into this folder as `round-4-*.md`. The
folded plan is frozen as `attack/plan-v6.md`.

Prefixes name the review. A is the architect (Sol), and C is the critic
(Sol). Lo is the logic review (Opus), and Ls is the logic review (Sol). TO
is the threat model (Opus), and TS is the threat model (Sol).

Under L27, this round's blockers and majors go to the owner with their
fixes. There are no blockers.

## How the majors split

Six majors are gaps in the shared client API contract, which the roles
build on. Plans-api fixes them first, in contract v4, as the lead's shared
items S1 to S4. This plan folds them when the lead sends v4's commit.

Seven majors belong to the roles. Two of them, Ls-R4-L2 and Lo-R4-L3,
describe the same issue, so the roles' own majors are six issues. All
seven are folded now.

## The roles' own majors, folded now

### Ls-R4-L2 and Lo-R4-L3: a rule-answered request could end a blocking wait as "request held"

- **Issue:** WS-7a wrote the request and then its rule answer as two
  writes. The first write ran the wait checks alone, so a lead in a
  blocking `wait` on the asker was woken with "request held", for a
  request that the rule then answered. The first write also routed the
  request, so an owner-held asker could raise an approval alert (TO F5).
- **Fix:** A rule-answered request is one projected batch. Its routing
  events are replaced entirely, so no `DeliveryQueued` and no
  `OwnerNeeded` is written. The wait checks run once, on the projection of
  both writes. Both caller envelopes are kept. An unmatched request is
  routed as today, and the engine's W19 wait tests keep their
  expectations. New tests PC09 and PC10 cover the waiting holder and the
  owner-held asker.
- **Decision row:** 82.

### Ls-R4-L1: a usage-limit pause with no known reset made its waiting lead look stalled

- **Issue:** A worker paused with no known reset was neither busy nor the
  owner. Its idle lead was then waiting on nobody, so the lead was nudged
  and later advised to replace the worker. Lo-R4-L6, a minor, found that
  the same team was also reported idle every hour.
- **Fix:** Such a pause counts as the owner, as a signed-out agent does,
  because no timer will resume it and the owner already has the alert.
  When the account becomes usable, the clocks it stopped restart from
  zero, also across a restart. New tests TI12 and ST22.
- **Decision row:** 83.

### Lo-R4-L1: the cache rule skipped every lead with a working worker

- **Issue:** The cache-keeping rule treated any open wait or own post as
  pending work, so it skipped a lead whose workers were working. That is
  the case Foundry's `context-keeper.sh` exists for.
- **Fix:** An agent is skipped only while it has a delivery queued or
  sent, an open request or question of its own, an open blocking `wait`,
  or a compaction. A non-blocking wait or the agent's own open post no
  longer skips it. New tests CM18 and CM19.
- **Decision row:** 84.

### Lo-R4-L2: a Foundry worktree under `.claude/worktrees/` is a protected settings location

- **Issue:** The engine's settings test matches any `.claude` segment, so
  every path in such a worktree is a settings path. Every file edit there
  goes to the owner, and no standing rule can match.
- **Fix:** The plan fails closed there, with tests M70 and PC14.
  `docs/foundry.md` tells teams to put worktrees outside any settings
  folder, for example `<repo>-worktrees/`. Narrowing the engine's test
  touches a settings rule, so the planner did not plan it. It goes to the
  lead as an issue for `docs/issues.md`. Known gap 22 states it.
- **Decision row:** 85.

### C-R4-C2: WS-7c's route could not carry the turn's usage to the log

- **Issue:** The adapter reports the turn's usage on its idle frame. The
  runner returns from that frame before translation, so changing
  translation alone could never put usage on `TurnEnded`.
- **Fix:** The runner collects usage from the idle frame and keeps the
  last `usage_update.used`. Its internal `turnEnded` event carries both,
  the command handler decodes them, and the delivery planner copies them
  into the persisted event. Tests run from the raw idle frame to the log.
  Lo-R4-L9, a minor, is folded with it: compaction uses
  `usage_update.used`, else the last model request's own numbers, never a
  sum over the turn.
- **Decision row:** 86.

### TS-R4-TM-3: WS-7b had no runner outcome to carry a capacity error

- **Issue:** The runner maps every classified error to a pause. A
  capacity class added to `classifyError` would therefore have paused the
  agent, instead of reaching the hold.
- **Fix:** Capacity is its own internal runner outcome, `capacity`, never
  a pause. The classifier's type, the runner's `finish`, the
  `promptReply` outcomes and the handler's decode all carry it, and the
  delivery planner sends it to the hold. Its phrases come from a recorded
  adapter error frame, or else from the provider's documented error type.
  A harness with neither keeps today's return. The error-classification
  test gains a third fixture kind, and test K14 runs a recorded frame
  through the real adapter and handler.
- **Decision row:** 87.

## The shared majors, waiting for contract v4

These six are folded when the lead sends client API contract v4's
commit.

| Finding | Shared item | What v4 must settle |
|---|---|---|
| A-R4-A1 Planner replies cannot carry a post id | S1 | How a piece's planner returns a durable reply, such as the post id that `roles.notice` needs |
| A-R4-A2 Read visibility has two incompatible definitions | S2 | Whether a read follows direct-child structure or inherited rights |
| C-R4-C3 Visibility equates two rights rules | S2 | As A-R4-A2 |
| TS-R4-TM-2 Direct-child reads conflated with inherited rights | S2 | As A-R4-A2 |
| C-R4-C1 Event registration omits the lifecycle table | S3 | The lifecycle cell rule for piece events, and `state-machine.test.ts` |
| TS-R4-TM-1 The caller and device do not survive a log read | S4 | How the service caller and the device survive a read of the log. The roles' own part is folded now: the first-use reactor reads the durable `answeredBy`, not the envelope's caller (task 2e) |

## The nineteen minors

| Finding | Fold | Where |
|---|---|---|
| A-R4-A3 Edit inventories omit readers and writers | WS-7 half folded: the runner files, `DeliveryHeld` and `DeliveryReleased` lifecycle cells, `state-machine.test.ts`, visibility samples, contracts tests in WS-7's verify line. The shared half (E5, E8, E15) waits for v4 | WS-7 change lists, 7c task, Verify; rows 86, 87 |
| A-R4-A4 The stall task names a removed package | Task 4b cites board v6's `packages/engine/src/board/` export and `packages/contracts/src/settled.ts` | 4b; row 94 |
| C-R4-C4 The stall task imports a removed package | As A-R4-A4 | 4b; row 94 |
| Lo-R4-L4 The hold condition has no failure policy | Called as a total function; an error counts as no (K13) | 7b, 7.3; row 89 |
| Lo-R4-L5 Sheepdog nudges count as busy | Sheepdog work is not busy for the waiting test; the author-blocked exception keeps the owed answer moving (ST20, ST21) | WS-4 intro, 4.2, 4.3; row 88 |
| Lo-R4-L6 An unknown-reset pause makes a team look idle | As Ls-R4-L1 (TI12) | WS-4 intro, 4.1; row 83 |
| Lo-R4-L7 The outage end and the give-up trigger are undefined | The outage ends on a clean turn, a non-capacity error, or the spent-count return; `DeliveryReturned.cause: "capacity"` triggers `GaveUp` (CP08-CP10, K15) | 7b, 7.3, 4.5, 4d; row 89 |
| Lo-R4-L8 Capacity phrases and runner files are unnamed | As TS-R4-TM-3 | 7b; row 87 |
| Lo-R4-L9 The compaction size has no defined basis | As C-R4-C2 | 7.5; row 86 |
| Ls-R4-L3 A completion can look like a sheepdog wake | A wake with any completion is an ordinary turn (N19) | Notices, 3.11; row 90 |
| Ls-R4-L4 The stall task names the old board package | As A-R4-A4 | 4b; row 94 |
| TO F1 "Path-like word" is undefined | WS-7a resolves every word, at most 32 (PC11, PC12) | WS-2 list, 7a, 7.2; row 91 |
| TO F2 The services hold rights they never use | Per-service command lists; `answer`, `board.close`, `start` and `stop` refused; the lead is asked to drop `service` from `answer` in the contract | Services, 3.4; row 92 |
| TO F3 Nothing stops roles code bypassing the service path | An import-boundary test (B01) and real-entry-point refusals (K01-K04) | 3.4; row 92 |
| TO F4 WS-7a blocks the shared runner-event path | Resolution is scoped, off the event loop and time-limited; `answerPermission` runs on its own fiber (PC13) | 7a, 7.2; row 91 |
| TO F5 A rule answer can still raise `OwnerNeeded` | As Ls-R4-L2 (PC10) | 7a, 7.2; row 82 |
| TO F6 `release` is not tied to the rights helper | `mayActForHolder` over `holderAbove`; refusal tests RL04-RL06; `release` in the CLI parity test | 7b, 7.4; row 93 |
| TS-R4-TM-4 New events have no lifecycle cells | WS-7b's two cells folded; the roles' events wait for S3 in v4 | 7b; row 87 |
| TS-R4-TM-5 The stall task names the removed board package | As A-R4-A4 | 4b; row 94 |

Count: 13 majors and 19 minors, 32 in all. Of these, 7 majors and 17
minors are folded now. A-R4-A3 and TS-R4-TM-4 are folded in part. The 6
shared majors wait for contract v4.

## Items for the lead

- The engine's settings test treats every path under `.claude/worktrees/`
  as a settings path (row 85). The planner offers narrowing it as an issue
  for `docs/issues.md`, because it touches a settings rule.
- Drop `service` from the callers allowed to call `answer`, in client API
  contract v4's E13. No roles service calls it (row 92).
