# Round 3 findings and how each was folded

Round 3 reviewed `attack/plan-v3.md` (commit `0f6370a`). Six reviews found
0 blockers, 11 majors and 16 minors, graded 6 to 7, with no refusals.
Every finding is folded below. The reviews are in
`.scratch/foundry-runs/foundation-plans-1/review/roles-r3/lgtm-foundry-roles/attack/`.
The folded plan is frozen as `attack/plan-v4.md`.

Prefixes name the review. A is the architect (Sol), and C is the critic
(Sol). Lo is the logic review (Opus), and Ls is the logic review (Sol). TO
is the threat model (Opus), and TS is the threat model (Sol).

One finding, TO-R3-2, touches the owner's epic words "standing permission
rules". As plans-lead directed (board #134), the planner did not decide
it. It is question 4 for the owner (`question-4.md`, row 68). The plan is
written so that either answer leaves the rest of it unchanged.

## The eleven majors

### TO-R3-2: standing rules would answer no real request in this version

- **Issue:** On today's evidence, no harness the owner uses can be matched
  safely. Claude Code's shell names no folder. Codex runs an approved
  command outside its sandbox. Gemini and Cursor are not recorded. Yet the
  plan asks the owner to put WS-7a's rule check into the engine's
  permission path.
- **Fix:** Not decided by the planner. Question 4 offers three options:
  defer standing rules, record first and build only if a harness
  qualifies, or build now unused. The recommendation is to record first.
  The recording run now comes before units 3, 4 and 11a. Under deferral,
  those three units are dropped, along with the acceptance test's
  standing-rule step and WS-7a.
- **Decision row:** 68 (unanswered, for the owner); also 71, and known
  gap 21.

### TO-R3-1: Codex's "sandboxed value" marks a command that runs outside the sandbox

- **Issue:** The plan took `sandbox_permissions: use_default` as proof that
  a Codex request runs inside its sandbox. Codex's documentation says that
  an approved command runs outside the sandbox.
- **Fix:** No field from the model's own call can be the marker. Only the
  adapter's approval event, saying that the approved command stays
  sandboxed, counts. Codex is expected to be `unsupported`. The recordings
  add Codex's retry-without-sandbox approval, with and without `reason`, in
  both of its modes.
- **Decision row:** 79; known gap 18.

### TS-R3-TM-1: a settings file can be written through an existing symbolic link

- **Issue:** The name check is about spelling only. `cp template.json
  active-config` passes it, even when `active-config` links to
  `.claude/settings.json`.
- **Fix:** Before the request's transaction, WS-7a resolves each path-like
  word with the engine's own resolver, following links. A word that lands
  in a protected location never matches. So does one that cannot be
  resolved for a reason other than "does not exist". A link created after
  the check remains possible, and known gap 20 states it. This changes
  WS-7a, so it goes to the owner with question 4.
- **Decision row:** 79; known gap 20.

### A-R3-A1: the unread-notice re-send needs a read state that `board.status` does not give

- **Issue:** The stall watch re-sends an unread notice when its recipient
  crashes. The board's status gives only counts, so it cannot say whether
  one particular notice was read.
- **Fix:** The roles view tracks each notice itself. The action record
  keeps the notice's post id. The view folds `board.Read`,
  `board.WakeBuilt` and `DeliveryAccepted` to mark the notice read. The
  service still cannot read posts.
- **Decision row:** 69.

### C-R3-C1: a rule's field maxima cannot fit its 2 KiB size

- **Issue:** The separate field maxima add up to 2,816 bytes, so criterion
  1.3a could never pass.
- **Fix:** A rule's encoded form is checked as a whole, at 2 KiB. Each
  field keeps its own maximum, but they cannot all be used at once. The
  test accepts a rule just under the limit, and it refuses a rule whose
  fields are each valid but whose total is too large.
- **Decision row:** 70.

### Lo-R3-L1: "waiting on others" looked only one step ahead

- **Issue:** A worker that asked its idle lead a question was nudged and
  then advised replaced, while a sibling worker was still working.
- **Fix:** Waiting is now transitive. An agent is waiting while any agent
  it can reach through the waits is busy. A visited set stops at cycles,
  so a cycle of idle agents still stalls. Three new tests cover it.
- **Decision row:** 74.

### Lo-R3-L2: a held delivery had no rule for a restart or an account's return

- **Issue:** The engine's reload code would mark the agent "working" with
  nothing sent, and it would stay stuck.
- **Fix:** A held queue counts as neither "requeued" nor "carried" when
  the engine reloads, so the agent is reloaded idle and still held. At
  start-up with the stall watch off, every open hold is released once.
- **Decision row:** 75.

### Lo-R3-L3: the capacity count lagged behind its own release

- **Issue:** The count that ends a hold lived in the stall watch's records,
  which are written after each release. A release by the owner or a lead
  was not counted at all. The count's key was also undefined.
- **Fix:** The engine counts holds itself, from its own hold and release
  events in the same transaction. The count is per agent and per outage,
  and every release counts, whoever made it. A held queue sends nothing
  else.
- **Decision row:** 75.

### Lo-R3-L4: a usage-limit pause made a team look idle

- **Issue:** A worker paused for a usage limit is not busy, so its lead's
  team was reported idle every hour until the limit reset.
- **Fix:** An agent paused for a usage limit with a known reset counts as
  busy, because the engine will resume it. A signed-out agent counts as
  the owner, who already has the account alert.
- **Decision row:** 74.

### Ls-R3-L1: a replaced board wake skipped the capacity wait

- **Issue:** The hold belonged to one delivery. When the board replaced
  that wake with a new delivery, the new one was sent at once, before the
  five-minute wait ended.
- **Fix:** The hold belongs to the agent's whole queue, and `release`
  names the agent. This changes WS-7b, so it goes to the owner with
  question 4.
- **Decision row:** 75.

### Ls-R3-L2: one event cannot tell the alert when a stall has ended

- **Issue:** A stall alert must end on an ordinary turn but not on a
  stall watch turn. An alert source sees one event, and that event cannot
  tell the two kinds of turn apart.
- **Fix:** The stall watch writes `roles.StallEnded` when an ordinary turn
  starts or the agent is stopped, and the alert ends on that event.
- **Decision row:** 76.

## The sixteen minors

| Finding | Fold | Where |
|---|---|---|
| A-R3-A2 Field maxima exceed 2 KiB | As C-R3-C1 | 1.3a, 2a; row 70 |
| C-R3-C2 New packages are not registered for tests | Unit 1 registers both in the root `vitest.config.ts`; first output shows the discovered files | Conventions, 1b, sizing; row 71 |
| C-R3-C3 The recorder cannot make the permission fixtures | New task 2h and unit 3p prepare the recorder | 2g, 2h, sizing; row 71 |
| C-R3-C4 The board-off give-up alert conflicts with the recipient rule | A `board-off` `GaveUp` raises its alert whatever its recorded recipient | Alert sources, Board switched off, 3.6; row 72 |
| C-R3-C5 Crash retries accept undefined values | The setting is 0 or 1; 0 gives up at once | 3b, 4.6; row 73 |
| Lo-R3-L5 Runaway counts a blocking `wait` | Time in an open blocking `wait` is left out | 4.4, 4c; row 77 |
| Lo-R3-L6 The stall watch's compaction ends a stall alert | A compaction the stall watch requested is a stall watch turn | Notices, 3.11; row 76 |
| Lo-R3-L7 Any post resets the stall count | Only a file change, a reply to P, or a post outside a stall watch turn | WS-4 intro, 4.2; row 78 |
| Lo-R3-L8 The maxima do not fit their caps | Rule checked as a whole; snapshot filled in order by encoded size | Snapshot and sizes, 1.3a; row 70 |
| Lo-R3-L9 Two matcher guards fail open | `ModeRefused` blocks matching; names compared without case | WS-2 list, 2.6, 2.8; row 79 |
| Ls-R3-L3 Field maxima exceed 2 KiB | As C-R3-C1 | row 70 |
| TO-R3-3 A title is not a safe discriminator | Only a field the adapter sets that the model cannot choose; a title-copying tool is tested | WS-2 list, 2.4, 2.14; row 79; known gap 17 |
| TO-R3-4 Name check ignores case and misstates the engine's list | Compared without case; names imported from the engine's function | WS-2 list, 2.6, 2c; row 79 |
| TO-R3-5 The mode guard ignores a refused mode | Any `ModeRefused` blocks matching | WS-2 list, 2.8; row 79 |
| TS-R3-TM-2 The maximum-field rule passes 2 KiB | As C-R3-C1 | row 70 |
| TS-R3-TM-3 The alert hook cannot classify a turn | As Ls-R3-L2 | row 76 |

Count: 11 majors and 16 minors, 27 in all.

## Changes the lead is asked to send to the owner with question 4

- WS-7a resolves paths before the rule check (row 79). This applies only
  if standing rules are built.
- WS-7b holds the agent's queue, the engine counts the holds, and
  `release` names the agent (row 75).
