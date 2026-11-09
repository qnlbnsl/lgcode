# The public local Git commands

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
Repository creation recovery and project lifecycle remain separate work.
