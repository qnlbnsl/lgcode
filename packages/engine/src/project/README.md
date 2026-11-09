# Project data, Git and lifecycle

## Typed task and file context

`project.context.search` searches Tasks and Files for one readable project.
Its payload contains `projectId`, the assigned `worktreeId`, and a literal `query`.
An optional `teamId` restricts tasks and must match that team's workspace.
An optional `scope` selects `tasks` or `files`.
The default result limit is 100, and a smaller `limit` is allowed.
The response contains `result.items` and `result.truncated`.
Each item has a display `label` and a typed `reference`.
An agent receives the same result inside the existing untrusted-data envelope.
An unavailable search refuses safely rather than returning an empty successful result.

A task reference contains `_tag: "task"`, `projectId`, and `taskId`.
A file reference contains `_tag: "file"`, `projectId`, `repoId`, `worktreeId`, and a relative `path`.
The resolver in `context.ts` checks these identities at prompt or board-post admission.
Every agent who can currently receive the conversation must be able to read the project.
The sender must also have current project read access.
Services and caller-less reactors cannot admit new references.
File admission reuses the registered local Git workspace and common-directory checks.
It rejects missing files, metadata paths, traversal, and symbolic links.
It never reads file contents.
Remote file search is unavailable before machine pairing.

Search uses actual tracked and nonignored untracked Git paths.
It inherits the Git subprocess byte and time budgets and the 200-file candidate limit.
The combined result has a 64-kilobyte budget before the agent envelope.
The truncation flag distinguishes a bounded search from a complete empty result.
Secret-bearing identities cannot be selected.
Display labels pass through the production redactor.

`prompt` and `board.post` accept an optional `context` array.
Each send accepts at most 16 references and 16 kilobytes of serialized identities.
The ordinary command receipt preserves the admitted array and delivery identity on retry.
The durable queued prompt, sent prompt, board post, and board wake retain typed references.
A wake has a bounded manifest assembled from its admitted posts and completion replies.
Dispatch verifies that manifest rather than resolving additional context without a caller.
Canonical descriptions reach the runner within an untrusted-data envelope.
Owner text and the existing sender envelope retain their original handling.
Old events and payloads without the optional field remain readable.
The future React composer consumes this surface separately.

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
