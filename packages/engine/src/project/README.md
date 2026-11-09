# Real project creation and lifecycle

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

# Recovering unfinished creation

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

# Editing and archiving projects

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
