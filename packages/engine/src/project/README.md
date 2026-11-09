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
The complete `result` object has a 65,536-byte budget, including `items` and `truncated`.
The count uses JavaScript Object Notation (JSON) encoded in the eight-bit Unicode Transformation Format (UTF-8).
This budget excludes the reply's `requestId` and the agent envelope.
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

`project.placement.preview` accepts the same placement input as `project.create`.
It calls the same authoritative selector against the current repository and filesystem.
It returns the observed repository folder, checkout folder, branch, and checkout type.
It returns `reserved: false` because creation must check the placement again.
It creates no intent, directory, branch, receipt, account login, or lead.

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

## First-run progress and discovery

The owner reads `project.setup` and advances with `project.setup.advance`.
Progress moves through Welcome, Found, and Project without moving backward.
`project.setup.complete` records positive completion against a successfully created project.
Its timestamp survives restart and the archive of every project.
Authentication remains the prerequisite for these owner-only commands.

`project.setup.discover` reads the configured workspace and supported local harnesses.
It returns actual repositories, install guidance, and the normal ready launch defaults.
Its fixed failure asks the owner to retry or change the workspace through `project.settings.set`.
The scan never materializes a Codex shadow home, installs software, changes login state, or starts an agent.
Local account results distinguish a missing executable, signed-out state, unavailable evidence, and a recognized local credential.
Every account result says remote authentication was not checked.
The scan and project creation share the provider-specific effective-home and credential rules.

Owner settings include a durable, editable `displayName`.
The settings read and discovery can suggest the actual configured Git `user.name`.
An absent suggestion remains absent.
The name is redacted display prose and grants no authority.

## Repository mock revisions and approval

An owner or an agent in the project records a complete bounded bundle with `project.mocks.record`.
The caller supplies the expected previous revision, preventing lost concurrent updates.
The request identity becomes the immutable revision identity.
An existing revision identity cannot be reused by another caller, even after the head advances.
Identical retries by the original caller still return their durable receipt.
The event records the actual author, timestamp, artifact fingerprints, and schema comparisons.
`project.mocks.read` pages revisions within 256 kibibytes, including the agent data envelope.
`project.mocks.artifact` returns bounded, redacted repository text or an explicit unavailable result.

Sources distinguish screens, data, tokens, and component indexes.
Each source names a registered project checkout and a confined relative file.
Screen files are data artifacts of at most 8 kibibytes.
Data and component indexes require JavaScript Object Notation files with the same bound.
Tokens can also name a Cascading Style Sheets file, returned only as text data.
A data schema has the form `{ "Entity": { "field": "type" } }`.
Draft fields can name their source, entity, and affected screens.
Comparisons report New, Matches, Differs, or Unavailable against the actual file.
Unsupported or missing schema evidence remains unavailable.
Approval derives its implementation changes from the actual comparisons.
Draft field identity consists of its entity and field name together.
The removed experimental `bundle.schemaChanges` input is explicitly forbidden at admission.
It cannot be silently stripped as an excess property.
Declared removals are unsupported; this contract supplies evidenced additions and type changes.

Screen routes and preview origins are validated metadata.
Every screen records exactly one concrete route for every typed scenario identity.
Scenario display names never determine these bindings.
The engine refuses unknown or duplicate bindings, external routes, and brace placeholders.
The engine never fetches a preview origin, evaluates a component, or starts a preview command.
The web client must keep preview code outside its application authority.
Component references require matching repository byte fingerprints.
Their screen references must identify screens in the recorded bundle.
Omitted screen references mean that the relationship was not reported.
A change from Draft to Shared also requires a different evidenced repository reference.
An in-memory provenance flag does not establish that a file was moved.

Projects without screens begin in Plan and omit Design.
Recording screens moves the project into Design.
Stage-derived team labels use their areas to distinguish teams at the same stage.
Only the owner can approve the current revision through `project.mocks.approve`.
Approval rechecks the actual source and component fingerprints and refuses changed or unavailable evidence.
It records the reviewed revision, screens, remaining draft components, fields, and derived schema changes.
It advances to Plan and queues one durable handoff to the recorded project lead.
Retries use the normal durable receipt; fresh duplicate and stale approvals refuse.
The strict mock-specific reach predicate rechecks the project, approval, revision, and lead during later dispatch.
An obsolete queued handoff is withdrawn.
The handoff creates no fixed teams, tasks, or conversations.

## Registered repository Design evidence

`project.design.record` records an explicit repository, registered workspace, and relative design file.
Its revision identity is unique within the repository across all authenticated callers.
The caller must own the project or be one of its agents.
Registration checks the workspace's real checkout, branch, and common Git directory.
It requires an actual bounded `.fig`, `.pen`, or `.json` file of at most one mebibyte.
It never invents a path or launches an editor.
An optional token document contains at most 64 named values in 8 kibibytes of JSON.
Its path must pass public admission as a confined relative JSON-file path.
Raw secret probes, traversal, absolute paths, and credential-file references refuse before a recorded event.
Each optional shared component names an actual repository reference with a matching byte fingerprint.
Each component file is bounded to 64 kibibytes.

`project.design.read` takes the repository identity and an optional exact revision identity.
An agent must also identify its own project in that repository.
The read preserves the registration, authenticated author, event time, and recorded fingerprints.
It compares the current file, tokens, and component bytes with their recorded fingerprints independently.
Changed, missing, redirected, or inaccessible evidence returns explicit artifact unavailability.
An absent registration returns explicit repository Design unavailability.
Available tokens contain actual bounded, redacted values.
No availability result asserts that an editor or isolated preview can run.

A mock bundle may explicitly name `designRevision`.
The revision must belong to the project's repository.
Recording and approving the mock both recheck all required Design evidence against that exact revision.
An omitted Design identity stays absent.
The page must never derive a design file path from a repository or component display name.
