# Shephrd: problems found

A running list of problems found while building or using Shephrd. Add a
problem here in the same change that finds it, even if it is not fixed yet.
Never delete an entry; mark it fixed and say where.

Each entry uses this shape:

```
## <number>. <what is wrong, in one line>

Found: <date>, while <doing what>.
State: open | fixed in <commit or pull request>.

What happens: <the observed behaviour>.
What should happen: <the expected behaviour>.
Why it matters: <the cost, such as wasted turns, lost messages, or a security risk>.
```

## 1. The engine's event log has no retention rule

Found: 2026-11-01, while writing the engine design
(`docs/specs/2026-11-01-engine-design.md`).
State: open.

What happens: the first version of the engine keeps every event forever,
including every streamed message and tool call of every agent.
What should happen: old events are summarised or archived by a rule the
owner can set, without breaking the rebuild of the views or a client's
catch-up from a sequence number.
Why it matters: the SQLite file grows without limit, and starting the
service gets slower as the log it rebuilds from gets longer.

## 2. Node.js 26 ships without pnpm or Corepack

Found: 2026-11-01, while installing Node.js 26.13.0 with nvm.
State: worked around on the owner's host on 2026-11-01: pnpm 12.16.1 is
installed with pnpm's standalone installer, in `~/.local/share/pnpm/bin`.
The README's setup steps still need to say this.

What happens: Node.js 26 installs only `node`, `npm` and `npx`. Corepack,
which older Node.js versions used to provide pnpm, is no longer bundled, so
`pnpm` is not available under Node.js 26.
What should happen: the build plan installs pnpm for Node.js 26 at the
version named in the root `package.json` before unit 1 runs
`pnpm install`.
Why it matters: every build step and `pnpm check` need pnpm; without it,
unit 1 fails at its first command.

## 3. The plan names a build policy removed from pnpm 12

Found: 2026-11-01, while building the unit 1 workspace.
State: fixed by the unit 1 workspace configuration.

What happens: decision 39 and criterion 1.6 name `onlyBuiltDependencies`,
which pnpm removed in version 11. An empty `allowBuilds` policy correctly
blocked the compiler's post-install script on pnpm 12.16.1.
What should happen: the workspace uses pnpm's current `allowBuilds` policy
and fails when an unreviewed dependency asks to run a build script.
The workspace retains the plan's explicit `onlyBuiltDependencies` list for
its acceptance check. Both lists allow only `@tsc-rs/typescript` 0.8.0,
whose script was read and only optimizes its local compiler launcher.
Why it matters: the obsolete setting alone does not enforce the plan's
security requirement. The current setting must enforce the same minimal
list. The pnpm 12 documentation confirms the replacement:
https://github.com/pnpm/pnpm/blob/v12.15.0/pnpm/docs/settings/build.md
(read 2026-11-01).

## 4. A transitive platform dependency drifts beyond Effect 4.0.5

Found: 2026-11-01, while installing the unit 1 workspace.
State: fixed by the unit 1 workspace overrides.

What happens: `@effect/platform-node` 4.0.5 accepts
`@effect/platform-node-shared` 4.1.1, which requires Effect `^4.1.1`.
`pnpm peers check` reports this mismatch with the required Effect 4.0.5.
What should happen: the platform packages and Effect resolve to 4.0.5.
The workspace pins the shared package and overrides these transitive edges.
Why it matters: a clean install otherwise silently combines incompatible
library versions before the copied packages or the socket client use them.

## 5. The original package graph omits later approved dependencies

Found: 2026-11-01, while reconciling unit 1 with the decision log.
State: fixed by the unit 1 package manifests.

What happens: decision 23 says the testing package depends on contracts
and copied packages only. Decision 71 adds its client dependency. Decision
59 also adds the command-line package's engine and tool-server dependencies,
and the engine's development dependencies on client and testing.
What should happen: the manifests follow decisions 59 and 71, with the
engine's client and testing dependencies used only for development.
Why it matters: the original graph cannot support the later fixture
recorder and acceptance tests. The revised graph remains acyclic.

## 6. The compiler needs Node.js types selected explicitly

Found: 2026-11-01, while type-checking the unit 1 smoke tests.
State: fixed by `types: ["node"]` in the shared TypeScript configuration.

What happens: the compiler used by the T3 reference checkout does not
automatically select the workspace's installed Node.js types for the
engine package. The smoke tests fail to resolve `node:fs`, `node:sqlite`
and `process`, even though `@types/node` is installed.
What should happen: every package selects the shared Node.js type library.
Why it matters: the frozen smoke tests and later engine units require
Node.js built-in modules to type-check.

## 7. A symbolic link to the launcher runs from the wrong folder

Found: 2026-11-01, in the unit 1 review.
State: fixed in unit 2: `bin/shephrd` follows links, and
`launcher-links.test.ts` covers it. Commit: 87e2d4c. The first fix used
`readlink` from `PATH`; issue 20 replaced that.

What happened: `bin/shephrd` found its checkout with `dirname "$0"` and does
not follow a symbolic link to the file itself. A link such as
`~/.local/bin/shephrd -> <repo>/bin/shephrd` makes it look for
`bin/stub-entry.ts` next to the link, and Node.js exits 1 with
`Cannot find module`.
What should happen: the launcher resolves its own path through any links,
or prints a clear message when the entry file is missing.
Why it matters: a link on the path is a likely way for the owner to run
`shephrd` from any terminal.

## 8. The launcher looks up `dirname` on the path

Found: 2026-11-01, in the unit 1 review.
State: fixed in unit 2: the launcher uses `${self%/*}` instead of `dirname`.
Commit: 87e2d4c. The first fix still ran `readlink` from `PATH` before the
chosen Node.js, which the focused review found; issue 20 fixed that, so now
only shell builtins and the chosen Node.js run.

What happened: `bin/shephrd` ran `dirname` from `PATH`. Decision 22 allows
a path lookup only for `node`.
What should happen: the launcher uses shell parameter expansion, so
`node` is the only program found through `PATH`.
Why it matters: a hostile path could run another program first. The risk
is low, because such a path already controls the permitted `node`
fallback, and the fix costs nothing.

## 9. The `onlyBuiltDependencies` list is not enforced on pnpm 12

Found: 2026-11-01, in the unit 1 review (adds to issue 3).
State: fixed by decisions row 77 (owner, 2026-11-01: "yes, rename it to
allowBuilds"), in this commit. Criterion 1.6 and its test name `allowBuilds`
with `strictDepBuilds: true`, and the unenforced `onlyBuiltDependencies` list
is deleted from `pnpm-workspace.yaml`. An earlier note at the old key was
added in unit 2 (commit: 87e2d4c).

What happens: a probe on pnpm 12.16.1 showed that `onlyBuiltDependencies`
neither allows nor blocks a build script. `allowBuilds` and
`strictDepBuilds` are the real policy, so the two lists must be kept equal
by hand. The allowed compiler install script also runs the native compiler
once with `--version`, which issue 3 does not say.
What should happen: the workspace file says at the old key that it is not
enforced, and the plan's criterion 1.6 names the setting pnpm 12 reads.
Why it matters: a reader who edits only the old list changes nothing.

## 10. The compiler alias and two copied cache settings are unexplained

Found: 2026-11-01, in the unit 1 review.
State: fixed in unit 2: a comment in `pnpm-workspace.yaml` names T3 Code as
the reason for the alias, and the two cache variables are removed from
`vitest.config.ts` because no test reads them. Commit: 87e2d4c.

What happened: `pnpm-workspace.yaml` aliased `typescript` to the pre-release
`@tsc-rs/typescript` 0.8.0 with no comment. It matches the T3 Code
reference, which plan check PB-A6 requires, but nothing in this repository
said so. `vitest.config.ts` also set `VP_REMOTE_CACHE` and
`VP_REMOTE_CACHE_URL`, which only the vite-plus tool reads; Shephrd runs
plain Vitest.
What should happen: one comment names T3 Code as the reason for the alias,
and the two cache variables are removed or credited to T3 Code.
Why it matters: a later reader sees an unusual compiler and settings that
do nothing, with no stated cause.

## 11. Herdr refused the plugin manifest: an action needs `title`

Found: 2026-11-01, by the owner's step for criterion 1.4 on Herdr 0.9.3.
State: fixed in `herdr-plugin.toml`; the owner re-runs the link.

What happened: `herdr plugin link` stopped with "TOML parse error at line 10,
[[actions]]: missing field `title`". The `serve` action had `name = "Start
Shephrd"`, but Herdr names an action's label `title`, as the Synapse
manifest does. Neither the plan's task 1f nor the unit 1 manifest test named
the field, so the test passed.
What should happen: each `[[actions]]` entry has `id`, `title`, `contexts`
and `command`.
Why it matters: Herdr cannot load Shephrd at all until the manifest parses.

## 12. The copied SQLite client needed changes for Node.js 26 types

Found: 2026-11-01, in unit 2.
State: fixed in the copy; recorded in `third_party/t3code/README.md`.

What happened: T3 Code builds against `@types/node` 24, where the `error` event
of a worker thread carries an `Error`. The workspace catalog pins
`@types/node` 26, where it carries `unknown`, so the copied
`nodeSqliteClient.ts` failed to type-check at two `worker.on("error")` handlers.
The copy now turns the value into text with an `instanceof Error` check.
What should happen: when T3 Code's file is copied again, the same two edits are
applied again.
Why it matters: an unrecorded edit would be lost on the next copy.

## 13. Some copied ACP logging calls are on even when protocol logging is off

Found: 2026-11-01, in the unit 2 security read.
State: fixed in unit 7a.

What happens: decision 57 says the copied ACP protocol debug logging stays off
outside tests. That is true of `logProtocol` in `effect-acp/src/protocol.ts`
(lines 263-272), which the `logIncoming` and `logOutgoing` options gate. Four
other calls are not gated: `protocol.ts` lines 503 and 599, and
`_internal/shared.ts` lines 37 and 53. They log the cause of a handler defect or
an encoding failure, which can include a value the handler held. Line 547 logs
only structural diagnostics.
What should happen: the service's logger passes through the redactor before
Shephrd registers any extension handler, and a test greps its output for
planted secrets, as decision 57 requires. Shephrd never sets `logIncoming`,
`logOutgoing` or `logger` outside tests.
Rule for the units that run ACP (6a, 6d and 7a): install the redacting service
logger before constructing any ACP runner or handler. Keep wire logging off,
except behind the temporary-home test gate of decision 74. Test planted secrets
through four paths: the core path, notification handlers, extension-handler
defects, and encoding failures.
Why it matters: until then, a handler defect could write a secret to the log.
No Shephrd code registers a handler yet, so nothing leaks today.

What changed in unit 7a: the service installs the redacting logger before
building the runner or handler. The registry includes the owner credential,
the removed inherited service token, inherited provider credentials, stored
account secrets, and all stored agent and device credential hashes. Protocol
payload logging is enabled only by its exact test flag after the real
temporary-folder check. Malformed adapter frames still produce a fixed
diagnostic.


## 14. Copied environment helpers default to the whole process environment

Found: 2026-11-01, in the unit 2 security read.
State: open; belongs to the unit that starts harness processes.

What happens: `mergeProviderInstanceEnvironment` (`instanceEnvironment.ts`) and
`makeClaudeEnvironment` (`ClaudeHome.ts`) use `process.env` when the caller
passes no base environment.
What should happen: Shephrd always passes an explicit base environment, so an
agent gets exactly `SHEPHRD_SOCKET` and `SHEPHRD_TOKEN` and what the harness
needs, as decision 57 says.
Why it matters: a call without the argument would hand every variable of the
service to a harness process.

## 15. The copied fake-program helper writes environment values to disk

Found: 2026-11-01, in the unit 2 security read.
State: open; a rule for test authors, not a code change.

What happens: `writeFakeCli` in `provider-testing/src/fakeCli.ts` writes the
environment it is given to a JSON file next to the stub, with the default file
mode.
What should happen: tests pass only made-up values to it.
Why it matters: a real token passed to it would sit in a temporary folder.

## 16. The ACP schema generator cannot finish in Shephrd

Found: 2026-11-01, in the unit 2 security read.
State: open; low priority.

What happens: `effect-acp/scripts/generate.ts` downloads schema files from
GitHub and ends by running `pnpm exec vp fmt`. The `vp` program belongs to the
vite-plus tool, which Shephrd does not install, so the last step fails after
the files are written.
What should happen: if Shephrd regenerates the schemas, the formatting step is
replaced by a Shephrd tool, and the change is recorded in the README table.
Why it matters: someone running `generate` gets a confusing failure.

## 17. T3 Code has no unit test for the replay helpers

Found: 2026-11-01, in unit 2.
State: fixed; recorded in `third_party/t3code/README.md`.

What happened: criterion 2.4 needs a test named `replayTranscript.test.ts`, but
T3 Code has none for `provider-testing`. A test was written for Shephrd, with
a fixture, and the README table marks both as written for Shephrd.
What should happen: nothing further.
Why it matters: the copied helpers would otherwise have no test at all.

## 18. The first-party packages did not depend on the copied packages

Found: 2026-11-01, in the focused review of unit 2.
State: fixed in the commit "fix(unit-2): link the copies, harden the checker and launcher" (unit 2 fix round 1); `copied-package-edges.test.ts` covers it.

What happened: after a frozen install, `import.meta.resolve` failed with
`ERR_MODULE_NOT_FOUND` from `packages/engine` and `packages/testing` for the
copied packages. Decision rows 23 and 71 require these edges before the
manifests freeze.
What should happen: `engine` depends on `@shephrd/t3-effect-acp`,
`@shephrd/t3-node-sqlite` and `@shephrd/t3-provider-instance`. `testing`
depends on `@shephrd/t3-effect-acp` and `@shephrd/t3-provider-testing`, all as
`workspace:*`. Nothing depends on `@shephrd/t3-source-control`, which has no
planned consumer. `testing` does not depend on the provider-instance copy,
because unit 8a's fake agent only needs the protocol library and the replay
helpers; unit 8a's harness defaults and environment builder live in `engine`.
Why it matters: the manifests freeze after unit 2, so a missing edge would
force an unplanned change to a frozen file.

## 19. The credit checker accepted names it had not credited

Found: 2026-11-01, in the focused review of unit 2.
State: fixed in the commit "fix(unit-2): link the copies, harden the checker and launcher" (unit 2 fix round 1); `credits-names.test.ts` covers it.

What happened: three inputs made `scripts/check-credits.sh` exit 0. A path with
a newline whose fragments matched credited files was split into lines. A symbolic
link under a package was skipped, because the search listed regular files only.
A package folder named `effect-acp.*`, missing from `NOTICE`, matched because
the folder name was used as a regular expression.
What should happen: the checker fails on any path with a control character, on
any entry that is not a regular file or a folder (a symbolic link is rejected,
not listed), and compares `NOTICE` package names as text.
Why it matters: the check is the only guard that every copied file is credited.

## 20. A linked launcher ran `readlink` from `PATH`

Found: 2026-11-01, in the focused review of unit 2.
State: fixed in the commit "fix(unit-2): link the copies, harden the checker and launcher" (unit 2 fix round 1); `launcher-readlink.test.ts` covers it.

What happened: with `PATH` holding only the link's folder, the launcher exited 1
with `readlink: not found`, and a substituted `readlink` would have run.
What should happen: the launcher chooses Node.js first, and when it is started
through a link, asks the chosen Node.js for its real path. No command other
than the chosen Node.js and shell builtins runs.
Why it matters: decision 22 allows a `PATH` lookup for `node` only.

## 21. The security read overstated how the generated schema files were checked

Found: 2026-11-01, in the focused review of unit 2.
State: fixed in the commit "fix(unit-2): link the copies, harden the checker and launcher" (unit 2 fix round 1).

What happened: `SECURITY-REVIEW.md` said "read, no findings" for the three
generated schema files, which hold 19,457 lines. They had been scanned, not read.
It also said the child's standard error is discarded, but the copied Stdio
service only discards its own writes and does not drain the child's `stderr`.
What should happen: the review states the scan commands, marks the rows
"scanned, not read line by line", and tells unit 6a to drain and redact the
child's standard error.
Why it matters: a review that claims more than was done hides the gap.

## 22. Rule 2 and the commit-message hook disagree about vendor-named files

Found: 2026-11-01, in the focused review of unit 2.
State: fixed. Owner, 2026-11-01: "update the commit hook to how t3 works. i
only do not want the co authored by line. our commit guard is too aggressive."
The global commit hook now rejects only a Co-Authored-By trailer. Copied T3
Code files are named in full in commit messages from now on (rule 2). Pushed
commit 87e2d4c is not rewritten: `third_party/t3code/README.md` stays its
record.

What happens: rule 2 says to name each copied source file in the commit message.
The commit-message hook rejects vendor words, and four T3 Code files carry one
in their names: the first harness's home file (`ClaudeHome.ts`), the second
harness's home layout (`CodexHomeLayout.ts`) and its test, and the second
harness's managed home (`CodexManagedHome.ts`). Commit 87e2d4c therefore names
them in neutral words, as the lead instructed. The table in
`third_party/t3code/README.md` is the record of every source file.
What should happen: the owner decides whether the hook should allow file paths.
Until then, commit messages name `third_party/t3code/README.md` as the file list.
Why it matters: the rule and the hook cannot both be followed to the letter.

## 23. Task 3d has no event for "agent start failed"

Found: 2026-11-01, while writing the unit 3 tests.
State: answered by the lead on 2026-11-01: row 70 (closed, later than the list in task 3d) wins, so
"agent start failed" is a fortieth event, carrying a reason. The unit 3 tests now include it
(from starting the agent becomes stopped; invalid in every other state). The builder adds it to
`events.ts`; the plan's task 3d list should be amended. Unit 3 now defines
`AgentStartFailed` with the agent id and reason, and its starting-to-stopped cell.

What happened: the lifecycle command table in the plan (line 532, row 70) says
`start` writes "agent start failed" when the adapter rejects a value, and
criterion 6.11 refers to it. The list of events in task 3d (39 events) has no
such event, so the event union could not record the failure.
The focused review also found that the account picker and recovery timers need
an account-level usage event. The lead's fix-round-1 ruling adds
`AccountOutOfUsage`, with an optional reset deadline, as the forty-first event.
The current list is task 3d's 39 events, row 70's `AgentStartFailed`, and the
lead's `AccountOutOfUsage`. Both additions are now defined in unit 3.

What should happen: task 3d's list is amended to 41 events. Without it,
unit 5 and unit 6 would have no event to write for a rejected starting value,
and would invent one outside the shared definitions.
Why it matters: the shared definitions must hold every event the engine writes.

## 24. The unit 3 review left four details for later units

Found: 2026-11-01, in the focused review of unit 3.
State: deferred by the lead's fix-round-1 rulings.

- `PromptSent` repeats the prompt text from `DeliveryQueued`. Decided in unit 4a (2026-11-01): the log keeps both copies and changes no contract. The two events happen at different times, a queued prompt can wait a long time, and a thread reader needs `PromptSent` to stand alone. The cost is one extra copy of each prompt in the log. Each copy passes through the redactor on its own.
- `SessionOpened.process` overlaps the transactional process side rows. Decided in unit 4a (2026-11-01): the event keeps the historical snapshot, and the `processes` row, written in the same transaction by `EventLog.append`, is the operational record that the restart sweep reads. Neither is derived from the other.
- `CommandRefused.reason` is free text; unit 5 must keep request content, including secret values, out of it.
- `adapterPath` accepts `/../x`; unit 6 resolves the absolute path before spawning the adapter.
- The review's remaining minor mutations, M9 and M12, are not covered by tests in this round.

What should happen: the named units resolve the deferred details, and the test
coverage gaps remain visible until a later review addresses them.
Why it matters: passing the shared-schema tests does not settle runtime
redaction, process bookkeeping, path resolution or every mutation check.

## 25. The first shared contracts missed recovery and secret-handling details

Found: 2026-11-01, in the focused review of unit 3.
State: fixed by the unit 3 fix-round-1 source changes.

What happened: the secret-setting request decoded its value as plain text, so
ordinary inspection could expose it. The state table refused the direct
interrupted-to-idle and interrupted-to-working changes that decision 66 requires.
The subscription stream omitted event identity, time and caller metadata.
The production service group existed only as a comment, the secret-name rule
missed password and authentication variants, and displayed states had no shared
schema.
What should happen: secret ingress decodes to an Effect Redacted value,
successful reloads can commit their resulting state, and subscriptions carry a
shared event envelope. The production group excludes diagnostics by construction.
Account environment names also recognize PASSWD and CREDENTIAL variants and
the AUTH segment, and displayed states have a literal schema.
Why it matters: every later engine unit consumes these contracts, so missing
security and recovery rules would otherwise propagate into the implementation.

## 26. The unit 8a tests cannot reach every secret-handling path in issue 13

Found: 2026-11-01, while writing the unit 8a tests.
State: open.

What happened: issue 13 asks for planted secrets to be tested through the core,
notification, extension-defect and encoding-failure logging paths. The fake agent
tests drive a real session, so they reach the core and notification paths only
when a step makes the client log them, and the session test asserts that nothing
is logged with wire options off. The extension-defect and encoding-failure paths
need a peer that sends a malformed frame or a failing extension handler, which no
step in criterion 8.1 produces. The redacting service logger of units 5a and 7a
does not exist yet, so the tests install a logger that records every message and
cause, and they check that no planted secret appears in it or in the adapter's
standard error.
What should happen: units 6a, 6d and 7a add a malformed-frame step to the fake
agent, or their own tests, and run the planted-secret check through the real
redacting logger.
Why it matters: without them, a secret in a defect or encoding failure could pass
every unit 8a test and still reach a log.

A related trap: the callback that `it.layer(...)("name", (it) => ...)` passes in
`@effect/vitest` offers `it.effect` but not `it.live`, so a test that needs the
real clock must call the top-level `it.live` and provide its layer itself, as the
unit 8a tests do.

## 27. Two fake-agent assertions used wire identifiers after client normalization

Found: 2026-11-01, while implementing unit 8a.
State: fixed by the test writer in 02ec6e6, merged with the lead's approval.

What happened: the copied client converts version 2 configuration option
`configId` fields into compatibility `id` fields. Two frozen tests expected the
wire field after that conversion, so a conforming agent could not pass them.
What should happen: assertions after the client use its compatibility shape.
The fake agent and recorded frames keep the actual wire representation.
Why it matters: the fake must exercise the protocol rather than compensate for
an assertion by changing a real protocol frame.

## 28. The pinned adapter and the fake agent report different protocol versions

Found: 2026-11-01, in the installed first adapter's
`claude-agent-acp` 0.99.1 `dist/acp-agent.js`, initialize response at line 1416.
State: handled in the unit 8a recorder; the live check remains owner-run.
The live run at 4a5ad12 negotiated protocol version 2 with the pinned Claude adapter.

What happened: the pinned adapter's source reports protocol version 1, while the
fake agent tests require version 2. A recorder that demands version 2 rejects
that pinned adapter before it can record anything. The external harness source
can also expose modes without a mode configuration option.
What should happen: the recorder offers version 2 and records the actual
negotiated version. It distinguishes response shapes, uses the configuration
option command in both versions, and refuses a harness without that option.
It does not fall back to the older mode command or to a default permission.
Why it matters: the frozen tests prove the fake's journey, but they cannot prove
that every owner-installed harness supports the required recording interface.
The owner-run command must surface that incompatibility instead of producing a
fixture from an unconfirmed permission mode.

## 29. Recording needed account identity removal and nonfatal sign-out probes

Found: 2026-11-01, in the focused review of unit 8a at 99b70b8.
State: fixed in the unit 8a follow-up.

What happened: inbound extension frames could carry an account's email,
organization and identifier into a fixture. Text scrubbing missed email,
universally unique identifiers and several credential shapes. An empty-home
probe without an authentication error also failed an otherwise valid recording.
What should happen: the recorder discards every inbound extension frame before
retention and reports only a count. Text scrubbing removes account identity,
additional token shapes, long hexadecimal values and complete private key
blocks. Protocol session identifiers retain their reference identity.
A missing sign-out observation is reported without replacing an unverified
sample or failing the command. Diagnostic fake steps exercise stderr draining
and subprocess cleanup, and a version 1 wire mode exercises the pinned adapter's
initialize shape.
Why it matters: committed fixtures must not expose account identity or secrets,
and an optional observation must not prevent an ordinary recording.

## 30. Later engine units and the live recording have three review seams

Found: 2026-11-01, in the focused review of unit 8a.
State: open for the named later work.

Unit 6a adds the named `ReplayParseError` and harness permission mapping exports
when it needs them. Unit 8a does not add unused exports.
Harness-path overrides introduced through settings must also be absolute paths.
The owner must read the first generated `claude.ndjson` before committing it.
The lead tells the manager this when requesting the owner-run recording.

## 31. The event log's agent column covers only events with a top-level agent id

Found: 2026-11-01, in unit 4a.
State: open.

What happened: `EventLog.append` fills `events.agent_id` and the envelope's
`agentId` from the event's own `agentId` field. Events that name an agent
elsewhere, such as `DeliveryQueued` (its `delivery.target`), or that name no
agent, such as account and device events, get a null `agent_id`.
What should happen: unit 4b, when it filters a thread by agent, either reads
the payload for those events or the contracts name one agent field for every
event that belongs to a thread.
Why it matters: a subscriber that filters on the column alone would miss a
queued delivery in the target's thread.

## 32. A failed database commit left the copied SQLite client's transaction open

Found: 2026-11-01, in the unit 4a review.
State: fixed in `third_party/t3code/node-sqlite/src/nodeSqliteClient.ts`.

What happened: the copied client (from T3 Code,
`packages/shared/src/nodeSqliteClient.ts`) passed no `onCommitFailure` to
`Client.make`. SQLite can keep a transaction open after the database commit
command (`COMMIT`) fails, for example on a deferred foreign-key violation.
The rows of the failed batch stayed on the writer connection.
The next transaction on it was unsafe.
What should happen: a failed COMMIT is rolled back on the same connection. If
that rollback fails too, the connection is not reused.
The fix: `onCommitFailure` runs the database rollback command (`ROLLBACK`)
and counts SQLite's "no transaction is active" error as clean.
A failed rollback poisons the connection.
Each later hand-out retries the rollback first, as Effect's `makeSqliteAcquirers`
does. The client's acquirers and reader routing are unchanged.
Why it matters: the event log promises that a batch is written whole or not at
all, and the next append must not run inside a leftover transaction.

## 33. The unit 4a review left two rules for later units

Found: 2026-11-01, in the unit 4a review.
State: open.

- Unit 4b must publish a newly committed batch itself and must not treat a
  receipt replay as a new batch, because `EventLog.append` returns the stored
  envelopes for a repeated request id and a subscriber would see them twice.
  The unit 4a review found this as F1.
- The device writes and token revocation that unit 5a adds must follow the same
  rule as decision row 32: each is written in one transaction, through
  `EventLog.append`, together with the event that records it.

## 34. The recorded fixtures carry the owner's installed skill and command lists

Found: 2026-11-01, when the manager read the first recorded fixtures.
State: fixed by owner ruling, 2026-11-01: "keep them". The recorded fixtures
keep the full skill and command lists; no trimming and no new scrubber rule.

What happened: `packages/testing/fixtures/claude.ndjson` (lines 5 and 13-15,
about 50 KB each) and `codex.ndjson` (line 5), and the third harness's `cursor-out-of-usage.ndjson` (line 10,
about 29 KB, recorded at e93bb00), hold the adapters'
`available_commands_update` notifications. These list every skill and command
installed on the owner's machine, with their descriptions. The manager found
no email address, organization, account id, home path or key in either file.
What should happen: the owner decides whether these lists may stay in the
repository. If not, the recorder drops or trims `available_commands_update`
before it keeps a frame.
Why it matters: the lists describe the owner's private setup, and they would
become public if the repository ever did.

## 35. The fixture recorder stops every harness when one adapter reports no version

Found: 2026-11-01, in the owner-run `pnpm record-fixtures` at 4a5ad12.
State: fixed in the unit 8a recorder, round 2.
Left open, minor: a signed-out probe that crashes before it shows an
authentication error is reported both under `failed` and as
`signedOutNotObserved`. The command still exits 1, so the owner sees it.
The report line should drop `signedOutNotObserved` when the probe failed.

What happened: Cursor's `agent acp` (version 2026.10.14-941492e, from
`agent --version`) reports no version in its initialize reply.
`packages/engine/scripts/recorder.ts` line 235 then throws "Adapter did not
report its version", which aborted the run after the Claude and Codex
fixtures were written. The signed-out probes and the `errors/` samples were not
written. In the same run, the pinned Claude adapter negotiated protocol
version 2, not the version 1 that issue 28 read from its source.
What should happen: the recorder takes the version from the harness's own
`--version` output when the adapter reports none, or records it as unknown. A
failure in one harness is reported for that harness and the run goes on to the
others.
Why it matters: one harness's gap must not block the recordings and samples of
the others.

## 36. The fixture scrubber misses identifiers joined by an underscore

Found: 2026-11-01, by the lead, reading the re-recorded `cursor.ndjson` at 0318c78.
State: fixed in the unit 8a recorder, round 3; the third harness is re-recorded
by the owner after the merge.

What happens: the third harness lists the owner's synced skills by names of
the form `synced-<id>_<id>-<skill>`. The two ids look like account or
organization identifiers. `scrubText` in `packages/engine/scripts/recorder.ts`
(line 41) replaces identifiers only between word boundaries, and the
underscore is a word character, so neither id matches and both stay in the
fixture. The rule for hex of 32 or more characters (line 39) has the same flaw
next to a letter, a digit or an underscore.
What should happen: an identifier or a long hex value is replaced wherever it
appears, whatever character is next to it, except the protocol session ids the
recorder maps.
Why it matters: an account or organization identifier would reach a committed
fixture. The fixtures committed at 6be2478 do not contain these names; each
holds only its protocol session id.

## 37. The fixture scrubber redacts every environment value of eight or more characters

Found: 2026-11-01, by the manager, in the owner-run re-record at 0318c78.
State: open.

What happens: `scrubText` replaces every value of the parent environment that
is eight or more characters long. Under pnpm, `npm_package_name` was
`shepherd` when this was found (the product is now called Shephrd, whose
seven-letter package name is below the limit, but the same over-scrubbing
applies to any longer value), so ordinary text such as a source note naming
`shepherd-engine` becomes `<redacted>-engine`. The re-recorded
`errors/cursor-out-of-usage.json` was over-scrubbed this way, so the earlier
committed copy was kept.
What should happen: the scrubber redacts the values of account variables and
of names that can hold secrets, and leaves well-known values that are not
secret, such as the package name, version and script name.
Why it matters: over-scrubbing is the safe direction, but it corrupts the
fixtures' text and can hide real differences between recordings.

Rechecked: 2026-11-02, against the live-check recordings from engine 71d13c1.
The refreshed first and second harness recordings both keep
`shephrd-recorder`, and neither has an over-redacted ordinary word.
The second recording's `msg_<redacted>` is a scrubbed message identifier.
The cause remains in `packages/engine/scripts/recorder.ts`, line 26:
`scrubText` still adds every environment value of eight or more characters
to its replacement list, without checking the variable name.
Calling it with `npm_package_name: "shepherd"` changes `shepherd-recorder`
to `<redacted>-recorder`; using `npm_package_name: "shephrd"` leaves
`shephrd-recorder` intact.
The symptom disappeared because the package name is shorter, so this issue
stays open, as issue 192 also records.

## 38. The third harness's greeting fixture records an out-of-usage reply

Found: 2026-11-01, by the lead, reading the `cursor.ndjson` recorded at e93bb00.
State: open. The fixture is committed as recorded, and the owner ruled on it.
Owner, 2026-11-01: "yes" (keep the out-of-usage sample as
`cursor-out-of-usage.ndjson`; a normal Cursor recording is added after the
account resets, by the owner). The file was renamed with
`git mv packages/testing/fixtures/cursor.ndjson packages/testing/fixtures/cursor-out-of-usage.ndjson`,
without changing a byte, in the commit "test(engine): name the Cursor fixture
for what it is (issue 38)" on branch `worker/engine-c38`. Tests replay it as
the out-of-usage case. `replay.test.ts` also has a case for a normal
`packages/testing/fixtures/cursor.ndjson`, where the recorder writes the new
recording; it is skipped, with the reason "awaiting the owner's normal Cursor
recording (issue 38)", until that file exists. The issue stays open until the
owner adds that recording.

What happened: `packages/testing/fixtures/cursor.ndjson` (now
`cursor-out-of-usage.ndjson`) is the
`read-only-greeting` scenario, but the owner's account for the third harness
had no usage left. The prompt turn's only agent text is "Upgrade your plan to
continue", and the turn still ends with `stopReason: "end_turn"`. The header
also records `versionSource: "cli"`, because the adapter reports no version.
What should happen: a test that replays this fixture treats it as an
out-of-usage turn that ends normally, not as a greeting. When the account has
usage again, the owner re-records it so a real greeting exists. Unit 6a's
mapping of this harness's out-of-usage reply should use this transcript
together with `errors/cursor-out-of-usage.json`.
Why it matters: the adapter reports running out of usage as ordinary agent
text with a normal stop reason, so Shephrd cannot tell it from a reply by the
stop reason alone.

## 39. The read-only connection exists only when the SQLite layer turns on its reader workers

Found: 2026-11-01, while writing the unit 4b tests.
State: fixed in unit 7a.

What happens: `SqliteClient.readOnly` in the copied client
(`third_party/t3code/node-sqlite/src/nodeSqliteClient.ts`, `route`, line 1105)
sends a read to the writer connection whenever the layer was built without
`readerWorker: true`, or for an in-memory database. It does this silently.
What should happen: the service's SQLite layer, which units 6d and 7a build,
sets `readerWorker: true` on the file database, so the catch-up read that
plan note PB-A5 asks for really runs on a read-only connection.
Why it matters: without the reader workers, a `subscribe` catch-up waits
behind every open write transaction, and a long catch-up holds up the writer.
The unit 4b test `packages/engine/test/log/subscribe-gapless.test.ts` turns the
reader workers on itself, so it cannot see this setting in the service.

What changed in unit 7a: the service enables write-ahead logging before
opening the Effect SQLite layer and builds that layer with `readerWorker:
true`.


## 40. The `events.caller` column comment does not match what the log stores

Found: 2026-11-01, while writing the unit 4b tests.
State: fixed in unit 4b.

What happens: the migration's comment in
`packages/engine/src/log/migrations.ts` (line 14) says `caller` holds the JSON
of an Actor. `EventLog.ts` (`callerKey`, line 85) stores `owner` or
`agent:<agent id>` instead.
What should happen: the comment names the stored form, and the `subscribe`
catch-up read turns that form back into the Actor that `append` returned.
Why it matters: a catch-up reader written from the comment would fail to
decode every stored caller, and its envelopes would differ from the live ones.
The fix: the migration comment names the stored keys, and `subscribe` decodes
`owner` and `agent:<agent id>` back to their corresponding Actors.

## 41. A subscriber that stops reading keeps every later event in memory

Found: 2026-11-01, in the focused review of unit 4b at eb6308b.
State: fixed in unit 7a.

What happens: `PubSub.unbounded` in `packages/engine/src/log/EventLog.ts`
keeps publishing committed events while a subscriber is open. If the consumer
of `Stream.fromSubscription` in `packages/engine/src/log/subscribe.ts` stops
reading without closing, its backlog keeps every later event in memory.
What should happen: unit 7a owns a bound or a disconnect rule for a slow
client. T3 Code's `apps/server/src/orchestration-v2/LiveStreamBudget.ts`,
line 333, is a pattern for budgeting the buffered live events during replay.
Why it matters: one stalled client must not exhaust the engine's memory.

What changed in unit 7a: the transport disconnects a connection whose
subscription backlog reaches 2,048 events, checked every ten milliseconds. It
also disconnects a stream whose chunk remains unacknowledged for five seconds,
including a stalled replay on a quiet log. The transport never drops an event
to keep a connection alive.


## 42. Invalid subscription cursors could silently skip catch-up

Found: 2026-11-01, in the focused review of unit 4b at eb6308b.
State: fixed in unit 4b fix round 1.

What happened: `subscribe` accepted cursors that were not nonnegative safe
integers. In particular, `NaN` skipped catch-up and left the stream open.
What should happen: invalid cursors fail before subscribing to committed events.
The fix: `subscribe` rejects negative values and values that are not safe
integers, including non-finite and fractional values, with
`SubscribeInvalidCursor { after }`.
Why it matters: accepting an invalid cursor can hide a gap from the client.

## 43. Subscription reads exposed raw database errors

Found: 2026-11-01, in the focused review of unit 4b at eb6308b.
State: fixed in unit 4b fix round 1.

What happened: failures of the subscription's head and catch-up queries escaped
as raw `SqlError` values, whose reasons can contain database text and data.
What should happen: the application programming interface receives a named
failure with a fixed reason that carries no stored values or query text.
The fix: both read paths map `SqlError` to the exported `LogReadFailed` error
with the reason `database read failed`. Decode failures retain the fixed
reason `stored event is unreadable` on the same exported error class.
Why it matters: a refused subscription must not disclose database contents.

## 44. The low-level log fixtures contain partial agent histories

Found: 2026-11-01, while writing the unit 4c rebuild checks at `4a5ad12`.
State: open for the unit 4c builder.

What happened: `test/log/append.test.ts` appends turn and session events without
an earlier `AgentStarted`. The receipt tests append grouping events without
creating an agent. These fixtures exercise the storage boundary in isolation.
Adding the required live-view rebuild hook brings those histories through the
projection layer as well.
What should happen: the projection remains total over those stored envelopes,
and the hook compares the real live views with a rebuild before the fixture
closes. The builder must not add lifecycle validation to the raw log writer or
change the frozen storage assertions to manufacture missing history.
Why it matters: a rebuild hook that crashes on these fixtures cannot check the
existing storage scenarios, even when their database behavior is correct.

## 45. The first view rebuild must not open a reader before WAL is enabled

Found: 2026-11-01, while composing the unit 4c test layers at `4a5ad12`.
State: handled by the new test fixture; production startup needs the same order.

What happened: `EventLog.layer` currently enables SQLite's write-ahead log
(WAL). The new live-view layer must load its initial state before the writer
that consumes it is constructed. The copied SQLite client's reader pool
permanently falls back to the writer when its first reader opens a database
that is not in WAL mode.
What should happen: enable WAL before constructing the live views or starting
their initial rebuild. The new `test/support/withViews.ts` fixture does this
after migrations. Unit 4c and the later service startup must preserve that order.
Why it matters: enabling WAL only after the first rebuild leaves that client's
reader pool disabled, so comparison can block behind an occupied writer even
though the database eventually reports WAL mode.

## 46. A failure while applying a committed batch would leave the live views behind

Found: 2026-11-01, while building unit 4c at `3fb1a96`.
State: open.

What happened: the live views are updated in memory after the database commit,
inside the writer permit. The update has no error channel, so it can only fail
by a defect. A defect there would leave the committed log ahead of the live
views, and nothing detects that until the next comparison with a rebuild.
What should happen: the service startup should treat such a defect as fatal
and rebuild the views from the log before serving again, or the comparison
should run on a schedule outside tests.
Why it matters: a client could read views that miss a committed event.
Round 1 of the unit 4c review also found a reachable defect of this kind: an
agent named `constructor`, `toString` or `__proto__` is a valid identity, and
the views, built as ordinary objects, threw after the append committed. Fixed
in round 1: every keyed view has no prototype and is read by own property only.

## 47. Live threads copy their event list on every append and keep full envelopes

Found: 2026-11-01, while building unit 4c at `3fb1a96`.
State: open.

What happened: `apply` stores each thread as an immutable array and builds a
new array for every event, so appending to a long thread is linear in its
length. The thread also holds the whole envelope of every event for the life
of the process.
What should happen: before long-running threads matter, store a bounded window
or event sequences with a read-through to the log, and use a persistent list.
Why it matters: memory and write time grow without bound for a busy agent.

## 48. The views module and the event log import each other

Found: 2026-11-01, while building unit 4c at `3fb1a96`.
State: open, harmless today.

What happened: `EventLog.ts` uses the `Views` service, and `Views.ts` reaches
`log/subscribe.ts`, which imports `EventLog.ts`, through `rebuild.ts`. The
module cycle works because every use sits inside a function body. Unit 4c also
exported `EventRow`, `decodeRow` and `PAGE_SIZE` from `subscribe.ts` so the
rebuild reuses the same decoding.
What should happen: move the row type, the decoder and the page size into a
small module that neither side imports back.
Why it matters: a later top-level use on either side would fail at load time.

## 49. The folder ceiling and the stream redactor leave duties to later units

Found: 2026-11-01, while building unit 5a.
State: open. Fix round 1 of unit 5a (2026-11-01) closed the mount and
back-link items on Linux; each remaining item names the unit that owns it.

What happens: unit 5a's ceiling and redactor meet criteria 5.11 and 5.12, but
these limits remain.

- A protected folder mounted beneath a requested folder. Fixed on Linux in
  fix round 1: the check reads `/proc/self/mountinfo` and compares every mount
  point at or beneath the folder, by device and inode, with each protected
  folder and each of its ancestors, and an unreadable mount table refuses an
  agent-started child. Other platforms have no such table, so there the check
  still sees only the folder's own ancestors, and a protected folder mounted
  below the requested folder is not found.
- Linked worktrees. Fixed in fix round 1: a `.git` file is accepted only when
  git's `gitdir` back-link exists, is a readable regular file, and names the
  folder's `.git` by device and inode. An agent that can write inside the
  parent repository's common directory can still register a new worktree
  entry, with its back-link, that passes. This is the limit decision row 35
  accepts by allowing worktrees at all.
- A folder grant lives in memory. Unit 6d's recovery reload (decision row 52,
  step 7) must rebuild it by calling `checkFolder` with the stored request and
  then compare the result with the stored real path before it calls
  `folderForSpawn`.
- The time between the check and its use. `folderForSpawn` returns a path,
  and Node.js cannot start a child process in a held directory handle, so a
  process running as the same user can redirect that path after the check.
  Unit 6a must call `folderForSpawn` immediately before each spawn. On Linux,
  unit 6a must also compare the child's `/proc/<pid>/cwd` with the granted
  device and inode right after the spawn and again after `session/new`, and
  stop the child on a mismatch.
- `redactChunk` keeps a carry for each item until that item's final chunk.
  The carry is bounded by the longest matched form, but unit 6a must send a
  final chunk for every item, including items cut off by a crash or an
  interruption, or the carries of abandoned items stay in memory.

Unit 6a now rechecks the grant at spawn, compares the Linux child working
folder by path, device and inode before initialization and after session
setup, and closes every text carry on completion, stop, crash and scope
closure. Recovery must still reconstruct grants, and the stated platform
and worktree limits remain.

What should happen: units 6a and 6d meet the grant, spawn-time and
final-chunk duties above, and SECURITY.md states the remaining platform and
worktree limits.
Why it matters: each limit is a way for an agent-started child to reach a
folder, or for the service to hold memory, beyond what the ceiling promises.

## 50. Side-row text is redacted through a placeholder device event

- **Found:** unit 5a fix round 1, by the lead at merge (ruling 4, findings U5A-F02 and B9).
- **What happens:** `EventLog.append` in `packages/engine/src/log/EventLog.ts` redacts a device name and a process executable by wrapping each one in a `DeviceAdded` event with the device identifier `side-row-text`, passing it to `Redactor.redact`, and reading the `name` field back. It fails closed to `[REDACTED]` if the redactor returns another event.
- **Why it matters:** the redaction is correct, but the carrier event is a workaround. A redactor that ever treated `DeviceAdded` specially would silently change how side rows are redacted.
- **What should change:** the `Redactor` service in `packages/engine/src/log/Redactor.ts` gains a `redactText(text)` member, and `EventLog.append` calls it for side-row text. Unit 5b owns this, because it is the next unit that touches the event log's callers.
- **State:** fixed in unit 5b. The service and both layers expose `redactText`, and the event log calls it directly for device names and process executables. No carrier event remains. The existing side-row tests and the unit 5b counting-redactor test cover the boundary.

## 51. No view holds the harness settings, so a `harnesses set` cannot be read back from the views

- **Found:** unit 5b tests, by the test writer.
- **What happens:** the reducer in `packages/engine/src/views/apply.ts` ignores `HarnessChanged`, and the snapshot has no harness table. The only way to see the settings a `harnesses set` wrote is the reply of `harnesses list`.
- **Why it matters:** criterion 5.4 says each lifecycle case asserts the event and the view change. For `harnesses set` there is no view change to assert, so the test reads the list reply, and a client that wants the settings has no live view to subscribe to.
- **What should change:** either unit 5b adds a harness table to the views, or the plan says that the list reply is the harness view.
- **State:** open. The test `5.4 harnesses set` reads the list reply.

## 52. No suspended-wait marker exists, so "crash suspends waits" has no observable state

- **Found:** unit 5b tests, by the test writer.
- **What happens:** decision row 67 says a crash suspends an agent's waits and `resume` re-opens them. `WaitRow` has only the statuses open, satisfied and cancelled, and no event marks a wait as suspended.
- **Why it matters:** the 5.4 `resume` case cannot assert that suspended waits come back. It asserts only that `resume` does not cancel them, which a build with no suspend at all also passes.
- **What should change:** the owner or the lead decides whether a wait gets a suspended status, or whether a wait simply stays open across a crash. Unit 5d.1 owns the answer.
- **Unit 5d test contract:** Suspension is derived from an open non-blocking wait and its waiter being crashed. The durable `AgentCrashed` event is the suspension marker. A suspended wait stays open, emits no wake, and is re-checked by a successful reloadable `resume`. Only `stop` writes `WaitCancelled`. This uses the existing event contracts, so no separate suspended status is required. The tests also withdraw a wake already queued when its waiter crashes or stops.
- **State:** fixed in unit 5d. `routing/waits.ts` skips an open non-blocking wait whose waiter is crashed, so it neither resolves nor wakes, and a crash withdraws a wake already queued for that waiter. A `resume` moves the waiter out of "crashed", and the same transaction re-checks its waits. Only `stop` writes `WaitCancelled` for a non-blocking wait; a blocking wait of a crashed waiter is cancelled, because its connection belonged to the crashed run.

## 53. The event log gives a command handler no way to check and write in one writer turn

- **Found:** unit 5b tests, by the test writer.
- **What happens:** `EventLog.append` takes the writer permit itself, and `withWriterPermit` uses the same semaphore without re-entry. A handler that verifies the caller's token and reads the state inside `withWriterPermit` and then calls `append` waits on itself forever. Without a seam the verification would sit outside the permit, and a token revoked while the command waited would still be accepted.
- **Why it matters:** criterion 5.1 and decision row 32 require the token to be checked in the writer. The test `5.1 token race` fails if it is checked before.
- **What should change:** unit 5b adds an `append` variant that runs a check inside its permit and transaction, or lets the handler hand `append` a function that builds the events from a state read taken under the permit.
- **State:** fixed in unit 5b. `EventLog.transact` holds the writer permit and one SQLite transaction around identification, receipt lookup, state and authorization checks, and the supplied append. It publishes only after the outer commit. A callback failure rolls back the events, side rows and receipt without publishing a view change.

## 54. The tests read two behaviours the plan leaves open: crash handling and the shape of a failed start

- **Found:** unit 5b tests, by the test writer.
- **What happens:** the plan gives `Runner.events` to units 6x but says in unit 5b only that a crash writes `AgentCrashed` with a revocation. The test `5b crash token` assumes a `RunnerEvent` of `{ _tag: "exited", agentId, exitCode, signal, stderr }` that the handler layer turns into the crash. The lifecycle test for a rejected start accepts a reply or a failure, and asserts only the `AgentStartFailed` event and the view.
- **Why it matters:** if the builder gives the exit event another shape, the crash test fails for a reason that is not a missing behaviour.
- **What should change:** the lead confirms the shape of the exit event before the builder starts, or moves the crash test to unit 6x.
- **State:** settled in unit 5b by the lead's task rulings. The handler consumes the stated exit event and appends `AgentCrashed` with token revocation in one transaction. It stores an empty stderr field instead of copying diagnostic text. A rejected start writes the fixed reason `agent start failed`, revokes its token, and leaves the agent stopped. The initial start reply identifies the stopped agent.

## 55. An authorization helper counted earlier successful runner calls as a refusal's side effect

Found: 2026-11-01, while building unit 5b.
State: fixed with the lead's approval in board post 884.

What happened: `expectOutcome` in `packages/engine/test/commands/authorization.test.ts` required the runner's total call count to be zero after every refusal. The folder test first completed four allowed starts with the same runner. Its next refused start therefore failed although it made no new runner call.
What changed: the helper records the call count before each command and requires that count to stay unchanged for a refused or rejected command. Its event and view assertions are unchanged.

## 56. The sandbox exits the fake adapter before the redactor integration test completes

Found: 2026-11-01, while running unit 5b's required test subset.
State: worked around for verification by running the assigned tests outside the sandbox.

What happened: the fake-agent case in `packages/engine/test/identity/redactor.test.ts` failed twice inside the coding sandbox with `AcpProcessExitedError`, exit code zero. The same test passed outside the sandbox without a code change. The complete assigned subset also passed outside it.
What should happen: run this child-process integration check in an environment that permits the fake adapter's standard-input transport. No real adapter or real harness home is needed.

## 57. A failed account event can leave an unreferenced secret in the store

Found: 2026-11-01, while building unit 5b's secret-store seam.
State: open, kept after unit 6b; the cleanup moves to unit 6d (issue 119).

What happens: the handler stores a wrapped secret before it commits the account's new reference. A failed event-log write can leave an unreferenced value in the secret store. The interface has no rollback or removal operation.
Why it matters: storing after the event commit would instead risk committing a reference whose value was lost, including after a crash. The earlier store keeps committed references resolvable, but can retain an unused secret.
What should happen: the persistent store defines how to collect unreferenced values or coordinate reference publication. Unit 5b uses only a scoped in-memory store and keeps every stored value wrapped as `Redacted`.
Unit 6b: `accounts/SecretStore.ts` keeps the store-before-commit order, so a committed reference always resolves. A leftover value is mode 0600, is never read without a reference, and is never logged. Collecting it needs the log's list of live references, which belongs with the startup recovery of unit 6d, so it is not fixed here (issue 119).

## 58. A refusal by the state table or by rights is stored as the request's receipt

Found: 2026-11-01, in the focused review of unit 5b.
State: open; the current behaviour is kept until the plan's owner of row 30 rules on it.

What happens: when the state table or the rights check refuses a command, the handler stores the refusal as the receipt for that caller and request id (`packages/engine/src/commands/CommandHandler.ts`, the refusal branch of `execute`). A retry with the same request id after the agent's state has changed returns the old "command refused".
Why it matters: row 30 names only "no usable account" and "database busy" as temporary refusals that write no receipt. A state refusal also depends on state, so a client that retries with the same request id never sees the new outcome.
What should happen: either the plan's decision log confirms that a state or rights refusal is final for its request id, and clients must send a new request id, or these refusals stop writing a receipt. Engine-lead's reading for now: it is final, as row 30 reads.

## 59. A read failure inside a writer turn latches the whole writer

Found: 2026-11-01, in the focused review of unit 5b.
State: open.

What happens: any `LogWriteFailed` raised inside an `EventLog.transact` callback latches the writer (`packages/engine/src/log/EventLog.ts`, the failure branch of `transact`). That includes read-type failures such as "database read failed" and "stored receipt is unreadable".
Why it matters: one corrupt receipt row then blocks every later command until the engine restarts, and the restart's first retry latches it again.
What should happen: latch only on failures of the write itself (the append, the commit or the side rows), and turn a read-type failure into a refusal of that one command.

## 60. Envelope-only receipts rebuild list replies from the current snapshot

Found: 2026-11-01, in the focused review of unit 5b.
State: open, low impact.

What happens: a receipt in the older envelope-only format has no stored reply. For `accounts` and `harnesses` list commands the handler rebuilds the reply from the current snapshot (`CommandHandler.ts`). That reply is not the first reply, and it does not pass `redactReceipt`.
Why it matters: today only direct callers of `append` write the older format, so no command reaches this path. If one did, a retry could return data that differs from the first reply.
What should happen: either remove the envelope-only path once no caller writes it, or refuse a list retry whose receipt holds no reply.

## 61. A runner exit event carries no incarnation, so a late exit could hit a new run

Found: 2026-11-01, in the focused review of unit 5b.
State: fixed in the engine by unit 5c fix round 1 and in the producer by unit 6a.

What happened: `RunnerEvent.exited` carried only the agent identifier. The
crash consumer checked only the agent's current state.
Why it matters: after `stop` and an immediate `resume`, a late exit from the old process would write `AgentCrashed` for the new run and revoke its new token.
What changed: the runner event schema requires an incarnation on every tag,
including `exited`. The consumer checks both the agent identifier and its
unrevoked token hash inside the writer transaction before applying an event.
Unit 6a takes every event identity from its process table. Its fake-process
tests check current exits, revoked tokens and forged identities. A natural
exit releases the process entry, and a later spawn refuses sends carrying
the old token hash.

## 62. A failed follow-up append after a rejected runner call leaves the agent starting

Found: 2026-11-01, in the focused review of unit 5b.
State: fixed in unit 6d (`recovery/restart.ts`).

What happens: the command's receipt is stored with the first append. If the runner then rejects the start and the follow-up append (`AgentStartFailed` or `AgentReloadFailed`, with the token revocation) itself fails, a retry returns the stored success without calling the runner again.
Why it matters: the agent stays in "starting" with a live token until the engine restarts.
What should happen: restart recovery, or a sweep in unit 6a, moves an agent that has sat in "starting" with no runner session to "start failed" and revokes its token.

What changed in unit 6d: restart step 4 revokes every agent token. Step 6
marks an agent caught in "starting" as interrupted from "starting", and step 7
starts it again with a new token. If that start fails, recovery writes
`AgentReloadFailed` with the fixed reason "agent start failed" and revokes
the agent's tokens.

## 63. The account choice "any" takes the first match, not row 28's picker

Found: 2026-11-01, in the focused review of unit 5b.
State: fixed in unit 6b (`accounts/pick.ts`, used by `commands/start.ts` for "any" and for a named account).

What happens: `start` with the account choice "any" takes the first matching account in insertion order (`packages/engine/src/commands/start.ts`).
Why it matters: row 28 asks for the account with the fewest agents, then the lowest id. The stand-in spreads no load.
What should happen: unit 6b replaces it with row 28's picker and tests the tie-break.

## 64. The session a runner returns is discarded, and a failed resume records the wrong previous state

Found: 2026-11-01, in the focused review of unit 5b.
State: fixed in unit 6a.

What happens: `start.ts` and `resume.ts` discard the `SessionInfo` that `runner.start` and `runner.load` return. No session reference and no `reloadable` flag are ever recorded, so a `resume` without `--fresh` always finds "cannot reload" for an agent started by the engine. Also, a failed reload writes its transition with `previous: "idle"` (`resume.ts`), even when the agent was crashed or stopped.
Why it matters: reload cannot work end to end until the session is recorded, and the wrong previous state misleads anyone reading the event.
What should happen: unit 6a writes `SessionOpened` with the session reference and the reloadable flag after a successful start or load, and the failure transition uses the agent's real previous state.

What changed: both command paths append `SessionOpened` from the runner
result in a fresh writer transaction after the process call. The append
requires the agent still to be starting, so a concurrent crash cannot be
undone by a late session result. A failed reload records the previous state
as `starting`, the state committed immediately before the reload call. The
contracts allow starting, working or idle in that field, rather than the
crashed or stopped state from which the resume command was requested.

## 65. No event withdraws an owner alert, so a closed request's alert is visible only through its status

Found: 2026-11-01, while writing the unit 5c tests.
State: open; the owner of the client API (piece 2) or the lead decides.

What happens: decision rows 27 and 51 say that closing or moving a request withdraws its owner alert in the same transaction. The alert is the `OwnerNeeded` event, and the contracts (`packages/contracts/src/events.ts`) have no event that withdraws it. A request never moves down from the owner (row 51), so only closing ends an alert, and a client can see that only from the request's or question's status.
What should happen: either the contracts gain an "owner alert withdrawn" event, or the plan states that an alert ends when its subject closes, and clients derive it.
Why it matters: a phone alert for an answered request stays visible until the client checks the subject. The unit 5c tests cannot assert a withdrawal, so they assert only the closed status.

## 66. A request held by the owner still carries a delivery id that names no delivery

Found: 2026-11-01, while writing the unit 5c tests.
State: open.

What happens: `PermissionRequested`, `PermissionMoved`, `QuestionAsked` and `QuestionMoved` require a `deliveryId`. When the holder is the owner, nothing is queued, because a delivery's target must be an agent. The id then refers to no delivery, and a later withdrawal of it changes no row.
What should happen: either the field becomes optional for an owner holder, or the plan states that the id is a placeholder there. The unit 5c tests assert only that no delivery is queued for an owner-held request.
Why it matters: a reader or a later unit that looks the id up finds nothing, and could mistake that for a lost delivery.

## 67. A routing delivery has no sender of its own, so returning it to its sender is undefined

Found: 2026-11-01, while writing the unit 5c tests.
State: open for unit 5d, which builds returns to the sender.

What happens: the engine queues a delivery to a request's or question's holder, but `Delivery.sender` is an `Actor` (the owner or an agent), and the contracts have no engine sender. Criterion 5.9 returns a failed delivery to its sender. If the sender is recorded as the asking agent, a failed request delivery would be returned to the agent that asked.
What should happen: unit 5d decides how a delivery with a `source` (permission, question or wait) is handled on failure: moved by the holder rule, requeued, or returned. The unit 5c tests do not assert the sender of a routing delivery.
Why it matters: a returned request delivery could tell the asker that its own request failed, while the holder never sees it.
State: decided by the lead for unit 5d and implemented. The sender of a routed permission or question delivery is its asker. An ordinary error reply returns it to the asker, who gets a notice, and the request stays open with its holder. A stopped or crashed holder's routed delivery is withdrawn, not returned, because its subject moves to the next holder in the same transaction.

Post-build evidence, 2026-11-03, at commit `8ff4c9b`: post-build A1 confirms the
unresolved consequence of that ruling.
Evidence: the post-build A1 adjudication is in
`.scratch/foundry-runs/engine-build-1/review-post-build/adj/result-1.md` (not tracked).
It adjudicates flow2 F-1 and flow3 F-1 by source inspection and hand reasoning.
In `packages/engine/src/routing/deliveries.ts`, `failed` returns the routed
delivery to the asker and makes the holder idle.
The following turn end writes nothing, so it never invokes the pass-up rule.
In `packages/engine/src/routing/holders.ts`, pass-up requires an accepted
delivery, whereas this delivery is already returned.
The request stays open with the idle holder, without an `OwnerNeeded` event.
In `packages/engine/src/routing/waits.ts`, that open request prevents the
holder from settling.
A permission asker's return notice also stays queued behind its held turn.
Score: MAJOR, severity 6 × fallout 3 × probability 4 = 72, band schedule.
The owner deferred post-build A1 on 2026-11-03, without choosing between
passing the request up and keeping it with its holder while alerting the owner.
The existing ruling is not a fix for this remaining stall.

## 68. A committed permission answer can fail to reach its runner

Found: 2026-11-01, while building unit 5c.
State: the live process path is fixed in unit 6a. Restart reconciliation is fixed in unit 6d (`recovery/restart.ts`, step 6).

What happens: the handler commits a permission answer and its receipt before
calling `Runner.answerPermission`. If that call fails, the answer stays
recorded. The handler writes one fixed warning through the service logger,
with no request content or runner error. A retry with the same request
identifier returns the stored receipt and does not call the runner again.
What should happen: unit 6a reconciles a committed answer with a runner that
did not receive it, including after a service interruption between the commit
and the call. Its recovery must preserve first-answer-wins and avoid replaying
an answer into a different incarnation.
Why it matters: an adapter can still be waiting for a permission whose answer
the client already sees as recorded. The unit 5c boundary test covers the
committed state, receipt replay, single call and content-free warning.

What changed in unit 6a: permission answers resolve the held protocol call,
and `answerPermission` waits for the transport response-write acknowledgement.
An unknown, stale or cross-agent request is refused. A failed response write
fails that acknowledgement, logs a fixed warning and kills the detached
process group, so a committed answer cannot leave a live child holding the
request. Death and stop fail outstanding acknowledgements and discard their
holds. A service interruption between the answer commit and its runner call
still needs unit 6d recovery, with first-answer-wins preserved.

What changed in unit 6d: after a service interruption, the process that
asked the permission is gone. Restart step 6 therefore cancels every open
permission request with the fixed reason "agent interrupted" and withdraws
the work queued behind it. A committed answer stays recorded and is never
sent to the new incarnation, so first-answer-wins holds and no answer
reaches a different process.

## 69. One malformed runner event could stop the consumer for every agent

Found: 2026-11-01, in the review and verified attack pass for unit 5c.
State: fixed in unit 5c fix round 1.

What happened: the event consumer caught only request identifier collisions.
An empty permission identifier, empty tool call identifier, invalid option
level or empty option list could cause a schema defect and stop the consumer.
A failed event transaction could stop it too.
What changed: the consumer decodes every event against the runner event
schema before reading state or opening a transaction. It drops malformed
events with one fixed warning. Each event's work catches failures and defects
with another fixed warning, while preserving interruption during shutdown.
Neither warning includes input or failure content. The event log still keeps
its deliberate failure latch after an actual database write failure.
The fix-round test initially expected a later append after a trigger-induced
failure. The lead ruled that the existing latch wins. The corrected test
observes another fixed warning for the next rejected event instead.
Why it matters: one bad event must not prevent the consumer from handling
later valid events for other agents.

## 70. A command request identifier could store a live secret unchanged

Found: 2026-11-01, in the verified attack pass for unit 5c.
State: fixed in the engine by unit 5c fix round 1. A bounded identifier
alphabet remains open for the contracts scope.

What happened: the contracts accept any nonempty string as a request
identifier. The handler could store an agent token unchanged in event and
receipt keys, envelopes and thread views, because identifier metadata bypasses
event text redaction.
What changed: immediately after decoding a command's payload, the handler
passes the request identifier through the event log's `redactText` delegation
to its own `Redactor` service. If the identifier changes, the handler refuses
the command before receipt lookup and writes nothing. This also applies to
commands that would later be refused for rights or state.
What remains: the contracts scope must choose a bounded identifier alphabet.
Why it matters: redacting a reply alone leaves secrets in database keys and
subscription envelopes.

## 71. A moved request could withdraw an already accepted delivery

Found: 2026-11-01, in the focused review of unit 5c.
State: fixed in unit 5c fix round 1.

What happened: moving a request or question always wrote `DeliveryWithdrawn`,
including when the delivery had already been accepted.
What changed: a move now uses `withdrawQueued`. It withdraws a queued delivery
and leaves every other delivery status unchanged, while moving the subject
and notifying its next holder in the same batch.
Why it matters: a completed delivery remains accepted in the log and views.

## 72. Permission request identifiers must be unique across agents

Found: 2026-11-01, in the focused review and attack pass for unit 5c.
State: fixed in unit 6a.

What happens: the engine preserves the first request when a runner reports
an identifier it already holds. Fix round 1 adds a fixed warning when that
duplicate names a different agent, with no request content in the warning.
What should happen: unit 6a mints a request identifier itself, unique across
agents and incarnations. It never forwards a child's protocol request
identifier or tool call identifier as the engine permission identifier.
The runner retains the mapping needed to answer the original protocol call.
Why it matters: a collision must not overwrite the first request, and dropping
the second otherwise leaves another adapter waiting without a routed request.

What changed: each permission hold receives an engine-generated random
identifier. The process entry maps that hold to the client protocol request
and validates the agent, hold and offered option before writing a response.

## 73. Permission option safety depends on the runner's option mapping

Found: 2026-11-01, in the unit 5c attack pass. The reported engine ceiling
bypass was disproved by the verifier; the producer duty remains.
State: fixed for the recorded option mappings in unit 6a. New adapters still need fixture review.

What happens: the engine cannot know what an adapter's option identifier does.
It trusts the mapped option kind. The ceiling already uses the stricter of
the reported and implied permission level and persistence. An adapter option
that persists but is mapped as `allow_once` with no persistence flag can still
pass an agent's ceiling.
What should happen: unit 6a maps options against recorded adapter fixtures and
checks the permission boundary in acceptance case SEC-PB-3. Unknown or
persistent options must remain owner-only.
Why it matters: an incorrect mapping could give a one-time approval effects
that persist beyond the session.

What changed: generic kinds use the contracts mapping, including owner-only
persistence and unknown kinds. Recorded first-harness exit-plan bypass and
auto identifiers are raised to full and persistent. Symlink-resolved harness
settings paths are also owner-routed.

## 74. Requests asked by a crashed or stopped agent remain open

Found: 2026-11-01, in the review of unit 5c.
State: crash permission cancellation is fixed in unit 6c. Stop and recovery closure remain open, and question closure needs an owner decision (issue 113).

What happens: no current writer emits `PermissionCancelled` or closes the
questions asked by an agent that crashes or stops. Moving the subjects it
holds does not close the subjects it asked.
What should happen: the runner and recovery units reconcile these subjects
with their actual sessions and close requests that no longer have a waiter.
Question closure must use an agreed contract rather than inventing an answer.
Why it matters: dead sessions leave open subjects and owner alerts that
nobody can use.

Unit 6a fix round 2 now answers every pending protocol permission request
with the cancelled outcome when a turn is cancelled, and removes its local
hold so a later answer is refused. That protocol response does not close the
engine's durable permission record. The request cancellation and question
closure contracts above remain work for units 6c and 6d.

Unit 6c now writes `PermissionCancelled` for every open permission request
asked by the crashed agent, in the crash append, with the fixed reason
"agent crashed". It withdraws each queued request delivery before moving
subjects held by the dead agent. Questions stay open, without an invented
answer.

Post-build evidence, 2026-11-03, at commit `8ff4c9b`: flow2 F-7 confirms
the remaining stop case and its effect on ancestor waits.
Evidence: finding F-7 is in
`.scratch/foundry-runs/engine-build-1/review-post-build/results/flow2.md` (not tracked).
It confirms the path by source inspection.
In `packages/engine/src/commands/stop.ts`, stopping an asker does not cancel
its open permission requests.
In `packages/engine/src/routing/waits.ts`, the request prevents its holder
from settling, so an ancestor's wait stalls.
An answer commits before the stopped asker's runner refuses it.
Without an answer, turn-end routing in `packages/engine/src/routing/holders.ts`
can move the dead request up to the owner and write `OwnerNeeded`.
The crash cancellation in `packages/engine/src/recovery/crash.ts` does not
cover this stop path.
Score: MINOR, severity 4 × fallout 3 × probability 6 = 72, band schedule.
The owner deferred this finding on 2026-11-03.
The stop closure remains open under this issue.

## 75. The wait contract has no owner waiter

Found: 2026-11-01, while building unit 5d.
State: closed by the owner's decision on 2026-11-03.

What happens: `WaitOpened` requires the waiter's agent identifier, and `Delivery.target` must be an agent. The engine therefore refuses a `wait` from the owner with "command refused".
Why it mattered: the original decision row 26 gave the owner's terminal `shephrd wait --block`. `AGENTS.md` rule 5 requires that what the owner can do from the terminal is also possible through the API.
The original proposal was for the contracts to give a wait an owner waiter, at least for blocking waits, which create no delivery.

Closing decision: row 26 of `.plans/plans/shepherd-engine/decisions.md`,
as amended on 2026-11-03, restricts blocking waits to agents.
The owner waiter is declined for this engine plan.
Owner clients get the same result by subscribing to events.
Revisit this restriction when the client application programming interface
(API) is planned.

## 76. Engine notices name the owner as their sender

Found: 2026-11-01, while building unit 5d.
State: open for the contracts scope.

What happens: a wait's wake, a wait's crash notice and a returned-delivery notice are deliveries the engine writes. `Actor` has only the owner and agents, so these deliveries carry the owner as sender. Their text is still wrapped in the data envelope, and a wake carries its wait as `source`.
Why it matters: a client cannot tell an engine notice from the owner's own prompt by its sender. A notice that fails is returned to the owner, which ends there, so no notice loops.
What should happen: the contracts add an engine sender, or the plan states that the owner sender with a data envelope marks an engine notice.

## 77. A blocking wait's retry and its cancellation window

Found: 2026-11-01, while building unit 5d.
State: the cancellation window is fixed in unit 5d's fix round 1. The retry
part is fixed in unit 7b: the client retries a blocking wait with a new request
identifier after a disconnect. Unit 7a interrupts the
request scope on disconnection, so the existing handler cancellation finalizer
runs. A reconnecting client must use a new request identifier for a blocking
wait.

What happens: a blocking `wait` stores its receipt when the wait opens, so a retry with the same request identifier returns the stored "opened" reply, not the final outcome. Separately, the handler runs the blocking part after the opening commit. An interruption that lands after the commit and before the blocking part starts would leave the wait open.
Why it matters: a blocking wait creates no delivery and never counts against its caller's settled state, so a left-open wait wakes nobody. It still shows as open until recovery step 6 cancels blocking waits (row 66).
What should happen: the transport retries a blocking wait with a new request identifier, and unit 7a either masks interruption across the commit and the start of the blocking part or cancels open blocking waits of closed connections.
What changed in fix round 1: `CommandHandler.execute` runs inside `Effect.uninterruptibleMask`. For a blocking wait, the opening transaction and the blocking part run in the uninterruptible region, and only the waiting loop inside `block` is interruptible. Its `Effect.onInterrupt` cancellation is therefore registered before any interruption can arrive, and an interruption at any point after the `WaitOpened` commit writes `WaitCancelled` with the reason "connection closed". Every other command runs with interruption restored, as before.

## 78. Follow-up appends after a rejected start or reload skip the wait checks

Found: 2026-11-01, while building unit 5d.
State: fixed in unit 5d's fix round 1.

What happens: when the runner rejects a start or a reload, `start.ts` and `resume.ts` append `AgentStartFailed` or `AgentReloadFailed` with `EventLog.append`, outside a transaction that reads the views. Those batches carry no wait checks, so a wait on that agent resolves only at the next check that runs, or at recovery's re-check.
Why it matters: a parent waiting on a child whose start failed is not woken at once.
What should happen: unit 6a writes these follow-ups through `EventLog.transact` with the views snapshot and `withWaitChecks`, like the other runner events.
What changed in fix round 1: `start.ts` and `resume.ts` now write these follow-ups through `EventLog.transact`, with the views snapshot and `withWaitChecks`, so a waiter on that agent is resolved in the same append as the failure.


## 79. Nine earlier tests assumed a delivery to an idle agent stays queued

Found: 2026-11-01, while building unit 5d.
State: fixed with the lead's approval in board post 909.

What happened: unit 5d sends a delivery to an idle agent as soon as it is queued, and a stop resolves another agent's wait on the stopped agent. Seven unit 5c tests seeded an idle holder and expected its routed delivery to stay queued or to be withdrawn. The unit 5b stop test expected a wait on the stopped agent to stay open.
What changed: tests whose point is a withdrawal or a queued move now seed the holder as working, so its delivery stays queued. The two tests whose names need an idle holder keep it idle and assert that the delivery was sent. The stop test asserts that the other agent's wait resolves with the reason "stopped" and is not cancelled. No other assertion changed.
Why it matters: the old expectations contradicted decision rows 25, 29 and 50.

## 80. A wait could name agents the caller has no rights over

Found: 2026-11-01, in the focused review of unit 5d (finding F1).
State: fixed in unit 5d's fix round 1.

What happened: `wait` checked only that each member exists and is not the caller. Any agent could wait on an unrelated agent, a sibling or its own parent.
What changed: decision row 27 lists `wait` among a parent's rights. `routing/waits.ts` now refuses the whole command with "command refused" unless `holderAbove` names the caller for every member, the same rule the other targeted parent commands use. The check runs inside the command's writer transaction, and a refused list writes no `WaitOpened`.

## 81. A failure reply after a content update was ignored

Found: 2026-11-01, in the focused review of unit 5d (finding F2).
State: fixed in unit 5d's fix round 1.

What happened: a content update can accept a delivery before the reply that ends the turn. An error or pause reply then found the delivery no longer "sent" and wrote nothing, so the agent stayed working with no turn running.
What changed: `promptReply` handles an error or a pause for the delivery that started the agent's current turn, whether it is sent or already accepted. An error on an accepted delivery returns it to its sender with the redacted reason and makes the agent idle; the delivery is not put back in the queue. A pause on an accepted delivery pauses the agent with `midTurn: true` and does not requeue it; carrying on is unit 6b's. A second terminal reply, or one for an earlier delivery, writes nothing.

## 82. A send reserved before a stop could reach the runner after it

Found: 2026-11-01, in the focused review of unit 5d (finding F3).
State: fixed in unit 5d fix round 1 and unit 6a.

What happened: `dispatchQueued` committed `DeliverySent` and then called the runner with no lock against `stop` or `resume`. A stop could commit between the two, so the prompt reached a process the engine had stopped, or a later run of the same agent.
What changed: `routing/lanes.ts` gives each agent one send lane. `dispatchQueued` holds it from the reservation through the runner call. `stop` and `resume` hold the target's lane from before their writer transaction through their runner call, and `start` holds the new agent's lane through its runner call. The lane always comes before the writer's permit, so the two cannot deadlock. `Runner.prompt` and `Runner.compact` also take the incarnation the send was reserved for, the hash of the agent's live token, read in the reservation transaction.
What unit 6a changed: prompt and compact compare their reserved incarnation
with the live process entry before any protocol write. A mismatch returns
`RunnerRejected` and sends no frame.

## 83. A repeated turn end could end the next turn

Found: 2026-11-01, in the focused review of unit 5d (finding F4).
State: fixed in unit 5d fix round 1 and unit 6a.

What happened: the `turnEnded` runner event named only the agent. A repeated or late turn end for an earlier delivery ended whatever turn was running, and the next queued delivery was sent while the agent was still busy.
What changed: `turnEnded` carries the identifier of the delivery whose turn ended. The engine writes `TurnEnded` only when the agent is working and that identifier is the delivery that started its current turn, the last one sent since the previous turn end.
What unit 6a changed: each process retains the current delivery and emits
one `promptReply` followed by one `turnEnded` for it. Version 2 waits for
both the protocol reply and idle state, in either order. A later idle error
is therefore retained even when the prompt acknowledgement arrived early.

## 84. A queued answer to a stopped or crashed agent was lost

Found: 2026-11-01, in the focused review of unit 5d (finding F5).
State: fixed in unit 5d's fix round 1.

What happened: `targetGone` returned to its sender only a delivery with no source. An answer carries its question as source, cannot move, and was withdrawn silently, so the answerer never learned it was not delivered.
What changed: `targetGone` classifies by role. A wait's wake is only withdrawn (row 50). A routed permission request or question whose subject is still open has already moved with `moveHeld`, and is only withdrawn. Every other pending delivery, including an answer to a closed question, is withdrawn and returned to its sender as "not delivered" (row 69).

## 85. One slow send held up every other agent's dispatch

Found: 2026-11-01, in the focused review of unit 5d (finding F6).
State: fixed in unit 5d's fix round 1.

What happened: the committed-event follower awaited each agent's `dispatchQueued`, and so its runner call, before handling the next agent's events.
What changed: the follower forks each agent's dispatch as a child fiber, with at most one running per agent. A commit that arrives while one runs makes it go round once more. A failed dispatch logs the fixed line "delivery dispatch failed", and interruption still ends the follower and its fibers.

## 86. Unicode whitespace before a slash escaped the slash-command guard

Found: 2026-11-01, in the focused review of unit 5d (finding F7).
State: fixed in unit 5d's fix round 1.

What happened: `escapeLeadingSlash` treated only the characters of JavaScript's `\s` as leading whitespace. Format characters such as U+200B and U+FEFF are not in `\s`, so an agent could send a prompt that a harness might still read as a slash command.
What changed: every character in `\p{White_Space}` and in `\p{Cf}` counts as leading whitespace, with the regular expression's `u` flag (rows 38 and 58). The owner's own prompts are still never escaped.

## 87. The agent view did not show a compact turn

Found: 2026-11-01, in the focused review of unit 5d (finding F8).
State: fixed in unit 5d's fix round 1.

What happened: row 67 needs a client to see that an agent is compacting, but the agent view showed only "working".
What changed: the engine's agent view row in `views/apply.ts` has `compacting: boolean`. It is false when the agent starts, becomes true when a compact delivery's `DeliverySent` is applied, and is cleared by the agent's next `TurnEnded` or by any change that leaves the working state. The live and rebuilt views fold it the same way. The row is engine-side, so the contracts are unchanged.

## 88. The dispatch follower is active from the moment the handler starts

Found: 2026-11-01, in the lead's ruling on unit 5d's focused review.
State: fixed in unit 6d (`recovery/service.ts`, `recovery/restart.ts`).

What happens: the committed-event follower starts with the command handler and sends on `SessionOpened`, `DeliveryQueued`, `TurnEnded`, `DeliveryReturned` and `DeliveryRequeued`. It does not send what was queued before it started.
Why it matters: during recovery, events that recovery itself commits could start sends before recovery has re-checked waits or reconciled sessions.
What should happen: unit 6d decides when the follower becomes active during recovery, and how the queues that existed before it started are drained, such as by step 10 calling `dispatchQueued` for each agent.

What changed in unit 6d: the `Restart` service holds a readiness gate that
opens after restart step 9. Until then the command handler refuses every
command with "recovering". The dispatch follower and the account follower
wait for the gate before they act. Step 10 calls `dispatchQueued` for every
agent, so queues that existed before the restart are sent once.

## 89. The parent's crash notice and the wait's crash notice are separate

Found: 2026-11-01, while building unit 5d, and named in the lead's ruling on its focused review.
State: fixed in unit 6c.

What happens: when a child crashes, unit 5d writes a crash notice to each agent whose non-blocking wait names the child and stays open. Unit 6.6 will also tell the child's parent about the crash.
Why it matters: when the waiter is the parent, it would receive two notices for one crash (row 67).
What should happen: unit 6.6 merges the two notices into one when the waiter is the parent.

What changed: the crash handler adds a fixed notice to the nearest available
ancestor only when that ancestor has no open wait naming the dead agent.
The same append computes the wait notices after queuing any ancestor notice.
A blocking
wait's reply serves as its notice. Without an available ancestor, the same
append writes "owner needed" with the fixed reason "agent crashed".

## 90. The first harness's adapter labels mode-raising options as ordinary "allow always"

Found: 2026-11-01, while writing the unit 6a tests, reading `@agentclientprotocol/claude-agent-acp` 0.99.1 (`dist/permissions/options/tools.js` and `shared.js`).
State: fixed in unit 6a. The test `6.3 option table, first harness` in `packages/engine/test/runner/permission-hold.test.ts` states the expected mapping.

What happens: when the agent leaves plan mode, the adapter offers `exit-plan-bypass` ("Yes, and bypass permissions") and `exit-plan-auto` ("Yes, and use auto mode") with the kind `allow_always`. The contracts' `permissionForOptionKind` maps `allow_always` to the level `edit`. Choosing either option actually moves the session to bypass or auto mode, which is the level `full`.
Why it matters: a mapping by kind alone rates a full-access option as `edit` (issue 73). The option is persistent, so the engine already routes it to the owner, but the recorded level is wrong, and any later rule that trusts the level would be too lenient.
What changed: `runner/permissions.ts` maps the recorded exit-plan bypass
and auto identifiers, including the clear-context forms, to full access and
persistence. Other options retain the contracts mapping by kind.

## 91. The deny-rule contract cannot express the first harness's only deny mechanism

Found: 2026-11-01, while writing the unit 6a tests, reading `@agentclientprotocol/claude-agent-acp` 0.99.1 (`dist/acp-agent.js`, the session options near lines 400-440 and 9030-9095).
State: open for the contracts scope and the lead.

What happens: the adapter takes deny rules (`disallowedTools`, `settings`) only through the `_meta.claudeCode.options` field of `session/new`, not through launch arguments. The contracts' `DenyMechanism` (`packages/contracts/src/harnesses.ts`) has only `none` and `launch-arguments`.
Why it matters: rows 61 and 65 ask for a launch-time deny-read and deny-write rule where a harness supports one. With today's contract the first harness must be recorded as `none`, although its adapter has a mechanism.
What should happen: the contracts gain a session-option form of the mechanism, or the lead records the first harness as having no launch-time mechanism in SECURITY.md (row 72). The unit 6a tests cover only the `launch-arguments` and `none` forms.

## 92. The runner's spawn input carries no folder grant

Found: 2026-11-01, while writing the unit 6a tests.
State: fixed in unit 6a.

What happens: `Runner.start` and `Runner.load` (`packages/engine/src/runner/Runner.ts`) take only the folder's path. Issue 49 asks the runner to call `folderForSpawn` immediately before each spawn, and that needs the `FolderGrant` from `checkFolder`.
Why it matters: without the grant the runner can only trust the path string, so a folder replaced between the command's check and the spawn is not caught.
What should happen: the spawn input gains `grant: FolderGrant`, and `commands/start.ts` and `commands/resume.ts` pass the grant they already hold. The unit 6a tests pass a grant and expect a replaced folder to be refused.

What changed: the spawn input now carries the grant already held by the
command. The runner checks it immediately before spawning and checks the
Linux child working folder against the granted identity twice (issue 49).

## 93. Protocol version 2 advertises no session reload capability

Found: 2026-11-01, while writing the unit 6a tests, reading `third_party/t3code/effect-acp/src/_generated/schema.gen.ts` (`SessionCapabilities`, line 4094) and the recorded fixtures.
State: the version 2 rule is implemented in unit 6a. Real-adapter confirmation remains open for post-build check PB-A12.

What happens: in version 2, `SessionCapabilities` has no `load` or `resume` field, and neither recorded version 2 adapter advertises one. Version 1 has `agentCapabilities.loadSession`, which the third harness's adapter sets.
Why it matters: the `reloadable` flag in "session opened" (issue 64) decides whether `resume` can reload an agent. For a version 2 adapter it cannot come from an advertised capability.
What should happen: the builder chooses the version 2 rule (for example, that `session/load` is part of the version 2 baseline) and records it with its source; post-build check PB-A12 confirms it on the real adapters. The unit 6a tests assert the flag only for a version 1 adapter that advertises `loadSession`.

Chosen rule: use the copied client's normalized `agentCapabilities.loadSession`
for both generations. `normalizeInitializeResponse` in
`third_party/t3code/effect-acp/src/client.ts` sets that flag for version 2
when `capabilities.session` exists, and exposes baseline resume support.
The runner records the normalized capabilities and negotiated version in its
process entry, and stores the derived reloadability with `SessionOpened`.
This uses the existing client compatibility rule rather than requiring a
version 2 capability field that does not exist. The frozen version 1 load
test and recorded replays pass locally. No real adapter was started.

## 94. The scripted version 1 fake agent advertised reload but rejected its wire method

Found: 2026-11-01, while building unit 6a and running its frozen reload test.
State: fixed in unit 6a, with the lead's approval in board post 939.

What happened: `scriptedStdio` changed the fake agent's initialization reply
into version 1 and advertised `loadSession`. Its underlying server remained
version 2 and handled only `session/resume`, so a valid `session/load` from
the copied client failed before the reload assertions could run.
What changed: only the version 1 load compatibility path translates
`session/load` into `session/resume`, supplies the missing stdio discriminator,
and normalizes the returned configuration identifiers for the client. The
response retains the original request identifier. No frozen test changed.
Why it matters: a fixture that advertises a method must implement that method
before it can check the runner's reload behavior.

## 95. Seven earlier lifecycle assertions conflict with recording the opened session

Found: 2026-11-01, while building unit 6a and running the command and routing tests.
State: fixed by the lead-authorized unit 6a fix round 1 test commit `68fe9b4`.

What happens: `packages/engine/test/commands/lifecycle.test.ts` has one start
assertion that forbids `SessionOpened`, three reload cases that expect the
agent to remain starting, and two fresh-resume cases with the same expectation.
`packages/engine/test/routing/runner-events.test.ts` has one old-incarnation
case that also expects a successful resume to leave the agent starting.
What should happen: the lead updates those seven assertions to expect the
session event and idle state after the fake runner returns its session, as
required by issue 64 and the accepted unit 6a interface. The builder has not
weakened or changed them.
Why it matters: the scoped integration command now exercises the required
behavior and fails those seven historical expectations. Its other cases pass.

What changed in fix round 1: the test writer preserved the start fields,
starting transition, requeue set, wait and token checks, and updated only the
session-result expectations. The builder merged that signed commit, then
ran the scoped integration command before source changes. All 930 tests
passed, including the seven previously failing assertions.

## 96. Text redaction must retain secrets across protocol chunk boundaries

Found: 2026-11-01, during unit 6a implementation review.
State: fixed in unit 6a.

What happened: redacting each message chunk separately would release a secret
that an adapter split across chunks. Relying solely on the service registry
would also miss a newly resolved spawn secret before the registry saw it.
What changed: the runner streams text through the existing bounded carry
redactor for its resolved secrets and token, followed by the supplied service
redactor when present. It retains event metadata while text is pending and
flushes the carries at item boundaries, session load completion, turn idle,
stop, crash and scope closure. The service exposes its existing chunk method.
Why it matters: the runner's own event stream must contain safe text before
the event log applies its second redaction boundary. Two fake-process checks
cover split secrets and a service registry that has not yet seen the secret.

## 97. A failed mode reset must not leave an elevated child running

Found: 2026-11-01, during unit 6a implementation review.
State: fixed in unit 6a.

What happens: an adapter can report an unknown or elevated mode and then
reject the engine's configuration call that restores the permission ceiling.
A refusal event alone would leave the process in the reported mode.
What changed: mode reports are checked against recorded mappings and the
spawn ceiling. The consumer records the refusal and calls the reset after
the transaction under the agent's send lane. If the adapter rejects it, the
runner kills the process; exit cleanup kills its detached process group.
Why it matters: the fake-process check observes both the mode refusal and
crash, rather than treating a failed reset as a safe running session.

## 98. A stopped start reservation could spawn a child after its token was revoked

Found: 2026-11-01, in unit 6a's final concurrency review.
State: fixed in unit 6a.

What happened: a new agent's identifier becomes visible when `AgentStarted`
commits, before the start command acquires that agent's send lane. Another
client can stop it in that interval. The original start would then acquire
the lane and spawn a child for the stopped agent with its revoked token.
What changed: the start checks that its committed agent is still starting
inside the lane, immediately before calling the runner. A stop that already
won the lane makes the remaining start effect a no-op.
Why it matters: the deterministic check holds the real writer just after
commit, stops the visible agent through the command handler, then releases
the start. It observes zero runner starts and no session event, with the
agent still stopped. No frozen test changed.

## 99. Resolved runner credentials accumulated after their processes closed

Found: 2026-11-01, in unit 6a's focused review, finding F-4.
State: fixed in unit 6a fix round 2.

What happened: the runner appended each resolved account secret and process
token to a layer-wide redaction list and never removed it. Repeated starts
therefore retained credentials for processes that no longer existed.
What changed: each process entry owns its resolved secrets and token. The
fallback redactor reads only registered process entries, and also applies
the service's supplied redactor. Close flushes text before removing the entry
and clearing its secret array. Scope finalization also flushes and releases
the entry, including a failed setup or engine shutdown.
Why it matters: stopped processes must not make the runner retain an
unbounded history of credentials solely for redaction.

## 100. Cancelling a turn left protocol permission requests waiting

Found: 2026-11-01, in unit 6a's focused review, finding F-5.
State: fixed in unit 6a fix round 2. Durable request closure remains issue 74.

What happened: `Runner.cancel` sent only `session/cancel`. A pending
`session/request_permission` remained held by its deferred answer, although
the protocol requires a cancelled response after turn cancellation.
What changed: a hold accepts the protocol's selected or cancelled outcome.
Cancel sends the notification, clears that agent's open holds, resolves each
with the cancelled outcome and awaits its response-write acknowledgement.
A later answer to a cleared hold returns `RunnerRejected`.
Why it matters: the child receives a terminal permission response, while the
engine preserves its existing first-answer-wins and request-closing rules.

## 101. Content arriving after a turn end was attributed to the ended delivery

Found: 2026-11-01, in unit 6a's focused review, finding F-9.
State: fixed in unit 6a fix round 2.

What happened: completion marked the turn ended but retained it in the
process entry. A later content notification could therefore emit another
delivery update and append a thread item for that ended turn.
What changed: completion clears the matching current turn before emitting
its end event. Content with no active turn, outside session replay, is
ignored with a fixed warning that includes no child text.
Why it matters: content after a completed turn must not extend its history
or accept another delivery. Session replay remains separately tagged.

## 102. A future crash stderr tail must redact across chunk boundaries

Found: 2026-11-01, in unit 6a's focused review, finding F-6.
State: fixed in unit 6c.

What happens: the runner currently drains stderr, calls `redactText` and
discards it. That is safe while no bytes are retained or published. It does
not make each chunk safe to retain if a secret spans two chunks.
What should happen: unit 6c's bounded stderr tail uses `redactChunk` with a
carry for each process, and flushes it on exit, stop and scope closure before
persisting or logging the tail. It must not store independently redacted raw
chunks as the crash tail.
Why it matters: joining those chunks could reconstruct a secret that neither
individual `redactText` call could match.

What changed: every child has its own stderr carry and bounded tail. The
runner drains stderr and flushes the carries before emitting its exit
event. Stop and scope cleanup also flush the carries before releasing
credentials. The handler stores the resulting tail through the event
log's redaction boundary.

## 103. Adapter setup has no timeout, and spawn registration is not atomic

Found: 2026-11-01, in unit 6a's focused review, finding F-8.
State: fixed in pull request #9 (post-build A3, commits `ddbb1d4` and `4014f7e`), merged on 2026-11-03. Residual limits are recorded in issues 266, 267 and 268. Issue 266 is record only. Issues 267 and 268 remain open.
The plain `start` remainder was fixed as post-build A3, with a two-minute setup bound and stop pre-emption.
The post-build A3 corrections leave residual cleanup and writer limits in issues 267 and 268.

What happens: initialization, session creation, session load and initial
configuration have no deadline. An adapter that never responds can keep a
start or reload pending. The duplicate-process check also precedes secret
resolution and spawning, so it is not atomic with process-table registration.
What should happen: unit 6d sets the recovery setup timeout and cleanup
policy, and preserves per-agent serialization or adds an atomic reservation
for callers that bypass command lanes. Today's command and delivery paths
hold the per-agent lane across runner setup, which serializes normal calls.
Why it matters: a stalled setup must not hold recovery forever, and a future
direct concurrent caller must not create two processes for one agent.

What changed in unit 6d: every recovery reload, account-return reload and
`resume` is bounded by `SETUP_TIMEOUT_MILLIS` (two minutes, set through
`setupTimeoutMillis`). At the deadline the engine calls `Runner.stop` and
records the fixed reason "adapter setup timed out". `AcpRunner.spawn`
reserves the agent before any await, in the same step as the duplicate
check, so two direct callers cannot create two processes. A reload uses only
the method the peer advertised at initialize: `session/load` when it
advertised `loadSession`, otherwise `session/resume` when it advertised
resume, and otherwise it is refused with "adapter cannot reload". The plain
`start` command was not bounded at the reviewed commit `8ff4c9b`.

What changed in pull request #9: commits `ddbb1d4` and `4014f7e` apply the same
two-minute setup bound to a plain start and let an authorized stop pre-empt
that setup.
The post-build result for task 2 reports passing setup tests and a clean
engine type check at commit `4014f7e`.
The stalled-send stop path remains open in issue 265.

## 104. Three harnesses have no verified deny-read or deny-write rule

Found: 2026-11-01, by the lead, merging unit 6a for plan task L4.
State: open, for the live check.

What happens: `packages/engine/src/runner/denyRead.ts` gives every harness the
`none` deny mechanism by default. For `codex`, `gemini` and `cursor`, no
launch-argument rule that forbids reading the state folder or writing the
harness settings has been verified against the installed adapter.
What should happen: each of these harnesses gets a verified launch rule in its
default settings, or a recorded finding that its adapter has none.
Why it matters: without the rule, only the folder rule, the permission ceiling
and the approval routing guard the state folder and the settings files (rows
61, 65 and 72). `SECURITY.md` lists these harnesses.

## 110. The replay test for the cursor transcript expects success, which unit 6c changes

Found: 2026-11-01, by the unit 6c test writer, while writing criterion 6.9.
State: fixed in unit 6c, with the lead's approval in the builder task.

What happens: `packages/engine/test/runner/replay.test.ts`, the test named
"6.2 replay cursor", replays the recorded cursor transcript with no
classifier and expects a successful turn. The transcript ends in the reply
"Upgrade your plan to continue". Criterion 6.9 and issue 38 require that reply
to give an out-of-usage pause once the real classifier is the runner's
default.
What should happen: the builder of unit 6c updates that one test to expect the
pause. The new test in `classify-errors.test.ts` already holds the new
expectation, so the old one would otherwise fail for a correct change.
Why it matters: a builder who sees a red test in a file they did not write
might weaken the classifier to make it green again.

What changed: only the cursor replay's expected outcome changes from
success to an out-of-usage pause. The other recorded greetings still expect
success, and the runner uses the real classifier by default.

## 111. The runner discards a child's stderr, so a crash records none of it

Found: 2026-11-01, by the unit 6c test writer.
State: fixed in unit 6c.

What happens: the runner drains a child's stderr and throws the text away
(`AcpRunner.ts`, the stderr reader), and its exit event carries an empty
`stderr`. The command handler writes `stderr: ""` into the crash event, so
the owner sees an exit code and nothing about why the adapter died.
What should happen: the runner keeps the last lines through the redactor's
chunk carry (issue 102), flushes the carry before it reports the exit, and
the handler stores that text in the crash event.
Why it matters: a crash with no error text cannot be diagnosed, and a
tail that is cut per chunk could store a secret that was split across two
chunks.

What changed: the runner retains the last 30 redacted stderr lines, bounds
each retained line to 16,384 characters, and drains the pipe before reporting
the exit. The handler persists the tail with the exit code or signal.

## 112. A crash cancels no permission request and tells no parent

Found: 2026-11-01, by the unit 6c test writer, as the follow-up to issue 74.
State: fixed in unit 6c.

What happens: the exit handler marks the agent crashed, withdraws its pending
deliveries and revokes its token, but it does not cancel the agent's open
permission requests, does not queue a notice to the agent that can act for
it, and never writes "owner needed" for an agent the owner started. A
parent without a wait on the crashed agent learns of the crash only by
looking at the roster.
What should happen: the crash append also holds the cancellations, exactly
one notice to the nearest available ancestor (merged with the wait's own
notice when that ancestor waits, issue 89), or one "owner needed" when no
agent can act.
Why it matters: an open request of a dead agent stays in the owner's inbox
forever, and a team lead can wait on a worker that will never answer.

What changed: the crash append cancels the dead agent's open permission
requests, withdraws their queued deliveries, revokes its token, and tells
the nearest available ancestor once, or records that the owner is needed.
The notification contains no stderr, exit code or signal.

## 113. Nothing closes the open questions of a crashed agent

Found: 2026-11-01, by the unit 6c test writer.
State: open, needs an owner decision.

What happens: issue 74 says question closure must use an agreed contract and
not invent an answer. No event closes a question without an answer, so the
questions a crashed agent asked stay open after its crash. The unit 6c tests
only assert that a crash writes no invented answer.
What should happen: the owner decides whether a question needs a "withdrawn"
event, or whether an open question of a crashed agent stays open on purpose
until its asker is replaced.
Why it matters: the owner's inbox lists questions that nobody can receive an
answer for.

## 114. A blocking wait on a crashed agent has no stated parent notice

Found: 2026-11-01, by the unit 6c test writer, while reading issue 89.
State: open, a reading is recorded and untested.

What happens: row 67 merges the crash notice with the parent notice "when the
waiter is also the parent" and a non-blocking wait stays open. A blocking wait
creates no delivery, so the rows do not say whether the parent, who is
blocked inside the wait call, should also get a notice.
What should happen: the builder follows the reading in the unit 6c result
(the wait reply is the notice, and no extra delivery is written), or the
owner states otherwise. The unit 6c tests do not cover this case.
Why it matters: a second notice to a blocked parent would be delivered after
its wait call returns and repeat what the call already told it.

## 120. The leftover-process reader does not support macOS yet

Found: 2026-11-01, while building unit 6c.
State: unsupported recovery is handled in unit 6d. A macOS implementation and host verification remain open.

What happens: `recovery/orphans.ts` provides the Linux reader and an explicit
unsupported macOS reader. The macOS reader throws before the sweep can send
a signal.
What should happen: a macOS implementation reads the boot identity, process
group, start time, user and executable, and passes criterion 6.8 on a macOS
host before recovery uses it.
Why it matters: a sweep must refuse unsupported process identity checks
rather than signal a group based only on its number. The lead authorized
this stub for unit 6c.

What changed in unit 6d: restart step 5 runs the sweep with the host's
reader. A reader that throws for a row is treated as "process identity
unavailable", so that group is left alone and never signalled. Recovery goes
on. If the sweep itself fails, recovery logs the fixed warning "leftover
process sweep failed" and goes on.

## 121. The frozen classifier-test helper inferred an unknown Effect requirement

Found: 2026-11-01, while running the engine typecheck for unit 6c.
State: fixed in unit 6c, with the lead's approval in board post 968.

What happened: `test/runner/classify-errors.test.ts` gave `turnReply` an
untyped runner and waiter. Yielding those values inferred an unknown
Effect requirement, causing four type errors at `withAcpRunner` call sites.
What changed: the helper now explicitly returns
`Effect.Effect<unknown, unknown, never>`, with a matching cast on its
generator. No assertion or test case changed.
Why it matters: the runtime checks passed, but the frozen helper prevented
the required engine typecheck from passing.

## 122. The request-routing crash test excluded the new owner crash alert

Found: 2026-11-01, while running the full engine and testing suite for unit 6c.
State: fixed in unit 6c, with the lead's approval in board post 970.

What happened: `test/routing/moving-requests.test.ts` expected exactly two
"owner needed" events when a dead holder's permission request and question
moved to the owner. Unit 6c also requires a separate crash alert when the
dead agent has no available ancestor, so the old assertion rejected a
correct third event with no subject.
What changed: the shared assertion still requires exactly the two subject
alerts. The crash case separately requires exactly one subjectless alert
for the dead lead, with the fixed reason "agent crashed", in the same append.
Why it matters: preserving the old expectation would suppress a required
notification about a dead agent.

## 123. Crash notices must be queued before checking ancestors for settlement

Found: 2026-11-01, during the unit 6c implementation review.
State: fixed in unit 6c before hand-off.

What happened: an intermediate implementation evaluated waits before adding
the ancestor's crash notice. Cancelling a dead child's last permission
request could temporarily make its idle holder look settled, satisfying a
higher ancestor's wait before the queued crash notice made the holder busy
again.
What changed: the crash helper uses existing open waits to choose whether
the ancestor needs a separate notice. The command handler evaluates waits
only after the complete crash batch, including that notice, is assembled.
Why it matters: a crash notice is pending work, so its target must not look
settled to a higher ancestor in the same append.

## 124. A permission-race test intermittently observes an earlier log event

Found: 2026-11-01, during unit 6c's full engine and testing suite.
State: the four permission races are fixed by the unit 6c fix-round test
writer's commit `cf3419e`. Its follow-up `39302d8` corrects the related
request-routing assertion.

What happened: `routing/permissions.test.ts`, "5.5 answer racing pass-up",
failed its `whileHeld` assertion because it contained an earlier event.
The focused reviewer reproduced the failure on the base as well, in three
of eighteen runs under load. The event is `DeliverySent`, with
the owner as caller, for the family fixture's delivery to `lead`.
The same timing gap affects "5.5 token race on answer".
Why it happens: `support/routingRig.ts`, `behindWriter`, reads the initial
log sequence before forking the writer-permit holder. The fixture returns
before its pending dispatch is committed. That dispatch can commit between
the watermark read and acquisition of the writer permit, even though both
raced commands correctly wait. Engine-lead confirmed this finding in the
unit 6c fix-round brief on 2026-11-01.
What changed: the permissions tests wait for the fixture's pending
`DeliverySent` before a race takes the watermark. The change covers the two
answer-pair races, the answer/pass-up race, and the token/answer race. The
test writer reported ten of ten passing runs with the fix under load,
compared with one failure in ten runs without it, at `f07a721` with only
the respective test edits present. No production serialization code changed.
Why it matters: the assertion can reject correct command serialization.
The unit 6c production changes did not cause the race.

Related observation: the first full run with `cf3419e` merged, at
`bb839e2` with only this issue update uncommitted, failed the "5.6 no
timeout" case in `routing/moving-requests.test.ts`. Its prohibited subject
events were absent, but the runner-call count increased from zero to one
because a `prompt` call arrived after the fixture's watermark. The fixture
likewise returns before its idle holder's delivery has been dispatched.
The test writer's follow-up permits a late `prompt` only for a delivery
queued before the watermark. It still rejects other runner calls and keeps
the subject-event and open-request assertions. No builder edit to the test
was made.

## 126. A detached helper could prevent the adapter's crash from being recorded

Found: 2026-11-01, in unit 6c's focused review, finding F-1.
State: fixed in unit 6c fix round 1.

What happened: an adapter could start a helper in a separate session with
inherited stderr. Killing the adapter's process group did not close the
helper's pipe. The exit watcher waited indefinitely for the stderr reader,
so it never emitted `exited` and the handler could not revoke the token.
What changed: the watcher waits up to two seconds for stderr to drain. On
timeout it interrupts the reader, flushes the redacted tail it already has,
and emits the exit event. It never signals the unrecorded detached helper.
Why it matters: an open inherited pipe must not keep a dead agent's
credential valid or hide its crash.

## 127. Recovery needs a policy for groups that cannot be proven or stopped

Found: 2026-11-01, in unit 6c's focused review, finding F-3.
State: the unbounded wait is fixed in unit 6c fix round 1. The recovery
response is fixed in unit 6d. The absent-leader case stays left alone by design.

What happened: the sweep waited indefinitely when a group still appeared
alive after SIGKILL. It also verifies identity only through the recorded
group leader. When that leader is gone, live group members cannot be
proven to belong to the recorded adapter, so the reader reports no process
and the sweep leaves them alone.
What changed: the post-SIGKILL wait defaults to five seconds and can be
set with `killWaitMillis`. If matching process facts remain at the deadline,
the sweep returns `left-alone` with the fixed reason `group did not exit`.
What should happen: unit 6d handles these outcomes and the throwing macOS
reader in issue 120 explicitly. It must not signal members whose recorded
identity cannot be verified. The leader-only identity rule remains intact.
Why it matters: recovery must neither hang forever nor signal an unrelated
process because its group number matches an old row.

What changed in unit 6d: recovery keeps the leader-only identity rule. A
group whose leader is gone, or whose identity the reader cannot prove, is
left alone. A group that did not exit after SIGKILL keeps the result
`group did not exit`, and recovery logs the fixed warning "leftover process
group did not exit" and goes on. A signal that fails with anything other
than "no such process" records `left-alone` with the fixed reason "signal
failed", and the sweep moves on to the next row.

Post-build evidence, 2026-11-03, at commit `8ff4c9b`: post-build A8 records a
surviving group after its verified leader exits during the sweep.
Evidence: the post-build A8 adjudication is in
`.scratch/foundry-runs/engine-build-1/review-post-build/adj/result-3.md` (not tracked).
It adjudicates flow4 F-3 and s19 F-1 by source inspection and hand reasoning.
In `packages/engine/src/recovery/orphans.ts`, the identity reader checks only
the leader at `/proc/<groupId>`.
After the verified group receives the termination signal (SIGTERM), its
leader can exit while a member survives.
The sweep then skips SIGKILL and reports the group as stopped.
In `packages/engine/src/service.ts`, pruning the missing leader's process
row removes the evidence needed to find the surviving group on a later restart.
This differs from a leader that was already absent before verification.
The prune also erases the left-alone rows when the leader was already absent
before the sweep.
Score: MINOR, severity 5 × fallout 3 × probability 3 = 45, band record.
The owner's decision on 2026-11-03 keeps leader-only identity, with no exception.
This is record only, without permission to signal a group after its leader
has gone.

## 128. Classified pauses need trustworthy error sources and reset times

Found: 2026-11-01, in unit 6c's focused review, finding F-4, and the unit 6b
review's ruling A3, relayed by engine-lead in board post 980.
State: error-source classification is fixed in unit 6c fix round 1. The
reset-time producer is fixed in fix round 2 after merging unit 6b. Recorded
adapter evidence for a reset time remains open.

What happened: the runner classified a successful turn's text, so ordinary
agent prose containing "authentication required" could produce a signed-out
pause. Unit 6b would then apply that pause to the entire account.
What changed: a signed-out classification requires an actual error reply
in `turn.error`. Successful text can produce only an out-of-usage pause,
and only for cursor, whose recorded transcript uses that text form
(issue 38). All other harnesses classify only their error replies. The
same restrictions apply to an injected classifier.
The runner now reads `data.resetsAt` only from the error for its active
`session/prompt` request. This includes the terminal idle error in Agent
Client Protocol version 2, where the raw request reply is an acknowledgement.
Reading only the raw reply dropped valid deadlines in the frozen tests.
An out-of-usage pause carries a parsed date string
or a finite, non-negative integer in epoch milliseconds, within 366 days
of the current time in either direction. Invalid values are ignored, so
unit 6b keeps its "owner needed" path when no deadline is known. Successful
turn text and signed-out pauses never carry this field. The classifier's
signature is unchanged.
What remains: recorded fixtures must verify the real adapter's reset-time
form. The fake agent's `out_of_usage` step already supplies `data.resetsAt`,
but no recorded fixture holds a reset time yet, as recorded in the brief.
Why it matters: account recovery cannot schedule a usage reset from a
classified pause that lost its reset time.

## 105. The runner's classified pause reply cannot carry a usage reset time

Found: 2026-11-01, while writing unit 6b's account tests.
State: fixed in unit 6b (`resetAt` is optional on the pause outcome and is written to `AccountOutOfUsage` and the paused state); the classification producer stays with unit 6c.

What happens: the `promptReply` pause outcome in
`packages/engine/src/runner/Runner.ts` carries only `reason` and `error`.
The account and lifecycle event contracts already carry `resetAt`, but no
reset time can reach their writer through this runner event.
What should happen: add optional `resetAt` in epoch milliseconds to the
pause outcome, preserve it through validation, and record it in
`AccountOutOfUsage` and the paused state. The account timer must use the
logged deadline after restart. The fake runner's test-only outcome now
accepts that field so the tests can specify the missing seam.
Why it matters: decisions 28, 52 and 53 require the account to return at its
reported wall-clock reset time, including when that time passed during
downtime. Classification itself remains unit 6c's work.

## 115. A pause before the session opens is not handled

Found: 2026-11-01, by engine-u6bb, building unit 6b.
State: fixed in unit 6d for the return path (`recovery/restart.ts`).

What happens: row 53 says a pause before the session opens keeps no session, and when it clears the engine opens the session and then sends the first prompt. The start path (`commands/start.ts`) writes the agent, spawns, and records the session in one flow. A provider limit reported before `SessionOpened` has no pause path, and no frozen test covers it.
What should happen: a start that is paused before its session opens keeps no session reference, and the account return opens the session first and then sends the first prompt.
Why it matters: without it, such an agent stays stopped instead of waiting for its account. The change needs the start path restructured, which is larger than unit 6b's scope.

What changed in unit 6d: when an account returns, a paused agent that has
no session is started, not loaded, and its first queued prompt is sent after
the session opens. Frozen test A06 covers it after a restart. The start
command's own handling of a sign-out while starting is unchanged.

## 116. A crash between an "account available" commit and the return write leaves agents paused

Found: 2026-11-01, by engine-u6bb, building unit 6b.
State: fixed in unit 6d (`recovery/restart.ts`, step 8).

What happens: the agents on an account return to idle in a second transaction, written by `accounts/available.ts` after it sees the committed `AccountAvailable`. If the service stops between the two commits, the account is available and its agents stay paused. Nothing re-runs the return at startup.
What should happen: startup recovery runs the return once for every available account that still has paused agents. The return is idempotent, so a second run writes nothing.
Why it matters: those agents would never resume without an owner `accounts mark-available` call, which the owner cannot know to make.

What changed in unit 6d: restart step 8 reads the latest `AccountAvailable`
cause of each available account and runs the return for every account that
still has returnable paused agents. A paused agent whose process is gone is
reloaded, or started if it had no session. A second run writes nothing.

## 117. The timer and the persistent secret store are not wired into a running service

Found: 2026-11-01, by engine-u6bb, building unit 6b.
State: fixed in units 6d and 7a.

What happens: `packages/engine/src/index.ts` exports nothing, so `startAccountTimers` (`accounts/timers.ts`) and the persistent secret store layer (`accounts/SecretStore.ts`) are called only from tests. The `AcpRunner` layer also now needs `FileSystem` and `Path` services for the Codex shadow home.
What should happen: the assembly starts `startAccountTimers` inside the service scope, provides the persistent `SecretStore` layer over the state folder, and provides the Node file system and path services.
Why it matters: without the timer an out-of-usage account returns only by owner action, against rows 28 and 53.

What changed in unit 6d: `Restart.recover` starts `startAccountTimers` at
restart step 8, inside the scope `recover` runs in. Unit 7a must not start
the timers a second time. It must still provide the persistent `SecretStore`
layer and the Node file system and path services.

What changed in unit 7a: the service provides the persistent secret store, the
Node platform services, and the redactor before constructing the runner and
the restart layer. It calls `Restart.recover` once and lets recovery start the
account timers.


## 118. A classified pause drops the provider's error text

Found: 2026-11-01, by engine-u6bb, building unit 6b.
State: open; no change planned until the owner asks.

What happens: the `promptReply` pause outcome carries an `error` string, but the pause path writes only the fixed reasons ("account needs sign-in", "account is out of usage, no reset time known") so that no provider text reaches the log, a view or a reply.
What should happen: if a diagnostic is wanted, unit 6c classifies and redacts it before it is stored, and the owner decides where it is shown.
Why it matters: an owner sees that an account is paused but not what the provider said, which makes odd limit messages harder to diagnose.

## 119. Unreferenced secrets are never collected

Found: 2026-11-01, by engine-u6bb, building unit 6b.
State: fixed in unit 6d (`recovery/restart.ts`, `accounts/SecretStore.ts`).

What happens: `accounts/SecretStore.ts` stores a value before the account event that references it commits. A failed commit, or a replaced secret, leaves a value in `secrets.json` that no account event refers to.
What should happen: startup recovery lists the secret references still used in the account views and removes the others from `secrets.json`.
Why it matters: an unused credential stays on disk (mode 0600) longer than the owner expects.

What changed in unit 6d: during restart, recovery collects every account's
secret reference and every `secret:` environment value, and calls the
store's `retainOnly`. The persistent store rewrites `secrets.json` only when
something is removed, under its write lock.

## 125. Fix-round test F1 assumed a sign-out pauses only the agent that reports it

Found: 2026-11-01, by engine-u6bb, running the full suite for unit 6b.
State: fixed in unit 6b by engine-lead's ruling.

What happens: `routing/fix-round-one.test.ts` F1 "inherited grandchild" paused a child with the reason `signed-out` and then expected its idle caller, on the same account, to still run `wait`. Rows 28 and 53, and the frozen 6b test T1, make a sign-out pause every agent on the account, so the caller was paused and its `wait` was refused.
What should happen: the test pauses the child with `out-of-usage` and no reset time, which pauses only that child and keeps the intent of the test (a wait on a paused member).
Why it matters: two frozen tests disagreed, and the suite could not pass until one changed.

## 131. A carry-on delivery was returned as failed instead of reaching the agent

Found: 2026-11-01, in the focused review of unit 6b (finding A1).
State: fixed in unit 6b fix round 1.

What happens: `accounts/available.ts` queues a mid-turn agent's carry-on with content tagged `carry-on`. `routing/deliveries.ts` passed it to `runner.prompt` unchanged, and the real runner accepts only content tagged `prompt`, so the delivery came back as "delivery failed" and the agent never saw it.
What should happen: `AcpRunner.send` accepts carry-on content and sends its text as the prompt (a two-line change; the frozen tests T5 and T7 expect the runner input to keep the `carry-on` tag). The logged delivery keeps its tag too.
Why it matters: an agent paused mid-turn came back idle without being told to carry on, which row 53 requires.

## 132. A starting agent could get work after its account signed out

Found: 2026-11-01, in the focused review of unit 6b (finding A2).
State: fixed in unit 6b fix round 1.

What happens: a sign-out paused only working and idle agents on the account. A sibling still starting opened its session afterwards and was sent its first prompt on a signed-out account.
What should happen: (a) a sign-out also pauses the account's starting agents, with `signed-out` and `midTurn` false; (b) when `start` records `SessionOpened` and the account is then `needs-sign-in`, the same append pauses the agent; (c) dispatch never sends to an agent whose account is `needs-sign-in`. All three are done. The lifecycle table makes `SessionOpened` invalid from `paused`, so the reducer records the session and keeps the paused state; `start` accepts a starting or paused agent, and returns a paused-while-starting agent to idle when its session opens after the account came back. `accounts mark-available` skips an agent that has no session yet, since `start` returns it.
Why it matters: work reached an account the owner had to sign in again.

## 133. A symbolic link in the state folder could move the shadow home outside it

Found: 2026-11-01, in the focused review of unit 6b (finding A4).
State: fixed in unit 6b fix round 1.

What happens: the shadow home path is built under the state folder, but a symbolic link on the way (for example `providers/codex/<account>`) made the copied code create directories and links outside it.
What should happen: `accounts/shadowHome.ts` resolves the real path of the deepest existing part, and refuses with the fixed reason `account home cannot be prepared` unless the result lies inside the real state folder. It checks before anything is made and again afterwards. The copied source is unchanged.
Why it matters: a link planted in the state folder could redirect private authentication files out of it.

## 134. An out-of-usage account still sends work to its idle siblings

Found: 2026-11-01, in the focused review of unit 6b (finding C3).
State: open question for the owner.

What happens: rows 28 and 53 make only a sign-out account-wide. When one agent reports a usage limit, the account is marked out of usage and that agent pauses, but its idle siblings keep receiving work, and each may hit the limit once before it pauses itself.
What should happen: the owner decides whether idle siblings should pause (and their queued work wait) as soon as the account is known to be out of usage.
Why it matters: each sibling's first turn after the limit is wasted, and a turn that fails with the limit costs a delivery requeue.

## 144. Replay updates lose the speaker before recovery can scan delivery identifiers

Found: 2026-11-01, while writing the unit 6d restart tests at `287c4df`.
State: fixed in unit 6d (`runner/Runner.ts`, `runner/translate.ts`, `runner/AcpRunner.ts`).

What happens: `packages/engine/src/runner/translate.ts` translates both user
and agent message chunks to the same message shape during a reload.
`packages/engine/src/runner/AcpRunner.ts` then publishes a replay update
without its speaker. The recovery scanner cannot tell whether a delivery
identifier occurred in a user message or in an agent's answer.
What should happen: preserve the speaker through translation, redaction and
publication. Decision row 66 permits matching only joined user-message
content. The unit 6d tests use an optional `role: "user" | "agent"` on message
updates, and require the real runner to preserve it too.
Why it matters: scanning an agent answer as an acknowledgement can lose an
unaccepted delivery. Ignoring user replay chunks can repeat an accepted one.

What changed in unit 6d: a message update carries an optional `role` of
"user" or "agent". The translator sets it, and the runner flushes its
message buffer when the speaker changes, so one published update never mixes
two speakers. The replay scan in `recovery/replay.ts` joins only consecutive
user chunks.

## 145. Account-return carry-ons do not include their delivery identifier on the wire

Found: 2026-11-01, while writing the unit 6d real-runner tests at `287c4df`.
State: fixed in unit 6d (`accounts/available.ts`, `recovery/reload.ts`).

What happens: `packages/engine/src/accounts/available.ts` queues a carry-on
with plain text. `packages/engine/src/runner/AcpRunner.ts` sends that text
unchanged. The carry-on's delivery identifier is absent from the prompt.
What should happen: a recovery or account-return carry-on includes its
identifier in the prompt envelope, as ordinary prompts do. Decision rows 29
and 51 use that identifier to distinguish a retry from work already accepted
before a service interruption.
Why it matters: after another interruption, a replay scanner cannot find an
accepted carry-on whose identifier never reached the adapter. The real-runner
restart test checks the identifier in the actual prompt frame.

What changed in unit 6d: every carry-on the engine writes ends with the
fixed line "(delivery <id>)", built by `carryOnText` in `accounts/available.ts`.
Examples are "The pause has ended. Carry on with what you were doing.
(delivery <id>)" and "The engine restarted. Carry on with what you were
doing. (delivery <id>)". The text holds no secret and no free text. The
older test A1 in `accounts/carry-on-dispatch.test.ts` was changed to expect
it, with the lead's approval.

## 150. An owner prompt carries no delivery identifier, so a replay cannot find it

Found: 2026-11-01, while building unit 6d, named in the lead's ruling #1042.
State: open; the lead decides later, because it changes owner prompt text (rows 38 and 58).

What happens: `routing/envelope.ts` (`agentText`) sends the owner's prompts
unchanged, with no envelope and no delivery identifier. After a restart, the
replay scan cannot find an owner prompt that was sent but never accepted.
What should happen: an owner prompt carries its identifier in a form the
replay scan can read, or recovery uses another proof that it was received.
Why it matters: such a prompt is sent again after a restart, so the agent may
do the same work twice.

## 151. Frozen test E01 checked for a string its own setup writes

Found: 2026-11-01, while building unit 6d.
State: fixed in unit 6d with the lead's approval (#1045).

What happened: `test/recovery/restart-real-runner.test.ts:103` asserted that
"private-replayed-answer-E01" is absent from the whole log and snapshot. The
test's own `AccountChanged` event stores that text in the fake adapter's
script, so the assertion could never pass.
What changed: the two tokens are still checked over the whole log and
snapshot. The replayed answer is checked over the events recovery wrote and
the snapshot's threads.
Why it matters: the test still proves that replayed history never reaches a
thread, without failing on its own setup.

## 152. A paused agent that cannot reload after a restart has no path back except stop

Found: 2026-11-01, while building unit 6d.
State: open.

What happens: when its account returns, a paused agent with a session whose
adapter cannot reload gets `AgentReloadFailed` with the fixed reason "agent
reload failed" and stays paused. `resume` refuses a paused agent, so only
`stop` and a new start remain.
What should happen: the owner decides whether `resume --fresh` should accept
a paused agent, or whether the return should open a fresh session by itself.
Why it matters: the agent's queued work stays stuck until the owner notices.

## 153. Nothing records process rows, and swept rows are never removed

Found: 2026-11-01, while building unit 6d.
State: fixed in unit 7a.

What happens: `EventLog` can insert `processes` rows through a side row, but
no production path passes one, so restart step 5 has nothing to sweep
outside tests. The sweep also never deletes the rows it handled, so they are
read again at every restart.
What should happen: the runner records each adapter's process identity when
it spawns, and recovery removes or marks the rows it has handled.
Why it matters: leftover adapters from a crash keep running after a restart,
and old rows grow without bound.

What changed in unit 7a: the runner records each Linux adapter group, boot
identifier, start time, user identifier, and executable immediately after
spawning. The service removes records of dead or replaced identities after
recovery has swept them. Live identities remain available to the ancestry
guard. The unsupported macOS reader remains issue 120.


## 154. The replay scan waits a fixed number of yields for the handler

Found: 2026-11-01, while building unit 6d.
State: fixed in unit 6d fix round 1 (`runner/Runner.ts`, `runner/AcpRunner.ts`, `recovery/replay.ts`, `recovery/reload.ts`).

What happened: the runner's events have one consumer, the command handler,
which passed replay updates to `recovery/replay.ts`. After the load
returned, the scan yielded 64 times so the handler could drain what was
already published, and then read what it had seen. The trigger is replay
length, not machine load: the verifier measured a miss between 1,250 and
1,500 replayed filler frames on an idle machine. A user chunk that came
after the filler was not read, so a delivery the agent had already received
was sent to it again.
What changed: the runner records each replayed update of a load, in order,
and returns that record with the load result as `SessionInfo.replay`. A
user-message item carries its redacted text, and every other replayed update
is one break, with consecutive breaks kept as one. The scan joins only
consecutive user items, so it reads every replayed update of that load and
never waits on the event stream. The command handler no longer takes part.
`SessionOpened` is written from named fields only, so the replayed text never
reaches the log.
Why it matters: a long history is the normal case for an agent that has
worked for a while, so a scan that depends on scheduling misses exactly
when recovery is most needed.

## 158. A no-timeout routing test can count a prompt sent after its snapshot

Found: 2026-11-01, by the lead, in the team test runner's check of `worker/engine-i9b` at e263a12 (run 69).
State: open. The test is unchanged; a later test-only task fixes it.

What happens: `packages/engine/test/routing/moving-requests.test.ts`, "5.6 no timeout" (line 307), seeds an idle `lead` through `family()`, whose permission and question deliveries are sent on a forked dispatch lane. The test records `fakes.runner.calls.length` straight away. Under machine load (7.7 in run 69) one of those `prompt` calls lands after the snapshot, and `expect(fakes.runner.calls).toHaveLength(callsBefore)` fails with one extra call. The branch under test changed no engine source, and five local re-runs and the re-run (run 73) passed.
What should happen: the test waits until the seeded deliveries are sent (or reads their delivery rows as `sent`) before it records `callsBefore`, as other routing tests do with `eventually`.
Why it matters: a check that fails at random hides real failures and costs a re-run each time.

## 159. A second recovery on one service could repeat the token revocation and the interrupt

Found: 2026-11-01, in unit 6d's focused review (finding 4) and attack pass (B3), confirmed by the verifier as a library defect not reachable at `9b5853c`.
State: fixed in unit 6d fix round 1 (`recovery/service.ts`, `recovery/restart.ts`) and completed in unit 7a (`service.ts`).

What happened: `Restart.recover` set its completed flag only after step 10.
A run that failed or was interrupted before then could be started again on
the same service, which revoked every token again, swept again and
interrupted agents that the first run had already started to reload.
What changed: each service runs recovery at most once. After a run
completed, `recover` is a no-op. After a run that started and did not
complete, `recover` fails at once with `RecoveryAttempted` and the fixed
reason "recovery already attempted; start a new engine", and writes
nothing. The gate stays shut. `Restart.recover` documents that such a
failure is fatal to the service, and that unit 7a must start a fresh engine,
whose new service runs recovery over the same log.
Why it matters: a repeated step 4 and step 6 would revoke the tokens of
agents the first run had just reloaded, and interrupt them again.

What changed in unit 7a: a failed recovery exits the service with a nonzero
status and closes its listener. The service never retries recovery in place.

## 160. The fake agent's Shephrd command step does not speak the engine's protocol

Found: 2026-11-01, while writing the unit 7a tests.
State: fixed in unit 7b: the step uses the real `@shephrd/client`.

What happens: the `shephrd_command` step in `packages/testing/src/fakeAgent.ts`
opens a WebSocket to `SHEPHRD_SOCKET` and sends `{ command, input }` as JSON.
That is not an Effect RPC request, and the step reports
`shephrd_command:ok` on any reply at all, an error reply included.
What should happen: the step sends a real RPC request through unit 7b's
client and reports the reply's outcome.
Why it matters: a test that trusts `shephrd_command:ok` would pass while the
command failed. Unit 7a's tests do not use the step: criterion 7.10 reads
the reloaded agent's token from the fake agent's echo file and calls through
the test-only client in `packages/engine/test/support/socketClient.ts`.

## 161. Row 64 does not say what an upgrade without an ancestor chain means

Found: 2026-11-01, while writing the unit 7a tests.
State: open for the lead; the unit 7a tests take the reading below.

What happens: row 64 says the client sends its ancestor chain and process
group on upgrade, and the engine refuses the owner credential when one of
them matches a recorded adapter process. It does not say what happens when
the chain or the group is missing or malformed.
What should happen (the tests' reading): the engine refuses the owner
credential with HTTP 403 when either header is missing or malformed, so a
caller cannot skip the check by leaving the headers out. Agent tokens and
device credentials do not need the headers.
Why it matters: reading a missing chain as "outside every adapter" would make
the check optional for any caller.

## 162. The ancestry check rests on the caller's own claim

Found: 2026-11-01, while writing the unit 7a tests.
State: open; a limit of row 64's design, recorded for the attack pass.

What happens: Node.js does not expose a Unix socket peer's process id (row
48), so the engine cannot read the caller's ancestors itself. It checks the
chain the client sends. A process inside an adapter's tree that can read
`owner-credential` can also send a chain that leaves the adapter out.
What should happen: the check stays as row 64 describes, as a guard against
an agent's shell acting as the owner by accident. The owner credential file
also needs the deny-read rule wherever the harness has one (row 61).
Why it matters: row 64 does not stop a hostile agent on a harness without a
deny-read mechanism.

## 163. Issue 41's bound for a stalled subscriber has no number

Found: 2026-11-01, while writing the unit 7a tests.
State: open for unit 7a's builder; the test sets an upper limit.

What happens: issue 41 asks unit 7a for a bound or a disconnect rule, but no
row names the size. A subscriber that stops acknowledging Effect RPC stream
chunks stops the server's stream for it, and the committed events then
queue in its `PubSub` subscription.
What should happen (the tests' reading): the server ends the stalled
subscription, or closes its connection, before 10,000 unacknowledged events
of about one kilobyte each. Dropping events is not allowed, because
`subscribe` is gapless; the client subscribes again from its last sequence.
Why it matters: one stalled client must not hold the engine's memory.

## 164. An agent's subscribe never shows its own refusals or the deliveries queued to it

Found: 2026-11-01, while writing the unit 7a tests.
State: open for the lead; criterion 7.3 is followed as written.

What happens: criterion 7.3 makes every agent-less event owner-only. Two
event types concern an agent without carrying a top-level `agentId`:
`CommandRefused` (no agent field) and `DeliveryQueued` (its agent is
`delivery.target`). The log stores no `agent_id` for them, so an agent's
`subscribe` never returns them, even for its own command or its own queue.
What should happen: either the criterion stays, or those events gain an
`agentId` (a contracts change) so they can be shown to the agent concerned.
Why it matters: an agent following its own thread cannot see that its
command was refused, or that a message is waiting for it.

## 165. Nothing gives the server the live adapters' process identities

Found: 2026-11-01, while writing the unit 7a tests.
State: fixed in unit 7a.

What happens: row 64's check needs the process id, start time and group of
every live adapter. `Runner.start` and `Runner.load` return a `SessionInfo`
without any process identity, `SessionOpened.process` is never written, and
no production path inserts a `processes` row (issue 153).
What should happen: the runner reports each adapter's identity when it
spawns (Linux: `/proc/<pid>/stat` field 22 for the start time, as
`recovery/orphans.ts` reads it), the engine records it as a `processes` row,
and the server checks the chain against the rows whose process is still the
recorded one.
Why it matters: without it, criterion 7.9's engine half and issue 153's
sweep have nothing to compare against.

What changed in unit 7a: adapter spawns record their process identity in the
operational table before speaking the Agent Client Protocol. The upgrade guard
verifies that each row still matches a live process before comparing the
caller's claimed ancestry and group.


## 166. Frozen service fixtures did not reach the behaviours they asserted

Found: 2026-11-01, while building unit 7a against its frozen tests.
State: fixed in unit 7a, with the lead's approval for all three edited test files.

What happened: the service test helper passed a plain string to the remote
procedure call client for `accounts set-secret`. Effect validates the decoded
payload before encoding it, and the contract requires a `Redacted` value. The
request never left the client. The restart fixture also waited for an accepted
delivery while its fake agent only slept. A running-state notice is neither
content nor a successful prompt reply, so it cannot accept a delivery under
decision row 51.
What changed: with the lead's approval at board posts 1081 and 1084, the
helper wraps the secret in `Redacted.make` with the contract's label, and the
restart fixture sends an existing empty-plan step before sleeping. The plan is
content, and the existing handler accepts the delivery. The service-log
fixture also sent a malformed wire frame before its permission and
terminal-error probes, although the copied protocol intentionally terminates
that adapter connection on malformed input. With approval at posts 1086 and
1088, that probe now runs through a second fake agent in the same service
after the first flow. Its original token is passed as a stored secret to the
second agent, so the malformed path still exercises it. The first flow waits
for either a returned delivery or a turn end, because a prompt error writes a
returned delivery and idle without a later turn end. Every existing assertion
and timeout is unchanged.
Why it matters: a builder must not weaken production validation or reinterpret
an acknowledgement just to pass a fixture that cannot reach its own expected
state.

## 167. An open WebSocket could hold service shutdown open

Found: 2026-11-01, while checking unit 7a with an established owner connection.
State: fixed in unit 7a.

What happened: the first service assembly let the HTTP server wait for
upgraded connections while the client-waiting WebSocket server finalizer ran
before the request scopes closed. A real authenticated connection held
shutdown past a three-second probe deadline. Closing the client then released
the service.
What changed: the listener tracks accepted sockets and disconnects them before
closing its request scope and its separate server scope. The service
explicitly closes the listener while the handler, runner, and database remain
available, so disconnection finalizers can still cancel blocking waits. The
same probe completed with exit code zero in 31 milliseconds after the change.
Why it matters: a detached service must shut down and release its lifetime
lock even while an owner or agent client remains connected.

## 168. Read requests trusted an upgrade credential after its revocation

Found: 2026-11-01, in the unit 7a attack pass and independent verification of
commit 2b33da2, confirmed by the lead for fix round 1.
State: fixed in unit 7a fix round 1.

What happened: `subscribe` and `debug.compare-views` did not authenticate again
when a new request began. A revoked connection could serve new reads before
the event watcher or periodic check closed it. The debug handler also treated
any credential without an agent identifier as the owner, admitting a paired
device despite criterion 7.12.
What changed: both handlers authenticate the original credential before
starting a read. An invalid credential fails with a fixed command error and
completes the connection's invalidation signal. Only an owner credential may
call the debug handler. The existing event watcher and 100 millisecond poll
still close revoked connections, including idle ones.
Follow-up rule: any later device-revocation command must write `DeviceRevoked`
in the same batch as `revokeDevices`, so the event-driven invalidation closes
the connection without waiting for the poll.
Why it matters: a connection's earlier authentication must not authorize a
new read after its credential is revoked.

## 169. Request diagnostics and startup cleanup were incomplete

Found: 2026-11-01, in the focused review of unit 7a at 2b33da2.
State: fixed in unit 7a fix round 1.

What happened: an application defect returned a fixed HTTP 500 without a log
line. A detached launcher's 30-second deadline returned an error but left its
child running. An overlong socket path was checked after creating the state
folder. The server's source credit omitted one referenced line range.
What changed: the application logs `request failed: defect` through the
redacting logger before returning the fixed response, without cause text.
The service log sink preserves that fixed category. The launcher kills only
its own still-running detached child process group before reporting its
deadline failure. The socket-path byte limit is checked before inspecting or
creating the state folder. The server credits T3 Code `apps/server/src/ws.ts`
lines 3374-3385 alongside the other referenced ranges.
Why it matters: a failed request needs a safe diagnostic, and failed startup
must leave neither a running child nor an unwanted state folder.

## 170. A healthy long catch-up may reach the subscription backlog bound

Found: 2026-11-01, in the focused review of unit 7a at 2b33da2.
State: fixed in unit 7b for the client: a subscription resumes after the last
event received. The server's bound is accepted by the lead.

What happens: the live subscription collects events while the client reads
catch-up. A healthy but long catch-up can reach issue 41's 2,048-event backlog
bound and close the connection. The server does not drop events.
What should happen: when the server closes catch-up, the client reconnects
and subscribes from its last received cursor. The same rule handles a slow
subscriber reconnecting after a budget disconnect.
Why it matters: cursor-based resumption preserves every event across a
disconnect that enforces the server's memory bound.

## 171. Another socket responder can make the launcher report already running

Found: 2026-11-01, in the unit 7a attack pass at 2b33da2.
State: open usability note for the owner; no code change is required.

What happens: another program of the same user can answer at `engine.sock`
without holding the engine lock. The launcher then reports `already running`.
The lead disproved this as a specification break: criterion 7.4, task 7a.3,
and decision row 71 require detection by connecting, and the frozen launcher
test explicitly accepts a responder without a lock. That user already holds
the owner's authority.
What should happen: retain the specified connection probe. If the wording
confuses an owner diagnosing a conflicting program, consider clearer text in
a later usability change.
Why it matters: an answering socket proves that something is listening, but
the launcher's message can misidentify that program as the engine.

## 174. The socket ancestor rule also rejects the required temporary folder

Found: 2026-11-01, while writing unit 7b's client identity tests.
State: clarified for unit 7b by engine-lead, board answer 1105.

What happens: decision row 64 rejects every socket ancestor that is writable
by a group or other users. The same plan requires test sockets under `/tmp`,
which is normally root-owned with mode 01777. Applying the rule literally
would reject every required test socket.
What should happen: the lead amended the reading of row 64. A root-owned
ancestor with the sticky bit may be writable by a group or other users.
Every other ancestor must be owned by the current user or root, and must
not be writable by a group or other users. The socket's own folder remains
owned by the current user with mode 0700, and the socket must be owned by
the current user. A non-sticky 0777 ancestor and a foreign-owned sticky
ancestor must both be refused before a credential is sent.
Why it matters: this preserves the intended socket trust check while allowing
private test folders beneath the operating system's temporary folder.

The lead also approved an injectable filesystem and user-id seam for the
ownership branches that an unprivileged test cannot construct. Real socket
listeners still observe whether an upgrade was attempted. At least one
identity test uses the real filesystem without that seam.

## 175. The older fake-agent command test names a command that does not exist

Found: 2026-11-01, while checking the sibling tests for unit 7b.
State: fixed in unit 7b: the fixture now calls `ask`.

What happens: the test beginning at `packages/testing/test/fake-agent.test.ts:635`
asks the `shephrd_command` step to call `post`, which is absent from the
contracts' remote procedure call group. It checks the upgrade's bearer
header, and accepts either an `ok` or a `failed` report. It cannot prove
that a real command succeeded, or that an error reply was reported as a
failure. A client that validates the command before connecting would also
fail its upgrade-count assertion for the correct reason.
What should happen: retain its credential and output checks, but use an
actual command and its payload, such as `ask`. Unit 7b's new tests separately
require a successful question and a refused owner-only command through the
real service. The existing test has been left unchanged for the lead to
assign with the builder's change to the scripted step.
Why it matters: the older assertion must not force the fake agent to retain
the invalid wire protocol described in issue 160.

## 176. A blocking wait reports success when it needs its caller to answer

Found: 2026-11-01, while applying engine-lead's ruling in board post 1120.
State: fixed in unit 7b fix round 1 (`reportWait` returns 2 for `request-held`).

What happened: `packages/cli/src/commands/wait.ts` returned exit code 0 for a
`request-held` reply. All four W02 cases previously expected that code.
What should happen: decision row 26 requires exit code 2 when a permission
request or question is held by or routed to the caller of a blocking wait.
The W02 cases now require 2 for both subjects, whether already held or routed
after the wait opens. They retain the held-request message and the
`WaitCancelled` reason `request held` assertions.
Why it matters: exit code 0 tells a caller that every member has settled,
although a member still needs the caller's answer.

## 177. Closing the MCP input can report an error after a successful tool call

Found: 2026-11-01, while writing the unit 7b fix-round tests against commit
`220efe3`, with uncommitted test helpers.
State: open shutdown usability note. This does not block the assigned fixes.

What happened: a test host ran the real `runMcp`, initialized the protocol,
listed the tools, and completed an `ask` against a fake socket peer. After
the parent closed standard input, `runMcp` returned exit code 1. The host
stayed alive to inspect the server layer's resource cleanup. The observed
return code was independent of the leaked connection asserted by X22.
What should happen: investigate whether the normal end of standard input
races the protocol layer's termination in `runMcp`. An orderly shutdown
should not report an error solely because the input ended.
Why it matters: a caller can see a failed server shutdown after its tools
completed successfully. X22 deliberately checks resource cleanup without
requiring a particular shutdown return code, because that behavior is
outside this fix round's assigned rulings.

## 178. The ancestry checks do not explicitly refuse unsupported platforms

Found: 2026-11-01, while writing T-7 after engine-lead's board request 1132.
State: open for the unit 7b builder's fix round under the Linux-only ruling.

What happens: the client's `ancestryHeaders` and the engine's
`outsideAdapters` have no platform argument. Tests against their intended
last-argument interface pass `darwin`, but the unchanged functions ignore
it. On the Linux test host, the client reads Linux ancestry and upgrades,
and the engine grants an outside-adapter identity when the process table
is empty.
What should happen: version 1 is Linux only, as ruled by the owner and
relayed in request 1132. Both functions take a final platform argument that
defaults to `process.platform`. On `darwin`, the client refuses before an
upgrade with `the process ancestry check runs on Linux only in this version`,
and the engine returns false. X71 exercises both the reader and the public
client connection; X72 uses a real migrated database and a Linux control.
Why it matters: an unsupported platform must fail closed instead of
implicitly accepting an ancestry check intended for another platform.

## 179. The frozen wait test "already held" races the owner moving the question

Found: 2026-11-01, while building unit 7b's command-line tool.
State: fixed by keeping the W02 caller inside an accepted, open turn.

What happens: in `packages/cli/test/wait-exit-codes.test.ts`, the two W02
"already held" cases (permission and question) fail intermittently, and
mostly fail. The parent agent holds a question or permission request, and the
test then calls a blocking `wait` as that agent. After the parent's turn ends,
the engine moves the held question to the owner (`QuestionMoved`,
`OwnerNeeded`). The wait then opens without the "request held" cancellation
the test expects, and it stays blocked until the connection closes. The
engine's own test client, which does not use the new command-line tool, times
out in the same way. In the one passing run, the wait arrived before the move.
What should happen: the test should make the wait deterministic, for example by
holding the parent's turn open until the wait has been answered, or the engine
should state which outcome a wait after the move must have.
Why it matters: the criterion cannot be observed reliably, and the command-line
tool's held-request outcome is untested by a stable test.

Fix: the W02 cases start the parent with a long-running scripted turn and wait
for its `DeliveryAccepted` before routing a request. The parent remains busy
when the blocking wait opens. Following the lead's ruling in board post 1120,
the assertions require exit code 2 from decision row 26, the held-request
message, and `WaitCancelled` with reason `request held`. The remaining product
exit-code defect is tracked in issue 176.

## 180. The frozen test F02 cannot pass: its own setup emits an account event

Found: 2026-11-01, while building unit 7b's fake-agent client step.
State: fixed by checking account events after the refused command.

What happens: `packages/testing/test/fake-agent-client-step.test.ts`, case
F02, records the event sequence before it starts the fake agent. It then
asserts that no `AccountChanged` event follows. But `startFakeAgent` adds the
agent's account with `accounts add`, which commits an `AccountChanged` event
after that mark, so the assertion fails whatever the step does. The refusal
assertion before it (`CommandRefused` for `accounts`, exactly one) passes.
What should happen: take the sequence mark after `startFakeAgent` returns, or
check that no `AccountChanged` names a different account than the agent's own.
Why it matters: the test cannot show that a refused owner-only command changed
nothing.

Fix: F02 still requires exactly one `CommandRefused` for `accounts`. It now
checks that no `AccountChanged` follows that refusal, excluding the account
created by the setup helper before the agent's prompt.

## 181. Foreground `shephrd serve` is not supported

Found: 2026-11-01, while wiring `serve` in the command-line tool.
State: open.

What happens: unit 7a starts the service when its module is imported, and only
`serve --detach` has a launcher. The command-line tool accepts `serve --detach`
only, and refuses plain `serve` with a usage error.
What should happen: a foreground `serve` that runs the service in the
terminal, decided by the lead when the acceptance suite needs it.
Why it matters: an owner debugging the service must read its log file.

## 182. The socket check and the connection are not one atomic step

Found: 2026-11-01, while building the client's socket checks.
State: open.

What happens: the client checks every parent folder, the socket's folder and
the socket, and then opens the connection by path. A process running as the
same user, or a root process, could replace the socket between the check and
the connection. Only the state folder's owner can do this, so the engine's
trust boundary is not crossed, but the check is not a guarantee.
What should happen: if the platform allows it, check the connected
descriptor's peer credentials after connecting.
Why it matters: the check protects the owner credential from a swapped socket.

## 183. Process ancestry for the handshake reads `/proc` and works on Linux only

Found: 2026-11-01, while building the client's ancestry header.
State: closed by the owner's ruling, unit 7b fix round 1.

What happened: `packages/client/src/ancestry.ts` reads `/proc/<pid>/stat` to
build `Shephrd-Ancestors`, and the engine's check had a macOS reader that the
client had no counterpart for.
Owner ruling, 2026-11-01, verbatim: "yeah linux only for now. shoud be easy
enought to port to macos". Version 1 is Linux only.
What was done: the client's `ancestryHeaders` refuses on any platform other
than Linux, before it reads `/proc`, with "the process ancestry check runs on
Linux only in this version". The engine's `outsideAdapters` no longer falls
back to the macOS reader: on a non-Linux platform it returns false, so the
owner credential is refused. Both take the platform as an argument for tests.
`recovery/orphans.ts` keeps its macOS reader, which only recovery uses.
Porting later: add the `ps -o ppid=,lstart=` reader (decision row 64) to both
halves and lift the two platform checks.

## 184. `shephrd mcp` discards its own logs

Found: 2026-11-01, while building the tool server.
State: open.

What happens: the tool server's standard output carries the protocol, so the
server runs with `Logger.layer([])` and writes no log at all. A connection
failure reaches the agent as a tool error, and nothing is recorded.
What should happen: write the server's log to a file in the state folder,
without any credential.
Why it matters: an owner debugging an agent's failed tool call has no record.

## 185. A symlinked owner credential file is followed

Found: 2026-11-01, by the unit 7b attack pass (B2); the verifier showed no
break.
State: open, a hardening note.

What happens: `packages/client/src/identity.ts` reads `owner-credential` with
`readFileSync`, which follows a symbolic link.
Why it is not a break: replacing that file needs write access to the private
state folder, and a process with that access already holds the owner's
authority, so the link gives it no new data or authority.
What could be added later: check that the credential is a regular file, owned
by the user, with mode 0600, before reading it.

## 190. The Herdr plugin manifest still lists macOS as a supported platform

Found: 2026-11-01, during the rename to Shephrd.
State: fixed in commit 7887d87 (manifest, frozen test, plan task 1f and decisions
row 78 now say Linux only).

What happens: `herdr-plugin.toml` said `platforms = ["macos", "linux"]`, and
the frozen test `packages/engine/test/smoke/workspace-manifest.test.ts` (line
297) asserts exactly that list. Version 1 runs on Linux only (decisions row
78, issue 183), and the code refuses the owner credential off Linux.
What should happen: the manifest lists only `linux` until the macOS port
(feature list, section 4) is done. Changing it needs the test and plan task
1f changed in the same step, so the rename left it as it was.
Why it matters: Herdr on a Mac would offer to start a service whose
ancestry check and leftover sweep do not work there.

## 191. Planning records outside the rename's edit list still say Shepherd

Found: 2026-11-01, during the rename to Shephrd.
State: fixed in commit 7887d87 (the twelve prose lines now say Shephrd; slugs and
paths are kept).

What happens: `.plans/epics/shepherd-foundation/epic.md`, `.plans/roadmap.md`
and the three `.plans/scopes/engine/*/scope.json` files (their `summary` and
`why` text) still call the product Shepherd, because the rename task did not
cover them. The plan folder path and the epic names are kept on purpose, so
links do not break.
What should happen: the text in those files uses Shephrd; their file paths and
topic names stay.
Why it matters: scope summaries are loaded into every worker's instructions,
so they will keep teaching the old name.

## 192. The fixture scrubber no longer hits the package name, and the old note is stale

Found: 2026-11-01, during the rename to Shephrd.
State: open.

What happens: issue 37 was found because pnpm's `npm_package_name` was
`shepherd`, eight characters, and the scrubber removed it. The new package
name `shephrd` has seven characters, so the scrubber now leaves it alone, and
the committed `errors/cursor-out-of-usage.json` keeps its source note
naming the plan folder `shepherd-engine`. The rule in issue 37 (redact only
values that can hold secrets) is still not built.
What should happen: issue 37 is fixed on its own terms and does not depend on
the length of the product's name.
Why it matters: the next re-record could over-scrub another long, harmless
variable and the cause would be hidden.

## 193. An error from the fake harness is never classified as signed out or out of usage

Found: 2026-11-02, while writing the acceptance suite (unit 8b).
State: open.

What happens: `packages/engine/src/runner/classify.ts` decides whether a
failed turn means "signed out" or "out of usage" from the harness id, and only
the ids `claude`, `codex`, `cursor` and `gemini` have patterns. An agent on a
harness with any other id, including the fake harness the tests use, gets the
same message as a plain error and is never paused. The acceptance scenario for
account failures therefore registers the fake adapter under the harness id
`claude`.
What should happen: either the classification patterns are part of the
harness definition, so a test harness can carry its own, or the limitation is
written in the harness documentation.
Why it matters: a new harness added later is silently never paused when its
account runs out, and the failure shows only as a crashed turn.

## 194. A sent but unaccepted prompt reaches the agent twice after a restart

Found: 2026-11-02, while writing the acceptance suite (unit 8b).
State: open. Allowed by the specification ("may be sent twice"), so it is a
decision to confirm, not a defect.

What happens: when the service is killed after a prompt was sent to an agent
and before the agent accepted it, recovery requeues the delivery and sends it
again. The agent's transcript then holds the same prompt twice. The log shows
one delivery, so a reader of the log sees nothing wrong.
What should happen: the owner confirms that a double delivery is acceptable,
or the sent event records enough for the engine to tell the agent that the
prompt may be a repeat.
Why it matters: an agent that acts twice on the same instruction can do
harm, for example by repeating a commit or a message to a third party.

## 195. The acceptance suite leaves some specification clauses to lower-level tests or to nothing

Found: 2026-11-02, by the focused review of unit 8b (finding C1), after fix
round 1 of that unit.
State: open. Not a defect in the engine. It is a map of what the acceptance
suite does not itself check.

What happens: fix round 1 closed the review's findings A1 to A5. The flow now
follows all eight steps of "One request, start to finish". The disk test
observes the adapter. The nested wait, the automatic usage reset and the
overdue reset across a restart are exercised. The secret scan covers every
service process, every minted token, the accounts list and all replies. Many
clauses the review's table lists were not turned into acceptance scenarios. The
table below names, for each one, the lower-level test file that covers it, or
says "not covered". A file is named only when it exists in
`packages/engine/test` and its test titles speak about the clause. Its
assertions were matched by title, not audited line by line.

| Clause not checked by the acceptance suite | Covered at a lower level by |
|---|---|
| Protected folder relationships, forbidden home, state and install folders, worktree boundaries | `identity/ceiling.test.ts`, `identity/ceiling-fix-1.test.ts`, `commands/authorization.test.ts` |
| Adapter-reported mode elevation, extended ceiling with persistent permission options | `runner/mode-ceiling.test.ts`, `runner/hardening.test.ts` |
| Unrelated inherited environment excluded | `runner/baseEnvironment.test.ts` |
| Leading slash and whitespace-plus-slash prompts, closing markers, distinct markers per send | `routing/text-is-data.test.ts` |
| Open permission and question counts, complete paused, interrupted and crashed state sequences | `views/apply.test.ts`; the counts are not covered |
| Wait settled-state exclusions for an open request or question, held subject, outstanding delivery, compaction | `routing/waits.test.ts` (W01 to W05) |
| Wait resolution by stop, pause or nonreloadable interruption, held-request early return, member returning to work, crashed-waiter suspension and resume, disconnect cancellation | `routing/waits.test.ts` (W11 to W21) |
| Exact member-state payload of a wait | not covered |
| Plan entries of a stream | `runner/stream.test.ts` (6.2) |
| Split and encoded secrets met by the real redactor | `identity/redactor.test.ts`, `identity/redactor-fix-1.test.ts`, `runner/hardening.test.ts`; the acceptance scan itself is proven only on synthetic text by `acceptance/secret-scan.test.ts` |
| Parent reading its child's complete thread | not covered |
| Busy-holder delivery order of a routed permission request, persistent and settings options | `routing/permissions.test.ts`, `routing/permission-boundaries.test.ts` |
| `resume --fresh`, nonreloadable session refusal and fresh session | `commands/lifecycle.test.ts`, `recovery/restart.test.ts` |
| Picker distinguishing stopped, crashed and interrupted agents and other harnesses | `accounts/pick.test.ts` (P1 to P3) |
| Stored secret echoed by the adapter and redacted | `commands/request-id-secrets.test.ts`, `runner/hardening.test.ts` |
| Crash of a parent without an open wait, stderr truncation to a tail | `routing/waits.test.ts` (W10) and `recovery/crash.test.ts`; truncation is covered by `identity/redactor-fix-1.test.ts` |
| Nonreloadable agent, failed reload, idle reload with zero prompts, agent caught starting, blocking-wait cancellation, surviving question, paused-account recovery | `recovery/restart.test.ts`, `recovery/restart-regressions.test.ts`, `recovery/restart-accounts.test.ts`, `routing/waits.test.ts` (W20) |
| Automatic timeout deadline of a moved permission request, withdrawal of the old holder's copy, paused or interrupted holder, no move back down | `routing/move-withdrawal.test.ts`, `routing/moving-requests.test.ts`; a timeout deadline is not covered |
| Unknown usage reset time alerts the owner, mid-turn carry-on after acceptance | `accounts/pause-and-return.test.ts` (T4, T5), `accounts/carry-on-dispatch.test.ts` |
| Message to an agent that stays nonreloadably interrupted, ordinary adapter error reply returning the message with redacted error text | `routing/deliveries.test.ts`, `runner/classify-errors.test.ts` |
| Cleanup before serving, boot, user and executable mismatch controls, bounded record removal | `recovery/orphans.test.ts` (6.8 guards); the order "before serving" is not covered |
| File-mode protections of the state folder and owner credential | `api/state-folder.test.ts`, `identity/owner-credential.test.ts` |

What should happen: the owner decides whether the acceptance suite must show
any of the "not covered" rows itself, or whether the lower-level tests are
enough for the unit's sign-off. A row naming a file is a pointer, not a proof
that the file checks the whole clause.
Why it matters: a reader of the acceptance suite's titles could believe that
every clause of the specification's amendments is checked end to end. Only the
journeys above are.

## 196. A wait for one delivery was followed by an assertion about two

Found: 2026-11-02, by the test runner (`pnpm check` at 0a58595, under load).
State: fixed in commit f33000c (test only; no production code changed).

What happens: `failure-6-undeliverable.test.ts` waited for the first
`DeliveryAccepted` for the boss, then read the boss's echo once and expected
a "was returned" prompt for each of two queued messages. The two notices are
separate deliveries, so under load the second had not reached the boss yet and
the test failed with "the boss was not told that <id> came back". The same
shape was in `flow-start-to-finish.test.ts`: it waited for the first accepted
delivery for the lead after a restart and then asserted about one particular
prompt, which a carry-on delivery could precede.
What should happen: a wait names the thing the next assertion is about. The
failure-6 test now waits, bounded, until the boss's echo holds a notice for
every queued id, and checks that there is exactly one notice per id. The flow
test waits for the delivery id of its own prompt. A sweep of the other
acceptance files found no further case: their single-echo reads follow either
a wait on the delivery id, a wait on the echo itself, or a turn end.
Why it matters: a test that passes on a quiet machine and fails under load
hides real failures behind noise. The original failure was not reproduced
locally in three loaded runs; the cause is read from the code.

## 197. The live check cannot look for agent tokens in the harnesses' own session files

Found: 2026-11-02, while writing `pnpm live-check` (unit 8c).
State: open.

What happens: the plan's secret check (PB-A4) greps the session files that each
harness writes under its home for the agent's token. The 8b acceptance suite can
do this because the fake agent records its own environment. `pnpm live-check`
cannot: an agent's token is given to the agent when it starts and is never
visible over the socket, so the script has no token to search for. The live
check scans the events, replies, the accounts list, the service's output and the
thread text for the owner credential only.
What should happen: the owner can grep Claude Code's and Codex's session files
for the tokens of the run by hand, or a later unit can add a debug command that
returns a one-way hash of each live token for the scan to compare against.
Why it matters: a token written to a harness's session file would be readable
by anything that reads that home. Today only the fake-agent suite proves this
does not happen.

## 198. The recorder's option and result types are not exported

Found: 2026-11-02, while writing `pnpm live-check` (unit 8c).
State: open; the check works around it.

What happens: `scripts/recorder.ts` exports `recordFixtures`, `formatReport` and
`hasRecordingFailures`, but not the types `RecordOptions` and `RecordResult`
that those functions use. `scripts/live/recording.ts` derives them with
`Parameters<typeof recordFixtures>[0]` and `Effect.Success<ReturnType<...>>`.
What should happen: the recorder exports its two types, and the live check uses
them.
Why it matters: the derived types break silently if the recorder's signature is
wrapped or overloaded.

## 199. The startup-hook check keeps its own copy of the socket probe

Found: 2026-11-02, while writing `pnpm live-check` (unit 8c).
State: open.

What happens: `serve --detach` decides whether a service already runs with an
HTTP GET on `engine.sock`. That helper (`answers`) is not exported from
`packages/cli/src/serve.ts`,
so `scripts/live/startupHook.ts` carries a second copy (`socketAnswers`). The
two can drift: if the service ever stops answering a plain GET, `serve --detach`
and the live check would disagree.
What should happen: `packages/cli/src/serve.ts` exports the probe and the live check imports it.
Why it matters: the live check's claim that "the service answers" should be the
same claim that the startup hook relies on.

## 200. The live check can print a credential, and its final scan omits printed lines

Found: 2026-11-02, while testing unit 8c at commit 2d1a7da.
State: fixed in f8715ed (unit 8c fix round 1): the printer redacts every line with the run's secret list and the shapes of a credential, an unreadable owner credential now fails the run, and the final scan reads the printed lines.

What happens: the reporter writes an error's message directly to the terminal.
An injected setup error containing the temporary service's owner credential
prints the credential in a FAIL line.
A rejected step containing an Authorization bearer token prints that token.
The final step scans events, replies, accounts and process output, but it does
not scan the reporter's lines.
A credential in a printed model setting can therefore accompany exit code 0.

Evidence: all three tests in
`packages/engine/test/live-check/printed-secrets.test.ts` fail for these reasons.
The event, reply and process-output leak cases in `adversarial-flow.test.ts`
pass, so the missing boundary is the printer.
What should happen: the reporter redacts credentials before writing any line.
The runner registers its temporary credential with the redactor as soon as it
exists, and retains the diagnostic text for the final leak check.
Why it matters: a failing live check must not expose the credential it was
supposed to protect, or declare that the secret check passed after a leak.

## 201. A replacement value can leave an unresolved placeholder in a sent prompt

Found: 2026-11-02, while testing unit 8c at commit 2d1a7da.
State: fixed in e006f79 (unit 8c fix round 1): `fill` throws when a placeholder remains in the final text.

What happens: `fill` substitutes the original template once, but does not check
the resulting text for another placeholder.
For example, a worker model setting of `{{UNRESOLVED_MODEL}}` reaches the lead's
start request unchanged.
Evidence: the last two tests in
`packages/engine/test/live-check/prompt-safety.test.ts` fail because `fill` does
not throw, and because the start request is sent.
The tests for all current prompt constants and omitted values pass.
What should happen: `fill` rejects a result that still contains a placeholder,
before the driver can send that prompt.
Why it matters: the owner was promised that unresolved placeholders are errors,
and are never sent to an agent.

## 202. The live check's total limit returns before the timed-out work has stopped

Found: 2026-11-02, while testing unit 8c at commit 2d1a7da.
State: fixed in f8715ed (unit 8c fix round 1): one abort controller covers the startup probe, the journey and the recording; the run awaits all of it, bounded, before cleanup, and prints nothing after the summary; `recorder.ts` gains `runRecording(options, signal)` so the recorder's own process-group cleanup is awaited.

What happens: `main` races the body against a timer, aborts the journey, and
returns without awaiting the body's completion.
A delayed owner-connection finalizer is still running when `main` returns.
The startup-hook probe is outside that journey's cancellation scope.
If the probe answers after the time limit, the body can start a service after
the outer cleanup has already finished.

Evidence: the finalizer and delayed startup-hook cases in
`packages/engine/test/live-check/failure-cleanup.test.ts` fail.
The finalizer case observes zero closed connections at return, with one open.
The delayed probe case observes a service start after `main` has returned.
The middle-step failure and active-journey time-limit cases pass with a real
temporary service and two fake agents, so ordinary cleanup is exercised too.
What should happen: cancellation covers the startup check and the journey.
The runner awaits all cancelled work and its finalizers before the last cleanup
and return, and prevents any later service start or diagnostic write.
Why it matters: an exit code must mark the end of the run's work and resource
ownership, rather than leave a service that no caller can clean up.

## 203. A help flag makes the live check accept an unknown argument

Found: 2026-11-02, while testing unit 8c at commit 2d1a7da.
State: fixed in e006f79 (unit 8c fix round 1): every argument is validated before help is chosen.

What happens: `parseArguments` returns help before it validates other arguments.
Both `--unknown --help` and `--unknown -h` exit 0.
Evidence: the two combined-argument cases in
`packages/engine/test/live-check/io-boundaries.test.ts` fail with exit code 0.
The unknown argument by itself exits nonzero, and the ordinary help and dry run
perform no home input or output, process start, socket open or signal.
What should happen: unknown arguments are validated before help is selected.
Why it matters: the command's promise to reject an unknown argument must hold
when the caller also asks for help.

## 204. Live-check process discovery and a dry-run test confuse neighboring run folders

Found: 2026-11-02, while testing unit 8c at commit 2d1a7da.
State: fixed in 0dda3e3 (unit 8c fix round 1): ownership is a whole-path-part match plus descent from the service child with a recorded pid and start time; the dry-run test observes only its own process with a preload instead of comparing the whole of /tmp.

What happens: `processesNaming` uses a substring search over a process's
environment and command line to decide whether the process belongs to the run.
A fake agent whose state folder is a sibling named `<run-root>-other-<random>`
is signalled by the run's cleanup, despite belonging to a different folder.
Evidence: the sibling-folder case in
`packages/engine/test/live-check/failure-cleanup.test.ts` fails because the
sibling's process identifier is in the signalled list.
Every signalled process in the test was started by that test.

There is also a test race at the same folder-ownership boundary.
The existing real-entry case in `dry-run.test.ts` compares every
`/tmp/shephrd-live-*` folder before and after its child runs.
It fails if a parallel service test creates or removes its own folder during
that interval, even when the dry run performs no input or output.
This occurred in the parallel scoped run, and the case passed in isolation.
The test writer left the existing test unchanged, as its assignment requires.

What should happen: cleanup matches a complete, verified path boundary and a
process identity owned by the run, rather than a substring in arbitrary text.
The dry-run test uses injected input and output spies, or an isolated namespace,
to observe only its own effects.
The new `io-boundaries.test.ts` supplies those spies.
Why it matters: cleanup must spare another run, and one run's test must not
report another run's temporary folders as its own side effects.

## 205. The live check has no test that a reused process number is spared

Found: 2026-11-02, while fixing issue 204 at commit 0dda3e3.
State: open.

What happens: the live service's stop records each process's pid and start time and checks both again just before each signal, so a pid that the system gave to a stranger after the original exited is not signalled.
No test makes a pid change owner between the record and the signal, because a test cannot force the system to reuse a pid.
The path-boundary, descendant, ignored-signal and unconfirmed-stop cases are tested.
What should happen: the identity check is moved behind a small function that a test can feed a changed start time.
Why it matters: the one guard against signalling a stranger after pid reuse is read, not run, by the tests.

## 206. The live check's crash handler is not covered by a test

Found: 2026-11-02, while fixing issue 200 at commit f8715ed.
State: open.

What happens: `scripts/live-check.ts` prints only the kind of an unexpected error, because its message may repeat a credential.
Importing the file runs `main`, so no test can load the handler without starting a run, and the handler is verified by reading it.
What should happen: the handler moves into a function in `scripts/live/run.ts` that a test can call with an error holding a credential.
Why it matters: the last place a credential could reach the terminal is the one place no test looks.

## 207. Active-run cleanup tests race the child process close events

Found: 2026-11-02, while checking unit 8c at commit 1d3dc7b.
State: fixed in d515cd8.

What happens: the active-run cleanup test immediately expects each fake
agent's child process `close` event after `main` returns.
The live service confirms termination through the Linux process state.
A zombie process has stopped executing, but Node.js can deliver its `close`
event after the cleanup promise resolves.
This makes the owner-answer and time-limit cases fail intermittently even
though every owned process has stopped.

Evidence: an instrumented scratch copy reads `/proc/<pid>/stat` synchronously
at the return boundary under a controlled processor load.
The service is gone, and both fake agents have state `Z`, while the fake
agents' `isClosed()` values are still false.
The original assertions fail in both paths.

What should happen: the test immediately checks that the service and both
fake agents are gone or zombies, and that the unrelated agent is still
running.
It then waits on a bounded, named condition for all three `close` events
before retaining the original lifecycle assertions.
The ownership guard and the unrelated-agent checks remain in place.
The fix changes the test only, because production cleanup already confirms
that its processes have stopped.

Why it matters: delayed event delivery must not make the full check fail,
and waiting for an event must not hide cleanup that returns while a process
is still running.

## 208. The crash case of failure rule 4 raced its owner prompt against the permission notice

Found: 2026-11-02, in the third full check of run engine-build-1 at commit aae856e.
State: fixed in the test-only commit that follows aae856e on branch worker/engine-u8cfl.

What happens: the second scenario of `failure-4-no-answerer.test.ts` makes a
boss whose second turn crashes, and then sends the boss a prompt from the
owner to cause that crash.
The asker's permission request already has the boss as holder, and the engine
queues the request's notice to the boss as a prompt.
The boss is idle, so the notice starts the boss's second turn at once, and
that turn crashes.
When the owner's prompt arrives after the crash, the state table refuses a
prompt to a crashed agent, and the owner's client fails with `CommandError`
and the reason `command refused`.
The engine is right to refuse. The test raced its own prompt against the
notice.

Evidence: a scratch copy of the test that printed the events before and after
the refused prompt, run in a loop on two processor cores with four
processor-bound `yes` jobs on the same cores, failed in 4 of 20 runs.
In a failing run the events after the request were `DeliveryAccepted`,
`ThreadItem`, `AgentCrashed`, `PermissionMoved`, `OwnerNeeded`,
`CommandRefused`, so the boss had accepted the notice before the owner's
prompt was sent.
The state table (`commandTable` in `packages/contracts/src/stateMachine.ts`)
refuses `prompt` only for crashed and stopped agents, so a busy boss is not
the cause.

What should happen: the scenario sends no prompt and lets the notice start the
boss's second turn, which is the engine's real path.
It also starts waiting from the request's own sequence number instead of from
a head read taken after the request was seen, because under load the crash
could be committed before that read, and the wait for the owner notice would
then time out.
All assertions stay: the request moves from the crashed holder to the owner,
stays open, and a late owner answer reaches the asker.
The fixed file passed 12 of 12 runs under the same load.

Why it matters: a test that races its own command against the engine's
delivery fails a full check at random and teaches people to ignore failures.

## 209. The runner replay tests hard-code values from an earlier recording

Found: 2026-11-02, when the owner's passing live check refreshed the first
and second harness recordings at engine 71d13c1.
State: fixed by this change on branch `worker/engine-rpfx`.

What happened: `packages/engine/test/runner/replay.test.ts` stored literal
session identifiers, protocol versions and reply text in its case table.
The refreshed recordings opened successfully through the runner, but both
cases failed because their new session identifiers differed from the table.
The optional normal third-harness case used broad matchers instead of exact
values, and the corrupted-fixture check assumed a fixed line count.

What changed: the cases read the expected protocol version from the recorded
`initialize` response and the session identifier from the recorded
`session/new` response, matching each response to its request identifier.
They join only recorded agent message chunks for the exact reply text.
Missing or malformed fields fail with the fixture name and the expected field.
The harness and expected outcome remain in the table, and the event tags,
message count, incarnation and replay checks remain exact.
The normal third-harness case uses these same checks when its file exists,
and stays skipped while that recording is absent.
The corrupted-fixture check derives the appended line's number from the file.
Both new recordings are retained byte for byte.

Evidence: the refreshed fixtures failed the two old session assertions before
the fix, while the other five active tests passed.
After the fix, all seven active tests in the file passed, and the normal
third-harness case stayed skipped.
The engine package's type check also passed.
Changing one character of the expected session identifier in a temporary
copy made the second harness's case fail on that exact mismatch.
Separate temporary mutations of the version, reply text and event tags also
failed, and removing each required recorded field produced its named error.

Why it matters: recording a new session must not break the checks merely
because the adapter assigns it a new identifier, and replay checks must
still catch a runner that reports values different from the recording.

## 210. An account reset can be delayed for a minute when its deadline passes during a timer check

Found: 2026-11-02, while investigating the automatic-reset acceptance failure
at commit b915542 on branch `worker/engine-acfl`.
State: fixed in commit `f4d79a68030dae76069fd3b2b102e7132528dbfc`.

What happened at b915542: `startAccountTimers` in `packages/engine/src/accounts/timers.ts`
reads the clock at line 51 and releases deadlines due at that reading.
It reads the clock again at line 55, then excludes deadlines with no positive
time remaining at line 57.
A deadline that passes between those readings was not released, but is also
excluded from the next wake time.
With no other future deadline, the timer sleeps for 60,000 milliseconds.
The comment at line 56 treats every remaining overdue deadline as a failed
release, although this deadline has never been attempted.
A sleep that wakes one millisecond before the wall-clock deadline can lead
to the same crossing on the next check.

Evidence: the original acceptance flow, with event metadata printed by its
existing wait predicate, failed on the first run with four processor-bound
`yes` processes and the test pinned to processor cores 4 and 5.
The other three cases passed, including the restart case.
The reset time was 1793648397166.
The log recorded `AccountOutOfUsage`, `DeliveryRequeued`, a paused state,
and the second `DeliveryQueued`, ending at sequence 13 at 1793648390736.
No `AccountAvailable` or later delivery event arrived before the 40-second
wait timed out at 13:40:30.891 local time.
The missing step was the account's return, before either queued delivery
could resume.

A separate deterministic probe called the unchanged production timer with a
controlled clock and its log and view boundaries supplied by test doubles.
With a reset time of 1000 and clock readings of 999 and 999, it scheduled a
one-millisecond wait and wrote no availability event.
With readings of 999 and 1000, or 999 and 1001, it wrote no availability
event and scheduled a 60,000-millisecond wait.
With readings of 1001 and 1001, it wrote the availability event immediately.
An assertion that a newly overdue deadline must release or immediately
recheck failed against the production code.
The load trace does not expose the timer's internal clock readings, so it
confirms the missing event while the controlled probe proves the race.

What changed: each check remembers the account and deadline pairs whose
release it attempted.
Only those pairs are excluded from the next wake time if they remain pending.
A deadline that becomes due during the check schedules an immediate recheck.
A release that actually failed retains its one-minute retry delay.
The release still checks the current account status and deadline inside the
writer transaction, so sign-outs and replaced deadlines remain protected.
The first check still runs before startup returns, and account events still
wake the timer.

Verification: `reset-timer.test.ts` controls the timer's clock and sleep
boundaries without a database or an adapter process.
The equal-to-deadline, just-after-deadline and early-wake cases all failed
against the old timer and passed with the fix.
The failed-release case passed against both versions and guards the existing
one-minute backoff.
The unchanged acceptance file then passed ten consecutive runs with the
same four processor-bound processes pinned to the same two cores as the
reproduction.
The account suite passed all 39 tests across six files.
The serial acceptance suite passed all 59 tests across 22 files.
The engine package's type check also passed.
The restart case shares the timer, but its deliberately overdue deadline is
already eligible at the first reading and did not fail in this load run.
No acceptance waits or assertions were changed.

Why it matters: work queued behind a usage limit can remain paused for an
extra minute after the account's reported reset time.

## 211. The account reset timer's test has one account, and its immediate recheck has no floor

Found: 2026-11-02, in the focused review of the issue 210 fix (commits
f4d79a6 and 5662a5f on branch `worker/engine-acfl`).

Status: open. Neither point is a defect on a clock that only moves forward.

The first point is a test gap.
The test file `packages/engine/test/accounts/reset-timer.test.ts` uses a
single account.
It has no case with two accounts and no case where a deadline is replaced
during a check.
The reviewer changed the timer to match a past release attempt on the account
alone, instead of on the account and its deadline.
All four tests still passed with that change.
In the running engine the change would be masked, because the event that
replaces a deadline also wakes the timer.
Fix: add one case with two accounts, one whose release fails and one whose
deadline is crossed during the check, and one case with a deadline replaced
during a check.

The second point is about robustness.
In `packages/engine/src/accounts/timers.ts`, a deadline that comes due during
a check is rechecked after a wait of zero milliseconds.
In Effect, a sleep of zero is a yield, so the wait has no floor.
A wall clock that moved backwards and then forwards across the deadline on
consecutive checks could make the timer loop quickly.
A single step of the clock, such as a time-server correction, does not cause
the loop.
Fix, if wanted: give the recheck a floor of one millisecond, or state in the
file's header comment that the timer assumes the clock does not move back.

## 212. The live check omitted post-build restart and security evidence

Found: 2026-11-02, in post-build review finding L-1.

Status: the probe implementation is written and covered locally with fake
adapters. Real-adapter evidence remains pending the lead's reviewed live run.

The original fourteen steps did not inspect the adapters' session files or
process arguments. They did not try a state-folder canary read, slash-command
escaping, saved permission scopes, removed identity variables, or a real
adapter reload. A passing journey therefore did not establish PB-A3, PB-A4,
PB-A7, PB-A11, PB-A12, or SEC-PB-1 through SEC-PB-8.

The live harness now records explicit outcomes for those criteria. It cites
existing fixture evidence for PB-A10 and exercises service reconnection for
PB-A8 during the restart probes. A missing attempt fails. The state-folder
probe uses only a non-secret canary in the run's temporary state folder. A
successful read is recorded as having no mechanism, as SECURITY.md requires.
The token scan reports paths and counts, and never reports matched text.
Persistent permission answers are restricted to the named command in the
run's work folder. Only the service child started by the run receives the
restart signal. No production permission or authentication code was changed.

The restart probe uses two kills. One interrupts working turns to observe
actual carry-on tool calls. The other interrupts sent envelope deliveries to
observe recovery accepting their replayed identifiers or re-sending them.
A receipt from an ordinary post-restart response is not counted as replay.
A delivery already accepted before the kill is not counted as a replay test.

Local checks cover both directions of received slash escaping, the real
command-line entry point's ancestry refusal with both variables removed,
old-token refusal after a real service restart with a fake adapter, planted
tokens in session files and arguments, and each probe's failure outcomes.
These checks do not establish real-adapter behavior or close the live gate.

Fix round 1 makes the evidence limits explicit. The two-agent tree proves
the upward slash receive path only for the first harness, and the downward
path only for the second. Its other rows are direction-specific and not
applicable. The core-inheritance check now requires a name-only listing from
the shell before explicit variable removal. Each token-scan row requires its
own agent token, nonempty session files, arguments and environment snapshots.

The saved-permission criterion remains unproven when a destination cannot be
verified before answering. The public permission-option contract carries an
identifier, name, kind, level and persistence, but no destination. The
installed first adapter's wire request omits its provider suggestions too.
The probe therefore rejects every persistent option without a verified
local-settings or session destination. It records "no safe persistent option
offered" and fails. It never infers the destination from a label and never
answers persistently before checking that the owner holds the request.
No production contract change was made for this limitation.

The replay probe asks a pending turn to sleep, then requests the second kill
as soon as the deliveries are sent. A content update may still accept a
delivery before the kill. The probe checks the whole interval again after
reload, and records that race as a failed attempt. It never counts the same
delivery being accepted early and then re-sent as successful replay evidence.

Fix round 2 addresses review findings m-7 and m-8. After the second restart,
the permission handler previously denied even the exact pending sleep
command. A replay that requested that permission could fail despite correct
recovery. The handler now permits that command at most once per agent, using
only a nonpersistent approval. It still denies a repeat or a different
command and fails the probe. The pending prompt explicitly forbids running
the command again after a restart, including when the prompt is re-sent.

The added regression tests isolate missing shell listings, a wrong harness
for an inapplicable outcome, missing environment snapshots with tokens and
arguments still present, and a stale token snapshot after the first restart.
They cover each guard separately without weakening the existing evidence
requirements. These remain local tests, not real-adapter evidence.

Fix round 4 distinguishes a command that ran without any permission request
from a request without a safe persistent destination. In live-check-2 run 2,
events 322-325 show the exact printf command completing, with no
PermissionRequested or PermissionAnswered for that call. No option or
destination was selected. The probe now reports
`no persistent permission request observed`, which fails. It does not claim
that an always-allow answer was sent or that a settings write failed after
one. It still requires the owner-held request, verified destination and
saved scope before it can pass SEC-PB-4.

Fix round 6 addresses the cause observed again in live-check-2 run 3 at
`b4154fa7c12ed47116493b7b209c63a355075c7b`, log lines 34-36. The command
`printf 'lcp-persistent-permission-probe\n'` was read-only, so Claude Code
completed it without a permission request. It could not exercise the
persistent-permission choices. The implementation commit is
`fix: exercise persistent permission with a local write`.

The new exact command uses the absolute Node.js executable to create
`lcp-persistent-permission-probe.txt` at an absolute path in the run's work
folder. The file contains one non-secret marker line. Exclusive creation
refuses to overwrite an existing file or follow an existing file symlink.
The installed Agent Software Development Kit, version 0.3.312,
sdk.d.ts:2033-2044 documents manual approval in default mode for dangerous
operations. The installed claude-agent-acp 0.99.1, dist/acp-agent.js:7962
and 8001-8050, forwards the kit's permission asks.
dist/permissions/options/shell.js:89-96 builds the Bash choices from the
kit's suggestions. Creating a file gives the probe a filesystem mutation
instead of a read-only print. Real permission behavior still needs an
observed request; a command that completes without one keeps the same
`no persistent permission request observed` failure.

The destination guard from m-3 is unchanged. An owner-held request can
receive always allow only for the exact command in the work folder and a
verified localSettings or session destination. An absent or unsafe
destination is denied and records `no safe persistent option offered`.
The existing settings.local.json containment and saved-scope checks remain.
The command itself writes no harness settings or user settings. Local
regressions run the marker command after a synthetic safe approval and
check its file, the sent prompt, the saved scope, rejection of printf and
other commands, the no-request failure and the unsafe-destination failures.

Live run 5 at `9751bda` gives the permission probe its first real result.
The round-6 write command made Claude Code ask for permission.
The request offered a persistent option, `allow-with-updates`.
The probe rejected the request before answering always, and it recorded
`no safe persistent option offered`, because the public permission contract does
not expose where a persistent option would save its rule.
Criterion SEC-PB-4 therefore stays failed: the option is routed to the owner,
but its scope cannot be recorded and no settings file was inspected after an answer.
Exposing the destination in the contract is the open work for this criterion.
The log is `.scratch/foundry-runs/engine-build-1/live-check-2/live-check-run5.log`.

## 218. The state-read probe records the owner's own rejection as a deny rule

Found: 2026-11-02, by the L-1 probe test writer.

Status: fixed in commit `5c726da6d4d8bf0885afeb73a8edcdeb48b867a6` (fix round 1).

A regression test guards it:
`packages/engine/test/live-check/probe-adversarial.test.ts`, "issue 218".

The state-read probe (SEC-PB-6, Security Post-Build check 6) records
"refused" when the exact canary command's output contains "denied",
"not permitted", "permission" or "refused"
(`packages/engine/scripts/live/liveProbes.ts:240`). The probe's own
permission answer is not taken into account. When a harness offers no
allow-once option, the probe correctly declines to answer "always" outside
its step and rejects the request instead (`liveProbes.ts:165-171`). The
harness then reports the rejection, and the probe records "refused", which
passes. The owner's rejection is not a deny rule, so this is false evidence
for SEC-PB-6.

Fix, if wanted: record "refused" only when the probe allowed the request and
the read still failed; record "not attempted" when the probe itself rejected.

## 219. The slash probes miss a raw copy of /compact delivered as its own message

Found: 2026-11-02, by the L-1 probe test writer.

Status: fixed in commit `5c726da6d4d8bf0885afeb73a8edcdeb48b867a6` (fix round 1).

Regression tests guard it:
`packages/engine/test/live-check/probe-adversarial.test.ts`, "issue 219",
for both slash-up and slash-down.

The slash probes (SEC-PB-2 and SEC-PB-7) look only at received user text
that contains the delivery identifier
(`packages/engine/scripts/live/probeEvidence.ts:51-56`). If the receiver
gets the escaped envelope and also gets the raw text `/compact ...` as a
separate message, the probe still records "escaped; no command". It passes
unless a compaction boundary or a compact turn is also recorded. The raw
copy is an unescaped arrival, so the criterion "arrives escaped" is not
proved.

Fix, if wanted: fail when any received user text of the receiver, after the
delivery was sent, begins with the payload itself.

Fix round 2 also rejects a raw payload preceded by invisible Unicode format
characters, such as U+200B and U+FEFF, even alongside an escaped receipt.
The raw-payload check removes leading whitespace and Unicode category Cf
characters before comparing. The new issue 219 cases in
`packages/engine/test/live-check/probe-fix-round-2.test.ts` guard this gap.

## 220. The always-allow probe sends a persistent answer for a request an agent holds

Found: 2026-11-02, by the L-1 probe test writer.

Status: fixed in commit `5c726da6d4d8bf0885afeb73a8edcdeb48b867a6` (fix round 1).

A regression test guards it:
`packages/engine/test/live-check/probe-adversarial.test.ts`, "issue 220".

In the always-allow step (SEC-PB-4), the probe chooses the "allow always"
option before it checks who holds the request
(`packages/engine/scripts/live/liveProbes.ts:165-171`). When the holder is
an agent, the probe records "persistent option held by agent", so the step
fails. It still sends the "allow always" answer first. The step therefore
fails correctly, but the probe itself has answered a persistent option that
was not routed to the owner, which the probe's safety rule forbids.

Fix, if wanted: answer only with a reject option when the holder is not the
owner.

## 221. The token scan passes a harness without that harness's evidence

Found: 2026-11-02, by the L-1 probe test writer.

Status: fixed in commit `5c726da6d4d8bf0885afeb73a8edcdeb48b867a6` (fix round 1).

Regression tests guard it:
`packages/engine/test/live-check/probe-adversarial.test.ts`, the three
tests named "issue 221".

The token scan (PB-A4 and SEC-PB-1) has two gaps.

- `scanTokens` accepts a session file that has no content
  (`packages/engine/scripts/live/probeEvidence.ts:28-33`). An adapter that
  has not yet flushed its session file therefore gives "not found".
- Each harness's row searches for every token the run captured, and does not
  require that harness's own agent token
  (`packages/engine/scripts/live/liveProbes.ts:430-431`). If the Codex
  worker's process was never seen, its token is never searched for. The Codex
  row still records "not found". The process-argument count is shared too,
  so the service's and the command-line tool's arguments satisfy it.

Fix, if wanted: require a nonempty session file per harness, and require
that harness's own captured token before its row can record "not found".

## 222. The reload probe's second restart can pass on evidence from the first

Found: 2026-11-02, by the L-1 probe test writer.

Status: fixed in commit `5c726da6d4d8bf0885afeb73a8edcdeb48b867a6` (fix round 1).

Regression tests guard it:
`packages/engine/test/live-check/probe-reload.test.ts`, the two tests
named "issue 222".

The reload probe (PB-A7, PB-A8, PB-A11 and PB-A12) has two gaps in its
second restart.

- The probe checks that the pending deliveries were not yet accepted on a
  copy of the log read before the restart call
  (`packages/engine/scripts/live/liveProbes.ts:375-377`). An acceptance
  recorded after that read and before SIGKILL is not checked again. If
  recovery then re-queues the delivery, the probe records
  "re-send on restart" and passes. The delivery was in fact handled twice.
- The second restart's "old token refused" re-tests the tokens captured
  before the first restart (`liveProbes.ts:299` and `404-407`). Those were
  already refused after the first restart. The tokens issued at the first
  reload are never tested after the second restart, so a reload-issued token
  that survived a restart would still record "old token refused".

Fix, if wanted: before deciding the replay outcome, fail when any
acceptance of the pending delivery precedes the new session; and capture the
tokens again just before the second SIGKILL.

## 223. A harness adapter can copy its own login token into the event log, the board and a client

Found: 2026-11-02, by the owner's whole-engine hostile review, finding B1.
State: fixed in branch `worker/engine-shb`, pending review.

What happened at 8ff4c9b: a Codex adapter running for an ordinary account
read its own `HOME/.codex/auth.json`.
It printed `tokens.access_token` as an ordinary Agent Client Protocol (ACP)
message chunk.
The exact token was stored in `events.payload_json`.
Committed events are applied to the live views and published to
subscribers, so the token also reached the board and owner clients.
This breaks security rule 6 in `SECURITY.md`, which names "the agent
harnesses' own login tokens".
The documented same-user limit does not cover it: that limit lets the local
process read the token, and rule 6 separately promises that the token is not
copied into logs, the board or a client.

Root cause: the redactor removes only the values it is given, and no code
gave it a harness login token.
The service's registry in `packages/engine/src/service.ts`, lines 77 to 87,
held the owner credential, the inherited agent token, selected environment
values, the values in `secrets.json` and stored token hashes.
The runner in `packages/engine/src/runner/AcpRunner.ts`, lines 217 to 225,
registered only the agent token and the account's `secret:` values.
The Codex home step in `packages/engine/src/accounts/shadowHome.ts`, lines
46 to 64, chose the home but registered nothing from its `auth.json`.

What changed: a new module, `packages/engine/src/accounts/credentialSource.ts`,
names the login store of each file-backed harness.
Codex uses `auth.json` in `CODEX_HOME`, or in `HOME/.codex`.
Claude Code uses `.credentials.json` in `CLAUDE_CONFIG_DIR`, or in
`HOME/.claude`.
Gemini uses `.gemini/oauth_creds.json` in `GEMINI_CLI_HOME`, or in `HOME`.
The module registers every string value in the store as its own secret,
never the whole document as one string.
A short named list of fields that hold ordinary words, such as `auth_mode`
and `scopes`, is skipped, but only when the value has that field's expected
shape, such as a short word or a time.
The runner reads the store after the Codex home step and before the adapter
is spawned.
A store that exists but is not a regular file, is larger than one mebibyte,
cannot be read or is not JSON refuses the launch, and nothing is spawned.
A missing store has no values, because the account is not signed in yet.
The service's redactor and the runner's own redactor re-read every opened
store on each redaction, at the cost of one `stat` call per store while it
is unchanged.
A value seen once stays registered for the service's whole life, so a
refreshed token and an adapter's final output are both still covered.
The redactor already matched the raw, JSON-escaped, base64, base64url,
hexadecimal and URL-encoded forms of each value, so it was not changed.

The test writer's regression found a second path for the JSON-escaped form.
The translator in `packages/engine/src/runner/translate.ts` stores a tool
call's output, input and whole update, and a plan's entries, as JSON text.
A token that the adapter sent in its JSON-escaped form was escaped a second
time by that step.
The redactor does not match a twice-escaped form, and a client that decodes
the stored JSON gets the once-escaped token back.
The gated protocol log, which writes whole frames in test mode, had the same
problem.
The runner now redacts every decoded string and key of a non-message update
before the translator serializes it, in one redaction pass per update.
The protocol log decodes each frame line and redacts it the same way; a line
that is not a whole frame is withheld.

Verification: the review's attack test, inverted, is
`packages/engine/test/security/codex-auth-home-leak.test.ts`.
It passed against 8ff4c9b, proving the leak, and its inverted form fails
there.
`packages/engine/test/security/login-store-launch.test.ts` checks that a
broken store refuses the launch before any adapter exists, and that a token
written to the store while the adapter runs is redacted.

Fix round 1, after a security review of commit b88b876, changed four more
things.
A metadata field name no longer hides a value of an unexpected shape, so a
token stored under `scopes`, or nested below it, is still redacted.
While the login store of a running agent cannot be inspected, every output
of that agent is replaced by the fixed text "[output withheld: account
credentials cannot be inspected]".
Output flows again, redacted, after the store can be read again.
The separator used to redact a whole update in one pass now holds a random
value, so a secret can no longer match across it and move fields.
A store with more than 256 distinct values is refused, because each value
adds several matched forms to every redaction.
The review's other findings are recorded as issues 232, 233 and 234.

Not done: events stored before this fix are not rewritten.
A log written by an earlier build can still hold a token that an adapter
printed.

Why it matters: a printed provider token became durable event history and
reached clients that could not read the harness's home.

## 224. A login store is covered only after a launch has opened it in this service's life

Found: 2026-11-02, while fixing issue 223.
State: open.

What happens: the redactor learns a login store's tokens when the runner
launches an account that uses that store.
Every adapter runs as the same user, so it can read every other harness's
and every other account's store.
A Claude Code adapter that prints the token in `HOME/.codex/auth.json`
before any Codex account has launched in this service's life is not
redacted.
After a restart, a token that was refreshed away before the restart is no
longer known, although it may still be valid until it expires.
What should happen: every enabled account's store, and the default store of
every harness, is opened when the service starts and when an account
changes, so coverage does not depend on launch order.
Why it matters: it is a narrower form of the rule 6 break in issue 223.

## 225. Cursor's login store is not established, so a Cursor login token in a file is not redacted

Found: 2026-11-02, while fixing issue 223.
State: open; the owner decides.

What happens: the repository names no file where Cursor's command-line
agent keeps its login.
`.plans/plans/shepherd-engine/scouting.md`, line 89, names only
`CURSOR_API_KEY` and `agent login`.
So `credentialSourceFor` gives Cursor no store, and Cursor launches are not
refused.
A Cursor adapter that prints a token from a login file is not redacted.
A Cursor key passed through a `secret:` reference is already redacted.
A third-party analysis, not an official source, reports the file as
`$XDG_CONFIG_HOME/cursor/auth.json`, or `~/.config/cursor/auth.json`
(https://seanthegeek.net/doubleagent/research/cursor.html, read 2026-11-02).
What should happen: the owner chooses between establishing the path from an
official source and refusing Cursor launches until it is established.
Why it matters: it leaves a rule 6 gap for one harness.

## 226. The Gemini login store's path is taken from the design, not from a source

Found: 2026-11-02, while fixing issue 223.
State: fixed in branch `worker/engine-shb`, fix round 1 of issue 223.

What happens: `credentialSourceFor` reads Gemini's tokens from
`HOME/.gemini/oauth_creds.json`.
That path comes from the lead's design for issue 223.
No source in this repository confirms it, and a web search on 2026-11-02
did not confirm it either.
It is also not confirmed whether a variable such as `GEMINI_CLI_HOME` moves
the `.gemini` folder; if one does, an account that sets it is not covered.
The Claude Code path was confirmed by its documentation
(https://code.claude.com/docs/en/claude-directory, read 2026-11-02).
What should happen: the Gemini path, and any variable that moves it, is
confirmed from Gemini's own documentation or source code.
Why it matters: a wrong path leaves Gemini login tokens unredacted, because
a missing store is treated as signed out.

How it was settled: Gemini's own source confirms the default path and the
override.
`homedir()` in `packages/core/src/utils/paths.ts` returns `GEMINI_CLI_HOME`
when it is not empty, and the user's home folder otherwise.
`Storage.getOAuthCredsPath()` in `packages/core/src/config/storage.ts` joins
that home, `.gemini` and `oauth_creds.json`.
Both files were read on 2026-11-02 from the main branch of
`google-gemini/gemini-cli`.
The security review of issue 223 also showed the gap: an account that set
`GEMINI_CLI_HOME` had its token published (finding F5).
`credentialSourceFor` now reads `<GEMINI_CLI_HOME or HOME>/.gemini/oauth_creds.json`,
and a relative `GEMINI_CLI_HOME` refuses the launch.

## 227. The login-token regression observes thought output and live threads through limited service interfaces

Found: 2026-11-02, while writing the permanent regression for finding B1
against commit `8ff4c9b`.

Status: the observation limits are documented and covered at the nearest
existing boundary. The login-token fix is tracked separately by issue 223.

The translator in `packages/engine/src/runner/translate.ts` ignores
`agent_thought_chunk` updates.
An emitted thought therefore has no durable thread item whose non-secret
prefix the regression can assert.
The regression emits each encoded token in a thought and checks the real
service's protocol log, with the temporary-folder test flag enabled.
It also asserts that the non-secret thought prefix reaches that output.
The text, split-text and tool-output prefixes must reach the event table,
the thread projection and the live owner subscription.
Those positive controls are taken from actual thread items, rather than
from the account event that contains the fake adapter's script.

The service has no command that returns its in-memory thread snapshot.
The regression reads the committed rows and scans their thread projection.
It calls the existing `debug.compare-views` remote procedure call and
requires equality at that same durable sequence.
That call compares every live field with a rebuild under the writer's
permit, so equality connects the scanned projection to the live thread.
The test does not read the live snapshot directly.

The service's structured log goes to standard output, and it has no separate
log-file sink in `packages/engine/src/service.ts`.
The regression captures standard output and standard error, checks the
decoded log messages as well as their serialized bytes, and checks them
again after service shutdown.
It saves those captured bytes to a test-owned log inside its temporary
folder and scans that file as well.
It does not claim to exercise a separate production file sink.

## 231. Adapter updates still queued when the adapter exits are dropped without a trace

Found: 2026-11-02, while fixing issue 223 on branch `worker/engine-shb`.
State: open. It is older than the issue 223 fix.

What happens: when the adapter process exits, the exit watcher in
`packages/engine/src/runner/AcpRunner.ts` sets `processEntry.dead = true`
at once (line 507 at commit `6882768`).
The session update handler returns without doing anything for a dead
process (line 396 at the same commit).
An update the adapter wrote before it exited, but which the handler had not
yet reached, is therefore dropped.
No warning is logged and no event is written for it.
The drop depends on timing.
A first version of the issue 223 fix made each update slower to handle, and
the refresh regression test then lost tool output written just before a
crash.
The final fix handles each update in one redaction pass, and that test
passed eight runs in a row, but the race remains.
What should happen: every update the adapter wrote before it exited is
handled before the process is treated as dead, or a dropped update is at
least logged.
Why it matters: the last output before a crash, often the most useful for
diagnosis, can be missing from the thread.

Additional evidence from the issue 242 focused review, finding E, on
2026-11-03: stopping an agent also loses the redactor's held tail for both
ordinary text and terminal output.
The two `E diagnostic` regressions in
`packages/engine/test/runner/terminal-lifecycle-round-7.test.ts` start a fake
adapter through the real command handler, wait for a notification behind
the held tail, and stop the agent through the owner command.
Both tails appear in the runner's delivery updates during stop.
Neither appears in a stored thread item.
This is a separate loss point from the queued-notification race above.
`packages/engine/src/commands/stop.ts:19-20` revokes the token in the stop
transaction before calling the runner.
`packages/engine/src/commands/CommandHandler.ts:142-147` ignores runner
events after the agent leaves a live state or its token is revoked.
The terminal path flushes its carry in `AcpRunner.ts` during close.
The issue 242 round-7 scope leaves this shared stop-state path unchanged.

## 232. A token encoded twice, such as base64 of its JSON-escaped form, is not redacted

Found: 2026-11-02, by the security review of the issue 223 fix (commit
b88b876, finding F1).
State: open, for the owner's hostile pass.

What happens: the redactor matches a fixed list of forms of each secret,
built by `addForms` in `packages/engine/src/identity/redactor.ts`, line 49.
The list holds the raw value, one JSON escape, base64, base64url, partial
base64 runs, URL encoding and hexadecimal.
It holds no composition of two encodings.
The review's adapter printed its login token JSON-escaped twice, and as
base64 of the JSON-escaped token.
Both forms reached the event table, the live thread, the owner subscription
and the decoded protocol log, in text, tool input keys and values, plans,
permission text, final text and stderr.
A client can reverse either form to recover the token.
This limit applies to every registered secret, not only to login tokens.
What should happen: the requested compositions are matched, with a bound on
how many forms each secret adds.
A possible fix is to add the JSON-escaped forms of the base64, URL and
hexadecimal forms, and the base64 and hexadecimal forms of the JSON-escaped
value, to `addForms`, with regressions for each channel the review used.
Why it matters: an adapter, by mistake or on purpose, can publish a login
token in a form a client can decode.

## 233. A token split around a tool update is published in two pieces

Found: 2026-11-02, by the security review of the issue 223 fix (commit
b88b876, finding F4).
State: open, for the owner's hostile pass. It is older than the issue 223
fix.

What happens: streamed message text is held back by the chunk redactor, so
a secret split across chunks is still matched.
Every non-message update ends that hold: the session update handler in
`packages/engine/src/runner/AcpRunner.ts` calls `drainMessages(current,
true)` (line 470 at fix round 1).
That call flushes the held text (line 213) and deletes the message buffer
(line 225).
The redactor deletes its carry on a final call
(`packages/engine/src/identity/redactor.ts`, line 273).
A token whose first part comes before a tool update and whose rest comes
after it is checked as two unrelated pieces.
The review's adapter sent a third of a registered token, an ordinary
completed tool update, then the rest of the token.
The text items, joined in event order, held the whole token in the event
table, the live thread and the owner subscription.
What should happen: a fragment that could be the start of a secret is not
released across a content boundary.
A possible fix is to keep one security carry per agent across message,
tool, plan and permission boundaries, or to withhold an undecided suffix
until the next message text decides it.
Why it matters: any registered secret can be published in pieces that a
reader can join.

## 234. Enough registered secrets make the chunk redactor throw

Found: 2026-11-02, by the security review of the issue 223 fix (commit
b88b876, finding F7).
State: open, for the owner's hostile pass.

What happens: `redactChunk` in `packages/engine/src/identity/redactor.ts`
computes its window with one `Math.max` call that spreads the length of
every matched form of every registered secret (line 276).
Each secret adds several forms.
With enough secrets, the argument list passes the runtime's limit, and the
call throws `RangeError: Maximum call stack size exceeded`.
The review reached that with one valid login store of 672,012 bytes holding
24,000 distinct values.
Fix round 1 of issue 223 caps a login store at 256 values, so one store can
no longer do this.
The same limit can still be reached by many stores, many `secret:` values,
or both.
The redactor also rebuilds every form of every secret on each call.
What should happen: the redactor handles any number of registered secrets
without an exception, and does not rebuild unchanged forms on each call.
A possible fix is an iterative maximum, with the forms cached until the set
of secrets changes.
Why it matters: an exception in redaction stops that output path, and the
per-call cost grows with every secret.

## 235. Several acceptance and runner tests fail when `pnpm check` runs at high machine load

Found: 2026-11-03, by the test runner (`pnpm check` at 8830d8b, posts #1319,
and at ebe060f, post #1321).
State: partially addressed by the test-only reliability fix. The local limits
in `classify-turn-text.test.ts` (6.9 A3) and `reset-time.test.ts` (6.10 F-4)
are now 120 seconds because each case starts several fake adapters in turn.
The 7.3 WebSocket open limit in the test helper is now 30 seconds (issue
248). The failure-1-crash and recovery/orphans findings stay open. The 6.9
and 6.10 findings are addressed only as far as their test limits go. Wider
limits reduce these failures but do not prove the absence of other load
failures.

What happens: two batches of `pnpm check` runs failed only on tests that the
branches under check did not touch, and the failing tests differed between
runs.

- At 8830d8b, runs 2 and 3 started at a load average of about 21, beside
  another branch's checks. Both failed the same test,
  `packages/engine/test/api/subscribe-visibility.test.ts`, "7.3 issue 41: a
  subscriber that stops acknowledging is disconnected while the writer runs
  on". Its client failed with `SocketOpenError: timeout waiting for "open"`.
- At ebe060f, three runs started at a load average of 92.9, above the test
  runner's limit of 24. Run 1 failed
  `packages/engine/test/acceptance/failure-1-crash.test.ts` ("1 crash: a
  parent that waits on the crashing child is woken once"), with the parent's
  echo not yet holding the crash notice. It also failed
  `packages/engine/test/runner/classify-turn-text.test.ts` (6.9 A3) and
  `packages/engine/test/runner/reset-time.test.ts` (6.10 F-4), each with
  "Test timed out in 30000ms". Run 2 failed
  `packages/engine/test/recovery/orphans.test.ts` (6.8 sweep, Linux), with an
  unexpected extra process group in the sweep result. Run 3 failed
  `reset-time.test.ts` (6.10 F-4) again, by the same timeout.

Each failing file passed when run alone: `subscribe-visibility.test.ts` three
times at load 47, and the four files from ebe060f together once at load 81.
Both heads then passed `pnpm check` when the runs were repeated one at a time
below the load limit (8830d8b in post #1325).
At 9340f71 (post #1329), run 2 of 3 failed `classify-turn-text.test.ts`
(6.9 A3) and `reset-time.test.ts` (6.10 F-4) again, each by the 30-second
timeout, although the load was below 24. Runs 1 and 3 passed. Run alone at
load 26, the slowest case in each file took 19.6 seconds (6.9 A3, "a
successful turn whose text says 'authentication required'") and 17.4 seconds
(6.10 F-4, the list of bad reset values). Both cases start a fake adapter for
each harness or each value in turn, so their fixed 30-second limit leaves
little margin when the full suite runs in parallel. These two failures are
therefore test sizing, not load alone, and they predate the B1 merge (they
also failed at ebe060f).
Why it matters: a test that fails only under load hides real failures behind
noise, and a check run at high load costs a full repeat. The orphan sweep
failure may be a real race, because the sweep found a process group it did
not expect; it has not been reproduced.
What should happen: the test runner keeps waiting for load below its limit
and runs one check at a time. If a test from this list fails again at normal
load, the wait or timeout in that test is examined, as in issue 196: the wait
should name the thing the next assertion is about, and fixed 30-second
timeouts should be checked against the work the test does.

## 236. A Codex agent's call to a Shephrd tool is cancelled before Shephrd sees it

Found: 2026-11-03, by the live check at 9340f71 (live-check-2, run 1, step
`sandbox-mcp`, criterion PB-A3), against the real Codex adapter
(`@agentclientprotocol/codex-acp` 2.5.0, `@openai/codex` 0.165.0).
State: fixed locally by owner option (b), in commit
`7c2039ff9c31b986675d8793f75dc6304802fc24`.
Real-adapter validation remains pending the lead's next run.

What happens: the Codex worker, started with the permission "ask", was told
to call the Shephrd MCP (Model Context Protocol) tool `ask` once. It did call
`mcp.shephrd.ask` with the right arguments (event 112), but the call failed
with `{"error":{"message":"user cancelled MCP tool call"}}` (event 113), and
the agent reported "The ask call was cancelled by the user." No
`PermissionRequested` event was written between the two, so neither the lead
nor the owner was asked. The Claude lead's call to the same tool in the same
run asked for permission, was allowed, and wrote its `QuestionAsked` event.
Root cause, read from the adapter's code: Codex asks for approval of an MCP
tool call as an elicitation. `codex-acp` forwards a form elicitation only when
the client advertises form elicitation, and it falls back to an ordinary
permission request only for a URL elicitation or a form with no fields
(`dist/index.js:38997-39011`, `:39129-39149`). In every other case it answers
"cancel" itself. Shephrd's runner initializes every adapter with
`clientCapabilities: {}` (`packages/engine/src/runner/AcpRunner.ts:510`), so
the approval is cancelled inside the adapter. The exact elicitation was not
captured, because the protocol log was off for this run.
Why it matters: a Codex agent that asks before changes may be unable to use
any Shephrd tool (ask, post, wait and the others) unless Codex skips approval
for it. A Codex worker then cannot report back or ask its lead through
Shephrd, and the live check's PB-A3 row for Codex fails.
The owner chose option (b) on 2026-11-03. The original options were:
- Advertise form elicitation in the runner and route a tool-approval
  elicitation through Shephrd's permission flow, like any other permission
  request. This changes the runner and may need a contract for the answer.
- Or start Codex with Shephrd's own MCP server marked as not needing approval.
  This is smaller, but it removes a prompt, so it is a permission decision for
  the owner.
Evidence: `.scratch/foundry-runs/engine-build-1/live-check-2/live-check-run1.log`
and `run1-sandbox-mcp-events.txt` beside it.

The runner now configures only the Codex Shephrd server with
`default_tools_approval_mode: "approve"` through the adapter's `CODEX_CONFIG`.
It passes an empty ACP server list for start, load and resume, because the
adapter replaces the configured server map when that list is populated.
The configuration names `SHEPHRD_SOCKET` and `SHEPHRD_TOKEN` in `env_vars`;
it contains neither variable's value. Other account keys and servers retain
their settings. Invalid account JSON and a pre-existing Shephrd server refuse
the launch before spawning, with a fixed reason that exposes no value.

This departs from plan row 6.1 and decision 21 for Codex only: its server is
configured through `CODEX_CONFIG`, rather than `session/new`. Every other
harness keeps the existing ACP server entry. No other server receives a new
approval setting. The option (a) work remains open as issue 237.

The Codex 0.165.0 source confirms that `approve` requires no tool approval in
[`requires_mcp_tool_approval_for_mode`](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/core/src/mcp_tool_call.rs#L2440-L2450).
Its [`create_env_for_mcp_server`](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/rmcp-client/src/utils.rs#L14-L56)
reads the named variables from Codex's own environment independently of the
shell policy, so `shell_environment_policy.inherit=core` does not remove them
from this MCP environment. These source facts were checked on 2026-11-03.
The fake-agent tests in `runner/shephrd-server.test.ts` cover all three
session methods, preservation, refusal before spawning and unchanged Claude
behavior. The actual adapter and server journey awaits the lead's run.

## 237. Approval-gated tool servers need form elicitation routed through Shephrd

Found: 2026-11-03, while the owner decided issue 236.

Status: open. This is option (a), reserved as a follow-up by the owner.

The runner advertises no form elicitation capability. A Codex adapter can
therefore cancel a tool-approval elicitation before Shephrd sees a permission
request. Issue 236 configures Shephrd's own server to need no such approval,
but other tool servers retain their approval settings.

Advertise form elicitation and route a tool-approval elicitation through
Shephrd's permission flow. This is needed once agents use other tool servers
that require approval. The work must preserve the server's requested approval
and carry its answer through the adapter, rather than cancel it internally.

## 238. A failed live probe prevents independent evidence collection

Found: 2026-11-03, in live-check-2 run 1 at 9340f71, after the
`sandbox-mcp` failure described in issue 236.

Status: fixed locally in fix round 3 of the live-check probes.
Real-adapter validation remains pending the lead's next run.

The shared step runner stopped the flow on every failure. Consequently, a
failed sandbox probe skipped all eight later probes and the final views and
secret check, even when the service and agents remained usable.

Probe failures now remain recorded while the other probes continue. Each
probe closes its subscriptions before the next one starts. Before a live
probe runs, the harness checks that its service answers. A probe that sends
turns also requires its needed agents to have live processes in the run and
an idle lifecycle in the existing event projection. The persistent-scope
probe needs only the lead. The permission-metadata probe reads existing
events, so it needs no live agent. Unavailable preconditions produce a skip
with the reason and any preceding failed probe named.

The startup-hook through wake journey stays fail-fast. The final check runs
after probe failures, including an attempt to reconnect after a restart.
Recording still requires every earlier step to pass. Its skip names the
failed dependencies. Any failure or skip keeps the overall exit code at 1.
No failed observation becomes passing evidence.

Regression tests in `probe-fix-round-3.test.ts` exercise the real main flow
with a scripted public client, a failed sandbox probe, later passing probes,
failed final secret checks, final reconnect failure, unavailable preconditions,
and resource cleanup between probes. A separate case checks the live
precondition logic against real test-owned processes under `/tmp`.

## 239. The live probes call a failed observed attempt not attempted

Found: 2026-11-03, in live-check-2 run 1 at 9340f71, events 112 and 113.

Status: fixed locally in fix round 3 of the live-check probes.
Issue 236 is addressed separately by the owner-approved runner change below.

The worker made the exact Model Context Protocol (MCP) ask call with the
sandbox probe's marker. Its adapter reported `user cancelled MCP tool call`
and no permission request or question was recorded. The probe nevertheless
reported `not attempted`, obscuring the attempted call and its failure.

The sandbox probe now reports that adapter cancellation when the exact call
failed with that error and neither a permission request for the call nor a
question with the marker was recorded. Other exact calls without an
authenticated successful question report `attempted; failed`. The detail
contains bounded tool output, redacted for the run's known secret forms and
credential shapes before it is truncated. Both outcomes fail the closed gate.

The sibling check found the same ambiguity in observed invalid or empty
permission options, an exact shell command without the required evidence,
a sent slash payload without its escaped receipt, a persistent command that
wrote no verifiable scope, and a completed restart without replay evidence.
These now report failed attempts. A declined command, missing token-scan
preconditions, or a restart phase whose prerequisites prevented it from
running still reports no attempt. Security failures such as acting as owner,
unescaped slash text, accepted old tokens and found tokens keep their
specific failing outcomes.

`probe-fix-round-3.test.ts` checks the failed-call outcomes, bounded redaction,
permission and no-permission paths, other adapter errors, each affected
sibling observation, and the no-command control. The reload regression in
`probe-reload.test.ts` requires a failed-attempt result when recovery neither
accepts nor requeues the already-sent delivery.

## 240. A Claude Code agent's token is visible in a process's command line

Found: 2026-11-03, by the token scan in live-check-2 run 2 at 9e10ed6.

Status: open, deferred by the owner to the hostile pass (2026-11-03).
The tokens are per spawn and short-lived, and on a single-user machine the
owner treats this as ordinary exposure.

The owner's decision, relayed through the manager on 2026-11-03:

> do not fix it now. The tokens are per spawn and short-lived, and on a single-user machine this is ordinary exposure, the same as any tool that puts a token on its command line. Leave issue 240 open and deferred to the hostile pass.

The runner gives every adapter except Codex the Shephrd tool server through
the Agent Client Protocol (ACP) `mcpServers` list, with the agent's token as
the value of the `SHEPHRD_TOKEN` environment entry
(`packages/engine/src/runner/AcpRunner.ts:517-518`). The Claude Code adapter
hands that list to the Claude Agent SDK. SDK version 0.3.312 starts the
`claude` program with `--mcp-config` followed by the whole list as JSON, so
the token's value is part of that process's arguments. On Linux any process
of the same user can read them from `/proc/<pid>/cmdline`, and tools such as
`ps` show them. This breaks PB-A4 and SEC-PB-1, which require that no agent
token appears in process arguments.

Evidence: the live check found the Claude lead's own token, raw, in the
arguments of its run process 1501141 (an agent process whose working folder
is the run's work folder). The Codex row of the same step reports the same
process, because the scan checks every token of the run against every
argument snapshot. Codex itself receives only the variable names through
`CODEX_CONFIG` (issue 236, option (b)), so its token is not in any argument.
The run's folder is kept at `/tmp/shephrd-live-Twd6bJ`.

Possible fixes, not chosen: pass only the variable's name and let the tool
server inherit the value from the adapter's environment, which already holds
it (`AcpRunner.ts:307`), if the Claude Agent SDK and Claude Code keep the
parent environment for stdio tool servers; or use Claude Code's `${VAR}`
expansion in the server's `env` entry, if `--mcp-config` expands it. Either
must be checked against the pinned versions before it is relied on. The same
path is used for every other non-Codex harness, so each needs the same check.

## 241. A real adapter shell obtains owner access after removing both identity variables

Found: 2026-11-03, while diagnosing live-check-2 run 2 at 9e10ed6.

Status: open, deferred to the hostile pass by the fix-round-5 addendum
(2026-11-03). This is a real security finding for SEC-PB-5. The round-5
terminal-output fix does not change the ancestry guard.

The Claude lead ran the exact removed-variable command. Events 157-158
record its input, event 159 requests permission, event 161 selects allow-once,
and event 162 marks the call completed. The call id is
toolu_01H5T2W8rk4qpNBxZNMddW4r. The command removes SHEPHRD_SOCKET and
SHEPHRD_TOKEN with env -u, sets SHEPHRD_HOME to the run's state folder and
starts the real command-line interface's accounts list command. Its actual
tool result, line 102 of the lead's session file, contains the accounts list
and LCP_EXIT=0. The engine's thread lost that output, as recorded in issue 242.

This is owner access, rather than the required HTTP 403 ancestry refusal.
The guard in packages/engine/src/api/ancestry.ts did not prevent this real
adapter shell's request. The exact reason it missed the caller's ancestry
remains to be established. Passing fake-adapter tests do not refute this
observed real-adapter result.

Evidence: /tmp/shephrd-live-Twd6bJ/state/events.sqlite, opened read-only, and
/home/qnlbnsl/.claude/projects/-tmp-shephrd-live-Twd6bJ-work/e04b371b-45ed-4430-a3a0-483cbb74acd7.jsonl,
lines 101-102. The exact command is recorded in the worker's round-4 result.
It contains no token value.

## 242. The runner loses version 2 terminal output and exit updates

Found: 2026-11-03, while diagnosing live-check-2 run 2 at 9e10ed6.

Status: fixed locally by fix round 5 in the implementation commit
`fix: retain redacted terminal output in tool updates`. Real-adapter
confirmation and engine review remain for the lead. The manager authorized
this engine fix in the round-5 addendum.

The Claude canary call, toolu_01TVjd63cUyrVjoXchJwiCSx, appears at events
239-245. The Codex call, exec-9c103f2b-ee5f-498f-b122-f94a49f6c20b, appears
at events 262-263. Both completed the exact canary command. Their thread
items contain a terminal reference and empty content, rather than stdout or
an exit code. The actual tool results in the two named session files contain
the run's random canary and LCP_EXIT=0. Both reads succeeded, so the observed
SEC-PB-6 result is no mechanism. There is no observed deny-read refusal.
The automated probe correctly fails when its public evidence lacks output,
rather than trusting the model's prose.

The installed adapters explain the carrier. Their version 2 terminal
converters split terminal metadata into terminal_update and
terminal_output_chunk notifications. Claude's converter is dist/v2/terminal.js;
Codex has the corresponding converter in dist/index.js. Before conversion,
the metadata contains terminal output and exit fields. Version 2 selects
this path even with empty clientCapabilities. The output travels in later
notifications, rather than rawOutput on the completed tool call.

At the failing run, packages/engine/src/runner/translate.ts handled only
message, plan and tool-call updates. It ignored terminal notifications and
did not retain their metadata. This source path explains the missing output.
The run did not retain raw Agent Client Protocol frames, so its exact wire
notifications cannot be replayed. The round-5 fix preserves terminal output and exits,
correlates them with their tool call and retains the existing secret redaction
before persistence. The probes use these tool updates for shell evidence.

This also hides the owner-access result in issue 241 and the Codex refusal
in issue 243. The session evidence is Claude lines 101-102 and 110-111, and
Codex lines 44-47 and 59-62, in the paths named by live-check-run2.log.

Fix round 5 handles both the terminal metadata and the version 2 snapshot
and chunk notifications. It associates output only through an explicit
terminal reference or terminal_info, including reports that arrive after
their output. A later status-only report retains the associated output
snapshot. Unknown terminals never borrow another call's id. The existing
serialized tool-output field holds the terminalId, redacted output,
truncated flag and numeric exitCode, when the adapter supplies one. A signal
is retained when supplied. No contract or client terminal capability changes.

Decoded output uses the runner's streaming redactors before serialization,
including the decoded-field redaction from issue 223. The carry joins secret
fragments across chunks. Only the last 16,384 redacted characters of each
terminal are retained, matching the runner's stderr line bound. Each process
tracks at most 256 terminals in a turn. A completed turn or replay drains its
carry and clears those correlations. Encoded or partial terminal payloads
are withheld from gated protocol logs, whose separate frames cannot safely
release a split secret. Other structured fields keep their existing redaction.

Regressions in runner/terminal-output.test.ts use both pinned harness shapes,
with real handler, log and view entry points. They cover snapshots, chunks,
terminal metadata, nonzero exits, unknown ids, the retention bound, and raw
and split registered secrets and agent tokens. The secret frames are built
inside the fake child after spawn, so setup redaction cannot sanitize the
attack before the runner receives it. Live-check probes decode these tool
snapshots directly, including their exit codes; they do not read sessions or
model claims for shell evidence. Missing output still fails.

The round-7 review follow-up is recorded in issues 249, 270 and 271.
A zero exit now preserves a failed status reported by the adapter.
A new truncation-edge regression splits a registered secret across chunks
and cuts the retained tail through that secret's original position.
Removing the chunk redaction calls makes this regression fail on the
remaining raw secret fragment, even with publication-time redaction enabled.
The restored implementation passes that regression.
The shared stop-path tail loss remains open under issue 231.

## 243. The real Codex shell stops at socket ownership before the ancestry check

Found: 2026-11-03, while diagnosing live-check-2 run 2 at 9e10ed6.

Status: open. The live harness path remains unproven for SEC-PB-8. No client,
engine or sandbox rule was changed.

Events 233-234 show the exact removed-variable command and its failed
completion for Codex. Its session tool output at line 47 contains a complete
LCP_ENV_BEGIN and LCP_ENV_END listing. Neither SHEPHRD_SOCKET nor
SHEPHRD_TOKEN appears in it. Core inheritance did remove both names. The
probe printed absent=false because issue 242 hid the output, rather than
because either name was observed. The probe now distinguishes an unobserved
listing from observed absent or present names, without weakening its gate.

The actual command-line interface printed `shephrd: the folder /tmp above
the socket is owned by another user`, followed by LCP_EXIT=1. This is the
local check in packages/client/src/socketCheck.ts, before authentication.
It is not the HTTP 403 ancestry refusal required by SEC-PB-8. The original
sandbox's ownership view was not captured, so its namespace or filesystem
cause has not been established. The guard must not be weakened to force a pass.

Evidence: the kept events.sqlite and lines 44-47 of
/home/qnlbnsl/.codex/sessions/2026/11/03/rollout-2026-11-03T13-35-25-01a1a2e8-be04-7a62-86d6-6820e17dcee2.jsonl.

Fix round 5 reports `not observable (issue 243)` in the Codex ancestry row
when this exact socket ownership rejection is observed in the tool output.
That outcome remains failing. It does not count as an HTTP 403 ancestry
refusal and does not change the socket ownership check.

## 244. The sandbox probe rejects the exact lookup needed for a deferred tool

Found: 2026-11-03, in live-check-2 run 2 at 9e10ed6, events 118-129.

Status: fixed locally in live-check probe fix round 4. Real-adapter
confirmation remains for the lead's next run.

Claude used ToolSearch with exactly
`{"query":"select:mcp__shephrd__ask","max_results":1}`. Its result named only
mcp__shephrd__ask. It then called that tool with the exact marker and wrote
its authenticated QuestionAsked at event 127. The probe rejected the lookup
after the turn ended, so it never sent Codex its sandbox prompt. Codex's
later authenticated ask at event 270 was issued by the probe's agent client
for the slash test, rather than by a model tool call. It proves socket
authentication, but is not evidence of Codex's Model Context Protocol tool
route or its sandbox marker.

The probe permits one exact, completed Claude lookup returning only that
tool reference. An unrelated query, reference, failure or tool remains
rejected. Discovery never counts as an ask. Both agents must still make
their exact ask and produce their own authenticated QuestionAsked. The
printed prompt names this optional discovery explicitly. Regressions are
in probe-fix-round-4.test.ts.

## 245. The restart hold fails when the harness blocks sleep or the model substitutes a timer

Found: 2026-11-03, in live-check-2 run 2 at 9e10ed6.

Status: open for real-adapter restart evidence. The prompt and missing-hold
diagnostic are tightened locally in probe fix round 4. No restart criterion
is marked passed.

Claude received its active prompt at events 341-343 and called exactly
sleep 120 at events 345 and 348-349. The tool failed at event 350. Its actual
session result at line 149 says the harness blocks standalone sleep and
forbids chaining smaller sleeps as a workaround. The model did not decline
or substitute another command. That standalone hold could not establish a working turn on that harness.

Codex received its active prompt at events 346-347 and accepted it at 391.
Its session lines 104 and 107 show clock.sleep with duration_ms=120000 and
Sleep completed. No shell hold was sent through the adapter. Its turn ended
at event 392, so the exact-command condition never matched. This is model
behavior, rather than a lost prompt or a shell command that ran.

The prepare prompt no longer says to reject later shell work. The active
prompt explicitly requires shell execution and forbids a clock or timer.
An ended turn without the exact shell hold now fails immediately with a
named missing attempt instead of waiting for the whole timeout. No service
kill occurs on that path. Regressions are in probe-fix-round-4.test.ts.
Fix round 5 replaces the standalone sleep in both restart phases with the
absolute Node.js executable running a two-minute setTimeout command. The implementation commit is
`138197a7d719fb5d7ba65ec48caf856536e798b1`
(`fix: run restart holds as exact foreground commands`).
Both prompts require foreground shell execution and explain the two-minute
wait. The exact command is shared with the printed dry run and approval
gates. A standalone sleep, a clock call or background execution is rejected.
The historical harness block above remains the recorded reason for the
failed run. The restart criteria remain unproven until an authorized real
run establishes them.

## 246. Generic tool output has no runner retention bound

Found: 2026-11-03, while selecting the retention bound for issue 242.

Status: open. The round-5 scope adds a terminal-output bound and does not
change other tools' output behavior.

packages/engine/src/runner/translate.ts serializes rawOutput or the whole
content array without truncation. AcpRunner.ts then redacts and emits the
whole translated tool update. There is no generic retained-output bound in
those paths. The existing bounded diagnostic path is recovery/crash.ts,
which keeps 30 stderr lines of at most 16,384 characters each. The new
terminal-output path reuses that character bound for each terminal rather
than claiming a generic tool bound already existed. Broader retention policy
for other tools needs a separate decision and change.
Issue 270 records the separate, fixed amplification of bounded terminal
snapshots. Its fix does not bound generic tool output.

## 247. The live readiness regression can observe a killed child after its fixed wait

Found: 2026-11-03, during fix round 5, at 138197a with the terminal-output
changes uncommitted.

Status: open test reliability finding. No readiness behavior or frozen test
was changed for this round.

The live-check folder failed once in probe-fix-round-3.test.ts:151. The test
kills its worker, waits 20 milliseconds and expects the readiness check to
report no live process. The check instead returned undefined. The same
folder had passed earlier in the round. The failed run overlapped a runner
folder run. A scheduling race is suspected, but the process state at the
failed assertion was not captured, so the cause is not established. Future
diagnosis should observe the child exit rather than assume the fixed wait
establishes it. This finding does not authorize weakening the readiness gate.

## 248. The API subscription regression had a transient WebSocket open timeout

Found: 2026-11-03, during fix round 5, at 138197a with the terminal-output
changes uncommitted.

Status: mitigated, cause unconfirmed. The WebSocket open limit in
`packages/engine/test/support/socketClient.ts` went from 5 to 30 seconds.
The helper's callers do not rely on a fast open timeout. The production
client's limit is unchanged. No subscription assertion was changed.
A wider limit reduces these failures but does not prove the absence of
other load failures.

The security and API folder run failed in subscribe-visibility.test.ts,
in the stalled-subscription regression for issue 41. Its healthy client
timed out waiting for the WebSocket open event. Two cleanup errors said the
WebSocket was closed before the connection was established. The file then
passed alone, and the combined security and API folders passed on rerun.
The failed run overlapped other test folders. This test uses a fake runner,
so it does not exercise AcpRunner's new terminal path. The connection state
was not captured. The healthy client used the test helper's five-second
open limit, which left little margin under load; the failed handshake's
connection state remains unconfirmed.

## 249. Lost credential coverage with pending terminal output hangs turn completion

Found: 2026-11-03, in the focused review of issue 242, finding A.
Status: fixed in the round-7 terminal fix on `worker/engine-lcpb`.
Fix commit: `6b3af638f2d071c8ee7363d4774b7cd6ee549fe3`.

At commit `34af123`, `packages/engine/src/runner/AcpRunner.ts:251` marks the
turn ended before draining its terminal output.
The terminal publication at lines 234-235 redacts every string key and leaf
before schema decoding.
If the credential file becomes unreadable while the terminal holds its tail,
the coverage guard replaces those schema keys with the fixed withheld text.
The schema decoder rejects that shape.
The completion fiber never emits its prompt reply or turn-ended event.
The ended flag prevents a later completion attempt.
A fixed diagnostic at that decoder confirmed this failure in both new
coverage-loss regressions.
The streaming decoder itself did not fail.

The fix latches coverage loss during each terminal publication and substitutes
one fixed withheld-text item instead of decoding the damaged shape.
The turn completes without storing the pending output.
Once the credential store is repaired, the next turn can run and its terminal
output is redacted normally.
The `249` regressions in
`packages/engine/test/runner/terminal-lifecycle-round-7.test.ts` exercise both
journeys through a real command handler and a fake adapter.
They corrupt only a credential file in the test's temporary home.

## 250. A fresh service has no harness settings, so its first start is refused

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding N-1.
State: fixed in pull request #8 (post-build N-1 with A16, commit `79d0421`), merged on 2026-11-03.

Evidence: source inspection confirms the missing defaults in
`.scratch/foundry-runs/engine-build-1/review-post-build/adj/result-1.md` (not tracked).
Its new observation follows post-build A16.
Row N-1 in `.scratch/foundry-runs/engine-build-1/review-post-build/register.md` (not tracked)
also records the missing defaults.
The review reports are in the owner's run folder,
`.scratch/foundry-runs/engine-build-1/review-post-build/`, which is not tracked.

What happens: `packages/engine/src/runner/harnesses.ts` defines
`resolveHarnessDefaults`, but no service startup calls it at this commit.
In `packages/engine/src/commands/internal.ts`, harness settings are read
only from the projected `HarnessChanged` events.
Only the owner's command in `packages/engine/src/commands/harnesses.ts`
writes those events.
In `packages/engine/src/commands/start.ts`, the first start therefore
refuses every harness until the owner supplies its full settings by hand.

What should happen: the owner chose automatic loading on the service's first
start when no harness settings exist.
The owner also requested a `harnesses reset` command to reload the defaults.
This was fixed together with post-build A16 in pull request #8.
An empty model or effort list means that the value is not checked.

Score: MAJOR, severity 6 × fallout 3 × probability 10 = 180, band fix before release.
Why it matters: every fresh installation refuses the owner's first agent start.

## 251. Interrupting a committed command can skip its runner work

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding A2.
State: open, deferred by the owner on 2026-11-03.

Evidence: the post-build A2 adjudication is in
`.scratch/foundry-runs/engine-build-1/review-post-build/adj/result-2.md` (not tracked).
It adjudicates flow1 F-1, s13 F-1 and flow5 F-3
by source inspection and hand reasoning against Effect 4.0.5's source.

What happens: `packages/engine/src/commands/CommandHandler.ts` restores
interruption around the runner step after the transaction commits.
A disconnect or cancellation can therefore skip or interrupt that step.
The stored receipt makes a same-identifier retry return without the step.
In `packages/engine/src/commands/start.ts`, cancellation during setup can
leave a committed agent starting, with its prompt queued and no process.
In `packages/engine/src/recovery/restart.ts`, that starting agent is revived
after a restart even though the caller cancelled its start.
In `packages/engine/src/commands/stop.ts`, interruption after the commit
can leave a live process whose agent is recorded as stopped and whose token
has been revoked.
In `packages/engine/src/commands/resume.ts`, the post-commit step has the
same shape, although its setup already has a time bound.

What should happen: committed runner work needs a durable completion or
repair policy, including receipt replay.
The owner has not chosen whether a cancelled start finishes in the background
or fails without being revived.
A change that prevents interruption must follow post-build A3's setup bound.

Score: MAJOR, severity 6 × fallout 3 × probability 5 = 90, band schedule.
The stop path separately scores severity 6 × fallout 4 × probability 2 = 48,
band record.
Why it matters: the recorded lifecycle can disagree with the process until
the owner intervenes.

## 252. Resuming a crashed waiter does not restore its unaccepted wait notice

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding A5.
State: open, deferred by the owner on 2026-11-03.

Evidence: the post-build A5 adjudication is in
`.scratch/foundry-runs/engine-build-1/review-post-build/adj/result-4.md` (not tracked).
It adjudicates flow3 F-2 by source inspection,
hand reasoning and a dependency-free replay of the relevant source functions.
The replay did not execute a real resume or the Effect runtime.

What happens: `packages/engine/src/routing/waits.ts` can satisfy a wait and
queue its completion while the waiter is busy.
In `packages/engine/src/recovery/crash.ts`, a crash withdraws that notice
through `targetGone` in `packages/engine/src/routing/deliveries.ts`.
The wait remains satisfied in `packages/engine/src/views/apply.ts`.
Neither `packages/engine/src/commands/resume.ts` nor
`packages/engine/src/recovery/reload.ts` restores the withdrawn notice.
Wait checks revisit only open waits, so the resumed lead can look settled
without receiving its child's completion.
An ancestor wait opened after resume, or an all-wait kept open by another
busy member, can then report that lead settled before it handles the result.

What should happen: preserve enough durable association to restore an
unaccepted notice after a successful resume, without repeating accepted notices.
The owner has not chosen between restoring the saved completion and reopening
the wait to compute the members' current states.
Stopping the waiter must keep its cancellation behavior.

Score: MAJOR, severity 6 × fallout 3 × probability 4 = 72, band schedule.
Why it matters: delegated work can stop progressing until the owner prompts
the resumed lead.

## 253. A stalled recovery send prevents healthy recovered agents from continuing

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding A6.
State: open, deferred by the owner on 2026-11-03.

Evidence: the post-build A6 adjudication is in
`.scratch/foundry-runs/engine-build-1/review-post-build/adj/result-5.md` (not tracked).
It adjudicates flow4 F-1 and s21 F-2 by source
inspection and hand reasoning.
No stalled-transport test was executed in that adjudication.

What happens: the startup and account-return send loops in
`packages/engine/src/recovery/restart.ts` dispatch agents sequentially.
In `packages/engine/src/runner/AcpRunner.ts`, sending waits for the adapter's
input write acknowledgement without a transport deadline.
An adapter that stops reading can hold the first send indefinitely.
In `packages/engine/src/routing/deliveries.ts`, the ordinary follower cannot
rescue recovered agents that are already working, because that state requires
the recovery dispatch option.
The service can already be serving requests while these agents remain blocked.
The stalled agent's lane also keeps an ordinary stop waiting behind its send.

What should happen: give each recovery dispatch independent scoped progress
while preserving its lane, incarnation and delivery reservation.
Bound or cancel the transport acknowledgement with a policy for partial writes.
The send deadline and partial-write policy remain owner choices.
Issue 85's fix for the ordinary follower does not cover these recovery loops.

Score: MAJOR, severity 6 × fallout 3 × probability 4 = 72, band schedule.
Why it matters: one stalled adapter can strand healthy agents after a restart
or an account return.

## 254. An obsolete account return can overwrite a newer signed-out pause

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding A7.
State: open, deferred by the owner on 2026-11-03.

Evidence: the post-build A7 adjudication is in
`.scratch/foundry-runs/engine-build-1/review-post-build/adj/result-5.md` (not tracked).
It adjudicates flow4 F-2, s21 F-1 and flow5 F-2
by source inspection and hand reasoning.
The post-build A7 row in `.scratch/foundry-runs/engine-build-1/review-post-build/register.md` (not tracked)
retains this as a lifecycle finding, because no security property is shown to fail.

What happens: `packages/engine/src/recovery/restart.ts` checks account
availability before loading a paused agent's session.
While setup runs, a sibling on that account can report a sign-out through
`packages/engine/src/routing/deliveries.ts` and pause that agent again.
The final writer predicate in `packages/engine/src/recovery/reload.ts`
checks only whether the agent is still paused.
The obsolete return then opens the session and marks the agent working,
with a queued carry-on, despite the newer sign-out.
The signed-out send guard still prevents sending.
A later owner clearance selects paused agents, so it misses this working
agent and leaves its carry-on stranded.

What should happen: revalidate the account, its availability, the return
cause and the pause generation inside the final writer transaction.
Discard a superseded setup result and stop its replacement process.
The failure append also needs the same lifecycle validation.

Score: MAJOR, severity 6 × fallout 3 × probability 4 = 72, band schedule.
Why it matters: clearing the account does not restore progress without an
additional stop and resume, or a service restart.

## 255. Reading one unreadable receipt disables unrelated commands

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding A11.
State: open, deferred by the owner on 2026-11-03.

Evidence: the post-build A11 adjudication is in
`.scratch/foundry-runs/engine-build-1/review-post-build/adj/result-6.md` (not tracked).
It adjudicates flow7 F-1 and s05 F-1 by source
inspection and hand reasoning.
This entry records post-build A11 from
`.scratch/foundry-runs/engine-build-1/review-post-build/register.md` (not tracked).
It also supplements the broader receipt-read problem in issue 59.

What happens: receipt decoding in `packages/engine/src/log/EventLog.ts`
turns malformed stored data into `LogWriteFailed`.
The separate receipt decoder in `packages/engine/src/commands/CommandHandler.ts`
does the same inside the writer transaction.
The event log treats either read failure as a write failure and latches
command refusal for the service's lifetime.
Unrelated fresh commands then fail even though the database is writable.
The reason allow-list in `packages/engine/src/api/server.ts` reduces the
reported reason to "command refused".
Restarting clears the latch, but replaying the bad receipt sets it again.

What should happen: refuse an unreadable receipt locally at both decoding
sites, while keeping lifetime refusal for actual storage write failures.
Cover malformed text, invalid envelopes and invalid stored replies in both
the old and current receipt formats.

Score: MAJOR, severity 6 × fallout 3 × probability 4 = 72, band schedule.
Why it matters: one corrupt or incompatible receipt can stop every caller's
command flow until the owner restarts the service and uses a fresh identifier.

## 256. Failed transaction cleanup can bypass the lifetime database refusal

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding A12.
State: open, deferred by the owner on 2026-11-03.

Evidence: the post-build A12 adjudication is in
`.scratch/foundry-runs/engine-build-1/review-post-build/adj/result-6.md` (not tracked).
It adjudicates flow7 F-2 and s05 F-2 by source
inspection and hand reasoning against Effect 4.0.5's transaction source.
No double-fault transaction test was executed in that adjudication.

What happens: a failed database commit command (`COMMIT`), followed by a
failed database rollback command (`ROLLBACK`), can leave the transaction
failure in Effect's defect channel.
The connection is poisoned by
`third_party/t3code/node-sqlite/src/nodeSqliteClient.ts` until cleanup succeeds.
In `packages/engine/src/log/EventLog.ts`, typed-error mapping and observation
miss that defect, so the lifetime write-failure latch is not set.
If the next connection acquisition successfully rolls back, a new command
can succeed despite the earlier storage write failure.
The first failure also bypasses the promised fixed database reason.
The adjudicator corrected the flow report's claimed fixed web response:
`packages/engine/src/api/server.ts` can instead return a remote procedure
call (RPC) defect response on an upgraded connection.
This entry records the command-refusal defect, without claiming a reproduced
disclosure or permanent corruption.

What should happen: classify the complete transaction outcome at the database
boundary and retain lifetime refusal with a fixed safe reason.
Preserve connection cleanup before reuse and distinguish application defects
and receipt-read failures from storage failures.

Score: MAJOR, severity 6 × fallout 3 × probability 4 = 72, band schedule.
Why it matters: one transient storage fault can defeat the promised refusal
policy even after the physical connection becomes usable again.

## 257. A permission prompt omits the options its agent holder must choose

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding A14.
State: open, deferred by the owner on 2026-11-03.

Evidence: the post-build A14 adjudication is in
`.scratch/foundry-runs/engine-build-1/review-post-build/adj/result-1.md` (not tracked).
It adjudicates s14 F-1 by source inspection.
The related s14 F-3 ordering allegation is disproved on the success path.

What happens: `packages/engine/src/routing/permissions.ts` passes only the
description into the holder's delivery.
In `packages/engine/src/routing/holders.ts`, moved requests likewise omit
the options' identifiers, names and kinds.
The answer handler refuses an option identifier the request does not offer.
The tool list in `packages/mcp/src/tools.ts` offers no request-reading tool.
A direct parent can read the raw request event through a subscription, but
a holder farther up the hierarchy cannot see that child's event.
Decision row 55 also excludes subscriptions from the agent tools.

What should happen: include the options in both initial and moved deliveries,
with owner-only choices identified and adapter text enclosed and escaped.
A request-reading tool would instead require the owner's amendment to row 55.

Score: MAJOR, severity 4 × fallout 3 × probability 8 = 96, band schedule.
Why it matters: an ordinary agent-held permission request degrades into
owner intervention because the holder lacks the data needed to answer it.

## 258. Asynchronous live-check errors bypass the promised cleanup

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding A19.
State: open, deferred by the owner on 2026-11-03.

Evidence: the post-build A19 adjudication is in
`.scratch/foundry-runs/engine-build-1/review-post-build/adj/result-7.md` (not tracked).
It adjudicates s29 F-2 by source inspection,
hand reasoning and two dependency-free checks with synthetic error emitters.
The adjudicator's checks used no real service or adapter processes.

What happens: `packages/engine/scripts/live/service.ts` attaches neither
a child-process error listener nor a log-stream error listener.
An asynchronous spawn or log failure therefore throws outside the promise
awaited by `packages/engine/scripts/live/run.ts`.
The entry in `packages/engine/scripts/live-check.ts` catches only that
promise's rejection.
In the adjudicator's injected checks, both errors terminated the wrapper
with an unhandled error event before the finally or promise markers ran.
A log failure after spawn can leave the service and detached adapters running.
A failed spawn alone does not prove a surviving service.

What should happen: attach both error handlers immediately and propagate
one lifecycle failure into journey cancellation, bounded cleanup and the
named final failure summary.
Preserve diagnostics and handle errors during construction or shutdown too.

Score: MAJOR, severity 6 × fallout 3 × probability 4 = 72, band schedule.
Why it matters: the owner may need to stop leftover work by hand after a
local filesystem or process-creation fault.

## 259. A dropped permission event leaves an adapter hold with no answerable request

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding flow2 F-6.
State: open, deferred by the owner on 2026-11-03.

Evidence: finding F-6 is in
`.scratch/foundry-runs/engine-build-1/review-post-build/results/flow2.md` (not tracked).
It confirms the path by source inspection.

What happens: a full disk or lock timeout can fail the transaction that
records `permissionRequested`.
In `packages/engine/src/commands/CommandHandler.ts`, the runner-event catch
logs "runner event dropped: processing failed" and continues.
In `packages/engine/src/runner/AcpRunner.ts`, the permission hold stays pending.
There is no durable request row for an owner or agent to answer.
The agent remains working until someone stops it.
This differs from post-build A1, where a recorded request is stranded at its holder.

What should happen: cancel or reject the adapter hold when its permission
request cannot be recorded.

Score: MINOR, severity 6 × fallout 3 × probability 4 = 72, band schedule.
Why it matters: an agent can stay blocked on a request that no client can see.

## 260. A detached service discards its output and hides startup refusal details

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding s08 F-2.
State: open, deferred by the owner on 2026-11-03.

Evidence: `.scratch/foundry-runs/engine-build-1/review-post-build/results/shepherd-engine-s08.md` (not tracked), F-2, confirms the path by source
inspection and hand reasoning.

What happens: `packages/cli/src/serve.ts` launches the detached service with
its standard output and standard error ignored.
In `packages/engine/src/service.ts`, service logs go to standard output
and startup refusal reasons go to standard error.
The launcher keeps neither stream in a log file.
In `packages/cli/src/bin.ts`, the owner sees only "service failed to start".
For example, a state folder with mode 0750 hides the specific refusal that
its mode must be 0700.
Issue 181's advice to read a log file cannot work on this detached path.

What should happen: retain the output in a private file or capture and
report the startup refusal through the existing redaction boundary.

Score: MINOR, severity 4 × fallout 3 × probability 6 = 72, band schedule.
Why it matters: the owner must find another way to diagnose a failed start
or a detached service crash.

## 261. Account replacement drops omitted fields, and removal ignores running agents

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding s13 F-3.
State: open, deferred by the owner on 2026-11-03.

Evidence: `.scratch/foundry-runs/engine-build-1/review-post-build/results/shepherd-engine-s13.md` (not tracked), F-3, confirms the path by source
inspection and hand reasoning.

What happens: `accounts set` in `packages/engine/src/commands/accounts.ts`
writes exactly the supplied account into `AccountChanged`.
In `packages/engine/src/views/apply.ts`, that event replaces the whole record.
Omitting `environment` or `home` therefore drops the old values and references.
Superseded secret values remain in `packages/engine/src/accounts/SecretStore.ts`
until restart collection.
Reusing a secret's name through `set-secret` can also leave the old value stored.
The remove handler checks no running agent's account usage.
Those agents can therefore reference an account that no longer exists.
The review did not establish the later resume outcome.

What should happen: document full replacement or define field merging.
Refuse removal while agents still use the account and collect superseded values.
The owner has not chosen the replacement policy.

Score: MINOR, severity 4 × fallout 3 × probability 6 = 72, band schedule.
Why it matters: an ordinary settings change can surprise the owner and
require setting the account fields or secrets again.

## 262. A transient process-row write failure refuses one start without latching the engine

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding A13.
State: record only, with no latch, as decided by the owner on 2026-11-03.

Evidence: the post-build A13 adjudication is in
`.scratch/foundry-runs/engine-build-1/review-post-build/adj/result-2.md` (not tracked).
It adjudicates flow7 F-3 by source inspection
and hand reasoning.
The adjudicator lowered the original MAJOR label to MINOR.

What happens: `packages/engine/src/runner/AcpRunner.ts` inserts the process
row directly through the database client, outside the event-log writer.
A failed insert becomes a runner rejection and closes the spawned process group.
In `packages/engine/src/commands/start.ts`, the failure writes `AgentStartFailed`
and revokes the token if storage has recovered.
The latch in `packages/engine/src/log/EventLog.ts` sees no failed write,
so later commands remain available.
If the storage fault persists into the failure append, that append latches
the writer normally.

Owner decision: keep the one-start failure without adding a global latch
for this operational-table write.
The process is killed and its token is revoked on the recorded failure path.

Score: MINOR, severity 2 × fallout 3 × probability 2 = 12, band record.
Why it matters: a one-statement fault produces a vague start failure rather
than a database-specific refusal, while leaving the engine usable.

## 263. Live-check cleanup can adopt and signal a replacement process

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding A18.
State: record only, as decided by the owner on 2026-11-03.

Evidence: the post-build A18 adjudication is in
`.scratch/foundry-runs/engine-build-1/review-post-build/adj/result-7.md` (not tracked).
It adjudicates s29 F-1 by source inspection,
hand reasoning and an injected process-table check of the production module.
The check used synthetic processes and recorded signals without sending them.

What happens: `packages/engine/scripts/live/service.ts` retains the spawned
child's numeric identifier without an immutable original start time.
Discovery accepts that identifier as a seed even after the original child exits.
If another job reuses the number before cleanup, the cleanup records the
replacement's current start time as its own identity.
It can then admit that job's descendants and signal them too.
The identity map is also recreated on each stop call.
The adjudicator's check recorded SIGTERM for synthetic replacement 4242 and
its child 4243, while sparing unrelated control 9999.
Issue 205 records a missing reuse test, but its broader identity assurance
does not cover reuse before the first identity is recorded.

What should happen: retain the original service identity from spawn through
every cleanup call and reject an invalid seed before discovering descendants.
Carry observed identities through discovery and signalling, including the
initial direct signal.
No cleanup implementation change is authorized by this record-only decision.

Score: MAJOR, severity 6 × fallout 3 × probability 2 = 36, band record.
Why it matters: cleanup can stop unrelated owner work after an early exit
and process-identifier reuse.

## 264. The orphan-sweep test for a surviving group times out before its own deadline

Found: 2026-11-03, by review-fix-2 while verifying the post-build A3 fix.
State: open, recorded at the review lead's request in board post 8.

Evidence: the fixer's result is in
`.scratch/foundry-runs/engine-build-1/review-post-build/fix-round-1/result-2.md` (not tracked).
It reports a five-second test timeout in
`packages/engine/test/recovery/orphans.test.ts`, case F-3.
The case is named "a group that survives SIGKILL".
The full engine run on branch `worker/review-2`, commit `c9ff320`, had
1,627 passing tests, one failing test and two skipped tests.
Review-fix-2 reproduced the same failure on the untouched base commit
`8ff4c9b` in a temporary worktree, which was then removed.
I did not reproduce the runtime failure in this worktree.

What happens: the case keeps one fake process group alive after both signals.
It allows the sweep eight seconds to return through `Effect.timeoutOption`.
In `packages/engine/src/recovery/orphans.ts`, the default wait after the
kill signal is five seconds, after the case's 30-millisecond grace period.
The reported five-second test timeout therefore expires before that expected
sweep can complete.
The root `vitest.config.ts` declares a 60-second test timeout.
Its effective timeout for this workspace case still needs verification.
The report does not establish a production sweep failure or a post-build A3 regression.

What should happen: make the case's effective test deadline cover the
deliberate sweep bound, or inject a shorter sweep wait without weakening
the assertion that a surviving group is left alone and the next row is swept.
No test or production implementation is changed by this record.

Score: not assigned, because the new evidence establishes a test failure
rather than a scored production defect.
Why it matters: a failure already present on the base commit prevents a
clean full-suite result for unrelated engine changes.

## 265. A stalled prompt send holds the lane that a stop command needs

Found: 2026-11-03, in the post-build review of commit `8ff4c9b`, finding flow3 F-5.
State: open, record only under the owner's 2026-11-03 review choices.

Evidence: finding F-5 is in
`.scratch/foundry-runs/engine-build-1/review-post-build/results/flow3.md` (not tracked).
It confirms the path by source inspection
and hand reasoning, without executing a stalled-send test.
The post-build A6 adjudication in
`.scratch/foundry-runs/engine-build-1/review-post-build/adj/result-5.md` (not tracked)
keeps this stop-control consequence separate from the cross-agent recovery
scheduling defect.
Issue 253 records that recovery scheduling defect.

What happens: an adapter can stop reading while a large prompt fills its
standard-input pipe.
In `packages/engine/src/routing/deliveries.ts`, dispatch holds the agent's
lane through the runner's prompt call.
In `packages/engine/src/runner/AcpRunner.ts`, that call waits for the write
acknowledgement without a send deadline.
In `packages/engine/src/commands/CommandHandler.ts`, a stop waits for the
same lane before it can stop the process.
The stop therefore waits for the adapter to exit or for an external kill.

The post-build A3 fix on `worker/review-2`, commit `c9ff320`, does not cover this path.
Its `packages/engine/src/routing/lanes.ts` cancellation registration is used
only by start setup, as the fixer's result confirms.
An ordinary stalled send registers no such cancellation signal.

What should happen: bound or cancel the send acknowledgement, or let an
authorized stop pre-empt the send before acquiring its lane.
The original flow score is severity 6 × fallout 3 × probability 2 = 36, band record.
The flow reviewer labelled it MINOR.
The post-build A6 adjudicator considers indefinitely failing stop control a MAJOR
consequence, while keeping this finding separate from post-build A6.
Why it matters: an ordinary stop can fail to end the affected agent until
the owner intervenes outside the command path.

## 266. A setup timeout after account sign-out records an invalid start-failure event

Found: 2026-11-03, in the re-review of the post-build A3 fix at commit `c9ff320`.
State: record only, as decided by the review lead on 2026-11-03.

Evidence: finding F-3 is in
`.scratch/foundry-runs/engine-build-1/review-post-build/fix-round-1/rresult-2.md` (not tracked).
The re-review confirms the path by source inspection and an in-memory
integration probe with a controlled clock.
The probe observed one runner stop, one `AgentStartFailed`, a revoked token
and an agent that remained paused.
Those observations are the re-reviewer's results, not a test run in this worktree.

What happens: a plain start can still be setting up when another agent on
its account reports a sign-out.
In `packages/engine/src/routing/deliveries.ts`, account-wide sign-out pauses
the starting agent.
The two-minute setup bound added by pull request #9 then stops its runner
when setup times out.
The existing failure branch in `packages/engine/src/commands/start.ts`
writes `AgentStartFailed` and revokes the agent's token.
In `packages/contracts/src/stateMachine.ts`, that event is valid only from
starting, where it changes the agent to stopped.
In `packages/engine/src/views/apply.ts`, an event invalid from paused leaves
the lifecycle unchanged.
The view therefore stays paused without a session or process.

The failure branch predates the setup bound and exists at base commit `8ff4c9b`.
A setup rejection after sign-out already had the same inconsistency.
The timeout in the post-build A3 fix adds another route to that branch.
This does not permanently prevent recovery.
The production account-return path in `packages/engine/src/recovery/restart.ts`
can start the paused agent without a session after its account becomes available.

What should happen: any recorded failure event must be valid for the current
lifecycle while preserving account-return recovery.
No implementation change is part of this record-only entry.

Score: not assigned, because the re-review supplied no numerical risk score.
The re-review labels the finding MINOR.
Why it matters: the timeout records a start failure without reaching the
stopped state checked by `packages/engine/test/commands/start-setup.test.ts`
added by pull request #9.

## 267. A cancelled start's fallback cleanup races with a later stop or resume

Found: 2026-11-03, in the re-review of the post-build A3 correction at `8596f63`.
State: open, recorded at the review lead's request in board post 23.

Evidence: finding F-1 is in
`.scratch/foundry-runs/engine-build-1/review-post-build/fix-round-1/rresult-2b.md` (not tracked).
The re-reviewer confirmed the path by source inspection and supplemental
integration probes with a delayed writer.
The probes observed a duplicate terminal event after a successful stop and
revocation of the new token after a successful resume.
They did not establish that the fallback killed a real operating-system process.

What happens: in the merged A3 implementation, a cancelled start in
`packages/engine/src/commands/start.ts` releases its agent's lane before
waiting for the stops that cancelled it to settle.
It then checks the lifecycle outside the writer transaction and runs fallback cleanup.
The cleanup stops a runner by agent identifier and unconditionally appends
`AgentStartFailed` while revoking every token for that agent.
It does not recheck the current state or original token incarnation inside
the writer transaction.
The settlement helper in `packages/engine/src/routing/lanes.ts` waits only
for a snapshot of the stops already registered.
A later valid stop can therefore commit `AgentStopped` before the old
fallback appends `AgentStartFailed`.
A subsequent `resume --fresh` in `packages/engine/src/commands/resume.ts`
can open a new incarnation whose token the old fallback then revokes.
The view can stay idle while its new token is unusable.
The runner stop in `packages/engine/src/runner/AcpRunner.ts` also selects
only by agent identifier, so stale cleanup could target a later process.
The review directly proved the event and token consequences, rather than that kill.

What should happen: keep fallback cleanup inside the agent's lane and
validate the current state and the original token inside the failure transaction.
Cleanup from one incarnation must not stop or revoke a later incarnation.
This remains part of the post-build A3 follow-up linked from issue 103.
No implementation change is made by this record.

Score: not assigned, because the re-review supplied no numerical risk score.
The re-review labels the finding MAJOR.
Why it matters: overlapping commands or a delayed writer can let cleanup
from a cancelled start corrupt a later successful stop or resume.

## 268. A cancelled start can outwait its settlement deadline at the event writer

Found: 2026-11-03, in the re-review of the post-build A3 correction at `8596f63`.
State: open, recorded at the review lead's request in board post 23.

Evidence: finding F-2 is in
`.scratch/foundry-runs/engine-build-1/review-post-build/fix-round-1/rresult-2b.md` (not tracked).
The re-reviewer checked the source and ran supplemental integration probes
through the real writer boundary.
One probe held the writer beyond the settlement deadline.
Another injected `LogWriteFailed` inside the real transaction to exercise
the production refusal latch without inducing a physical disk fault.
These are the re-reviewer's observations, not runtime tests run in this worktree.

What happens: in the merged A3 implementation, the two-minute timeout in
`packages/engine/src/routing/lanes.ts` bounds only the wait for stop settlement.
The fallback append in `packages/engine/src/commands/start.ts` runs afterward.
If a stop still holds the writer indefinitely, the cancelled start can wait
indefinitely for that writer even after its settlement deadline has expired.
The timed probe progressed only after the writer was released.

A real writer failure has a different remaining limit.
In `packages/engine/src/log/EventLog.ts`, `LogWriteFailed` latches refusal
for the lifetime of the writer.
The fallback uses that same writer, so it cannot append its terminal event
or revoke the original token after the latch is set.
The probe observed an agent still starting with an unrevoked token and
no `AgentStartFailed`, although the runner stop was called.
The new writer-failure case in
`packages/engine/test/commands/start-setup.test.ts` instead injects a
one-shot failure outside the real writer.
Its following fallback transaction can succeed because that synthetic
failure never exercises the refusal latch.
It does not prove terminal completion under the production latched failure.

What should happen: qualify the completion guarantee on a usable writer
or define a separate recovery policy for failed persistence.
Distinguish the recoverable synthetic failure from the real latched failure
in the test evidence.
Do not bypass the storage-failure latch to force a terminal append.
The settlement deadline must not be described as a bound on later writer work.
This remains part of the post-build A3 follow-up linked from issue 103.
No implementation change is made by this record.

Score: not assigned, because the re-review supplied no numerical risk score.
The re-review labels the finding MINOR.
Why it matters: the claimed terminal-outcome guarantee and its time bound
are stronger than the persistence path and the test establish.

## 269. An account home that equals a stored secret value is redacted, so the account event fails its schema and later account commands are refused

Found: 2026-11-03, in the re-review of the post-build A9 fix at `1f2602a`.
State: open, residual after the last fix round; the code reviewed at
`1f2602a` is merged in pull request #8.

Evidence: finding F-1 is in
`.scratch/foundry-runs/engine-build-1/review-post-build/fix-round-1/rresult-1b.md` (not tracked).
The re-reviewer reproduced the failure through the real service with a
Claude account and a planted login-folder value.
The same path applies to Codex by source inspection.
These are the re-reviewer's observations, not runtime tests run in this worktree.

What happens: add or set a Claude or Codex account whose home equals the
value stored under `CLAUDE_CONFIG_DIR` or `CODEX_HOME`.
The value can be stored through `accounts set-secret` or supplied through
a `secret:` reference.
The redactor registers that stored value in `packages/engine/src/service.ts`.
`packages/engine/src/log/EventLog.ts:250` redacts the account event before
the schema check at `packages/engine/src/log/EventLog.ts:182`.
The redacted home no longer meets the absolute-path requirement at
`packages/contracts/src/accounts.ts:22`.
The command fails with a `SchemaError`.
The secret file has already been written at
`packages/engine/src/commands/accounts.ts:78` and cannot be rolled back
with the database transaction.
Receipt redaction at `packages/engine/src/log/EventLog.ts:221` also replaces
the home in the stored account result.
Receipt decoding at `packages/engine/src/commands/CommandHandler.ts:252`
then refuses `accounts list` on a fresh connection.
These source line numbers are from the reviewed commit `1f2602a`, and the files have changed since.

The command tests use a pass-through redactor at
`packages/engine/test/support/handlerRig.ts:117`,
`packages/engine/test/commands/account-login.test.ts:120`, and
`packages/engine/test/commands/account-login.test.ts:142`.
They therefore do not exercise the real service's redaction boundary.
The fix now accepts the matching input instead of refusing it.
The matching-folder acceptance rule in row A9 of
`.scratch/foundry-runs/engine-build-1/review-post-build/owner-choices.md` (not tracked)
remains unmet through the real service.

What should happen: use an end-to-end representation that accepts the
matching setting while preserving secret removal.
Do not exempt secrets from redaction.
The registry in `packages/engine/src/service.ts` is also involved in
owner finding B1, recorded in issue 223.
Post-build A4 was fixed in pull request #11 and has no issue entry.
The A4 fix leaves this failure open: `home` is still free text, so it is still redacted
(`rresult-4.md`, question 4, in the same run folder).

Score: not assigned, because this is a residual after the last fix round.
The re-review labels the finding MAJOR.
Why it matters: a matching login-folder configuration can fail after
persisting its secret and leave later account commands refused.


## 270. Every terminal chunk persisted another whole retained snapshot

Found: 2026-11-03, in the focused review of issue 242, finding B.
Status: fixed in the round-7 terminal fix on `worker/engine-lcpb`.
Fix commit: `6b3af638f2d071c8ee7363d4774b7cd6ee549fe3`.

At commit `34af123`, `packages/engine/src/runner/terminal.ts:153` reports every
changed terminal immediately.
Two thousand chunks of 100 characters produce 2,002 tool-call events in the
new version 2 regression against that code.
The review measured about 32 megabytes of event payload for that journey.
The 16,384-character retention limit bounds a snapshot, but not its repeated
publication cost.
Version 1 metadata-only deltas also produce empty generic tool reports after
the terminal metadata is stripped.

The fix uses the Effect clock and a 500-millisecond window per terminal.
Two output snapshots per second preserve interactive progress without
persisting the whole retained tail for every small chunk.
Binding and exit publish immediately.
Turn end and stop flush any unpublished output or status.
Metadata-only terminal deltas no longer emit empty generic tool reports.
The final snapshot retains the same last 16,384 redacted characters.
A repeated, unchanged tool status also marks the snapshot unpublished, so
its empty generic report cannot hide the retained output at turn end.
The tests use the Effect test clock to check the window boundaries and the
independence of two terminals without real timing sleeps.

The `270` regressions in `terminal-output-round-7.test.ts` bound the helper's
2,000-chunk journey to three snapshots and less than 40 kibibytes of payload.
The version 1 and version 2 journeys in `terminal-lifecycle-round-7.test.ts`
use the real command handler and bound stored tool-call events to fewer than
ten and their serialized payload to less than 100 kibibytes.
Both require the complete retained tail at turn end.
These files are under `packages/engine/test/runner/`.
Issue 246 remains open for generic tool-output retention.

## 271. The terminal cap silently refused later terminals and unclaimed ids consumed its slots

Found: 2026-11-03, in the focused review of issue 242, finding C.
Status: fixed in the round-7 terminal fix on `worker/engine-lcpb`.
Fix commit: `6b3af638f2d071c8ee7363d4774b7cd6ee549fe3`.

At commit `34af123`, `packages/engine/src/runner/terminal.ts:58` returns nothing
for a new terminal after the map reaches 256 entries.
Completed terminals remain in the map until the turn ends.
Unclaimed ids use the same slots as terminals associated with real calls.
The new regressions against that code retain only 256 of 300 completed
terminals and refuse a real call after 256 unclaimed ids.

The fix logs one fixed warning per overflowing turn without including
terminal output or ids.
It evicts the oldest ended or unclaimed terminal before refusing a new one.
It flushes an ended terminal's unpublished status before eviction and
discards an unclaimed terminal's redactor carry.
An active terminal associated with a call is never evicted.
The 256-entry state bound remains in place.
Discarding terminal carry on a temporary coverage loss keeps the warning
latch until the actual turn ends.
The `271` regressions in
`packages/engine/test/runner/terminal-output-round-7.test.ts` cover both
starvation cases and the unpublished-status flush.
The logger regression in `terminal-lifecycle-round-7.test.ts` verifies one
warning in each of two overflowing turns and checks that it contains no
output text.


## 272. Codex's ask mode can refuse a write without requesting permission

Found: 2026-11-03, in live-check run 4 at commit
`f94dd9996a93cf658ddf3ee52cdbbf7fb5fc1ab9`.
Status: open, recorded; the engine is not changed in fix round 8.

`packages/engine/src/runner/harnesses.ts:60` maps Shephrd's `ask` level to
Codex's `read-only` mode.
In `@agentclientprotocol/codex-acp` version 2.5.0, the installed source at
`dist/index.js:40424-40449` gives that mode an `on-request` approval policy
and a read-only sandbox.
The adapter passes the selected mode's approval policy into each turn at
`dist/index.js:42079`.
The policy relies on the model choosing to request approval for a write.
It does not require a permission question before every attempted change.

The lead's event-log inspection reports that run 3 requested approval for
a Python write at event 81, and the live-view criterion passed.
In run 4, event 78 attempted `touch hello.txt`.
Event 80 reported a read-only file-system refusal and exit code 1.
The worker then said it could not create the file because the workspace
was read-only, and event 98 ended its turn without a PermissionRequested.
The person sees a worker that could not write and no permission question.
The failure direction is safe: the sandbox refuses the write.
The original live-view step then waited 300 seconds for a request that
could no longer arrive from that turn.
These observations come from the lead's round-8 task and the run-4 log at
`.scratch/foundry-runs/engine-build-1/live-check-2/live-check-run4.log`.
They are not a new real-adapter run by this worker.

One option to weigh is an approval policy that always asks before a write,
if the adapter can expose that behavior while preserving the sandbox.
The four session presets exposed by version 2.5.0 at
`dist/index.js:40424-40494` and `dist/index.js:40528-40547` offer read-only,
workspace-write, agent, and full-access modes.
Their approval policies are `on-request` or `never`.
None is an always-ask preset.
A future adapter integration change would need separate verification.
Widening the sandbox merely to obtain a passing probe would not establish
ask-before-write behavior.

Fix round 8 changes the live-check prompt to request approval explicitly,
including one retry after a read-only refusal, with an honest failure path.
It makes live-view fail as soon as a worker's turn ends without a request,
and continues collecting independent probe evidence after journey failures.
It still requires a real permission request and a preceding thread item
on the second connection to pass live-view.
These probe changes do not fix the engine's ask-mode semantics or close
this issue.

## 273. Three limits remain in the bounded terminal output

Found: 2026-11-03, in the verification of the round-7 terminal fix.
Status: open, recorded, not fixed.
The review is `.scratch/foundry-runs/engine-build-1/reviews/lcp-242-verify.md`.
It rated each limit minor, and it found no redaction leak.

The first limit is a silent gap during a coverage loss.
Terminal updates that arrive while the login store cannot be read are discarded,
and the terminal map is cleared.
That interval leaves no marker in the thread.
If coverage returns before the turn ends, the rest of that command's output is
absent, and nothing says so.
The failure is in the safe direction, because nothing raw is stored.

The second limit is the bound on version 1 reports.
A version 1 delta report that carries any other field, such as `status`, is not
skipped as a data-only report.
In the review's run, 2,000 such reports stored 2,008 items and 559 KB.
That is 57 times smaller than before the fix, but the bound is the report count.
The regression in `terminal-output-round-7.test.ts` uses delta-only reports,
so it does not show this case.

The third limit is the lack of a trailing publish.
A burst of output inside the 500-millisecond window stays unpublished until the
next update, the command's exit or the end of the turn.
No output is lost, but the view can lag for as long as a command stays quiet.
One suggested fix is one delayed publish for each terminal with unpublished output.

## 274. A terminal chunk containing a secret from the launch is dropped without a marker

Found: 2026-11-03, in the verification of the round-7 terminal fix.
Status: open, recorded, not fixed. The fault is older than the fix.
The review saw the same result at `34af123`.
It ran 12 times, and the chunk never reached `packages/engine/src/runner/terminal.ts`.

A version 2 terminal chunk that contains a secret passed to the adapter at launch,
such as a login token, is lost whole.
The same text from a login store is redacted and shown.
A person who runs `env | grep TOKEN` therefore sees nothing, not a redacted line.

The review infers the cause, and it did not find the exact line.
The redactor matches base64 runs of a secret
(`packages/engine/src/identity/redactor.ts:25-58`), and a version 2 chunk's data
is base64, so a match on the whole frame may discard the chunk.
The failure is in the safe direction, because no secret is stored.
The gap is that the thread gives no sign that output was withheld.

## 275. A real model can decline a live-check probe's command

Found: 2026-11-03, in the final live run at `a105465`.
Status: open, recorded, not fixed. The outcomes are recorded as they happened.
The log is `.scratch/foundry-runs/engine-build-1/live-check-2/live-check-run6.log`.

The Codex worker runs on `gpt-6-luna` at low effort.
In the final run, this model declined two exact commands from a probe.
It declined the removed-variables command, because that command removes both
Shephrd variables before it asks for account data.
It also declined the restart hold, because the prompt says that the hold is part
of a restart probe.
The same prompts ran on Codex in earlier runs: the restart hold passed in live
runs 3 and 5, and the removed-variables command ran in live run 3.

This has two effects on that run's evidence.
SEC-PB-8 has no observation from the run, and its row reads `not attempted`.
The `reload` step fails before its first restart, so PB-A7, PB-A8, PB-A11 and
PB-A12 have no result from the run for either harness.
Their evidence is live run 5, at `9751bda`.
The only source changes from `9751bda` to `a105465` are the probe's readiness
wait and the documents.

A model's refusal is an honest outcome, and the probes do not count it as a pass.
A later change could reword these prompts, or could run the probes on a stronger
model. Either would need another real run.

## 276. The atomic-write acceptance test can fail on a later, unrelated request

Found: 2026-11-03, by the test runner (`pnpm check` at `f5e002c`, post #1343).
Status: fixed in `packages/engine/test/acceptance/failure-3-atomic.test.ts`.
Both post-restart assertions now match the failed request's id, using
`permissionRequestId` for `PermissionMoved` and `subject.id` for
`OwnerNeeded`. The checks before the restart are unchanged.
The fault was in the test, not in the engine.

The test is the third scenario in
`packages/engine/test/acceptance/failure-3-atomic.test.ts`.
It plants a database fault, so that a pass-up command cannot write its last
event.
It then restarts the service and asserts that the child has no "permission
moved" event in the whole log.
That assertion fails with this message: "part of the failed command is in the
log after the restart".
Run 1 of 3 at `f5e002c` failed this way, and runs 2 and 3 passed.
Run 2 at `bd38b78` failed with the same message (test-run log
`review-13-run2-bd38b78-check.log`).
The earlier failure was not reproduced at that older head.

The message is misleading, because the event comes from a later request.
A restart cancels the open request, and the reloaded child then asks again under
a new request id.
The holder's turn ends without an answer, so the engine moves the new request to
the owner.
That move is ordinary behaviour.
The assertion matches on the child's agent id, not on the failed request's id.
It therefore fails whenever the log read happens after that move.

A temporary copy of the test showed this, and the copy has been deleted.
With a six-second wait before the read, the copy failed every time it ran (one
run), at sequence 38, the same sequence as the failed check.
Its log showed the failed request `f8bb32df` with a cancel at sequence 20 and no
move.
The move at sequence 38 belonged to the new request `61fc71d8`.
With the assertion narrowed to the failed request's id, the same delayed copy
passed.
Without the wait, 24 runs of the unchanged assertion passed, so the failure
depends on read timing.

Atomicity itself is not in doubt in these runs.
The check before the restart, which looks for a partial write of the failed
command, passed in every run.

The fix is to filter both post-restart assertions by the failed request's id.
"Permission moved" carries that id as `permissionRequestId`, and "owner needed"
carries it as `subject.id`.

## 280. A short explicit secret equal to a schema word makes a terminal snapshot fail to decode and drops the terminal item

Found: 2026-11-03, in the post-build re-baseline at `ce50c50` (the merge of
pull request #13).
State: open, recorded, not fixed. The fix round was at its two-round cap.
The review lead scored it 36, which is the record band.
The re-reviewer's scoring was adopted: severity 6, because a core feature
stays wrong until the configuration is corrected by hand; fallout 3, because
the owner can change the conflicting configuration and restart the affected
work without support; and probability 2, because the conflicting credential
configuration is unusual but needs no privileged access.

Evidence: finding F-1 is in
`.scratch/foundry-runs/engine-build-1/review-post-build/fix-round-1/rresult-6.md` (not tracked).
The re-reviewer reproduced it with an in-memory probe that used the real
terminal output builder, the `cleanStructure` and `publishTerminals` bodies
copied unchanged from `ce50c50`, and the real `threadContent` schema.
The review lead read the same code and confirmed the path.
The re-reviewer also ran nine targeted test files, of which 38 tests passed and
35 failed.
The child-process tests were run, but adapter initialization failures prevented
validation of the full live path.

What happens: `publishTerminals` in `packages/engine/src/runner/AcpRunner.ts`
passes the generated terminal content through `cleanStructure`.
That helper redacts every object key and every string leaf, including the
`_tag` key and its value `tool-call`.
It therefore bypasses the structure protection that pull request #11 added to
the event log.
If a registered secret collides with part of a required key, discriminator or
enumerated value, the content no longer decodes as `threadContent`.
The redactor matches occurrences within strings, so the secret does not need
to equal the whole word.
The demonstrated examples are the explicit secrets `_tag`, `tool-call` and `t`.
The eight-character inferred values `ool-call` and `tool-cal` also corrupt the
`tool-call` discriminator and fail in the same way.
The decode failure becomes the rejection "adapter terminal content is
malformed".
The update handler catches that rejection and drops the terminal item.
A drain at the end of a turn can propagate the same rejection to its caller.
With an unrelated secret the same terminal publishes one item.
No secret leaks, because the failure closes the path.
The cost is lost terminal output, and possibly a turn that does not reply.

Why the probability is not higher: a registered secret has to collide with part
of the schema vocabulary.
An inferred value also needs an environment variable whose name matches the
service's secret-name pattern, and a value that passes the length and
scalar exclusions in `packages/engine/src/identity/inferredSecret.ts`.

The fix: redact the outer tool-call structure without rewriting its keys or
its discriminator.
Keep redacting the call identifier, the title, the signal and the whole
serialized output as text, including any `_tag` inside that string.
Keep the coverage-loss latch.
If redaction makes another required field invalid, publish a fixed withheld
item instead of dropping the terminal or failing the drain.
Add a runner-to-log test for the short explicit-secret collisions.
The existing terminal tests use a long secret, and the existing structure
tests exercise the event-log redactor without this publication step.

## 300. `OwnerNeeded.reason` is free text with three producers

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: `OwnerNeeded.reason` is free text, written in three places: `routing/holders.ts:49`, `recovery/crash.ts:69` and `routing/deliveries.ts:194`. A client that maps reasons to alert kinds breaks without a sign if a reason string changes.
What should happen: The client API plan pins the reasons with a contract test.
Why it matters: A changed reason string would silently stop an owner alert from being raised.

## 301. Effect's `RpcGroup.merge` silently replaces a command with the same name

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: In Effect 4.0.5, `RpcGroup.merge` replaces a command whose name is already present, and says nothing.
What should happen: Composing several command groups needs a test that every command name is unique.
Why it matters: A command could vanish from the served API without any error.

## 302. A delivery's text is wrapped as data only for an agent sender

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: `packages/engine/src/routing/envelope.ts:23` wraps a delivery's text as data only when its sender is an agent (`sender._tag === "agent"`). A new sender kind, such as a service or a piece, would go out unwrapped.
What should happen: The rule becomes "every sender but the owner". The client API contract's edit E15 makes that change.
Why it matters: Unwrapped text from a new sender could be read by an agent as an instruction.

## 303. The root `pnpm -r test` runs no tests, and the engine package has no `test` script

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: The root `pnpm -r test` passes without checking anything (client API row 111). The engine package has only a `typecheck` script, so `pnpm --filter @shephrd/engine test` also runs nothing. Tests run only through the root `vitest run`.
What should happen: Not decided. The real gate is the root `pnpm check`.
Why it matters: A passing test command that checks nothing gives false confidence.

## 304. Question rows from a stopped or crashed asker stay open

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: Engine question rows from a stopped or crashed asker stay open in the views, and answering one queues a reply to a dead agent (client API row 107).
What should happen: Not decided. Question closure stays with issue 113.
Why it matters: The owner is shown questions nobody can receive an answer to.

## 305. Secret collection at start-up deletes the secrets a piece keeps

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: `collectSecrets` deletes every secret that no account uses, so a piece cannot keep its own secret.
What should happen: Client API edit E27 (row 94) lets a piece keep its secrets.
Why it matters: A piece that needs a stored secret would lose it at the next start.

## 306. `packages/client` imports Node modules at its root, so a browser cannot use it

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: The client package imports Node modules at its root.
What should happen: Client API edit E26 (row 110) makes the package usable from a browser.
Why it matters: The web page cannot use the shared client library.

## 307. The client's stream dispatch calls `subscribe` for every streaming command

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: The stream dispatch in `packages/client` calls `subscribe` for every streaming command.
What should happen: Client API edit E24 (row 109) dispatches each streaming command to its own call.
Why it matters: A streaming command other than `subscribe` would read the wrong stream.

## 308. The client's typed decoder rejects an unknown event tag

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: The client's typed Remote Procedure Call decoder rejects an unknown event tag before any handler sees it, so a newer server stops an older client's stream.
What should happen: Client API edit E25 (row 109) lets a client pass an unknown tag through.
Why it matters: Adding an event kind to the server would break every client that is not updated.

## 309. Engine events have no size bound

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: One large engine event can exceed a message budget (client API row 105).
What should happen: Not decided.
Why it matters: An oversized event cannot be sent to a client.

## 310. A phone alert can arrive twice

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: A phone alert can arrive twice, because delivery is at least once (client API row 106).
What should happen: Not decided. The duplicate is accepted until a rule says otherwise.
Why it matters: The owner may be alerted twice for one matter.

## 311. ntfy's default access can leave topics open

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: The default access on an ntfy server can leave topics open, and Shephrd cannot check the owner's server (client API row 115). The setup document advises deny-all.
What should happen: The owner sets deny-all on the ntfy server, as the setup document advises.
Why it matters: Anyone who learns a topic name could read the owner's alerts or send false ones.

## 312. The `accounts` read and `AccountChanged` carry environment values as entered

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: A plain value under a name that does not look like a secret reaches every client and the log (`contracts/src/accounts.ts:9-16`, client API row 141).
What should happen: Not decided.
Why it matters: A secret stored under an ordinary name would be written to the log and shown to clients.

## 313. A permission request's row stays open after `stop`

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: A permission request's row stays open after `stop`, and a resumed session cannot answer it, because the hold belongs to the old process (client API row 144).
What should happen: Edit E31 makes `stop` write `PermissionCancelled` with a withdrawal for the stopped agent's open requests, as a crash does (client API row 163). When unit 1b merges, the stop part of issue 74 is closed. Recovery's part is already done, and question closure stays with issue 113. A row left by an older log is closed by a restart.
Why it matters: The owner sees a request that nobody can answer.

## 314. A failing alert adds one event every 10 minutes

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: An alert that keeps failing adds one small event every 10 minutes while the carrier is down (client API row 131).
What should happen: Not decided.
Why it matters: A long outage grows the event log without end.

## 315. The number of agents in `client.snapshot` is not capped

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: Stopped agents can grow the snapshot, and only a fixture test bounds the whole (client API row 137).
What should happen: Not decided.
Why it matters: A long-lived installation could exceed the snapshot's size budget.

## 316. An answered question's withdrawal can strand a reloaded holder as working

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: A withdrawal for an answered question can leave a reloaded holder marked as working with nothing to send (`routing/questions.ts:27`, `recovery/reload.ts:84-98`).
What should happen: Unit 1b fixes it through edit E17 (client API row 173).
Why it matters: The agent never takes new work and the team stalls.

## 317. `SecretStore.resolve` cannot tell a missing value from a failed read

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: `accounts/SecretStore.ts:66-72`: `resolve` returns nothing both for a missing value and for a failed read. The carrier treats both as a failed attempt (client API row 168).
What should happen: Not decided.
Why it matters: A caller cannot report the real cause of a failure.

## 318. `project` gives a piece's reducer placeholder envelopes

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: `routing/waits.ts:28-31`: `project` gives a piece's reducer placeholder envelopes, with the caller owner and time zero. A reducer now reads only the event and the sequence (client API row 161).
What should happen: Not decided.
Why it matters: A reducer that reads more than the event and the sequence would see false values.

## 319. A very large reply cannot reach a very slow link

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: A reply of about 3 mebibytes cannot reach a link of about 500 kilobits per second, because the link misses two heartbeats on the read connection (client API row 160).
What should happen: Not decided.
Why it matters: A client on a very slow link cannot read a very large reply.

## 320. Another local user can hold the web server's loopback port while it is down

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: While the web server is down, another local user can hold its loopback port and serve a long-cached page (client API row 167).
What should happen: The owner is told. Not otherwise decided.
Why it matters: A browser could be shown a page that did not come from Shephrd.

## 321. An agent that runs `shephrd client subscribe` reads events with no data envelope

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: This is how the engine's `subscribe` works today (client API row 166).
What should happen: Not decided.
Why it matters: Event text read by an agent is not marked as data, so it could be read as an instruction.

## 322. `runner/translate.ts` drops the tool-call id from file-change content

Found: 2026-11-03, while planning the client API plan.
State: fixed on the foundation fix branch, pending independent verification.

What happened: A Codex diff lost the tool-call identity before it reached the event log.
What changed: Both diff shapes retain the optional `content.callId` through the runner and persistence.
The web permission view joins that field to the request's `toolCallId`.
It no longer treats an independently generated thread-item identity as a tool-call identity.
Old file-change events still decode, and a missing correlation keeps the fixed missing-input warning.
The runner regression covers two edits of one path, unrelated calls, a locations-only request, and redacted diff text.
The web regression renders both translated diff shapes and checks that only the matching action is shown.
Why it matters: A client cannot show which request a changed file belongs to.

## 323. A Herdr pane starts from Herdr's environment, not the engine's

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: A Herdr pane's command starts from Herdr's environment and not the engine's, so `SHEPHRD_WEB_PASSWORD` could reach it (client API row 188, TM-PB-6).
What should happen: The interactive mode plan clears `SHEPHRD_WEB_PASSWORD` in a pane's command.
Why it matters: An agent in a pane could read the owner's web password.

## 324. The engine design still names paired devices and device credentials

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: `docs/specs/2026-11-01-engine-design.md` still names paired devices and device credentials.
What should happen: Client API rows 184 and 189 replace those parts, so the design's text should be brought up to date.
Why it matters: A reader of the design would build a pairing that was dropped.

## 325. A board question's author looks settled to the engine

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: An agent that posts a question needing a reply, then ends its turn, counts as settled in `routing/waits.ts:settled`, so a `wait` on it ends early.
What should happen: Not decided.
Why it matters: A parent's wait ends before the question is answered.

## 326. Board posts cannot be deleted or purged

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: A post's text stays in `board.PostWritten`, in every wake's `DeliveryQueued`, in the engine's `PromptSent`, in client caches and in harness session files. Command receipts copy every committed envelope, including post text and wake bodies. The log is append-only. A purge path is not planned (board review round 1, threat m3, and round 2, R2-TM-4).
What should happen: Not decided. Any purge path must also cover the receipts table.
Why it matters: A secret posted by mistake cannot be removed.

## 327. No rule makes every piece size its events against the listener's limit

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: The network listener's 1 mebibyte message limit bounds piece events and read pages. The board caps a wake body at 256 kibibytes and a read page at 512 kibibytes, but nothing makes every piece do the same (board review round 1, threat M5).
What should happen: Not decided.
Why it matters: A piece event over the limit could not be sent.

## 328. Channels are not a confidentiality boundary

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: Every agent runs as the owner's Unix user and can read the event log on disk, so any agent can read every channel's posts. SECURITY.md accepts this for now (board review round 1, threat m2).
What should happen: Not decided. Accepted for now.
Why it matters: A private channel is not private from other agents.

## 329. The engine checks the permission ceiling at `start` but not at `prompt`

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: The engine's design states the rule for `prompt` too (`commands/prompt.ts`, `identity/ceiling.ts`) (board review round 2, logic m7).
What should happen: The ceiling is checked at `prompt` as the design states.
Why it matters: A prompt could ask for more than the ceiling allows.

## 330. The agents view keeps only an agent's current mode

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: `ModeChanged` overwrites the start ceiling, which survives only in `AgentStarted`. A piece that needs the ceiling must keep it itself (board review round 2, threat S2).
What should happen: Not decided.
Why it matters: Each piece that needs the ceiling must repeat the bookkeeping.

## 331. The board's view keeps every post's text in memory

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: Posts cannot be deleted, so the service's memory grows with board history (board review round 2, threat S1).
What should happen: Not decided.
Why it matters: A long-running service uses more memory without bound.

## 332. Recovery leaves an interrupted agent with a session that cannot reload, and writes no event

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: A follower of the board must apply the `waits.ts` test itself (board review round 2, R2-A3).
What should happen: Not decided.
Why it matters: Each follower may judge the same agent differently.

## 333. A hang in the middle of a turn is not caught by the board

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: A hang in the middle of a turn ends no turn, so the board's reminder for an unanswered question never fires. A turn's end sends one reminder, and the next marks the agent `no-answer` and tells the asker once (board contract v15, rows 153 and 156). Only the roles plan's sheepdog catches a hang, at its two-hour runaway limit (board review round 3, logic M4, threat T3-6).
What should happen: Not decided. The owner accepted this as a stated limit on 2026-11-03.
Why it matters: The asker waits up to two hours for an agent that has hung.

## 334. Open questions that the owner writes have no per-author cap

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: The 64-question cap applies to agents only.
What should happen: Not decided.
Why it matters: The owner could fill the board with open questions.

## 335. The dispatcher waited after a send-time withdrawal

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: The dispatcher waited instead of going on to the agent's next queued delivery (board review round 3, logic m4).
What should happen: The client API contract's item 15 requires it to go on (ruling L23, `ced973b`), so the engine must be changed to match.
Why it matters: An agent's queue stalls behind a delivery that was withdrawn.

## 336. A refused duty is retried after every later batch that touches it

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: With the board's reactor written as level rules, a duty the engine keeps refusing is retried after each later batch that touches it, and each retry writes one `CommandRefused`.
What should happen: Not decided.
Why it matters: A defect that makes a reactor batch always fail would grow the log by one event per touching batch.

## 337. The dispatcher wrote a send-time withdrawal without its wait checks

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: A parent's wait on an idle target could stay open (board review round 4, logic m7).
What should happen: Client API v5 edit E18 requires the wait checks (lead ruling L30).
Why it matters: A parent waits for a target that will never answer.

## 338. Alerts for matters that exist before the alert reactor's first start are never raised

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: The alert reactor raises `baseline` alerts at its first start by a level scan over the current views, but a piece's alert source is a pure function of one envelope and offers no scan. An open board post that needs the owner's reply, if it exists before that first start, never gets an alert. This matters only if the board lands before the alert reactor (client API unit 6a).
What should happen: Not decided.
Why it matters: The owner would not be alerted to a question that was already waiting.

## 339. A very full board wake is larger than 256 kibibytes in the log

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: A `DeliveryQueued` and a `PromptSent` can exceed 256 kibibytes, because the engine's envelope and the event's fields are added to a 256 kibibyte body. In `client.subscribe` they become `client.Oversized` markers, so the owner's phone must tap to see them.
What should happen: Accepted (board row 127). Recorded so it does not look like a bug.
Why it matters: Without this note the oversized markers look like a defect.

## 340. A piece's ids are treated as text by the redactor unless the piece adds table entries

Found: 2026-11-03, while planning the message board plan.
State: open.

What happens: The engine's redactor at `9e386b0` has fixed structure tables (`log/redactionStructure.ts`) that name each id field. The client API contract v12 has no edit or table for a piece's ids.
What should happen: The board adds its entries as B13. The roles and client API plans must do the same.
Why it matters: A piece that forgets gets its ids redacted as text.

## 341. A "model at capacity" error is returned to the sender as a failed delivery

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: A "model at capacity" or "529 overloaded" error is returned to the sender as a failed delivery (`packages/engine/src/runner/classify.ts:classifyError`, `routing/deliveries.ts:failed`), which wakes the parent with a prompt for each error.
What should happen: Decision row 11, WS-7b, holds the delivery and releases it later.
Why it matters: A capacity outage wakes parents again and again.

## 342. No event records an agent's token or prompt-cache usage

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: `runner/translate.ts` ignores every session update except message chunks, plan and tool calls.
What should happen: Decision row 11, WS-7c, records usage.
Why it matters: Compaction cannot be timed for Codex or other harnesses.

## 343. A standing rule answered from outside the engine arrives after the request was delivered

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: The request has already been delivered to an idle holder, so the holder still pays a wake.
What should happen: Decision row 11, WS-7a, answers it inside the engine.
Why it matters: Each such request costs a full agent turn.

## 344. The runner drops the tool `kind` and the permission request's own `rawInput`

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: `packages/engine/src/runner/translate.ts:37-41` and `packages/engine/src/runner/AcpRunner.ts:400-416` drop them, so nothing in the log says which tool asked for a permission or exactly what it will run.
What should happen: The roles plan's WS-7a proposes optional fields (row 53).
Why it matters: A standing rule cannot match a request precisely.

## 345. Resuming a crashed agent queues no carry-on for an unfinished delivery

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: A delivery the agent had accepted but not finished gets no carry-on (`packages/engine/src/commands/resume.ts:48`, `packages/engine/src/recovery/reload.ts:80-98`), so a reloaded agent sits idle.
What should happen: The roles' crash rule sends its own carry-on prompt (row 42).
Why it matters: The resumed agent does nothing until someone prompts it.

## 346. The board marks a capacity-returned wake undeliverable within seconds

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: The board retries a returned wake once at once and then marks the addressee `undeliverable`, so a model-capacity outage ends a board addressee's part of a post within seconds.
What should happen: The engine holds capacity errors (roles WS-7b). The board's planner should consider skipping the immediate retry for a capacity return.
Why it matters: A short outage permanently fails board wakes.

## 347. The recorded fixtures hold no tool call and no permission request

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: `packages/testing/fixtures/claude.ndjson` and `codex.ndjson` hold neither, so no test can pin a harness's shell-permission shape from them.
What should happen: The roles plan adds a recording task (2g).
Why it matters: A permission matcher cannot be tested against real traffic.

## 348. The runner-event batch is appended with the caller `owner`

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: `packages/engine/src/commands/CommandHandler.ts:148` appends it as `owner`, and any failure in it drops the whole batch (lines 174 to 176). Anything an automatic answer writes there would be recorded as the owner's.
What should happen: Not decided.
Why it matters: The log would show an automatic answer as the owner's own.

## 349. `TurnStarted` is declared but never written

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: `TurnStarted` is declared in `packages/contracts/src/events.ts` (line 116) and nothing writes it.
What should happen: Not decided.
Why it matters: A reader that expects the event gets nothing.

## 350. A `ThreadItem`'s tool input has no stated maximum

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: A single huge tool call makes a large event.
What should happen: Not decided.
Why it matters: One tool call can exceed a message budget.

## 351. The ceiling's path resolver is synchronous

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: `packages/engine/src/identity/ceiling.ts` uses `lstatSync`, so resolution on a slow or network file system blocks the event loop for every agent.
What should happen: Not decided.
Why it matters: One slow file system stalls all agents.

## 352. One shared stream fiber carries every agent's runner events, and `answerPermission` is awaited inside it

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: `packages/engine/src/commands/CommandHandler.ts:177` awaits `answerPermission` inside the shared fiber, so one slow adapter answer stalls the runner events of all agents.
What should happen: Not decided.
Why it matters: One slow agent delays every other agent.

## 353. `isHarnessSettings` treats every path under a harness folder as a settings path

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: `isHarnessSettings` at `packages/engine/src/identity/ceiling.ts:317-322` treats every path under a `.claude/`, `.codex/`, `.gemini/` or `.cursor/` folder as a settings path, without regard to case. Every file edit in a worktree under `.claude/worktrees/` goes to the owner (roles row 85).
What should happen: Narrowing the test to the settings files and folders inside a harness folder would fix it, but it relaxes a protection, so it is the owner's decision. Foundry worktrees move to `<repo>/.worktrees/`, which avoids the problem.
Why it matters: Every file edit by an agent in a Foundry worktree waits for the owner.

## 354. `git clean -ffdX` at a repository root would remove all of `.worktrees/`

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: A dry run showed that `git clean -ffdX` at a repository root would remove all of `.worktrees/`, unmerged work included. The ignore line does not protect against it.
What should happen: Not decided. For the worktree plan.
Why it matters: Unmerged work in worktrees could be lost with one command.

## 355. A new worktree starts from the last commit, so uncommitted changes do not reach a child

Found: 2026-11-03, while planning the foundry roles plan.
State: open.

What happens: A lead's uncommitted changes do not reach a child's new worktree (tested).
What should happen: Not decided. For the worktree plan.
Why it matters: A child starts from older files than the lead sees.

## 356. The recorder fake-agent test failed at the base commit in one environment

Found: 2026-11-04, by the builder or test writer of unit r3p, during the foundation build.
State: open, for the final review.

What happens: The existing recorder fake-agent test failed during initialization at the base commit in this environment. The new tests use a synchronous transport double and do not repair that separate failure.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

## 357. The source boundary check for tables is not a full data-flow analysis

Found: 2026-11-04, by the builder or test writer of unit a1a, during the foundation build.
State: open, for the final review.

What happens: The source boundary check masks guarded closures and recognizes direct indexed calls into the named tables. It is a supplemental guard, not a complete alias/data-flow analysis. Runtime throwing-reducer and snapshot cases supply independent behavior checks for the 1a tables.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

## 358. Criterion 2.3 says every reply carries a request identifier, but stream markers carry none

Found: 2026-11-04, by the builder or test writer of unit a2, during the foundation build.
State: open, for the final review.

What happens: Criterion 2.3 says every reply carries a nonempty request identifier, but the specified checkpoint and oversized stream markers do not carry one. The tests require it on every command payload, unary reply and error, and do not add it to stream elements.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

## 359. The contract names no largest alert event or alert-list page

Found: 2026-11-04, by the builder or test writer of unit a2, during the foundation build.
State: open, for the final review.

What happens: The contract does not state a concrete largest client alert event or alert-list page. The size tests cover the board’s encoded wake, its whole-event page, and the stated future board and roles event payload budgets. Complete maximum-page fixtures must be supplied when those pieces install their contracts.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

## 360. Concurrent service startup timed out once in the merge gate

Found: 2026-11-04, by the builder or test writer of unit r1, during the foundation build.
State: open, for the final review.

What happens: The first full merge gate observed an intermittent concurrent-service startup timeout. The unchanged focused rerun and complete gate rerun both passed. The cause has not been established.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

## 361. A harness test rejects any adapter path containing `npx`, including random temporary folders

Found: 2026-11-04, by the builder or test writer of unit b1, during the foundation build.
State: open, for the final review.

What happens: `packages/engine/test/runner/harnesses.test.ts:82` rejects any adapter path containing the substring `npx`, including its random temporary directory. The whole gate generated `/tmp/shephrd-harnesses-bQtnpx/`, causing a false positive. The isolated case passed on rerun. The lead should narrow the assertion to the executable or invocation.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

## 362. The board plan's engine-change table still says seven tools and eight events

Found: 2026-11-04, by the builder or test writer of unit b1, during the foundation build.
State: open, for the final review.

What happens: The engine-change table's B1 and B2 prose still says seven board tools and eight board events. The current WS-1 criteria and v15 contract require eight agent tools and nine events, including acknowledgement and no-answer behavior. The tests follow the current criteria.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

## 363. An agent named `owner` shares its reader records with the human owner

Found: 2026-11-04, by the builder or test writer of unit b2a, during the foundation build.
State: open, for the final review.

What happens: AgentId accepts the literal owner, but the required raw-agent-id-or-owner convention aliases that agent with the human owner in readState, dispositions, takenAt, and other reader-keyed records. A synthetic owner read advanced the position stored for an agent with id owner. The lead should settle whether to reserve that id or change the shared reader-key convention before building the consumers. This unit follows the frozen tests' stated convention and does not change contracts outside its scope.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

## 364. A web-down alert can be missed when the outage is disabled at once

Found: 2026-11-04, by the builder or test writer of unit a5, during the foundation build.
State: open, for the final review.

What happens: The focused run intermittently observed no web-down alert when an outage was disabled immediately after its source event appeared. The unchanged isolated file and the full check both passed afterward. A timing race is suspected: the existing alert reactor evaluates a source against the current snapshot, so a rapid settings change can make that source already closed when consumed. This continuation did not change the reactor or the frozen assertion. The collector should retain this observation when assessing intermittent failures.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

## 365. An action record larger than the page budget cannot be read through `roles.actions.list`

Found: 2026-11-04, by the builder or test writer of unit r2, during the foundation build.
State: open, for the final review.

What happens: The existing action-event schema permits an individual encoded record larger than the action page budget. The history read refuses an oversized singleton instead of sending an oversized page. Such a record cannot be reconstructed through `roles.actions.list` until the writer or schema bounds it, or a large-record retrieval path exists. The 266 focused tests pass with ordinary records, including the 500-record size fixture. This limitation is separate from A07's overlarge requested limit, which is fixed.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

## 366. The transcript fallback schedules nothing for a long Claude project folder

Found: 2026-11-04, by the builder or test writer of unit r9, during the foundation build.
State: open, for the final review.

What happens: The transcript fallback refuses a Claude project-folder key longer than 200 characters, because Claude Code hashes such keys in its own way. Shephrd then schedules nothing rather than guess a path. An agent in such a folder gets no cache timing from this fallback.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

## 367. The board restart acceptance case failed once in a full check

Found: 2026-11-04, by the builder or test writer of unit r12, during the foundation build.
State: open, for the final review.

What happens: The first full `pnpm check` for unit r12 failed the board restart's sent-wake case, because no reminder wake was present. All three cases passed in an isolated rerun, and the next full check passed with no source change. Unit b5 had already repaired a startup race in this area, at an earlier commit, so that repair did not remove every timing dependency.
Why it matters: An intermittent failure can block a merge, and it may hide a real readiness or scheduling fault. It waits for the final review.

## 368. A lead can be reported stalled while its workers work

Found: 2026-11-04, by the builder or test writer of unit r13, during the foundation build.
State: open, for the final review.

What happens: The roles plan's owed-reply exception in section WS-4 lets an idle orchestrator's assignment stall its lead while that lead's workers work, when the orchestrator reaches no busy work outside that lead. Section WS-8 says without qualification that the lead is not reported stalled while its workers work. The acceptance fixture tests the owner-authored case, and production behaviour was left as it is.
Why it matters: The two plan sections disagree, so the final review should decide which one holds.

## 369. The live-check scripts depend on the order of their imports

Found: 2026-11-04, by the builder or test writer of unit r14, during the foundation build.
State: open, for the final review.

What happens: Importing the existing live driver before the existing live runner causes a circular module initialization error for `pieceViews` under plain Node.js. The new script `packages/engine/scripts/live-check-roles.ts` imports the runner first, as `live-check.ts` does, and its help and dry-run checks pass. The cycle itself is still there.
Why it matters: A reordered import would stop both owner-run checks from starting. It waits for the final review.

## 370. Two browser assertions reject supported thread navigation

Found: 2026-11-04, while repairing foundation review records FR-086 and FR-092.
State: fixed.

What happened: The administration browser test expected `/threads/phone-worker`, but the production link uses `/#/thread/phone-worker`. The phone browser test required a Hypertext Transfer Protocol (HTTP) 200 response from a hash-only navigation. Playwright returns no response for that navigation. Both assertions stopped the later behavior checks.

What changed: The administration test pins the supported hash link, follows it, and reads the question before continuing through every settings check. The phone test checks the exact alert route and retained document. It checks the permission answer, the runner's agent and option, and output emitted only after approval. Reloading the thread independently reads back the committed answer and agent output. Only that fresh-document reload requires HTTP 200. Existing width and browser-storage checks remain in place.

Why it matters: These tests now reach their administration and permission-flow assertions. Temporary production mutations verify that a wrong administration link and missing navigation handlers are rejected. The separate Hypertext Transfer Protocol Secure (HTTPS) fixture update belongs to the public-address repair in FR-001. The overflow mutation proof in FR-048 remains a Phase 2 item.

## 371. The terminal permission context omits correlated file changes

Found: 2026-11-04, while repairing foundation review record FR-005.
State: fixed on `fix/foundation-005`, pending independent verification.

What happened: `packages/viewer/src/actions.ts` accepted only tool-call content when a permission request had no input. It omitted file-change content even when the content carried the request's tool-call identity. The upstream identity repair in issue 322 could not repair this independent filter.

What changed: The terminal helper includes file changes whose `content.callId` matches the request's `toolCallId`. It keeps the request read first, the thread's page and item order, and the existing warnings for missing, redacted or truncated input. It never joins a diff by its path or thread-item identity.

Validation: `packages/viewer/test/request-file-change.test.ts` covers a locations-only request, matching diffs across pages, a diff as the only input, and unrelated and uncorrelated diffs. It also checks that partial-input warnings remain visible. The matching-diff regression failed against the unfixed helper before the filter changed.

Why it matters: The owner can review a correlated edit before answering its permission request in the terminal viewer.
