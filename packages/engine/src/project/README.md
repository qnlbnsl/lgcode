# Project data, Git and lifecycle

## The public local Git commands

The project piece keeps the existing repository, location, workspace, project,
team, sprint, and task records. Git reads do not create stored Git events.
Git mutations have ordinary command receipts. Repeating a committed request
identifier returns its original receipt, without repeating the Git mutation.

The owner first saves `project.settings.set`, including the trusted absolute
workspace folder. `project.repository.discover` searches that folder.
`project.repository.add` and `project.repository.locate` validate real local
Git checkouts. `project.workspace.register` checks the actual repository,
branch, and checkout type before recording its identity. These registration
commands accept paths. Subsequent commands use registered identities.

`project.repositories` and `project.workspaces` page the durable records.
`project.branches` and `project.checkouts` enumerate actual Git branches and
checkouts by repository identity. A record outside a changed workspace folder
is preserved, but Git operations on it refuse. The owner can restore the
workspace setting. A branch changed outside LGcode requires restoring the
recorded branch before that workspace's Git operations can proceed.

The workspace commands take `worktreeId`. They are `project.changes`,
`project.diff`, `project.history`, `project.commit.files`, `project.git.state`,
`project.stage`, `project.unstage`, `project.stage.all`, `project.unstage.all`,
`project.discard.plan`, `project.discard`, `project.commit`, `project.fetch`,
`project.pull`, `project.push`, `project.integrate`, `project.review`,
`project.review.open`, `project.conflict`, `project.conflict.choose`, and
`project.conflict.resolve`. The contracts define every request and reply.
The command-line interface accepts their spaced and dotted names, with the
same payload supplied as `--input` JavaScript Object Notation (JSON).

Only the owner can mutate Git. Agents can read changes, diffs, history,
commit files, Git state, review evidence, and conflicts in their own project.
An agent supplies its `projectId` as well as the workspace identity.
The workspace must belong to that project or one of its registered teams.
Agent replies use the existing plain-text data envelope.
No remote machine is accepted before machine pairing is implemented.

The queue belongs to one command runtime. Its service instance is reused for
one trusted workspace setting. A finite outer gate spans service replacement,
including changes between overlapping roots. Waiting requests can be cancelled.
Each active service operation retains its own time budget. A request can call
several service operations. The gate is released when the active request finishes.
This can defer cancellation of an active read until those operations finish.
A queued request whose workspace setting changed refuses and asks for refresh.
The service's own finite queue and process deadlines remain intact.

Every display string passes the production redactor. Fixed conflict segment
kinds, hunk choices, and the review result kind retain their protocol meaning.
The serialized reply, including an agent's data envelope, fits 256 kibibytes.
A larger reply refuses with a fixed recoverable reason. The Git service also
bounds each subprocess, patch, and collection. Raw subprocess errors and remote
addresses are never attached to public failures.

Integration requires a registered team source and its project destination.
The service refuses a dirty source or destination and direct integration into
`main` or `master`. Conflict choices carry a fingerprint and choices, without
client-supplied write content. The service reconstructs current canonical hunks.
`project.review.open` returns a verified GitHub compare URL with `kind: compare`
and `opened: false`. It does not create a pull request or claim provider approval.

## Explicit owner review and merge to main or master

`project.review.prepare` takes `projectId`, its assigned `worktreeId`, and the
registered repository base's `destinationId`. It reads complete bounded Git
comparison data and records an open review with both heads. It does not approve
or merge. Binary or truncated comparison data refuses. A newer preparation
supersedes the previous open review for that workspace.

`project.review.report` stores a reported test or reviewer outcome for the
project workspace's actual current head. It takes `kind` of `tests` or `review`,
`status` of `passed` or `failed`, a summary, and a genuine `threadAgentId` and
`threadSequence`. The thread item must exist and belong to that project.
An agent can report only against its own project thread. The owner can report
against an existing member thread. The authenticated reporter and time are
recorded, and provenance is always `reported`, not engine-executed proof.
The projection keeps the latest report per kind and workspace. The log keeps
history. `project.review.status` returns that evidence and the latest review.
Reports for another head or an unavailable thread are labeled stale.

Only the owner can call `project.review.prepare` and `project.review.approve`.
Approval takes the open `reviewId`, `expectedHead`, `expectedBaseHead`,
`confirmed: true`, and an explicit `decision` of `approve` or
`approve_without_evidence`. Neither decision imposes a passing-test or reviewer
policy. Missing and failed evidence remain visible in the recorded review.
Reports, compare URLs, and agent verdicts never supply approval authority.
The service checks the authenticated owner again before execution. It validates
both reviewed heads and branches, clean source and destination, no active merge,
and exact common repository metadata. It merges the reviewed commit object.
The original `project.integrate` and `mergeTeam` main/master refusal remains.

The approval reply has an explicit `outcome` of `merged` or `refused`, with a
fixed safe `reason` on refusal. A refusal is not a successful merge. The log and
receipt retain the reviewed heads, decision, and outcome. Retry an uncertain
attempt with the identical payload and request identity. A changed body refuses.
A known refusal consumes that review; obtain a new review and approve explicitly
after correcting the cause. Conflicted destination bytes and merge state remain
inspectable through the existing Git operations.

Git and the database are not crash-atomic. A crash after a Git effect but before
the receipt commits can leave an uncertain outcome. Inspect actual refs, working
bytes, and merge state before preparing another review. A changed base head
refuses the old execution rather than silently approving the new comparison.
The engine gate does not exclude terminal operations by the same Unix user.
The existing local filesystem race limitation still applies.

## Real project creation and lifecycle

The owner saves `project.settings.set` with a workspace folder and shell.
The optional `lead` defaults select a harness, an account, a model, an effort,
and a permission ceiling.
Old settings without `lead` still replay.
Creation chooses a locally ready enabled account using the normal account ordering.
Readiness requires an executable Agent Client Protocol adapter and available credentials.
It does not assert a provider usage balance or successful remote authentication.
The production runner still performs its ordinary session handshake.
A saved named account is never silently replaced by another account.

The owner calls `project.create` with a stable request identity, a name, a goal,
`machineId: "local"`, and either an existing repository identity or a new repository name.
Only the confirmed local machine is implemented.
`useWorktree` defaults to true.
New repositories live beneath the configured workspace folder.
Worktrees live beneath the repository's `.worktrees` directory.
Names collide case-insensitively within one repository and machine.
Branch and directory collisions receive a numeric suffix.
An unchecked worktree option uses the main checkout and its current named branch.
An unborn repository remains unborn; creation does not invent a commit.

The durable creation intent is specific to this repository, checkout, and lead journey.
It is not a general workflow queue.
The engine serializes project creation and archive independently of caller connections.
The normal start planner commits the lead and project in the same transaction as the receipt.
The normal runner then opens its session and delivers the initial goal prompt.
A failed adapter setup leaves one visible stopped lead, rather than creating a second one.
Later child start events inherit project membership.

## Recovering unfinished creation

The owner reads `project.creations` through the authenticated client application
programming interface or the command-line interface.
It returns only unfinished intents, using the ordinary bounded cursor pagination.
Each intent includes the original request identity, request hash, selected defaults,
repository and workspace identities, exact paths, and committed directory claims.
There are at most 64 unfinished intents.
Completed creations use ordinary durable receipts instead.

Retry the original `project.create` request with the same request identity and body.
The engine reuses the recorded branch, paths, and defaults.
A filesystem witness permits recovery if mkdir succeeded before its claim was logged.
The engine refuses unknown, replaced, or redirected directories.
It verifies both the linked checkout and the actual Git branch before launch.
It appends an exact local exclusion rule without rewriting existing exclusion entries.
It never deletes checkouts, branches, unrelated files, or exclusion entries.
Only its exact directory witness is removed after the ownership claim commits.

A database write failure latches the writer until service restart.
Read the pending intent before restarting, and retry the original request after recovery.
If the final project and receipt were committed, restart recovery uses the same lead identity.
Caller cancellation within the running service does not cancel engine-owned creation.
A retry waits behind the existing operation and returns its receipt.
A changed request body under the original identity is refused.

A crash between mkdir and the witness write cannot establish ownership safely.
The planned path remains visible, but automatic recovery refuses it.
The owner must inspect that path and resolve it before retrying.
Unverifiable partial Git metadata receives the same conservative treatment.
The engine does not claim that an error rolled filesystem effects back.
These rules retain the repository's existing local filesystem race limitation.

## Editing and archiving projects

`project.rename`, `project.goal.set`, and `project.preferences.set` edit durable project metadata.
Renaming does not change the branch or folder.
`project.archive` first marks the project as archiving, blocking new children and resumes.
It confirms a normal runner stop for every member under that agent's normal send lane.
It applies the ordinary stop events, including permission cancellation and wait checks.
It preserves questions.
The archived timestamp commits only after every process stop succeeds.
A failed stop keeps `archiving: true`; retry archive after resolving the stop failure.
`project.restore` clears the archived state without launching a lead or resetting setup.
An incomplete archive must finish before restore.
