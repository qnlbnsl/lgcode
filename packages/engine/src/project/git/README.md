# The local Git service

`makeGitService({ workspaceFolder })` returns the typed `GitService` interface
from `types.ts`. Its methods return Effect 4 effects with `GitFailure` in the
error channel. The service does not register commands or store project events.

## What the command worker must supply

The workspace folder is a trusted engine setting. The command handler must
check the authenticated caller's project access before calling the service.
A repository path in a request never replaces that setting.

Every reply is raw, bounded local data. Before returning it through the
application programming interface (API), W04 must use the production redactor
on every string, including patches, conflict sides, author names, commit
subjects, paths, branch names and review evidence. The service never attaches
subprocess output or a rejected path to a failure. W04 must not log its raw
replies. Agent text must remain plain text in the page.

## The exported operations

| Operations | Behavior |
| --- | --- |
| `discover`, `register`, `createRepository` | Discover inside the configured folder, validate a checkout, or create a repository on `main`. Registration validates the folder and returns its identity; W04 persists the project record. |
| `branches`, `worktrees`, `createWorktree` | List local branches and controlled worktrees, or allocate a safe branch and folder with a numeric collision suffix. An empty repository uses a real unborn branch, with a null head. The folder lives under the main repository's `.worktrees/`, even when called from a linked checkout. A local `info/exclude` rule keeps generated checkouts out of the parent's changes. |
| `changes`, `diff`, `history`, `commitFiles` | Read real porcelain status, patches, line counts, history and files. A diff defaults to all tracked changes against the head, plus untracked files. `staged: true` selects the index, and `staged: false` selects working files against the index. |
| `state` | Return the head, branch, upstream, ahead and behind counts, and any merge head. With a target ref, return the pending count and earliest unmerged commit's committer date. Without an upstream, sync counts are zero and `upstream` is null. Without a target, pending is zero and `pendingSince` is null. |
| `stage`, `unstage`, `stageAll`, `unstageAll`, `commit` | Mutate the actual index and commit selected changes. Bulk operations exclude conflicts. A resolved merge can be committed with no staged file diff when its merge head still exists. |
| `planDiscard`, `discard` | Obtain a file list and fingerprint, then supply that plan with `confirmed: true`. Only unstaged changes are discarded. Conflicts are excluded, and the staged index is preserved. Edits invalidate confirmation. |
| `fetch`, `pull`, `push` | Synchronize through `origin`. Pull requires an upstream and a clean destination, and only fast-forwards. Push sets the branch's upstream. Fixed failures report missing prerequisites, divergence and recoverable remote errors. |
| `mergeTeam` | Merge a clean source checkout into a clean destination in the same repository. Supply the reviewed source head. A destination on `main` or `master` always refuses. A failed merge can leave real conflicts for resolution. |
| `review`, `openReview` | Read evidence against a local base branch, keyed to both heads. Opening review returns a real GitHub compare URL after checking the published branch head. It creates no approval, provider report or merge. Missing remote, provider and publication prerequisites are explicit failures. |
| `reviewMain`, `approveMain` | Read a complete bounded comparison between registered project and base checkouts. The separate approval method requires the engine-supplied authenticated owner and explicit confirmation, revalidates both reviewed heads and branch identities, and merges the reviewed object into main or master. It refuses incomplete or binary review data, dirty worktrees, and an active merge. It never changes `mergeTeam`'s base refusal. |
| `conflict`, `choose`, `resolve` | Read real index stages and canonical three-way text hunks, choose each hunk, and resolve after rechecking the file and index fingerprint. Both keeps ours, then theirs. Each line retains its newline. Resolution clears the unmerged index entries and leaves the result unstaged for review. Client-supplied segments are never used as write content. |

A conflict's `ours`, `base` and `theirs` fields are complete bounded file
contents. Its segments hold the hunk sides. W04 can obtain branch labels from
the workspace records and `state`. Keep the returned choices and fingerprint
in the client draft and send them to `choose` and `resolve`.

## Bounds and local safety

Default subprocess output is limited to one mebibyte, and standard error is
limited to 16 kibibytes. A patch is limited to 128 kibibytes. Line counts come
from a separate bounded numeric diff, so cutting a patch does not cut that
file's counts. An aggregate diff stops adding untracked files after its patch
is cut; its counts cover the files processed, and `truncated` remains true.
Every list has at most 200 items. Structured output that exceeds its process
limit fails rather than being parsed in part. Bulk mutations refuse a file
list larger than the limit. Limits can be lowered by trusted configuration.

A command has a 10-second timeout. Each complete operation has a 60-second
budget. On timeout, interruption or an output limit, the runner sends the Unix
process group SIGTERM, the termination signal, so Git can roll back its own
locks. It allows at most 250 milliseconds for cleanup before SIGKILL, the
unconditional kill signal. It also kills remaining group members when the
process closes. The first failure reason remains fixed during that grace.
Git resolves its own index and metadata paths, including those of linked
worktrees. The runner never removes a lock file itself, so a pre-existing lock
or another operation's lock is not a cleanup candidate.
The finite operation queue serializes calls on one service instance. Keep one
instance for each workspace setting. The queue admits at most 64 calls.
Discovery visits at most 500 directories and goes three levels deep. It skips
hidden directories and `node_modules`, and stops descending at a repository.
Linked worktrees outside the workspace are omitted from worktree lists.

Git receives argument arrays, with literal pathspecs and no shell. Inherited
Git routing variables are removed. Hooks, filesystem monitors, external diffs,
text conversion and signature display helpers are disabled during reads.
Hooks are also disabled during service mutations. Existing Git signing and
remote authentication settings remain available for explicit mutations.

Real paths must remain inside the workspace. A linked worktree must have
matching Git metadata and a valid backlink. File operations refuse symbolic
links, nested repositories, parent traversal, Git metadata and special files.
These checks prevent accidental path redirection. They are not a sandbox
against a local process racing directory changes between checking and use,
as the existing folder-rule limitation in issue 49 also explains.

## Current limits

The inline resolver supports regular UTF-8 text conflicts with all three index
stages. Binary, add/delete, symlink and submodule conflicts return
`unsupported_conflict` for the terminal workflow. Symbolic-link file operations
and names containing a newline or carriage return also require the terminal.
Bare repositories are not workspace checkouts.

Normal Git signal cleanup makes interrupted staging retryable. If Git cannot
run that cleanup before the forced kill, a lock can still remain and require
inspection through the terminal. The runner does not claim arbitrary stale
locks belong to it. Filesystem races with another local process remain subject
to issue 49. On Windows, termination uses the child-process signal behavior;
Unix process-group cleanup and retry proof do not establish Windows recovery.

Review URLs support GitHub's public host with standard HTTPS or SSH remotes.
Other providers return `unsupported_provider`. Opening review does not create
a pull request or publish the branch. Live provider authentication and public
review creation are not proven by the local bare-remote tests.

Command registration, API authorization, durable reported evidence and approval
outcomes, redaction, and generated tools live in the project integration layer.
Owner approval clears the destination branch's merge options for that invocation
and explicitly selects the standard strategy, fast-forward support, a commit,
and no squash or autostash. It preserves the stored Git configuration.
After Git exits successfully, it reads the destination head and verifies that
the reviewed commit is its ancestor before returning success. A contained
commit can succeed without moving the head. Failed verification preserves the
actual checkout state for inspection and returns a failure, never a merge claim.
The service receives the trusted caller from that layer for `approveMain` and
refuses absent, agent, service, and piece callers. A payload flag never replaces
the owner credential. The API documents receipt retries and the concrete crash
boundary between external Git effects and the database. Remote-machine routing
remains separate work.
