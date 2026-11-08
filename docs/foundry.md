# Run the Foundry through LGcode

This recipe maps Steps 3, 4, 5 and 8 of the Founder OS Software Foundry
skill to LGcode. The source is
`plugins/harness-sessions/skills/software-foundry/SKILL.md`, read at
Founder OS commit `33228a7dcd122e25729c761d311b178fd30f852d` on 2026-11-04.
The workflow is described here in new prose. No source code is copied.

The recipe follows WS-8, task 8a, in the
[roles plan](../.plans/plans/shepherd-foundry-roles/plan.md).
It is the input for a later rewrite of the external skill. Writing it does
not switch a running Foundry over. Task 8b checks the composed service.
Task 8c checks real harnesses on the owner's accounts. Those checks and the
external rewrite have their own units.

The engine runs agents through the Agent Client Protocol (ACP) first.
Interactive harness terminals are the second delivery mode. The same roles,
groups, board and client Application Programming Interface (API) apply to
both modes. An interactive-only harness feature still needs that mode's
support. This recipe does not claim that native terminal flags work in ACP.

## Prepare the owner and the orchestrator

Start the engine with `lgcode serve --detach` using the project's normal setup.
Use the owner's authenticated terminal or logged-in web client for owner
settings. Agents use their own identity supplied by the engine. Never copy
the owner credential into a brief, a prompt, a log or an agent environment.
The engine supplies `LGCODE_SOCKET` and `LGCODE_TOKEN` to its agents.
Do not print their values.

The owner starts the run's manager with `start`, role `orchestrator`, a
run group such as `run:foundation`, and the confirmed task as its first
prompt. The manager starts each area lead. Each lead starts its workers.
The caller of `start` becomes the parent. A role string cannot choose a
different parent or give an agent more authority.

The examples use the command line's `--input` object in JavaScript Object
Notation (JSON). JSON is also the wire payload format. The command line
adds a `requestId` when it is absent. Save returned identifiers rather than
using display names as identifiers. A retry of an uncertain write must use
the same explicit `requestId` and payload. Read commands take fresh reads.
The web client calls the same command names with authenticated payloads.

For example, the owner can start the manager with this payload after
substituting the actual repository path and selected model:

```sh
lgcode start --input '{"name":"foundation-manager","role":"orchestrator","harness":"codex","account":{"_tag":"any"},"model":"<selected model>","effort":"high","permission":"ask","folder":"/absolute/repo","runMode":"acp","groups":["run:foundation"],"prompt":"Read the confirmed run brief and coordinate its areas. Begin with roles.orient."}'
```

Each agent calls `lgcode roles.orient --input '{}'` at the start of its assignment.
The reply gives its identity, parent, visible team and role advice. The
owner may load team-specific advice and bounded limits with
`roles.role-file.set`, whose `content` is the role file's JSON text.
`roles.role-file.get` returns the file and its hash. Role names such as
`lead:backend` and `worker:builder` select named advice from that file.
Roles describe conduct. The engine's holder and permission checks govern
authority.

Read `roles.settings.get` before changing settings. Use `roles.settings.set`
with the intended complete `settings` object, preserving existing limits
and switches that the owner wants to keep. The settings are replaced, not
patched. The sheepdog is the engine service that watches the run.

No harness qualifies for standing permission rules in this build. The
owner deferred their parser, commands and permission pre-check until the
recordings are available. Keep `standingRules: false` and route permission
requests through the normal holder path. Do not try to add a standing rule
or count an automatically answered test permission as part of this run.
The deferred path is separate from the sheepdog's working switches and
capacity handling.

## Step 3: Open an area

1. Keep area confirmation, branch naming and dependency decisions in the
   skill. Create `area/<area>` and its worktree using git under the run's
   repository rules. The team's worktree root is `<repo>/.worktrees/`.
   It must be ignored by git. Check this before creating worktrees with
   `git check-ignore <repo>/.worktrees/probe`. Add the ignore rule through
   the repository's normal change process if it is absent.
2. Keep every worktree outside harness settings folders. Never use a root
   such as `.claude/worktrees/`. The engine treats every path beneath
   `.claude`, `.codex`, `.gemini` or `.cursor` as a settings path. This also
   applies when the repository itself is inside one of those folders.
   Settings files inside an otherwise valid worktree remain protected.
3. Install the lead's scoped instructions and write its task file before
   launch. Scope generation, the scope list, role files, allowed paths and
   fallback notes stay in the skill. Do not bypass an owner-routed settings
   write to install a scope. Keep `.foundry/` ignored.
4. The manager calls `start` with the lead's role, area group, absolute
   worktree folder, harness, account selection, model, effort, permission
   ceiling and first prompt. For example, its role is `lead:backend` and
   its groups include `run:foundation` and `area:backend`. Use
   `runMode: acp` for the first implementation. The lead is the manager's
   child because the manager made this call.
5. The lead calls `roles.orient`. Open its team channel with `board.open`,
   specifying `group: "area:backend"` and the returned lead identifier as
   `anchorAgentId`. Save the returned `channelId`. A group-bound channel
   follows that group's membership within its anchor's subtree. Use `group` to change membership;
   `board.members` applies to a plain channel instead.
6. Start helpers through `start` with descriptive worker roles and the
   appropriate groups. A relayer can be `worker:relayer`, a design partner
   `worker:designer`, and a reviewer `worker:reviewer`. Their briefs still
   define their conduct. Helper roles do not create new permission levels.
7. Put shared dependencies on a channel both leads can read. Use a plain
   channel with `board.members` for an explicit cross-area membership, or
   a shared group and a channel anchored at their common manager. Dependency notes, ordering
   agreements and the rule for when to copy the manager stay in the skill.
8. Enable the sheepdog through the owner's settings when the run is ready.
   Do not start separate monitoring processes. Use `roles.actions.list`
   to inspect its paged records and `client.snapshot` for current state.

This payload opens an area's channel from an identity allowed to manage it:

```sh
lgcode board.open --input '{"name":"backend-team","group":"area:backend","anchorAgentId":"<lead id>"}'
```

The channel name must start with a letter and contain only letters, digits,
underscores or hyphens, with at most 64 characters. The command line does
not normalize a display name into that form.

The rest of the source step maps as follows. Rows marked as team workflow
remain in the external skill.

| Source action | LGcode operation or team workflow |
|---|---|
| Create the area's branch and worktree. | Team workflow uses git and the worktree root above. LGcode receives the folder through `start`. |
| Create tabs, split panes to the right, wait for a ready shell and keep at most three workers visible. | Team workflow retains the layout policy for interactive mode. ACP uses the client roster and threads without a shell-ready step. |
| Label panes with the Foundry role and suppress fast modes. | Team workflow keeps the labels and vendor policy. `start` records the role, model and effort. A pane label is not an engine identity. |
| Select an advisor lead, restrict the advisor to that launch and audit its use. | Team workflow retains the owner-approved trial and advisor log. Use it only with verified harness support. LGcode has no advisor-selection command. |
| Start the lead and send its task file. | `start` carries the first prompt. Use `prompt` for later work. Inspect the roster or thread after an uncertain response before retrying the same write. |
| Start the relayer beside the lead and give it its brief. | `start` gives a helper its worker role and first prompt. The skill keeps the short-question and verbatim-answer policy. The owner can answer through the authenticated client. |
| Start the temporary evaluators and give them direct owner access. | `start` gives each a worker role and a shared group. The skill keeps their independence, task files, scoring, disputes and owner-only decisions about skill changes. |
| Open the infrastructure lane with its special branch and staffing rules. | `start` gives its lead a role and group. Team workflow keeps its no-workers rule, infrastructure repository, requests, pointer changes and prohibition on applying or deploying. |
| Start a shared test runner and send heavy suites to it. | `start` creates `worker:tester`. A shared channel carries `test-run:` requests and replies. The skill keeps load limits, allowed commands, replacement requests and the rule that the runner edits nothing. |
| Create a team, enroll a wave before kickoff, set its briefs, link teams and track the human authority behind creation. | `start` establishes parentage and initial groups before the first prompt. `group` changes groups later. `board.open` and shared channels replace links. The skill keeps the charter, scope and audit policy. There is no enrollment race or separate human-only team registry to impersonate. |
| Assign the manager, leads, workers, relayer and steward to the right team. | Roles and groups identify them. Management rights still follow parentage and the current holder. Membership alone grants no management rights. |
| Watch team idleness and snooze a team rightly waiting elsewhere. | The sheepdog's team-idle rule reports to the lead's holder. The owner uses `roles.snooze` with `group` and an absolute `until` time in epoch milliseconds. Log the reason in the run record. |
| Watch capacity failures and move a seat to an alternate after retries run out. | The engine holds eligible deliveries and the sheepdog releases them after the backoff. Its give-up notice asks the holder to act. Selecting the model-sheet alternate stays in the skill. |
| Collect a whole wave with one wake and report missing work. | Use one board request in `all` reply mode, as below, or an engine `wait`. File result conventions and deadline policy stay in the skill. |
| Mute leads, batch routine arrivals and avoid acknowledgment chatter. | Board reply modes and normal wake batching replace muting. Use `board.acknowledge` when starting a response. The skill keeps its rule against unnecessary posts. |
| Keep context bounded, flush pending messages and enforce the worker age cap. | The sheepdog schedules compaction and cache flushes when supported usage is available. Age and runaway notices ask the holder to decide. The skill keeps its two-hour worker cap and advisor audits. |
| Start a permissions steward only when the owner requests it. | The owner can answer directly through the client. If retained, the steward is a helper created only on request, with the external permanent folder and approval log described below. |

## Step 4: Start workers and collect a wave

The lead keeps the task sizing, model-sheet lookup, vendor allowance check
and test-writer selection in its workflow. Keep one writer per file set.
Tasks that share files run in sequence or belong to one worker. Small tasks
can remain with the lead. Record each assignment in the run log.

Create each worker branch and worktree with git. Install its scope and write
its task file before `start`. The task file still names its role files,
allowed changes, required checks, result path and completion marker. The
lead calls `start` from its own identity with `role: worker:builder` or
another named worker role, the area group, chosen model and effort, and a
prompt that names the task file and asks for `roles.orient` first. The
engine records the lead as parent before delivery. The folder rule allows
a registered sibling worktree in the same repository after its identity
checks. A refused folder must be corrected or raised to the owner through
the normal question path. Never enlarge permissions to bypass that refusal.

Use the same start path for Codex, Claude and Cursor where their configured
adapters support the selected mode. Keep interactive-only launch options
in the harness configuration and the external skill. Do not substitute a
headless vendor invocation or send keys to a terminal as a delivery path.

After starting the wave, the lead writes one board hand-off addressed to
the returned worker identifiers with `reply: all`. Here is a two-worker
example:

```sh
lgcode board.post --input '{"channelId":"<team channel id>","text":"Complete your assigned task. Write your result file, then reply to this post with its path and commit.","to":[{"_tag":"agent","agentId":"<worker one id>"},{"_tag":"agent","agentId":"<worker two id>"}],"reply":"all"}'
```

Save its `postId`. Each worker acknowledges the post when starting its
response with `board.acknowledge`. When finished, it writes the result file
and replies using `board.post` with `replyTo` set to that identifier,
`reply: none`, and the lead as its addressee. This is an intentional change
from the source's file-only finish: LGcode does not watch result files.
The lead receives one completion when all obligations resolve. It reads
the dispositions before treating a wave as successful. A stopped,
undeliverable or non-answering worker is not a successful result.

Use `board.read` for the post, replies or incoming page, following its page
cursor. Acknowledgment means the agent took up a post; it is not a result.
Do not send a separate completion prompt, acknowledgment post or broadcast
for every arrival. Blocking questions use a directed post that asks for a
reply, or `ask` when the engine's holder should answer the question.

An alternative is `lgcode wait --block --mode all <worker ids>`, called by
the parent. The owner can use `client.wait`. A wait reports settlement and
held requests; it does not prove that a result file is complete or that
tests passed. Read each result and check its evidence. Keep workers and
reviewers in separate collections when their completion contracts differ.
Result files still contain the harness, model, effort, commits, checks,
transcript location, failures, open questions and the final marker.

## Step 5: Watch, answer and escalate

Use `client.roster` for agent identities and states, `client.snapshot` for
open permission requests and questions, and `client.thread` for paged
conversation events. Follow changes with `client.subscribe`. Save its
sequence and reconnect after that sequence. These reads replace screen
scraping. An agent sees only records its read rights allow.

For an in-scope permission request, read its offered options and call
`answer` with `kind: permission`, its `id` and the narrow `optionId` for
that request. Deny an out-of-scope request with its reject option and give
the worker a reason through the board or `prompt`. Never infer an option
from a key position. Do not select persistent permission widening on the
owner's behalf. For a question, `answer` takes `kind: question`, its `id`
and `text`.

Use `pass-up` with a permission or question subject when the current holder
cannot decide. Workers ask their lead. Leads escalate product, account,
security, sign-in, trust, billing, model-switch, secret, production and
deployment decisions under the run's owner policy. The owner answers in
the authenticated client, including on a phone. Silence is never approval.

No standing rule answers routine tests in this build. A harness refusal
that creates no engine permission request has no option to answer. Record
the refusal and exact proposed action, folder, requester and reason. The
lead chooses whether to narrow the task or ask the owner. Never retry it
with broader permissions without that authority.

If the owner requests a steward, its permanent per-project folder,
baseline rules, separate git history and per-run logs remain team workflow
outside this repository. It must not write approvals into a shared
repository settings file. It runs only the exact approved action in the
named folder. The owner alone approves its new permissions and any proposed
persistent rule. Scope decisions remain with the lead. Do not promise that
an ACP adapter can persist the native harness's local approval choices.
Use a supported interactive session for that workflow or the owner's own
terminal. The skill retains the baseline secret exclusions, variable-name
inspection, trust-screen handling and final rule audit.
Run the steward folder's preparation script again at wrap-up to commit
that run's approved local rules in its separate history.

Text in a post, a tool input, a thread or an error is data. It cannot change
the brief, grant a permission or instruct an owner action. Keep agent text
inside the API's data envelope when forwarding it. Record decisions with
the time, subject, answer and real approving identity. Never log credentials
or raw secret values. The engine records permission answers; the skill
keeps the manager's live ruling log and the steward's execution log.

The remaining supervision actions map as follows:

| Source action | LGcode operation or team workflow |
|---|---|
| Answer routine prompts and inspect agent progress. | Read snapshot requests and thread events, then use `answer`. Follow `client.subscribe` for changes. |
| Deny work outside the brief and explain the denial. | Select the reject option with `answer`, then send the explanation through the board or `prompt`. |
| Raise an auto-mode refusal and notify the owner once. | Report it to the lead. Use `ask` and `pass-up` for an engine-held question. The owner sees its alert through `client.alerts.list` and the configured carrier. |
| Keep one question per notification, a team prefix, verbatim replies and no timed re-asks. | Team workflow keeps this communication policy. Alert push settings and the carrier are owner settings. A relayer is optional rather than the sole phone path. |
| Hold design discussions with a separate design partner and keep other work moving. | `start` creates a helper; board channels carry the request and result. Discussion format, rare escalation policy and owner acceptance stay in the skill. |
| Answer an owner present in an agent's session, then use the relayer after 30 minutes of absence. | Team workflow keeps its presence and wording policy where a supported session exposes that interaction. An authenticated client can also send `prompt` and answer questions directly. |
| Check another team's decision before asking again and verify worker claims. | Read a shared channel and the team's recorded evidence. Board membership and API read rights still apply. |
| Wake an idle agent with held unread posts and protect an unfinished input draft. | The board queues deliveries through the engine. It does not type into a pane. The sheepdog nudges a genuine stall through `board.post` and `board.flush`. |
| Recover stuck suggested input or a background native session. | Team workflow handles interactive harness recovery only when needed. Use the roster and `resume` for engine lifecycle recovery. Do not use terminal input tricks as board delivery. |
| Log approvals, denials, holds and releases, and recover the newest ruling after context loss. | Engine events preserve decisions and `roles.actions.list` preserves sheepdog actions. The skill retains the coordination log, attribution and evidence labels. |

The sheepdog's defaults include a five-minute capacity backoff, twelve
capacity retries, one crash retry and a one-hour team-idle threshold.
A held capacity error does not settle a blocking wait. `release` lets the
owner or current holder release it early. Exhaustion is reported to the
holder, which chooses a replacement or a model-sheet alternate. A crash
retry resumes the existing agent and sends its carry-on once. A later crash
is reported instead of retried indefinitely.

The stall rule accounts for work an agent awaits through the board, open
requests and waits. A lead waiting on busy workers normally has no stall
clock. The owed-reply exception still lets the clock run for a post whose
eligible agent author reaches nothing busy except through that lead
(roles decision 88). An owner-authored post does not qualify for that
exception. A circular dependency that ends at idle agents can stall. The
sheepdog nudges and reports; it does not decide the project's next assignment.
Runaway, age and role-advice notices likewise leave the decision to the
holder. Compaction and cache flushes depend on supported usage information.
They do not invent a context estimate when the adapter supplies none.

Every notice goes to the subject's nearest idle or working ancestor, or
to the owner if there is none. Notices skip a paused parent. If a recipient
stops or crashes before reading a notice, it is sent once to the new
holder. The action record names the subject and recipient, so the manager
can explain why a notice bypassed a lead.

## Replace a worker and recover a cut hand-off

The holder calls `roles.handoff` with the old worker's `agentId` before
starting its replacement. Keep the returned history as enveloped data in
the replacement's first prompt. Include this instruction outside that data:

> Ask your lead by a board post for any hand-off part marked as cut. Include the marked sequence numbers.

The replacement posts the request to its lead. The lead reads the marked
sequences with `client.thread`, follows pagination as needed, and posts the
available cut part to the replacement. `client.event` can retrieve one
visible whole event. Preserve the returned `data` envelope when forwarding
it. Redacted or owner-only material stays unavailable. An agent-visible
hand-off can mark a later prompt as cut because the underlying queued
delivery is owner-only; ask the owner when that missing material is needed.

The `omitted` field lists exact sequence ranges, with at most 64 ranges per
reply. If the hand-off includes `omittedNext`, call `roles.handoff` again
with the same `agentId` and `requestId`, and pass that cursor as `omissions`.
Repeat until `omittedNext` is absent. Every page repeats the original summary
and covers the same history boundary, even if the old worker receives more
messages. The cursor includes the original request identifier, because
changing its encoded size could change the summary's budget. A continuation
with a different identifier is refused. Read the listed sequences through
`client.thread` or `client.event` when their full content is needed.

The Model Context Protocol (MCP) tool generates the first request identifier.
For each continuation, pass the same `agentId` and the returned cursor as
`omissions`. The connector uses the cursor's original identifier for that
read, because the tool has no top-level `requestId` parameter. Every tool
call still checks the caller's current credentials and management rights.

The replacement cannot read its predecessor's thread or obtain its hand-off
directly. Siblings have no such read right. The lead can read its child;
an effective holder can act while an unavailable parent is bypassed. Those
rights are checked on every read and may end when the parent recovers.
Have the replacement call `roles.orient` for its own current assignment.

## Step 8: Wrap up and stop the run

1. Read `client.roster`, optionally filtered by the area group. Save the
   returned identifiers, parents, roles, harnesses, models, efforts,
   folders and session references. Each lead sends the owner the relevant
   agent identifiers and intended archive paths. The owner runs
   `lgcode thread export <agent id> --out <archive file>` for each
   conversation from the owner's authenticated terminal. The command
   requires the owner identity, pages the thread and writes a local file
   with mode `0600`. It refuses an agent's enveloped thread reply, even
   when that agent may read its child's thread. Keep the engine-supplied
   agent credentials unchanged, and never give agents the owner credential
   or unwrap their replies to export them. The owner confirms the exports
   and sends each lead the saved archive paths through a board post or
   prompt before reporting proceeds.
   The owner-run `pnpm live-check:roles` script follows the same responsibility
   through its owner client.
2. Each lead builds its team's report from the worker result files, roster
   and exported threads at the owner-confirmed archive paths. Keep the
   source skill's attribution table: commit, originating branch, agent,
   harness, model, effort, reviewers and transcript or export path. Git
   identifies commits and branches; the roster does not prove authorship
   of a commit. Keep worker branches on
   the remote for later attribution.
3. The manager reports the area branches, delivered changes, review
   verdicts, risks, approvals and steward log to the owner. The one journal
   offer, the manager's shared-roadmap change, model-ledger updates,
   evaluator scores and disputes, allowance readings, lead approval audits
   and skill-feedback entries stay team workflow. Only the owner decides
   model-sheet changes. Label results by the evidence actually obtained.
4. Keep the repository's merge checks and approval rules. In particular,
   reject a change that adds tracked `.foundry/` paths. Branch pushes,
   pull requests and merges are git and hosting workflow, not a role's
   implied authority to deploy or merge a base branch.
5. Copy the area's task files, results, logs, scores and owner-confirmed
   exports into its run archive before deleting a worktree. Confirm that
   each archive path from step 1 is saved there before cleanup. If an export
   is missing, wait for the owner's export and path handoff. Board history
   remains in the engine's event record.
   Legacy team folders, if present during migration, are still archive
   inputs. Check task names, stage coverage and cross-team duplicate files,
   and record native session identifiers for recovery.
6. Use `stop` for each worker and helper, then its lead. Check the roster
   after stopping them. Archive before removing merged worktrees with git;
   never force removal of unpushed work. Remove area worktrees only after
   their records are saved. The skill keeps tab cleanup for interactive
   mode. Report the stage, pull request, archive and head commit to the
   evaluators through their board channel.
7. At run end, stop any retained test runner, steward and evaluators under
   the owner's lifecycle policy, then the manager. Stop any old monitoring
   processes retained during migration. No legacy watcher should keep
   delivering into a run now driven by LGcode.
8. Stop the roles through their switches, never by downgrading the engine.
   The owner reads `roles.settings.get`, preserves wanted limits and sends
   `roles.settings.set` with `sheepdog: false` and `standingRules: false`.
   Turning the sheepdog off releases its open capacity holds and cancels
   its timers. Check the roster and action records afterward. Once roles
   events exist, never load the record with an engine version that cannot
   read them.

## What this replaces

These names identify old mechanisms for the later skill rewrite. They are
not commands to run alongside LGcode delivery.

| Old mechanism | Replacement |
|---|---|
| `herdr agent start` and `herdr agent prompt` | `start` and `prompt` deliver through the configured mode and establish engine identities. |
| `herdr agent list`, `herdr agent get`, `herdr agent read` and `herdr agent wait` | `client.roster`, `client.snapshot`, paged `client.thread`, subscriptions and engine `wait` expose state and progress. |
| `herdr agent send-keys` for approvals or recovery nudges | `answer`, `pass-up` and board deliveries handle requests and wakes without terminal typing. Native terminal repair remains an interactive workflow. |
| `synapse-owner.sh`, enrollment waits, team links and dissolution | Parentage, roles, groups, channels and `stop` provide engine membership and lifecycle. Charters and dependency agreements remain team workflow. |
| `collect.sh` | A board request in `all` mode gives one completion for a wave. Engine `wait` is the settlement alternative. Results still need to be read. |
| `board-waker.sh`, lead muting and turn-end board polling | Board delivery, reply obligations and the sheepdog's stall rule provide wakes. |
| `team-idle-watch.sh` and its snooze command | The team-idle rule and owner `roles.snooze` cover idle teams. |
| `capacity-retry.sh` | Engine holds, sheepdog backoff, `release` and give-up notices handle supported capacity errors. |
| `context-keeper.sh` and manual compaction trigger files | Usage-based sheepdog scheduling and `compact` provide context management. The worker age rule reports to the holder. Advisor auditing stays team workflow. |

## Check the migration before switching the skill

Compare each row above with the source skill's four steps. Task 8b runs
the composed-service acceptance flow through its Unix socket with fake
agents and production defaults. Its standing-rule step is omitted while
no harness qualifies. Task 8c belongs to the owner's later real-account
checks with `pnpm live-check:roles`, including a timed compaction or flush and
a genuine idle obligation through its first production-minute stall. That
run must retain its private report with the stall origin, nudge, action and
reply identities. Its collection check requires each exact worker's
authenticated reply to the selected wave and channel. An aggregate answered
closure alone is insufficient. Allow the normal ten-minute worker stall
interval in addition to the cache wait. The owner or manager then
rewrites the external skill from this recipe. Keep the old workflow intact
until that switch, and avoid running both delivery systems on the same
agents.

The stall check first observes the board's reminder and the worker's
unanswered reminder turn. The resulting `no-answer` disposition leaves the
obligation open. The stall interval starts at the worker's latest turn end,
including that reminder turn. The report records those sequences and the
elapsed time before the first nudge.

To repeat the stall check after a successful timed flush, run
`pnpm live-check:roles --skip-timed-flush`. The collection, first stall,
exports and shutdown still run. The report marks `timed-flush` as `SKIP`
and reports `INCOMPLETE` when the remaining steps pass. The process exits
with code 1. A run with the timed flush skipped does not satisfy the full
real-account check.
