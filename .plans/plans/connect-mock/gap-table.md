# Connecting the mock to the engine: the checked gap table

This document replaces the section "What each screen needs" in
[plan.md](plan.md). That section was a first reading made from request names alone. This
table was checked against the source.

It was written on 2026-11-13 by a scout, on the branch `worker/connect-map`, at commit
`7d8a3d4`. Every claim was read from the source. Nobody ran the engine or the mock. Where a
claim could not be checked, the table says "not checked".

## How to read this table

Each screen has two tables. "What the screen reads" lists each field of the mock's store
that the screen shows, by the name the mock uses. "What the screen does" lists each action
the owner can take on it. Both tables name the engine's source with its file and line.

Each item has one of four verdicts:

- **supplied** means the engine has the field or the request, with the meaning the screen
  needs.
- **supplied with a different shape** means the engine has it, but the mapping must change
  something. The last column says what differs.
- **missing** means nothing in the engine supplies it.
- **not checked** means the claim was not traced to the end.

Paths are from the repository root. A short path such as `git.ts:82` repeats a file named
earlier in the same section. The mock's files are in `design/mock/js/`, and the engine's
contract is `packages/contracts/src/`, also called "the contracts" below.

Pure view state is never an engine need. Examples are which tab is open, the widths of the
panels, the colour mode and the filters typed in the browser. Each section lists it in one
line of its notes.

## Facts that apply to every screen

### How the website reaches the engine

- The web server serves every request of `CommandsRpcGroup` over one WebSocket at `/api`
  (`packages/engine/src/client/web/server.ts:198`). Only `debug.compare-views` is left out
  (`packages/engine/src/api/server.ts:105`). So every request in the contracts can be called
  from the website, subject to its own access rule.
- A few routes are plain HTTP (Hypertext Transfer Protocol), outside the WebSocket.
  `POST /api/login` checks the one password (`server.ts:139`). `POST /api/session` checks
  the session cookie (`server.ts:155`). `POST /api/logout` ends it (`server.ts:156`).
  `POST /api/display/open` and `POST /api/display/close` open and close the OpenPencil
  editor, a mock screen or a component in a frame (`server.ts:161`). Their payload is
  `DisplayOpen` (`packages/contracts/src/project/display.ts:7`).
- `client.snapshot` returns `ClientSnapshot` (`packages/contracts/src/client/reads.ts:43`).
  Its `agents` list holds roster rows (`RosterEntry`, `reads.ts:29`). Its `project` section
  is `ProjectSnapshot` (`packages/contracts/src/project/commands.ts:32`), which holds the
  projects, repositories, workspaces, teams, sprints, tasks, a status for each agent, and the
  setup state.
- `client.subscribe` streams every event after a sequence (`client/commands.ts:42`). The
  engine-level `subscribe` does the same without a filter (`packages/contracts/src/commands.ts:141`).
  So a field can be supplied by the snapshot and the events, with no request of its own.
- Every request needs a `requestId`. No call that the mock reports today carries one, so the
  connection must add it.

### The engine knows one machine

- The engine knows one machine, whose identifier is the string `"local"`.
- Project creation refuses any other machine (`packages/engine/src/project/lifecycle.ts:29`).
- Registering a repository or a workspace refuses any other machine
  (`packages/engine/src/project/gitApi.ts:32`).
- Every Git and file request on a workspace refuses a workspace whose machine is not
  `"local"` (`gitApi.ts:48`, `gitApi.ts:62`).
- No contract defines a machine record. The mock shows three machines, so every remote
  machine in the mock is missing in the engine.

### Requests and merges are different records

- The engine has two request kinds, `permission` and `question`
  (`packages/contracts/src/requests.ts:21`).
- The mock has four kinds: `question`, `approval`, `merge` and `failed`.
- An approval is the engine's permission.
- A failed start is not a request in the engine. It is the `startFailure` code on a roster
  row (`client/reads.ts:32`).
- A merge is not a request in the engine. It is a main review, which the owner opens with
  `project.review.prepare` (`packages/contracts/src/project/git.ts:86`). Nothing opens one
  for the owner.
- The owner counts as a lead of every project (`packages/engine/src/project/access.ts:7`),
  so the owner may call every request that a project lead may call.

### The calls the mock reports today

The plan counted 9 kinds of call. The mock reports 14 tags. Every other action changes only
the browser's memory.

| Mock's tag, and where | Contract request | Verdict | What differs |
|---|---|---|---|
| `snapshot` (`app.js:359`) | `client.snapshot` (`client/commands.ts:33`) | supplied with a different shape | The tag lacks the `client.` prefix. |
| `subscribe` with `after: 0` (`app.js:360`) | `subscribe` (`commands.ts:141`), or `client.subscribe` (`client/commands.ts:42`) | supplied | The current website uses `client.subscribe`, which adds a filter and two marker items (`client/reads.ts:20-25`). |
| `prompt` (`actions.js:82`) | `prompt` (`commands.ts:72`) | supplied with a different shape | The mock sends context as display labels, and the contract takes task and file identities (`ContextReference`, `project/context.ts:9`). The mock sends `files`, and the contract has no such field. |
| `cancel-reply` (`actions.js:105`) | `cancel-reply` (`commands.ts:99`) | supplied | The engine refuses it when no reply is being written (`packages/engine/src/commands/cancelReply.ts:10`). |
| `stop` (`actions.js:117`) | `stop` (`commands.ts:100`) | supplied | |
| `resume` (`actions.js:134`, `:157`) | `resume` (`commands.ts:101`) | supplied | |
| `configure` (`actions.js:143`) | `configure` (`commands.ts:68`) | supplied with a different shape | The contract takes only a model and an effort. The mock also changes the subscription and the permission through the same action. |
| `answer` for an approval (`actions.js:154`) | `answer` with `kind: "permission"` (`commands.ts:76`) | supplied with a different shape | The option ids come from the harness, not the mock's fixed words. |
| `answer` for a question (`actions.js:155`) | `answer` with `kind: "question"` (`commands.ts:76`) | supplied | |
| `integrate`, for approving a merge (`actions.js:156`) | `project.integrate` (`git.ts:82`) | supplied with a different shape | `project.integrate` merges a team worktree into another worktree. Approving a merge into the base branch is `project.review.prepare` followed by `project.review.approve` (`git.ts:86`, `git.ts:90`). |
| `review.report`, for sending a merge back (`actions.js:156`) | `project.review.report` (`git.ts:84`) | missing | `project.review.report` records a test or review result. No request sends a merge back with a reason. |
| `create` (`actions.js:218`) | `project.create` (`project/commands.ts:49`) | supplied with a different shape | The tag lacks the prefix. The contract requires a `name`, takes the repository as a tagged union, has no subscription, and accepts only the machine `"local"`. The shell section compares it field by field. |
| `archive` and `restore` (`actions.js:241`) | `project.archive` and `project.restore` (`project/commands.ts:56`, `:57`) | supplied with a different shape | The tags lack the prefix. |
| `team.create` (`actions.js:252`) | `project.team.create` (`project/commands.ts:66`) | supplied with a different shape | The tag lacks the prefix. The contract requires a team `name` and a `worktreeId`, and its stage is the lower-case `design`. |

## The screens

The screens follow the order of the table in `design/mock/README.md`. Two parts of the mock
are not in that table, and they come last: the shell that every page shares, and the New
project dialog inside it.

### Home

`design/mock/js/screens/home.js` `Home` renders one sortable table of open requests, one row per request, with a detail row that holds `RequestBlock` from `design/mock/js/ui.js:303`. A question or approval in the detail row uses the `detail` shape of `RequestBlock`, a merge uses `MergeBrief` (`ui.js:279`) with `MergeFacts` (`ui.js:267`), and the merge button opens `MergeReview` (`design/mock/js/dialogs.js:140`). `BriefCard` (`ui.js:204`) is the `card` shape used on the sprint and task pages, and it is covered here because it carries the richer request fields.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `request.id`, `request.status` (`open`, `answered`) | Which rows are open; the "Show answered" group | `packages/contracts/src/requests.ts:22 ClientRequest.status`, read by `client.requests` (`packages/contracts/src/client/commands.ts:49`) | supplied with a different shape | Engine has a third status, `cancelled`; mock has none |
| `request.kind` | Type column and Type filter: Question, Approval, Merge, Failed start | `packages/contracts/src/requests.ts:21 ClientRequest.kind` | supplied with a different shape | Engine has `permission` and `question` only; merge and failed start come from other records, see the rows below |
| `request.heldBy` (open requests held by a lead are hidden) | Whether a row counts for the owner | `packages/contracts/src/requests.ts:15 IdentityRow.holder` | supplied with a different shape | Engine gives the holder as an actor; the website filters `holder._tag === "owner"` (`packages/web/src/pages/projectData.ts:60`) |
| `request.title` | Title column, brief heading | Question: `packages/contracts/src/questions.ts:14 title`, in `RequestDisplay` (`packages/contracts/src/requests.ts:6`). Permission: `packages/contracts/src/events.ts:198 PermissionRequested.description`, cut to `display.preview` (`packages/contracts/src/requests.ts:9`) | supplied with a different shape | A permission has no title, only a description; the website falls back to `display.preview` (`packages/web/src/requests/RequestList.tsx:15`) |
| `request.body` | "The question" and "Description" text | `packages/contracts/src/events.ts:213 QuestionAsked.text`; `display.preview` holds the first 512 bytes (`packages/engine/src/client/reads/display.ts:30`) | supplied | The full text needs `client.event` by `sourceSequence` (`packages/contracts/src/client/commands.ts:46`), as the website does (`packages/web/src/data/requestSources.ts:39`) |
| `request.recommendation`, `request.recShort` | The sparkles line "Recommended" and the short recommendation | `packages/contracts/src/questions.ts:15 recommendation` | supplied with a different shape | Engine has one recommendation string; mock has a long and a short one |
| `request.brief`, `request.summary` | The brief heading and the one-line summary on the card | none | missing | No brief or summary field; only `title` and `text` |
| `request.what`, `request.whyText`, `request.why`, `request.recWhy` | "What it is about", "Why it matters", "Why this answer" | none | missing | No structured report fields on a question or permission |
| `request.refs` | Numbered references list | none | missing | No reference list; `ContextReference` exists only for prompts (`packages/contracts/src/project/context.ts:9`) |
| `request.options` (question) | Accept, other answers with a `note` each, Choose buttons | `packages/contracts/src/questions.ts:16 proposedAnswer` | supplied with a different shape | A question has one proposed answer and a free-text answer; no option list and no option notes |
| `request.options` (approval) with `primary` | Allow, Always allow, Deny, Always deny | `packages/contracts/src/events.ts:76 PermissionOption` (`id`, `name`, `kind`, `level`, `persistent`), first 8 in `RequestDisplay.options` (`packages/contracts/src/requests.ts:9`) | supplied with a different shape | Options come from the harness with its own ids and `kind` values (`allow_once`, `allow_always`, `reject_once`, `reject_always`); mock hard-codes `allow`, `always`, `deny`, `never` and a `primary` flag |
| `request.command` | The command in a code block | `packages/contracts/src/events.ts:36 PermissionRequested.toolInput` (unknown shape) | supplied with a different shape | Only through `client.event`; the website reads `toolInput.command` when present (`packages/web/src/requests/RequestList.tsx:26`) |
| `request.blind` | "Hidden by the harness" in place of the command | `packages/contracts/src/requests.ts:8 RequestDisplay.inputAvailable`, `inputRedacted` | supplied with a different shape | Two booleans in place of one |
| `request.folder` | The folder the command runs in | `packages/contracts/src/events.ts:37 PermissionRequested.locations`; `packages/contracts/src/client/reads.ts:38 RosterEntry.folder` | supplied with a different shape | Engine has file locations and the agent's folder, not a per-request folder |
| `request.tool` | "Tool Bash" | `packages/contracts/src/requests.ts:10 RequestDisplay.toolKind` | supplied with a different shape | Engine gives a tool kind such as `execute` or `read`, not the tool's name |
| `request.createdAt` | Waiting column, age on the card | `packages/contracts/src/requests.ts:23 ClientRequest.openedAt` | supplied | |
| `request.answer`, `request.answeredAt` | Answer and time on answered rows | `packages/contracts/src/requests.ts:25 answeredAt`, `:27 answer`, `:28 optionId` | supplied with a different shape | A permission answer is an `optionId`; its label is read from the source event's options (`packages/web/src/requests/RequestList.tsx:82`) |
| `request.agent` → `agent.name`, `agent.role` | Agent column, role icon, "Asked by" | `packages/contracts/src/requests.ts:15 agentId`; `packages/contracts/src/client/reads.ts:30 RosterEntry.name`, `role` | supplied | |
| `agent.team` → `team.area` | Team area after the agent's name | `packages/contracts/src/client/reads.ts:30 RosterEntry.groups` matched to `packages/contracts/src/project/schema.ts:68 Team.group`; `Team.area` at `:67` | supplied with a different shape | Engine links agent to team through a group name, not a team field; the website does the same match (`packages/web/src/pages/AddTask.tsx:46`) |
| `request.project` → `project.name`, `repo.name` | Project and Repository columns and filters | `packages/contracts/src/questions.ts:7 projectId` filled from the agent's project (`packages/engine/src/client/reads/requests.ts:39`); `packages/contracts/src/project/schema.ts:49 Project.name`, `:38 Repository.name` | supplied | |
| `request.task` → `sprint.phase`, else `project.stage` | Stage column | `packages/contracts/src/questions.ts:8 taskId`, `:9 sprintId`; `packages/contracts/src/project/schema.ts:73 Sprint.phase`; `:51 Project.stage` | supplied with a different shape | Sprint phase has seven values including Define and Verify; project stage is five lower-case values; mock mixes both into five capitalised stages |
| `request.blocks` | "Blocks AC-17" | `packages/contracts/src/questions.ts:8 taskId` → `packages/contracts/src/project/schema.ts:87 Task.label` | supplied with a different shape | Engine gives a task id; the label is optional |
| `request.files` | Files named by a question | none | missing | |
| Merge: `request.source`, `request.target` | Branch arrow, "Into main" cell | `packages/contracts/src/project/git.ts:41 GitMainReview.branch`, `base` | supplied with a different shape | Only after the owner calls `project.review.prepare`; nothing opens a merge for the owner on its own |
| Merge: `request.evidence.tests`, `.review` (`ok`, `text`, `value`, `sub`, `agent`) | Tests and Review cells | `packages/contracts/src/project/git.ts:38 GitEvidenceSet` with slots of `GitEvidence` (`:31`: `status`, `summary`, `reportedBy`) | supplied with a different shape | Engine gives passed or failed with one summary and a missing, current or stale state; mock gives ok plus three display strings |
| Merge: `request.evidence.commits`, `.files` | "14 commits · 37 files" | `packages/contracts/src/project/git.ts:26 GitReview.commits`, `files` | supplied | Returned by `project.review.prepare` and `project.review` |
| Merge: `request.evidence.add`, `.del` | `+624 −587` | `packages/contracts/src/project/git.ts:14 GitDiff.additions`, `deletions` inside `GitReview.diff` | supplied | |
| Merge: `request.evidence.conflicts` | "No conflicts" | none before an attempt; `packages/contracts/src/project/events.ts:10 project.GitFinished refusal "conflicts"` after one | missing | No conflict count is read ahead of a merge |
| Merge: `request.notice` | "Users will notice:" line | none | missing | |
| Merge: `request.brief`, `request.body` | The merge brief | none | missing | |
| Merge review dialog: file list with per-file `+`/`−` | "37 files changed" table | `packages/contracts/src/project/git.ts:16 GitCommitFile` (path, status) | supplied with a different shape | No per-file line counts; `project.diff` with a `path` gives them one file at a time (`packages/contracts/src/project/git.ts:68`) |
| Merge review dialog: pull request title and description | Editable title and body, 72-character limit | none | missing | `project.review.approve` takes no title or body |
| Failed start: `agent.failure.reason`, `.machine`, `.subscription` | Failed start row and its "Sign in on Buildbox" button | `packages/contracts/src/client/reads.ts:32 RosterEntry.startFailure` (codes at `packages/contracts/src/startFailure.ts:3`); `RosterEntry.account` at `reads.ts:35` | supplied with a different shape | Engine gives a reason code and an account, not a machine or a fix hint |
| `s.phoneOffer`, `s.settings.ntfyServer` | "Notifications are off" offer | `packages/contracts/src/client/alerts.ts:67 AlertSettings.pushPromptDismissed`, `carrier` (`:40`), read by `client.alerts.settings` | supplied | |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Answer a question with the recommendation (Accept, Accept recommendation) | `act.answerRequest(id, rec.id)`, reports `answer` `{kind:'question', id, text}` (`actions.js:155`) | `packages/contracts/src/commands.ts:76 answer` | supplied with a different shape | Mock sends the option's label as text; engine has `proposedAnswer` text, not options |
| Answer a question with another listed option (Choose) | `act.answerRequest(id, o.id)`, reports `answer` | `packages/contracts/src/commands.ts:76 answer` | supplied with a different shape | Same: the engine takes text only |
| Answer a question in your own words, in place | `act.answerRequest(id, null, text)`, reports `answer` | `packages/contracts/src/commands.ts:79 answer kind "question" text` | supplied | |
| Allow or deny an approval | `act.answerRequest(id, 'allow' or 'deny')`, reports `answer` `{kind:'permission', id, optionId}` | `packages/contracts/src/commands.ts:78 answer kind "permission" optionId` | supplied with a different shape | Option ids come from the harness, not fixed words |
| Always allow or always deny | `act.answerRequest(id, 'always' or 'never')`, reports `answer` | `packages/contracts/src/commands.ts:78`; `packages/contracts/src/permission.ts:12 permissionForOptionKind` | supplied with a different shape | Works only when the harness offers an `allow_always` or `reject_always` option; the mock's "in this project only" rule is LGTM Studio's own standing rule, which is unbuilt |
| Allow a blind approval without seeing input | `act.answerRequest(id, 'allow')` | `packages/contracts/src/commands.ts:78` | supplied | |
| Review and merge: Approve and merge, or Approve without evidence | `MergeReview` → `act.answerRequest(id, 'merge')`, reports `integrate` `{requestId, source, target}` (`actions.js:156`) | `packages/contracts/src/project/git.ts:86 project.review.prepare`, then `:90 project.review.approve` with `decision` `approve` or `approve_without_evidence` (`:40`) | supplied with a different shape | Mock reports the wrong call: `project.integrate` merges a team worktree into a destination (`git.ts:82`). The engine needs a prepare call first, and approve takes `expectedHead`, `expectedBaseHead` and `confirmed: true` |
| Generate the pull request title and description | `act.pullRequestText`, local only | none | missing | No request writes or stores pull request text |
| Send back a merge with a reason | `act.answerRequest(id, 'decline', reason)`, reports `review.report` (`actions.js:156`) | none | missing | `project.review.report` records test or review evidence (`packages/engine/src/project/gitReview.ts:49`); no request declines a main review or sends a reason to the project lead, other than `prompt` to the lead |
| Resume a failed start | `act.answerRequest(id, 'resume')`, reports `resume` `{agentId}` | `packages/contracts/src/commands.ts:101 resume` | supplied | |
| Sign in for a failed start | `act.openDialog({type:'signin'})`, then `answerRequest(…,'resume')` | none for the sign-in; `resume` for the restart | missing | The engine runs no sign-in program; see the Subscriptions section |
| Decline the phone offer ("Not now") | `act.declinePhoneOffer`, no report | `packages/contracts/src/client/commands.ts:66 client.alerts.prompt.dismiss` | supplied | The website already calls it (`packages/web/src/admin/notification-prompt.tsx:31`) |
| Open thread | link to `/p/<project>/chat/<agent>` | none needed | supplied | Navigation only |

Notes:

- View state on this screen: the open row, the search text, the sort column and direction, the Type, Repository and Project filters, and "Show answered".
- An answered request's answer text is cut to 512 bytes in `client.requests` (`packages/engine/src/client/reads/requests.ts:62`).
- A permission request gets its project and task links from the agent at the moment it is raised (`packages/engine/src/routing/permissions.ts:26`).
- `client.requests` refuses every caller except the owner (`packages/engine/src/client/reads/requests.ts:12`).
- The mock's merge side effects, which move every sprint of the project to Done and mark the project merged (`actions.js:171`), have no engine counterpart. `project.MainReviewDecided` records the outcome (`packages/contracts/src/project/events.ts:15`).
- Updates arrive on `client.subscribe` as `PermissionRequested`, `PermissionAnswered`, `QuestionAsked` and `QuestionAnswered` (`packages/contracts/src/events.ts:193`, `:203`, `:213`, `:214`).

### All projects

`design/mock/js/screens/home.js` `AllProjects` renders a search box, a status filter and `ProjectTable` (`home.js:134`). The repository page reuses `ProjectTable` without the Repository column.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `project.name` | Project column | `packages/contracts/src/project/schema.ts:49 Project.name` | supplied | |
| `project.repo` → `repo.name` | Repository column | `packages/contracts/src/project/schema.ts:49 Project.repoId`, `:38 Repository.name` | supplied | |
| `project.stage` | Stage dots | `packages/contracts/src/project/schema.ts:51 Project.stage`; labels from `packages/contracts/src/project/mocks.ts:84 stageLabel` | supplied with a different shape | Engine values are lower case and optional; the website shows "Not started" when absent (`packages/web/src/pages/HomePage.tsx:33`) |
| `projectStatus(s, p)`: "Needs you · n", Building, Idle, Archived | Status column and "Needs you" filter | `packages/contracts/src/requests.ts:19 ClientRequest.projectId`; `packages/contracts/src/project/commands.ts:31 ProjectAgentSummary.status`; `packages/contracts/src/client/reads.ts:33 RosterEntry.state` | supplied with a different shape | Engine gives per-agent statuses Needs you, Reviewing, Working and Ready; mock words such as Building come from the stage |
| `lead.activity` | Project lead column: what the lead is doing | `packages/contracts/src/client/reads.ts:33 RosterEntry.displayedState` | supplied with a different shape | Engine gives a state word such as "Waiting on an answer", not a free-text activity line |
| `agent.state === 'working'` count, and agent count | "3 of 9" agents | `packages/contracts/src/project/commands.ts:31 ProjectAgentSummary` for membership; `packages/contracts/src/client/reads.ts:33 RosterEntry.state` | supplied | |
| `project.machine` → `machine.name` | Machine column | `packages/contracts/src/project/schema.ts:50 Project.machineId` | supplied with a different shape | Engine gives a machine id; no machine name record was found in the project contracts |
| `project.branch` | Branch column | `packages/contracts/src/project/schema.ts:50 Project.worktreeId` → `:42 Workspace.branch` | supplied | The website does the same lookup (`packages/web/src/pages/HomePage.tsx:27`) |
| `project.archived` | Archived rows, the Restore button | `packages/contracts/src/project/schema.ts:51 Project.archivedAt`, `archiving` | supplied with a different shape | Engine also has an in-progress `archiving` state |
| `project.goal` | Used by the search box | `packages/contracts/src/project/schema.ts:49 Project.goal` | supplied | |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Restore an archived project | `act.archiveProject(id, false)`, reports `restore` | `packages/contracts/src/project/commands.ts:57 project.restore` | supplied | Mock's tag lacks the `project.` prefix; the handler refuses while `archiving` is set (`packages/engine/src/project/commands.ts:298`) |
| New project | `act.openDialog({type:'new-project'})`, then `act.createProject`, reports `create` `{repositoryId, goal, machineId, subscriptionId, newRepository}` | `packages/contracts/src/project/commands.ts:49 project.create` (payload at `:20`) | supplied with a different shape | Engine requires a `name` up front and takes `repository` as `existing` or `new`; it has no `subscriptionId`, because the lead's account comes from `ProjectSettings.lead` (`packages/contracts/src/project/schema.ts:36`). The dialog itself is not on this screen |
| Open a project | link to `/p/<id>/board` | none needed | supplied | Navigation only |

Notes:

- View state on this screen: the search text and the All, Needs you and Archived filter.
- The mock names a new project from its goal after creation (`actions.js:228`); the engine's create needs the name in the request.

### Project board

`design/mock/js/screens/project.js` `Board` renders a view bar, an Epic filter and `StatusLine`, then one of `BoardView` (columns of `SprintCard`), `TableView` or `RoadmapView`. An archived project shows a Restore button in place of the board.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `sprint.label`, `sprint.name` | Tag and title on cards, rows and roadmap bars | `packages/contracts/src/project/schema.ts:72 Sprint.label`, `name` | supplied | |
| `sprint.goal` | Hover TL;DR and the filter text | `packages/contracts/src/project/schema.ts:72 Sprint.goal` | supplied | |
| `sprint.column` (Backlog, Planned, In progress, Review, Done) | The five board lanes, Status column, bar colour | `packages/contracts/src/project/status.ts:3 sprintStatus` from `Sprint.completion` and task states | supplied with a different shape | Engine derives four states, done, active, review and planned; there is no Backlog; the website uses four columns (`packages/web/src/pages/ProjectPage.tsx:49`) |
| `sprint.phase` | Stage word on cards, Stage column | `packages/contracts/src/project/schema.ts:73 Sprint.phase` (values at `:30`) | supplied with a different shape | Engine has seven phases including Define and Verify; mock uses the five stage words |
| `sprint.priority` | Priority icon and column, lane order | none | missing | |
| `sprint.epic`, `epic.name` | Epic chip, Epic filter, Epic column, roadmap groups | none | missing | No epic record |
| `sprint.start`, `sprint.end` | Roadmap bar position and length | none | missing | No sprint dates; `Sprint.completedAt` is the only time (`packages/contracts/src/project/schema.ts:74`) |
| `sprint.team` → `team.area`, team name | Team on cards and in the Team column, "No team" | `packages/contracts/src/project/schema.ts:73 Sprint.owner`; `:88 Task.teamId` | supplied with a different shape | A sprint has an owning agent, not a team; teams are found through the sprint's tasks, as the website does (`packages/web/src/pages/SprintPage.tsx:28`) |
| `tasksOfSprint` → done and total | "2/4" and "2 of 4" | `packages/contracts/src/project/schema.ts:88 Task.sprintId`, `state` | supplied | |
| `requestsOfSprint` (count and kinds) | "Needs your answer", bell, warn and error tones | `packages/contracts/src/questions.ts:8 taskId`, `:9 sprintId` on `ClientRequest` | supplied with a different shape | No failed-start kind, so the error tone needs `RosterEntry.startFailure` of a task owner |
| `project.goal` | Roadmap's first row | `packages/contracts/src/project/schema.ts:49 Project.goal` | supplied | |
| `project.phase` (eight build loop phases) | `StatusLine`: "Build · Phase 4 of 8" | `packages/contracts/src/project/schema.ts:51 Project.stage` | supplied with a different shape | Engine has five stages, not the eight phases |
| `project.archived` | Archived empty state | `packages/contracts/src/project/schema.ts:51 Project.archivedAt` | supplied | |
| `sprint.done` styling, `sprint.dependsOn` | Not shown on the board itself | `packages/contracts/src/project/schema.ts:73 Sprint.needs` | supplied | Used on the sprint page |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Restore an archived project | `act.archiveProject(id, false)`, reports `restore` | `packages/contracts/src/project/commands.ts:57 project.restore` | supplied | Tag prefix differs |
| Open a sprint | link to `/p/<project>/sprint/<id>` | none needed | supplied | Navigation only |

Notes:

- View state on this screen: Board, Table or Roadmap view, the filter text, the Epic filter, the sort in Table view, the lane picked on a phone, the hover tip and focus mode.
- The mock board has no action that creates, moves, reorders, edits, prioritises or dates a sprint. The engine has `project.sprint.create` and `project.sprint.update` (`packages/contracts/src/project/commands.ts:67`, `:68`), and the update can change name, goal, phase, owner and dependencies, but nothing on this screen calls them.
- `project.sprint.create` and `project.sprint.update` accept the owner as a caller (`packages/contracts/src/project/commands.ts:87`). The handler refuses an owner agent that is not a project member and refuses dependency cycles (`packages/engine/src/project/commands.ts:195`, `:209`). It refuses any change to a completed sprint (`:208`).
- Sprint and task changes arrive on `client.subscribe` as `project.SprintAdded`, `project.SprintChanged`, `project.SprintCompleted`, `project.TaskAdded` and `project.TaskChanged` (`packages/contracts/src/project/events.ts:35`, `:36`, `:39`, `:40`, `:42`).

### Sprint page

`design/mock/js/screens/project.js` `SprintPage` renders a header with the sprint's facts and open requests (as `RequestBlock` cards), then `PlanPane` and the task list from `TaskRows` side by side.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `sprint.label`, `sprint.name`, `sprint.goal` | Tag, title, TL;DR | `packages/contracts/src/project/schema.ts:72 Sprint.label`, `name`, `goal` | supplied | |
| `sprint.fix` | "Fix sprint" badge | none | missing | |
| `sprint.evidence` (`tests`, `review`, `merged`) | Three check lines | `packages/contracts/src/project/schema.ts:74 Sprint.evidence`, `completion`, `completedAt` | supplied with a different shape | Engine has one evidence text and one completion line, set only when the sprint completes |
| `sprint.column` | Status | `packages/contracts/src/project/status.ts:3 sprintStatus` | supplied with a different shape | Four derived states, no Backlog |
| `sprint.phase` | Phase | `packages/contracts/src/project/schema.ts:73 Sprint.phase` | supplied with a different shape | Seven phases |
| `sprint.priority` | Priority | none | missing | |
| `sprint.epic` | Epic | none | missing | |
| `sprint.team` | Team link, "Not staffed" | `packages/contracts/src/project/schema.ts:88 Task.teamId` of the sprint's tasks; `:66 Team.name` | supplied with a different shape | Derived from tasks; `Sprint.owner` is an agent (`:73`) |
| `sprint.dependsOn` → label, done | "Depends on SP-01 (done)" | `packages/contracts/src/project/schema.ts:73 Sprint.needs`, `:74 completion` | supplied | |
| progress | "2 of 4 done" | `packages/contracts/src/project/schema.ts:88 Task.state` | supplied | |
| `requestsOfSprint` | Request cards in the header | `packages/contracts/src/questions.ts:8 taskId`, `:9 sprintId` on `ClientRequest` | supplied | The website filters by `sprintId` (`packages/web/src/pages/projectData.ts:62`); fields are as on Home |
| `sprint.plan` (`file`, `src`, `state`, `by`) | Plan file name, Draft badge, "Written by", the plan page in a frame | none | missing | No plan record and no request that reads a plan file |
| `task.label`, `task.title` | Task rows | `packages/contracts/src/project/schema.ts:87 Task.label`, `title` | supplied with a different shape | Label is optional |
| `task.state`, `task.blockedBy` | State badge, "Blocked by an approval" | `packages/contracts/src/project/schema.ts:88 Task.state` (values at `:31`); blocked is projected from open linked requests (`packages/engine/src/project/decisions.ts:44`) | supplied with a different shape | Same five states; the blocking kind comes from the linked request's kind, and there is no failed-start kind |
| `task.owner` → `agent.name` | Owner, "Unassigned" | `packages/contracts/src/project/schema.ts:87 Task.owner` | supplied with a different shape | Engine requires an owner; there is no unassigned task |
| `task.section`, `task.sectionName` | "Part of the plan" link that scrolls the plan | none | missing | |
| `task.points` | Points | none | missing | |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Add a task by title | inline `update()` in `SprintPage` (`project.js:227`), no engine call reported | `packages/contracts/src/project/commands.ts:72 project.task.create` | supplied with a different shape | Engine requires `owner`, `teamId`, `worktreeId` and `state` as well as the title (`packages/contracts/src/project/schema.ts:86`), and refuses a completed sprint (`packages/engine/src/project/commands.ts:230`). An owner-created task tells the project lead, like the mock's toast (`packages/engine/src/project/commands.ts:239`). The website sends the full payload (`packages/web/src/pages/AddTask.tsx:58`) |
| Answer the sprint's requests in place | as on Home | as on Home | as on Home | |
| Open a request's thread | `act.openSidePanel(agent, id)` | none needed | supplied | View state |
| Open a task | link to `/p/<project>/task/<id>` | none needed | supplied | Navigation only |

Notes:

- View state on this screen: which panes show, the add-task form, and the scroll to a plan section.
- The mock does not report the add-task call to `engine.js`. It is the only owner change on these five screens with no report.

### Task page, team page and repository page

`design/mock/js/screens/project.js` `TaskPage`, `TeamPage` (with `TaskTable`) and `RepoPage` render these three pages. `RepoPage` reuses `ProjectTable` from the All projects screen.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Task: `task.title`, `task.label`, `task.state` | Title, tag, state badge | `packages/contracts/src/project/schema.ts:87 Task.title`, `label`; `:88 state` | supplied | |
| Task: `task.points` | "3 points" | none | missing | |
| Task: `task.sprint` → `sprint.label`, `sprint.name` | Back link | `packages/contracts/src/project/schema.ts:88 Task.sprintId` | supplied | |
| Task: `task.owner` → agent with team | Owner line, "Talk to Builder 1" | `packages/contracts/src/project/schema.ts:87 Task.owner`; `packages/contracts/src/client/reads.ts:30 RosterEntry` | supplied with a different shape | Owner is required in the engine |
| Task: `task.team` → team name | Team link | `packages/contracts/src/project/schema.ts:88 Task.teamId`, `:66 Team.name` | supplied | |
| Task: `team.branch` or `project.branch` | Worktree | `packages/contracts/src/project/schema.ts:88 Task.worktreeId` → `:42 Workspace.branch`, `path` | supplied | The website shows both (`packages/web/src/pages/TaskPage.tsx:88`) |
| Task: `agent.activity` | "Doing now" | `packages/contracts/src/client/reads.ts:33 RosterEntry.displayedState` | supplied with a different shape | State word only, no activity text |
| Task: `requestsOfTask` | Request cards | `packages/contracts/src/questions.ts:8 taskId` on `ClientRequest` | supplied | |
| Task: `task.files` | Changed files list | `packages/contracts/src/project/git.ts:67 project.changes` for the task's worktree | supplied with a different shape | Changes are per worktree, not per task |
| Task: `task.history` (`ts`, `who`, `text`) | "Work and handoff" timeline | `packages/contracts/src/project/commands.ts:75 project.task.history` returning `TaskHistoryEntry` (`packages/contracts/src/project/schema.ts:91`: `at`, `title`, `detail`, `state`); `:82 TaskStory` | supplied with a different shape | No `who` on an entry; entries have a title and detail |
| Team: `team.stage`, `team.area`, name | Page title | `packages/contracts/src/project/schema.ts:66 Team.name`, `:67 stage`, `area` | supplied | `project.team.create` builds the same "Stage · Area" name (`packages/engine/src/project/commands.ts:171`) |
| Team: `team.branch` | Branch under the title | `packages/contracts/src/project/schema.ts:66 Team.worktreeId` → `:42 Workspace.branch` | supplied | |
| Team: channel for the team | "Team channel" button | `packages/contracts/src/project/schema.ts:68 Team.channelId` | supplied | |
| Team: agents of the team | Agents table rows | `packages/contracts/src/client/reads.ts:30 RosterEntry.groups` matched to `Team.group` (`packages/contracts/src/project/schema.ts:68`) | supplied with a different shape | Membership by group name |
| Team: `agentStatus` word and tone, `agent.stalled` ("May be stuck") | Status column | `packages/contracts/src/client/reads.ts:33 RosterEntry.state`, `displayedState`, `:32 startFailure`; stall state from `roles.StallSeen` and `roles.StallEnded` (`packages/contracts/src/roles/events.ts:38`, `:51`) | supplied with a different shape | Engine lifecycle states differ from the mock's (`packages/contracts/src/stateMachine.ts:10`); a stall is a pair of events, not a flag, as the Agents section says |
| Team: `agent.activity` | Doing now | `packages/contracts/src/client/reads.ts:33 displayedState` | supplied with a different shape | No activity text |
| Team: `agent.task` | Task column | `packages/contracts/src/project/schema.ts:87 Task.owner` read in reverse | supplied with a different shape | Engine links task to agent, not agent to task; an agent can own several |
| Team: `agent.harness`, `agent.model`, `agent.effort` | "Claude Code · Sonnet 5.5 · Medium" | `packages/contracts/src/client/reads.ts:35 RosterEntry.harness`, `:36 model`, `effort` | supplied with a different shape | Engine gives ids; display names need `client.agent.configuration` labels or the `harnesses` list |
| Team: `agent.context` | Context percent | `packages/contracts/src/client/commands.ts:29 client.agent.context` returning `ContextUsage.percent` (`packages/contracts/src/agentConfiguration.ts:23`) | supplied with a different shape | One read per agent, and it can be unavailable |
| Team: tasks of the team | Tasks table with Sprint column | `packages/contracts/src/project/schema.ts:88 Task.teamId`, `sprintId` | supplied | |
| Repository: `repo.name` | Page context | `packages/contracts/src/project/schema.ts:38 Repository.name` | supplied | |
| Repository: `repo.remote` | Remote | none | missing | |
| Repository: `repo.main` | Base branch | none | missing | `project.branches` lists branches with a `current` flag (`packages/contracts/src/project/git.ts:11`), which is not a declared base |
| Repository: `repo.folders` (per machine) | Folders | `packages/contracts/src/project/schema.ts:38 Repository.path`; `:40 RepositoryLocation` only through `project.RepositoryLocated` events (`packages/contracts/src/project/events.ts:20`) | supplied with a different shape | The snapshot and `project.repositories` give one path; per-machine locations are not in any read |
| Repository: `repo.description`, `repo.describedAt`, `repo.describedBy` | "Product" description and "Updated 2 hours ago by the project lead of …" | none | missing | No running description field on a repository |
| Repository: projects of the repository | Projects table and count | `packages/contracts/src/project/schema.ts:49 Project.repoId` | supplied | The website filters the same way (`packages/web/src/pages/RepositoryPage.tsx:20`) |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Answer a task's requests in place | as on Home | as on Home | as on Home | |
| Talk to the task owner, open the team channel, open Git | links | none needed | supplied | Navigation only |
| New project in this repository | `act.openDialog({type:'new-project', repo})` | `packages/contracts/src/project/commands.ts:49 project.create` | supplied with a different shape | As on All projects |
| Restore an archived project in the table | `act.archiveProject(id, false)`, reports `restore` | `packages/contracts/src/project/commands.ts:57 project.restore` | supplied | Tag prefix differs |

Notes:

- View state on these pages: none beyond links.
- `project.task.update` and `project.task.note` refuse a caller who is neither a lead of the project nor the task's owner (`packages/engine/src/project/commands.ts:248`). The owner counts as a lead (`packages/engine/src/project/access.ts:7`), so the owner may call both. The mock has no task edit action, so this does not block these screens today.
- The mock team record has `needToKnow`, which these pages do not show.

### What the engine has for the build loop, in short

The engine has no record of the build loop's phases, review rounds, findings, test runs, end-result statements or loop settings.
A search of `packages/contracts/src/` for "round", "finding", "statement", "nightly", "full run", "stuck" and "build loop" returns nothing.
The engine never reads `.lgtm/config`; the only `.lgtm` references in `packages/engine/src/` are agent read denials (`packages/engine/src/runner/denyRead.ts:11`, `packages/engine/src/identity/ceiling.ts:320`).

Two Git records supply small parts of the Workflow screens:

- **Git evidence** (`packages/contracts/src/project/git.ts:31` `GitEvidence`) is one reported "passed" or "failed" result of kind `tests` or `review`, for one commit (`head`) of one worktree, with a summary, the reporter and a time. The contract says reports "are never approval credentials or engine-executed test proof" (`git.ts:27-28`). The latest report for a worktree comes back from `project.review.status` (`git.ts:88`) as a slot that is `missing`, `current` or `stale` (`git.ts:37`, computed at `packages/engine/src/project/gitReview.ts:35-40`). Every report is also an event, `project.GitEvidenceReported` (`packages/contracts/src/project/events.ts:13`).
- **The main review** (`git.ts:41` `GitMainReview`) is the owner's local merge of a project worktree into its base. It holds branch, base, both heads, the evidence set, `outcome` (`open`, `merged`, `refused`), `openedAt` and `decidedAt`. It is opened by `project.review.prepare` (`git.ts:86`), decided by `project.review.approve` (`git.ts:90`), and streamed as `project.MainReviewOpened` and `project.MainReviewDecided` (`events.ts:14-15`). It is not a hosted pull request: it has no number and no title.

Nothing in the roles piece supplies any Workflow field:

- The roles events (`packages/contracts/src/roles/events.ts:36-52`) report stalled agents (`StallSeen`), replacement advice (`ReplaceAdvised`), runaway turns (`RunawayReported`), idle teams (`TeamIdleReported`) and crash retries. They are about agents, and they are owner-only (`packages/contracts/src/roles/visibility.ts:4`).
- The mock's "stuck statement" is a review-scoring state of an end-result statement. It is not a stalled agent, so `StallSeen` and `roles.actions.list` (`roles/commands.ts:31`) do not supply it.
- The Workflow Agents section groups agents by "waiting", "working" and "idle". It does not show stall or runaway reports. Those reports reach the owner as alerts (`roles/alerts.ts:4-8`), which belong to the alerts screens.
- `RolesSettings` (`roles/schema.ts:37`) holds `stallWatch`, `standingRules` and agent time and retry limits (`RoleLimits`, `roles/schema.ts:18-28`). None of them is a Workflow setting: the mock's settings are test commands, review round limits, stuck points, nightly runs and fix-sprint merging.
- The role kinds are `orchestrator`, `lead` and `worker` (`roles/role.ts:1`). The mock's "Run by" lists, such as "Planning lead" or "Test runner", are fixed text in the mock and do not come from the role file.

### Workflow, the build loop's phases

`design/mock/js/screens/workflow.js` renders this view through `WorkflowTab` (line 580), which shows `Overview` (line 306) with `StuckCard` (line 255) and `Agents` (line 294).
The sample data comes from `seedWorkflow` (line 34) and `data.js` (`PHASES` at line 11, projects at lines 72-77, sprints at lines 123-139, the stuck question `q-stuck` at line 192).

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `project.phase`, `PHASES` | "Phase 4 of 8 · Build", the eight-step rail, the selected phase card | `packages/contracts/src/project/schema.ts:51 Project.stage`, values at `schema.ts:29` | supplied with a different shape | engine has five project stages (design, plan, build, review, handover); mock has eight phases, adding Define, Verify and Keep running and splitting Design and teams |
| Phase start and end times (from `project.createdAt` in `phaseTimes`) | "took 2 days", "Started 3 hr ago" on the rail and the card | `packages/contracts/src/events.ts:267 EventEnvelope.occurredAt` on `project.Created` (`project/events.ts:22`) and `project.StageChanged` (`project/events.ts:33`) | missing | `Project` has no creation time; stage-change times exist only in the event log, and phases are not stages; the mock invents times from weights |
| `INFO[phase].what`, `.ran`, `.yours`, `.ends` | "What happens", "Run by", "Your part", "Ends" | none | missing | fixed text of the default build loop, held only in the mock |
| `project.archived` | "Archived" badge | `schema.ts:51 Project.archivedAt` | supplied | |
| `sprint.column` per sprint of the project | "2 of 9 sprints done · 3 under way" | `schema.ts:74 Sprint.completion` and tasks, combined by `packages/contracts/src/project/status.ts:3 sprintStatus` | supplied with a different shape | engine gives done, active, review, planned; mock counts board columns Done, In progress, Review |
| Open requests of the project (`openRequests`) | "3 requests waiting" link to Home | `packages/contracts/src/project/commands.ts:64 project.requests` (`ClientRequest.status`, `requests.ts:22`) | supplied with a different shape | engine requests are `permission` or `question` (`requests.ts:21`); mock also counts `merge` and `failed` kinds |
| `workflow.result.statements.length` | "End-result page · 14 numbered statements" in Produced | none | missing | no end-result record |
| `project.tests`, `project.agentReview` | ".lgtm config file · Tests on, agent review on" | none | missing | engine has no loop settings |
| `project.hasMocks` | Mocks item in Define, and "Design lead, Designer" in Run by | `packages/contracts/src/project/mocks.ts:66 project.mocks.read`, latest revision's `bundle.screens` | supplied with a different shape | derived from mock history, as the current page does at `packages/web/src/shell/Shell.tsx:238`; no flag on the project |
| `workflow.runs.length` | "Full-run report… Kept with the test runs" | `project/events.ts:13 project.GitEvidenceReported` with `kind: "tests"` | supplied with a different shape | reported results only; no run records (see Test runs) |
| Sprints and teams of the project (`sprintsOf`, `teamsOf`, `teamName`) | "9 sprints", "4 teams · Shell, Threads, …" | `schema.ts:71 Sprint`, `schema.ts:65-66 Team.name` in `ProjectSnapshot` (`commands.ts:32`) | supplied | |
| `workflow.result.pr.number` | "Pull request to the base branch · #212" | `git.ts:41 GitMainReview` | supplied with a different shape | main review has no number; it is a local merge record |
| `workflow.stuck` (`statement`, `text`, `points`, `of`, `round`, `rounds`, `review`) | Stuck statement card: quoted statement, "14 of 31 points in round 3", "a major or blocker in each of 3 rounds" | none | missing | no statements, scores or rounds; roles `StallSeen` is about agents, not statements |
| `workflow.settings.stuckPoints` | "the limit is 12 points and 30%" | none | missing | |
| Stuck request: `request.status`, `request.createdAt`, `request.answer`, `request.answeredAt` | "Waiting 34 min", or the answer and its time | `packages/contracts/src/requests.ts:19 ClientRequest` (`status` :22, `openedAt` :23, `answeredAt` :25, `answer` :27) | supplied | |
| Stuck request: `request.recommendation` | "Planning lead recommends: …" | `packages/contracts/src/questions.ts:15 recommendation` | supplied | |
| Stuck request: `request.agent` and its name and avatar | Foot of the card | `requests.ts:15 IdentityRow.agentId`, `packages/contracts/src/client/reads.ts:30 RosterEntry.name`, `.role` | supplied | |
| Project agents (`agent.project`) | Waiting, Working and Idle groups | `commands.ts:31 ProjectAgentSummary.projectId`, or `reads.ts:30 RosterEntry.groups` with `schema.ts:98 projectTeamGroup` | supplied | |
| `agent.state` (waiting, failed, working, idle, stopped) | Which group an agent is in | `reads.ts:33 RosterEntry.displayedState`, values at `packages/contracts/src/stateMachine.ts:26` | supplied with a different shape | engine has ten displayed states, such as "Waiting on a permission" and "Crashed"; mock has five |
| `agent.activity` | One line beside each agent, such as "Editing Sidebar.tsx" | `events.ts:185 ThreadItem` (tool calls and file changes); `schema.ts:45 Workspace.activity` per worktree | supplied with a different shape | no one-line activity field on an agent; it must be derived from thread items |
| Agent label with team (`agentLabel`) | "Builder 1 · Shell" | `reads.ts:30 RosterEntry.name`, `.groups`; `schema.ts:66 Team.name` | supplied | |
| `workflow.fixes` (`label`, `name`, `why`, `auto`, `state`), `sprint.fix`, `sprint.auto` | Fix sprints table | `schema.ts:71 Sprint` (label, name, goal) | missing | `Sprint` has no fix marker, reason, or "merges on its own" flag; only the label and name exist |
| `workflow.settings.autoMergeFix` | "On its own" or "Needs your approval" in the Merge column | none | missing | |
| Tab marks: open stuck request; latest full run failed | Warning dot on Review rounds; error dot on Test runs | none for the stuck review; `git.ts:37 GitEvidenceSlot` for a failed tests report | missing | no stuck review record; a failed tests report is not a "full run" |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Settle a stuck statement: Change it, Keep it, Drop it | `StuckCard` `settle` → `act.answerRequest(id, option)` → `engine.call('answer', { kind: 'question', id, text })`, then a local change to the statement and the review state | `packages/contracts/src/commands.ts:76 answer` (question form) | supplied with a different shape | the answer is supplied; the engine has no statement or review record to change, and questions carry no option list, so the three choices are text |
| Open the asking agent's thread | `act.openSidePanel(agentId, requestId)`; no engine call | `packages/contracts/src/client/commands.ts:38 client.thread` | supplied | the panel itself is view state |
| Open an agent from the Agents list | Link to `routeForAgent`; no engine call | `client/commands.ts:38 client.thread` | supplied | |

Notes:

- The `answer` call is the only engine call these Workflow sections make.
- `StuckCard` draws its three buttons from fixed text, not from `request.options`.
- `project.stage.set` exists (`commands.ts:61`) for owner and agents, but this screen never sets a phase.
- View state, not an engine need: the selected phase on the rail.

### Review rounds

`workflow.js` renders this view with `Review` (line 363), at `#/p/rules/workflow/review`.
It also reuses `StuckCard` for the review that has a stuck statement.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `workflow.reviews` (`id`, `subject`, `kind`) | Review switcher, heading "SP-01 Rule storage and matching", "Plan review" | none | missing | engine has no review record by sprint; `GitEvidence` with `kind: "review"` (`git.ts:29-32`) is one pass or fail summary for one commit |
| `review.team` | "by the Planning team" link | `schema.ts:65 Team` | supplied with a different shape | team exists; nothing links a review to it |
| `review.state` (stuck, scoring, running, clean) | State badge | `git.ts:30 GitEvidenceStatus`, `git.ts:37 GitEvidenceSlot.state` | supplied with a different shape | engine has passed or failed, and missing, current or stale; no scoring, running or stuck states |
| `review.next` | Line under the rounds | none | missing | |
| `review.rounds` (`n`, `ts`) and `workflow.settings.maxRounds` | Round bars, "round 3 of 6", "Needs your approval" on rounds 5 and 6 | none | missing | no rounds |
| `round.findings` (`id`, `statement`, `sev`, `text`, `status`) | Stacked bar per round, findings table, points, Open and Fixed counts | none | missing | no findings, severities or points |
| `workflow.result.statements[n].text` | Statement number link and its title | none | missing | no end-result statements |
| `workflow.stuck` and the stuck request | Stuck card and "Stuck" badge on a finding | see the Workflow section | missing | |
| `project.agentReview` | "Agent review off" when there is no review | none | missing | |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Settle a stuck statement | `StuckCard` → `engine.call('answer', …)` | `commands.ts:76 answer` | supplied with a different shape | as in the Workflow section |

Notes:

- The engine accepts review reports from owner and agents through `project.review.report` (`git.ts:84`, access at `git.ts:105`), and only as a summary per commit.
- View state, not an engine need: the selected review, the selected round, and the All, Open and Fixed filter.

### Test runs

`workflow.js` renders this view with `Runs` (line 480) and `RunDetail` (line 444), at `#/p/console/workflow/runs`.
`jobsOf` (line 421) builds the jobs, steps and log lines from each run record in the browser.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `run.commit`, `run.ts`, `run.by` | Commit tag, "8 min ago", the agent who ran it | `git.ts:32 GitEvidence.head`, `git.ts:35 recordedAt`, `git.ts:34 reportedBy`; listed through `project/events.ts:13 project.GitEvidenceReported` | supplied with a different shape | reports are kept per worktree head and say who reported, not who ran; `project.review.status` returns only the latest per worktree |
| `run.failed`, `run.expected`, `run.running`, `run.skippedRun` (the run's tone) | Passed, Failed, Failed as expected, Running, Skipped | `git.ts:30 GitEvidenceStatus` | supplied with a different shape | engine has passed or failed only; no running, skipped, or expected-failure state |
| `run.why` | Run title, such as "Starting commit for SP-03" | `git.ts:32 GitEvidence.summary` | supplied with a different shape | one free summary text |
| `run.branch` | Branch name | `git.ts:31 GitEvidence.worktreeId` → `schema.ts:42 Workspace.branch` | supplied with a different shape | through the worktree, not on the report |
| `run.kind` (Check, Full run, Nightly) | Kind filter and its counts | none | missing | |
| `run.passed`, `run.failed`, `run.skipped` | "7,791 passed · 1 failed · 12 skipped" | none | missing | |
| `run.dur` | Duration | none | missing | |
| `run.failures` (`name`, `file`, `message`, `note`), `run.note` | Failure lines in the log | none | missing | |
| Jobs, steps, step durations and log lines (built by `jobsOf`) | Jobs list, steps, log | none | missing | the mock makes them up from the record |
| `workflow.settings.check`, `workflow.settings.fullRun` | The command at the top of the log | none | missing | |
| `project.tests` | "Tests are off", and the disabled button | none | missing | |
| `project.archived` | Disabled button | `schema.ts:51 Project.archivedAt` | supplied | |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Start full run | `Runs` `start`: pushes a running record, then after 3.2 seconds marks it passed and calls `act.toast('Full run passed')`; no engine call | none | missing | no request starts a test run; the only test record is a report written by `project.review.report` (`git.ts:84`) |

Notes:

- The comment above `Runs` says that the owner only watches here, and that nothing operates a builder or a test runner.
- View state, not an engine need: the kind filter, the selected run, the selected job, and the open step.

### End result

`workflow.js` renders this view with `Result` (line 509), at `#/p/apiref/workflow/result`.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `workflow.result.statements` (`text`, `state`, `note`) | Numbered statements with Holds, Being built, In review, Stuck, Dropped, Not started | none | missing | no end-result page record |
| Count of statements that hold | "6 of 6 statements hold", the progress bar, the Evidence line | none | missing | |
| `workflow.result.draft` | "Draft" badge | none | missing | |
| `project.phase` (handover or running) | Ready or Merged badge, and whether the What was built section shows | `schema.ts:51 Project.stage` | supplied with a different shape | engine has `handover` but no Keep running phase |
| `workflow.result.pr.title`, `.number` | "Generate the API reference … #212" | `git.ts:41 GitMainReview` | missing | main review has no title or number |
| `pr.source`, `pr.target` | "docs/api-reference into main" | `git.ts:42 GitMainReview.branch`, `.base` | supplied | |
| `pr.commits`, `pr.files` | "14 commits · 37 files" | `git.ts:26 GitReview.commits`, `.files` from `project.review.prepare` (`git.ts:86-87`) or `project.review` (`git.ts:83`) | supplied with a different shape | lists of up to 200 with a `truncated` flag, not counts |
| `pr.merged`, `pr.mergedAt`, `project.merged` | "Merged 19 days ago", "waiting for you" | `git.ts:44 GitMainReview.outcome`, `git.ts:45 decidedAt` | supplied | |
| `pr.requestId` → merge request status and answer | "Review and merge" button, or the answer badge | `git.ts:44 GitMainReview.outcome` | supplied with a different shape | engine has no merge request kind (`requests.ts:21`); the open main review takes its place |
| Sprints (`label`, `name`, `goal`) | What was built | `schema.ts:72 Sprint.label`, `.name`, `.goal` | supplied | |
| `project.goal` | What was built, when there are no sprints | `schema.ts:49 Project.goal` | supplied | |
| Latest full run (`failed`, `passed`, `commit`) | "Full run passed · 104 tests · commit 9c1e7aa" | `git.ts:37 GitEvidenceSlot` for `tests`, through `git.ts:88 project.review.status` or `git.ts:43 GitMainReview.evidence` | supplied with a different shape | pass or fail and commit are supplied; no test count |
| First review (`state`, rounds count) | "Review clean after round 2" | `git.ts:37 GitEvidenceSlot` for `review` | supplied with a different shape | pass or fail only; no rounds |
| `workflow.result.open` | Open items | none | missing | |
| Project lead (`leadOf`) | Target of Request change | `schema.ts:50 Project.leadAgentId` | supplied | |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Request change | A link to the lead's chat (`routeForAgent`); no engine call here; the chat then sends `prompt` | `commands.ts:72 prompt` | supplied | |
| Review and merge | `act.openDialog({ type: 'merge-review' })`; the dialog (`design/mock/js/dialogs.js:140`) ends in `act.answerRequest(id, 'merge')` → `engine.call('integrate', { requestId, source, target })` | `git.ts:86 project.review.prepare`, `git.ts:90 project.review.approve`; `git.ts:82 project.integrate` | supplied with a different shape | the mock names branches; the engine takes worktree ids and expected heads, and the owner's base-branch approval is `project.review.approve`, not `project.integrate` |

Notes:

- The current page already prepares and approves main reviews (`packages/web/src/git/GitPage.tsx:168`, `:202`) and reads the evidence (`packages/web/src/git/useGitReads.ts:61`).
- The merge dialog belongs to the Git section; this table records only that the End result opens it.

### Workflow settings

`workflow.js` renders this view with `Settings` (line 551), at `#/p/console/workflow/settings`.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `project.branch` | "Saved to .lgtm/config on feat/agent-console" | `schema.ts:50 Project.worktreeId` → `schema.ts:42 Workspace.branch` | supplied with a different shape | the branch comes through the project's worktree |
| `.lgtm/config` as the settings' home | Same line | none | missing | the engine never reads `.lgtm/config` |
| `project.tests` | Run tests switch | none | missing | |
| `settings.fullRun`, `settings.check` | Full-run command and Check command fields | none | missing | |
| `settings.nightly` | Nightly full run switch | none | missing | |
| `project.agentReview` | Agent review switch | none | missing | |
| `settings.maxRounds` | Most review rounds, 1 to 6 | none | missing | |
| `settings.stuckPoints` | Stuck at, 9 to 27 points | none | missing | |
| `settings.autoMergeFix` | Fix sprints merge on their own | none | missing | |
| `repo.main` | "A pull request into main" | `git.ts:42 GitMainReview.base`; `git.ts:11 GitBranch` from `project.branches` (`git.ts:65`) | supplied with a different shape | `Repository` (`schema.ts:38`) has no base-branch field; the base appears only on a main review |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Turn tests on or off; turn agent review on or off | `proj(k, v)`: local change and a toast; no engine call | none | missing | |
| Edit the full-run or check command | `save('fullRun' or 'check', value)`: local change and a toast; no engine call | none | missing | |
| Turn nightly runs or fix-sprint auto-merge on or off | `save('nightly' or 'autoMergeFix', value)`; no engine call | none | missing | |
| Change most rounds or stuck points | `step(...)` → `save(..., quiet)`; no engine call | none | missing | |

Notes:

- `roles.settings.set` (`roles/commands.ts:29`) saves agent limits and the stall watch switch. It does not hold any setting on this screen.
- `project.settings.set` (`commands.ts:41`) saves the workspace folder, shell and lead defaults. It does not hold any setting on this screen.
- "Points for a finding" and "Merge into the base branch · Always yours" are fixed text.

### Mocks, for a project in its Design stage

`design/mock/js/screens/mocks.js` renders this tab with `MocksTab` (line 331), which shows `Screens` (line 226), `ScreenView` (line 241), `Changes` (line 288), `Data` (line 305) or `Components` (line 323).
The sample data comes from `seedMocks` (line 118).
The screen pictures are drawn by the mock's own components (`ListUI`, `RequestUI` and others, lines 14-86), not read from data.
The current page shows the engine's mock records in `packages/web/src/project/mocks.tsx`.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `project.hasMocks`, `project.stage` | Whether the Mocks tab shows | `schema.ts:51 Project.stage` (`design`); `mocks.ts:83 projectStages` | supplied with a different shape | the current page shows the tab when the latest revision has screens (`Shell.tsx:238`); recording screens moves the project to `design` (`packages/engine/src/project/mocks.ts:122-126`) |
| `mocks.screens` (`id`, `name`) | Screen rows, names, previous and next | `packages/contracts/src/project/mocks.ts:13 MockScreen.screenId`, `.name`, in the latest `MockRevision` (`mocks.ts:37`) from `project.mocks.read` (`mocks.ts:66`) | supplied | |
| `screen.note` | Note column, and the note above the comments | `mocks.ts:13 MockScreen.summary` | supplied | optional in the engine |
| `screen.kind` and the drawn screen | Thumbnail, the large preview, and the Compare pair | `project/display.ts:8 DisplayOpen` `mock` (`projectId`, `revisionId`, `screenId`, `scenarioId`) via `POST /api/display/open` (`packages/engine/src/client/web/server.ts:161`) | supplied with a different shape | the engine serves the recorded HTML or SVG at its route in an isolated frame on a separate HTTPS origin (`packages/web/src/project/display.tsx:65`); the mock draws a component |
| `screen.status` (draft, changed, approved) | Status badge, "1 of 3 screens approved" | `mocks.ts:42 MockApproval.revisionId`, returned by `mocks.read` only for the head revision (`packages/engine/src/project/mocks.ts:213`) | supplied with a different shape | approval covers a whole revision, not one screen; there is no "changed" state |
| `screen.rev` | "Revision 3" | `mocks.ts:37 MockRevision.revisionId` | supplied with a different shape | a revision is a request id for the whole bundle, not a number per screen |
| `screen.updatedAt` | Updated column | `mocks.ts:38 MockRevision.at` | supplied with a different shape | per revision, not per screen |
| `screen.comments` (`from`, `ts`, `text`), and their count | Comments list and Comments column | none | missing | the engine has no comment record |
| `mocks.approvedAt` | "Approved 3 days ago" | `mocks.ts:43 MockApproval.at` | supplied | |
| `mocks.changes` (`screen`, `from`, `to`, `by`, `ts`) | Changes table rows | `mocks.ts:37-38 MockRevision` (`author`, `at`), all revisions from `project.mocks.read` | supplied with a different shape | one row per revision of the whole bundle; no from and to numbers per screen |
| `change.text` | "What changed" | none | missing | a revision has no change description |
| `change.seen`, and the unseen count | "New" badges, "2 changes not seen", the Changes count | none | missing | |
| `change.compare` (an earlier revision drawn beside the later one) | Compare pair | `display.ts:8 DisplayOpen` `mock` with an older `revisionId` | missing | the engine refuses to show a revision whose source file has changed since it was recorded (`packages/engine/src/project/display.ts:36-37`), so an older revision usually cannot be shown |
| `mocks.data` `field` | "request.title" | `mocks.ts:16 MockDraftField.entity`, `.name` in `MockRevision.comparisons` (`mocks.ts:38`) | supplied | |
| `data.schema` (matches, differs, new, unavailable) | Schema badge and the filter counts | `mocks.ts:18 MockFieldComparison.status` | supplied | same four values; the engine notes they are the recording caller's claims, not checked by the engine (`mocks.ts:28`) |
| `data.on` | "Requests, Request" | `mocks.ts:17 MockDraftField.screens` | supplied with a different shape | screen ids, which the page must map to names |
| `data.sample` | Sample value | none | missing | the draft field has no sample value |
| `data.note` | Note column | `mocks.ts:16 MockDraftField.description` | supplied with a different shape | a description of the field, not a note on the comparison |
| `mocks.components` `name` | Component name | `mocks.ts:22 MockComponent.name` | supplied | |
| `component.real` | Real or Draft badge | `mocks.ts:23 MockComponent.provenance` (`shared`, `draft`) | supplied | different words |
| `component.on` | Screens column | `mocks.ts:24 MockComponent.screens` | supplied with a different shape | screen ids |
| `component.uses` | Uses column | none | missing | |
| `component.note` | Small note under the name | none | missing | |
| `component.demo` | Preview column | `display.ts:9 DisplayOpen` `component` | missing | the component display serves only components of a registered repository design (`packages/engine/src/project/display.ts:97-102`), not a mock bundle's draft components |
| The Designer (`designerOf`) | "Ask the designer for a change", avatar, typing dots | `reads.ts:30 RosterEntry.role`, `.name` | supplied | |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Comment on a screen (Screen view form) | `comment(s, p, screen, text)`: adds the comment, then a simulated Designer reply and a new revision; no engine call | none | missing | no comment record; the mock does not send the text to any agent here |
| Request changes (dialog) | `mock-changes` dialog: `comment(...)` locally, then `act.sendMessage(designer, text)` → `engine.call('prompt', { agentId, text, context, files })` | `commands.ts:72 prompt` | supplied with a different shape | the message is supplied; the comment record is not; `prompt` takes `context` but no `files` |
| Approve one screen | Inline update of `screen.status` and its changes, then a toast; no engine call | none | missing | the engine approves whole revisions only |
| Approve mocks | `approveAll`: confirm dialog, then local changes (all screens approved, stage Plan, Design agents idle, a new Planning team with Planning lead and Planner 1, a lead message); no engine call | `mocks.ts:72 project.mocks.approve` (owner only, `mocks.ts:76`) | supplied with a different shape | the engine needs the exact head `revisionId` and unchanged source files (`packages/engine/src/project/mocks.ts:133`, `:146`); it records `project.MockApproved`, moves the stage to `plan`, and sends the worklist to the lead (`:154-157`); it does not start a team or idle agents |
| Mark seen | Inline update of `change.seen`; no engine call | none | missing | |
| Edit design (Screen view) | `act.toast('Opening … in OpenPencil')`; no engine call | `display.ts:10 DisplayOpen` `editor` via `POST /api/display/open` (`server.ts:161`) | supplied with a different shape | needs `bundle.designRevision` (`mocks.ts:27`); the current page disables the button without it (`packages/web/src/project/mocks.tsx:100-103`); the editor opens read-only (see the Design section) |
| Open a screen, previous and next | Links; no engine call | `mocks.ts:66 project.mocks.read` | supplied | |

Notes:

- The current page shows how the engine's approval works: it reads the whole history (`packages/web/src/project/mockRead.ts:8`), asks the owner to read the current artifacts with `project.mocks.artifact` (`mocks.tsx:52`), and approves only the head revision (`mockRead.ts:68`).
- `project.mocks.artifact` (`mocks.ts:69`) returns each source file's current text and fingerprint. The mock has no counterpart to this check.
- The engine has scenarios per screen (`mocks.ts:14-15`) and token sources (`mocks.ts:12`). The mock shows neither.
- View state, not an engine need: the open tab, the phone or desktop preview size, the zoom, the Data filter, the open Compare row, and the comment draft.

### Chat with any agent

The Chat tab (`#/p/console/chat`) is rendered by `ChatTab` and `Aside` in `design/mock/js/screens/chat.js:10-64`. Its thread and composer come from `Thread`, `ToolGroup`, `LargeItem`, `ReadOnlyBar`, `canMessage`, `ContextPicker`, `Attachments`, `Composer` and `AgentLine` in `design/mock/js/ui.js:25-603`. The same thread and composer also appear in the side panel, `SidePanel` in `design/mock/js/app.js:221-242`, which docks the project lead beside every other project tab.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `threads[agentId]` items of type `user` with no `from` | The owner's own messages, with time | `packages/contracts/src/events.ts:184 PromptSent` (sender `owner`, `text`, `context`), read through `client.thread` (`packages/contracts/src/client/commands.ts:38`) and `client.subscribe` (`client/commands.ts:42`); time from `EventEnvelope.occurredAt` (`events.ts:267`) | supplied with a different shape | One event per delivery, keyed by sequence; when context is attached, the engine appends a context envelope to the stored text (`packages/engine/src/commands/prompt.ts:13-15`) |
| `threads[agentId]` items of type `user` with `from` | A message from another agent, such as a lead's handoff | `events.ts:184 PromptSent.sender` (`agent`) | supplied with a different shape | The engine wraps agent-sent text in a "Data from another agent" envelope (`packages/engine/src/routing/envelope.ts:14-25`) |
| `it.context` on a sent message | Tags naming the tasks and files sent with it | `events.ts:184 PromptSent.context` (`DeliveryContextReferences`) | supplied with a different shape | Engine holds identities (`task` or `file` references), mock holds display labels |
| `it.files` on a sent message | Attached pictures and files, with sizes and "resized from" | none | missing | No event or payload carries attachments |
| `threads[agentId]` items of type `agent` (`text`) | The agent's reply text | `events.ts:185 ThreadItem` with `content._tag "text"` (`events.ts:119`) | supplied with a different shape | Text arrives as deltas that the client folds with `groupThreadItems` (`packages/contracts/src/thread.ts:8-41`) |
| Item type `tools` (`summary`, `lines[].verb`, `.arg`, `.res`) | One disclosure that groups several tool calls under a summary line | `events.ts:125-133 ThreadContent tool-call` (`callId`, `title`, `status`, `input`, `output`) | supplied with a different shape | Engine has one item per tool call with a title, status and free text; there is no group summary and no verb, argument and result split |
| Item type `large` (`title`, `size`, `lines`) | A large item with Load, Copy and Open in full | `packages/contracts/src/client/reads.ts:21 client.Oversized` (`bytes`) on the stream, then `client.event` (`client/commands.ts:46`) | supplied with a different shape | Engine gives a byte count and a sequence, with no title and no line count |
| Item type `request` and `it.requests` on an agent message | Question and approval cards inside the thread | `events.ts:193 PermissionRequested`, `events.ts:213 QuestionAsked`, and `client.requests` (`client/commands.ts:49`, rows `packages/contracts/src/requests.ts:19-32`) | supplied with a different shape | Requests are separate events, not attached to a message; see the next row for the card fields |
| `request.brief`, `.summary`, `.recShort`, `.recommendation`, `.options`, `.what`, `.whyText`, `.recWhy`, `.refs`, `.blocks`, `.command`, `.folder`, `.tool` | The question or approval card's brief and its Details report | Questions: `packages/contracts/src/questions.ts:12-17` (`title`, `recommendation`, `proposedAnswer`, project link). Approvals: `events.ts:193-202` (`description`, `options`, `toolKind`, `toolInput`, `locations`) | supplied with a different shape | Questions have no option list, no "what", "why", "why this answer" or references; approvals carry the tool input and options from the adapter, not a command and folder pair |
| Item type `note` | Lines such as "You stopped this reply" and "You resumed Builder 1" | `events.ts:189 TurnEnded.stopped`, `events.ts:244 AgentStopped`, `events.ts:190 StateChanged`, with `EventEnvelope.caller` (`events.ts:268`) | supplied with a different shape | No event says who resumed an agent except the envelope's caller |
| (none in the mock) | Plans and file changes | `events.ts:120-124 ThreadContent plan` and `events.ts:134-140 file-change` (`path`, `diff`) | supplied with a different shape | The engine sends these items, and the mock has no view for them |
| `pending[agentId]` | The typing dots, and the Stop button in place of Send | `events.ts:232 DeliverySent` until `events.ts:189 TurnEnded`, as the current website derives it in `packages/web/src/thread/replyControls.tsx:8-19` | supplied with a different shape | Derived from events, not a flag |
| `agent.name`, `agent.role`, team name | Header name, role icon and team | `packages/contracts/src/client/reads.ts:30 RosterEntry.name`, `.role`, `.groups`; team from `packages/contracts/src/project/schema.ts:65-69 Team` matched by `projectTeamGroup` (`schema.ts:98`) | supplied with a different shape | Engine role is a free string, mock has eight fixed roles |
| `agent.state`, `agentStatus()` word and dot | "Working", "Needs answer", "Stopped", "Failed start", "May be stuck" | `reads.ts:33 RosterEntry.state` and `.displayedState`, `reads.ts:34 openPermissionRequests`, `openQuestionsAsked`; states in `packages/contracts/src/stateMachine.ts:10-30` | supplied with a different shape | Engine has seven lifecycle states and ten displayed words; mock has six states and its own words |
| `agent.activity` | The line after the state word, such as "Editing Sidebar.tsx" | none | missing | No per-agent activity text; the nearest is the title of the latest `tool-call` item |
| `agent.stalled` | Badge "No output for 14 min · nudged" | `packages/contracts/src/roles/events.ts:38 roles.StallSeen` and `:51 roles.StallEnded`, listed by `roles.actions.list` (`roles/commands.ts:31`) | supplied with a different shape | A pair of events per agent, not a flag; the minutes are not in the event |
| `agent.task`, `task.title`, `task.files` | "Working on": the task tag, its title and its files | `schema.ts:86-89 Task.owner`, `.state`, `.title`, `.label` in `ProjectSnapshot` (`packages/contracts/src/project/commands.ts:33-37`) | supplied with a different shape | The agent's task is found by `Task.owner`; tasks have no file list, so `task.files` is missing |
| `sprintsOf()` with `column` "In progress" or "Review", `sprintProgress()` | "Sprints in flight" for the project lead, with done of total | `schema.ts:71-75 Sprint` and `packages/contracts/src/project/status.ts:3-5 sprintStatus` | supplied with a different shape | Engine status words are done, active, review and planned, not board columns |
| `agent.harness`, `HARNESSES[...].name`, `.runMode` | "Runs as": harness name and run mode | `reads.ts:35 RosterEntry.harness`; run mode only in `events.ts:165 AgentStarted.runMode` | supplied with a different shape | Roster gives a harness id, not a display name; run mode is not on the roster row |
| `agent.subscription`, `subLabel()` | Subscription name | `reads.ts:35 RosterEntry.account`, names from `accounts` list (`packages/contracts/src/commands.ts:111`, `Account.displayName` in `packages/contracts/src/accounts.ts:22`) | supplied with a different shape | The current website joins them the same way (`packages/web/src/thread/agentTools.tsx:155`) |
| `agent.model`, `agent.effort` | Model and effort | `reads.ts:36-37 RosterEntry.model`, `.effort`, `.configuration`; `client.agent.configuration` (`client/commands.ts:25`) | supplied | Engine also reports desired against applied and a status |
| `HARNESSES[h].models`, `.efforts` | The model and effort menus | `client.agent.configuration` reply `AgentChoices` (`packages/contracts/src/agentConfiguration.ts:15-21`) | supplied with a different shape | Choices are ids with optional labels, negotiated per agent |
| `agent.permission` | Permission mode | `reads.ts:38 RosterEntry.permission` (`packages/contracts/src/permission.ts:3-4`), updated by `events.ts:191 ModeChanged` | supplied with a different shape | Engine ids `read-only`, `ask`, `edit`, `full`; mock uses four sentences |
| `project.machine`, `machineOf().name` | Machine name | `schema.ts:50 Project.machineId` | supplied with a different shape | A machine id string, with no machine record behind it |
| `agent.context` | Context bar and percent, warning at 80 | `client.agent.context` (`client/commands.ts:29`), reply `ContextUsage` (`agentConfiguration.ts:23-30`) | supplied with a different shape | One owner-only call per agent; may be `unavailable` with a reason |
| `agent.turns` | "N turns" in "This run" | none (`events.ts:189 TurnEnded` exists per turn) | missing | No count; a client could only count `TurnEnded` events itself |
| `agent.tokens` | "N.NM tokens" in "This run" | none (`events.ts:98-107 TurnUsage` per turn) | missing | No running total; `TurnUsage` has input and cache counts but no output tokens |
| `agent.startedAt` | "started 3 h ago" | `reads.ts:39 RosterEntry.startedAt` | supplied | |
| Peers: team leads or same-team agents | The "Team leads" or "Same team" list with status words | `reads.ts:30-31 RosterEntry.groups`, `.parent`; `ProjectSnapshot.teams` | supplied with a different shape | Derived from group labels, as `packages/web/src/shell/model.ts:20 teamAgents` does |
| `openRequests(s, { agent })` | "Latest · N requests below", and the lead's open count | `reads.ts:48 ClientSnapshot.requests`, `.questions` (`IdentityRow.agentId`) | supplied | |
| `agent.failure` (`reason`, `machine`, `subscription`) | "Builder 2 failed to start" with "Sign in on Buildbox" | `reads.ts:32 RosterEntry.startFailure` (`packages/contracts/src/startFailure.ts:3-5`), `events.ts:248 AccountNeedsSignIn` | supplied with a different shape | Engine gives one of seven codes; it does not name the machine |
| `conn.status` | Composer disabled while not live | Socket state of `client.subscribe` | supplied with a different shape | Connection state belongs to the client |
| `canMessage()` rule | Only the project lead, or an agent with an open question, gets a composer | `packages/contracts/src/commands.ts:169 commandAccess.prompt` and `packages/engine/src/commands/planners.ts:26-35` | supplied with a different shape | The engine lets the owner prompt any agent that is not stopped or crashed; the read-only rule exists only in the mock |
| `project.lead` | The side panel's default agent | `schema.ts:50 Project.leadAgentId` | supplied | |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Send a message | `act.sendMessage` reports `prompt` `{ agentId, text, context, files }` (`design/mock/js/actions.js:78-102`) | `prompt` (`packages/contracts/src/commands.ts:72-75`) | supplied with a different shape | Payload needs a `requestId`; it has no `files` key; see the notes |
| Add a task or file as context | `ContextPicker` filters `s.tasks` and their files in the browser (`ui.js:461-475`); no call | `project.context.search` (`packages/contracts/src/project/commands.ts:38`, `project/context.ts:19-28`) | supplied with a different shape | Engine returns `ContextReference` identities and labels; the current website uses it in `packages/web/src/thread/contextPicker.tsx:31` |
| Attach files or images, choose resized or original | `shrink`, `sentForm`, `addFiles` in `ui.js:485-549`; carried in `prompt.files` | none | missing | No upload request and no attachment field anywhere in the contracts |
| Stop the reply being written | `act.stopReply` reports `cancel-reply` `{ agentId }` (`actions.js:104-112`) | `cancel-reply` (`commands.ts:99`), handler `packages/engine/src/commands/cancelReply.ts:6-21` | supplied | Refused with "no active reply" when nothing is being written |
| Stop the agent | `act.stopAgent` reports `stop` `{ agentId }` after a confirm (`actions.js:113-132`) | `stop` (`commands.ts:100`), handler `packages/engine/src/commands/stop.ts:9-20` | supplied | Engine also cancels open approvals and keeps questions open, as the mock describes |
| Resume a stopped or failed agent | `act.resumeAgent` reports `resume` `{ agentId }` (`actions.js:133-142`) | `resume` (`commands.ts:101-103`) | supplied | Engine adds an optional `fresh` flag; resume is refused while starting, working, idle or paused (`packages/contracts/src/stateMachine.ts:54-62`) |
| Change model or effort | `act.setAgentConfig` reports `configure` `{ agentId, model }` or `{ effort }` (`actions.js:143`) | `configure` (`commands.ts:68-71`), handler `packages/engine/src/commands/configuration.ts:27-40` | supplied | Value must be a choice id from `client.agent.configuration` |
| Change subscription | `act.setAgentConfig` reports `configure` `{ agentId, subscription }` (`ui.js:590-591`) | none | missing | `configure` takes only model and effort; the account is fixed at `start` |
| Change permission mode | `act.setAgentConfig` reports `configure` `{ agentId, permission }` (`chat.js:28-29`) | none | missing | No owner request changes the level; `ModeChanged` comes only from adapter reports (`packages/engine/src/commands/CommandHandler.ts:148-152`) |
| Compact the context | No control in the mock | `compact` (`commands.ts:104-106`) | supplied | Allowed only while the agent is idle (`stateMachine.ts:54-62`); the mock has no button and the current website has none either |
| Answer a question or an approval in the thread | `act.answerRequest` reports `answer` (`actions.js:146-157`) | `answer` (`commands.ts:76-82`) | supplied with a different shape | A question takes free text only, so "Accept" and "Choose" must send text; "Always allow" and "Always deny" are options the adapter offers |
| Open the agent's terminal, open its worktree in Git | Navigation only (`chat.js:55-56`) | none needed | supplied | View change |
| Open a question's thread in the side panel, back to the lead | `act.openSidePanel`, `act.closeSidePanel` (`actions.js:38-44`) | none needed | supplied | View state |
| Load a large item | `LargeItem` waits 600 milliseconds (`ui.js:368-380`) | `client.event` (`client/commands.ts:46`), as `packages/web/src/thread/index.tsx:37` does | supplied | |
| Keep a draft per agent | `act.setDraft` (`actions.js:77`) | none | supplied | Browser state |

Notes:

- The mock's `prompt` call already sends `files` as a list of names and sizes (`design/mock/js/actions.js:82`). The contract's `prompt` payload declares only `requestId`, `agentId`, `text` and an optional `context` (`packages/contracts/src/commands.ts:72-73`). It has no `files` key. Whether an extra key is dropped or refused when the remote procedure call (RPC) payload is decoded was not checked.
- The mock's `context` is a list of display labels. The engine's `context` is a list of `ContextReference` identities, at most 16 and 16 kilobytes (`packages/contracts/src/project/context.ts:9-15`). A `file` reference needs a project, repository, worktree and path.
- The mock's composer is hidden for every agent except the project lead and an agent with an open question. The engine has no such rule for the owner. The engine refuses `prompt` only for a stopped or crashed agent and for an agent that failed to start (`packages/engine/src/commands/planners.ts:33-34`).
- The current website reads a thread with `client.snapshot`, then pages `client.thread`, then streams `client.subscribe` filtered to one agent (`packages/web/src/thread/watch.ts:75-92`). It renders `text`, `plan`, `tool-call` and `file-change` items in `packages/web/src/thread/content.tsx:10-24`. It sends with `prompt` and `context` in `packages/web/src/thread/composer.tsx:44-69`.
- The engine queues a prompt sent while the agent is working (`stateMachine.ts:54-62`). The mock shows no queued state.
- `client.agent.configuration` and `client.agent.context` are owner-only (`packages/contracts/src/client/commands.ts:82`). The current website polls them every five seconds (`packages/web/src/thread/agentTools.tsx:52-63`).
- The stall watch can also compact an agent on its own, which is recorded as `roles.CompactRequested` (`packages/contracts/src/roles/events.ts:50`).
- View state, not an engine need: the side panel's open state, width and drawer, the scroll position, the "Latest" button, the Details toggle on a card, the picker's search text, and the staged attachments before sending.

### Messages, the agents' message board

The Messages tab (`#/p/console/messages`) is rendered by `MessagesTab` in `design/mock/js/screens/messages.js:287-371`. Its parts are `ChannelList` (line 242), `Post` (line 167), `PostComposer` (line 212), `ThreadPane` (line 263), `ReplyWord` (line 160) and `KindTag` (line 155). Its data comes from the channels and posts seeded in `design/mock/js/data.js:276-308` and from `seedBoard` (`messages.js:37-76`).

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `channels[]` filtered by `channel.project` | The channel list for this project | `board.channels` (`packages/contracts/src/board/commands.ts:70-72`, row shape lines 22-26); also `ClientSnapshot.board.channels` (`packages/engine/src/board/snapshot.ts:40-45`) | supplied with a different shape | Channels have no project field; a team channel is linked through `Team.channelId` (`packages/contracts/src/project/schema.ts:68`) |
| `channel.kind` (`leads`, `team`, `dm`) | Megaphone, hash or paired avatars, and the "Channels" and "Direct messages" headings | `board/commands.ts:23 kind` (`plain`, `group`, `direct`) | supplied with a different shape | Engine has no leads kind; a team's channel is a `group` channel opened by `project.team.create` (`packages/engine/src/project/commands.ts:178`) |
| Leads channel (`kind: 'leads'`) | "#leads", "The project lead and every team lead" | none | missing | The engine opens no leads channel; an agent or the owner could open a plain one with `board.open` |
| `channel.name` | "#build-shell" | `board/commands.ts:23 name` | supplied with a different shape | A team channel is named `Team_<teamId>` by the engine; the readable name is `Team.name` |
| `channel.members` | Member avatars, the members menu, and the DM pair label | `board/commands.ts:24 members` (`BoardAuthor` list) | supplied with a different shape | A `group` channel's members are computed from group labels (`packages/engine/src/board/access.ts:39-55`) |
| `channel.team`, `team.needToKnow`, `isPrivate()` | The team link, the "Need to know" badge and the lock icon | `Team.channelId` (`schema.ts:68`) for the team link; none for need to know | missing | Team has no need-to-know flag |
| `posts[]` by channel, with no `replyTo` | The post stream | `board.peek` (`board/commands.ts:67-69`) or `board.read` (`board/commands.ts:56-66`); rows `BoardPost` (`packages/contracts/src/board/schemas.ts:18-22`) | supplied with a different shape | Engine posts are ordered by sequence; the current website pages `board.peek` (`packages/web/src/thread/team.tsx:46`) |
| `post.from` | Author face, name and team | `schemas.ts:15 BoardPostFields.author` | supplied with a different shape | Author is a tagged owner, agent or service; a service author has no mock equivalent |
| `post.text` | The post body, with task and sprint labels made into links | `schemas.ts:15 text` | supplied | Linking is done in the browser |
| `post.ts` | Time, day separators, "Needs reply · 12 min", grouping of posts under 12 minutes | `packages/contracts/src/events.ts:267 EventEnvelope.occurredAt` of `board.PostWritten` (`packages/contracts/src/board/events.ts:31`) | supplied with a different shape | `BoardPost` has a sequence and no time; time needs the event envelope |
| `post.kind` (`question`, `blocked`, `handoff`, `done`, `decision`, `note`) | The kind tag and its icon | none | missing | Board posts have no kind |
| `post.action` (`fyi`, `needs-reply`) | "FYI" or a reply state | `schemas.ts:16 reply` (`packages/contracts/src/board/ids.ts:11 ReplyMode`) | supplied with a different shape | Engine has `none`, `any` and `all`, not two values |
| `post.to` | "→ Builder 1, Builder 2" | `schemas.ts:16 to` (`BoardAddressees`) | supplied | Addressees are tagged owner or agent |
| `post.replyTo`, `repliesOf()` | Reply count, reply faces, last reply snippet and its age | `schemas.ts:16 replyTo`; `board.read` with `repliesTo` (`board/commands.ts:61`); `replyIds` in `snapshot.ts:35` | supplied | Snapshot lists reply ids for open posts only |
| `post.closed`, `replyState()` (`answered`, `stalled`) | "Answered", "Needs reply", "No reply for 14 min" | `schemas.ts:19-21 status`, `outcome`, `dispositions`; `ids.ts:23-25 Disposition`, `CloseOutcome`; stall from `roles.StallSeen.stalledPostId` (`packages/contracts/src/roles/events.ts:38`) | supplied with a different shape | Engine tracks each addressee's disposition and an outcome; the mock computes answered and a fixed ten-minute stall in the browser |
| `post.blocks`, `post.request` | "Blocks AC-16", and the request that waits for the owner | none | missing | Posts carry only optional `context` references to tasks and files (`schemas.ts:16`) |
| `boardRead[channelId]` and `unreadOf()` | Unread counts per channel | `board.Read` event (`board/events.ts:51`) written when the owner calls `board.read` (`packages/engine/src/board/commands.ts:239-240`); counts in `ClientSnapshot.board.unread` (`snapshot.ts:46-55`) | supplied with a different shape | Snapshot counts cover channel members only, so the owner's own counts appear only where the owner is a member |
| `waitingIn()` and the "Waiting for a reply" view | Every open post across the project | `ClientSnapshot.board.posts` lists open posts without text (`snapshot.ts:31-37`); `board.read` with `open: true` lists the caller's own open posts (`board/commands.ts:59`) | supplied with a different shape | No single read returns every open post with its text; text needs `board.peek` per channel |
| Member status words in the members menu and the recipients menu | "Working", "Needs approval" | `packages/contracts/src/client/reads.ts:33 RosterEntry.displayedState` | supplied with a different shape | Same as the Chat screen's state words |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Post to a channel | `sendPost` (`messages.js:121-135`); reports no call | `board.post` with `channelId` (`board/commands.ts:41-47`) | supplied with a different shape | The mock does not report this call; the engine has no kind; "Needs reply" maps to `reply` `any` or `all` |
| Post "Needs reply" to "Everyone here" | `sendPost` with `to: []` and `action: 'needs-reply'` | `board.post` | supplied with a different shape | The engine refuses a reply-wanted post with no addressee (`packages/engine/src/board/commands.ts:93`) |
| Reply in a thread | `ThreadPane` and `PostComposer` with `replyTo` (`messages.js:263-285`) | `board.post` with `replyTo` (`board/commands.ts:20`) | supplied | The engine resolves the owner's reply against the parent post and may close it (`packages/engine/src/board/commands.ts:117-131`) |
| Post into a direct message between two agents | `PostComposer` in a `dm` channel | `board.post` with `channelId` of a `direct` channel | supplied with a different shape | The owner is not a member of an agents' direct channel; posting there was allowed by `canPost` for the owner (`packages/engine/src/board/access.ts:168-174`), but whether addressing works there was not checked |
| Mark as answered | `setClosed(id, true)` (`messages.js:136`); no call | `board.close` (`board/commands.ts:48-51`) | supplied with a different shape | The engine records the owner's close as outcome `withdrawn`, not `answered` (`packages/engine/src/board/commands.ts:142`) |
| Reopen a post | `setClosed(id, false)`; no call | none | missing | The engine has no reopen |
| Read a channel, which clears its unread count | `MessagesTab` sets `boardRead[ch.id]` (`messages.js:297`) | `board.read` with `channelId` writes `board.Read` marks; `board.peek` does not (`packages/engine/src/board/commands.ts:200-240`) | supplied | The current website uses `board.peek` and so never marks posts read |
| Open the request a post points to | Link to `routeForRequest` | none | missing | Posts have no request link |
| Open a chat with the author | Link to `routeForAgent` | none needed | supplied | Navigation |

Notes:

- No board action in the mock reports an engine call. `sendPost`, `setClosed` and `nudge` change only browser state (`design/mock/js/screens/messages.js:121-152`).
- Board events are owner-only (`packages/contracts/src/board/events.ts:55-65`), so the owner's `client.subscribe` stream carries every post as it is written.
- `ClientSnapshot.board` is typed `Schema.Unknown` in the contract (`packages/contracts/src/client/reads.ts:62`). Its real shape is set by `packages/engine/src/board/snapshot.ts:9-61`, and it is bounded at 256 kilobytes with a `truncated` flag.
- The current website shows one team's channel through `board.peek`, polled every five seconds (`packages/web/src/thread/team.tsx:41-65`). It posts with `board.post` and `reply: "none"` (`packages/web/src/thread/composer.tsx:48-50`). It reads a single post for an alert with `board.read` and `post` (`packages/web/src/thread/subjects/board.tsx:42`).
- View state, not an engine need: the selected channel, the open thread, the search text, the kind, author and "Needs reply" filters, and per-channel drafts.

### Agents, the roster by situation

The Agents tab (`#/p/console/agents`) is rendered by `AgentsTab` in `design/mock/js/screens/messages.js:476-514`. Its parts are `AgentTable` (line 452), `LaneRow` (line 430), `RowActions` (line 413), `agentMenu` (line 401), `Context` (line 422) and `TaskLink` (line 425), and the lane is chosen by `situation` (line 383).

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `agentsOfProject()` | Every agent in the project | `ClientSnapshot.agents` (`packages/contracts/src/client/reads.ts:45-47`) joined with `ProjectSnapshot.agents` (`packages/contracts/src/project/commands.ts:32`) or `client.roster` (`packages/contracts/src/client/commands.ts:34-37`) | supplied with a different shape | Project membership comes from `ProjectAgentSummary.projectId`, not a field on the agent |
| `agent.name`, `agent.role`, avatar | Role name and icon | `reads.ts:30 RosterEntry.name`, `.role` | supplied with a different shape | Free-string role |
| `agent.team`, `teamName()` | Team column | `reads.ts:30 RosterEntry.groups` and `Team.group` (`packages/contracts/src/project/schema.ts:65-69`) | supplied with a different shape | Derived from group labels |
| `agent.workState` and `workState()` (`off`, `assigned`, `working`, `waiting`, `done`) | Work state chip | `reads.ts:33 RosterEntry.state`, `.displayedState`; `ProjectAgentSummary.status` (`project/commands.ts:32`, rule in `packages/contracts/src/project/status.ts:6-8`) | supplied with a different shape | Engine statuses are "Needs you", "Reviewing", "Working" and "Ready"; there is no assigned or done |
| `situation().lane` (`needs`, `blocked`, `working`, `done`, `idle`) and `.why` | The five lanes and the reason line | `reads.ts:32-34` (`startFailure`, `state`, `openPermissionRequests`, `openQuestionsAsked`), `ClientSnapshot.requests` (`reads.ts:48`), `roles.StallSeen` (`packages/contracts/src/roles/events.ts:38`) | supplied with a different shape | Lanes are the mock's own grouping; "done" has no engine source |
| `agent.task` | Task tag, title, or "No task" | `schema.ts:86-89 Task.owner`, `.label`, `.title` | supplied with a different shape | Found by searching tasks by owner |
| `agent.activity` | "Doing now" | none | missing | Same gap as the Chat screen |
| `agent.lastOutputAt` | "Last output", and the sort | `packages/contracts/src/events.ts:267 occurredAt` of the agent's latest `ThreadItem` (`events.ts:185`) | supplied with a different shape | No field; the client must track the newest event per agent |
| `agent.stalled` | "May be stuck", the warning icon, the Blocked lane, and the "May be stuck" total | `roles.StallSeen` and `roles.StallEnded` (`roles/events.ts:38`, `:51`), `roles.actions.list` (`packages/contracts/src/roles/commands.ts:31-36`) | supplied with a different shape | Thresholds are ten minutes for a worker and twenty for a lead (`packages/engine/src/roles/stall-watch/rules/stall.ts:170`), matching the mock's note |
| `agent.context` | Context meter, warning at 70 | `client.agent.context` (`client/commands.ts:29`) | supplied with a different shape | One owner-only call per agent row |
| `agent.turns`, and the "turns" total | Turns column | none | missing | No count |
| `agent.tokens`, and "Tokens so far" | Tokens column and total | none | missing | No running total |
| `agent.harness`, `agent.model`, `agent.effort` | "Harness and model" | `reads.ts:35-37 RosterEntry.harness`, `.model`, `.effort` | supplied with a different shape | Harness id, not display name |
| Project `machine` | Machine column | `schema.ts:50 Project.machineId` | supplied with a different shape | No machine record |
| `agent.permission` | Permission column and the menu's checked item | `reads.ts:38 RosterEntry.permission` | supplied with a different shape | Engine ids against mock sentences |
| `subscription.usage.pct`, `subLabel()` | "Subscriptions in use" with weekly usage | `ClientSnapshot.accounts` (`reads.ts:50-53`, `status` only), `events.ts:249 AccountOutOfUsage` | missing | No usage percentage anywhere in the contracts |
| `teams` of the project | The team filter menu | `ProjectSnapshot.teams` (`project/commands.ts:36`) | supplied | |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Open chat | Link to `routeForAgent` | none needed | supplied | Navigation |
| Stop | `act.stopAgent` reports `stop` | `stop` (`packages/contracts/src/commands.ts:100`) | supplied | |
| Resume | `act.resumeAgent` reports `resume` | `resume` (`commands.ts:101-103`) | supplied | |
| Nudge | `nudge` posts a status check to the agent's channel (`messages.js:137-152`); reports no call | `board.post` with `reply` `any` (`packages/contracts/src/board/commands.ts:41-47`) | supplied with a different shape | No nudge request; the mock does not report the post; `board.flush` (`board/commands.ts:84-87`) only delivers unread board items and is not a status check |
| Set permission mode | `act.setAgentConfig` reports `configure` `{ permission }` | none | missing | `configure` has no permission field (`commands.ts:68-71`) |
| Set model, from the next turn | `act.setAgentConfig` reports `configure` `{ model }` | `configure` (`commands.ts:68-71`) | supplied | Engine applies it before the next delivery (`packages/engine/src/commands/configuration.ts:44-60`) |

Notes:

- The roster in the snapshot already counts each agent's open approvals and questions (`packages/contracts/src/client/reads.ts:34`), so "Waiting on you" needs no extra request.
- `client.roster` filters by group, role or parent (`packages/contracts/src/client/commands.ts:34-37`). It does not filter by project.
- The current website finds a team's agents from group labels (`packages/web/src/shell/model.ts:20`) and shows no roster table.
- View state, not an engine need: the Lanes or Table choice, the team filter, and the table sort.

### Terminal

The Terminal tab (`#/p/console/terminal`) is rendered by `TerminalTab` in `design/mock/js/screens/terminal.js:427-615`, with its sessions created by `ensure` (line 365) and `makeSession` (line 352). `seedTerminal` (line 397) only sets an empty session list and the text size. The shell, its file tree, its commands and its editor are all simulated in the browser.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `terminal.byProject[pid].sessions` | One tab per shell session | none | missing | The engine has no shell session record |
| `session.lines`, `session.cwd`, `session.input`, `session.history`, `session.running`, `session.exit` | The screen, prompt, cursor and status line | none | missing | No pseudo-terminal (PTY) and no terminal output stream |
| `session.vim` | The full-screen editor | none | missing | |
| `session.status` (`open`, `dropped`, `reconnecting`, `offline`) | Bars for a dropped connection and an offline machine | none | missing | |
| `session.watching` (`agent`, `cmd`, `done`) | "Builder 1 is running pnpm test. You are watching." | `ThreadItem` with `tool-call` `output` (`packages/contracts/src/events.ts:125-133`), fed by the adapter's terminal output (`packages/engine/src/runner/terminal.ts:58-62`) | supplied with a different shape | The agent's command output reaches the thread as tool-call text, at most two snapshots a second; it is not a terminal screen and takes no keys |
| `worktrees()`: project folder and branch, each team's folder and branch | The "New session" menu | `ProjectSnapshot.workspaces` (`packages/contracts/src/project/schema.ts:41-46` `path`, `branch`, `machineId`, `teamId`) | supplied | |
| `machines[].status`, `.lastSeen`, `.name` | Offline machines greyed out, "last seen" | none | missing | `machineId` is a name with no status record |
| `project.shell` | Shell name in the status line | `schema.ts:51 Project.shell` | supplied | |
| `repo.main`, `repo.folders[machine]` | Main-branch sessions on other machines | `ProjectSnapshot.repositories` (`packages/contracts/src/project/commands.ts:36`) | missing | No base-branch field, and one path for each repository; see the repository page section |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Open a new shell session in a worktree | `open` (`terminal.js:454`); no call | none | missing | |
| Type commands, use Tab, history and Ctrl keys | `press`, `exec` (`terminal.js:162-346`); no call | none | missing | |
| Close a session, rename it, copy its output, clear scrollback | `close`, `rename`, `copyAll` (`terminal.js:445-476`); no call | none | missing | Rename and copy would be browser-only |
| Reconnect a dropped session | `reconnect` (`terminal.js:459-462`); no call | none | missing | |
| Take over an agent's session | `takeOver` (`terminal.js:463-472`); no call | none | missing | The nearest engine action is `cancel-reply` or `stop`, which end the agent's turn, not hand over a shell |

Notes:

- Nothing in the engine carries a terminal session the website could show or type into. No request, event or snapshot field describes a shell, its output or its input.
- The contract names two run modes, `acp` and `interactive` (`packages/contracts/src/harnesses.ts:5`). ACP is the Agent Client Protocol.
- `SessionReference` has an `interactive` member with a Herdr `paneId` (`packages/contracts/src/events.ts:44-47`). It can appear on `SessionOpened` (`events.ts:169-176`) and on the roster row as `session` (`packages/contracts/src/client/reads.ts:39`).
- No engine code writes an `interactive` session today. The runner refuses any session that is not an ACP session, and any harness whose run mode is not `acp` (`packages/engine/src/runner/AcpRunner.ts:346-348`). The built-in harness list sets every harness to `acp` (`packages/engine/src/runner/harnesses.ts:93`).
- The Herdr plugin does not open a shell for the website. Its "View LGTM Studio threads" action opens a Herdr pane that runs `lgtm view`, the owner's thread viewer (`plugins/herdr/src/openPane.ts:6-16`, `plugins/herdr/README.md`). The plugin's README says interactive agent sessions remain later work.
- So a future `interactive` session would give the website only a pane identity inside Herdr. It would not give the website the pane's text or a way to send keys, because no request reads or writes a pane.
- What the engine does give is each ACP agent's command output, as redacted `tool-call` text in the agent's thread. The current website shows it inside a tool disclosure (`packages/web/src/thread/content.tsx:15-23`).
- View state, not an engine need: the active tab, the text size, the measured columns and rows, the phone key row and its Ctrl latch.

### Files

The Files tab is rendered by `FilesTab` in `design/mock/js/screens/files.js:148`, with the tree in `Tree` (line 134) and the one-file commit dialog in `CommitFile` (line 117). The listing and file text come from `design/mock/js/files-data.js` (`listFiles` at line 28, `fileText` at line 224), and the editor is CodeMirror 6 in `design/mock/js/editor.js:64`.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `worktrees[]` filtered by `repo`, `inspecting[project.id]`, `project.branch` | Which worktree the tab reads | `packages/contracts/src/project/commands.ts:34 ProjectSnapshot.workspaces`; `packages/contracts/src/project/schema.ts:41 Workspace` | supplied with a different shape | Engine has `worktreeId`, `branch`, `projectId`, `teamId`, `parentId`, `checkout`; mock has `kind` (base, project, team, agent) and `project` |
| `w.branch` | Branch name above the tree | `packages/contracts/src/project/schema.ts:42 Workspace.branch` | supplied | |
| `w.folder` | Worktree folder path | `packages/contracts/src/project/schema.ts:42 Workspace.path` | supplied | |
| `w.machine` then `machine.name`, `machine.status`, `machine.here` | Machine name, online dot, "offline" state, remote loading delay | `packages/contracts/src/project/schema.ts:42 Workspace.machineId` | missing | Engine has only a machine id string; no machine list, name or online status exists in the contracts |
| `w.kind === 'base'` | Read-only lock on the base branch | `packages/contracts/src/project/schema.ts:43 Workspace.checkout` | supplied with a different shape | Engine marks `"main"` or `"worktree"` checkouts, not a base kind |
| `listFiles(repo, …)` entries: `path` | Folder tree and "Go to file" search | `project.context.search` with `scope: "files"`: `packages/contracts/src/project/context.ts:19`; handler `packages/engine/src/project/context.ts:105`; names from `packages/engine/src/project/git/index.ts:385 contextFiles` | supplied with a different shape | Engine returns at most 100 flat paths per call (`limit` 1 to 100), filtered by a substring query, with a `truncated` flag and no paging; mock lists the whole tree |
| `listFiles` entries: `size`, `binary`, `image` | Size in the header, "Binary file", "Too large to show", SVG preview | none | missing | The file search returns names only, never size or type |
| `fileText(path)`, `fileBase`, `fileSaves` | The open file's text in the editor | none for a tracked, unchanged file | missing | No request reads an arbitrary file's text; see the Notes for the three partial readers |
| `w.files[]` path and `status` (A, M, R, D) | Change letter on tree rows, "Has changes" dot on folders, header badge, hides deleted files | `project.changes`: `packages/contracts/src/project/git.ts:67`, `GitChange` at `git.ts:13` | supplied with a different shape | Engine gives porcelain `index` and `worktree` codes plus `staged`, `unstaged`, `untracked`, `conflict`; mock has one letter |
| `w.commits[].files[].path` | Adds committed paths to the tree | `project.history` `git.ts:69`, `project.commit.files` `git.ts:70` | supplied with a different shape | Mock pads its fake listing with these; the engine listing already includes tracked files |
| `w.owner` then `agent.state`, `agent.name` | "Builder is working in this worktree" note | `packages/contracts/src/project/schema.ts:45 Workspace.owner`; `packages/contracts/src/client/reads.ts:29 RosterEntry.state` | not checked | `Workspace.owner` is an optional string; what the engine stores in it was not checked |
| `s.settings.gitModel` | "Writes the message with Haiku 5.5" tip | none | missing | `design/mock/js/data.js:329`; no engine setting names a model for Git text |
| `s.conn.status` | Offline state | the WebSocket connection, not an engine field | supplied | The current website uses its own connection state (`packages/web/src/git/GitPage.tsx:27`) |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Open a folder, open a file, search by name | `pick`, `toggle`, `setQ`; no engine call | `project.context.search` `packages/contracts/src/project/commands.ts:38` | supplied with a different shape | Search is supplied, capped at 100 results; reading the opened file is missing |
| Edit and save a file (Save, Ctrl+S) | `saveFile` `files.js:80`; no engine call | none | missing | No request writes a file's text into a worktree |
| Tell the working agent which file was saved | toast text in `saveFile` `files.js:97` | none | missing | |
| Commit one file with a message | `commitFile` `files.js:103`; no engine call | `project.stage` `git.ts:72` then `project.commit` `git.ts:78` | supplied with a different shape | Engine commits everything staged, so other staged files would go in too; there is no single-file commit |
| Generate the commit message | `act.commitMessage` `design/mock/js/actions.js:315`; no engine call | none | missing | No request produces commit text |
| Open in Git | link to `/p/<id>/git` | none needed | supplied | Navigation only |
| Download a file, binary or over 1 MiB | toast only, `files.js:214` and `files.js:226` | none | missing | No request returns file bytes |
| Copy path | clipboard only | none needed | supplied | Browser only |

Notes:

- Every Git and file request refuses a workspace whose `machineId` is not `"local"` (`packages/engine/src/project/gitApi.ts:32` and `:48`). The current website disables Git on other machines for that reason (`packages/web/src/git/GitPage.tsx:98`, `packages/web/src/git/useGitReads.ts:23`). The mock shows files on a remote machine such as "studio".
- `project.context.search` with scope "files" lists tracked and nonignored untracked paths through `git ls-files` (`packages/engine/src/project/git/index.ts:388`). It skips credential paths and any path the redactor would change (`packages/engine/src/project/context.ts:111`). It returns names and identities only, never contents (`packages/contracts/src/project/context.ts:4`, `:31`). The current website uses it for the thread's context picker with `limit: 50` (`packages/web/src/thread/contextPicker.tsx:31`).
- `project.diff` with a `path` returns a unified patch, not file text. For an untracked file it diffs against `/dev/null`, so the patch carries the whole new file (`packages/engine/src/project/git/index.ts:181`), up to the 128 KiB diff limit (`index.ts:44`).
- `project.conflict` returns the full `ours`, `base` and `theirs` text of one conflicted file (`packages/contracts/src/project/git.ts:20`). It only works on a conflicted path.
- `project.mocks.artifact` reads one file only if a recorded mock revision names it as a source (`packages/engine/src/project/mocks.ts:229`). The extension must be `.json`, `.html`, `.css`, `.svg`, `.md` or `.txt` (`packages/engine/src/project/artifacts.ts:24`). The file must be at most 8192 bytes (`artifacts.ts:37`). It is not a general file reader.
- The only engine path that writes a file's text into a worktree is `project.conflict.resolve`. It writes a conflicted file from the chosen sides (`packages/engine/src/project/git/index.ts:603`). No request writes arbitrary text.
- The Files screen reports no call to `design/mock/js/engine.js` for any action.
- View state, not an engine need: the open folders, the selected file in the address, the "Go to file" text, line wrapping, unsaved drafts held in the page, and the phone layout.

### Git

The Git tab is rendered by `GitTab` in `design/mock/js/screens/git.js:708`, with `Changes` (line 551), `History` (line 596), `Conflicts` (line 635), `Integrate` (line 680), `Diff` (line 497), `FileRow` (line 542), `AheadBehind` (line 393) and `Author` (line 383). Its data comes from `seedGit` (line 239), and its actions live in the same file (lines 405 to 483). The "Open merge review" button opens `MergeReview` in `design/mock/js/dialogs.js:139`, which shows `MergeFacts` from `design/mock/js/ui.js:267`.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `worktrees[]` for the project plus the base: `id`, `branch`, `kind`, `repo`, `project`, `team` | Worktree picker, ordered project, team, agent, base | `packages/contracts/src/project/commands.ts:34 ProjectSnapshot.workspaces`; `project.workspaces` `commands.ts:48`; `packages/contracts/src/project/schema.ts:41 Workspace` | supplied with a different shape | Engine has `checkout`, `projectId`, `teamId`; no `kind`, and no marker for a builder's own worktree |
| `w.parent` | "ahead of feat/…", integrate target name | `packages/contracts/src/project/schema.ts:44 Workspace.parentId` | supplied with a different shape | Engine stores the parent worktree id, not the branch name |
| `w.files.length`, `w.merge` in the picker | "3 changed", "Conflict" per row | `project.changes` `packages/contracts/src/project/git.ts:67` called once per worktree | supplied with a different shape | The website reads each row with its own `project.changes` call (`packages/web/src/git/WorktreeNavigation.tsx:28`) |
| `w.owner` then agent name and avatar, `teamName(team)` | Owner beside the picker | `Workspace.owner` `schema.ts:45`; `packages/contracts/src/project/schema.ts:65 Team.name` | not checked | What `Workspace.owner` holds was not checked |
| `w.machine` then `machine.name` | "on Studio" | `Workspace.machineId` `schema.ts:42` | supplied with a different shape | Only an id; no machine name |
| `w.ahead`, `w.behind` | Up and down arrows, "N ahead of parent, M behind" | `project.git.state` `git.ts:71`, `GitState` `git.ts:17` | supplied with a different shape | `ahead` and `behind` count against the remote upstream; with `target` set, `pending` counts commits not on the target; nothing counts commits on the target that are missing here (`packages/engine/src/project/git/index.ts:454`) |
| `w.files[]`: `path`, `status`, `staged`, `oldPath` | Staged and Changes groups, status letter, rename arrow | `project.changes` `git.ts:67`, `GitChange` `git.ts:13` | supplied with a different shape | A file can be both `staged` and `unstaged` in the engine; status comes as porcelain `index` and `worktree` codes; `originalPath` replaces `oldPath` |
| `f.add`, `f.del` | "+12 −3" per file | `project.diff` with `path` `git.ts:68`, `GitDiff.additions`, `.deletions` `git.ts:14` | supplied with a different shape | One extra read per file |
| `f.hunks` with `label`, line numbers | The unified and split diff | `GitDiff.patch` `git.ts:14` | supplied with a different shape | Engine sends raw patch text; the client parses hunks |
| `f.kind === 'binary'`, `f.size` | "Binary file of 18.4 KB" | `GitDiff.binary` `git.ts:14` | supplied with a different shape | No size |
| `f.kind === 'large'` | "Large diff hidden", "Show anyway" | `GitDiff.truncated` `git.ts:14`; limit `packages/engine/src/project/git/index.ts:44` | supplied with a different shape | Engine cuts the patch at 128 KiB by default; there is no way to ask for the rest |
| `w.commits[]`: `hash`, `subject`, `ts` | History list | `project.history` `git.ts:69`, `GitCommit.head`, `.title`, `.at` `git.ts:15` | supplied | Up to 200 commits |
| `commit.author` | Avatar and agent name, or "You" | `GitCommit.author` `git.ts:15` | supplied with a different shape | Engine gives Git's author text, not an agent id |
| `commit.body` | Commit body under the subject | none | missing | `GitCommit` has `title` only |
| `commit.merge` | Merge node in the log | `GitCommit.parents` `git.ts:15` | supplied with a different shape | Two or more parents means a merge |
| `commit.refs` (branch heads, tags such as `v0.4.0`, `SP-01`) | Ref chips on log rows | `project.branches` `git.ts:65` for branch heads | supplied with a different shape | Branch heads only, per repository, owner only; tags are missing |
| `commit.files[]` with status and counts | Files in a commit, each with its diff | `project.commit.files` `git.ts:70`, `GitCommitFile` `git.ts:16`; `project.diff` with `commit` | supplied with a different shape | File list has no counts; counts need a diff read per file |
| `i >= w.ahead` (shared commits) | Faded rows already on the parent | `GitState.pending` `git.ts:17` | supplied with a different shape | Needs `project.git.state` with `target` |
| `w.merge.from`, `w.merge.by`, `w.merge.startedAt` | "Merging X into Y. Lead started it 9 minutes ago" | `GitState.mergeHead` `git.ts:17` | missing | Engine gives only the merge commit hash; who started it and when are missing |
| `w.merge.files[]` with `path`, `resolved` | Conflicted file list and count | `project.changes` `GitChange.conflict` `git.ts:13` | supplied with a different shape | A resolved file stops being a conflict in the engine; there is no per-file "resolved" flag |
| `file.parts[]`: context with `start`, blocks with `ours`, `base`, `theirs` | Three-pane conflict view | `project.conflict` `git.ts:93`, `GitConflict.segments` `git.ts:20` | supplied | Context segments carry `line` |
| `part.choice` | "Using ours" and the Result pane | `GitConflict.choices` `git.ts:19` | supplied with a different shape | The client holds the choices and the engine re-validates them on each `project.conflict.choose` |
| `requests[]` kind `merge` for the project: `status`, `answeredAt`, `project.merged`, `w.merged` | "Waiting for your merge", "Merged … ago" | `project.review.status` `git.ts:88`; `GitMainReview.outcome`, `.decidedAt` `git.ts:41`; events `project.MainReviewOpened`, `project.MainReviewDecided` `packages/contracts/src/project/events.ts:14` | supplied with a different shape | A main review is not a client request; `ClientRequest.kind` is only permission or question (`packages/contracts/src/requests.ts:21`) |
| `r.evidence.tests`, `r.evidence.review` (`ok`, `text`, `value`, `sub`, reviewer) | Tests and Review cells in the merge review | `GitMainReview.evidence` `git.ts:43`, `GitEvidenceSet` `git.ts:38`, `GitEvidence` `git.ts:31` | supplied with a different shape | Engine has `state` (missing, current, stale) and a report with `status`, `summary`, `reportedBy`, thread reference |
| `r.evidence.commits`, `.files`, per-file `+`/`−` | "7 files changed" table | `project.review.prepare` reply `comparison`, `GitReview` `git.ts:26` | supplied with a different shape | Lists capped at 200 with `truncated`; one aggregate diff, no per-file counts |
| `ev.conflicts` | "Into master: no conflicts" | none | missing | Nothing tests a merge before approval |
| `r.brief`, `r.notice` | "You opened this review early", "Users will notice" | none | missing | |
| `s.settings.gitModel` | "Writes … with Haiku 5.5" tips | none | missing | `design/mock/js/data.js:329` |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Pick a worktree | `pick` sets `inspecting` `git.js:725`; no engine call | none needed | supplied | View state; the website holds it as `inspectedWorkspaceId` (`packages/web/src/git/GitPage.tsx:23`) |
| Stage or unstage one file | `stage` `git.js:406`; no engine call | `project.stage` `git.ts:72`, `project.unstage` `git.ts:73` | supplied | Website: `GitPage.tsx:131` |
| Stage all, unstage all | `stage` with every id; no engine call | `project.stage.all` `git.ts:74`, `project.unstage.all` `git.ts:75` | supplied | Engine skips conflicted files (`packages/engine/src/project/git/index.ts:486`) |
| Discard one file or all unstaged files | `discard` `git.js:407` with a confirm; no engine call | `project.discard.plan` `git.ts:76` then `project.discard` `git.ts:77` with `confirmed: true` | supplied with a different shape | Two steps: the plan's fingerprint must still match (`index.ts:493`); website `GitPage.tsx:146` |
| Commit staged files | `doCommit` `git.js:415`; no engine call | `project.commit` `git.ts:78` | supplied | Engine refuses with conflicts or nothing staged (`index.ts:505`); website `GitPage.tsx:220` |
| Generate the commit message | `act.commitMessage` `actions.js:315`; no engine call | none | missing | |
| Choose unified or split diff | `setMode` | none needed | supplied | View state |
| Select a commit, fold a commit file | `setUi`, `setClosed` | `project.commit.files` `git.ts:70`, `project.diff` with `commit` `git.ts:68` | supplied | Website `packages/web/src/git/useGitReads.ts:98` |
| Copy a commit hash | clipboard only | none needed | supplied | |
| Fetch, pull, push | no control in the mock | `project.fetch` `git.ts:79`, `project.pull` `git.ts:80`, `project.push` `git.ts:81` | supplied | The mock has no buttons; the website has them (`GitPage.tsx:213`); pull is fast-forward only from the remote upstream (`index.ts:514`) |
| Update from base | `updateFromBase` `git.js:425`; no engine call | none | missing | No request merges the parent branch into this worktree; `project.pull` only fast-forwards from the remote |
| Integrate a team worktree into the project branch | `integrate` `git.js:434`; no engine call | `project.integrate` `git.ts:82`; handler `packages/engine/src/project/gitCommands.ts:74` | supplied | Needs `destinationId` and `expectedHead`; website `GitPage.tsx:192` |
| Integrate a builder's worktree into the team branch | `integrate` on a `kind: 'agent'` worktree | `project.integrate` `git.ts:82` | missing | The handler refuses any source that is not a registered team worktree (`gitCommands.ts:82`) |
| Open the merge review for the project branch | `openReview` `git.js:449` creates a request; no engine call | `project.review.prepare` `git.ts:86`, `project.review.status` `git.ts:88` | supplied with a different shape | Engine records a review of exact heads; the target must be `main` or `master` (`index.ts:553`); website `GitPage.tsx:163` |
| Approve and merge, or approve without evidence | `act.answerRequest(r.id, 'merge')` `dialogs.js:155`, which reports `integrate` (`actions.js:156`) | `project.review.approve` `git.ts:90` with `decision` `git.ts:40` | supplied with a different shape | The mock reports the tag `integrate`, but the real call is `project.review.approve` with `reviewId`, `expectedHead`, `expectedBaseHead`, `confirmed`; website `GitPage.tsx:198` |
| Edit and generate the pull request title and description | `act.pullRequestText` `actions.js:323`, `regen` `dialogs.js:151` | none | missing | No request generates pull request text, and nothing opens a pull request (`packages/engine/src/project/git/README.md:96`) |
| Choose ours, theirs or both for a conflict | `choose` `git.js:464`; no engine call | `project.conflict.choose` `git.ts:94` | supplied | It validates and returns the new choices; it does not write; website `packages/web/src/git/ConflictPane.tsx:32` |
| Mark a file resolved | `markResolved` `git.js:467`; no engine call | `project.conflict.resolve` `git.ts:95` | supplied with a different shape | Engine writes the file and unstages it, so the owner must stage it before continuing (`index.ts:603`); website `ConflictPane.tsx:273` |
| Reopen a resolved file | `markResolved(…, false)` | none | missing | After resolve the file is written and no longer conflicted |
| Continue the merge | `continueMerge` `git.js:468`; no engine call | `project.commit` `git.ts:78` | supplied with a different shape | Engine allows a commit with a merge head and no conflicts (`index.ts:509`); there is no separate continue request |
| Abort the merge | `abortMerge` `git.js:478`; no engine call | none | missing | No request runs a merge abort |

Notes:

- The Git screen reports no call to `design/mock/js/engine.js` except through `act.answerRequest`, which reports `integrate` or `review.report` for a merge request (`design/mock/js/actions.js:156`). Those tags lack the `project.` prefix. `project.review.report` records test or review evidence (`packages/contracts/src/project/git.ts:84`); it is not a way to send a merge back.
- No Git state is pushed as events. The only Git events are `project.GitAttempted`, `project.GitFinished`, `project.GitEvidenceReported`, `project.MainReviewOpened` and `project.MainReviewDecided` (`packages/contracts/src/project/events.ts:9` to `:15`). The website re-reads Git on focus and after each action (`packages/web/src/git/GitPage.tsx:77`, `useGitReads.ts:27`).
- Every Git request refuses a workspace that is not on the `"local"` machine (`packages/engine/src/project/gitApi.ts:32`).
- `project.branches`, `project.checkouts`, `project.repository.discover`, all staging, discard, commit, fetch, pull, push, integrate, conflict choices and approval are owner only (`packages/contracts/src/project/git.ts:99`). Reads of changes, diff, history, state, review and conflicts are open to agents as well.
- `project.integrate` refuses a dirty or merging destination or source and a moved source head (`packages/engine/src/project/git/index.ts:527`). It refuses `main` and `master` as targets with `base_requires_review` (`index.ts:532`).
- `project.review` (`git.ts:83`) compares the worktree against a named base without recording anything. The website uses `project.review.prepare` instead.
- View state, not an engine need: the open tab (Changes, History, Conflicts), the commit message while typed, the selected file or commit, folded commit files, the diff mode, and the phone layout.

### Project settings

Project settings is rendered by `ProjectSettings` in `design/mock/js/screens/service.js:613` to the end of the file. It changes the store directly through `set`, `saveAsg`, `setPerm` and `setTeam`. Only archive and restore go through `design/mock/js/actions.js`.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `project.name` | Name | `packages/contracts/src/project/schema.ts:49 Project.name` | supplied | |
| `project.prefix` | Task label prefix tag | none | missing | `Project` has no prefix field |
| `project.goal` | Goal text box | `packages/contracts/src/project/schema.ts:49 Project.goal` | supplied | |
| `project.archived` | "Archived" badge and callout | `packages/contracts/src/project/schema.ts:51 Project.archivedAt`, `.archiving` | supplied with a different shape | Engine has a time and an "archiving unfinished" flag |
| `repo.name`, `repo.remote` | Repository link and remote | `packages/contracts/src/project/schema.ts:38 Repository.name` | supplied with a different shape | No remote address |
| `project.base`, branch choices | Base branch picker | `project.branches` `packages/contracts/src/project/git.ts:65` for choices | missing | No setting stores a base branch; the engine merges only into `main` or `master` (`packages/engine/src/project/git/index.ts:553`) |
| `project.branch` | Project branch | `Project.worktreeId` `schema.ts:50` then `Workspace.branch` `schema.ts:42` | supplied with a different shape | Found through the project's workspace; the website does this (`packages/web/src/admin/project-settings.tsx:37`) |
| `project.folder` | Folder | `Workspace.path` `schema.ts:42` | supplied with a different shape | Same lookup |
| `project.machine`, `machines[]` with `name`, `status` | "Runs on" picker, offline error | `Project.machineId` `schema.ts:50` | supplied with a different shape | Only the id; no machine list or status |
| `lead.subscription`, subscription choices, `signedIn`, `usage.pct` | Lead subscription picker | `packages/contracts/src/client/reads.ts:35 RosterEntry.account`; `accounts` list `packages/contracts/src/commands.ts:111`; `ClientSnapshot.accounts[].status` `reads.ts:51` | supplied with a different shape | No usage percentage; account `status` is a free string |
| `lead.model`, `lead.effort`, choices | Lead model and effort pickers | `RosterEntry.model`, `.effort` `reads.ts:36`; `client.agent.configuration` `packages/contracts/src/client/commands.ts:25` | supplied | Choices come per agent from `AgentChoices` |
| `agent.permission` for every project agent | Permission picker | `RosterEntry.permission` `reads.ts:38` | supplied | |
| `project.tests`, `project.agentReview`, `project.removeCredits` | Three switches | none | missing | |
| `project.assignment` (`state`, `rows` per work kind Plan, Build, Review, Test with harness, model, effort, `changed`) | Assignment table, "Proposed by the project lead" | none | missing | The nearest field is `ProjectSettings.lead` (`schema.ts:36`), one service-wide lead default for new projects |
| Signed-in harnesses | Disabled options in the table | `ClientSnapshot.accounts` `reads.ts:50`; `harnesses` list `packages/contracts/src/commands.ts:132`, models and efforts `packages/contracts/src/harnesses.ts:36` | supplied with a different shape | |
| `teams[]`: name, branch | Teams table | `ProjectSnapshot.teams` `packages/contracts/src/project/commands.ts:35`; `Team.name`, `.worktreeId` `schema.ts:66` | supplied with a different shape | Branch through the team's workspace |
| Team agents | Avatars per team | `RosterEntry.groups` `reads.ts:30` matched to `Team.group` `schema.ts:68` | supplied with a different shape | The website does this match (`packages/web/src/shell/model.ts:20`) |
| `team.needToKnow` | Need-to-know switch | none | missing | |
| Running agents, open requests | Archive confirm list | `ClientSnapshot.agents[].state` `reads.ts:45`; `ClientSnapshot.requests` `reads.ts:48` | supplied | |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Rename the project | `rename` `service.js:622`; no engine call | `project.rename` `packages/contracts/src/project/commands.ts:58`; handler `packages/engine/src/project/commands.ts:133`; event `project.Renamed` `packages/contracts/src/project/events.ts:32` | supplied | Engine refuses a name already used in the repository; website `project-settings.tsx:62` |
| Save the goal | `set({ goal })` `service.js:655`; no engine call | `project.goal.set` `commands.ts:55`; handler `packages/engine/src/project/commands.ts:292`; event `project.GoalChanged` `events.ts:26` | supplied | Whether the lead is told was not checked; website `project-settings.tsx:63` |
| Change the base branch | `set({ base })` `service.js:662` | none | missing | |
| Change the machine | `set({ machine, folder })` `service.js:666` | `project.place` `commands.ts:59` | missing | The handler refuses any change of worktree or machine "before machine pairing" (`packages/engine/src/project/commands.ts:143`) |
| Change the lead's subscription | inline `update` `service.js:671` | none | missing | `configure` changes only model and effort; nothing moves an agent to another account |
| Change the lead's model or effort | inline `update` `service.js:673`, `:676`; no engine call | `configure` `packages/contracts/src/commands.ts:68`; handler `packages/engine/src/commands/configuration.ts:27` | supplied | The mock's `act.setAgentConfig` reports `configure`, but this screen does not use it |
| Set the permission for every agent | `setPerm` `service.js:645` | none | missing | Permission is set only at `start` (`commands.ts:60`) |
| Toggle tests first, agent review, remove agent credits | `set` `service.js:685` to `:687` | none | missing | |
| Edit an assignment row, apply one model to every row, approve the table | `setRow`, `applyAll`, `approve` `service.js:637` to `:644` | none | missing | `project.settings.set` (`commands.ts:41`) stores only service-wide lead defaults, not a per-project table |
| Toggle a team's need-to-know | `setTeam` `service.js:646` | none | missing | |
| Archive | `act.archiveProject` `actions.js:240`, reports `archive` | `project.archive` `commands.ts:56`; planner `packages/engine/src/project/lifecycle.ts:267`; event `project.Archived` `events.ts:28` | supplied | The engine stops the agents first and refuses while one still runs; website `project-settings.tsx:149` |
| Restore | `act.archiveProject(p.id, false)`, reports `restore` | `project.restore` `commands.ts:57`; handler `packages/engine/src/project/commands.ts:296`; event `project.Restored` `events.ts:29` | supplied | Refused while archiving is unfinished |
| Delete the project | `del` `service.js:626` | none | missing | |

Notes:

- `project.settings` and `project.settings.set` (`packages/contracts/src/project/commands.ts:40`, `:41`) take no `projectId`. They hold service-wide `ProjectSettings`: the workspace folder, the default shell, the default lead harness, account, model, effort and permission, and a display name (`packages/contracts/src/project/schema.ts:32` to `:36`). They do not serve this per-project screen.
- `project.preferences.set` (`commands.ts:60`) sets the project's preferred shell, stored as `Project.shell` (`schema.ts:51`). The current website offers it (`packages/web/src/admin/project-settings.tsx:141`). This mock screen has no shell control.
- The mock reports `archive` and `restore` without the `project.` prefix (`design/mock/js/actions.js:241`).
- The current website reads the project with `project.read` and collection `projects` (`packages/web/src/admin/project-settings.tsx:41`), and links to a machines page to change placement (`project-settings.tsx:138`).
- View state, not an engine need: the goal draft before saving, the "Every row" model picker before Apply, and the "Saved" marker.

### Repository design page

`design/mock/js/screens/design.js` renders this page with `RepoDesign` (line 263) and `DesignCanvas` (line 302), at `#/r/lgtm/design` and `#/r/<repository>/design/<category>/<item>`.
The sheets are `FlowSheet` (line 179), `ComponentSheet` (line 190) and `PaletteSheet` (line 199).
The sample record is `state.design.lgtm` in `seedMocks` (`mocks.js:171-173`).
The flows (`FLOWS`, line 56), component groups (`GROUPS`, line 73) and file colours (`FILE_COLORS`, line 86) are fixed in `design.js`.
The palette values are read from the mock's own `css/tokens.css` (`useTokens`, line 94).
The current page shows the engine's design record in `packages/web/src/project/design.tsx`.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Repository (`repo.id`, `repo.name`) | Page address, and the name in "Create design file" | `schema.ts:38 Repository` | supplied | |
| Projects of the repository | "Projects 3" tab count | `schema.ts:49-51 Project.repoId`, `.archivedAt` | supplied | |
| Whether `state.design[repo]` exists | The file's canvas, or the empty structure with "Create design file" | `packages/contracts/src/project/design.ts:33 project.design.read`, result `unavailable` or `registered` (`design.ts:22-24`) | supplied | the current page shows "No design is registered" for `unavailable` (`packages/web/src/project/design.tsx:31`) |
| `design.file` | "design/lgtm.fig" | `design.ts:12 DesignRegistration.file` in `RepositoryDesign` (`design.ts:17`) | supplied | |
| `design.changedAt` | "52 min ago" | `design.ts:18 RepositoryDesign.at` | supplied | the time of registration, not of the last edit to the file |
| `design.changedBy` | "Designer" | `design.ts:18 RepositoryDesign.author` | supplied | |
| `design.size`, `.pages`, `.frames`, `.commit` | Held in the record; size, pages and frames are not drawn | none | missing | the engine keeps a fingerprint (`design.ts:18 fileFingerprint`), not a size, page count or commit |
| Screens category: `FLOWS` frames, names and addresses | Flow sheets of live frames, each a page of the site | none | missing | the design record has no screens or frames |
| Components category: `GROUPS` names and groups | Component sheets and the group menu | `design.ts:10 DesignComponent.name`, `.reference`; `design.ts:26` `components` with `availability` | supplied with a different shape | registered components have no group; at most 64 |
| Component flag "In the file" or "Only in code" | Flag on each component | `design.ts:26 availability` (`available` or `unavailable`) | supplied with a different shape | the engine tells whether the component file still matches its fingerprint, not whether it is in the design file |
| Component variants (`file.rows`, `cols`, `prop`) | Variant grid such as Kind by State | `design.ts:11 DesignComponent.variants` | supplied with a different shape | one optional name string, not a grid |
| Component demo | Live demo of each component | `display.ts:9 DisplayOpen` `component` via `POST /api/display/open` | supplied with a different shape | the engine serves the component's own HTML or SVG file in an isolated frame (`packages/engine/src/project/display.ts:94-120`), as the current page does at `design.tsx:42-43` |
| Palette tokens: Colour, Type, Space and density, Shape, Motion | Token tables with Field and Dusk values and Compact and Regular density | `design.ts:16 DesignTokens` in the `registered` result (`design.ts:25`) | supplied with a different shape | one value per token name, at most 64 tokens from one JSON file of 8 kilobytes (`packages/engine/src/project/design.ts:28`); no light and dark pair, no density pair, no categories |
| Colour "Design file" column (Matches, Retuned in code, Only in code) | Comparison of each colour with the design file | none | missing | the engine does not compare the file's colours with code |
| Icons | Icon sheet | none | missing | |
| Item counts in the two menus | "7 frames", "12 components", "31 tokens" | as the rows above | supplied with a different shape | counts follow from the shapes above; flows have none |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Create design file (the empty structure) | `create`: local record `design/<name>.fig` and a toast; no engine call | `design.ts:31 project.design.record` | missing | no request writes a design file; `project.design.record` only registers a file that already exists in a project worktree, with a `.fig`, `.pen` or `.json` name (`packages/engine/src/project/design.ts:67`), and it needs a `projectId` |
| Save the design file into the repository | No separate action; `create` stands in, and the record holds a `commit` | none | missing | no request saves design bytes; the editor's folder is mounted read-only (`packages/engine/src/client/web/display/openPencil.ts:32`), so edits in OpenPencil cannot reach the repository |
| Open in OpenPencil | `act.toast('Opening <page> in OpenPencil')`; no engine call | `display.ts:10 DisplayOpen` `editor` (`repoId`, `revisionId`, `projectId`) via `POST /api/display/open` (`server.ts:161`), checked by `packages/engine/src/project/display.ts:53` | supplied with a different shape | opens the whole file, with no page selection; needs a `.fig` or `.pen` file inside its own folder, not the repository root (`display.ts:64`, `:73`); needs the display origin set up; read-only |
| Close the editor | Not in the mock | `display.ts:13 DisplayClose` via `POST /api/display/close` (`server.ts:161`) | supplied | the current page closes frames at `packages/web/src/project/display.tsx:32` |
| Pick a category and an item | `to(cat, item)`: changes the address; no engine call | `design.ts:33 project.design.read` | supplied with a different shape | categories come from the mock's fixed lists |

Notes:

- The owner may read a repository's design without naming a project (`packages/engine/src/project/design.ts:110`).
- The engine's design record belongs to a project's worktree, even though the page is per repository (`design.ts:12 DesignRegistration.worktreeId`, `design.ts:17 RepositoryDesign.projectId`).
- Every display open is owner-only (`packages/engine/src/project/display.ts:26`, `:54`, `:95`).
- View state, not an engine need: the zoom, Fit, the canvas scroll position, and the focused frame.

### Machines

The page is `Machines` in `design/mock/js/screens/service.js:139`. Each row opens
`MachineDetail` (`service.js:97`). "Add machine" opens `PairMachine` (`service.js:181`).
"Add repository" opens `AddRepository` (`service.js:213`). The machine fields come from
`seed()` in `design/mock/js/data.js:52` and from `seedService` in `service.js:12-20`.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `machines[]` (the list), `machine.id`, `machine.name` | One row for each machine, with its name | none; `packages/engine/src/project/gitApi.ts:32` accepts only `"local"` | missing | The engine has no machine list and no machine name. |
| `machine.here` | The "This computer" badge | none | missing | Only one machine exists, so the badge has no engine source. |
| `machine.role` (`master` or `worker`) | The Role column | none | missing | No role is recorded. |
| `machine.status` (`online`, `offline`, `pairing`), `machine.lastSeen`, `machine.connectedFor` | The Status column, "Last seen", "Connected", and the offline and pairing callouts | none | missing | No machine status exists. The page's own WebSocket state is the only liveness signal. |
| `machine.address` | The Address column | `packages/contracts/src/client/settings.ts:19 WebSettings.port` | supplied with a different shape | The engine gives only the web port. It gives no machine address. |
| `machine.workspace` | "Workspace" in the detail | `packages/contracts/src/project/schema.ts:36 ProjectSettings.workspaceFolder`, read by `project.settings` (`packages/contracts/src/project/commands.ts:40`) | supplied with a different shape | The engine has one workspace folder for the service, not one for each machine. |
| `machine.os`, `machine.cores`, `machine.ram` | "System" in the detail | none | missing | |
| `machine.cpu`, `machine.mem` | The CPU and Memory meters | none | missing | |
| `machine.version` and the "older than the service" warning | "LGTM Studio" in the detail | none | missing | No request reports a version. |
| `machine.slots.limit`, `machine.slots.used` | "Agents n of limit" and the "Agent limit" field | none | missing | The current website shows a count of `capacityHeld` agents as held slots (`packages/web/src/admin/machines.tsx:20-28`). That flag means a provider was at capacity (`packages/engine/src/routing/deliveries.ts:246`). It is not a machine slot. |
| `machine.harnesses[h]` (an installed version per harness) | The Harnesses column, "Codex missing", and install commands in the detail | `packages/contracts/src/project/mocks.ts:50 DiscoveryHarness.installed`, read by `project.setup.discover` (`mocks.ts:63`) | supplied with a different shape | The engine reports installed or not installed for this computer only. It reports no version. |
| Signed-in count per harness | "n signed in" in the detail | `packages/contracts/src/project/mocks.ts:48 DiscoveryAccount.state` | supplied with a different shape | The engine reports a readiness state for each account, such as `local-credential` or `signed-out`. The page would count them. |
| `repos[].folders[machine.id]` | "Repositories" in the detail, each with its folder | `packages/contracts/src/project/schema.ts:38 Repository.path`; `project.RepositoryLocated` (`packages/contracts/src/project/events.ts:20`) | supplied with a different shape | The snapshot holds one path for each repository. Locations for each machine arrive only as events. |
| Projects on the machine, with "n worktrees · n of n running" | "Worktrees and agents" in the detail | `packages/contracts/src/project/schema.ts:48 Project.machineId`; `:41 Workspace.projectId`; `packages/contracts/src/client/reads.ts:33 RosterEntry.state` | supplied | The page derives the counts. Agents join projects through `ProjectAgentSummary` (`packages/contracts/src/project/commands.ts:31`). |
| Running agents with a status word | The agent list in the detail | `packages/contracts/src/client/reads.ts:29 RosterEntry` (`name`, `role`, `state`, `displayedState`) | supplied | The status word comes from `displayedState` and the open request counts. |
| `settings.port`, master name | The `lgtm connect` command in the pairing dialog | `client/settings.ts:19 WebSettings.port`; no machine name | supplied with a different shape | The port exists. The master's host name does not. |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Add a machine with a one-time pairing code | `PairMachine`, `confirm` (`service.js:189-195`); no call | none | missing | The engine has no pairing. `packages/engine/src/project/README.md:83` says no remote machine is accepted before pairing is built. |
| Rename a machine | Row menu "Rename" (`service.js:167`); no call | none | missing | |
| Scan harnesses again | Row menu (`service.js:168`); no call | `project.setup.discover` (`packages/contracts/src/project/mocks.ts:63`) | supplied with a different shape | Discovery reads this computer's harnesses again. It cannot scan another machine. |
| Try to reconnect an offline machine | Row menu (`service.js:170`); no call | none | missing | |
| Remove a machine | `remove` (`service.js:142-146`); no call | none | missing | |
| Change the agent limit | `Num` in the detail (`service.js:113`); no call | none | missing | |
| Add a repository on a machine | `AddRepository`, `add` (`service.js:229-237`); no call | `project.repository.add` (`packages/contracts/src/project/commands.ts:42`), payload `name`, `path`, `machineId` | supplied | The handler accepts only `machineId: "local"` (`packages/engine/src/project/commands.ts:67-69`). The current website uses it in `packages/web/src/project/registration.ts:100`. |
| Add a known repository to another machine | `AddRepository` with `d.repo` set (`service.js:231-232`); no call | `project.repository.locate` (`packages/contracts/src/project/commands.ts:43`) | supplied with a different shape | The request exists, but only the local machine is accepted (`gitApi.ts:32`). |
| See the base branch, remote and clean state before adding | `found` in `AddRepository` (`service.js:221-225`, `:247-251`) | `project.branches` (`packages/contracts/src/project/git.ts:65`) gives `GitBranch.current` and `upstream` | supplied with a different shape | `project.branches` needs a `repoId`, so it works only after registration. No request reports a remote address or a clean working tree for an unregistered folder. |
| Open the New project dialog after adding | `d.back` in `AddRepository` (`service.js:236`) | none needed | supplied | This is navigation between dialogs. |

Notes: Which machine row is open is view state. The current website's Machines page says
that pairing, remote machines and remote dispatch are not available yet
(`packages/web/src/admin/machines.tsx:30`).

### Subscriptions

The page is `Subscriptions` in `service.js:307`. Each subscription is a `SubRow`
(`service.js:265`), and its status word comes from `subState` (`service.js:257`). "Add
subscription" opens `AddSubscription` (`service.js:328`). "Sign in" opens `SignIn` in
`design/mock/js/dialogs.js:177`. The New project dialog reuses `SubscriptionTable`
(`dialogs.js:91`). The subscription fields come from `data.js:57-62` and `service.js:22-32`.
The current website's page is `packages/web/src/admin/subscriptions.tsx`. It reads
`accounts` with `list`, `client.snapshot` and `harnesses` with `list` (lines 31-33).

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `subscriptions[]`, `sub.id`, `sub.harness`, `sub.name` | One row for each subscription, grouped by harness | `accounts` with `operation: "list"` (`packages/contracts/src/commands.ts:111`), returning `Account` (`packages/contracts/src/accounts.ts:18`: `id`, `harness`, `displayName`) | supplied | The mock's `name` is the engine's `displayName`. |
| `sub.machine` | The machine name under each subscription | none | missing | Accounts belong to no machine. |
| `sub.account` (an email address) | "owner@example.com" under each name | none | missing | `Account` holds no email address. `Account.home` (`accounts.ts:22`) is a login folder, not an identity. |
| `sub.enabled` | "Turned off" status, the dimmed row | `packages/contracts/src/accounts.ts:25 Account.enabled`; `client/reads.ts:50` snapshot `accounts[].enabled` | supplied | |
| `sub.signedIn` | "Signed out" status, the Sign in button, the warning note | `packages/contracts/src/client/reads.ts:50` snapshot `accounts[].status`; `project/mocks.ts:48 DiscoveryAccount.state` | supplied with a different shape | The snapshot status is `available`, `out-of-usage` or `needs-sign-in` (`packages/engine/src/views/apply.ts:97`). It turns to `needs-sign-in` only after a turn fails (`packages/engine/src/routing/deliveries.ts:256-259`). Discovery checks for a local credential instead (`packages/engine/src/project/leadDefaults.ts:26-60`). |
| `sub.window.pct`, `sub.window.resetsAt` | The "5 hours" meter and "Resets in" | `AccountOutOfUsage.resetAt` (`packages/contracts/src/events.ts:249`) | supplied with a different shape | The engine knows only that an account ran out, and sometimes when it resets. It has no percentage. The snapshot's `accounts[]` row drops `resetAt` (`packages/engine/src/api/snapshot.ts:58-61`), so the reset time arrives only on the event. |
| `sub.usage.pct`, `sub.usage.resetsAt` (weekly) | The "This week" meter | none | missing | The current website shows "Not reported" (`packages/web/src/admin/subscriptions.tsx:106`). |
| `subState(sub).word` "Limit reached", "Near its limit" | The status word and the limit note | `events.ts:249 AccountOutOfUsage`, `:250 AccountAvailable` | supplied with a different shape | "Limit reached" matches `out-of-usage`. "Near its limit" needs a percentage, which is missing. |
| `sub.useForNew` | The "Default" badge and "Use for new agents on machine" | `packages/contracts/src/project/schema.ts:32 ProjectLeadDefaults.account` in `ProjectSettings.lead` | supplied with a different shape | The engine has one named or "any" account for project leads, for the whole service. It has no default for each harness and machine. The current website labels `enabled` as "Use for new work" (`subscriptions.tsx:108-109`). |
| `sub.model` | "Model for new agents" select | `packages/contracts/src/harnesses.ts:31 HarnessSettings.defaultModel`; `schema.ts:32 ProjectLeadDefaults.model` | supplied with a different shape | The engine keeps a default model for each harness and one for leads. It keeps none for each account. |
| Agents on the subscription, with "n running" and each agent's model, effort and status | The Agents column and the expanded list | `packages/contracts/src/client/reads.ts:35 RosterEntry.account`, with `model`, `effort`, `state` | supplied | |
| `HARNESSES[h].name`, `.runMode`, `.models` | The harness heading, "ACP mode", the model list | `harnesses` with `list` (`commands.ts:132`); `harnesses.ts:24 HarnessSettings` (`id`, `runMode`, `models`) | supplied with a different shape | The engine names a harness by its identifier, such as `claude`. It has no display name such as "Claude Code". |
| `settings.capacityBackoff` | "try again every n minutes" in the limit note | `packages/contracts/src/roles/schema.ts:18 RoleLimits.capacityBackoffMinutes`, read by `roles.settings.get` (`packages/contracts/src/roles/commands.ts:28`) | supplied | |
| `SubscriptionTable` rows: harness, name, machine, "signed out", "n% used", models | The lead picker in New project | the sources above | supplied with a different shape | The machine and the percentage are missing, as above. |
| `SignIn`: the harness's login command, a device code, "Signed in as" an address | The sign-in terminal | none | missing | The engine runs no sign-in program and reports no device code. |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Add a subscription | `AddSubscription`, `add` (`service.js:334-336`); no call | `accounts` with `operation: "add"` (`commands.ts:114`; handler `packages/engine/src/commands/accounts.ts:48-57`) | supplied with a different shape | The engine needs a client-made account `id`. The mock picks a machine, which the engine lacks. The engine does not check that a name is unique. The current website does this in `subscriptions.tsx:70-75`. |
| Sign in through the harness's own login | `SignIn`, `done` (`dialogs.js:182-186`); no call | none | missing | The engine can point an account at an existing login folder through `Account.home`, or store an API key through `accounts set-secret` (`commands.ts:119`). Neither runs a login. The current website says provider sign-in is not available yet (`subscriptions.tsx:113`). |
| Tell paused agents that the account works again | `SignIn` with `d.then`, which calls `answerRequest(d.then, 'resume')` and reports `resume` (`actions.js:157`) | `accounts mark-available` (`commands.ts:129`; handler `packages/engine/src/commands/accounts.ts:85-88`); `resume` (`commands.ts:101`) | supplied with a different shape | The mock resumes one agent. `accounts mark-available` with cause `owner cleared` returns every agent paused on that account (`packages/engine/src/accounts/available.ts:26-28`). |
| Sign out | `signOut` (`service.js:269-271`); no call | none | missing | No request removes a login. |
| Use for new agents on this machine | `makeDefault` (`service.js:268`); no call | `project.settings.set` with `lead.account` (`packages/contracts/src/project/commands.ts:41`) | supplied with a different shape | The engine choice is one service-wide lead account, not one for each harness and machine. |
| Turn off | Row menu (`service.js:292`); no call | `accounts` with `operation: "disable"` (`commands.ts:115`) | supplied | |
| Turn on | Row menu (`service.js:292`); no call | `accounts` with `operation: "set"` and `enabled: true` (`commands.ts:114`) | supplied | |
| Rename | Row menu (`service.js:293`); no call | `accounts` with `operation: "set"` and a new `displayName` | supplied | |
| Remove | `remove` (`service.js:272-274`); no call | `accounts` with `operation: "remove"` (`commands.ts:115`) | supplied | The current website warns that removal does not sign out or stop agents (`subscriptions.tsx:130`). |
| Change "Model for new agents" | the select in `SubRow` (`service.js:285`); no call | `harnesses` with `operation: "set"` and a new `defaultModel` (`commands.ts:135`) | supplied with a different shape | The engine's default belongs to the harness, not the account. |
| Clear a usage limit by hand | no mock control | `accounts mark-available` (`commands.ts:129`) | supplied | The mock has no control for this request. |

Notes: The expanded row is view state. Account events arrive on the stream as
`AccountChanged`, `AccountNeedsSignIn`, `AccountOutOfUsage` and `AccountAvailable`
(`packages/contracts/src/events.ts:247-250`), and `HarnessChanged` (`events.ts:251`). The
mock's foot note says LGTM Studio never sees the password. That holds for a login folder.
It does not hold for `accounts set-secret`, which stores an API key in the engine's secret
store (`packages/engine/src/commands/accounts.ts:73-79`).

### Notifications

The page is `Notifications` in `service.js:388`. Its form is `NtfyForm` (`service.js:363`),
and "Send a test" runs `sendTest` (`service.js:357`). The offer on Home is `PhoneOffer` in
`design/mock/js/screens/home.js:30`. The list comes from `seedService` (`service.js:35-37`),
and the settings from `data.js:326` and `service.js:40-41`. The current website splits this
across `packages/web/src/admin/alerts.tsx` (the list), `packages/web/src/admin/settings.tsx`
(carrier, token, push kinds and test), and `packages/web/src/admin/notification-prompt.tsx`
(the offer).

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `settings.ntfyServer`, `settings.ntfyTopic` | The form fields, "Sending to topic", "Not set up" | `client.alerts.settings` (`packages/contracts/src/client/commands.ts:68`), field `carrier` (`packages/contracts/src/client/alerts.ts:40 CarrierSettings`, `ntfy` with `server` and `topic`) | supplied | |
| `settings.ntfyToken` | The token field, with a show and hide button | `client/alerts.ts:65 AlertSettings.tokenSet` | supplied with a different shape | The engine never returns the token. It reports only whether one is set. The mock fills the field with the saved value and can reveal it. |
| `settings.notifyOn[kind]` for `question`, `approval`, `merge`, `failed`, `sprint` | "Notify me when" switches | `AlertSettings.kinds[]` with `kind` and `push` (`client/alerts.ts:65`); kinds at `client/alerts.ts:10` | supplied with a different shape | The engine has 12 kinds: `approval`, `question`, `failure`, `account`, `other`, `client.web-down`, `board.post`, `board.no-answer`, `roles.stall`, `roles.replace`, `roles.runaway`, `roles.rule-first-use`. It has no `merge` kind and no `sprint` kind. |
| `settings.quiet.on`, `.from`, `.to`, `.failed` | "Quiet hours" | none | missing | |
| `notifications[]`, `n.id`, `n.ts`, `n.title`, `n.kind` | Rows in "Recent notifications", grouped by day | `client.alerts.list` (`client/commands.ts:56`), returning `Alert` (`client/alerts.ts:56`: `alertId`, `raisedAt`, `title`, `kind`); also `ClientSnapshot.alerts` (`client/reads.ts:54`) | supplied with a different shape | Alert titles are fixed phrases for each kind (`client/alerts.ts:16-23`), such as "A question needs your answer". The mock's titles are the request's own words. |
| `n.read`, unread count | The unread dot, "n unread", "Mark all read" | `Alert.status` `open` or `cleared` (`client/alerts.ts:60`) | supplied with a different shape | The engine has no read flag. An alert clears when its cause ends or when the owner dismisses it. |
| `n.delivery` (`sent`, `off`, `failed`, `quiet`, `muted`), `n.error` | The Delivery column and its tooltip | `Alert.delivery` (`client/alerts.ts:50 AlertDelivery`): `delivered` or `failed`, with `reason`, `final`, `attempt`, `generation` | supplied with a different shape | The engine has no `quiet` or `muted` state. Its failure reason is one of three fixed phrases (`client/alerts.ts:48`), not free text. |
| `n.request`, `n.to` | The row's link to the thread or the sprint | `Alert.subject` (`client/alerts.ts:26`: `permission`, `question`, `agent`, `account`, `piece`) | supplied with a different shape | A sprint link is missing because no sprint kind exists. |
| `n.agent`, `n.project`, and the request's answer | "From" column: agent, project, answer | `Alert.agentId`; the project through `ProjectAgentSummary` (`packages/contracts/src/project/commands.ts:31`); the answer through `ClientRequest.answer` (`packages/contracts/src/requests.ts:27`) | supplied with a different shape | The page joins three sources. |
| Count of failed deliveries | The red count beside "Notifications" in the sidebar | `Alert.delivery.status` in `ClientSnapshot.alerts` | supplied | |
| `phoneOffer` (`open` or `declined`) and "no carrier" | The offer on Home and the callout on this page | `AlertSettings.pushPromptDismissed` and `carrier._tag === "none"` (`client/alerts.ts:65-67`) | supplied with a different shape | The engine stores the dismissal for the service. The mock stores it in the browser (`actions.js:196`). The current website shows the offer only while an owner request is open (`packages/web/src/admin/notification-prompt.tsx:18-27`). The mock shows it always. |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Turn on, or save the server and topic | `save` in `NtfyForm` (`service.js:370`); no call | `client.alerts.carrier.set` (`client/commands.ts:70`) | supplied | |
| Save the access token | the same `save`, which stores `ntfyToken` | `client.alerts.carrier.set-token` (`client/commands.ts:71`), payload `origin`, `nonce`, `value` | supplied with a different shape | The token is a separate, write-only request. It needs an `origin` and a `nonce`. The current website sends it in `packages/web/src/admin/settings.tsx:151`. |
| Turn off notifications | `off` (`service.js:371`); no call | `client.alerts.carrier.set` with `none`, and `client.alerts.carrier.clear-token` (`client/commands.ts:70`, `:76`) | supplied | Two requests replace one. |
| Send a test | `sendTest` (`service.js:357-362`); no call | `client.alerts.test` (`client/commands.ts:64`; handler `packages/engine/src/commands/notifications.ts:20-29`) | supplied with a different shape | The engine replies `accepted` and an optional reason. It adds no row to the alert list. The mock adds a "Test" row. |
| Retry a failed delivery | `retry` (`service.js:393`); no call | `client.alerts.retry` (`client/commands.ts:60`), payload `alertId`, `generation`, `attempt` | supplied | The current website keeps the request id to recover an uncertain retry (`packages/web/src/admin/alerts.tsx:35-54`). |
| Switch a kind on or off | `setOn` (`service.js:394`); no call | `client.alerts.settings.set` (`client/commands.ts:69`) | supplied with a different shape | The kinds differ, as above. |
| Set quiet hours | `setQuiet` (`service.js:395`); no call | none | missing | |
| Open a notification | `open` (`service.js:392`) marks it read and navigates | `Alert.subject` for the link | supplied with a different shape | Navigation works. Marking one read has no engine counterpart. |
| Mark all read | the button at `service.js:422`; no call | `client.alerts.dismiss` (`client/commands.ts:67`), one alert at a time | supplied with a different shape | Dismissing clears an open alert (`packages/engine/src/client/alerts/commands.ts:59-65`). It is not a read mark, and there is no request for all alerts at once. |
| Decline the offer ("Not now", or the callout's close button) | `declinePhoneOffer` (`actions.js:196`); no call | `client.alerts.prompt.dismiss` (`client/commands.ts:66`) | supplied | |

Notes: "Show all" and the day headings are view state. Alert changes arrive as
`client.AlertRaised`, `client.AlertDelivered`, `client.AlertDeliveryFailed`,
`client.AlertCleared`, `client.AlertSettingsChanged`, `client.AlertCarrierChanged`,
`client.AlertCarrierTokenSet`, `client.AlertCarrierTokenCleared` and
`client.AlertPromptDismissed` (`packages/contracts/src/client/events.ts:17-32`).
The mock's "Send a test" button is enabled without a token. The current website enables it
only when a token is set (`packages/web/src/admin/settings.tsx:249`).

### Service settings

The page is `ServiceSettings` in `service.js:597`. Its sections are `Appearance`
(`service.js:455`), `Defaults` (`:472`), `Remote` (`:488`), `StallWatch` (`:516`),
`WorkflowSettings` (`:540`), `GitMessages` (`:560`) and `About` (`:573`). `PermissionPicker`
is at `service.js:451`. The settings come from `data.js:325-330` and `service.js:39-46`.
The current website's page is `packages/web/src/admin/settings.tsx`. It reads
`client.alerts.settings` and `client.web.settings` (lines 58-59). It does not read
`roles.settings.get`.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `settings.defaultHarness` | Defaults, "Harness" | `packages/contracts/src/project/schema.ts:32 ProjectLeadDefaults.harness` in `ProjectSettings.lead`, read by `project.settings` (`project/commands.ts:40`) | supplied with a different shape | The engine has a default only for project leads. Workers are started with an explicit harness. |
| `settings.defaultModel`, `settings.defaultEffort` | Defaults, "Model" and "Effort" | `packages/contracts/src/harnesses.ts:31-32 HarnessSettings.defaultModel`, `defaultEffort`; `ProjectLeadDefaults.model`, `effort` | supplied with a different shape | The engine keeps one default for each harness, plus one for leads. The mock keeps one for the service. The hint "Leads start one step above this model" has no engine rule. |
| `HARNESSES[h].models`, `.efforts` | The model and effort choices | `harnesses.ts:36-37 HarnessSettings.models`, `efforts`, read by `harnesses` with `list` (`packages/contracts/src/commands.ts:132`) | supplied | |
| `settings.defaultPermission`, `PERMISSION_MODES` | `PermissionPicker`, four choices | `harnesses.ts:35 HarnessSettings.defaultPermission`; `packages/contracts/src/permission.ts:3 permissionLevels` | supplied with a different shape | The engine has four levels named `read-only`, `ask`, `edit` and `full`. The mock's four names and hints are display words for them. |
| `settings.needToKnow` | Defaults, "Need-to-know messages" | none | missing | No setting of that name exists in the contracts or the engine. |
| `settings.removeCredits` | Defaults, "Remove agent credits when merging" | none | missing | |
| `settings.webEnabled`, `.port`, `.checkIn`, `.proxyMode`, `.publicAddress` | Remote access | `client.web.settings` (`packages/contracts/src/client/commands.ts:77`): `WebSettings` (`client/settings.ts:19`) with `enabled`, `port`, `heartbeatSeconds`, `proxyMode`, `publicAddress` | supplied | The mock allows ports 1024 to 65535. The engine allows 1 to 65535. |
| Server state | not shown by the mock | `WebServerState` (`client/settings.ts:34`): `running`, `off`, `port-taken`, `no-password` | supplied | The mock has no place for it. |
| Display address and port | not shown by the mock | `WebSettings.display` (`client/settings.ts:25`) | supplied | The mock has no place for it. The current website edits it (`settings.tsx`, "Preview and design address"). |
| Master machine name | The `ssh -L` command | none | missing | |
| `settings.stallWatch` | Stall watch switch | `packages/contracts/src/roles/schema.ts:37 RolesSettings.stallWatch`, read by `roles.settings.get` (`packages/contracts/src/roles/commands.ts:28`) | supplied | |
| `settings.stallAssigned`, `.stallWorker`, `.stallLead` | Three "may be stuck" times | `roles/schema.ts:22 RoleLimits.stallMinutes` | supplied with a different shape | The engine has one stall time, from 5 to 240 minutes. A lead gets 20 minutes by default (`packages/engine/src/roles/stall-watch/settings.ts:18-21`). A role file can set it for each role. There is no separate "assigned, not started" time. |
| `settings.autoNudge`, `settings.replaceAfter` | "Wake it once first", "Replace the worker" | none | missing | `RolesSettings` has no such fields. Whether the stall rules wake and replace on fixed terms was not checked. |
| `settings.capacityBackoff`, `.capacityRetries` | "Wait after a usage limit", "Try again" | `RoleLimits.capacityBackoffMinutes`, `capacityRetries` (`roles/schema.ts:20-21`) | supplied with a different shape | The engine allows 1 to 60 minutes and 0 to 12 retries. The mock allows 1 to 120 minutes and 0 to 99 retries. |
| `settings.crashRetries` | "Restart after a crash" | `RoleLimits.crashRetries` (`roles/schema.ts:19`) | supplied with a different shape | The engine allows 0 or 1. The mock allows 0 to 9. |
| `settings.teamIdle` | "Close an idle team" | `RoleLimits.teamIdleMinutes` (`roles/schema.ts:23`) | supplied with a different shape | The engine allows 15 to 1440 minutes. The mock allows 5 to 1440. |
| Other limits | not shown by the mock | `RoleLimits.turnMinutes`, `ageMinutes`, `compactionTokens`, `flushLeadMinutes` (`roles/schema.ts:24-27`) | supplied | The mock has no place for them. |
| `settings.standingRules` | "Standing permission rules" switch | `RolesSettings.standingRules` (`roles/schema.ts:37`) | supplied | AGENTS.md says the rules themselves are unbuilt. |
| `settings.workflowPath`, the override files it lists, and each repository's `.lgtm` folder | Workflow, "Your overrides" and "One repository" | none | missing | No request reads a workflow folder or lists override files. |
| A role override, such as `roles/reviewer.md` | The second line under "Your overrides" | `roles.role-file.get` (`roles/commands.ts:24`), returning `RoleFile` (`roles/schema.ts:31`: `name`, and `roles` with `advice` and `limits`) | supplied with a different shape | The engine stores one role file for the service, as content. It does not read files from a folder. |
| `settings.testsDefault`, `settings.reviewDefault`, `settings.maxRounds` | Workflow switches and "Review rounds" | none | missing | |
| `settings.gitModel` | Git messages, "Model" and "Runs on" | none | missing | No request names a model for commit or pull request text. |
| `settings.version`, `settings.commit` | About, "Version" | none | missing | |
| `settings.dataFolder` | About, "Data folder" | none | missing | |
| `conn.status`, master name | About, "Service" | the page's own WebSocket state | supplied with a different shape | The connection state is the client's. The machine name is missing. |
| Machines online | About, "Machines" | none | missing | Only the local machine exists. |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Change a default harness, model, effort or permission | `setS` in `Defaults` (`service.js:476-481`); no call | `harnesses` with `operation: "set"` (`commands.ts:135`); `project.settings.set` with `lead` (`project/commands.ts:41`) | supplied with a different shape | The engine needs a whole `HarnessSettings` record for each harness, or a whole `ProjectSettings` record. |
| Switch need-to-know or credit removal | `setS` (`service.js:483`, `:485`); no call | none | missing | |
| Save remote access | `save` in `Remote` (`service.js:494`); no call | `client.web.settings.set` (`client/commands.ts:78`; handler `packages/engine/src/client/settings.ts:25-31`) | supplied | The engine refuses proxy mode without an HTTPS public address. |
| Change any stall watch value | `setS` (`service.js:520-536`); no call | `roles.settings.set` (`roles/commands.ts:29`; handler `packages/engine/src/roles/stall-watch/settings.ts:27-31`) | supplied with a different shape | The request replaces the whole `RolesSettings` record. The fields differ, as above. |
| Change the override folder, or check it again | `setS({ workflowPath })` and "Check again" (`service.js:546-547`); no call | none | missing | |
| Edit a role's instructions | no mock control | `roles.role-file.set` (`roles/commands.ts:20`) | supplied | The mock only shows that an override exists. |
| Switch tests first, agent review, or review rounds | `setS` (`service.js:555-557`); no call | none | missing | |
| Pick the commit message model | `setS({ gitModel })` (`service.js:565`); no call | none | missing | |
| Check for an update | the button in `About` (`service.js:577`); no call | none | missing | |
| Restart the service | `About`, confirm (`service.js:584-585`); no call | none | missing | No request restarts the service. |
| Reset harnesses to their defaults | no mock control | `harnesses` with `operation: "reset"` (`commands.ts:137`) | supplied | The mock has no control for this request. |

Notes: Appearance (theme, density, a folded sidebar) and the open section are browser
view state. The current website keeps the theme in the browser as well
(`packages/web/src/admin/settings.tsx`, the Appearance section). The "Saved" mark is view
state. Settings changes arrive as `client.WebSettingsChanged`
(`packages/contracts/src/client/events.ts:33`), `roles.SettingsChanged` and
`roles.RoleFileSet` (`packages/contracts/src/roles/events.ts:70-71`), `HarnessChanged`
(`packages/contracts/src/events.ts:251`), and `project.SettingsChanged`
(`packages/contracts/src/project/events.ts:18`).

### Login and first run

`Login` is in `design/mock/js/screens/auth.js:19`. `FirstRun` is in `auth.js:113`, and its
step bar is `Steps` (`auth.js:91`). The mock's login state is `session.status` in
`data.js:314`. The engine's login is a plain HTTP route, not an RPC request. The current
website's login is in `packages/web/src/app.tsx:20-82`. Its first run is
`packages/web/src/project/setup.tsx`, with reads in `setupRead.ts`, the inline project form
in `ownerSetup.tsx`, and repository registration in `registration.ts`.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `session.status` `in` or `out` | Whether the login page shows | `POST /api/session`: 204 when signed in, 401 when not (`packages/engine/src/client/web/server.ts:154-155`) | supplied | |
| `session.status` `rejected` | "That password is wrong" | `POST /api/login` returns 401 (`server.ts:147`) | supplied | |
| `session.status` `expired` | "The session expired" callout | `POST /api/session` returns 401 | supplied with a different shape | The engine does not tell an expired session from one that never existed. The current website shows its own message after an in-session expiry (`packages/web/src/app.tsx:16`). |
| `session.status` `unavailable` | "The service is not answering" | a failed `fetch` | supplied | This is a transport failure, as in `packages/web/src/app.tsx:28`. |
| `insecureOrigin()` | "This page is not on a secure connection" | `requestPolicy` (`packages/engine/src/client/web/proxy.ts:4-20`) returns 403 for an unaccepted host or origin (`server.ts:135`) | supplied with a different shape | The engine refuses every request from an unaccepted origin, including the page itself. The mock decides in the browser. |
| `master.name`, `master.address` | "Sign in to the service on Workstation", the address in the foot | `WebSettings.port` only (`packages/contracts/src/client/settings.ts:19`) | missing | No machine name exists. The address can come from the page's own location. |
| `session.firstRun` | Whether login leads to `/setup` | `project.setup` (`packages/contracts/src/project/mocks.ts:60`), `SetupState.completedAt` (`mocks.ts:46`) | supplied | |
| `Steps`: "Subscription", "Repository", "First project", and the furthest step reached | The step bar | `SetupState.step` (`mocks.ts:45`: `welcome`, `found`, `project`) | supplied with a different shape | The engine's three steps are a welcome page, a discovery page, and the project. The mock's are sign-in, repository, and project. The engine stores the step. The mock keeps it in the page. |
| `HARNESSES` names, models, run mode | Step 1, one choice for each harness | `project.setup.discover` (`mocks.ts:63`), `DiscoveryHarness` (`mocks.ts:50`: `harness`, `installed`, `configured`, `accounts`); models from `harnesses` with `list` | supplied with a different shape | Discovery covers four harnesses: `claude`, `codex`, `gemini`, `cursor` (`packages/engine/src/project/setup.ts:41`). |
| Sign-in state for each harness, `PLANS`, `CODES` | "Signed in · Max", the device code | `DiscoveryAccount.state` (`mocks.ts:48`) | supplied with a different shape | The engine reports a local credential or its absence. It has no plan name and no device code. |
| `master.workspace`, and repository folders found there | Step 2 suggestions | `Discovery.repositories` (`mocks.ts:52`: `name`, `path`); `ProjectSettings.workspaceFolder` | supplied | The engine also has `project.repository.discover` (`packages/contracts/src/project/git.ts:64`). |
| `checkPath` result: branch, commit count, remote | "Git repository found. Branch main, 57 commits, remote …" | none | missing | No request inspects an unregistered folder for its branch, commit count or remote. |
| Summary: repository, project lead subscription, machine | Step 3 summary | `Discovery.readyDefaults` (`mocks.ts:52`, a `ProjectLeadDefaults`) | supplied with a different shape | The engine names the lead's harness, account, model and permission. The machine is always the local one. |
| Workspace folder, shell, owner's name | not shown by the mock | `ProjectSettings.workspaceFolder`, `shell`, `displayName` (`packages/contracts/src/project/schema.ts:36`); `Discovery.ownerNameSuggestion` | supplied | The engine's first run asks for these. The mock has no place for them. |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Sign in with the password | `submit` (`auth.js:34-45`); no call | `POST /api/login` with `{ password }` (`server.ts:139-148`) | supplied | It sets a session cookie. |
| Try again when the service is down | `retry` (`auth.js:46`); no call | `POST /api/session` | supplied | |
| Log out | the sidebar button (`app.js:161`); no call | `POST /api/logout` (`server.ts:156`) | supplied | |
| Sign in to a harness during setup | `startSignin` (`auth.js:131`); no call | none | missing | See Subscriptions. |
| Move between steps | `to` and `next` (`auth.js:129`, `:153-159`); no call | `project.setup.advance` (`mocks.ts:61`; handler `packages/engine/src/project/setup.ts:13-18`) | supplied with a different shape | The engine refuses a jump of more than one step. The steps differ, as above. |
| Pick a repository folder | `setPath` and `checkPath` (`auth.js:100-111`, `:135-140`); no call | `project.repository.add` (`packages/contracts/src/project/commands.ts:42`) | supplied with a different shape | The mock never registers the folder. It passes the folder's name as a new repository to `createProject` (`auth.js:151`). In the engine, `repository: { _tag: "new" }` makes a fresh folder under the workspace folder (`packages/engine/src/project/lifecycle.ts:54-64`). It does not adopt the existing one. |
| Pick the commit message model | `setGitModel` (`auth.js:218`), saved at finish (`auth.js:150`); no call | none | missing | |
| Create the first project | `finish` calls `createProject` (`auth.js:145-152`), which reports `create` (`actions.js:218`) | `project.create` (`project/commands.ts:49`) | supplied with a different shape | The payload differs. See the shell section. |
| Finish setup | `finish` sets `firstRun` false (`auth.js:150`); no call | `project.setup.complete` (`mocks.ts:62`; handler `setup.ts:19-24`) | supplied with a different shape | The engine needs the created project's id. It refuses unless the step is `project` and the lead started without a failure. |
| Skip setup | `skipAll` (`auth.js:160`); no call | none | missing | No request ends setup without a project. |
| Save the workspace folder, shell or owner's name | no mock control | `project.settings.set` (`project/commands.ts:41`) | supplied | The current website saves them in `setupRead.ts:47-53`. |

Notes: The shown password, the Caps Lock hint and the busy spinner are view state. Setup
changes arrive as `project.SetupAdvanced` and `project.SetupCompleted`
(`packages/contracts/src/project/mocks.ts:78-79`).

### The shell

The shell is in `design/mock/js/app.js`. The sidebar is `Sidebar` (`app.js:119`). Its tree is
`ProjectTree` (`app.js:53`), made of `TreeRow` (`app.js:41`). The top bar is `TopBar`
(`app.js:196`), with `Bell` (`app.js:169`), `Live` (`app.js:180`) and `Inspecting`
(`app.js:188`). The quick switcher is `Switcher` in `dialogs.js:36`, ranked by
`searchScore` (`dialogs.js:24`). The New project dialog is `NewProject` (`dialogs.js:103`),
and it calls `createProject` (`actions.js:207-239`). Rename, archive and restore are on the
project's Settings tab (`service.js:622-625`, `:649`, `:722`), on All projects
(`home.js:148`), and on an archived board (`design/mock/js/screens/project.js:149`). The
current website's shell is `packages/web/src/shell/`. Its New project form is
`packages/web/src/project/newProject.tsx`, driven by `creation.ts`.

#### What the screen reads

| Store field (mock's name) | What the screen shows | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| `repos[]`, `repo.name` | Repository rows in the tree | `ProjectSnapshot.repositories` (`packages/contracts/src/project/commands.ts:32`), `Repository.name` (`packages/contracts/src/project/schema.ts:38`) | supplied | The current website pages `project.repositories` when the snapshot is truncated (`packages/web/src/data/projectReads.ts:12-14`). |
| `projects[]`, `project.repo`, `project.name`, `project.archived` | Project rows under each repository; archived ones hidden | `Project.repoId`, `name`, `archivedAt` (`schema.ts:48`) | supplied | |
| `project.stage` | The stage word on a project row | `Project.stage` (`schema.ts:48`); values at `schema.ts:29` | supplied with a different shape | The engine's values are lower case, such as `handover`. The mock's are labels, such as "Hand over". `stageLabel` maps them (`packages/contracts/src/project/mocks.ts:84`). |
| `project.naming` | "Naming…" while the lead names a new project | none | missing | The engine needs the name at creation, so a project is never unnamed. |
| `project.lead`, lead status word | The "Project lead" row under each project | `Project.leadAgentId` (`schema.ts:48`); `RosterEntry.displayedState`, `openPermissionRequests`, `openQuestionsAsked` (`packages/contracts/src/client/reads.ts:33-34`) | supplied | |
| Lead's display name | "Project lead" | `RosterEntry.name` (`client/reads.ts:30`) | supplied with a different shape | The engine names a new lead from a list of personal names, such as "Sage" and "Rowan" (`packages/engine/src/project/lifecycle.ts:21`, `:86`). The mock calls it "Project lead", and `design/mock/README.md` forbids invented personal names for agents. |
| `teams[]`, `team.stage`, `team.area` | Team rows, named "Build team · Shell" | `ProjectSnapshot.teams`, `Team.name`, `stage`, `area` (`schema.ts:65`) | supplied | The engine also has a team `name`. |
| Agents of a team, `agent.name`, `agent.role` | Agent rows and avatars | `RosterEntry.name`, `role`, `groups` (`client/reads.ts:30`); team membership through `Team.group` (`packages/web/src/shell/model.ts:20`) | supplied with a different shape | The engine links an agent to a team by a group name, not by a team field. |
| `agent.activity` | The tooltip on an agent row | none in `RosterEntry` | missing | `RosterEntry` has no activity field. The nearest is the title of the agent's latest tool call; see the Chat section. |
| Open request counts for each repository, project and team | The amber counts in the tree | `ClientSnapshot.requests` and `.questions` (`client/reads.ts:48`); `ClientRequest` (`packages/contracts/src/requests.ts:19`); `ProjectAgentSummary` (`project/commands.ts:31`) | supplied with a different shape | The page joins requests to projects through each agent. Merges and failed starts come from other sources, below. |
| `projectStatus` word, such as "Needs you · 3" or "Building" | Project status in the tree and the switcher | `ProjectAgentSummary.status` (`project/commands.ts:31`: `Needs you`, `Reviewing`, `Working`, `Ready`) | supplied with a different shape | The engine's status is for each agent, with four words. The mock makes one word for the project from its stage. |
| `owner.name` | The owner's row at the sidebar's foot | `ProjectSettings.displayName` (`schema.ts:36`); `Discovery.ownerNameSuggestion` (`mocks.ts:54`) | supplied | |
| Count of machines online | "n of n online" beside Machines | none | missing | |
| Failed delivery count | The red count beside Notifications | `Alert.delivery` in `ClientSnapshot.alerts` (`client/reads.ts:54`) | supplied | |
| Breadcrumbs: repository, project, team, agent, sprint, task | The top bar's path | the snapshot sections above | supplied | |
| `openRequests(s)` of kinds `question`, `approval`, `merge`, `failed` | The bell, longest wait first | `ClientRequest` (`requests.ts:19`) for questions and approvals; `RosterEntry.startFailure` (`client/reads.ts:32`) for failed starts; `GitMainReview` with `outcome: "open"` (`packages/contracts/src/project/git.ts:41`) through `project.MainReviewOpened` (`packages/contracts/src/project/events.ts:14`) for merges | supplied with a different shape | The engine has three sources for four kinds. The current website's bell shows only failed starts, questions and approvals (`packages/web/src/shell/model.ts:29-40`). |
| `conn.status`, `conn.lastHeard` | The Live badge | the page's own WebSocket state; `WebSettings.heartbeatSeconds` (`client/settings.ts:22`) | supplied with a different shape | This is client state. The badge's text names the machine "Workstation", which is missing. |
| `worktrees[]` for the project, `inspecting[project]`, `project.branch` | The Inspecting menu | `ProjectSnapshot.workspaces`, `Workspace.branch`, `machineId`, `projectId` (`schema.ts:41`); `Project.worktreeId` | supplied | The choice of worktree is view state. |
| Switcher items: repositories with `remote` and `description` | Repository results | `Repository` (`schema.ts:38`) | supplied with a different shape | `Repository` has no remote and no description. |
| Switcher items: projects with goal, branch, sprint names and goals | Project results | `Project.goal`; `Workspace.branch`; `Sprint.name`, `goal` (`schema.ts:71`) | supplied | |
| Switcher items: agents with role, team, activity, project | Agent results | `RosterEntry`, `Team`, `ProjectAgentSummary` | supplied with a different shape | Activity is not in `RosterEntry`, as above. |
| `searchScore` ranking | The order of results | `project.context.search` (`project/commands.ts:38`; fields `packages/contracts/src/project/context.ts:19`) | missing | `project.context.search` needs a `projectId` and a `worktreeId`. It searches only tasks and files in one project, and it returns references for a prompt. The mock's comment says the real product ranks with a small embedding model. No engine request does that. The current website filters names in the browser (`packages/web/src/shell/QuickSwitcher.tsx:13-21`). |
| New project: `machines[]` with status | "Run on" select | none | missing | Only `"local"` exists. |
| New project: `repos[]`, `repo.folders[machine]` | "Repository" select, "not on Machine" | `ProjectSnapshot.repositories`; `project.RepositoryLocated` (`project/events.ts:20`) | supplied with a different shape | Locations arrive only as events, as on Machines. |
| New project: ready subscriptions on the machine | "Project lead" table (`SubscriptionTable`) | `Discovery.readyDefaults` (`mocks.ts:52`); `ProjectSettings.lead` (`schema.ts:36`) | supplied with a different shape | The engine resolves one lead account from settings at creation (`packages/engine/src/project/leadDefaults.ts:62-93`). The owner cannot pick one in the create request. |
| Planned branch and folder | not shown by the mock before creation; set after naming (`actions.js:231`) | `project.placement.preview` (`project/commands.ts:50`): `repositoryPath`, `path`, `branch`, `checkout` | supplied with a different shape | The mock names the branch `feat/<name>`. The engine names it from the project name with no prefix, under `.worktrees/` (`lifecycle.ts:68-81`). |
| Unfinished creations | not shown by the mock | `project.creations` (`project/commands.ts:54`) | supplied | The mock has no place for it. The current website reads it (`packages/web/src/project/creation.ts:52`). |

#### What the screen does

| Owner action | Mock function, and its engine call if it reports one | Engine source (file:line) | Verdict | What differs |
|---|---|---|---|---|
| Create a project | `NewProject`, `create` (`dialogs.js:115`), then `createProject`, which reports `create` with `repositoryId`, `goal`, `machineId`, `subscriptionId`, and `newRepository` when set (`actions.js:218`) | `project.create` (`packages/contracts/src/project/commands.ts:49`), payload `createPayload` (`project/commands.ts:20-22`) | supplied with a different shape | The tag is `project.create`, not `create`. The field-by-field comparison follows this table. |
| Preview where the project will go | no mock control | `project.placement.preview` (`project/commands.ts:50`) | supplied | It takes the same payload as `project.create`. The current website calls it before every creation (`packages/web/src/project/creation.ts:207`). |
| Abandon an unfinished creation | no mock control | `project.creation.abandon` (`project/commands.ts:53`; handler `packages/engine/src/project/commands.ts:335-340`) | supplied | No website calls it. |
| Add a repository from New project | "Add to machine" (`dialogs.js:132`) opens `AddRepository` | `project.repository.add` | supplied | See Machines. |
| Set the goal | the Settings tab's "Save goal" (`service.js:655`); no call | `project.goal.set` (`project/commands.ts:55`) | supplied | The current website calls it (`packages/web/src/admin/project-settings.tsx:63`). |
| Rename a project | `rename` (`service.js:622`); no call | `project.rename` (`project/commands.ts:58`; handler `packages/engine/src/project/commands.ts:133-138`) | supplied | The engine refuses a name already used in the same repository and machine. |
| Archive a project | `archiveProject(pid)` reports `archive` with `projectId` (`actions.js:241`) | `project.archive` (`project/commands.ts:56`; handlers `packages/engine/src/project/lifecycle.ts:210-230`, `:267-273`) | supplied with a different shape | The tag is `project.archive`, not `archive`. The payload lacks `requestId`. The engine stops every agent first, as the mock does. |
| Restore a project | `archiveProject(pid, false)` reports `restore` with `projectId` (`actions.js:241`) | `project.restore` (`project/commands.ts:57`; handler `packages/engine/src/project/commands.ts:296-299`) | supplied with a different shape | The tag is `project.restore`, not `restore`. The payload lacks `requestId`. Agents stay stopped in both. |
| Delete a project | `del` (`service.js:626-633`); no call | none | missing | No request deletes a project. |
| Open the switcher, pick a result | `Switcher`, `pick` (`dialogs.js:56`) | none needed | supplied | This is navigation. |
| Open a request from the bell | `Bell` items (`app.js:175`) | none needed | supplied | This is navigation. |
| Reconnect now | `Live` menu (`app.js:186`) | the client's own reconnect | supplied | The current website retries the same way (`packages/web/src/shell/Shell.tsx:250`). |
| Log out | the sidebar button (`app.js:161`) | `POST /api/logout` | supplied | See Login. |

Comparison of the mock's `create` call with `project.create`, field by field:

| Mock field (`actions.js:218`) | Contract field (`packages/contracts/src/project/commands.ts:20-22`) | Verdict | What differs |
|---|---|---|---|
| none | `requestId` | missing | The contract needs a request id on every call. |
| none | `name` (`ProjectName`, required) | missing | The mock sends no name. Its lead names the project after creation (`actions.js:228-237`). The engine refuses a create without a name. |
| `goal` | `goal` (`ProjectText`, at most 8192 code points) | supplied | The engine puts the goal into the lead's first prompt (`packages/engine/src/project/lifecycle.ts:251-252`). |
| `machineId` (such as `studio`) | `machineId` (`ProjectName`) | supplied with a different shape | The engine accepts only `"local"` (`lifecycle.ts:29`). |
| `repositoryId` | `repository: { _tag: "existing", repoId }` | supplied with a different shape | The field is a tagged union, not a plain id. |
| `newRepository` (a name) | `repository: { _tag: "new", name }` | supplied with a different shape | The same union. The engine makes a new folder under the workspace folder (`lifecycle.ts:54-64`). |
| `subscriptionId` | none | missing | The contract has no account field. The lead's account comes from `ProjectSettings.lead`, resolved by `leadDefaults` (`packages/engine/src/project/leadDefaults.ts:62-93`). |
| none | `useWorktree` (optional) | supplied | The mock omits it. The engine refuses `false` (`lifecycle.ts:30`). |

Notes: The "Mock controls" button at the sidebar's foot (`app.js:100-118`) is a mock-only aid
and needs no engine source. The sidebar width, the folded sidebar, the expanded tree rows,
the "Only projects needing you" filter, the drawer on a phone, the lead panel's width and
whether it is open, and the switcher's typed query are view state. The engine refuses
`project.archive` while an agent of the project still runs, after it has tried to stop
them (`lifecycle.ts:271`). Project changes arrive as `project.Created`, `project.Renamed`,
`project.GoalChanged`, `project.Archived`, `project.Restored`, `project.TeamAdded`,
`project.RepositoryAdded` and `project.WorktreeCreated`
(`packages/contracts/src/project/events.ts:19-34`).

## What the table adds up to

The three lists below sort the rows above. An item marked "supplied with a different shape"
counts as supplied, because only the website's mapping changes. Every Git and file item
holds only for the machine `"local"`.

### Works on today's engine

These screens, or parts of screens, have no missing item. Some items still need a mapping
from the engine's shape to the mock's.

- **Login.** Signing in with the password, trying again when the service is down, and
  logging out.
- **Home.** The list of open questions and approvals, with title, text, recommendation, age,
  agent and project. Answering a question in your own words, allowing or denying an approval,
  allowing without seeing the input, resuming a failed start, and declining the phone offer.
- **All projects.** The whole screen. The stage words and the status words need mapping.
- **Project board.** Each sprint's label, name, goal, progress, dependencies and phase, in
  four columns. The engine's four sprint states replace the mock's five columns.
- **Sprint, task and team pages.** The sprint's tasks and their states and owners, a task's
  history, a team's stage, area, branch, channel, agents and tasks.
- **Chat.** The thread's messages and tool calls, stopping a reply, stopping and resuming an
  agent, changing the model or effort, compacting, answering in the thread, adding tasks or
  files as context, and the agent's context use.
- **Messages.** Reading channels and posts, posting, replying in a thread, and clearing
  unread counts.
- **Agents.** The roster with each agent's state, task, model and context use. Opening a
  chat, stopping, resuming, and changing the model.
- **Git.** Changes, staging, discarding, committing, history, diffs, fetch, pull, push,
  integrating a team worktree into the project branch, the main review and its approval, and
  conflict choices.
- **Mocks.** The list of screens, the drawn screens, the data comparisons, the component
  flags, and approving a whole revision.
- **Repository design page.** The registered file, its author and time, the registered
  components and tokens, and opening the OpenPencil editor read-only.
- **Project settings.** Renaming, setting the goal, archiving, restoring, and the lead's
  model and effort.
- **Subscriptions.** The list of accounts, turning one on or off, renaming, removing,
  clearing a usage limit by hand, and the agents on each account.
- **Notifications.** The carrier's server, topic and token, turning them off, sending
  a test, retrying a failed delivery, switching kinds, and the list of alerts.
- **Service settings.** Remote access, the stall watch switch, standing rules, the role
  instructions, the other limits, and resetting the harnesses.
- **First run.** The workspace folder, the shell, the owner's name, previewing where the
  project goes, and creating the first project once the payload is mapped.
- **The shell.** The tree of repositories, projects and teams, the breadcrumbs, the bell for
  questions and approvals, unfinished creations, adding a repository, renaming, and setting
  the goal.

### Small engine additions

Each of these adds a field or a request to a record the engine already has.

- **Questions and permissions** (`QuestionMetadataFields`, `questions.ts:12`): the short
  brief, the summary, the short recommendation, "what", "why", "why this answer", the
  references, and a list of options with notes.
- **The main review** (`GitMainReview`, `git.ts:41`): the "Users will notice" line, the brief
  and body, a conflict count before approval, per-file line counts, and a pull request title
  and description. A request that sends a review back with a reason is also missing.
- **Projects** (`Project`, `schema.ts:48`): a prefix, a base branch, a creation time, and
  creation without a name, so that the lead names the project.
- **Repositories** (`Repository`, `schema.ts:38`): the remote, the base branch, the running
  description with its time and author, and a read of each machine's folder.
- **Sprints** (`Sprint`, `schema.ts:71`): priority, start and end dates, a Backlog state, a
  fix-sprint marker, and a link to a plan file.
- **Tasks** (`Task`, `schema.ts:86`): points, a plan section, and a task with no owner.
- **Roster rows** (`RosterEntry`, `client/reads.ts:29`): an activity line, a turn count, a
  token total, and the time of the last output.
- **Agent changes** (`configure`, `commands.ts:68`): changing an agent's account and its
  permission level.
- **Teams** (`Team`, `schema.ts:65`): the need-to-know flag.
- **Board posts and channels** (`BoardPost`, `board/schemas.ts:18`): a post kind, a time, a
  link to a request or a blocked item, reopening a post, closing as "answered", a project on
  each channel, and a leads channel.
- **Alerts** (`client/alerts.ts:10`): merge and sprint kinds, a read mark, and quiet hours.
- **Accounts** (`Account`, `accounts.ts:18`): an email address and a machine.
- **Stall watch settings** (`RoleLimits`, `roles/schema.ts:18`): three stall times instead
  of one, waking a stuck agent, replacing a worker, and wider ranges for retries.
- **Service defaults**: a default harness, model and permission for workers, need-to-know,
  credit removal, the version and the data folder.
- **Git requests** (`git.ts:63`): commit bodies, tags, who started a merge and when,
  aborting a merge, updating from the base branch, integrating a builder's worktree into its
  team branch, reopening a resolved file, and committing one file.
- **Mock revisions** (`MockBundle`, `mocks.ts:26`): a change description, seen marks, a
  sample value on a drafted field, use counts and notes on a component, and approval of one
  screen.
- **The design record** (`RepositoryDesign`, `design.ts:17`): the file's size, page count
  and commit.
- **Setup** (`mocks.ts:59`): skipping setup, and inspecting a folder's branch, commit count
  and remote before it is registered.
- **Projects**: deleting a project.

### New engine pieces

The engine has nothing for these.

- **The build loop's records.** Phases, review rounds, findings, points, stuck statements,
  test runs with jobs, steps and logs, "Start full run", end-result statements, "Request
  change", fix sprints, and the workflow's settings in `.lgtm/config`. These serve the
  Workflow, Review rounds, Test runs, End result and Workflow settings screens.
- **Files.** A folder tree of a worktree, reading a file's text, saving a file, and
  downloading one.
- **Terminal.** A shell session on a machine, carried over the connection.
- **Machines.** A machine record, pairing, status, load figures, versions, an agent limit,
  renaming and removing, and Git and files on a machine other than `"local"`.
- **Signing in to a harness.** Running a harness's login, a device code, and signing out.
- **Usage meters.** The five-hour and weekly usage of each account.
- **Generated Git text.** The commit message and the pull request text, from a model chosen
  in settings, and opening a pull request.
- **Attachments.** Files and images on a message, and a place to upload them.
- **Comments on a mock screen.**
- **Design files.** Creating and saving a design file in the repository, its screens and
  flows, the comparison of its colours with code, and icons.
- **Epics.**
- **Sprint plan pages.** Storing a plan as an HTML page and reading it back.
- **The work assignment table.** A model for each kind of work in a project.
- **Search across the product.** Ranking repositories, projects and agents together.
- **Service upkeep.** Checking for an update and restarting the service.

## Requests that no screen uses

The contracts define 125 requests. One of them, `debug.compare-views`, is never served to the
website. No screen in the mock uses the 16 below, as a source or as an action. The access
column is the request's access rule in the contracts.

| Request | File and line | Who may call it |
|---|---|---|
| `ask` | `packages/contracts/src/commands.ts:84` | owner, agent |
| `pass-up` | `packages/contracts/src/commands.ts:83` | owner, agent |
| `wait` | `packages/contracts/src/commands.ts:88` | owner, agent |
| `release` | `packages/contracts/src/commands.ts:98` | owner, agent, service |
| `group` | `packages/contracts/src/commands.ts:107` | owner, agent |
| `board.members` | `packages/contracts/src/board/commands.ts:37` | owner, agent |
| `board.acknowledge` | `packages/contracts/src/board/commands.ts:52` | owner, agent |
| `board.status` | `packages/contracts/src/board/commands.ts:73` | owner, agent, service |
| `roles.orient` | `packages/contracts/src/roles/commands.ts:14` | agent |
| `roles.handoff` | `packages/contracts/src/roles/commands.ts:15` | owner, agent |
| `roles.snooze` | `packages/contracts/src/roles/commands.ts:30` | owner |
| `roles.record` | `packages/contracts/src/roles/commands.ts:37` | service |
| `project.workspace.register` | `packages/contracts/src/project/commands.ts:45` | owner |
| `project.sprint.complete` | `packages/contracts/src/project/commands.ts:71` | owner, agent |
| `project.checkouts` | `packages/contracts/src/project/git.ts:66` | owner |
| `debug.compare-views` | `packages/contracts/src/commands.ts:38` | owner, only with the test flag |

`project.sprint.complete` writes the `completion` and `evidence` fields that the Sprint
page reads. No action in the mock completes a sprint, so the request itself is unused.

## What was not checked

- Whether an extra `files` key in a `prompt` payload is dropped silently or refused. A
  comment in the contracts says public decoding normally strips extra keys
  (`packages/contracts/src/project/mocks.ts:31`), but the RPC (remote procedure call) server's
  decoding was not traced.
- What the engine stores in `Workspace.owner`. The owner rows on the Files and Git screens
  depend on it.
- Whether builders' own worktrees are registered as workspaces.
- Which Git author identity `project.commit` uses.
- Whether `project.goal.set` tells the project lead.
- Whether the owner may address agents in a direct channel between two agents end to end.
  `canPost` allows the owner to post there, but addressing was not traced.
- Whether the stall watch wakes an agent and replaces a worker on fixed terms.
- Whether the engine enforces unique account names.
- What the `origin` field of `client.alerts.carrier.set-token` must hold.
- How a display origin is configured, and whether a `.fig` file works in the OpenPencil image
  beyond what `packages/engine/src/project/display.ts` accepts.
