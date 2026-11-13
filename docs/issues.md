# LGTM Studio: problems found

A running list of problems found while building or using LGTM Studio. Add a
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
State: fixed in unit 2: `bin/lgtm` follows links, and
`launcher-links.test.ts` covers it. Commit: 87e2d4c. The first fix used
`readlink` from `PATH`; issue 20 replaced that.

What happened: `bin/lgtm` found its checkout with `dirname "$0"` and does
not follow a symbolic link to the file itself. A link such as
`~/.local/bin/lgtm -> <repo>/bin/lgtm` makes it look for
`bin/stub-entry.ts` next to the link, and Node.js exits 1 with
`Cannot find module`.
What should happen: the launcher resolves its own path through any links,
or prints a clear message when the entry file is missing.
Why it matters: a link on the path is a likely way for the owner to run
`lgtm` from any terminal.

## 8. The launcher looks up `dirname` on the path

Found: 2026-11-01, in the unit 1 review.
State: fixed in unit 2: the launcher uses `${self%/*}` instead of `dirname`.
Commit: 87e2d4c. The first fix still ran `readlink` from `PATH` before the
chosen Node.js, which the focused review found; issue 20 fixed that, so now
only shell builtins and the chosen Node.js run.

What happened: `bin/lgtm` ran `dirname` from `PATH`. Decision 22 allows
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
`VP_REMOTE_CACHE_URL`, which only the vite-plus tool reads; LGTM Studio runs
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
LGTM Studio"`, but Herdr names an action's label `title`, as the Synapse
manifest does. Neither the plan's task 1f nor the unit 1 manifest test named
the field, so the test passed.
What should happen: each `[[actions]]` entry has `id`, `title`, `contexts`
and `command`.
Why it matters: Herdr cannot load LGTM Studio at all until the manifest parses.

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
LGTM Studio registers any extension handler, and a test greps its output for
planted secrets, as decision 57 requires. LGTM Studio never sets `logIncoming`,
`logOutgoing` or `logger` outside tests.
Rule for the units that run ACP (6a, 6d and 7a): install the redacting service
logger before constructing any ACP runner or handler. Keep wire logging off,
except behind the temporary-home test gate of decision 74. Test planted secrets
through four paths: the core path, notification handlers, extension-handler
defects, and encoding failures.
Why it matters: until then, a handler defect could write a secret to the log.
No LGTM Studio code registers a handler yet, so nothing leaks today.

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
What should happen: LGTM Studio always passes an explicit base environment, so an
agent gets exactly `LGTM_SOCKET` and `LGTM_TOKEN` and what the harness
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

## 16. The ACP schema generator cannot finish in LGTM Studio

Found: 2026-11-01, in the unit 2 security read.
State: open; low priority.

What happens: `effect-acp/scripts/generate.ts` downloads schema files from
GitHub and ends by running `pnpm exec vp fmt`. The `vp` program belongs to the
vite-plus tool, which LGTM Studio does not install, so the last step fails after
the files are written.
What should happen: if LGTM Studio regenerates the schemas, the formatting step is
replaced by an LGTM Studio tool, and the change is recorded in the README table.
Why it matters: someone running `generate` gets a confusing failure.

## 17. T3 Code has no unit test for the replay helpers

Found: 2026-11-01, in unit 2.
State: fixed; recorded in `third_party/t3code/README.md`.

What happened: criterion 2.4 needs a test named `replayTranscript.test.ts`, but
T3 Code has none for `provider-testing`. A test was written for LGTM Studio, with
a fixture, and the README table marks both as written for LGTM Studio.
What should happen: nothing further.
Why it matters: the copied helpers would otherwise have no test at all.

## 18. The first-party packages did not depend on the copied packages

Found: 2026-11-01, in the focused review of unit 2.
State: fixed in the commit "fix(unit-2): link the copies, harden the checker and launcher" (unit 2 fix round 1); `copied-package-edges.test.ts` covers it.

What happened: after a frozen install, `import.meta.resolve` failed with
`ERR_MODULE_NOT_FOUND` from `packages/engine` and `packages/testing` for the
copied packages. Decision rows 23 and 71 require these edges before the
manifests freeze.
What should happen: `engine` depends on `@lgtm/t3-effect-acp`,
`@lgtm/t3-node-sqlite` and `@lgtm/t3-provider-instance`. `testing`
depends on `@lgtm/t3-effect-acp` and `@lgtm/t3-provider-testing`, all as
`workspace:*`. Nothing depends on `@lgtm/t3-source-control`, which has no
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
`lgtm` when this was found (the product is now called LGTM Studio, whose
seven-letter package name is below the limit, but the same over-scrubbing
applies to any longer value), so ordinary text such as a source note naming
`lgtm-engine` becomes `<redacted>-engine`. The re-recorded
`errors/cursor-out-of-usage.json` was over-scrubbed this way, so the earlier
committed copy was kept.
What should happen: the scrubber redacts the values of account variables and
of names that can hold secrets, and leaves well-known values that are not
secret, such as the package name, version and script name.
Why it matters: over-scrubbing is the safe direction, but it corrupts the
fixtures' text and can hide real differences between recordings.

Rechecked: 2026-11-02, against the live-check recordings from engine 71d13c1.
The refreshed first and second harness recordings both keep
`lgtm-recorder`, and neither has an over-redacted ordinary word.
The second recording's `msg_<redacted>` is a scrubbed message identifier.
The cause remains in `packages/engine/scripts/recorder.ts`, line 26:
`scrubText` still adds every environment value of eight or more characters
to its replacement list, without checking the variable name.
Calling it with `npm_package_name: "lgtm"` changes `lgtm-recorder`
to `<redacted>-recorder`; using `npm_package_name: "lgtm"` leaves
`lgtm-recorder` intact.
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
text with a normal stop reason, so LGTM Studio cannot tell it from a reply by the
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
State: the receipt policy is retained. The board reply retry defect is fixed in foundation finding FR-006 on 2026-11-04.

What happens: when the state table or the rights check refuses a command, the handler stores the refusal as the receipt for that caller and request id (`packages/engine/src/commands/CommandHandler.ts`, the refusal branch of `execute`). A retry with the same request id after the agent's state has changed returns the old "command refused".
Why it matters: row 30 names only "no usable account" and "database busy" as temporary refusals that write no receipt. A state refusal also depends on state, so a client that retries with the same request id never sees the new outcome.
What changed: the owner-approved foundation fix scope keeps a definite refusal final for that attempt. The web board reply form preserves the draft and ends the attempt when it receives the server's `CommandError`. The owner's next send gets a fresh request identifier, so restored membership is checked again. An uncertain transport or connection outcome keeps the same identifier for unchanged text. A confirmed write is never resent after a failed refresh.

Verification: `packages/web/test/subjects/board-handler-recovery.test.tsx` exercises the real planner, SQLite receipts and views through the reply form. It removes and restores the original author's channel membership, proves that the old identifier still replays the refusal, and sends the unchanged draft successfully with a fresh identifier. It also loses a response after commit, as both a typed transport failure and a connection exception, and proves that an unchanged retry creates only one stored reply. The board contract and criterion 7.3 now state this retry policy.

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
State: Crash permission cancellation is fixed in unit 6c. Stop permission cancellation is fixed in foundation unit 1b and verified by the composed client regression on 2026-11-05. The historical recovery and question decisions are recorded below and in issue 113.

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
The stop closure was deferred under this issue at that time.

Update on 2026-11-05: The stop command now cancels the asker's permissions and withdraws their queued notices. The foundation regression verifies simultaneous asking and holding, transfer of a grandchild's duty, stop and resume, a real owner wait after new work, and the release of the prior holder's queue. Questions intentionally remain open. Issue 313 records the same stop cause.

## 75. The wait contract has no owner waiter

Found: 2026-11-01, while building unit 5d.
State: closed by the owner's decision on 2026-11-03.

What happens: `WaitOpened` requires the waiter's agent identifier, and `Delivery.target` must be an agent. The engine therefore refuses a `wait` from the owner with "command refused".
Why it mattered: the original decision row 26 gave the owner's terminal `lgtm wait --block`. `AGENTS.md` rule 5 requires that what the owner can do from the terminal is also possible through the API.
The original proposal was for the contracts to give a wait an owner waiter, at least for blocking waits, which create no delivery.

Closing decision: row 26 of `.plans/plans/lgtm-engine/decisions.md`,
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

Found again: 2026-11-04, in foundation review record FR-016. A capacity
release can resend an unaccepted delivery with the same identifier before
the previous attempt's end is consumed. The identifier check alone then
ends the retry and clears the capacity outage count.

What the foundation fix changed: `Runner.prompt` and `Runner.compact` take
the sequence of the reserved `DeliverySent` event. The runner retains that
sequence for the turn and includes it as `sentSequence` on `turnEnded`.
The delivery planner requires both the delivery identifier and the send
sequence to match the current turn. The stored event format is unchanged.
The regression in `packages/engine/test/runner/capacity-attempt-end.test.ts`
delivers an old end after owner and holder releases, before and after the
retry is accepted. It checks that the retry keeps working, its outage count
stays one, and a waiting parent wakes only after the retry's own completion.

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

## 125. Fix-round test F1 assumed a sign-out pauses only the agent that reports it

Found: 2026-11-01, by engine-u6bb, running the full suite for unit 6b.
State: fixed in unit 6b by engine-lead's ruling.

What happens: `routing/fix-round-one.test.ts` F1 "inherited grandchild" paused a child with the reason `signed-out` and then expected its idle caller, on the same account, to still run `wait`. Rows 28 and 53, and the frozen 6b test T1, make a sign-out pause every agent on the account, so the caller was paused and its `wait` was refused.
What should happen: the test pauses the child with `out-of-usage` and no reset time, which pauses only that child and keeps the intent of the test (a wait on a paused member).
Why it matters: two frozen tests disagreed, and the suite could not pass until one changed.

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

## 160. The fake agent's LGTM Studio command step does not speak the engine's protocol

Found: 2026-11-01, while writing the unit 7a tests.
State: fixed in unit 7b: the step uses the real `@lgtm/client`.

What happens: the `lgtm_command` step in `packages/testing/src/fakeAgent.ts`
opens a WebSocket to `LGTM_SOCKET` and sends `{ command, input }` as JSON.
That is not an Effect RPC request, and the step reports
`lgtm_command:ok` on any reply at all, an error reply included.
What should happen: the step sends a real RPC request through unit 7b's
client and reports the reply's outcome.
Why it matters: a test that trusts `lgtm_command:ok` would pass while the
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
asks the `lgtm_command` step to call `post`, which is absent from the
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

## 181. Foreground `lgtm serve` is not supported

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
build `LGTM-Ancestors`, and the engine's check had a macOS reader that the
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

## 184. `lgtm mcp` discards its own logs

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

Found: 2026-11-01, during the rename to LGTM Studio.
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

## 191. Planning records outside the rename's edit list still used an earlier name

Found: 2026-11-01, during the rename to LGTM Studio.
State: fixed in commit 7887d87 (the twelve prose lines now say LGTM Studio; slugs and
paths are kept).

What happens: `.plans/epics/lgtm-foundation/epic.md`, `.plans/roadmap.md`
and the three `.plans/scopes/engine/*/scope.json` files (their `summary` and
`why` text) still used an earlier product name, because the rename task did not
cover them. The plan folder path and the epic names are kept on purpose, so
links do not break.
What should happen: the text in those files uses LGTM Studio; their file paths and
topic names stay.
Why it matters: scope summaries are loaded into every worker's instructions,
so they will keep teaching the old name.

## 192. The fixture scrubber no longer hits the package name, and the old note is stale

Found: 2026-11-01, during the rename to LGTM Studio.
State: open.

What happens: issue 37 was found because pnpm's `npm_package_name` was
the earlier package name, eight characters long, and the scrubber removed it.
The renamed package had seven characters, so the scrubber left it alone, and
the committed `errors/cursor-out-of-usage.json` keeps its source note
naming the plan folder `lgtm-engine`. The rule in issue 37 (redact only
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

The foundation review also identified board-specific proof gaps in records
FR-047, FR-062, FR-063, FR-072, FR-076, FR-101, FR-112, and FR-122.
The collection and restart scenarios now correlate board manifests with
delivery identifiers and count through an independent completed prompt.
The acknowledgement matrix uses actual questions, returned deliveries,
capacity holds, and both wait modes.
The recovered withdrawal matrix invokes the dispatcher, reactor, and answer
command, and checks the order within each committed batch.
The error matrix sends authenticated current-incarnation events through the
runner handler and reopens the database after each error.
The deferral matrix covers both stages and runs a mutual-question control
with the stall watch active.
The alert matrix covers reverse resolution order, a fresh baseline from
rebuilt state, and an owner wait whose status and stream are offset.
The recovery matrices cover complete committed checkpoints, actual service
kills, repeated reactor runs, and later replies and lifecycle changes.
These checks live in `packages/engine/test/board/` and
`packages/engine/test/acceptance/board-*.test.ts`.
They do not close the other omissions listed below.

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
`/tmp/lgtm-live-*` folder before and after its child runs.
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
`.plans/plans/lgtm-engine/scouting.md`, line 89, names only
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

## 236. A Codex agent's call to an LGTM Studio tool is cancelled before LGTM Studio sees it

Found: 2026-11-03, by the live check at 9340f71 (live-check-2, run 1, step
`sandbox-mcp`, criterion PB-A3), against the real Codex adapter
(`@agentclientprotocol/codex-acp` 2.5.0, `@openai/codex` 0.165.0).
State: fixed locally by owner option (b), in commit
`7c2039ff9c31b986675d8793f75dc6304802fc24`.
Real-adapter validation remains pending the lead's next run.

What happens: the Codex worker, started with the permission "ask", was told
to call the LGTM Studio MCP (Model Context Protocol) tool `ask` once. It did call
`mcp.lgtm.ask` with the right arguments (event 112), but the call failed
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
"cancel" itself. LGTM Studio's runner initializes every adapter with
`clientCapabilities: {}` (`packages/engine/src/runner/AcpRunner.ts:510`), so
the approval is cancelled inside the adapter. The exact elicitation was not
captured, because the protocol log was off for this run.
Why it matters: a Codex agent that asks before changes may be unable to use
any LGTM Studio tool (ask, post, wait and the others) unless Codex skips approval
for it. A Codex worker then cannot report back or ask its lead through
LGTM Studio, and the live check's PB-A3 row for Codex fails.
The owner chose option (b) on 2026-11-03. The original options were:
- Advertise form elicitation in the runner and route a tool-approval
  elicitation through LGTM Studio's permission flow, like any other permission
  request. This changes the runner and may need a contract for the answer.
- Or start Codex with LGTM Studio's own MCP server marked as not needing approval.
  This is smaller, but it removes a prompt, so it is a permission decision for
  the owner.
Evidence: `.scratch/foundry-runs/engine-build-1/live-check-2/live-check-run1.log`
and `run1-sandbox-mcp-events.txt` beside it.

The runner now configures only the Codex LGTM Studio server with
`default_tools_approval_mode: "approve"` through the adapter's `CODEX_CONFIG`.
It passes an empty ACP server list for start, load and resume, because the
adapter replaces the configured server map when that list is populated.
The configuration names `LGTM_SOCKET` and `LGTM_TOKEN` in `env_vars`;
it contains neither variable's value. Other account keys and servers retain
their settings. Invalid account JSON and a pre-existing LGTM Studio server refuse
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
The fake-agent tests in `runner/lgtm-server.test.ts` cover all three
session methods, preservation, refusal before spawning and unchanged Claude
behavior. The actual adapter and server journey awaits the lead's run.

## 237. Approval-gated tool servers need form elicitation routed through LGTM Studio

Found: 2026-11-03, while the owner decided issue 236.

Status: open. This is option (a), reserved as a follow-up by the owner.

The runner advertises no form elicitation capability. A Codex adapter can
therefore cancel a tool-approval elicitation before LGTM Studio sees a permission
request. Issue 236 configures LGTM Studio's own server to need no such approval,
but other tool servers retain their approval settings.

Advertise form elicitation and route a tool-approval elicitation through
LGTM Studio's permission flow. This is needed once agents use other tool servers
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

The runner gives every adapter except Codex the LGTM Studio tool server through
the Agent Client Protocol (ACP) `mcpServers` list, with the agent's token as
the value of the `LGTM_TOKEN` environment entry
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
The run's folder is kept at `/tmp/lgtm-live-Twd6bJ`.

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
toolu_01H5T2W8rk4qpNBxZNMddW4r. The command removes LGTM_SOCKET and
LGTM_TOKEN with env -u, sets LGTM_HOME to the run's state folder and
starts the real command-line interface's accounts list command. Its actual
tool result, line 102 of the lead's session file, contains the accounts list
and LCP_EXIT=0. The engine's thread lost that output, as recorded in issue 242.

This is owner access, rather than the required HTTP 403 ancestry refusal.
The guard in packages/engine/src/api/ancestry.ts did not prevent this real
adapter shell's request. The exact reason it missed the caller's ancestry
remains to be established. Passing fake-adapter tests do not refute this
observed real-adapter result.

Evidence: /tmp/lgtm-live-Twd6bJ/state/events.sqlite, opened read-only, and
/home/qnlbnsl/.claude/projects/-tmp-lgtm-live-Twd6bJ-work/e04b371b-45ed-4430-a3a0-483cbb74acd7.jsonl,
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
LCP_ENV_BEGIN and LCP_ENV_END listing. Neither LGTM_SOCKET nor
LGTM_TOKEN appears in it. Core inheritance did remove both names. The
probe printed absent=false because issue 242 hid the output, rather than
because either name was observed. The probe now distinguishes an unobserved
listing from observed absent or present names, without weakening its gate.

The actual command-line interface printed `lgtm: the folder /tmp above
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
`{"query":"select:mcp__lgtm__ask","max_results":1}`. Its result named only
mcp__lgtm__ask. It then called that tool with the exact marker and wrote
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

Evidence: `.scratch/foundry-runs/engine-build-1/review-post-build/results/lgtm-engine-s08.md` (not tracked), F-2, confirms the path by source
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

Evidence: `.scratch/foundry-runs/engine-build-1/review-post-build/results/lgtm-engine-s13.md` (not tracked), F-3, confirms the path by source
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

`packages/engine/src/runner/harnesses.ts:60` maps LGTM Studio's `ask` level to
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
LGTM Studio variables before it asks for account data.
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

What happens: The root `pnpm -r test` passes without checking anything (client API row 111). The engine package has only a `typecheck` script, so `pnpm --filter @lgtm/engine test` also runs nothing. Tests run only through the root `vitest run`.
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

What happens: The default access on an ntfy server can leave topics open, and LGTM Studio cannot check the owner's server (client API row 115). The setup document advises deny-all.
What should happen: The owner sets deny-all on the ntfy server, as the setup document advises.
Why it matters: Anyone who learns a topic name could read the owner's alerts or send false ones.

## 312. The `accounts` read and `AccountChanged` carry environment values as entered

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: A plain value under a name that does not look like a secret reaches every client and the log (`contracts/src/accounts.ts:9-16`, client API row 141).
What should happen: Not decided.
Why it matters: A secret stored under an ordinary name would be written to the log and shown to clients.

## 313. A permission request's row stayed open after `stop`

Found: 2026-11-03, while planning the client application programming interface (API).
State: fixed by the stop command and verified by the foundation client regressions on 2026-11-05.

What happened: A stopped asker's permission could remain open for its obsolete process.

What changed: The stop command cancels the asker's permissions and withdraws their queued notices. It transfers duties held for other askers. Questions remain open. The composed regression stops and resumes an asker that also holds a grandchild's permission. It isolates the preserved question, completes a real owner wait after new work, and positively drains the prior holder's queue before checking that obsolete notices were never sent. The original stop-batch and parent-wait assertions remain covered.

Why it matters: A resumed session does not inherit a permission that only its old process could answer.

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
State: fixed in the central withdrawal guard, with producer integration verified on 2026-11-05.

What happens: A withdrawal for an answered question can leave a reloaded holder marked as working with nothing to send (`routing/questions.ts:27`, `recovery/reload.ts:84-98`).
What should happen: Unit 1b fixes it through edit E17 (client API row 173).
Why it matters: The agent never takes new work and the team stalls.

The central withdrawal repair is now exercised through the real answer
command, dispatcher, and board reactor in
`packages/engine/test/board/recovered-withdrawals.test.ts`.
Each case reconstructs the reloaded state and opens an engine wait.
The final withdrawal, idle transition, and wait resolution must share a
request identifier and appear in that order.
Queued and sent controls retain the open wait.

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
Why it matters: A browser could be shown a page that did not come from LGTM Studio.

## 321. An agent that runs `lgtm client subscribe` reads events with no data envelope

Found: 2026-11-03, while planning the client API plan.
State: open.

What happens: This is how the engine's `subscribe` works today (client API row 166).
What should happen: Not decided.
Why it matters: Event text read by an agent is not marked as data, so it could be read as an instruction.

## 322. `runner/translate.ts` drops the tool-call id from file-change content

Found: 2026-11-03, while planning the client API plan.
State: fixed and independently verified in the foundation fix run.

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

What happens: A Herdr pane's command starts from Herdr's environment and not the engine's, so `LGTM_WEB_PASSWORD` could reach it (client API row 188, TM-PB-6).
What should happen: The interactive mode plan clears `LGTM_WEB_PASSWORD` in a pane's command.
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

What happens: A hang in the middle of a turn ends no turn, so the board's reminder for an unanswered question never fires. A turn's end sends one reminder, and the next marks the agent `no-answer` and tells the asker once (board contract v15, rows 153 and 156). Only the roles plan's stall watch catches a hang, at its two-hour runaway limit (board review round 3, logic M4, threat T3-6).
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
State: fixed. Its regression was strengthened on 2026-11-05 for foundation
review record FR-066.

What happens: The dispatcher waited instead of going on to the agent's next queued delivery (board review round 3, logic m4).
What should happen: The client API contract's item 15 requires it to go on (ruling L23, `ced973b`), so the engine must be changed to match.
Why it matters: An agent's queue stalls behind a delivery that was withdrawn.

Validation: Both refused and thrown reach checks now queue three entries.
The runner must receive exactly the reachable successor, with its valid
incarnation. The withdrawn entry remains absent, and the third entry stays
queued. Temporary duplicate-send and continuation-overdrain faults fail the
corrected assertions.

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

The roles persistence proof was strengthened on 2026-11-04 for foundation review
finding FR-067. A nonempty collision batch now passes through the real redactor
and event writer. The test checks Structured Query Language (SQL) event rows,
receipt envelopes, agent and board joins, read marking, and rebuilt equality.
Free text remains redacted. A temporary roles-only writer mutation is rejected
by this test while the older isolated and empty-event checks still pass.
This closes the roles proof gap without claiming first-use execution.

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

The foundation review investigation retained the exact failing status assertion
from `/tmp/r3p-recorder-existing.log`. The archived result describes persistent
initialization failures in a run with 107 failing files. It does not describe
an unchanged failing-then-passing recorder case. The archived assertion omits
the returned failure categories. Current focused execution passes, but does
not establish the historical cause. This part of FR-158 remains open.

## 357. The source boundary check for tables is not a full data-flow analysis

Found: 2026-11-04, by the builder or test writer of unit a1a, during the foundation build.
State: open, for the final review.

What happens: The source boundary check masks guarded closures and recognizes direct indexed calls into the named tables. It is a supplemental guard, not a complete alias/data-flow analysis. Runtime throwing-reducer and snapshot cases supply independent behavior checks for the 1a tables.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

The repair for foundation review record FR-026 adds entry resolution, observer
property access, simple assignment aliases, and renamed destructuring aliases
to this supplemental check. Runtime regressions independently exercise absent
entries, null entries, throwing accessors, and observer failures through
projection, live publication, and rebuilding. The source check remains a
bounded check, rather than a general data-flow analysis.

## 358. Criterion 2.3 says every reply carries a request identifier, but stream markers carry none

Found: 2026-11-04, by the builder or test writer of unit a2, during the foundation build.
State: fixed as a documentation conflict in foundation review record FR-151.

What happened: Criterion 2.3 and the generic contract wording said every
reply carried a request identifier. Stream items instead carry event sequence
numbers, including checkpoint and oversized markers.

What changed: The criterion and both generic contract statements distinguish
payloads, unary replies and errors from stream items. The existing identity
and reconnection tests keep their expectations. No schema changed.

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

The FR-158 investigation located the original timeout while waiting for the
survivor's socket in `/tmp/foundation-r1-merge-check.log`. The fixture discards
the child's standard error, so that log cannot distinguish an exited survivor
from a delayed listener. Bounded focused startup contests preserve the existing
exclusive-lock and survivor assertions. Passing contests do not establish the
historical cause. This issue remains open.

## 361. A harness test rejects any adapter path containing `npx`, including random temporary folders

Found: 2026-11-04, by the builder or test writer of unit b1, during the foundation build.
State: fixed during the foundation review repair of FR-152.

What happens: `packages/engine/test/runner/harnesses.test.ts:82` rejects any adapter path containing the substring `npx`, including its random temporary directory. The whole gate generated `/tmp/lgtm-harnesses-bQtnpx/`, causing a false positive. The isolated case passed on rerun. The lead should narrow the assertion to the executable or invocation.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

The fixture now always uses an ancestor containing `npx`, which deterministically
failed the old substring assertion. Exact expected executable paths and argument
vectors reject an actual package-runner invocation without rejecting that valid
ancestor. Temporary executable and argument faults are checked separately.
The runtime resolver did not need a change.

## 362. The board plan's engine-change table still says seven tools and eight events

Found: 2026-11-04, by the builder or test writer of unit b1, during the foundation build.
State: fixed as a documentation conflict in foundation review record FR-153.

What happened: The engine-change table retained counts from before the
acknowledgement command and event were added.

What changed: Both tool counts in row B1 now say eight. The event count in
row B2 now says nine. The counts agree with the current command access
table, event union and exact inventory tests. No command or event changed.

## 363. An agent named `owner` shares its reader records with the human owner

Found: 2026-11-04, by the builder or test writer of unit b2a, during the foundation build.
State: open, for the final review.

What happens: AgentId accepts the literal owner, but the required raw-agent-id-or-owner convention aliases that agent with the human owner in readState, dispositions, takenAt, and other reader-keyed records. A synthetic owner read advanced the position stored for an agent with id owner. The lead should settle whether to reserve that id or change the shared reader-key convention before building the consumers. This unit follows the frozen tests' stated convention and does not change contracts outside its scope.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

## 364. A web-down alert can be missed when the outage is disabled at once

Found: 2026-11-04, by the builder or test writer of unit a5, during the foundation build.
State: closed with controlled evidence during the FR-158 investigation.

What happens: The focused run intermittently observed no web-down alert when an outage was disabled immediately after its source event appeared. The unchanged isolated file and the full check both passed afterward. A timing race is suspected: the existing alert reactor evaluates a source against the current snapshot, so a rapid settings change can make that source already closed when consumed. This continuation did not change the reactor or the frozen assertion. The collector should retain this observation when assessing intermittent failures.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

Commit `06ebd4a7b1f9789dcf7c69c9e2c83ccf93712cbb` already added an alert-creation
wait before disabling the outage in this test. A controlled delayed follower
reproduces the historical missing-alert assertion after the outage is disabled.
An independent later alert proves that the follower consumed that source interval.
The production source policy deliberately suppresses an alert whose subject is
already closed. The existing guard establishes the open alert before testing
its removal. This evidence concerns the test's missing precondition, rather
than a failure to clear an established alert.

## 365. An action record larger than the page budget cannot be read through `roles.actions.list`

Found: 2026-11-04, by the builder or test writer of unit r2, during the foundation build.
State: fixed during the foundation review repair of FR-154.

What happened: The action-event schema permits an individual encoded record
larger than the action page budget. The history read refused an oversized
singleton instead of sending it whole, blocking traversal to older records.

What changed: The reader returns an oversized first action whole on its own
page. Its exclusive continuation reaches the older history. Regressions cover
the byte boundary, filtering, ordinary controls, and a 300 KiB group assigned
through the public command and recorded by the real idle-rule producer.
No stored record is removed or cut.

## 366. The transcript fallback schedules nothing for a long Claude project folder

Found: 2026-11-04, by the builder or test writer of unit r9, during the foundation build.
State: open, for the final review.

What happens: The transcript fallback refuses a Claude project-folder key longer than 200 characters, because Claude Code hashes such keys in its own way. LGTM Studio then schedules nothing rather than guess a path. An agent in such a folder gets no cache timing from this fallback.
Why it matters: The foundation build's reviews are held until its end, so this waits for the final review.

## 367. The board restart acceptance case failed once in a full check

Found: 2026-11-04, by the builder or test writer of unit r12, during the foundation build.
State: fixed during the FR-158 investigation.

What happens: The first full `pnpm check` for unit r12 failed the board restart's sent-wake case, because no reminder wake was present. All three cases passed in an isolated rerun, and the next full check passed with no source change. Unit b5 had already repaired a startup race in this area, at an earlier commit, so that repair did not remove every timing dependency.
Why it matters: An intermittent failure can block a merge, and it may hide a real readiness or scheduling fault. It waits for the final review.

The sent-wake fixture now holds the recovered response turn behind a file
barrier. The old assertion deterministically sees no reminder at that boundary.
Socket readiness permits the response to remain working, while a reminder is
due only after that response ends. The corrected test observes the recovered
prompt reaching the restarted adapter, proves that its turn has not ended,
releases it, and waits for the reminder before counting the complete observed
wake history.
The original one-wake and open-matter assertions remain.

The earlier unit b5 failure concerned a completion send after a non-reloadable
recipient was resolved. Its existing boot-recovery guard is separate from this
later reminder boundary. Neither repair establishes the causes of issues 356
or 360, and neither is attributed to the separate auxiliary alert barrier.

## 368. A lead can be reported stalled while its workers work

Found: 2026-11-04, by the builder or test writer of unit r13, during the foundation build.
State: fixed as a documentation conflict in foundation review record FR-156.

What happened: The roles plan's clock summary and acceptance wording omitted
decision 88's owed-reply exception. Criterion 4.3 also denied that exception
before requiring it later in the same row. The recipe repeated the broad
waiting exclusion.

What changed: The clock summary, criteria 4.3 and 8.2, and the recipe now
preserve the exception. The owner-authored acceptance assignment does not
qualify. An eligible idle orchestrator's assignment can qualify when its
author reaches no busy work outside the lead. The evaluator and existing
ordinary-waiting and owed-reply tests keep their behavior.

## 369. The live-check scripts depend on the order of their imports

Found: 2026-11-04, by the builder or test writer of unit r14, during the foundation build.
State: fixed for foundation review record FR-157.

What happened: Importing the existing live driver before the existing live runner caused a circular module initialization error for `pieceViews` under plain Node.js. The live entry point depended on a runner-first import convention.

The FR-013 regression also encountered this import-order sensitivity. Importing the alert reactor before the service test helpers left the client reactor registration incompletely initialized under Vitest. Loading the helpers first was the earlier workaround.

What changed: The engine composition resolves its piece-view and reactor values on access after module initialization. It caches the reactor table so the web listener's startup identity check remains valid. It no longer reads the unfinished view table or combines unfinished reactor effects while constructing the registry. Plain Node regressions start with the driver, the alert reactor, and the view table, and require all registered views, reactors and representative commands. The roles entry point now imports the driver before the runner.

Why it matters: The owner-run checks can start without their previous import-order convention.

## 370. Two browser assertions reject supported thread navigation

Found: 2026-11-04, while repairing foundation review records FR-086 and FR-092.
State: fixed.

What happened: The administration browser test expected `/threads/phone-worker`, but the production link uses `/#/thread/phone-worker`. The phone browser test required a Hypertext Transfer Protocol (HTTP) 200 response from a hash-only navigation. Playwright returns no response for that navigation. Both assertions stopped the later behavior checks.

What changed: The administration test pins the supported hash link, follows it, and reads the question before continuing through every settings check. The phone test checks the exact alert route and retained document. It checks the permission answer, the runner's agent and option, and output emitted only after approval. Reloading the thread independently reads back the committed answer and agent output. Only that fresh-document reload requires HTTP 200. Existing width and browser-storage checks remain in place.

Why it matters: These tests now reach their administration and permission-flow assertions. Temporary production mutations verify that a wrong administration link and missing navigation handlers are rejected. The separate Hypertext Transfer Protocol Secure (HTTPS) fixture update belongs to the public-address repair in FR-001. The Phase 2 repair for FR-048 adds independent production-bundle width cases for the login, situation, thread, alerts and settings pages. Each waits for its real content, measures the document and body against the 360-pixel viewport, and reports its own outcome. The existing navigation, administration, thread and storage checks remain. Temporary page-specific overflow mutations fail all five cases at their width assertions.

## 371. Enabling an initially disabled stall watch skips cache initialization

Found: 2026-11-04, in the foundation review, record FR-008.
State: fixed in the foundation fix for FR-008.

What happened: An enabled startup initialized each stall watch rule, but a switch from off to on only re-armed timers. The cache rule therefore kept an empty target map and never loaded the configured home or harness cache lifetimes. Existing eligible turns received no cache maintenance. Later turns with unsplit context usage also received none until a harness settings change or an enabled restart loaded the lifetime.
What changed: A switch from off to on now runs the same rule initialization as an enabled startup before arming timers. The cache rule reloads settings and reconstructs targets from current agents and their recorded turns. A future deadline keeps its original expiry. A missed cache deadline is dropped. Repeated activation does not repeat an action.
Verification: The socket-level cache runtime tests cover settings committed before disabled startup, existing and subsequent unsplit turns, missed deadlines, repeated activation, and Claude transcript reconstruction from the default home and both account-specific home settings. Five regression cases failed against the unfixed loop because no compaction was delivered. The missed-deadline case already passed and remains a guard against extending expiry at activation.

## 372. The owner conversation clients omit outgoing sources and delivery history

Found: 2026-11-04, in foundation review finding FR-002.
State: fixed and independently verified in the foundation fix run.

What happened: The browser filtered out queued deliveries whose target is nested
inside the delivery. The terminal viewer required an envelope agent identity,
which those deliveries do not have. The browser displayed `PromptSent`, although
the engine records a first prompt inside `AgentStarted` and later prompts inside
`DeliveryQueued`. It also omitted question answers and delivery states.
Oversized sources could not be recovered from a current snapshot after the
delivery had settled. A terminal reconnect could skip events missed during the
disconnection.

What changed: Both clients select queued sources by their delivery target.
The browser renders first and later prompt sources, question answers, and the
delivery history joined by delivery identity. It reads oversized display events
by sequence before advancing its stream cursor. The terminal viewer reloads
the selected thread when reconnecting. The engine's visibility rules remain
the authority for every read.

Verification: The conversation history regressions cover split pages, sources
without a top-level agent identity, later delivery states, and oversized live
sources across reconnect. A browser regression exercises both clients against
the public engine interface for first and later prompts, a question answer,
a board delivery, an oversized prompt, and history after reopening.

Why it matters: The owner can read the conversation and its delivery outcome
from either client without exporting the durable event log.

## 373. A configured public HTTP page cannot generate browser request identifiers

Found: 2026-11-04, while fixing foundation review record FR-001.
State: fixed in the commit that adds this entry.

What happens: The public address accepted plain Hypertext Transfer Protocol
(HTTP), and the remote access guide offered a non-loopback HTTP page.
Browsers do not expose `crypto.randomUUID` there, so the logged-in page cannot
generate the identifiers needed for its application programming interface
(API) requests.
What should happen: By the owner's 2026-11-04 decision, every configured public
address requires Hypertext Transfer Protocol Secure (HTTPS).
The schema, engine and web settings refuse HTTP with a clear explanation.
Local HTTP remains available at `127.0.0.1`, including through a Secure Shell
(SSH) local forward with identical ports on the browser device and server.
Why it matters: The supported remote dashboard journey needs the browser's
secure-context APIs after login.
The change keeps the existing request identifiers and retry behavior.
Regression evidence: The pre-fix schema, engine and settings-page tests accept
HTTP and fail the new refusal checks.
The production-shell browser test checks login and an actual outgoing request
identifier at `http://127.0.0.1:<port>`.
The phone and board alert browser fixtures use a real local HTTPS proxy while
retaining their link, answer and readback checks.
Second-round clarification: The owner's later 2026-11-04 ruling accepts a
self-signed certificate at the external proxy.
The first fix's guide, security rule, plan and three contract copies incorrectly
required certificate trust.
Those requirements now describe the expected browser certificate warning and
the accepted continuation without installing trust.
LGTM Studio still holds no certificate and serves only HTTP on loopback.
The existing browser fixtures ignore certificate errors for the self-signed
proxy and prove login and authenticated requests without installing trust.
Their comments now describe that bypass accurately.

## 374. Replacing a queued board wake drops a read question before acknowledgement

Found: 2026-11-04, while fixing foundation review record FR-007.
State: fixed by the FR-007 repair on `fix/foundation-007`.

What happened: A read marked an original question as taken without acknowledging
it. Closing or acknowledging another question, or merging a new question,
withdrew the mixed wake. Replacement retained reminders but selected original
questions only when unread, so the read question lost its queued safety net.
The post remained stored and open, but recovery could need a later turn end.

What changed: Replacement carries the withdrawn wake's original reply duties
forward from stored wake history, independently of unread digest selection.
This also covers replacement deferred to another reactor transaction.
Acceptance of any copy ends the original wake duty.
Current reach, open status, acknowledgement, disposition, reservations and byte
limits still govern them.
The plan's cleanup paragraph now follows decision 152's acknowledgement rule.

Validation: `packages/engine/test/board/wake-replacement.test.ts` reproduces
the read-then-close, read-then-acknowledge and read-then-merge cases before
any turn end. It checks replacement manifests, actual prompt delivery, status,
an open wait and log rebuilds. It also checks that replacement preserves owed
completion debt and does not duplicate a question reserved by a sent wake.
It covers deferred reactor replacement, the transition to a reminder after an
eligible turn end, and the end of the original duty after acceptance.

## 375. The terminal permission context omits correlated file changes

Found: 2026-11-04, while repairing foundation review record FR-005.
State: fixed and independently verified in the foundation fix run.

What happened: `packages/viewer/src/actions.ts` accepted only tool-call content when a permission request had no input. It omitted file-change content even when the content carried the request's tool-call identity. The upstream identity repair in issue 322 could not repair this independent filter.

What changed: The terminal helper includes file changes whose `content.callId` matches the request's `toolCallId`. It keeps the request read first, the thread's page and item order, and the existing warnings for missing, redacted or truncated input. It never joins a diff by its path or thread-item identity.

Validation: `packages/viewer/test/request-file-change.test.ts` covers a locations-only request, matching diffs across pages, a diff as the only input, and unrelated and uncorrelated diffs. It also checks that partial-input warnings remain visible. The matching-diff regression failed against the unfixed helper before the filter changed.

Why it matters: The owner can review a correlated edit before answering its permission request in the terminal viewer.

## 376. A cached piece hold prevented the owner wait from refreshing it

Found: 2026-11-04, in foundation review record FR-009.
State: fixed.

What happened: The client wait filtered its refresh candidate through cached
piece holds. A permission answer or an accepted board completion followed by a
turn end could clear the actual hold without a later piece event. The stale
hold then prevented the read that would observe the release.

What changed: The refresh trigger uses engine eligibility before piece holds.
The final result still applies every current piece hold after the published
sequence gate. A failed refresh retries from the applied cursor without needing
a new event. A quiet held member does not cause polling.

Verification: `packages/client/test/wait-piece-refresh.test.ts` covers both
release paths in both wait modes. It also checks persistent holds, queued
deliveries, split batches, and a failed read followed by a quiet reconnect.

Why it matters: The owner's wait can finish after the promised work completes,
without cancellation or unrelated board activity.

## 377. A failed board snapshot section stopped the owner wait before status recovery

Found: 2026-11-04, while repairing foundation review record FR-012.
State: fixed.

What happened: `packages/client/src/waitForAgents.ts` rejected every snapshot with a failed section. It discovered the piece condition reads only from successful sections. A failed board snapshot therefore stopped the owner wait even when `board.status` could still return complete condition lists.

What changed: The helper identifies the board condition read from an explicit namespace table. It includes a failed board section in that discovery. It recovers `holdsUnsettled` and `ownerHeld` from the independent status read before deciding whether to end the wait. The existing published-sequence gate and failed-read retry remain in use.

Why it matters: A snapshot-hook failure no longer forces the owner to restart a wait. Held targets keep waiting, owner-held targets return `request-held`, and released targets settle only after the stream reaches the lists' published sequence. The client regression covers both wait modes and a failed status read on a quiet log. The existing engine test still checks that a held publication exposes only the previous published lists and that status survives a failed snapshot hook.

## 378. Plain-channel additions used immediate parents instead of effective holders

Found: 2026-11-04, while fixing foundation review record FR-010.
State: fixed in the foundation fix branch.

What happened: `board/access.ts` checked immediate parent links when an agent
manager added a member. An idle manager could not add a descendant through a
paused, starting, interrupted, crashed or stopped intermediary. A manager also
could not add its own effective holder through an unavailable ancestor.

What changed: Plain-channel additions use the engine's `holderAbove` rule in
both directions. The management check and the stored manager seat retain their
existing rules. The shared access fixture now opens the agents' sessions, so
its baseline holders are idle instead of starting. Existing assertions remain.
New pure and authenticated command regressions cover unavailable intermediaries,
available intermediaries, the manager's own holder and the owner's override.

Why it matters: The contract permits a manager to add agents it holds, even
when their immediate parents cannot act. The fix restores that delegated
operation without changing stored membership when an agent's state changes.

## 379. The stall watch lost its event-position switch when refreshing live state

Status: Fixed in the foundation review corrections for finding FR-011.

What happened: The stall watch loop kept the switch at its subscriber cursor, but the production rules fetched Views again and used the latest switch. When consumption lagged behind a switch-off, an eligible earlier event could lose its advice notice or crash retry.

What changed: The rules retain the cursor switch while refreshing the current lifecycle, settings limits, and action records. The regression holds the consumer before advice and crash events, commits switch-off, and then checks their outcomes through the production rules. It also proves that events committed while off remain ignored after re-enabling.

Validation: The pre-off advice and crash cases failed against the unfixed rules with missing action records. The rules and loop suites cover these cases together with duplicate suppression, refused admission, and recovery lifecycle boundaries.

## 380. A stop and resume during alert follower lag suppress the returning question

Found: 2026-11-04, while repairing foundation review record FR-013.
State: fixed.

What happened: The alert reactor checked a stop or crash against the latest snapshot. If the agent had already resumed, the old question alert stayed open. Its key suppressed the replacement alert. A delivered alert therefore kept its delivered mark, and a baseline alert kept its push exclusion.

What changed: A stop or crash closes an earlier question or approval alert according to the lifecycle event's sequence. A question source or resume from before a later stop or crash cannot raise an obsolete alert. The latest resume renews an open owner-held question with the same key and a fresh alert identifier.

Why it matters: The returning question can notify the owner again after follower lag. The regression covers stopped and crashed agents with delivered and baseline alerts. Both lifecycle commits precede catch-up, either in the same service or across a restart. The real stop and resume commands, durable alert state, local carrier requests, and another restart are checked. The local carrier receives the replacement identifier exactly once. The test also rejects sources from obsolete runs. It does not verify a notification on the owner's physical phone.

## 381. A failed viewer refresh leaves an acknowledged action available to resend

Found: 2026-11-04, while repairing foundation review record FR-014.
State: fixed.

What happened: The terminal viewer cleared a prompt or answer only after its following snapshot read succeeded. A failed read left the acknowledged draft or permission controls active. Pressing Enter sent another action with a new request identifier. An uncertain send also received a new identifier when the owner retried it.

What changed: The viewer retires acknowledged prompts and answers before refreshing its snapshot. It reports a failed refresh separately from the successful send. The connection retains an uncertain attempt's body and identifier for an unchanged retry. A confirmed send, a definite command refusal, or an edited body ends that attempt. Retry state lasts for the current viewer connection.

Verification: `packages/viewer/test/send-recovery.test.tsx` drives the real Ink terminal interface and socket client. Its prompt, question and permission cases assert one write after acknowledgement and refresh failure. Its lost-acknowledgement prompt case uses the real command handler, delivery planner and SQLite receipts to check one durable receipt and delivery after retry. The answer cases check stable identifiers after transport failure and fresh identifiers after confirmation, refusal or an edit.

## 382. A concurrent alert scan could retry before the latest failure's deadline

Found: 2026-11-04, while investigating foundation review finding FR-015.
State: fixed in the foundation fix for FR-015.

What happens: Retired-token cleanup can suspend a delivery scan after it reads
the client view. Another scan can send and record a failure in that same
generation before the suspended scan claims the released delivery key. The
claimant used the earlier view's retry deadline, even though it selected the
next attempt from the current view.

Why it matters: The next send could arrive before the required delay from the
latest failure. The controlled regression in
`packages/engine/test/client/alert-delivery-race.test.ts` holds real token
cleanup and carrier responses. It also pauses the worker's self-scan at its
snapshot read after key release, to give the stale scan the claim. The unfixed
worker sends early after both the first and the second failure.

What changed: The claimant reads the current failure while holding its delivery
key. It recomputes the deadline after each wait. It validates the failure
sequence again after the database read, together with the current generation
and pending conditions. The regression checks the five-second and thirty-second
deadlines and increasing attempt numbers.

## 383. Delivery failure diagnostics did not reach the alerts page

Found: 2026-11-04, while repairing foundation review record FR-017.
State: fixed.

What happened: The delivery worker recorded a safe failure reason and the fifth
failure's `final` mark, but the client projection dropped those fields. The
alert-list contract, read and page exposed only the alert's open or cleared
lifecycle, so the owner could not see that delivery was still failing.

What changed: The projection retains the last outcome for the current delivery
generation. The owner read and public schema expose its outcome and attempt,
with a fixed safe reason and `final` for failures. The page renders "Failed",
"Still failing" or "Delivered" separately from the alert's lifecycle. The
command-line list retains the same fields in its reply. A successful attempt
replaces the failure, and a generation change cannot reuse an old failure.

Why it matters: The owner can diagnose a carrier outage or a missing backing
token while durable retries continue. Regression tests exercise the writer,
read, public schema, rebuild, restart, recovery, generation changes, clear,
page rendering and command-line output. No live carrier or phone was used.

## 384. An integrated alert test still expects the earlier delivery projection

Found: 2026-11-04, by the full merge check combining foundation review repairs FR-013 and FR-017.
State: fixed.

What happened: The lifecycle regression expected the private delivery row's earlier `delivered` boolean. The diagnostics repair replaced it with the explicit `status` field. All eight lifecycle matrix cases failed at this one assertion after integration.

What changed: The assertion now requires `status: "delivered"` and the same first-attempt count. The existing durable delivery event, exact carrier request, renewal identity, and restart assertions remain. The production behavior is unchanged.

Validation: The initial complete merge check is archived with eight failures at the old assertion. The corrected lifecycle, retry-race, and delivery-diagnostics suites run together before the repaired full merge check.

## 385. Sparse omission metadata can refuse an otherwise small hand-off

Found: 2026-11-04, while fixing foundation review finding FR-003.
State: fixed by bounded omission pages in `roles.handoff` and continuation
identifier preservation in the Model Context Protocol (MCP) connector.

What happens: The previous selector budgeted all exact omission ranges before
the original brief or latest exchange. A worker history interleaved with other
events could produce thousands of separate ranges. Their metadata exceeded
the reply budget, and the hand-off refused even when its priority sections
were small.

The selector now reserves one bounded omission page before selecting content.
Each reply lists at most 64 exact ranges and provides a continuation cursor
when more remain. The cursor preserves the original history boundary and
request identifier. Every continuation checks current management rights.
The 5,000-item interleaved-history regression checks the public socket replies,
both encoded budgets, whole small priority sections and complete exact recovery.

The first-round verifier found that the MCP connector generated a new request
identifier for each tool call. Its schema has no top-level identifier
parameter, so an agent could not meet the continuation's original-identifier
requirement. The connector now uses the returned cursor's identifier for
hand-off continuations. A second regression runs the real MCP command and
engine, recovers all 150 interleaved historical items across three omission
pages, reads their full content, preserves the original summary after later
activity and refuses a continuation after the lead loses management rights.

Why it matters: A long worker history must remain recoverable without widening
sequence ranges across unrelated events or refusing the summary.

## 386. The board-alert browser test uses an ambiguous reply locator

Found: 2026-11-04, by the combined first-phase browser gate after the FR-002 conversation-history repair.
State: fixed.

What happened: The reply text appears in its board subject and in the newly visible outgoing delivery. The browser test matched both elements with one global substring locator. The page displayed the reply correctly, but the locator failed its strict uniqueness check.

What changed: The browser assertion selects the exact reply inside the named Board post region. The exact single runner wake, removed reply form, and durable alert-clear assertions remain. Production code is unchanged.

Validation: The corrected browser case passed. A temporary rendering mutation kept the outgoing reply visible while replacing the subject reply. Two explicit browser preconditions established that state, and the corrected locator then failed at the missing subject reply. The production file and temporary proof assertions were restored byte-for-byte before the commit.

## 387. The alert lifecycle test leaves an auxiliary delivery unfinished

Found: 2026-11-05, by the command-line batch's complete check during the foundation repairs.
State: fixed.

What happened: The lifecycle regression waited for its auxiliary barrier alert to be raised. It did not wait for that alert to be delivered before closing the service scope and counting carrier requests. The next restart could correctly deliver both this unfinished alert and the new restart barrier. The exact total then failed even though the renewed question was sent once.

What changed: The regression waits for the auxiliary barrier's durable delivery before ending that scope. It retains the exact request total, renewed identity, per-question request count, clear events, and restart checks. Production code is unchanged.

Validation: A controlled finite delay reproduces the old count failure with no production changes. The same delay passes with the delivery wait, and confirms that the auxiliary request has completed before the first scope ends. The worker's independent baseline reproduction and the lead's failed and passing proof logs are archived in the foundation fix run.

## 388. Idle-team nudges bypassed the board

Found: 2026-11-04, while fixing foundation review finding FR-019.
State: fixed.

What happened: The stall watch prompted every top agent through the engine, even
though roles decision 60 requires a direct board post with no reply, followed
by a flush. Only the holder notice had a board record.

What changed: Each top receives a service-authored direct board post and a
flush under deterministic per-top identities. Shared holders still receive
one notice per group and occurrence. An owner-held top still receives a board
nudge, and the owner's notice remains the roles event. The regression checks
the top posts and flush receipts separately from the shared holder receipt.
It also checks stall watch turn classification, hourly repeats, restart deduplication,
snooze, and a disabled board.

Why it matters: The nudge now follows the promised board history and wake path.

## 389. A later session hid an existing crash continuation

Found: 2026-11-04, while fixing foundation review finding FR-044.
State: fixed.

What happened: An open crash admission treated a carry-on as absent when a
later reload preserved it but opened a newer session. The session sequence
comparison sent an unnecessary stall watch continuation.

What changed: The rule recognizes a carry-on queued after the admitted crash,
even when another session opens afterward. Earlier crashes' carry-ons do not
satisfy that guard. Deterministic service request identifiers remain in use.
The regression admits a crash, accepts ordinary owner work, creates an engine
carry-on through the reload transaction builder, preserves it through another
reload, and restarts the stall watch twice. It requires one logical continuation
and one outcome notice. Existing no-carry and service-receipt restart cases
remain covered.

Why it matters: Recovery does not add work that the engine already preserved.

## 390. Action history used a different continuation field from other paged reads

Found: 2026-11-04, while repairing foundation review record FR-030.
State: fixed.

What happened: The action-history schema and handler accepted `before`, while
the shared paged-read contract requires callers to pass `next` back as `after`.
A generic caller repeated the newest page.

What changed: The schema, handler, command-line parity fixture and snapshot
recovery caller use `after`. Newest-first history uses an exclusive descending
comparison. Authenticated regressions check filtering, ordering, uniqueness,
termination, and the item and byte caps.

## 391. A role file could expand beyond admission budgets during final redaction

Found: 2026-11-04, while repairing foundation review record FR-046.
State: fixed.

What happened: The planner validated original and redacted content, then sent
the redacted content through the writer's redactor again. Replacement markers
could expand beyond the checked budgets. A registry refresh could also change
the representation between planning and the write.

What changed: The planner sends the original content to the writer. The writer
validates its final redacted document before inserting any event or receipt.
A refused document rolls back without latching a database failure. Regressions
use the real redactor and SQLite, check stored bytes, preserve the previous
file and hash on refusal, and prove a later valid write still succeeds.

## 392. Handoff and roles-event tests did not prove their required boundaries

Found: 2026-11-04, while repairing foundation review records FR-054, FR-057,
and FR-115.
State: fixed.

What happened: Handoff tests did not combine a real 500-item queued/sent split
with all four caller cases. The large-tool assertion did not require any output
to survive. The contracts size fixture used a tolerant non-event instead of an
admitted role file.

What changed: A handoff regression places the queued prompt at item 500 and its
sent event at item 501 through actual writers. It checks owner pairing, the
intentional agent marker, fresh rights after parent recovery, replay refusal,
and replacement refusal. The large-tool case requires a stable output prefix.
A valid 64 KiB role file with escaping and multibyte advice passes real admission,
strict event and envelope round trips, and actual stream and page frame checks.
The invalid control-character case remains a separate refusal test. Temporary
mutations establish that each strengthened test rejects its assigned fault.

## 393. Automatic cache actions used state from outside their acceptance transaction

Found: 2026-11-04, foundation review records FR-021 and FR-024.
State: fixed.

What happened: Queued work, holds, new turns or fresh sessions could arrive after the final eligibility read. The flush-versus-compact choice also used an older board unread count. An accepted automatic compact could wait in the queue beyond the evidence that justified it.

What changed: The internal cache service now selects and accepts the action from one writer snapshot. Dispatch revalidates the recorded cache evidence in its own writer transaction. It withdraws an obsolete automatic delivery and continues the queue. The owner's manual compact and flush retain their ordinary behavior.

Verification: Service regressions inject each of the four eligibility races after the final read. Another injects two informational posts after status captured zero and requires a two-post flush. Delayed-dispatch regressions cover expiry, competing work, new turns, new sessions and disabled settings. Manual delivery controls remain.

## 394. Transcript fallback could reuse an earlier request's context usage

Found: 2026-11-04, foundation review record FR-022.
State: fixed.

What happened: The bounded transcript reader selected an earlier eligible row when the current request's usage was missing or incomplete. The cache rule could label its context and timestamp as current.

What changed: The reader must correlate its latest usable row with the selected turn's time bounds and any normalized request timestamp. A later user request, malformed tail or incomplete assistant usage invalidates the earlier result. Only a proven current read-only request can inherit an earlier write lifetime. The expiry helper rejects a request timestamp outside the turn. Normalized context usage retains independent authority.

Verification: Parser and composed service tests cover stale high usage with missing, malformed, partial and future current evidence. Positive controls cover a current read-only request and normalized context authority.

## 395. A fresh session could inherit an old session's cache target

Found: 2026-11-04, foundation review record FR-031.
State: fixed.

What happened: A refresh could combine an old session's turn and usage with the current session identifier after the owner enabled a harness lifetime.

What changed: Every refresh requires the end event and its starting delivery to belong to the current session interval. A fresh session without a request cannot acquire a target. Reloading the same session keeps legitimate evidence.

Verification: Socket-level stop and fresh-resume regressions cover late lifetime changes and startup reconstruction. Existing same-session late-setting and read-renewal controls remain.

## 396. The unconfigured cache lifetime had no composed negative regression

Found: 2026-11-04, foundation review record FR-060.
State: fixed.

What happened: Existing tests checked configured lifetime behavior without proving that valid context alone could not schedule an unconfigured cache.

What changed: Pure and composed tests now use valid context with no lifetime split, prior write, transcript or setting. They assert an empty timer set and no action after two hours.

Verification: A temporary implicit one-hour default makes both regressions fail. The mutation is restored before committing.

## 397. The missing-transcript test returned before opening the file

Found: 2026-11-04, foundation review record FR-073.
State: fixed.

What happened: The missing leaf had a basename that did not match the session identifier. The path guard masked missing-file handling.

What changed: The test uses an absent leaf with the valid session basename in an existing directory. The existing bounded-tail file is its positive control.

Verification: A temporary throw from the valid-path open failure makes the corrected test fail. The mutation is restored before committing.

## 398. Automatic capacity retries lacked history and a transactional hold check

Found: 2026-11-04, while repairing foundation review records FR-018 and FR-039.
State: fixed.

What happened: The capacity timer used an action descriptor only for its release
request identifier. It never recorded the successful retry in the roles history.
The release planner also accepted whichever hold was current, even when the
timer had selected an older hold of the same delivery.

What changed: An automatic release supplies the expected hold sequence. The
release planner checks that sequence inside the writer transaction. A successful
release preserves it in `DeliveryReleased.holdSequence`. The production capacity
rule records that committed success while consuming its event. A restart can
complete the missing action without releasing the hold again. A refused or stale
release creates no successful retry record. An ordinary owner release keeps its
existing behavior when no expected sequence is supplied.

Validation: The regressions failed first with a missing retry counter and a newer
hold released by an old timer. The corrected tests check twelve retries, the
outage reset, a refusal, an interleaved owner release and replacement hold, the
new hold's own deadline, interrupted recording, two recovery startups, the owner
action listing, and the live views against a rebuild.

## 399. An unknown role kind inherited a matching named role's limits

Found: 2026-11-04, while repairing foundation review record FR-028.
State: fixed.

What happened: `chef:builder` and `:builder` received generic worker advice, but
selected the loaded builder's limits. A builder limit of zero capacity retries
therefore refused a hold that the generic worker defaults would admit.

What changed: Named settings and the direct age-limit lookup require a known
role kind. Unknown kinds retain the worker defaults and global settings. Their
existing diagnostic flags remain available. Known `worker:builder` overrides
still apply.

Validation: Pure regressions distinguish capacity, stall and age settings. Real
socket reads and capacity outcomes cover loaded role files, generic advice,
unknown-kind holds, and the known builder's refused hold.

## 400. Crash and roles recovery tests omitted meaningful fault boundaries

Found: 2026-11-04, while repairing foundation review records FR-055, FR-058 and
FR-069.
State: fixed.

What happened: The crash window test had no timestamp for its earlier admission.
The refused-admission test could pass without handling the crash. The generic
action recovery test used release as a substitute for other engine commands.
It did not exercise a committed resume before its hook, successful notice
flushes, or an owner stop and manual resume ahead of stall watch catch-up.

What changed: A schema-valid admission at 45 minutes distinguishes the full
hour from a shortened window. The refusal case requires the exact service
command, request identifier and admission attempt. New tests run production
rules and planners across actual resume, prompt, release, compaction and flush
boundaries. They rebuild the database, execute the real recovery startup twice,
and compare logical command, delivery, notice and action identities. The owner
stop and manual resume use the authenticated socket command path before a later
marker proves that stall watch catch-up completed.

The new command boundary tests also exposed production omissions. A committed
compaction or flush could leave its action record missing because its target
was already busy at restart. A committed idle nudge could lose its notice when
recovery changed the group's idle origin. Startup now completes these accepted
commands from their durable service events and deterministic request identities
before applying current guards. It neither sends the command again nor changes
receipt hook replay semantics. A flushed stall nudge can also stop its original
clock before the action is recorded. Stall startup completes the posted nudge
or replacement notice from its original deterministic identity.

Validation: The cache tests failed first with missing action records. Temporary
mutations test the shortened crash window, an ignored crash, and duplicate
logical effects. No live harness recordings or owner phone are required for
these local deterministic regressions.

## 401. Recovery completion used identities superseded by other foundation repairs

Found: 2026-11-05, while composing the independently verified capacity, cache, handoff and runtime batches.
State: fixed.

What happened: The initial combined recovery matrix failed four cases. Cache completion still looked for separate command identities after cache acceptance became atomic. Idle completion still looked for engine prompts after idle nudges moved to board posts. The first action page also supplied a cursor that selected no records under the corrected descending contract.

What changed: Cache completion recognizes the durable marked delivery and validates its canonical atomic acceptance identity. Idle completion recognizes the durable board nudge, completes its flush, and resolves the effective holder before sending the shared group notice and recording the action. The first page omits its cursor. Four idle interruption cases replace the old prompt fixture while retaining exact identities, two recovery startups, and the prohibition on engine prompts.

Validation: The original combined matrix failed four cases. The strengthened board regression then failed with the action missing after a committed nudge. All nineteen final recovery cases pass. The run folder retains both failing logs and the corrected matrix log. A fresh composition review is assigned to the live-check batch and its independent verifier before the run closes.

## 402. A delivered stall nudge can lose its episode before its action is recorded

Found: 2026-11-04, in foundation review record FR-023.
State: fixed.

What happened: Posting and flushing a nudge could queue and send a board wake
before the action record was written. A no-progress turn then changed the
stall clock's origin. Recovery had no durable copy of the original episode
identity and could repeat the first occurrence instead of escalating.

What changed: The automatic stall rule records `roles.StallNoticePlanned`
before sending a notice. The roles view retains its original post, agent,
origin, recipient, kind and occurrence until the matching action is recorded.
Recovery finishes that notice using the original command receipts. Different
posts that share an origin retain separate pending identities.

Validation: The automatic-rule regressions interrupt recording after a real
board wake is queued, complete the delivered no-progress turn, and restart
from the database. Both first and second occurrences retain their count,
complete the second holder notice, and advance without duplicate posts or
wakes. The original implementation failed both occurrence assertions. The new event
also has an independent wire sample for round-trip, lifecycle-state and
owner-only subscription checks.

## 403. Consumption before a notice record is forgotten

Found: 2026-11-04, in foundation review record FR-029.
State: fixed.

What happened: A board read or accepted wake marked only action records that
already existed. A late action started unread even when its recipient had
consumed its board post. A later recipient failure could reroute that notice.

What changed: The roles fold retains consumed post identities per recipient.
A late action derives its read state from that durable fold. Reads by another
recipient and reads of another post do not consume the notice.

Validation: Pure regressions cover both consumption paths before and after
recording. Composed regressions interrupt after posting and flushing, consume
the notice, restart, record it late, and crash its recipient. Consumed notices
do not reroute. The unread control reroutes once. The original fold failed
both consumption-before-record cases.

## 404. Repeat-suppression tests omitted seeded key separation

Found: 2026-11-04, in foundation review record FR-051.
State: fixed as a regression-proof gap.

What happened: Positive runaway and role-advice tests did not establish all
old-key and new-key distinctions. No duplicate production notice was observed.

What changed: Seeded runaway tests distinguish agent, turn and age origins.
Seeded advice tests distinguish agents and kinds, including owner-addressed
posts. A production advice sequence repeats commands across three service
lifetimes while another worker and another kind remain eligible.

Validation: Temporary mutations remove suppression, broaden runaway keys,
broaden advice keys, and remove advice reconstruction. The corresponding
strengthened assertions must fail before the original source is restored.

## 405. Stall scenario names claimed transitions their fixtures never performed

Found: 2026-11-04, in foundation review record FR-082.
State: fixed as a regression-proof gap.

What happened: The cycle-only test called the per-post evaluator with no
post episode. The account and permission cases supplied disconnected elapsed
snapshots. They did not prove a fresh lead clock after real state changes.

What changed: The cycle test calls the team-idle evaluator. A runtime sequence
keeps both reciprocal obligations open across restart and reaches the configured
hour. Separate lead sequences apply account unavailability and recovery, or a
permission request to that idle lead followed by the owner's real stop command. They check the
lost origin, cancellation, restored origin, restart, and full new lead interval.
The lead uses a separate available account, so its own pause cannot mask a
broken dependency on its child's unavailable account.
The old pure fixtures now claim only the snapshot behavior they check.

Validation: Temporary mutations preserve an old origin, treat open obligations
as busy, and omit permission cancellation. The corresponding transition or
cycle assertions must fail before the original source is restored.

## 406. Startup tests did not exercise historical crash rules or require later work

Found: 2026-11-04, in foundation review record FR-102.
State: fixed as a regression-proof gap.

What happened: The recovery-barrier fixture had no production crash rule.
The lagged-switch fixture discarded an eventual result for the after-on event.
Both tests could pass without the behavior their names promised.

What changed: Production crash rules now wait behind the recovery barrier.
The test checks the captured historical head, no old admission, no resume or
prompt, and admission of a later crash. The switch test explicitly requires
one before-off and one after-on observation across another restart.

Validation: Temporary historical replay and skipped switch-on work must fail
the strengthened assertions before the original source is restored.

## 407. The stall runtime test could not observe closure of an owner alert

Found: 2026-11-04, in foundation review record FR-119.
State: fixed as a regression-proof gap.

What happened: The fixture disabled the client alert reactor, addressed the
stall to a lead, and used direct prompts. It did not create the owner alert
or either board wake required by the criterion.

What changed: The runtime test uses the production reactor table. It observes
an open owner stall alert, delivers a stall-watch-only board wake, and checks
that the same alert remains open. It then delivers a mixed board wake and
checks one stall end and one clear of that exact alert through the client API.

Validation: Temporary mutations classify every wake as stall-watch-only or omit
the client stall-end source. Both must fail the composed assertions before
the original source is restored. The existing classifier cases also cover
another author, completions, reminders and no-answer duties.

## 408. A piece observer could escape the fold's failure guard

Found: 2026-11-04, while repairing foundation review record FR-026.
State: fixed.

What happened: The fold resolved the piece observer before entering its guard.
An absent entry, a null entry, or a throwing accessor could stop projection,
publication, or rebuilding instead of retaining the piece fallback.

What changed: The fold resolves and invokes the observer inside one guard.
The regression covers each resolution fault, a throwing observer, and a
healthy observer through the service writer and the durable rebuild.

## 409. An undefined optional side-row value could latch the writer

Found: 2026-11-04, while repairing foundation review record FR-033.
State: fixed.

What happened: The side-row type allowed an undefined namespaced entry.
The writer treated that entry as malformed.
The transaction rolled back.
The writer retained the failure for all later writes.

What changed: An undefined entry now has the same meaning as an omitted entry.
Planner, marked-read, and reactor regressions cover omitted, undefined, empty,
and populated rows. Each case checks receipts, a healthy follow-up write,
and rebuilding. A genuinely malformed row still rolls back and latches.

## 410. The normal service log discarded the identity of a failing piece

Found: 2026-11-04, while repairing foundation review record FR-042.
State: fixed.

What happened: The piece guard and service drain produced safe diagnostic
categories.
The final normal sink replaced the message.
It also removed the namespace, table, and error class.

What changed: The sink preserves the fixed piece-failure message and permits
only the three fields with their bounded category values. The regression
runs a throwing reducer through the service drain, the redacting logger,
and both sink modes. It checks throttling and continued engine writes.
Arbitrary exception text, causes, and annotations remain excluded from the
normal sink.

## 411. Composed service flows lacked a throwing-piece regression

Found: 2026-11-04, while repairing foundation review record FR-078.
State: fixed as a regression-proof gap.

What happened: Existing tests covered individual consumers and raw appends.
They did not compose commands, adapter permission requests, stopping, and
recovery with the failing piece installed.

What changed: A service regression starts agents, prompts them, answers a
permission, stops an agent with a pending request, and closes the service.
It reopens the same database with the failing piece, runs actual recovery,
checks durable permission states and receipt replay, and compares the live
views with a rebuild. A second regression uses the real Agent Client Protocol
(ACP) runner, a scripted adapter subprocess, authenticated socket commands,
and a real session reload after reopening the database.

## 412. Piece planner registration accepted the broader engine plan

Found: 2026-11-04, while repairing foundation review record FR-087.
State: fixed.

What happened: The composition table accepted an engine plan for every key.
A piece planner could omit its reply, and a wider variable could carry an
engine after-commit hook past the piece type's excess-property check.

What changed: Namespaced registrations require a piece plan with a reply and
an explicitly forbidden hook. Engine registrations retain engine hooks.
Compile fixtures cover wider variables at composition and fixture boundaries.
The existing receipt replay regressions remain.

## 413. The piece-writer matrix did not prove every independent guard

Found: 2026-11-04, while repairing foundation review record FR-090.
State: fixed as a regression-proof gap.

What happened: The matrix lacked known delivery ownership and status cases,
a foreign existing-table side row, and an open wait changed by the batch.
Its partial assertions could miss an extra refusal write.

What changed: The matrix covers planner writes, direct marked reads, reactor
writes, and marked reads over the authenticated socket. It compares the exact
event delta, caller, receipt delta, unchanged prior rows, side rows, and wait
state. Valid owned withdrawals and wait-changing batches provide controls.
Temporary mutations verify each independent guard and refusal-write check.

## 414. The piece return-policy test accepted an extra engine event

Found: 2026-11-04, while repairing foundation review record FR-098.
State: fixed as a regression-proof gap.

What happened: The return-policy branch checked for the expected event's
presence and the absence of a queued notice. An extra withdrawal still passed.

What changed: All stopped or crashed, queued or sent return cases require the
exact returned singleton. The withdrawal, throwing-rule, and no-notice checks
remain. A temporary extra-withdrawal mutation must fail the corrected test.

## 415. The reactor test did not distinguish construction before the permit

Found: 2026-11-04, while repairing foundation review record FR-110.
State: fixed as a regression-proof gap.

What happened: The old sequence-only test passed when reactor construction
moved immediately before the writer transaction.

What changed: The regression holds the real writer permit, starts a reactor,
and proves construction has not entered. The earlier transaction commits
before releasing the permit. The reactor then checks its transaction entry
and fresh projected state. A temporary hoisted-construction mutation must fail.
The existing projected-reach regression remains.

## 416. Service-only command help claimed owner terminal access

Found: 2026-11-04, while repairing foundation review finding FR-027.
State: fixed.

What happened: The command-line help treated the absence of agent access as
owner-only access. The help for `roles.record`, whose only caller is a service,
therefore claimed that the owner could call it from the terminal.

What changed: The help lists the actual allowed caller kinds. The owner-terminal
statement appears only for commands whose sole caller kind is the owner.
Installed-command help checks cover service-only, agent-only, owner-only,
owner-and-agent, and owner-agent-service combinations.

## 417. The release tool had no purpose description

Found: 2026-11-04, while repairing foundation review finding FR-032.
State: fixed.

What happened: The Model Context Protocol (MCP) inventory derived `release` from
the command group, but its separate description table omitted that command.
An agent discovering tools received no explanation of its capacity-hold purpose.

What changed: The description names that purpose. The real `tools/list` check
requires a meaningful description for every offered tool and checks the capacity
hold meaning of `release`. Its explicit inventory and access exclusions remain.

## 418. JSON thread export lost its local destination

Found: 2026-11-04, while repairing foundation review finding FR-037.
State: fixed.

What happened: Generic JavaScript Object Notation (JSON) input returned from the
parser before export-specific validation and dropped the output path. The
command then connected and read a thread before failing at the local file open.
An empty path also reached the filesystem, and a blank path could create a file.

What changed: Thread export accepts its documented positional agent and `--out`
form. It refuses JSON input and empty or blank output paths as usage errors
before any connection or remote procedure call. Regression checks retain the
existing destination, verify that no connection or request occurs for invalid
arguments, and preserve paged export, local-only paths and mode 0600.

## 419. Command groups used a different order from the fixed contract

Found: 2026-11-04, while repairing foundation review finding FR-052.
State: fixed.

What happened: Both the command-group declarations and the merged request map
put the board before the client. Contract edit E1 requires engine, client,
board, then roles. Existing sorted inventory checks did not detect this drift.

What changed: Both declarations follow the specified order. A literal namespace
expectation checks the declarations and the contiguous request blocks through
the contracts and the engine's composed lists. The independent uniqueness and
engine inventory checks remain.

## 420. The roles registration check pinned only two command kinds

Found: 2026-11-04, while repairing foundation review finding FR-059.
State: fixed.

What happened: The G06 registration check omitted seven of the nine enabled
roles commands. Other behavioral tests, including A04, already protected
particular reads, but did not complete the required structural check.

What changed: G06 checks all nine enabled commands in their specified planner
or read table and requires their absence from the other table. A temporary
wrong-kind move of `roles.actions.list` proves that the expanded check rejects
that fault. The production registration and A04 remain unchanged.

## 421. Spaced client commands lacked whole-group regression coverage

Found: 2026-11-04, while repairing foundation review finding FR-099.
State: fixed.

What happened: The inventory and installed-command parity checks expanded dots
only for board commands. Twelve client command names lacked checks for their
fully spaced forms, including the nested settings setters.

What changed: Every installed dotted command except `debug.compare-views` has
fully spaced inventory matching, remaining-argument, help and dispatch coverage.
The dotted forms keep their installed-command checks. Explicit nested settings
checks guard longest matching, and the dedicated standard-input-only secret
checks remain. A temporary mutation removing only the spaced spelling of
`client.web.settings.set` proves that the strengthened checks detect that fault.

## 422. Opening a channel did not enforce its manager's unique names

Found: 2026-11-05, while fixing foundation review record FR-034.
State: fixed.

What happened: A fresh request identifier could open another plain or group
channel with a name already held by the same manager.

What changed: The opener checks the stored channel names and managers inside
the command's serialized writer transaction. Plain and group channels share
this namespace. Another manager can use the same name. An exact request retry
still replays its original receipt.

Validation: The new plain and group handler regressions rejected the unfixed
code. They cover distinct requests, exact replay, different managers, cross-kind
collisions, and two concurrent opens.

## 423. A disappearing board cursor restarted its filtered page

Found: 2026-11-05, while fixing foundation review record FR-035.
State: fixed.

What happened: Paging resolved its anchor inside the current selected result.
Closing, resolving, or hiding that anchor restarted the page at its beginning.

What changed: Paging resolves the anchor in the full stable order before
applying the current result selection. Post reads and status details use post
sequences. Channel reads use their stored order. Current authorization, encoded
byte limits, and reads without receipts remain in force.

Validation: Real handler regressions reproduced repeated earlier posts before
the fix. They cover closed, resolved, and newly hidden incoming anchors, status
incoming details, and own-open status details.

## 424. Four board regression proofs lacked discriminating fixtures

Found: 2026-11-05, while fixing foundation review records FR-096, FR-113,
FR-118, and FR-123.
State: fixed.

What happened: The page fixture never exceeded the singleton budget. Rebuild
coverage omitted a complete stop and addressed-post batch. A whole-event
substring assertion rejected valid identity values. The dispatcher regression
observed only the already reserved send order.

What changed: A schema-valid replay fixture now produces an encoded singleton
above 512 kibibytes and follows its cursor. Both stop/post/read orders compare
independent expected state with projection, durable live state, and a reopened
rebuild. Deterministic universally unique identifiers containing the registered
text value exercise free-text redaction alongside exact typed identities,
wake manifests, delivery sources, and receipt joins. Both reservation orders
run four controlled concurrent merge/close iterations and compare runner calls
with surviving wakes and committed withdrawals. The existing exact-output
terminal and Model Context Protocol tests remain unchanged.

Validation: Temporary production mutations exercise each new proof. No
production change is needed for these four test findings.

## 425. A manager transfer had no channel-name collision policy

Found: 2026-11-05, while checking the manager-transfer scope of FR-034.
State: fixed after the owner's decision on 2026-11-05.

What happened: Channels with the same name could meet at a successor manager.
The transfer event carried no renamed channel name.

What changed: Every transfer prefixes the channel's own name with the stopped
manager's normalized label. A later transfer replaces the prefix. The view
retains the original own name instead of splitting a displayed name at dashes.
A collision adds the first available numeric suffix, starting at `-1`.
The name keeps the existing character rules and 64-character limit.
The label is shortened first. The owner chose to shorten the displayed own
name only when necessary to keep that limit. The original own name remains
stored for later transfers. Membership, history, unread state and open questions
remain attached to the channel id. Older transfer events still replay.

## 426. Board recovery polling reads public dispositions as a keyed object

Found: 2026-11-05, while fixing foundation review record FR-097.
State: fixed in the board recovery acceptance helper.

What happens: The owner snapshot publishes an array of addressee and
disposition rows.
The recovery helper indexed that array by an agent identifier.
A terminal recipient already resolved as gone therefore looked unresolved.
An all-reply collection with another pending recipient could keep boot
waiting until its deadline.

What changed: The helper consumes the public `BoardPost` disposition type
and finds the matching addressee in its array.
The regression uses the actual snapshot producer with a crashed or
non-reloadable gone recipient and another pending, blocked recipient.
Both cases failed with the recovery timeout before the fix.
The helper still treats no-answer as provisional and waits for actionable
notifications.
Blocked notifications and failed or truncated snapshot sections retain
their existing behavior.

## 427. An idle reload suppresses a completed board response

Found: 2026-11-05, while extending the recovery checkpoints for FR-112.
State: fixed.

What happened: A service killed after an original or reminder response ended,
but before the reactor committed its next duty, reloaded the idle agent.
The new interruption, starting state and session-open events hid the earlier
response turn.
Recovery queued no carry-on for that idle agent, so the pending reminder or
no-answer disposition needed an unrelated prompt to progress.
The actual service kill regression failed at all three completed-response
checkpoints before the fix.

What changed: The board recognizes the complete idle reload sequence in its
durable thread and preserves the earlier completed response.
A working or paused interruption still requires a later response turn.
An incomplete reload remains unsettled.
The contract now distinguishes idle and working reloads.
The deferral matrix distinguishes a working interruption from an idle reload.
The process checkpoints cover the already completed idle response.
The regression kills the real service at complete transaction boundaries.

## 428. Capacity acceptance observed only an early counter and board wakes

Found: 2026-11-05, while repairing foundation review records FR-050 and FR-071.
State: fixed.

What happened: The Foundry capacity fixture copied its blocking-wait counter
before completing the worker. A later premature client reply escaped the
assertion. The lead-wake metric counted only board wake events, so engine-only
lead deliveries also escaped it.

What changed: The fixture records every client reply against the committed
worker completion sequence. It checks the wait satisfaction sequence after
that completion. It counts all lead delivery sends and runner prompts from
the capacity interval, with startup work explicitly excluded. Temporary faults
show that the old fixture accepted a late premature reply and extra lead work
during both hold and release. The corrected fixture rejects all three cases.

## 429. Board membership tests did not reserve concurrent writers in both orders

Found: 2026-11-05, while repairing foundation review record FR-083.
State: fixed.

What happened: Sequential label changes did not prove that queue and send
checks use membership protected by the writer permit.

What changed: Socket tests reserve each writer order at queue and send, with
six repetitions of each case. The second operation attempts its writer
acquisition while publication by the first operation is held. Withdrawn
identities never enter runner calls. A send reserved before removal remains
permitted. A temporary stale-snapshot fault is rejected.

## 430. Addressee tests stopped collecting at the first correct send

Found: 2026-11-05, while repairing foundation review record FR-084.
State: fixed.

What happened: The question and reply collections ended on their expected
recipient. An extra later send was outside the asserted intervals.

What changed: A companion socket test drains the real board lifecycle and
all four dispatchers to a fixed point. It checks each complete recipient
multiset, preserves the exact boundary between phases, and checks the final
interval after both expected turns finish. Temporary extra deliveries after
the correct question and completion sends are both rejected. The existing
service-process scenario remains in place.

## 431. Production board wakes had no sent-text event for their target

Found: 2026-11-05, while repairing foundation review record FR-074.
State: fixed.

What happened: The dispatcher committed the send identity but omitted the
existing `PromptSent` event. The board's criterion 5.14 therefore could not
observe sent wake text through the target's subscription or event read.
The queue envelope remains owner-only under the engine's visibility rule.

What changed: Every text send commits its `PromptSent` beside `DeliverySent`.
The existing delivery identity, incarnation, and send sequence still govern
the runner call. A production-built wake crosses the oversized stream limit
and is recovered whole by owner and target event and thread reads. The test
uses a large valid target identity to exercise event-metadata overhead beyond
the wake builder's reserved body space. Board events remain whole. Agent pages
cover quotes, backslashes, control characters, four-byte text, singleton
progress, exact cursors and read marks, fresh boundaries, and captured wire
frames. The command line and Model Context Protocol forward the labelled
board-read data unchanged.
The thread pagination boundary also preserves the sent-text event and checks
its complete delivery identity, sender, and text after the dispatch event.

## 432. An invalid agent recovery wrapper escaped typed failure handling

Found: 2026-11-05, while repairing foundation review record FR-025.
State: fixed.

What happened: The client parsed an agent's recovery data and accessed its envelope before validating the wrapper. JSON null caused a defect. Automatic subscription recovery only handles typed failures.

What changed: The shared client core validates the complete wrapper with the wire schema before accessing its envelope. Node and browser socket regressions exercise null, missing and invalid envelopes, invalid JSON and malformed framing. They require a retry from the cursor before the marker, ordered delivery after a valid retry, and a typed client error on exhaustion.

## 433. A thread read accepted a cursor beyond the durable log head

Found: 2026-11-05, while repairing foundation review record FR-040.
State: fixed.

What happened: The thread reader checked numeric cursor validity but returned an empty final page when the cursor exceeded the durable log head.

What changed: The reader compares the cursor with SQLite's durable head on the read connection. Equality remains valid. The published view still bounds the page. Regressions cover empty and populated logs, the public thread read, and a published view behind the durable log.

## 434. Client regressions omitted control-state and temporal boundaries

Found: 2026-11-05, while repairing foundation review records FR-056, FR-077, FR-095, FR-100, FR-103, FR-111 and FR-114.
State: fixed in the regression suite.

What happened: Snapshot replay compared identities without the changing control fields. Capacity parity omitted the hold boolean. Several wait fixtures could pass despite stale state or an omitted retry. The visibility fixtures reopened subscriptions after availability changes. The frame-boundary fixture stopped at its oversized marker.

What changed: Snapshot replay compares groups, lifecycle, counts and holders before, during and after publication for the owner and a fixed agent read set. The fold property compares capacity holds through release, stop and crash. Both wait modes begin with an empty held queue. The quiet retry respects its cursor. The resumed-member case publishes a complete boundary while one member works. The permission matrix covers an answered suffix and a genuinely held control in both delivery phases and modes. Both socket subscription surfaces remain open through pause, crash and recovery, and replay old events with recovered rights. A separate current-holder oracle replaces the static event matrix. The transport-boundary stream must deliver ordered catch-up and live tails after its marker. Temporary fault mutations verify the strengthened assertions.

## 435. The first alert scan selected a different silent recipient from the live follower

Found: 2026-11-05, foundation review record FR-041.
State: fixed.

What happened: The live follower kept the first no-answer resolution for an owner post. The first-start scan instead chose the first silent recipient in the post's recipient list. Reversed resolution order therefore linked the same matter to different agent threads.

What changed: The board fold retains the first agent whose no-answer resolution raised the owner's alert. The first-start scan uses that replayed identity for as long as the post remains open.

Validation: Reversed two-recipient scenarios compare the live and rebuilt alert keys, kinds, subjects, agent identifiers, and production thread routes. Both closing the post and dismissing its alert clear one alert without raising a duplicate. The regression failed against the original scan.

## 436. Alert list reads ignored the encoded page budget

Found: 2026-11-05, foundation review record FR-045.
State: fixed.

What happened: The alert reader applied only the item-count limit. Two individually valid piece subjects could exceed the 900 kibibyte budget together, without returning a continuation cursor.

What changed: The reader counts the complete encoded items, including array punctuation, escaping, timestamps, and delivery metadata. It retains the first whole item even when that item exceeds the budget. When another matching row remains, the cursor identifies the last included row.

Validation: The public command path covers large escaped and multibyte subjects, exact and one-byte-over boundaries, status filtering, cleared rows, the count limit, an oversized first item, and cursor progress. The over-budget cases failed against the original reader.

## 437. The carrier configuration test inspected baseline exclusion before work completed

Found: 2026-11-05, foundation review record FR-061.
State: fixed.

What happened: The test waited for one ordinary alert's delivery and then immediately asserted that no baseline alert had been sent. A delayed worker could run after those assertions.

What changed: A test helper observes the production delivery follower through its existing services. A subsequent reconciliation scan and joins of its worker fibers establish completion before the negative assertions. The test checks both successful and failed baseline attempts.

Validation: A temporary fault that permits baseline delivery and delays its worker is rejected by the corrected test. The fault is restored before committing.

## 438. The first-start tests did not start with a persisted carrier

Found: 2026-11-05, foundation review record FR-070.
State: fixed.

What happened: Existing first-start coverage had no carrier configuration before the initial scan. It could not prove suppression of baseline delivery together with later live delivery.

What changed: The new scenario persists a carrier and an open question with the client follower absent. It then starts the real follower and sender against a local fake carrier. It waits for a later live question to be delivered and for delivery work to complete.

Validation: The scenario requires exactly one carrier request and one delivered live alert, with no baseline delivery or failure attempt. Temporary baseline-send and disabled-all-sends faults are rejected. No physical phone is involved.

## 439. The alert crash fixtures missed the required process-death boundaries

Found: 2026-11-05, foundation review record FR-075.
State: fixed.

What happened: The source crash fixture had no active client follower. The baseline fixture injected a handled database failure instead of killing the writer inside its transaction.

What changed: A child now parks the real follower after it reads the source envelope and before appending its reaction. A second child parks after all baseline rows are staged on the transaction's writer connection and before commit. The parent kills each child with the SIGKILL signal.

Validation: The parent verifies the durable source and absent reaction, or complete absence of baseline rows after rollback. Two reopens require one recovered alert or one complete baseline, stable alert identifiers, and progress on later sources. Temporary lost-source and split-baseline faults are rejected. The handled-write-failure and recovery-gate scenarios remain.

## 440. Two new alert regressions selected different baseline threads

Found: 2026-11-05, while integrating the foundation board-recovery and alert repairs.
State: fixed.

What happened: The new first-start recovery fixture expected recipient-list order.
The independently verified alert repair preserves the first actual no-answer resolution.
The combined test failed with the correct recovered agent identity.

What changed: Both regressions remain.
The first-start fixture now expects the first resolved agent and explains that rule.
Its baseline, subject, unique-key, no-delivery and close assertions remain.
The separate live-versus-rebuild tests retain exact thread routes through close and dismiss.

Validation: The combined four-test file failed only at the old recipient-order expectation.
The same tests pass after that expectation is reconciled with the cause repair.
The run retains both logs and the complete resolution diff.

## 441. The backoff independence test dismissed the first alert

Found: 2026-11-05, while repairing foundation review record FR-053.
State: fixed.

What happened: The regression cleared the failed alert before raising another.
It did not prove that a sleeping retry leaves another open alert free to send.

What changed: A separate controlled-clock regression keeps the first alert open
with one failed attempt. It requires the second alert to deliver before the
first retry deadline. It then advances to that deadline and checks attempt two.
The existing clear-during-backoff regression remains.

Verification: A temporary serialization guard prevents the second delivery and
fails the new regression. The production worker is restored before committing.

## 442. Socket closure was treated as a persisted delivery outcome

Found: 2026-11-05, while repairing foundation review record FR-081.
State: fixed.

What happened: The large-response test checked the event log once immediately
after observing socket closure. The delivery continuation could still be
waiting to write its outcome.

What changed: The test waits for the alert-specific persisted failed attempt.
A controlled delay after the real transport closes keeps this boundary visible.

Verification: The earlier assertion fails with that delay. The corrected wait
passes with the real writer. A temporary omission of the failed-attempt write
fails the corrected regression. This establishes a scheduling proof gap rather
than an observed intermittent test failure rate.

## 443. The accepted-send crash fixture signalled before the failed write latched

Found: 2026-11-05, while repairing foundation review record FR-104.
State: fixed.

What happened: The child reported the raised alert before its delivery write
failed. Killing it after the carrier accepted the request did not prove that
the live delivery reactor stopped or that the writer latched.

What changed: The child observes the composed reactor's write-failure exit and
the service supervisor's stop decision. It removes the database trigger and
probes the same writer to prove that the failure remains latched. The parent
advances the live child's clock past retry deadlines and checks a stable
request count before killing it. The restart still proves at-least-once delivery.

Verification: Temporary faults exercise swallowed worker errors, a missing
writer latch, and supervisor restart after write failure. Production source is
restored before committing.

## 444. Large and slowly streaming carrier responses lacked later-progress checks

Found: 2026-11-05, while repairing foundation review record FR-106.
State: fixed.

What happened: The large-body test ended after its first outcome. No direct
fixture exercised a slowly streaming response body and a later alert source.

What changed: The large-body case waits for socket closure and a persisted
failed attempt before raising a new source and requiring delivery. A separate
streaming-body fixture writes repeated chunks without ending. It checks the
ten-second timeout, socket closure, persisted failure, and a later source's
first-attempt delivery before the failed alert can retry.

Verification: A temporary worker fault that blocks later alerts after a failure
makes both progress checks fail. No physical phone or external carrier was used.

## 445. The real web service fixtures skipped their live-view rebuild comparison

Found: 2026-11-05, while repairing foundation review record FR-068.
State: fixed.

What happened: The child services opened durable event logs, but the parent
fixtures declared that they had no log to compare.
Setup, running and restarted instances closed without comparing live views.

What changed: Each web child has a scoped stop operation that calls the existing
owner-only debug comparison before stopping the process.
Explicit stops and scope cleanup use that same operation.
The no-password, environment, redaction and durable-outage fixtures use it.
Comparison failures report no live values.

Verification: A temporary live-only projection field passes the original
fixtures and fails all three assigned child-service test files.
The mutation is restored before committing.

## 446. The heartbeat test did not require survival at the second tick

Found: 2026-11-05, while repairing foundation review record FR-105.
State: fixed.

What happened: The missed-heartbeat test waited through the second tick without
checking that the nonresponding connection remained open.
It could accept termination after one unanswered heartbeat.

What changed: The test requires both connections to remain open at 50 seconds,
after allowing network processing.
It still requires the nonresponding connection to close at 75 seconds.
The healthy connection remains its positive control.

Verification: A temporary one-miss threshold passes the original test and fails
the new 50-second assertion.
The mutation is restored before committing.

## 447. The disable test proved eventual closure without proving its order

Found: 2026-11-05, while repairing foundation review record FR-107.
State: fixed.

What happened: Polling until a port refused connections did not establish that
the server had stopped accepting before the settings command returned.

What changed: One test retains an accepted web connection and checks its closure.
Another observes real listener-close and accepted-socket-destroy operations.
It requires both operations before settings completion.
It does not require synchronous close delivery to the peer.

Verification: Temporarily delaying listener teardown passes the original test
and fails the new ordering assertion.
The mutation is restored before committing.

## 448. The session-expiry test advanced only Effect time

Found: 2026-11-05, while repairing foundation review record FR-109.
State: fixed.

What happened: A session lifetime implemented with the JavaScript wall clock
could survive the test's adjustment of Effect time alone.

What changed: The test advances Date.now after session creation as well as the
Effect test clock.
It restores the wall-clock observer through scope cleanup.
Network timers and engine followers continue to use real scheduling.

Verification: A temporary wall-clock session lifetime passes the original test
and fails the updated session check.
The mutation is restored before committing.

## 449. The bind-retry test reset the supervisor before proving repeated recovery

Found: 2026-11-05, while repairing foundation review record FR-116.
State: fixed.

What happened: The outage test replaced the listener after one failed retry.
A supervisor that retried only once per lifetime could pass.

What changed: A new regression holds one port through two failed retries of one
supervisor, then releases it and requires its next attempt to succeed.
It observes actual bind attempts at each 30-second boundary.
The existing restart, outage and disable controls remain.

Verification: A temporary one-retry supervisor passes the original outage test
and fails the new repeated-retry assertion.
The mutation is restored before committing.

## 450. The proxy-mode test changed the public address at the same time

Found: 2026-11-05, while repairing foundation review record FR-117.
State: fixed.

What happened: The proxy-mode invalidation fixture also changed publicAddress.
It could pass when only address changes invalidated connections.

What changed: Separate cases toggle only proxyMode in both directions.
Each starts with a canonical public address and two established connections.
Each requires both connections to close.
The other setting-change cases remain.

Verification: Temporarily retaining connections for a proxy-only change passes
the original setting-change tests and fails both new direction cases.
The mutation is restored before committing.

## 451. Loading a large action did not update its permission request's context

Found: 2026-11-05, foundation review record FR-038.
State: fixed.

What happened: A loaded content event stayed inside its placeholder component.
The thread watcher retained the marker, so the matching permission request still
showed the missing-input warning and lacked its local action context.

What changed: Successful content recovery enters the watcher's shared map by
sequence. Later publications retain the event without duplicating its marker.
Regressions cover live large actions, request-local context before Allow,
reconnection, unrelated identities, and retained partial-input warnings.

## 452. Situation lane tests did not distinguish questions or recovery states

Found: 2026-11-05, foundation review record FR-085.
State: fixed.

What happened: The fixtures exercised permissions, working agents, and idle
agents, but no question-only agent or paused, interrupted, or crashed agent.

What changed: Isolated fixtures require each predicate to place its agent only
in Needs you. Controlled live updates check entry, exit, and precedence while
retaining permission, working, and idle controls. Temporary mutations remove
each predicate and reverse precedence to verify the assertions reject them.

## 453. A navigation test could count Strict Mode's earlier cancellation

Found: 2026-11-05, foundation review record FR-089.
State: fixed.

What happened: An aggregate finalizer count could pass because React's Strict
Mode replay cancelled an earlier read before navigation.

What changed: The test identifies the active read generation before navigation
and requires that generation's finalizer afterward. Alerts and Settings are
covered with and without Strict Mode. A temporary mutation preserves replay
cancellation while omitting navigation cancellation.

## 454. The unknown-event thread test only covered history

Found: 2026-11-05, foundation review record FR-094.
State: fixed.

What happened: The named compatibility test did not deliver an unknown event
through the mounted thread's live subscription.

What changed: A controlled subscription emits unknown and supported events after
mounting. The test requires subsequent content, a usable prompt, and reconnect
cursors that include unknown events. Temporary mutations stop live continuation
or skip the unknown event's cursor advancement.

## 455. Recovery tests omitted the period before context was available

Found: 2026-11-05, foundation review record FR-108.
State: fixed.

What happened: Awaiting recovered content before inspecting the answer controls
could miss premature publication while an event read was pending.
The new rejection case also exposed partial history with enabled controls after
another request's initial context recovery failed.

What changed: Gated snapshot and oversized live recovery tests inspect the
pending interval before releasing context. They require no premature answer
command and verify context before enabled controls. The watcher now withholds
partial history until initial recovery finishes. Rejection and cancellation
remain non-actionable. A temporary early-publication mutation is rejected.

## 456. Matching-context assertions could read the ordinary thread article

Found: 2026-11-05, foundation review record FR-121.
State: fixed.

What happened: Container-wide assertions could pass when the matching file
change appeared only outside its permission request.

What changed: The test requires the path and diff inside the identified request,
unfolded and before its own Allow control. It separately retains the ordinary
article. Temporary absent, collapsed, and below-control mutations are rejected.

## 457. A placeholder test could not count an extra state-event placeholder

Found: 2026-11-05, foundation review record FR-124.
State: fixed.

What happened: The generic placeholder did not name its event tag, so asserting
that StateChanged text was absent could not detect an extra placeholder.

What changed: Combined content and state input must yield exactly one placeholder.
State-only input must yield none. The tests require lazy content reads and a
separate snapshot recovery for state. A temporary state-placeholder mutation
is rejected.

## 458. A successful push-setting test omitted the acknowledged checkbox state

Found: 2026-11-05, foundation review record FR-126.
State: fixed.

What happened: The test checked the command payload without inspecting the
checkbox after the successful acknowledgement.

What changed: The test gates the acknowledgement, requires a disabled pending
checkbox, then requires an enabled unchecked checkbox without a refresh.
A temporary mutation removes the saved-state update. The existing failed-save
rollback test remains in place.

## 459. The root acceptance gate omitted the required browser proofs

Found: 2026-11-05, while repairing foundation review record FR-065.
State: fixed as an acceptance-gate gap.

What happened: The root `pnpm check` ran typechecking, Vitest and the credit
check. It omitted Playwright. The old gate passed with an intentionally failing
browser test present.

What changed: The root gate now runs the complete Playwright suite after
Vitest. `pnpm test:browser` also runs that suite independently. Browser
execution has at most two workers. The client API plan records the Chromium
prerequisites and the aggregate gate in decision 205. Vitest still excludes
browser files because Playwright executes them.

Validation: Discovery includes login, external navigation and foreign-origin
checks. The repaired root gate executes and rejects the intentionally failing
browser assertion. The temporary failure is removed before the final gate.

## 460. The production-browser slow-link recovery proof was missing

Found: 2026-11-05, while repairing foundation review record FR-080.
State: fixed as a regression-proof gap.

What happened: Unit tests covered oversized state and separate read and stream
connections. They did not exercise the composed production browser on a slow
link, as client API criterion 7.14 requires. No production recovery failure was
established by that absence.

What changed: A production-bundle Playwright scenario starts an agent with a
300-kibibyte prompt and recovers large permission and harness changes. A real
proxy then paces encoded WebSocket bytes at 500 kilobits per second while live
state continues. The browser recovers a permission event over one mebibyte
once, on the same surviving read connection. Its roster, request identities
and counts converge. A controlled stream reconnect retains both requests, and
the owner answers the recovered request.

Validation: Chrome's debugger reads the initialized Effect pinger values in
the production artifact before throttling starts. The read interval is 25
seconds and its timeout is 50 seconds. The stream retains the five-second
defaults. The encoded recovery reply is 1,049,303 bytes and takes about 16.9
seconds. A temporary mutation restoring the read defaults fails the runtime
option assertions. This automated fixture does not claim the separate owner
phone or proxy checks.

## 461. The board browser journey did not identify its read and completion effects

Found: 2026-11-05, while repairing foundation review record FR-093.
State: fixed as a regression-proof gap.

What happened: Text visibility did not establish that following a notification
left its post unread. A removed form did not establish an answered parent.
An aggregate runner count did not identify the completion delivery.

What changed: The scripted agent posts through the real authenticated Unix
socket. A fake carrier sends the notification to the production browser.
The test checks the durable owner read count before navigation, before the
tap and after the tap. It checks the exact parent's answered outcome. It ties
the completion wake to the original post, its owner reply, its target agent,
the queued delivery, the sent delivery and the prompt received by the real
agent process. Two controlled flushes and dispatch drains preserve one
completion. The fixture uses the production state-folder permissions.

Validation: Temporary mutations silently mark a linked post read, close its
parent with the wrong outcome, or omit the completion reply manifest. Each
fails its new discriminating assertion. The plain-text rendering, notification
privacy, session-cookie and alert-clear checks remain.

## 462. The terminal viewer integration peer accepted any request source sequence

Found: 2026-11-05, while repairing foundation review record FR-088.
State: fixed as a regression-proof gap.

What happened: The fake event responder returned permission event 9 for every
numeric sequence. The integration test could pass if the application requested
the wrong source event.

What changed: The peer refuses any sequence other than 9. The test independently
checks the observed sequence, requires the context read before the answer, and
keeps the context-reading and selected-answer assertions. A temporary wrong
sequence in the application must fail the corrected integration test.

## 463. Permission closure tests did not prove answered action removal

Found: 2026-11-05, while repairing foundation review record FR-091.
State: fixed as a regression-proof gap.

What happened: The routing fixtures checked action removal only on cancellation.
The reducer's answered fixture began without action data. A retained action in
an answered row could escape both expectations.

What changed: The routing and reducer tests independently assert populated
action data before closure. Separate answer and cancellation projections require
the action property to be absent. Status, selected answer, answering actor, and
cancellation reason remain checked. Temporary action-retention mutations in each
closure branch must fail the corrected tests.

## 464. Foundry wrap-up assigned owner-only thread exports to agent leads

Found: 2026-11-05, while repairing foundation review record FR-020.
State: fixed as a documentation conflict.

What happened: The recipe asked each lead to export conversations without
an owner-side caller or handoff. The exporter requires structured owner
pages. An agent receives an enveloped reply even when it may read a child's
thread, so its export is refused.

What changed: The owner exports the requested threads from an authenticated
terminal and confirms the archive paths to each lead before reporting.
Cleanup waits for those files to be saved in the run archive. This agrees
with the owner client used by the live roles script. Agent credentials and
data envelopes keep their existing boundaries.

## 465. The Foundry channel example used a display name instead of a valid channel name

Found: 2026-11-05, while repairing foundation review record FR-036.
State: fixed as a documentation conflict.

What happened: The Step 3 example used `Backend team`. The channel name
schema refuses spaces, and the command line does not normalize the name.

What changed: The example uses `backend-team`. The recipe states the existing
letter-first, 64-character limit and allowed letters, digits, underscores
and hyphens. The schema and command behavior are unchanged.

## 466. The board read criterion promised services a plain post page

Found: 2026-11-05, while repairing foundation review record FR-079.
State: fixed as a documentation conflict.

What happened: Criterion 5.16 grouped the owner and services together for
plain `board.read` replies. The contract and command access table forbid
service reads of posts.

What changed: Criterion 5.16 now requires the owner's plain reply, the
agent's unchanged data envelope, and refusal for a service. No access was
widened, and the existing read and wrapping checks remain.

## 467. The README said nothing was built after foundation implementation

Found: 2026-11-05, while checking the foundation documentation repair scope.
State: fixed as a documentation problem.

What happened: The README's opening warning said nothing was built. The
service composition already registers the engine, client, board and foundry
supervision implementations. The foundation review and its repairs are in
progress, so implementation presence does not mean release clearance.

What changed: The warning describes the implemented foundation and ongoing
review. It keeps standing permission rules, real-account checks and physical
phone checks separate from completed implementation. It makes no claim that
the build is released or cleared. The recipe and plan corrections in this
change do not build roles units 3, 4 or 11a.

## 468. Recording cleanup could leave a descendant running after the adapter closed

Found: 2026-11-05, while repairing foundation review record FR-043.
State: fixed.

What happened: Closing the adapter resolved the recorder's close promise.
The finalizer then cancelled group escalation before a descendant that
ignored termination had exited. A descendant with released standard streams
could outlive the recording and the caller's temporary-workspace removal.

What changed: Recording completion awaits cleanup of the owned process group,
including bounded forced termination after the leader has exited. The version
probe uses the same cleanup. Linux liveness checks exclude killed zombies
that cannot execute or hold the workspace. Real-process regressions cover
successful recording, failure, cancellation and a version-probe descendant.

## 469. The roles live check omitted a positive first-stall observation

Found: 2026-11-05, while repairing foundation review record FR-064.
State: open for the owner's real-account execution.

What happened: The live workflow rejected a false stall during collection,
but never observed a genuine idle obligation through its first production-minute
stall. The in-process acceptance test did not supply the retained child-process
proof required by post-build check 7.

What changed: The owner-run workflow now gives one worker an unanswered post,
waits for its production stall interval without changing the clock or limits,
and requires one stall action, one nudge wake and the worker's later reply.
Its private report retains the event identities and elapsed milliseconds.
The owner must run `pnpm live-check:roles` and retain the authentic report.
No real account or owner recording was used for this repair.

## 470. The roles live observer could count evidence outside the selected wave

Found: 2026-11-05, while repairing foundation review record FR-125.
State: open for the owner's real-account execution after observer repair.

What happened: Orientation evidence was not bound to the selected post or
channel. Aggregate answered closure and acknowledgments could coexist with
a terminal non-reply disposition instead of a reply from each worker.

What changed: Each exact worker must supply an authenticated orientation reply
on that wave and channel. Its replied disposition must name that reply as its
deciding post. Manual positive and negative controls exercise the observer.
The owner must rerun the real-account workflow before this proof gap closes.
The unit 14 ruling against a new required automated suite remains in force.

## 471. The service-resume test omitted failed setup attribution

Found: 2026-11-05, while repairing foundation review finding FR-120.
State: fixed.

What happened: The focused service-caller test exercised only successful
reloads. Its later-write query excluded owner rows before checking attribution.
The correct production failure path therefore lacked proof that its later
state and failure rows retain the service and its optional rule.

What changed: Four cases reject the actual load or fresh-start setup, with
and without a service rule. They inspect every target row after the command's
watermark, including the later failure transaction, without filtering callers.
They require the exact service, rule, failure state, transaction identity and
revocation of both the old token and the setup token. The successful reload
case remains and no longer excludes owner rows. Temporary faults separately
replace the failure caller, discard its rule, omit token revocation and replace
the success caller. No production attribution change is needed.

## 472. Reply fragments lost their message identity

Found: 2026-11-05, during the first real-agent browser repair.
State: fixed.

What happened: The Agent Client Protocol adapter's message identity was dropped.
The runner emitted separate updates, and the engine gave every fragment a new
thread item identity. Both clients rendered each event as a separate block.

What changed: The runner assigns one internal identity to each adapter message
within a turn. It preserves that identity when a message resumes after another
update. Adapters without message identities use a contiguous message run.
The engine stores the identity with every delta. Both clients fold deltas by
identity after paging and sequence deduplication. Text remains plain text.

## 473. Tool updates appeared as repeated serialized objects

Found: 2026-11-05, during the first real-agent browser repair.
State: fixed.

What happened: Every tool update became a separate displayed event. Structured
command input and output were serialized rather than displayed as readable text.

What changed: Both clients fold tool updates by call identity within a turn.
An omitted input, output or status preserves its earlier value. Commands and text
content are extracted for reading. Terminal snapshots display their output,
exit code and truncation notice. The stored terminal payload remains structured.

## 474. A sent prompt duplicated its queued source

Found: 2026-11-05, during the first real-agent browser repair.
State: fixed.

What happened: A first prompt in the agent's start event, or a later queued
prompt, was displayed again when its sent event arrived.

What changed: Each client displays the source once with its sender and delivery
states. The web page retains the full queued, sent and accepted history.

## 475. Startup failures hid their safe cause

Found: 2026-11-05, during the first real-agent browser repair.
State: fixed.

What happened: Every start failure recorded the same generic reason. A failed
agent looked stopped, and a prompt returned a bare refusal. Extra Codex account
names implicitly selected private empty logins. A combined model and effort
string was passed as a model and refused by the adapter.

What changed: Setup failures record fixed reason codes for authentication,
model, effort, mode, startup and timeout failures. An unsigned extra Codex
account identifies its private login. The roster, thread and prompt refusal
explain the code. Raw adapter errors are never persisted or sent to clients.
The default account remains `codex`. Both existing live workflows already use
that account. The setup guide documents separate model and effort settings.

## 476. The page lacked stop and resume controls and mislabeled stopped agents

Found: 2026-11-05, during the first real-agent browser repair.
State: fixed.

What happened: The thread offered no stop or resume action. The situation page
placed stopped agents, including failed starts, in the idle section.

What changed: The thread calls the existing stop and resume commands. A stopped
agent without a session uses a fresh resume. The situation page has a stopped
section with safe failure reasons. A password-authenticated web caller already
has owner access to these commands, so no permission rule was widened.

## 477. The browser journey had no repeatable real-agent check

Found: 2026-11-05, during the first real-agent browser repair.
State: implemented; the result file records the actual execution outcome.

What happened: Fake-agent suites did not expose the real adapter's fragmented
replies, repeated tool updates and account selection behavior.

What changed: `pnpm live-check:web` starts a private engine and a real Codex
agent, then exercises the authenticated browser journey and checks its file
side effect. It prints fixed step results and removes its own processes and
folders. It remains outside `pnpm check` because it consumes a real account.

## 478. A manager transfer reset the successor's unread position

Found: 2026-11-05, by the separate verifier of the live browser fixes.
State: fixed in repair round 2.

What happened: The manager-transfer reducer initialized the successor's read
position even when that successor already belonged to the channel.
Unread posts became read without the successor reading them.

What changed: The reducer checks membership before changing the manager.
An existing member keeps their position in both plain and group channels.
A new member still receives the normal initial position.
The transfer regression now checks the successor's own position and unread post.

## 479. The page could not resume a session that could not be reloaded

Found: 2026-11-05, by the separate verifier of the live browser fixes.
State: fixed in repair round 2.

What happened: The page requested a fresh resume only when there was no stored
session. A stored session with `reloadable: false` was refused on every retry.

What changed: That snapshot now selects a fresh resume.
Before the action, the page explains that it starts a new session and loses
the old session's context. Reloadable sessions retain their context.
An agent without a stored session keeps its existing fresh-resume behavior.

## 480. Older logs retain separate reply fragment blocks

Found: 2026-11-05, by the separate verifier of the live browser fixes.
State: accepted display limit by the owner's round 2 assignment.

What happens: Logs written before the message-identity fix assigned a different
item identifier to every reply fragment. Those fragments remain separate blocks
in the web page and the terminal viewer. They remain readable.

The affected logs are today's test threads. The owner chose to retain this
limit. No migration or inferred grouping is added. Newly written fragments
with a shared message identity use one growing block.

## 481. The real browser reply check could overlook extra blocks

Found: 2026-11-05, by the separate verifier of the live browser fixes.
State: fixed in repair round 2.

What happened: The check counted only articles containing a short expected
reply. Other articles from the same turn did not affect that count.

What changed: The check records the number of agent-message articles before
the turn and requires exactly one additional article after it ends.
That article must hold the complete fixed sentence of more than thirty words.
A browser regression rejects extra blocks even when one has the whole sentence.
No timing assertion about streaming growth is made.

## 482. Readable tool input replaced the original arguments in stored events

Found: 2026-11-05, while checking the live-check regression from pull request 21.
State: fixed on `area/live-fixes-2`.

What happened: Commit `70f64eb` applied the display formatter to tool input
before storing it. A shell input became its command text and lost its other
arguments. The live probes expected a serialized object, so they rejected even
the exact requested command. Other input shapes could also lose fields.

What changed: The translator stores the complete serialized input again.
The web page and terminal viewer already derive readable text at display.
Exact command matching also reads earlier plain-text entries with the same
whole-command comparison and canonical shell wrappers. Foreground and folder
checks require structured arguments and reject entries that lost them.
The regression passes the real translator's stored input to the probe matchers.
It checks both update variants, shell wrappers, background flags, other tool
arguments, and historical entries.

## 483. The display formatter breaks deferred-tool discovery evidence

Found: 2026-11-05, in the real live check on `area/live-fixes-2`.
State: fixed in round 2 on `area/live-fixes-2`.
The owner identified this as the output side of the same storage regression.

What happened: The Claude lead used the exact permitted ToolSearch query for
the ask tool. Its completed output contained the matching tool reference.
The translator's output formatter flattened the reference array into a
pretty-printed object. `mcpAskDiscovery` still requires a serialized array
on each output line. It rejected this output before the Codex sandbox probe
could run, even though Claude's authenticated ask succeeded.

Evidence: `/tmp/lgtm-live-IEqoM1/state/events.sqlite`, read-only.
The grouped discovery starts at sequence 148.
The exact ask starts at sequence 152.
The assigned run folder contains `live-check.log` and the result report.

What changed: The translator serializes original output and content blocks.
The web page and terminal viewer continue deriving readable text at display.
The probe merges output as replacement snapshots and preserves omitted fields.
The discovery matcher decodes the original result and recognized content
wrappers. It also reads historical arrays and formatted reference objects.
Every reference must still name only the exact ask tool.

Terminal output keeps its existing redacted, bounded, serialized snapshots.
A terminal reference alone no longer writes an empty generic output.
An explicit empty result still replaces earlier output.
Shell evidence is decoded before line matching, while structured exit codes
remain available for inspection.

The extended translator regression tests exercise discovery and shell evidence
through the real probe driver. They also check historical output, terminal
snapshots, replacement updates, omitted fields, and empty results.
The assigned run folder contains the round 2 check logs and result report.
No deferred security issue was repaired to improve the live-check count.

## 484. LGTM Studio's own tools can wait for harness approval

Found: 2026-11-05, during the roles live check's `wave` step.
State: fixed on `area/lgtm-tools`.

A Claude lead in ask mode requested permission for `mcp__lgtm__roles_orient`.
The run waited five minutes because nobody answered that request.
The owner decided that LGTM Studio's own tools need no harness approval on any
harness or permission mode. Codex already had this setting through issue 236.

Claude's pinned `claude-agent-acp` 0.99.1 accepts
`_meta.claudeCode.options.allowedTools` on session creation and reload.
The runner supplies the server rule `mcp__lgtm` to the Agent Software
Development Kit 0.3.312. It does not write a settings file.
The real Haiku read-only proof found that plan mode still asks despite this
rule. The runner answers once when the SDK's structured server identity is
`lgtm` from source `dynamic`, with the matching structured tool name.
Protocol version 2 puts that name in `toolCall.name`.
Protocol version 1 puts it in `_meta.claudeCode.toolName`.
Configured and plugin sources with the same name keep their normal hold.
Codex keeps its existing server-specific `default_tools_approval_mode`.

Gemini is not installed here. The published Gemini CLI 0.67.0 bundle's
`AcpSession` attaches `_meta['gemini-cli'].mcp.server_name` and `tool_name`
to an MCP permission request. Its session configuration discards server
trust for client-supplied servers. The runner answers the unique one-time
allow option only when this structured identity names its own server.
Missing identity, another server, or ambiguous options keep the normal hold.
Older Gemini versions without this metadata still require a person's answer.

Cursor 2026.10.14-941492e drops the provider identity from permission requests.
Its `InteractivePermissionsService.shouldBlockMcp` can reject a read-only
call before asking the client. The runner therefore uses a private copy of
`cli-config.json` through `CURSOR_CONFIG_DIR`. It adds one native
`Mcp(server:*)` allow rule for a fresh, random server name. The random name
keeps Cursor's case-insensitive matcher from matching an owner's other server.
The process scope removes the copy after the child stops. The owner's files
stay unchanged. Neither the global `--approve-mcps` flag nor a mode bypass
is used.
Cursor's session history stays in the engine's per-agent state directory.
The disposable settings directory links to it so that a reload can recover
the conversation. See issues 488 and 489 for the real Cursor follow-up.

The source comments in `AcpRunner.ts`, `codexMcp.ts`, and `cursorMcp.ts`
identify the adapter versions and source entry points. The runner tests cover
every harness and permission mode, session creation and reload, other servers,
native tools, uncertain Gemini identity, and private Cursor settings cleanup.
Every LGTM Studio call still passes through the existing authenticated engine
handlers and their caller-rights checks. An API question still reaches its
recipient; only the harness approval prompt is exempt.
Real verification and the full check results are recorded beside the assigned
brief in `.scratch/foundry-runs/foundation-plans-1/lgtm-tools/result.md`.

## 485. Cursor's native login store is missing from credential redaction

Found: 2026-11-05, while reading Cursor's installed permission implementation.
State: open. This is outside the approval change.

`credentialSourceFor` currently has no Cursor file paths because its original
scouting established only an environment key. Cursor 2026.10.14-941492e's
credential manager uses `XDG_CONFIG_HOME/cursor/auth.json` on Linux, or
`HOME/.config/cursor/auth.json` when that variable is absent. A token that
exists only in that file is therefore absent from the engine's credential
registry. Explicit account secrets remain registered as before.
The source is the installed `index.js` credential manager's `getAuthFilePath`
and `readAuthData` methods. No credential values were read for this finding.
The registry needs this source, its refresh behavior, and regression coverage
before Cursor's native login can be claimed to have the same coverage as
Claude and Codex.

## 486. The live check relies on an LGTM Studio permission prompt for Claude options

Found: 2026-11-05, in the first approval-free tools live check.
State: fixed on `area/lgtm-tools`.

The `permission-kinds` observation ran immediately after `sandbox-mcp`.
Its only Claude permission evidence came from the LGTM Studio call that no
longer asks. The step failed with no observed Claude options.
The observation now follows `always-allow`, which attempts a native command
and records its real offered options. The option checks still require
observed evidence for both harnesses. No accepted outcome or security gate
was relaxed. The independent probe order and its regression tests were updated.

## 487. A Codex live probe can choose web search instead of the requested MCP tool

Found: 2026-11-05, in the second approval-free tools live check.
State: open. This is separate from the permission change.

The `sandbox-mcp` prompt required exactly one LGTM Studio `ask` call and prohibited
other tools. The Claude call completed and created its authenticated question.
The Codex turn issued a native web search with an empty query instead.
The existing strict probe rejected this unexpected call. It did not treat the
agent's reply as tool evidence. The Codex approval configuration was unchanged.
The separate Luna proof completed `roles.orient` and `ask` without permission.

Evidence: `/tmp/lgtm-live-BNBMph/state/events.sqlite`, read-only.
The unexpected web search is at sequences 157 and 158.
After reload, the same Codex agent repeated its hold command and ended its
turn without the requested MCP question. The strict reload observation timed
out. Its turn ends at sequence 930. The run passed 17 of 23 steps, and its
log is saved beside the assigned brief as `live-check-attempt-2.log`.
The cause of this model behavior is not established. The probe's allowed
inputs and accepted outcomes remain unchanged.

## 488. Cursor's Auto model uses a different protocol identifier

Found: 2026-11-05, during the requested real Cursor proof.
State: fixed on `area/lgtm-tools`.

The installed Cursor version `2026.10.14-941492e` lists `auto` in its terminal
model catalog. Its Agent Client Protocol (ACP) session instead advertises
`default[]`, named `Auto`. Sending `auto` as a configuration value failed
before a model prompt was sent. The permitted fallback `grok-4.7-medium`
was also refused before a prompt. Both failures were recorded as
`AgentStartFailed` with reason `model-refused`.

The source is `6136.index.js`, in `buildVariantModelConfigOptions` and
`applyVariantModelConfigOption`. A direct, prompt-free ACP inspection confirmed
the advertised value. The runner now translates the requested Cursor model
`auto` only when the exact option `default[]`, named `Auto`, is advertised
once. A native `auto` option takes precedence. No other model is substituted.
Creation, load, and resume tests inspect the actual configuration frame.
Uncertain and duplicate options retain the original request and its refusal.

## 489. Disposable Cursor settings also contain its session history

Found: 2026-11-05, while preparing the real Cursor reload proof.
State: fixed on `area/lgtm-tools`.

Cursor `2026.10.14-941492e` stores its ACP session databases beneath
`CURSOR_CONFIG_DIR/acp-sessions`. Its installed `6136.index.js`, in
`acp-storage.ts`, resolves this path for both new sessions and session load.
Removing the private settings directory would also remove the conversation
needed by a replacement process. This was found by source inspection before
attempting the requested reload.

The runner now links the disposable directory's `acp-sessions` entry to
`cursor-sessions/<agentId>` inside the engine's state folder. The directory
has mode 0700. Each agent gets its own history. Settings and approval rules
still disappear when the child stops. The owner's files remain unchanged.
The runner tests verify the link, its permissions, and retained history
after process cleanup. The real run's observed results are recorded beside
the assigned brief in `cursor-proof.md`.

## 490. Cursor restores the previous MCP provider name on reload

Found: 2026-11-05, during the requested real Cursor reload proof.
State: fixed on `area/lgtm-tools`, with a successful live stop/resume proof.

The read-only Auto session loaded successfully. Its one permitted extra
prompt called `roles.orient` using the provider name from the conversation.
The replacement process had a new random name and a native allow rule for
that new name. Cursor therefore requested human approval for the old name.
The request is at sequence 80 in
`/tmp/lgtm-live-C4DAkt/state/events.sqlite`.

The runner now persists each agent's unguessable name beside its session
history, in a file with mode 0600. The replacement process uses that same
name and grants only that server's rule. Other agents receive different
names. An invalid saved identity refuses startup. A regression starts,
stops, and loads the runner, then inspects both the ACP server identity and
the replacement process's native allow rule. The first brief's single extra
live prompt was already used, so that follow-up left live verification open.

The manager then sent one more real reload proof assignment. On commit `6bea2c4`,
a Cursor Auto agent in ask mode completed `roles.orient` and `ask`, ended
its turn, stopped, and resumed the same session. The second prompt completed
both calls and ended its turn. Neither turn requested permission.
The database is `/tmp/lgtm-live-E1UN83/state/events.sqlite`.
The initial orientation, question, and turn end are at sequences 51, 55,
and 61. The agent stopped at sequence 62 and reloaded at sequence 66.
The second orientation, question, and turn end are at sequences 89, 93,
and 98. The session and provider identity stayed the same.
The detailed evidence and remaining limits are recorded in `cursor-proof.md`
beside the assigned brief. No application fix was needed for this run.

## 491. The roles live check rejected the board's expected no-answer disposition

Found: 2026-11-05, after the owner's roles check at `5dd41b7`.
State: fixed on `area/lgtm-tools`; the owner must repeat the real stall check.

The wave and timed flush passed in `run-TnMigw`. The first-stall check
rejected every `board.AddresseeResolved` event, including `no-answer`.
The worker ended its initial turn at sequence 280. The board sent its
reminder at 281. The worker ended the reminder turn at 305, and the board
recorded `no-answer` at 306. The check stopped before awaiting a stall.

The product correctly leaves that addressee eligible in `stall.ts`.
The board keeps the all-mode post open after `no-answer`. The stall view
restarts its timer at each eligible worker turn end, so sequence 305 is
the origin in this case. Sequence 280 would start the timer too early.

The check now requires the matching reminder, its accepted delivery, the
reminder turn end and the no-answer disposition. It still rejects an early
reply or closure. The first nudge must use the latest worker turn end
before the planned notice and wait the unchanged production interval.
Regression tests cover that sequence, later idle turns, missing reminder
evidence, early replies, early or stale timers and duplicate stall actions.

The owner can use `--skip-timed-flush` to avoid repeating the cache wait.
That step is reported as skipped. A run whose other steps pass reports
`INCOMPLETE` and exits with code 1. A scripted client regression exercises
the remaining journey, exports and cleanup without starting real agents.
No real roles run was performed for this fix.

## 492. The roles worker prompt did not cover the board's stall reminder

Found: 2026-11-05, during the owner's roles check at `bac865a`.
State: fixed on `area/lgtm-tools`; the owner must repeat the real stall check.

The Luna worker left the initial obligation unanswered and ended its turn
at sequence 272. The board sent its reminder at 273. That reminder asks
for a reply even when the recipient has nothing to add. The worker replied
at 281, and the post closed as answered at 283 in `run-AMeu00`.
The product behaved correctly, and the check correctly rejected the early
reply. The worker's prompt had not explicitly covered the reminder turn.

The prompt now identifies the reminder about `roles-live-first-stall` as
expected. It distinguishes that reminder from the stall watch's notice.
The worker must leave the obligation unanswered, must not call `board.post`,
and must end the reminder turn with the word waiting. It may reply only
after a notice authored by `roles.stallWatch`. A prompt regression checks
these instructions and their inclusion in both worker start inputs.
The check's assertions and the product code are unchanged.
No real roles run was performed for this prompt fix.

## 493. The live startup preflight depended on the owner's Herdr service

Found: 2026-11-05, during the standalone LGTM Studio split.
State: fixed on `area/lgtm-split`.

The live check required a Herdr startup hook to have started a service in the
owner's real state folder.
That preflight prevented a standalone installation from checking the core.
The rename also changes the default state folder, so an older running
service cannot prove that the renamed plugin hook works.

The plugin now owns the hook probe.
The live check runs the plugin manifest's command twice in private temporary
state and checks that both calls use one service.
It reports SKIP when Herdr is absent.
An optional skip permits the core checks to continue and does not turn a
complete core run into a failure.
The owner's service is outside the probe's startup and cleanup paths.
Plugin integration tests cover both the absent case and a real private hook
launch, and the scripted journey covers an absent plugin through recording.

## 494. The first app mock obscured project and team navigation

Found: 2026-11-05, during the owner's app review.
State: changed in the mock; awaiting owner review.

What happened: The owner could not tell what Team Board, Threads, Work, and
Files meant, or how to switch teams. The project dropdown also used much
smaller type than the project identity.
What changed: The first revision added a project overview and dropdown,
which the owner also found confusing. The current revision replaces those
with one stable project tree containing the project lead, teams, and agents.
Projects remains a separate list page. Team views are Conversation, Tasks,
and Changes. Each message names its sender, role, and coding tool.
Why it matters: The owner can evaluate the hierarchy with distinct sample
teams. This remains an isolated browser mock.

## 495. The app mock feels generic despite its custom palette

Found: 2026-11-05, during the same review.
State: redesigned in the mock; awaiting owner review.

What happened: The owner said the interface resembles other interfaces made
with AI and asked whether the UI skill caused it. The design-forge skill
permits one style with different palettes and directs token-only iteration.
The agent also chose conventional sidebar, conversation, context-panel,
system-type, and rounded-border patterns.
What changed: After the owner explicitly requested T3 Code and Cursor as
references, the mock was rebuilt with compact tree navigation, a primary
conversation column, and tasks and changes that open separately. Repeated
summary cards, the context column, and the overview detour were removed.
Field and Dusk remain the approved palette pair. No skill was edited.
Why it matters: Mechanical checks and palette selection do not establish
a distinctive visual identity or a clear workflow.

## 496. The draft new-folder form relied on an invalid browser pattern

Found: 2026-11-05, while checking the Projects mock.
State: fixed in the mock.

What happened: The draft folder-name pattern was invalid under the browser's
regular-expression rules. A sample folder name containing `../` could
therefore reach the mock's in-memory project list. No disk operation occurs
in this prototype.
What changed: The submit handler checks the folder name explicitly before
adding an example repository. The browser probe exercises duplicate names
and path traversal.
Why it matters: The mock should demonstrate a project folder inside its
workspace. Production will also require server-side path validation.

## 497. The redesigned mock lost context and hid pending decisions

Found: 2026-11-05, during the requested design critique.
State: fixed in the mock; visual refinement awaiting owner review.

What happened: Wide layouts separated the heading from the reading column.
The pending decision began below the conversation viewport. Switching
conversations discarded drafts and reading position. Similar chevrons had
different behavior, and collapsing the current project removed its location
indicator. Agent activity did not connect clearly to assignments or reviews.
The mobile menu and Send controls were too small.
What changed: One frame aligns the main surfaces. A persistent attention
entry jumps to the actual decision. Each conversation keeps its draft and
reading position, and teams remember their last tab. Disclosure and
navigation use separate controls. Task details connect assignment, handoff,
review, changed files, and the owning agent. Mobile navigation manages focus,
and its controls have larger targets. Field and Dusk remain unchanged.
Why it matters: The owner can follow work and move between conversations
without losing their place. The durable browser probe passed 58 assertions
with no JavaScript errors. It covers both modes at 390, 768, 1440, and 2560
pixels. This remains an isolated prototype with fictional work.

## 498. The refined mock did not express the requested project workflow

Found: 2026-11-05, during the next owner review and independent critique.
State: changed in the mock; awaiting owner review.

What happened: The branch-looking control could rebind a project to another
repository. Project entry opened a team or the last arbitrary view. There
was no project board or sprint model. Sage did not surface Rowan's request,
and attention opened the team thread instead of Rowan's question. The
chat received only 465 of 900 desktop pixels and 408 of 844 phone pixels.
What changed: The owner clarified repository → projects → one lead per
project → teams. The mock now follows that structure. Repository pages
list projects. Projects open their lead conversation and have a sprint
board. Task and sprint views connect owners, dependencies, requests, and
completion evidence. Branch selection only changes inspected code context.
Requests open the requesting agent's exact question and resolve everywhere.
The compact chat has 687 of 900 pixels on desktop and 626 of 844 on phone.
Why it matters: The owner can follow a project's plan and steer its lead
without reconstructing progress across every conversation. The final
browser suite passed 72 assertions with no JavaScript errors.

## 499. The active project's metadata missed the text contrast target

Found: 2026-11-05, during the same browser critique.
State: fixed in the revised mock.

What happened: Muted small text over the selected background measured 4.4:1
in Field, below the 4.5:1 design contract.
What changed: The previous blended project-count treatment was removed.
Selected project, board, team, and workspace metadata use the existing
primary text token. Browser measurements are 9.17:1 in Field and 8.68:1 in
Dusk for those selected labels. The approved palette blocks are unchanged.
Why it matters: Selected navigation metadata stays readable. Computed
contrast was checked in the browser, because the command-line detector's
regex fallback cannot evaluate it.

## 500. Resolved requests still looked urgent inside their task

Found: 2026-11-05, during cold verification of the repository/project mock.
State: fixed in the mock.

What happened: Answering Rowan cleared Sage and the board, but opening
SH-17 still showed the amber request link while the task said Done.
What changed: Task details render a recorded-direction message for a
resolved request. A durable browser regression first failed on the stale
urgent link and then passed after the fix.
Why it matters: One answered request must have the same meaning everywhere.

## 501. A completed sprint could accept unfinished scope while remaining Done

Found: 2026-11-05, during the same cold verification.
State: fixed in the mock.

What happened: Adding a queued task to SP-01 left it in Done with 3/4 tasks
and a verified-and-merged label.
What changed: Completed sprint details have no Add task action. The task
form disables completed sprints, and submission rejects them. The browser
regression covers both controls.
Why it matters: Completion evidence applies to the work that was verified.
New scope must belong to an unfinished sprint.

## 502. Team replies and task-change links could use the wrong agent context

Found: 2026-11-05, while verifying multiple teams in the mock.
State: fixed in the mock.

What happened: A team sample reply used a synthetic recipient with no
initials. A task's View changes action could fall back to the first team.
What changed: Team replies identify the responding lead. Task links carry
the actual owning team. Workspace app now has App shell and Review teams,
and the browser probe follows SH-16 into Review's Changes view.
Why it matters: The named sender and team must match the assignment when
several teams share one project.

## 503. Project selection hid the board and its branch assignment

Found: 2026-11-06, during the owner's mock review.
State: changed in the mock; awaiting visual review.

What happened: Selecting a project opened its lead conversation. The
project did not state its assigned branch in navigation or on its board.
The inspection picker was the only visible branch label.
What changed: Project selection now opens the sprint board. Chat and Talk
to the lead remain explicit actions. The assigned branch appears beneath
the project name and beside the board title. The inspection picker says
Viewing and leaves that assignment unchanged.
Why it matters: The project opens with its overall status. The owner can
see where its work belongs while inspecting a different branch.

## 504. The board had a redundant navigation row and a separate lead chat

Found: 2026-11-06, during the owner's mock review.
State: changed in the mock; awaiting visual review.

What happened: Clicking a project already opened its board, but the tree
also contained a Board row. Talking to Sage meant leaving the board.
What changed: The Board row was removed. The board now has its project
lead's conversation on the right, with the same messages and drafts as
the full conversation. The panel collapses and opens as a drawer on
smaller screens. Each project shows its own lead.
Why it matters: The owner can discuss the plan while seeing its sprints.

## 505. The redesign omitted existing operational page capabilities

Found: 2026-11-06, during the owner's comparison with the current page.
State: represented in the mock; engine integration remains separate.

What happened: The visual mock lacked login, logout, expiry, connection
states, permission controls, agent lifecycle, failed-start reasons, large
items, tool details, delivery history, Alerts, and Settings.
What changed: The mock now has interactive examples of those flows.
Source mappings and integration boundaries are in design/FEATURE-PARITY.md.
Why it matters: Improving the layout must preserve the controls needed to
operate agents and recover from failures.

## 506. Operational and workspace examples initially lost context at boundaries

Found: 2026-11-06, in independent browser verification of the expanded mock.
State: fixed in the mock and independently rechecked.

What happened: Recovery's Git examples showed Workspace app content.
Subscription toggles remained editable while reconnecting. Stopping an
agent left permissions actionable. Logout retained an unsaved token in a
hidden input. Worker mode retained a Master label in Terminal and exposed
a master-only pairing action.
What changed: Workspace examples use the selected branch and file.
Mutations disable during reconnection. Stop cancels permissions while
retaining questions. Session teardown wipes secrets and pairing inputs.
The current machine role propagates, and worker-only restrictions apply.
Why it matters: Context, authority, and recovery behavior must stay
consistent across navigation. Durable browser regressions cover these
cases, and cold browser probes rechecked all six fixes.

## 507. Responsive resizing erased unsaved settings in the mock

Found: 2026-11-06, while running the operational regressions.
State: fixed in the mock.

What happened: Crossing the lead-panel breakpoint redrew every view, even
when the board was closed. An unsaved carrier URL disappeared during resize.
What changed: The lead-panel breakpoint redraws only the board. Other views
use their responsive styles without rebuilding their inputs.
Why it matters: Changing window size must preserve unsaved workspace and
service settings. A browser regression reproduces the original failure.

## 508. Repeated prototype disclaimers cluttered the working interface

Found: 2026-11-06, in the owner’s feedback on the browser mock.
State: removed from interface copy.

What happened: Chat, connection status, Terminal, Git, settings, login,
pairing, and subscriptions repeatedly announced sample or preview data.
What changed: Those surfaces now use normal product language. Placeholders,
accessible labels, save confirmations, and generated replies were cleaned up.
Prototype boundaries remain in the design documentation.
Why it matters: The owner is evaluating the app’s interaction and layout.
Repeated reminders distract from the work being represented.

## 509. The workspace layout and navigation need a consistent scope model

Found: 2026-11-06, during the requested comparison with T3 Code and VS Code.
State: addressed in the approved workspace refinement pass, 2026-11-06.

Confirmed live: Team Changes and project Git expose the same viewer through
different navigation levels. At 1440px, the board needs 936px inside a 718px
viewport beside Sage, leaving Done mostly off-screen. At 2560px, the 800px
chat column leaves 1420px unused to its right. Git lacks staging, a commit
message, and the newly discussed team-to-project worktree integration view.

Why it matters: Users must understand which agent, team, worktree, and branch
an action affects while following project progress. The evidence and ranked
recommendations are in design/UI-CRITIQUE-2026-11-06.md. Captures and geometry
measurements are under design/previews/critique-current/.


What changed for issue 509: One workspace tab row follows project/team scope.
The navigation and Sage panel resize. Four board columns fit at 1440px.
Focused chat is centered. Git exposes worktree hierarchy, staging, commits,
synchronization, conflicts, and explicit team/project/main integration targets.
The composer adds progress, account choice, and file/task context. Attention,
quick switch, and named terminal sessions support navigation. Evidence is in
`design/previews/workspace-redesign-checks.json` and the cold verification report.

## 510. Worktree transitions could overwrite terminal drafts and retain stale scope

Found: 2026-11-06, during independent browser verification of the refinement.
State: fixed and independently rechecked.

What happened: Selecting a team or project changed the workspace before the
old terminal input was saved. That copied a draft into the destination and
could overwrite the original on return. The older Viewing picker also left
Git and Terminal in the previous project and machine. A partial commit could
leave no selected file. Team integration ignored uncommitted destination files.

What changed: Navigation saves the old context before selecting its destination.
The Viewing picker follows the owning project, team, and machine in Git and
Terminal. Project leads restore their assigned worktree. Partial commits select
the remaining file. Dirty or conflicted destination worktrees block integration.

Confirmed live: The independent verifier repeated these four journeys and
reported 32 passing assertions with zero browser errors. Permanent checks in
`design/workspace-redesign-checks.mjs` cover the reproduced boundaries.

## 511. Attention was scattered and comparable machine records wasted space

Found: 2026-11-06, during the owner's Cursor-first critique and density feedback.
State: addressed in the browser prototype; awaiting owner visual judgment.

Confirmed live before the change: The page opened inside one project. Four
unresolved items were available through the bell, but there was no global
Home or cross-project question/approval list. Add Project did not offer a
machine choice. Machines used large rows for comparable host records.

What changed: Home is now the default, with Needs attention, All projects,
Questions, and Approvals. Filters combine across the workspace. Questions
and permissions can be answered in place; merge reviews retain an explicit
approval step. Answered history remains discoverable. Add Project resolves
the selected machine's repository, branch, and folder. Machines now uses
43-pixel table rows at desktop width. The critique and evidence are in
`design/UI-CRITIQUE-2026-11-06-HOME.md` and `design/previews/home-checks.json`.

## 512. Global request and machine actions lost context at navigation boundaries

Found: 2026-11-06, in independent cold verification of Home and remote creation.
State: fixed and independently rechecked in the prototype.

What happened: Discuss could overwrite a saved draft. A machine action could
fall back to Studio when its repository was unavailable. Placement could
select hosts without the repository and disagree with the current Git host.
Global permission and failure details could show a project branch instead
of the requesting team's branch. Tab arrows were missing, filters lost focus,
and an unchecked remote main checkout had the wrong type label.

What changed: Discussion preserves nonempty drafts. Explicit machine choices
stay selected and block creation until a repository is available there.
Placement validates repository availability and applies only to future runs.
Details derive branch context from the requesting agent's team. Home tabs
support arrows, Home, and End. Filters retain focus. Remote checkout labels
agree with the chosen host and path.

Confirmed live: Independent cold verification completed 42 successful checks
with zero browser errors and no outstanding admitted finding. Reproduction
and recheck evidence are in `design/previews/home-cold-verification.md`.

## 513. Split request views and disconnected sidebar controls impeded scanning

Found: 2026-11-06, in the owner's review of Needs attention and Approvals.
State: revised in the browser prototype; awaiting owner visual judgment.

What happened: A selected request opened a separate detail column. Requests
used multiple summary lines. The sidebar placed Repositories, Add Project,
search, and a project filter together without clear boundaries or scope.
The owner described it as disjointed and unintuitive.

What changed: Requests now start as collapsed single-line rows. Clicking a
row toggles the details directly beneath it, with one expansion at a time.
Home/search, Projects/new project/project filtering, and service pages have
visible separators. The project filter says Only projects needing you.
Repository names still open their lists, so the duplicate Repositories
destination was removed. Existing operational controls remain inside the
expanded request. Evidence is in `design/previews/home-checks.json` and
the `inline-requests-` captures.

Cold verification also found that answering an expanded request could remove
its row and drop keyboard focus onto the page body. The render path now hands
focus to the next visible row, or to the empty result when a filtered queue
is complete. Permanent checks reproduce question, permission, and empty-queue
focus handoff. The initial question check failed before the fix.

## 514. The mock's terminal was a command form, and a first review found layout and naming bugs

Found: 2026-11-06, when Claude took over the mock from Codex and reviewed it at 1440
pixels against Cursor and the owner's earlier requests.
State: fixed in the mock on the branch `area/web-mock`, commit `e2d5166`; awaiting the
owner's judgment and a designer's critique.

What happened: Terminal was a form with an input box and an Enter button, so it could
not host vim or an agent's command line. Because the mock is golden, that would have
been built as drawn. Git stopped short of the window height, and its columns scrolled
together. The tab row moved sideways between views. A thread opened at its top, so a
pending permission's buttons were below the fold. Iris's branch and worktree disagreed
across the page. The brand and storage keys said "lgtm", and "Add Project", "Source
Control" and "Workspace settings" competed with other names for the same things. Text
went down to 9 pixels. The Alerts badge counted requests, which duplicated the bell.

What changed: Terminal is a full-height character grid with slim session tabs and a
full-screen program example. Git uses the full window, and each column scrolls on its
own. The tab row keeps one left edge. Threads open at the latest message, with a
pending permission last. Names are unified as recorded in `design/DESIGN.md`, and no
text is under 11 pixels. Alerts now means notification delivery, and its badge counts
failures. The new `design/revision-checks.mjs` passed 4 of 45 checks on the old mock
and passes 71 of 71 now.

## 515. A designer critique found 15 problems in the mock that mislead or block the owner

Found: 2026-11-06, in a critique by a subagent acting as a senior Apple designer.
State: the 15 Must fix findings are fixed in the mock, in commit `6133a31` on the branch
`area/web-mock`. The owner picks from the other findings. The full list of 114 findings is
`design/UI-CRITIQUE-2026-11-06-DESIGNER.md` on that branch.

What happened: The sidebar hides attention that exists, and failed agents wear the
success color. The merge to main is approved from a dialog with no evidence. A cancelled
permission says that an answer was recorded. A status line says "No owner action needed"
above a waiting request. Neither side of machine pairing shows the code, although the
owner decided that the website generates it.

Two of the problems contradict claims made by the review in entry 514. `design/DESIGN.md`
says that threads open at the latest message, and the lead panel opens 34 pixels short of
its end and returns to its top when reopened. The split diff added in that review filters
each side separately, so the lines of the two sides do not correspond. The 71 checks in
`design/revision-checks.mjs` did not catch either problem.

## 516. LGTM Studio cannot run Grok without Fast through Cursor's Agent Client Protocol

Found: 2026-11-06, while setting up the advisory board on a private engine.
State: open. Not fixed.

Cursor's Agent Client Protocol (ACP) mode offers Grok 4.7 only as
`grok-4.7[context=256k,reasoning_effort=high,fast=true]`. It refused the same
value with `fast=false`, and it refused `grok-4.7-high`. Launch arguments and a
private `CURSOR_CONFIG_DIR` did not change the offered value. The interactive
`cursor-agent --model grok-4.7-high` runs without Fast. The owner's rule is no
fast modes, so a Grok agent cannot run under LGTM Studio's engine today. The board
used Herdr Synapse's team board and interactive panes instead.

## 517. Moving the mock onto data files exposed four faults in it

Found: 2026-11-07, while moving the mock's fixtures into JSON files and stub functions.
State: three are fixed on the branch `area/web-mock`. The sidebar fault is open in the mock.

- A thread opened from Home started 39 pixels short of its end. The fix for this fault in
  `6133a31` restored the position before the page finished changing its layout. It is fixed.
- A question in the heavy sample did not appear in its agent's thread, so its links opened a
  thread without it. Questions now come from the events. It is fixed.
- Leads in the heavy sample showed the first-run greeting although they had sprints, and their
  team agents showed the recovery team's text.
  It is fixed.
- When the page opens an agent in a long project list, the sidebar does not scroll to that
  agent, so the selection can be out of sight. It is open.

A real export cannot show boards yet, because the engine stores no projects, sprints, or tasks.
The website todo records those events as proposed.

## 518. The mock's Copy button said "Copied" over plain web addresses when nothing was copied

Found: 2026-11-07, while serving the mock on the build server's network address.
State: fixed on the branch `area/web-mock`.

A browser offers the clipboard only over HTTPS and loopback addresses. Over a plain network
address, the pairing command's Copy button copied nothing and still showed "Copied". The button
now selects the text and says that the address cannot use the clipboard. It also reports a
refused copy, where it stayed silent before.

The product page supports only HTTPS and loopback, so the product should not meet the first case.

## 519. The Claude and Grok review findings are checked against `master`, and 20 remain

Found: 2026-11-07, while reconciling `master` before the freeze.
State: open. The check ran on 2026-11-07 at `95fcb14`, and the remaining findings wait until the freeze lifts.

Three foundation reviews ran on the snapshot at the tag `foundation-pre-review`, and only the Codex review's fixes reached `master`. Six Codex seats (GPT-6.1 Sol, high) then checked every confirmed and unresolved finding of the other two reviews against `master`. That was 56 Claude findings and 22 Grok findings, leaving out the three Grok security items, which belong to the owner's attack list.

| Review | Fixed | Partly fixed | Still present |
|---|---|---|---|
| Claude | 25 | 17 | 14 |
| Grok | 14 | 2 | 6 |

These product findings are still present:

- `R-008`: a post to the owner that needs no reply still counts the owner as holding the asker.
- `R-009`: when a stopped asker's question notice is withdrawn, its holder is never told or settled.
- `R-012`, the same cause as Grok's `L-066`: a tool kind outside the known list drops the permission request, and the agent keeps waiting.
- `R-013`: the stall rule for a lead with a busy team. Issue 520 holds the owner's ruling.
- `R-016`: a long last turn loses its newest messages.
- `R-023`: a symbolic link anywhere above the configuration folder fails without saying why.
- `L-038`: an account's `enabled` flag can be left out of a snapshot that requires it.
- `L-047`: the Alerts and Settings pages stay up after the session ends.
- `L-119`: the owner's snapshot leaves out open alerts.
- `L-124`: saving the web settings reports a connection failure.
- `L-132`: a refused board post fails the notice loop, and the host restarts it. The advisory board left open whether the retry lasts forever.

The other still-present findings are missing tests: `R-026`, `R-032`, `R-035`, `R-043`, `R-046`, `R-047`, `R-049` and `R-054`. The 19 partly fixed findings name what remains in each result.

The check corrected one earlier reading. `FR-001` and the Claude review's `R-001` are fixed by commit `7078bd0`, because a public address must now use HTTPS, and plain HTTP is supported only on loopback.

The check did not cover the 526 Claude findings and 139 Grok findings that were never adjudicated. The advisory board found eight causes among those 526 that other panels confirmed, so they are worth a later pass. The task files and results are outside git, in `.scratch/foundry-runs/foundation-plans-1/findings-check/`, and the reviews' evidence is in `review-claude/`, `review-cursor/` and `review-codex/` beside it.

## 520. The stall rule nudges a lead while its own worker is busy, and the plan contradicts itself

Found: 2026-11-07, recorded from review finding K-368.
State: open. The owner ruled on 2026-11-07, and the code change waits until the freeze lifts.

When an orchestrator posts a question that needs a reply to a lead, the lead goes idle while its workers run. After 20 minutes the lead receives `StallSeen`, and on the third episode the orchestrator receives `ReplaceAdvised`. The code is `packages/engine/src/roles/stall-watch/rules/stall.ts:145-150`. The plan's criterion 4.3, at `.plans/plans/lgtm-foundry-roles/plan.md:939`, says both "nor is the lead" and "still nudged". The plan's line 69 says that a worker waiting on a busy agent is not stalled. No test covers an orchestrator's post to a lead with a busy descendant.

The owner ruled on 2026-11-07 that the lead keeps both the nudges and the replacement advice in this case. The advice changes form, as follows:

- The stall watch stops nudging after the third time, as it does today.
- The replacement advice becomes a notice to the orchestrator and a mark on the lead. The lead's row in the roles view gains a field that says replacement is advised. Today the view counts nudges in `stallCount` but records nothing for `ReplaceAdvised`.
- When every worker under a marked lead has finished, the stall watch tells the orchestrator that the lead's workers are done and that the lead is ready for replacement.
- The orchestrator then saves the old lead's transcript and starts a new lead. The new lead receives the original order, the old transcript to summarise, and what to look through, so it continues where the old lead stopped. Because it is a lead, it reaches the team's workers directly.

The plan's criterion 4.3 should be corrected to say that the lead is nudged. The owner expects three unanswered nudges in a row to be rare. The owner's words: "keep the nudge and also keep 'replacement advised.' The replacement advisory could just be a notice to the orchestrator and a mark on the lead."

## 521. Finished review seats filled the temporary folder's file limit

Found: 2026-11-07, when every shell command in the manager's session failed with "no space left on device".
State: worked around for now. The cause remains.

`/tmp` allows 1,048,576 files, and it reached that limit while only 21 percent of its bytes were in use. Each review seat kept a full copy of the repository, including `node_modules`, in its temporary folder under `/tmp/claude-1000`, and each adjudicator seat held about 28,000 files. Nothing removes those folders when a seat finishes. The failure affects every session on the machine, because each one needs a new file for each command's output.

The manager removed the `node_modules` folders from the 31 finished adjudicator seats, which brought the folder down to 56 percent of its file limit. The folders of the other finished seats remain. The Foundry should give seats a shared read-only copy, or remove a seat's temporary folder when the seat retires. The main disk is also at 96 percent.

## 522. Building the mock's first run exposed two faults in it

Found: 2026-11-07, while adding a first run to the mock on the branch `area/web-mock`.
State: both are fixed on that branch.

- The page could not start with no projects, because it read the first project while it loaded.
  A real service starts with none, so the mock had no way to show its first minutes.
- A new project's lead always ran on Claude Code, and the New project form offered no choice. A
  person signed in only to Codex would have got a lead on an account that does not work. The form
  now offers the signed-in harnesses, and it hides the choice when there is one.

## 523. An earlier rename did not migrate existing state or environment variables

Found: 2026-11-08, during an earlier rename of the product.
State: accepted, with no automatic migration. On 2026-11-12 the owner chose to start fresh under the name LGTM Studio.

What happens: the renamed program read a new state folder and new environment
variables. Existing state under the old folder and the old variables were not
migrated or read. The configuration folders had no aliases for the old names.
What should happen: an owner who ran LGTM Studio starts fresh, or stops the old
service and moves the state folder by hand before starting LGTM Studio. The owner
also updates environment variables, configuration folder names, and commands.
Why it matters: an existing owner otherwise sees an empty installation, and
old service settings, including the web password, do not configure LGTM Studio.

## 524. The live check's Codex tool step can fail because the agent never calls the tool

Found: 2026-11-08, while checking an earlier rename of the product.
State: open.

In the first `pnpm live-check` run on the rename branch, the `sandbox-mcp` step failed with "codex: not attempted; exact ask tool calls=0". The Codex agent, GPT-6 Luna at low effort, made no call to the `lgtm` ask tool, so the probe had nothing to judge. The Claude agent's call succeeded in the same run. A second run passed the step for both agents, with the same code, so the failure depends on whether the model chooses to call the tool. The step should give the agent a second prompt, or run on a model that follows the instruction reliably, before it reports a failure.

## 525. OpenPencil's command-line tool guesses the width of Inter Medium and SemiBold text

Found: 2026-11-08, while building the Reverse Fig skill on the branch `area/reverse-fig`.
State: worked around in the skill; the cause is in OpenPencil 0.16.0, not in LGTM Studio.

- OpenPencil lays text out with its own font measurements. From the command line, it measures
  Inter Regular and Bold, but Inter Medium and SemiBold fall back to a rough estimate of 0.6 of
  the font size per letter. A label that fits in the browser then wraps onto two lines.
- The likely cause is a name mismatch: its bundled fonts are keyed as "SemiBold", while text
  nodes ask for "Semi Bold".
- The skill gives each label the size the browser measured, plus one pixel. It should drop that
  step once OpenPencil measures every bundled weight, and someone could report the fault upstream.

## 526. A live check inside the Codex seat gave a misleading build baseline

Found: 2026-11-08, during the website-1 baseline on `area/website`.
State: understood; step-gate live checks are run by the manager.

The baseline is 19 passing stages out of 23.
The manager ran `pnpm live-check` from the manager shell on a clean detached
checkout of `8b6bcf4` and reported that result on 2026-11-08.
Its failed stages were `removed-variables`, `always-allow`, and `token-scan`.
Recording was skipped because earlier stages failed.
The `state-read`, `permission-kinds`, and `reload` stages passed in that run.

The website lead's earlier run inside its Codex seat passed 16 stages out of 23
at the same application code.
That run additionally failed `state-read`, `permission-kinds`, and `reload`.
Several Claude probes did not attempt the exact requested command.
The manager identified the Codex-seat execution context as the difference.
The 16-of-23 run is retained as execution-context evidence, not the build baseline.

The ordinary check passed all 457 test files and all 18 browser cases.
The real web check passed all ten reported stages.
The `sandbox-mcp` stage passed in the lead's run.
The final scan of events, replies, and output passed in that run.
The token exposure remains covered by the owner's earlier deferral in issue 240.

From this point, the manager runs `pnpm live-check` at each build-step gate.
The website seats continue to run `pnpm check` and `pnpm live-check:web`.
The gate report must name the commit and attribute the broader live result to the manager.
The run evidence is recorded in `.scratch/foundry-runs/website-1/run.md` in the main checkout.
The lead's private live run is `/tmp/lgtm-live-KULrQh`.

## 527. Piece reducers could not use persisted event times for task history

Found: 2026-11-08, while building the project foundation.
State: fixed in the project foundation unit.

The piece reducer table passed an event and a sequence, but omitted the event's persisted time.
A task timeline built with the current clock would change when the log was replayed.
The table now passes the envelope's time as a fourth argument.
The project fold uses that time for task creation, changes, notes, and sprint completion.
The handler tests compare the live views with a complete log rebuild after every journey.

## 528. Git reads and conflict completion needed real-repository edge-case checks

Found: 2026-11-08, while building the website's bounded Git service.
State: fixed in the Git service, with focused tests against temporary repositories.

A reversed Git history limited to one commit returns the newest selected commit,
so it cannot establish when the oldest pending commit arrived. The service reads
bounded committer dates from the actual unmerged history and selects the earliest.
An ours-only conflict resolution can leave no staged file difference while a merge
still needs its final commit. The service exposes the merge head and permits that
commit once the unmerged index entries are cleared. Generated linked checkouts can
also appear as untracked changes in their parent when no ignore rule exists. The
service adds a local exclusion for its `.worktrees/` folder without editing a
tracked ignore file. A newly created repository also needs Git's orphan-worktree support before its first commit. The service creates a real
unborn project branch in that case, and represents its missing head as null.
Real-repository tests cover these cases.

The inline conflict resolver currently refuses binary, add/delete, symlink and
submodule conflicts. Those cases require the terminal workflow. The service also
refuses symbolic-link file operations, and public review links currently support
GitHub's standard remote forms only. The command integration must apply the
production redactor to every service reply before delivery through the client
application programming interface.

## 529. Reply cancellation failures were reported as storage failures

Found: 2026-11-08, while building the website's reply cancellation command.
State: fixed in the website worker's change before handoff.

The first implementation mapped a runner refusal after the command committed to
`LogWriteFailed`. A reply can finish between the command's state check and the
runner call, so that refusal does not establish a database failure. The shared
post-commit effect type now permits `CommandRefused`, and cancellation uses that
recoverable error. Tests cover a runner refusal and a naturally ending reply.
Both tests verify that the writer accepts a later command and sends the next
queued prompt.

## 530. Phone notification actions and prompt dismissal lacked engine support

Found on 2026-11-08 while implementing the website's notification actions.
The engine had no owner command to retry a displayed failed notification.
It had no command to send a real test notification through the configured service.
It did not remember the owner's choice to decline the first waiting request's
phone notification offer.
Its alert read exposed the attempt number but omitted the delivery time.

Fixed in website unit W05a.
The retry validates the alert identity, carrier generation, and displayed attempt.
It shares a delivery lane with the background worker and records the actual result.
The test command returns the transport result without creating an alert or storing a response.
The client piece replays `client.AlertPromptDismissed` into its settings and owner snapshot.
Alert reads obtain the latest attempt time from the event log.

## 531. Composer choices and context usage lacked a live runner contract

Found: 2026-11-08, during the website composer engine assignment.
State: fixed on `unit/website-w05c`, pending independent verification.

The engine configured a model and effort only when opening a session.
There was no owner command to change the next turn on the same running agent.
The existing per-turn token totals did not establish the size of the context window.
The session-opening configuration helper also treated a successful response as an acknowledgement without checking its selected value.
The shared start path now validates identifiers against the same bounded composer contract, including configured defaults.

The change adds durable desired and applied settings, with explicit pending, refused, unsupported, and unavailable states.
The dispatcher holds the existing agent lane through configuration acknowledgement and the next prompt or compaction write.
A refused change retains queued owner work until the owner corrects the choice.
A timed-out or disconnected configuration call leaves the live process uncertain.
That process holds queued work until an explicit owner stop and resume opens a new incarnation.
A stopped agent retains its desired settings for its next real retry.
A fresh or reloaded process supplies its own acknowledgement.
Configuration revision identities are registered at their event schema position in the redaction structure.
An issue-340 regression preserves secret-colliding revisions through the real writer and receipts while prose and free-text records remain redacted.
The owner can read bounded configured or negotiated choices, with optional redacted labels.
Cursor's existing `auto` start setting keeps its advertised `default[]` protocol identity through the next turn and later effort-only changes.
Only a live harness occupancy report with compatible used-token and window counts supplies a percentage.
The ratio is divided before multiplication so valid safe-integer counts cannot round above 100 percent.
A model change or reload invalidates old context evidence.

The controlled Agent Client Protocol subprocess tests also exposed an execution-environment limit.
Inside this Codex filesystem sandbox, an existing runner test's child exited before initialization.
The same existing test passed outside the sandbox.
The focused subprocess proofs therefore run outside that sandbox, with one worker.
No product permission rule was weakened.

## 532. The piece failure log test can miss its diagnostic

Found: 2026-11-08, during the website worker's full repository check.
State: both ownership gaps are fixed and independently verified.

The `FR-042 protocol=false` case in
`packages/engine/test/pieces/piece-failure-log.test.ts` expected one safe
diagnostic and received none during a full suite run. The same three-test
file passed when run alone, without a source change. The failed full run is
in `/tmp/w03-check.log`, and the isolated pass is in
`/tmp/w03-piece-failure.log`. The assertion remains unchanged.

The combined website integration check at `b038490` later missed the same
diagnostic in the `protocol=true` case. Its actual exit was 1. The unchanged
file then passed alone again.

The service drain removed a whole pending batch before writing its entries.
Interruption after one write could discard the rest of that removed batch.
A deterministic regression interrupts the actual drain fiber after its first
entry. It expected three diagnostics and captured one before the correction.
The drain now completes each removed batch before observing interruption.
Its idle wait remains interruptible. All four diagnostic tests pass locally.
The original exact count, throttling, and secrecy assertions remain intact.
The forced interruption establishes this production defect. It does not
establish the exact scheduling of the earlier zero-entry failures.
The initial batch correction alone did not complete verification.

A later complete Git check at `253ef5b` still captured zero entries in the
original `protocol=false` case with the batch mask present.
A separate controlled scheduler probe established a second ownership gap.
A fork cancelled before its first evaluation never installs its `ensuring`
finalizer. The probe retained all three pending entries and logged none.
The parent scope now registers a final flush before scheduling the follower.
The batch mask and the running follower's finalizer remain in place.
Each drain removes its own snapshot once, so final flushes do not duplicate it.
The same controlled delayed-child probe now passes and flushes all three
entries before the child evaluates. Independent repeated-interruption and
fresh-service lifecycle probes also pass.

The corrected project and Git heads each passed their fresh complete checks.
The final combined head `c4dfaf0` then passed an independent complete check.
It passed 468 files, 6,417 tests, and all 18 browser cases, with two existing skips.
TypeScript and copied-code credits checks also passed.
The independent review approved that exact head with no findings.
Its report is `.scratch/foundry-runs/website-1/w00f-verifier-1-result.md`.
These results do not establish the exact timing of the earlier zero-entry failures.

## 533. Git rename counts and interrupted staging needed recovery corrections

Found: 2026-11-08, by the independent website Git service verifier at commit
`55d23a6`, then reproduced through the public service in the correction seat.
State: fixed for normal Git signal cleanup, with real-repository regression tests.

The numeric diff parser treated tab-bearing rename paths as count rows.
An unchanged rename could report additions and deletions taken from its name.
The parser now follows Git's null-delimited record grammar and consumes both
rename or copy paths before reading the next count row.
Tests cover both tab-bearing paths, ordinary records, mixed binary and text
records, commit diffs, truncation and missing final newlines.

A timed-out staging process previously received the unconditional kill signal.
Git could not remove its index lock, so a legitimate retry returned `busy`.
The runner now sends the termination signal first and allows 250 milliseconds
for Git's own lock rollback before forcing process-group termination.
It preserves the original failure reason throughout that grace.
Git resolves the actual per-worktree metadata and cleans only locks it acquired.
The service never guesses lock ownership or unlinks index locks itself.
Tests cover single and bulk staging, timeout and cancellation, main and linked
checkouts, unchanged index contents, successful retry, pre-existing locks,
another live Git operation's lock and a descendant ignoring termination.

The correction tests also found that staging an already staged rename passed
its removed old pathname to Git, causing a pathspec failure.
Staging now updates the destination of an indexed rename or copy.
Unstaging still resets both paths.
Single-file and bulk regression assertions cover this case.

A forced kill can still leave a lock when Git cannot run its cleanup within
the grace period, and that lock requires terminal inspection.
No cross-process atomic cleanup or Windows recovery guarantee is claimed.
The local filesystem race limitation in issue 49 still applies.

## 534. Project identities, read refusals, and initial settings failed at the persistence or wire boundary

Found: 2026-11-08, by the independent verifier of the project foundation at `0335bda`.
State: fixed in the first correction to the project foundation.

Finding F01 was an integrity bug in the production redactor.
The planner validated a project's lead, but the writer treated the new identity fields as text.
A registered secret that overlapped a lead identifier changed that reference before persistence.
The original lead then lost project membership and authorization.
This is the project integration instance of issue 340.
The correction adds schema-position rules for repository, workspace, project, team, sprint, task, parent, and lead references.
Sprint dependencies and sprint and task owners also preserve their typed identities.
Event tags select these rules, so a workspace's display owner remains redacted text.
Mutation receipt identities and nested event envelopes use the same boundary rules.
Production-writer tests check every project event with a nonempty synthetic registered secret.
They inspect stored events, returned envelopes, receipt replies, retries, and deterministic rebuilds.
A real-handler journey also checks the original lead's access and the original worker's task updates.
Unrelated prose, workspace owner text, and arbitrary nested identity-shaped text remain redacted.

Finding F02 hid fixed project refusal reasons on authenticated reads.
The read wrapper omitted the command name required by the existing explicit reason allowlist.
The correction passes that name through both ordinary and streaming read errors.
Socket tests check an invalid cursor, a missing project reference, and a successful subsequent read.
They also check that arbitrary failures and project-only reasons on other commands remain generic.

Finding F03 made the first project settings read fail response encoding.
The handler returned an own `settings` property with an undefined value.
The Effect 4 `optionalKey` contract permits an absent property instead.
The correction omits the property until settings exist.
A fresh authenticated socket test reads the empty state before any save, saves settings, and reads them again.
The same journey compares the live settings with a complete event-log rebuild.
This proof does not implement or verify the later first-run page.

## 535. Idle configuration dispatch entered the writer without queued work

Found: 2026-11-08, during the website composer engine full check.
State: correction written on `unit/website-w05c`, pending verification.

The configuration dispatcher now admits an idle agent even when it has no queued delivery.
This lets a pending owner choice apply before another prompt arrives.
After configuration, the dispatcher entered the delivery writer without rechecking the queue.
The baseline returned before entering the writer when no delivery was ready.
A latched write failure rejects even an empty transaction.
An idle dispatch could therefore emit an extra fixed delivery failure diagnostic during the runner-event append-refusal test.
That test reported four captured lines where its exact assertion requires three.
Asynchronous scheduling exposes the extra diagnostic, but the empty transaction is a new configuration-path regression.

The correction rechecks the ready queue after configuration while retaining the same agent lane.
It returns before entering the delivery writer when there is no work to reserve.
The diagnostic count, fixed-message, redaction, defect-isolation, and recovery assertions remain exact.
The orient tests also had a local running-session fixture without an applied configuration report.
That fixture now includes the model and effort it claims the harness opened with.
The assertions that reads do not write events remain unchanged.
The read-only fixture audit found no other unreported direct test with a missing session configuration acknowledgement.
Historical projection fixtures continue to represent unknown applied configuration honestly.

A temporary diagnostic reproduced the pre-correction failure with the exact assertions retained.
Its captured order was three `runner event dropped: processing failed` messages followed by `delivery dispatch failed`.
The orient cases gained six `AgentConfigurationApplied` events each, changing sequences 21 to 27 and 15 to 21.
An isolated baseline-dispatcher control passed the same three assertions with only the three runner-event messages and unchanged sequences.
The corrected dispatcher and acknowledged orient fixtures also passed those three assertions.
Their captured messages and unchanged sequences matched the baseline control.
The temporary diagnostic instrumentation was removed after the comparison.

## 536. Closing a pending Node socket could raise an uncaught exception

Found: 2026-11-08, during the corrected foundations' fresh complete checks.
State: fixed and independently verified at the combined foundation head.

The Git check at `30584ef` reported two uncaught close-before-connect errors.
The project check at `b1978e5` later passed all 6275 assertions but exited 1
because the same exception was uncaught. The browser stage did not run.
The retained logs are `/tmp/w02f1-verifier-1/pnpm-check.log` and
`/tmp/w01f1-verifier-1-pnpm-check-b1978e5-exit1.log`.

Independent controlled handshakes established a real cleanup defect.
Cancelling or timing out before open caused each child process to exit 1.
Effect removed its reader error listener before releasing the socket.
Node's ws transport then emitted its close-before-connect error asynchronously.
HTTP refusal and post-open close controls exited normally.
This establishes the pending-handshake defect, not every original suite trigger.

The Node socket acquisition now owns release through `Socket.fromWebSocket`.
An explicit pre-open close retains its error ownership through the close event.
Active reader errors retain their ordinary typed failure path.
The production Node client and shared engine fixtures use that same acquisition.
The existing socket validation and authenticated handshake headers are preserved.
The fix does not install a process-wide error handler or discard suite errors.
New child-process regressions cover cancellation, timeout, HTTP refusal and
post-open close. All four pass locally, along with the diagnostic drain tests.
Client and engine type checks pass. The targeted recovery and browser-boundary
batch passes all 32 tests in five files. An independent five-mode probe also
passes and retains a typed SocketReadError for an active malformed frame.
The corrected project and Git heads each passed their fresh complete checks.
The final combined head `c4dfaf0` passed its independent complete check.
That run passed 6,417 tests and all 18 browser cases, with no unhandled errors.
The independent review approved the exact combined head with no findings.
Its report is `.scratch/foundry-runs/website-1/w00f-verifier-1-result.md`.
The passing checks do not identify every earlier socket exception's trigger.

## 537. Negotiated model and effort choices could prevent retry and reload

Found: 2026-11-08, by the independent website composer verifier at `4914fe3`.
State: corrected locally on `unit/website-w05cf1`, pending independent review.

The owner could select an advertised model or effort absent from a nonempty configured list.
The live adapter acknowledged that choice, and an actual prompt used it.
The agent reducer also copied the desired value into the agent's launch fields.
Both loaded resume and fresh resume passed those fields into the runner's configured-list admission check.
That check rejected the replacement process before negotiation.
The agent remained interrupted, with its desired configuration pending.
Engine reload used the same input builder.

Retry and reload now distinguish an owner's durable choice revision from unchanged initial launch settings.
A replacement session opens without passing that revision's desired values as initial launch arguments.
The session records only its actual reported configuration.
The existing configuration lane then validates the desired identifiers against the new advertisement.
It waits for acknowledgement before sending queued work.
A missing value, missing selector, or unacknowledged setter retains an honest refusal and holds the queue.
The owner can correct a supported choice on the replacement process.
The correction does not change global harness settings or initial-start admission.
Unchanged initial settings retain the older protocol's existing start calls.
Cursor retains its exact advertised `default[]` identity for the existing `auto` launch alias.

The permanent reload refusal control also exposed a related recovery reservation problem.
Recovery can mark an agent working before its first recovered delivery is sent.
If configuration refuses that send, a later owner correction previously could not release the unsent queue.
Dispatch now recognizes that same unsent recovery reservation for an agent with an owner choice revision.
The lane, logged-send, account, capacity, and incarnation guards still govern the actual send.
An existing recovery assertion also caught a changed context reason after deferred configuration.
A replacement process with no occupancy report now retains `not-reported` during reconciliation.
Configuration changes still invalidate any earlier occupancy evidence.

The new regression uses the real command handler and controlled Agent Client Protocol children.
It covers both axes across loaded resume, fresh resume, and service reload.
Nonempty configured lists exclude the negotiated choices in every case.
Wire gates prove that no prompt is sent before acknowledgement.
Actual child reports prove the selected settings and replacement process identity.
The negative controls remove support from the new advertisement without making the adapter reject arbitrary setter values.
They prove refusal, preserved queued work, and release on the same process after an owner correction.
Additional fresh-session controls cover missing selectors, missing acknowledgement, and Cursor's alias.
The existing recovery and initial invalid-choice assertions remain intact.
All four model and effort retry cases were reproduced red with the original production files restored temporarily.
The independent verifier's original files and logs remain unchanged.

## 538. New project could not recover repository, worktree, and lead creation

Found: 2026-11-08, while implementing the real New project journey.
State: corrected in the W04B implementation; independent review remains required.

The temporary public command recorded an existing lead and checkout.
It could not own or recover the filesystem and process effects required by New project.
A Git operation can succeed before the final project record is written.
Caller cancellation can also arrive after the lead and receipt commit, before launch starts.
Returning an error proves neither rollback nor the absence of a process.

Creation now persists one bounded intent before creating a repository or worktree.
The intent fixes the request hash, project identity, paths, branch, and selected defaults.
There are at most 64 unfinished creation intents.
A filesystem witness bridges directory creation and its durable device and inode claim.
Git runs only after that claim commits.
Recovery verifies the claimed directory and the actual repository and branch.
It never adopts an unrelated empty directory or a replaced claimed directory.
Only the exact owned witness file is removed after its claim commits.
Other paths and existing Git exclusion entries are never removed.
The owner can inspect unfinished operations through the bounded `project.creations` read.
Retrying the original request completes the same operation.
A changed body under that request identity is refused.
The final append records the project, lead, and ordinary receipt together.
Normal engine restart recovery restarts that recorded lead identity when needed.

Project creation and archive orchestration belong to the engine's lifetime scope.
Disconnecting a caller cannot strand a committed lead before its start hook runs.
The writer's transaction commits the receipt before publication, which cannot fail.
A typed database write failure latches the writer until service recovery.
The receipt decode and reply read happen inside the transaction before its commit.
A test-only failure injected outside a successful transaction therefore represents a
lost service result, rather than a production typed failure that allows more writes.
A same-service cancellation probe gates the actual committed result before launch.
After cancelling that caller, the engine launches the same lead exactly once.
A retry returns the original project without another worktree or lead.
A later session-recording failure stops the actual controlled adapter process.
Its recorded project remains visible for ordinary service recovery.

Archive records its in-progress state before stopping every project member.
That state prevents child starts and resumes while stops are being confirmed.
A failed stop leaves the archive unfinished and retryable.
Only confirmed stops permit the archived timestamp to commit.
Questions remain open, and permissions follow the ordinary stop cancellation rules.
Restore preserves the setup and lead identity without starting another process.

The local filesystem race limitation in issue 49 still applies.
An interruption between mkdir and its witness write leaves an ambiguous planned path.
That path stays visible in the recovery read and requires owner inspection.
Recovery refuses it without deleting or adopting it.
Partial Git metadata that cannot be verified also requires owner inspection.
There is no automatic destructive cleanup or cross-process atomic filesystem claim.

## 539. Redacting conflict protocol values could invalidate Git replies

Found: 2026-11-08, while wiring the public Git commands.
State: corrected in this change. Independent review remains pending.

The initial integration redacted every returned string as display text.
A registered short secret such as `conflict` changed the segment discriminator.
The authenticated response then failed its typed encoding contract.
A secret such as `ours` could also change a selected hunk's control value.
The original Git service did not have a public reply path and is unchanged.

The correction preserves fixed segment kinds and choices at their protocol
positions, while redacting paths, file contents, hunk sides, authors, subjects,
branch names, and review evidence through the production text redactor.
Choosing a hunk is an owner-only read of a draft, without a stored Git event.
Resolution still regenerates canonical content from the actual index stages.
A verified compare link is also an owner-only read and never claims to create
an actual pull request.

The real authenticated client regression registers short synthetic secrets,
reads a real merge conflict, chooses its `ours` side, and resolves the file.
It checks that display content is redacted and that protocol values remain valid.
A negative control with those protocol protections removed fails with the
actual response-encoding error.
A separate negative control removes the queue gate and proves that concurrent
calls can overlap after a workspace-setting change.
Restoring the gate prevents that overlap without changing Git service signatures.
The focused checks, complete-check result, and exact source identity are recorded
in the worker result when the assigned check actually finishes.

## 540. The reservation cancellation test could cancel before its fake peer started the turn

Found: 2026-11-08, during the first complete project lifecycle check.
State: the test synchronizes with the actual second child turn; independent review remains required.

The complete check exited 1 at 2026-11-09T05:16:12.611869+00:00.
The protocol 2 case in `packages/engine/test/runner/cancel-reservation.test.ts`
received only the first reservation's `promptReply` and `turnEnded` events.
It never received the stopped terminal event for reservation 42.
That failure remains preserved in `/tmp/w04b-full-check-1.log`.
An isolated pass of the unchanged test did not explain the failure.

The production runner returns from prompt after writing its frame to the child pipe.
That acknowledgement does not establish that the child has started its prompt handler.
The protocol transport queues prompt requests for its server handler.
It processes cancel notifications directly from its input reader.
The fake agent installs a cancel signal only when its prompt handler starts.
It discards a cancellation received before that signal exists.
The changed `withEngine` log-wrapper branch was not on this test's path.
The test uses the unchanged `withAcpRunner` helper.

A controlled real-runner probe paused the child while the second prompt and
current cancel reached its pipe, then resumed the child.
Observation-only instrumentation in a temporary copy of the fake agent recorded
cancel with no installed signal, followed by the second prompt handler installing it.
The wire still contained prompt 1, prompt 2, and exactly one cancel, in that order.
The original stale-cancel rejection and zero-frame assertions passed.
The terminal wait then failed with the same missing-event report as the full run.
The only terminal event belonged to sent sequence 17.
A control waited for the actual second handler before sending current cancel.
It passed the original assertions with sent sequence 42, `stopped: true`,
and exactly one cancel frame.
The full run did not record the child's internal scheduling.
The probe proves this failure mechanism without reconstructing that unrecorded schedule.

The permanent test now emits a unique plan marker from the second child turn.
It waits for that actual runner delivery update before exercising either cancellation.
The marker follows installation of the child's cancel signal.
It is not a timer, a fabricated runner event, or a relaxed terminal assertion.
The original reservation identities, stale-cancel failure, zero stale-cancel frames,
stopped terminal event, and exact one-current-cancel count remain unchanged.
The production runner, protocol transport, and shared fake agent are unchanged.
Temporary repository probes are removed after their evidence is retained in
`/tmp/w04b-cancel-order/`.

## 541. The combined planner inventory retained a single-unit count

Found: 2026-11-08, during independent configuration integration review.
State: corrected in the isolated combined candidate. Combined verification remains pending.

The configuration unit and the reply-cancellation unit each added a top-level planner.
Each unit passed with sixteen top-level planners on its own foundation.
Their automatic test-file merge retained sixteen after both commands were composed.
The independent nineteen-file focused run at 20e22b2 failed its exact count assertion.
It passed the other 771 tests, including both reservation protocols.
The failed log remains at /tmp/w05c-integration-verifier-1/focused.log.

The fixture now expects seventeen top-level planners.
Its exact public command equality, disjoint handler ownership, read inventory, and access assertions remain unchanged.
No production command, authorization rule, timeout, or assertion was removed.
The corrected candidate requires a new signed pin and complete verification.

## 542. Project creation admitted credentials for another provider

The independent public-command probe configured an executable Claude adapter.
Its account had no Claude login and held only an OpenAI application programming interface key.
A separate Cursor account had its own supported key.
Project creation selected Claude because the lead readiness check accepted any account variable ending in `API_KEY` or `AUTH_TOKEN`.
The same check treated arbitrary redaction leaves from login files as authentication evidence.
Those leaves intentionally include unfamiliar metadata strings to prevent credential disclosure.
They do not establish a provider login.

The correction uses the established per-harness key mapping and the effective spawn environment.
It recognizes only provider credential fields in the existing bounded login-file reader.
The reader still registers all its original redaction leaves and refuses unreadable stores.
Codex shadow homes, account homes, secret resolution, and private client-secret exclusion remain in place.
Unknown custom harness variables cannot establish local readiness.
These checks establish local credential presence, not successful remote authentication or provider usage.

Permanent public-command tests exercise the original wrong-provider failure and ready-Cursor control.
They prove supported provider keys, resolved account secrets, file-backed account selection, effective homes, and private Codex logins.
They also prove refusal of unavailable named accounts, arbitrary login metadata, unknown custom harness variables, and inherited keys excluded from the child environment.
The existing lifecycle tests use a supported Cursor fixture while preserving their assertions.
The independent original probe and its failure and control artifacts remain unchanged.

## 543. Project creation admitted a searchable directory as an adapter

The independent public-command probe configured a Claude adapter path that was a directory.
The Claude account had its own supported credential, and a later Cursor adapter was usable.
The local readiness check tested only executable access.
That check also succeeds for a searchable directory, so project creation selected the unusable Claude adapter.
The real executable control correctly selected Claude in the normal order.

The project-local correction requires a regular file before checking executable access.
The file check follows symbolic links, preserving legitimate linked executable adapters.
Missing, inaccessible, non-executable, and non-file candidates remain unavailable.
The normal runner and public harness settings policy are unchanged.
Local readiness still does not promise successful remote provider authentication.

Permanent public-command regressions reach the real project planner and writer in isolated repositories and homes.
They prove directory fallback, normal executable order, and linked executable admission.
They also prove refusal of non-executable files, missing paths, linked directories, and dangling links.
Saved unavailable account and harness choices refuse before recording a creation intent or lead.
All existing provider credential cases and lifecycle assertions remain intact.
The independent original directory and executable artifacts remain unchanged.

## 544. Project lead choices could freeze creation after Git effects

Found: 2026-11-09, during independent lifecycle, Git and configuration composition review at `63bab1c`.

Project settings admitted model and effort strings through the historical project-name schema.
The integrated normal start command rejects control characters in these protocol choices.
An invalid saved model could therefore pass settings and creation planning.
The engine recorded a creation intent and initialized its real repository before normal start refused.
No lead or project was created, and the intent retained the invalid model.
Correcting settings did not change that frozen intent on a retry of the same request.
The independent valid-model control created one project and cleared its intent.
Effective harness defaults could also exceed the intent's stored-choice length limit.
That failure surfaced only when the intent event was encoded.

Settings admission now applies the existing normal-start choice validator.
Creation validates both effective choices before recording an intent or touching its Git paths.
It checks the stored-choice schema, normal-start protocol rules and unchanged redaction.
The validation covers saved choices, historical settings and inherited harness defaults.
The historical event schema remains readable for replay.
The engine does not replace an already committed intent's selected defaults or delete its paths.

Permanent public-handler regressions cover model and effort, empty and matching configured lists, control characters and both length boundaries.
They assert the absence of an intent, repository, lead and project after refusal.
After a valid correction, the same previously refused creation request succeeds once.
A repeated request returns its original project without another launch.
Historical invalid settings remain decodable and pass the real rebuild check.
The original independent bad/control artifacts and interrupted full checks remain preserved.


## 546. The composer had no typed task and file context references

Found: 2026-11-09, during the website preparation at `bc783b2`.
The manager allocated this issue to engine unit W03D.

The golden Add context and at-sign search controls select tasks and workspace files.
The accepted prompt and board-post contracts carried only text.
They could not preserve a selected entity through delivery, retry, or replay.
The mock's labels were not an engine search or an authorization check.

The engine now searches actual readable project tasks and registered local workspace files.
A shared resolver in `packages/engine/src/project/context.ts` admits typed references.
It checks the authenticated sender and the conversation recipients.
File admission reuses the registered repository, common-directory, branch, and path checks.
References contain canonical identities, rather than caller-supplied display labels.
No file contents are read or stored by this surface.
Delivery descriptions remain inside an untrusted-data envelope.
The existing request receipt preserves the original selected identities on an unchanged retry.
Old commands and events without context remain valid.

React controls remain outside this change.

## 556. The terminal stop fixture could place its barrier before the message

Found: 2026-11-09, in the first W03D full check at `bc783b2`.
The manager allocated this issue after the exact-source ordering diagnostic.

The held-message stop test mixed queued Agent Client Protocol version 2 notifications with direct raw stdout frames.
The fake agent's plan and text steps returned after queue admission, before the separate writer sent them.
Its raw command marker could therefore overtake the plan and message.
The original failed trace observed the command marker before the plan and no held message after stop.
A later passing file run did not clear that failed full check.

The controlled probe used the actual protocol and client from this source.
A blocked message handler also blocked the later notification handler in the same input-reader fiber.
A held outgoing writer reproduced the direct marker overtaking queued plan and message notifications.
This proved the fixture's ordering defect.
It did not prove a production message loss after the message had buffered.

The fake agent now offers a test-only notification barrier.
It sends an unknown extension request through the same outgoing queue and awaits the expected method-not-found response.
The peer reaches that request only after its earlier awaited notification handlers finish.
The fixture uses one barrier after its plan and another after its tail, before writing the raw command marker.
The request emits no content, plan, or idle update that could flush the held carry.
The test verifies both acknowledgements and that the tail remains absent before stop.
It retains the original assertions that stop emits the tail but does not store it, and keeps the original timeout.
Production drain and stop behavior are unchanged.
The original unmodified failed full trace and both original diagnostic artifacts remain preserved in the W03D evidence.

## 547. Joined delivery history hides released entries

Found: 2026-11-09, during conversation preparation and lead source review at `bc783b2`.
State: historical finding not reproduced with the accepted event contract at `056a69c`.

The preparation observed that the delivery-history renderer accepts `DeliveryReleased` as a delivery event.
It observed that the joined filter omits that event from the states shown under a queued delivery.
It inferred that matching-source suppression would hide the standalone release too.
That last inference did not account for the actual release event shape.
The W08 implementation rechecked the complete accepted contract and release command.
`DeliveryReleased` contains `agentId` and an optional `holdSequence`, and has no `deliveryId`.
The joined-history suppression requires `deliveryId`, so a valid release remains visible as a separate agent state.
The original claimed disappearing release relied on a field that this event does not carry.

No production correction is needed for that historical claim.
`packages/web/test/delivery-release.test.tsx` decodes actual event shapes and covers a source and release together, a release before its source is loaded, and the visible state after history hydration.
The release keeps its agent and hold identity without inventing a delivery identity or duplicating source content.
Focused component verification is recorded in the W08 author evidence.
It does not establish browser execution.

## 554. Empty project request pages skipped the complete reply budget

Found: 2026-11-09, during independent project request review at `2616fb5`.

The `project.requests` read checked its encoded reply size only while adding rows.
An empty project, a filter with no matches, or an exhausted cursor skipped that check.
A valid request identifier containing 140,000 quotation marks produced a 280,027-byte owner success reply.
The same identifier produced an 840,165-byte lead success reply because the agent data envelope adds another encoding layer.
Both exceeded the 256 kibibyte complete success reply budget.

The read now measures the actual final wrapped success reply before returning it.
An oversized reply refuses without truncating an identifier or changing the shared request identifier schema.
The existing row budget, pagination, caller checks and owner answer authority remain in place.

Authenticated socket and direct-handler regressions cover the original owner and lead identifiers.
They also cover ordinary empty replies, escaped identifiers within budget, kind and status filters, and an exhausted cursor.
A separate control proves that an identifier can fit the owner reply while exceeding the lead envelope budget.
The inherited populated-page test continues to check every row, page progress and complete encoded sizes.
The reads preserve the durable log, and the real rebuild check remains enabled.
The original independent failed probes and logs are retained unchanged.

## 557. Empty project pages and the client request index bypassed their reply budgets

Found: 2026-11-09, during the website engine review at `4c657279`.

The generic project page helper checked complete encoded replies only when adding a row.
The owner-only `client.requests` index had the same gap.
An empty collection, a filter with no matches, or an exhausted valid cursor skipped that check.
A valid request identity containing 140,000 quotation marks produced a 280,027-byte owner project reply.
The recorded project lead received an 840,165-byte reply after the agent data envelope was encoded.
Both replies exceeded the project's 262,144-byte limit.
An empty client request reply with 270,000 quotation marks occupied 540,040 bytes.
That reply exceeded the index's distinct 524,288-byte limit.

Each helper now measures its final complete success reply before returning it.
The project helper includes the actual agent data envelope in that measurement.
The existing limits, row boundaries, cursor rules, request identities, and refusal text remain unchanged.
The client request index remains owner-only.
Refusal returns before any event, receipt, or read mark is written.

Authenticated handler and socket regressions preserve the original failed payloads.
They cover ordinary empty replies, filtered empty replies, exhausted pages, permitted project members, and owner-only catalogs.
They also retain populated pagination, access refusals, stored metadata, and deterministic rebuild assertions.
The separate `project.requests` correction tracked as issue 554 is outside this change.
## 548. Discovery could materialize private Codex shadow homes

Found: 2026-11-09, by reading the accepted project-readiness dependency during first-run preparation.
The manager allocated this number for the read-only discovery correction.

The accepted readiness helper called `withCodexHome` to resolve the account's effective environment.
That helper also called `materializeCodexShadowHome` before returning the environment.
The materializer can create private home directories and maintain shared-home links.
Reusing that launch helper while scanning would contradict the first-run promise that discovery only looked.

The correction separates read-only layout and confinement resolution from explicit launch materialization.
`resolveCodexHome` and `withCodexHome` share the same layout resolver.
Discovery and project readiness use the read-only function.
The real runner retains the materializing function and its post-materialization confinement check.
Provider-specific credential recognition, effective environment expansion, executable-file checks, account ordering, and private account separation remain shared with project launch.
No setup-only authentication policy was added.

The first-run public API proof compares actual repository and home files before and after discovery.
It checks that an absent private shadow home remains absent and that no agent or sample account was created.
It distinguishes a missing executable, signed-out state, unavailable credential evidence, and a recognized local credential.
Every discovery account explicitly reports remote authentication as not checked.
The inherited provider-readiness and real Codex launch fixtures retain their assertions.
Local credential presence does not promise a successful remote handshake or provider usage.

## 549. Draft field identity conflated different entities

Found: 2026-11-09, during the first-run and mocks implementation review.
The manager allocated this number after the real public-handler counterexample failed.

The draft bundle checked uniqueness using only each field's name.
A bundle containing both `EntityA.name` and `EntityB.name` therefore refused as a duplicate.
The golden field identity consists of the entity and field together.
The correction compares a structured pair of entity and field name.
A real public-handler regression records both fields and preserves both through approval.
The original failing source and log remain in `/tmp/w05b-proof/schema-counterexamples-red-1-*` and its `.log` file.
Re-executing the exact original source after the contract removal refuses its legacy empty `schemaChanges` input at admission.
That result is preserved separately and is not called a passing field-identity probe.
The permanent positive control uses the supported contract and retains the same two entity-qualified fields and approval assertion.

## 550. Approval silently dropped accepted declared schema changes

Found: 2026-11-09, during the first-run and mocks implementation review.
The manager allocated this number after the real public-handler counterexample failed.

The experimental bundle accepted a separate `schemaChanges` array.
Approval derived its worklist only from field comparisons.
A declared removal could therefore be accepted in a revision and disappear from the approved worklist and handoff.
The original public-handler probe recorded a removal of `Project.name` and then observed an empty approved schema worklist.
Its exact failing source and log remain preserved with the issue 549 counterexample artifacts.

The correction removes declared schema changes from the supported input contract.
Approval supports additions and type changes derived from the actual registered schema comparison.
Declared removals are unsupported.
The removed `bundle.schemaChanges` key has an explicit forbidden-key schema guard.
The guard is necessary because ordinary public excess-property decoding otherwise strips unknown keys.
A separate observation reuses the original removal payload and checks refusal before a mock revision or approval is recorded.
The permanent regression also checks that the refused input changes no event log state.
A valid bundle without the removed input still records and approves normally.
An admission refusal is not reported as a passing approval-handoff probe.
The unchanged-payload observation is retained as `/tmp/w05b-proof/schema-original-removal-admission.json`.
It records `Failure`, the fixed refusal reason, and no added events, revisions, or approvals.

## 551. Repository Design lacked a registered design-file identity and read

Found: 2026-11-09, during the Mocks and Design page preparation join.
The manager allocated this number for the bounded engine metadata correction.

The pending mock sources named screens, data, tokens, and component indexes.
They did not identify the repository Design file or expose a repository Design read.
The page would otherwise have had to invent a filename or reuse an unrelated component path.

`project.design.record` now records an immutable registration revision with explicit repository, workspace, and design-file identities.
The normal authenticated owner or an agent in the project can register actual bounded evidence.
The command verifies the registered checkout, branch, repository common directory, file confinement, and fingerprints.
`project.design.read` returns the selected registration revision and current bounded artifact availability.
Repository members must identify their own project in that repository.
An absent registration is explicit.
Changed, redirected, oversized, missing, and unreadable artifacts remain unavailable while retaining the registered identity.
Tokens come from the registered bounded token document.
Shared components retain their actual references and byte evidence.
A mock bundle can bind one exact Design revision in its repository.
The engine rechecks that evidence before mock approval.
No filename is inferred, and no editor, preview, URL fetch, or design-to-code process is started.

## 552. Mock scenarios lacked identities and concrete screen routes

Found: 2026-11-09, during the Mocks page preparation join.
The manager allocated this number for the typed scenario correction.

The pending scenario record carried a display name and a screen reference.
It did not retain a scenario identity or a concrete screen/scenario route binding.
A client would otherwise have had to guess a query value or substitute a display label into a route template.

Scenarios now have distinct typed identities.
Each screen records its base route and one explicit concrete route for every registered scenario identity.
Admission requires unique scenario identities, total route bindings, and valid references in the same mock revision.
It refuses duplicate, missing, unknown, redirected, or placeholder routes.
Public reads retain the scenario identities and exact recorded bindings.
The route metadata does not claim that a preview server is running or that a scenario has executed.
The later page owns isolated preview display and actual server availability integration.

Owner decision, 2026-11-09: Item 2 of the website simplification shortlist
supersedes the total-binding requirement described above.
Each screen retains its base route and only its supplied supported scenario routes.
An empty supported list is valid even when the revision declares scenarios.
Scenario identities and bindings remain unique, and each binding must name a
declared scenario and a concrete internal route.
Existing revisions and their stored bytes are not migrated.
This is an approved product simplification, not a new defect.
The historical finding and its original proof remain unchanged.

## 553. Another caller could replace an immutable mock or Design revision

Found: 2026-11-09, during the final bounded engine review.
The manager allocated this number after both authenticated public-handler probes failed.

Command receipts are scoped by caller and request identity.
Mock revisions are scoped by project and revision identity.
Design revisions are scoped by repository and revision identity.
Both record planners used the request identity as the revision identity without checking whether that revision row already existed.
A designer could record revision R, then an owner with no receipt for R could submit changed real artifact metadata using R and expected revision R.
Both commands succeeded and replaced the row's author and content under the supposedly immutable identity.
This defect was independent of same-caller receipt idempotence.

Both planners now refuse an existing revision key before constructing another recorded event.
The guard covers all retained revisions, including a revision behind the current head.
The ordinary command transaction serializes the check with the append.
An identical retry by the original caller still returns its existing durable receipt.
A fresh request identity can still create a new revision against the current expected head.
The public regressions retain the original attack requests and successful controls.
They assert exact refusal events and unchanged revision author, content, and approvals.
A separate approved-revision regression also retains the exact linked Design, approval, stage, and delivery state.
Every case compares the live views with a deterministic rebuild from the persisted event log.

The original failed source remains `/tmp/w05b-proof/revision-collisions-original-red.test.ts`.
Its source archive, source manifests, load record, and log remain under `/tmp/w05b-proof/revision-collisions-red-1-*` and its `.log` file.
The original Design and mock observations remain the distinct `design-revision-collision-red-observation.json` and `mock-revision-collision-red-observation.json` files in that directory.
The correction does not rewrite those red artifacts or reinterpret their original successful attacks as refusals.
The separate `revision-collisions-original-after-correction-1` observation reruns both original probe bodies and assertions.
Only their evidence-output filenames change, so the original observation files remain untouched.
Both original public attack constructions now refuse, preserve the original row, replay the designer's receipt, and permit the fresh-identity positive control.
The observer's exact derivation is recorded in `/tmp/w05b-proof/revision-collisions-observer-derivation.json`.

## 558. The Design token-document path admitted raw secret probes

Found: 2026-11-09, during the first explicitly granted full check of W05b.
The manager allocated this number and approved a bounded correction after the actual command exit.

`DesignRegistration.tokensPath` used the general nonempty `ProjectPath` string schema.
The unchanged secret non-admission oracle classifies TOKEN-containing property names and tests each property schema with raw secret probes.
The path schema admitted every original raw probe.
The registration occurs in events, subscription replies, thread replies, the Design record payload, and the Design read reply.
The first full check therefore failed seven existing oracle cases at that one property.
The engine's later JSON-file check did not satisfy contract admission.
This is a contract defect, not a sandbox failure.

The correction admits only a confined relative JSON-file path for `tokensPath`.
Contract admission and engine artifact reads share the existing repository artifact path predicate.
Traversal, absolute paths, control characters, encoded paths, and credential-directory or credential-file references remain forbidden.
No secret oracle, assertion, probe, or name rule changes.
No test allowlist or exemption is introduced.
Regressions check the original raw probes, invalid paths, valid JSON-file paths, and an absent optional path.
The authenticated public handler also refuses invalid input before an event or project-view change, then records and reads an actual valid token document.
The redaction fixture uses a real JSON-file path shape while retaining its original identity and prose-redaction assertions.

The original eight full-check failures remain in `/tmp/w05b-proof/full-1.log` with exit 1.
The original source manifest, patch, archive, modes, symlinks, load samples, process evidence, and original proof artifacts remain unchanged.
The seven exact failed schema paths are recorded in `/tmp/w05b-proof/full-1-failure-paths.json`.
A corrected focused pass cannot retroactively change that first full-check result.

## 559. The exact empty project snapshot fixture omitted owner-only setup

Found: 2026-11-09, during the first explicitly granted full check of W05b.
The manager allocated this number and approved the exact fixture correction after command exit.

The default-piece test expected the old empty owner project snapshot without setup.
The implementation now supplies durable Welcome setup only to the owner.
The test also expected the agent snapshot to equal the owner snapshot.
That equality no longer expresses the owner-only setup boundary.

The owner expectation now contains the exact base snapshot and Welcome setup.
The agent expectation remains the exact base snapshot and explicitly has no setup field.
Every namespace refusal, hold, request, secret, and compile-time assertion remains intact.
No production delivery authority changes.
The original failing assertion and actual snapshot diff remain preserved in the first full-check log.

## 560. Empty mock pages bypassed the final wrapped reply budget

Found: 2026-11-09, during the bounded review after the first full check.
The manager allocated this number before the independently gated public proof.

`project.mocks.read` measured candidate rows inside its pagination loop.
An empty project or a cursor after its last revision skipped that loop.
The final reply still echoed an unrestricted request identity.
A quote-heavy identity expanded during JSON serialization and expanded again inside an agent's data envelope.
Authenticated owner and project-member socket probes reproduced both empty and exhausted pages.
The owner replies were 280,027 bytes, and the member replies were 840,165 bytes.
All four exceeded the documented 262,144-byte limit.
Ordinary controls returned empty pages within the limit, without added events or project changes.

The read now measures its actual final wrapped reply before returning it.
An oversized final reply refuses with the fixed internal reason `mock reply exceeds the read budget`.
The socket retains its existing exact public `CommandError` with reason `command refused`.
The existing row pagination, cursor, authorization, and request-identity schemas remain intact.
Permanent regressions retain both caller identities, both empty-result paths, normal controls, and the original byte-budget assertion.
They additionally require strict refusal for the original oversized requests and unchanged events and project state.

The original four failed public probes and observations remain under `/tmp/w05b-proof/mocks-read-budget-original-red-1*` and `mocks-read-budget-*-original-observation.json`.
The exact original probe source remains `mocks-read-budget-original-red.test.ts` in that directory.
The separate corrected observer changes only the evidence-output filenames and preserves the original request constructions, controls, and assertions.
The original evidence is not rewritten as a passing run.
The first affected run after correction passed 1,582 tests and failed four added assertions that expected the internal reason at the socket.
The unchanged socket error mapper correctly returned the fixed public refusal instead.
The permanent tests now assert that exact public object and independently verify the internal budget reason through the authenticated command handler.
The failed affected log and unchanged source archive remain under `/tmp/w05b-proof/affected-558-559-560-1*`.

## 545. Main review had no explicit owner approval and merge path

Found: 2026-11-09, during the Git page preparation at `ca1d492`.
The manager reserved this issue number and the owner authorized its bounded engine follow-up at `bc783b2`.

The golden review shows tests, the reviewer result and its genuine thread, commits, and every available file diff.
It allows an explicit Approve without evidence choice.
The accepted `project.review.open` only verified a published source head and returned a compare URL.
Its `kind: compare` and `opened: false` did not create a pull request or record approval.
The original team integration correctly refused main and master.
There was no durable head-bound test or review reporting surface and no owner approval route.

The bounded correction adds a separate authenticated review preparation, evidence report, status, and explicit owner approval path.
Preparation records both reviewed heads without approving or merging.
Reported evidence carries the actual workspace and head, authenticated reporter, recorded time, and a validated existing project thread item.
It is labeled reported evidence rather than engine-executed proof.
Old-head reports remain stale, and missing or failed evidence does not impose a mandatory passing-test or reviewer policy.
The owner may explicitly approve without evidence.

Only the owner credential may approve and merge into main or master.
The service checks the actual authenticated caller again at execution.
It revalidates both reviewed heads, registered relationships, exact common directory, branches, clean worktrees, and merge-in-progress state.
It merges the reviewed commit identity rather than a substituted branch.
Agents remain refused, and the original integration refusal is unchanged.
Binary or incomplete review data refuses honestly.
The event log and normal receipts preserve the exact reviewed heads, explicit owner decision, and merged or refused outcome.
An identical retry returns its original outcome instead of merging twice.
A corrected attempt after refusal requires a new review and explicit owner approval.

External Git effects and the SQLite receipt are not one crash-atomic transaction.
A service crash after Git changed the checkout but before the outcome committed can leave an uncertain result.
The old destination-head precondition refuses a repeated execution when that head changed.
The owner must inspect the actual refs, bytes, and merge state before preparing another review.
A failed merge can leave real conflicts in the destination, which remain inspectable through the existing conflict API.
The engine never removes another process's locks or silently aborts the merge.
Same-Unix-user edits remain within the accepted limitation in SECURITY.md.

The permanent tests exercise authenticated public commands and real temporary repositories for both base names, evidence provenance and staleness, head and dirty-state refusals, authority denial, conflict recovery, production redaction, and receipt replay.
The test artifacts and builder result record their actual execution separately.
React, terminal support, and the rest of the five-step website scope remain separate work.

## 555. Owner approval could record a merge without the reviewed commit

The independent review of issue 545 found that `branch.main.mergeOptions=--squash` made an authenticated owner approval return a durable `merged` outcome while main still pointed to its old head.
The reviewed commit was absent from main's ancestry, and the feature bytes were only staged.
A successful Git exit did not prove the promised merge.
The same execution path supports master.

The correction overrides the destination branch's merge options for this invocation and explicitly selects a normal committed merge with fast-forward support and the standard strategy.
It merges the exact reviewed commit object.
Before returning success, it reads the actual destination head and verifies that the reviewed object is its ancestor.
An already-contained reviewed commit remains a valid no-op.
An absent ancestry or failed verification produces a refused outcome, without aborting or resetting the checkout.
The original owner checks, both reviewed-head checks, clean-worktree guards, agent integration refusal, queue, and finite subprocess ownership remain in place.
Git effects and the database receipt remain separate failure boundaries.

Permanent regressions cover both base names, squash and uncommitted merge defaults, fast-forward and divergent merges, contained commits, receipt retries, authority denial, and zero-exit outcomes without reviewed ancestry.
The original independent failure and its passing divergent and database-failure controls remain preserved in the run evidence.
The builder report records executed checks separately from this implementation description.

## 561. The launcher test assumed no system Node.js 26

Found: 2026-11-09, on the owner's Arch Linux computer through `make remote-check`.
State: fixed.

The launcher test "exits 1 with an install hint when NVM_DIR holds no Node.js" ran the launcher with only `HOME` and `NVM_DIR` set.
The launcher's shell then used its default search path.
Arch Linux has a system Node.js 26 at `/usr/bin/node`, and the launcher correctly used it, so the test saw exit 0.
The test now gives the launcher an empty search-path folder.
The launcher itself was right and is unchanged.

## 562. Two engine crash tests raced the roles stall watch

Found: 2026-11-09, on the owner's Arch Linux computer through `make remote-check`.
State: fixed.

The acceptance test "1 crash" checks the engine's own rule that nothing restarts a crashed agent.
The client test "6.2 a failed reload keeps a crash alert open until successful idle" checks the crash alert's life.
Both run with the roles stall watch on, and the stall watch resumes a crashed agent by design.
On the build server, the stall watch acted after the checks had finished, so both tests passed.
On the faster computer, it resumed the agent first.
The agent then crashed a second time and the owner was told twice, or the resumed session closed the crash alert early.
Both tests now turn the stall watch off, because each checks an engine rule rather than the stall watch.
Other tests may have the same hidden dependence on a slow computer.

## 563. Context search counted item bytes without the complete result

Found: 2026-11-09, during independent verification of signed `3dd4d20`.
The manager allocated the correction to W03DF1.

The documented 65,536-byte budget applies to the complete context search result.
Admission counted only the encoded item array.
An authenticated search over 91 actual schema-valid Git files returned a 65,529-byte item array inside a 65,557-byte result, with `truncated: false`.
The request identifier was an ordinary universally unique identifier.
The verifier's original probe, inputs, observation, failed log, and metadata remain unchanged.
Earlier escaped-request-identifier probes measured larger outer replies, rather than a breach of this result-only budget.
The earlier invalid task-title and import attempts remain historical test failures.

Admission now counts the complete encoded result, including its field names and truncation flag.
It reserves the longer `false` encoding even when truncation has already occurred.
The byte budget excludes the reply's request identifier and the agent envelope.
Authenticated owner and member regressions exercise real files at the original overflow and the nearest overflowing and fitting encoded results.
They check canonical bounded prefixes, truthful truncation, smaller limits, ordinary under-budget results, empty results, and foreign-project refusal.
The filenames include multibyte text and quotation marks, so the assertions count encoded bytes.
The existing project access, candidate and result counts, Git read bounds, redaction, and plain-text delivery rules remain unchanged.

## 567. The context refusal fixture assumes no setup deliveries

The merged context refusal test expected an entirely empty delivery map after its setup created owner tasks.
The accepted task-creation path now queues legitimate lead notices during that setup.
The combined proof passed package and root typing and failed this stale fixture assertion with three legitimate task-notification deliveries.
The fixture now compares the complete delivery map before and after every refused context request, including raw decoder cases.
All existing refusal, secret-redaction and deterministic rebuild assertions remain.
The production context and owner-task delivery paths are unchanged.
Status: corrected in the website composition; combined proof and independent review are required.
## 564. An area-less first team stranded later teams at the same stage

Found: 2026-11-09, in independent source review and the builder's actual authenticated public reproduction on signed `ce7a816`.
The manager allocated this number and approved the bounded correction.

The first Build team without an area was admitted.
A second Build team with area Web in a real registered child worktree was then refused because its peer lacked an area.
The refusal event stated `teams at the same stage require distinct areas`.
The public contract permits an omitted area, and there is no team-edit recovery path.

The correction removes only the peer-area admission rule.
Stage and area remain optional.
Stage-derived names, case-insensitive unique names, workspace validation, groups, channels and receipt semantics remain intact.
Permanent authenticated socket regressions cover an area-less team before and after an area-labelled peer.
They verify real registered worktrees, both successful team channels, identical receipt replay, changed-body refusal, and duplicate-name refusal on a separate unclaimed worktree.
A further ordinary control retains a custom name with no stage or area.

The original five-probe source, exact red observation, source archive and normal exit 1 log remain unchanged under `/tmp/w05b-postreview-proof`.
The separately derived corrected observer retains the original team success expectation.
No team-edit machinery is added.

## 565. Mock artifact reads bypassed the final wrapped reply budget

Found: 2026-11-09, in independent source review and the builder's actual authenticated public reproduction on signed `ce7a816`.
The manager allocated this number and approved the bounded correction.

`project.mocks.artifact` bounded its repository file but did not measure its final reply.
An unrestricted quote-heavy request identity expanded during serialization and again inside the member data envelope.
The actual owner available and unavailable replies were 280,157 and 280,080 bytes.
The actual member available and unavailable replies were 840,307 and 840,226 bytes.
All four exceeded the documented 262,144-byte limit.
Ordinary small-request controls passed, and all reads preserved the exact event log, receipt rows and complete views.

The correction measures the actual final wrapped artifact reply before returning it.
An oversized reply refuses with the internal reason `mock artifact reply exceeds the read budget`.
The existing public socket refusal remains `CommandError` with reason `command refused`.
Permanent socket regressions cover both caller identities, real available files, absent registered files, ordinary controls, the original oversized payload and unchanged read state.
They retain the original byte-budget assertion and additionally require strict public refusal.

The original four complete requests, replies and observations remain unchanged under `/tmp/w05b-postreview-proof`.
The original log remains a normal exit 1 with five failed probes, including issue 564.
A separate corrected observer changes only output destinations and adds strict outcome assertions; its exact derivation is preserved separately.
This correction does not change mock, schema or Design metadata contracts.

## 566. Reading review evidence could deadlock an owner approval

The independent review of issues 545 and 555 found a lock-order inversion.
The review status reader held the Git gate while validating a recorded thread through the shared Structured Query Language (SQL) connection.
A concurrent owner approval held that connection inside its writer transaction while waiting for the Git gate.
Both authenticated calls then remained pending after the active Git child finished.
The matched case without recorded evidence completed because it needed no thread query.

The status reader now completes its authorized project and checkout inspection under the Git gate and releases that gate before querying thread evidence.
It evaluates the evidence against the exact source head observed during that inspection and the same authorized snapshot.
The project, workspace, repository, branch, thread membership, redaction, and reply-budget checks remain in place.
Command transactions and active Git child ownership are unchanged.
The other Git read handlers do not query the SQL connection while holding the Git gate.

The permanent regression overlaps actual authenticated status and approval calls with recorded thread evidence and a matched no-evidence control.
It establishes an actual Git child barrier and observes entry after SQL begins its transaction.
Both calls must finish, and the approved destination must contain the reviewed commit and expected bytes.
The test also checks the durable decision and receipt, identical retry, and a rebuild from the event log.
Original failed probes and their historical invalid-barrier attempts remain preserved separately.
The builder report records actual red and green execution boundaries.

## Website plan documentation correction, 2026-11-09

The independent review of the owner-approved simpler website plan found that the first proposed issue-recording paragraph could exempt in-unit problems from this list.
The proposal had not been applied.
The correction retains the requirement to record problems here in the same change.
The manager allocates new issue numbers for defects found outside the unit being changed.
An in-unit correction updates its existing issue documentation and result without allocating a separate number.
The original rejected proposal and Grade 8 review remain preserved in the website run records.
The corrected paragraph received a separate independent review.

## 568. Request and Add task retry caches retained text across owner sessions

Found: 2026-11-09, while composing the replacement website.
State: fixed in the composed website source, awaiting its full verification and review.

Unconfirmed request answers and Add task commands survive page navigation so that a retry keeps its original command identity.
The module caches also survived logout within the same document.
A later owner login could therefore receive the previous session's command text or submission lock.

`clearRequestAttempts()` in `packages/web/src/thread/requestAttempt.ts` removes all cached entries, wipes their command data, and invalidates captured entries so that a late response cannot restore them.
`clearAddTaskAttempts()` in `packages/web/src/pages/AddTask.tsx` removes pending task payloads and advances the session generation so that an old receipt cannot affect a later session.
The composed `packages/web/src/app.tsx` calls both functions in `sessionExpired`, after a confirmed logout response or an already expired session response, and in its App unmount cleanup.
An unsuccessful logout does not discard the current session's recovery identity.

Both caches exist only in module memory.
A document reload creates new empty caches.
Neither cache writes to local storage, session storage, or IndexedDB, and this correction does not claim to purge persistent browser storage.
It does not delete authoritative requests, change their holder or open-state logic, or erase answers already accepted by the engine.

Focused tests cover retained failed and sending attempts, navigation within the same session, clearing before a new mount, and late completion isolation.
The actual composed App also has the integrator's logout and relogin regression.
Browser execution and the composed full verification remain separate gates.

## 569. The mounted project composition test cannot observe its answer textarea on the owner's computer

Found: 2026-11-09, during the composed website builder's first and second remote full checks.
State: corrected in the composed test fixture, awaiting a newly granted full check and independent review.

The original `packages/web/test/project-composition.test.tsx` fails at assertion 54 because its answer textarea is absent.
The first full passed 7,084 tests and failed two tests.
The second full passed 7,085 tests and failed this test alone after the separate alert section selector was corrected.
Both commands stopped before browser execution.
The original project composition test passed an instrumentation-free local focused run without changing its assertions or default timeout.
The different results do not establish a host-load or timeout cause.

A bounded observational copy reproduced the missing textarea on the owner's computer with one test worker and the same fourteen processors used by the full check.
The actual request read returned an open question held by the owner, with `canAnswer` set to true.
The actual source-event read returned the matching question, agent, sequence and proposed answer.
On that failed run, the source reply arrived after the click's React `act` boundary ended, while `vi.waitFor` was running inside a single awaited `act`.
Every subsequent poll still observed the full-request loading message and no textarea.
The successful local observational run received the source reply inside the click's `act` and had the textarea at its next boundary.

Controlled local and remote comparisons established the test's asynchronous React observation and commit boundary.
They held only the actual source-event reply until after the click's `act` finished and released it during observation.
The original helper failed with that held reply on both computers.
The corrected helper passed both the natural-response and held-response cases on both computers, retaining every original behavioral assertion and the default timeout.
The original natural-response control also failed on the owner's computer and passed locally.
Both comparison commands retained their actual nonzero exits because their original-helper cases failed.

The integrator's narrow fixture overlay runs `vi.waitFor` outside `act` and finishes an `act` during each polling attempt before checking the unchanged assertion.
The corrected original test then passed its instrumentation-free local focused run.
The original W07 author source and hash remain preserved separately from this W06 correction.
No timeout, assertion or production component changed.
The exact source, file modes, symbolic links, font target files and collected author artifacts remained unchanged.
The failed full logs, original focused result and raw local and remote diagnostic observations are preserved separately.
A newly granted exact-source full check, actual browser execution and independent whole-composition review remain required.

## 570. Replacement navigation and service regions invalidated old browser entry selectors

Found: 2026-11-09, in the fourth composed website verification.
State: fixture correction prepared, awaiting focused checks and a newly authorized full verification.

The original browser cases for conversation history and phone thread answering searched for a visible standalone agent link at a width of 360 pixels while navigation was closed.
The replacement shell keeps its closed phone navigation inert.
The agent links also include their displayed state in their accessible name.
The original Alerts and Settings layout cases waited for regions named Alerts and Settings.
The actual service regions are named Phone notifications and Service settings.
All four original browser failures and their complete contexts remain preserved.

The two agent cases now open the actual navigation with its existing helper and click the named agent inside the Projects navigation.
The two service cases now select the actual named regions.
The legacy service URLs, real navigation actions, history, delivery, answer, refresh, recovery, storage, and phone overflow assertions remain unchanged.
No timeout is increased.
These are W06 fixture corrections, and they do not change W10 service presentation.

## 571. Native browser offline did not immediately disable shared mutations

Found: 2026-11-09, in the fourth composed website verification.
State: correction prepared, awaiting focused checks and a newly authorized full verification.

The foundation browser case switched its actual browser context offline while a thread remained mounted.
Send prompt remained enabled and failed the unchanged assertion.
The shared mutation guard observed the snapshot watcher's connection and completed reads, but it did not observe the browser's native offline signal.
No host-load or transport-timeout cause is claimed.

The shared data provider now disables mutations on the native offline event and aborts retired watcher and projection reads through their existing scopes.
It retains the visible view and mounted prompt draft.
A native online event starts a new authenticated watcher generation.
Write readiness requires that generation's actual snapshot and coherent paged collections, including the final sequence check.
The native online event alone cannot enable writes.
The original browser offline, draft-retention, recovery, and viewport/theme assertions remain unchanged.
A mounted App regression exercises native offline and online while its transport streams remain live and its recovery collections are held pending.

A later passive observation of the unchanged Conversation journey confirmed another recovery gap in this provider.
The shell published snapshot revision 18, and its next authoritative request page was already at revision 19.
The exact revision guard correctly rejected that collection, but a quiet stream supplied no later snapshot and the failed read scheduled no recovery.
The original full failures, natural journey failure, and complete passive observation remain preserved.
This is an in-unit coherent-recovery correction under issue 571, with no new issue number.

A nonaborted collection failure now requests a fresh snapshot by restarting the existing shared watcher generation after a backoff.
The delay starts at 250 milliseconds and increases to at most 5 seconds, and coherent success resets it.
Previous complete reads and the mounted draft remain visible, while writes stay disabled until the new snapshot and every exact revision check agree.
Abort, snapshot replacement, native offline, session expiry, confirmed logout, and unmount cancel the old recovery scope.
An old scope cannot restart a later owner session.
Deterministic mounted App regressions cover the quiet revision mismatch, held final coherence, bounded backoff, replacement, offline recovery, and session teardown without parallel shared watchers.
The original browser journey and every assertion and timeout remain unchanged; a new browser proof is still required.

## 572. Request consumers repeated an already recovered immutable source read

Found: 2026-11-09, in the fourth composed website verification.
State: correction prepared, awaiting focused checks and a newly authorized full verification.

The oversized-state browser case recorded two client.event requests for the same request sequence on distinct sockets.
The unchanged oracle requires exactly one source recovery.
The browser client already yielded the actual recovered request envelope to the shared watcher.
The watcher discarded that immutable source, and permission summaries, expanded request details, and later independent thread hydration owned separate source reads.
The original failed proof and its complete context remain preserved.

The owner-session data provider now owns one reader for immutable request sources.
The shared watcher seeds the actual full request envelope before publishing the snapshot that exposes its request row.
The shared request components and the independent thread's request hydration use that reader and share pending source reads.
Their sequence, event kind, request identity, and agent checks remain in place.
An identity rejection discards that cached source so that a later read can retry.
Failed reads do not become usable cached data.
The reader supplies no request projection and decides no holder, status, or permission to answer.
Those decisions still use the authoritative engine data and existing request components.

Only PermissionRequested and QuestionAsked envelopes are retained.
Retention is limited to 64 sources and 8 mebibytes, with older sources evicted when necessary.
A source larger than the byte limit is delivered whole to its caller but is not retained.
At most 64 source reads can be pending, and an excess read receives a retryable failure.
Unrelated conversation events are never retained by this reader.
Provider unmount, confirmed logout, and session expiry close the reader, clear its captured sources, abort pending reads, and prevent late completion from restoring the old session's data.
A fresh document also starts with empty memory.
No persistent browser storage or accepted engine/client protocol implementation is changed.

The RequestList and page-fixtures changes are explicitly W06 overlays on preserved W07 originals.
The required data-context addition in admin-controls is a W06 test-input overlay on the preserved W10 original.
The original author reports and artifacts remain separate from integration proof.
The browser read-count, uncertainty, slow-link, live-event, socket-survival, and answer assertions remain unchanged.
All eight viewport/theme combinations remain in the browser source.

## React foundation in-unit review: project tables dropped visible fields

The independent review of `a413986` reproduced four symptoms in the shared project table.
Home and the repository page omitted the project's Stage.
Home placed the repository below the project name instead of in a separate Repository column.
A project with a failed agent said “Failed start” instead of “Needs attention”.
The original independent control passed, and all four new parity assertions failed.
This is a correction inside the foundation unit, so the manager's in-unit numbering rule assigns no separate issue number.

The shared table now reads the existing typed stage and its common label.
Home includes the Repository column, while the repository page filters its projects and omits that redundant column.
Failed members and open owner-held requests use the attention status, with archived and archiving states taking precedence.
The phone retains its two-line layout, with the status first on the second line.
Desktop rows keep one line.
Permanent tests cover the fields, filtering, stage labels, state changes, and plain-text names.
The actual-engine browser matrix now includes both project tables at all four widths in both color modes.
These changes await their own verification and independent review; earlier foundation passes do not prove the correction.

## New project in-unit integration: focus after returning from Machines

Found: 2026-11-09, while joining the authored form to the accepted React foundation.
State: the mounted regression and the native browser case passed in the first joined full run.

Home unmounts when Add repository opens Machines.
Retaining its original button would restore focus to a detached element after registration or Cancel returned to Home.
The owner-scoped creation session now resolves the current Home button when the native dialog closes.
The Machines return retains the original route, draft, and frozen creation request.
The mounted regression checks that Escape focuses the replacement Home button.
The separate native browser case passed its focus assertion in that run.
The full run failed at the distinct lost-reply fixture described below.

## New project in-unit follow-on: dedicated worktrees and the lost-reply fixture

The owner released F2, issue576, after the first joined full run.
Every project now requests its own worktree, and the form no longer offers a checkbox.
The original New project author owns this controller and form overlay.
The flow-fix author owns the separate engine refusal of main-checkout requests.
No pending engine correction is imported here.

The first joined full passed every unit case and failed one browser assertion.
Its lost-reply fixture expected manual uncertainty after terminating sockets once while leaving the listener available.
The collected document instead showed the actual project lead's live thread and original goal.
The existing client retries transport failures with the same request, so a single close permits automatic receipt recovery.
The failed run did not retain its wire-frame count, and the exact replay is not claimed as measured evidence.
The revised fixture separates a single-close automatic control from a disabled-listener case that exhausts normal transport retries before manual recovery.
The original five-second uncertainty assertion, failure and frozen source remain preserved.
Both new cases retain exact-body, one-receipt, one-project and one-lead assertions.
Both cases passed the bounded proof and the later ordinary full's browser phase.
The later full failed at the separate keyboard boundary described below.

## New project in-unit follow-on: native modal keyboard boundary

The second joined full failed when Shift+Tab from Close moved focus outside the dialog.
The preserved passive diagnostic reproduced it with stable dialog and control identities.
The dialog stayed open and modal, while the active element became BODY and the document lost focus.
The recorded controls stayed enabled, so those observations support native boundary departure rather than a readiness change or remount.
The dialog now handles only Tab at its current visible, enabled endpoints in both directions.
Native initial focus, Escape, and opener restoration remain in place.
The original browser containment assertion remains, with a forward-wrap consequence added.
The focused test covers both directions and changed disabled or hidden endpoints.
The diagnostic source and failed selector attempt are preserved separately.
This correction awaits its own bounded verification; the previous full remains failed.

## 599. Compound remote-run commands could execute their tail locally

Found: 2026-11-10, during the manager's W08 original/candidate proof.
State: corrected in the remote tooling; local transport controls pass.

Make interpolated CMD into its recipe as unquoted shell source.
An operator such as && or a semicolon could split the invocation, leaving later commands on the local computer.
The first affected W08 result is withdrawn, and the replacement logs print the actual remote host and tested source hash after sync.
Make now exports the literal command value and passes it as one quoted Bash command argument to the remote script.
The remote-run target still syncs first, which replaces changes made only in the remote copy.
The documentation now states that order explicitly.
Local controls exercise compound commands, quotes, newlines, shell expansion, failure propagation and remote-only output using a local stand-in for SSH.
They also verify that tracked and untracked .env files are excluded while .env.example remains eligible for copying.

## 575. A Git effect could be followed by a durable false refusal

A merge or commit can finish before the outcome transaction fails.
Git mutations now use a typed attempt in the existing event log, followed by a short outcome transaction.
An attempt preserves the exact caller, request, body hash, workspace, and pre-effect Git identities without storing a raw message or payload.
A prior unresolved attempt takes precedence over later failed admission.
An uncertain outcome has no success or refusal receipt, and the normal writer failure latch remains mandatory.
The original signed correction reconciled the durable reviewed pair only when both reviewed heads were ancestors of the actual registered destination.
A divergent reviewed source need not descend from the reviewed base.
Its commit reconciliation compared the frozen index tree, intended retry message, branch, and complete parent set, including a pending merge parent.
Issue 596 retires these retry branches in favor of terminal uncertainty; a fresh owner approval keeps the actual two-ancestor containment proof.
The original equivalent-state failure remains preserved separately from actual post-merge SQL failure tests.
The first bounded corrected run passed fast-forward and divergent post-effect failure controls.
The signed 75f48a8 source passed its actual full check: 7,532 tests, two skips, 500 files, and 20 browser tests, with recursive and root typing and credits passed.
The independent round-one review remains Grade 6, with no blockers, three majors, four minors, and no flags.
Issue 590 records the subsequent reply and cleanup correction, whose signed 27e38c85 source passed its full check.
The Grade 7 review remains preserved; current corrections in issues 595–598 await independent re-check.

## 576. A new project repository lacked a usable main destination

An unborn main checkout cannot serve as the reviewed destination for a project's first commit.
New project repository creation now writes an empty initial main commit and records its main workspace.
The initial commit contains no user files.
The owner approved requiring a dedicated worktree for every project on 2026-11-09.
The dialog has no worktree checkbox and always previews Branch and Folder.
Engine creation and preview refuse useWorktree=false before effects.
Unfinished main-checkout intents remain readable and reserved, but cannot resume effects.
Main remains recorded separately for owner review and approval.
The original pre-decision full failure is preserved.
The dedicated-worktree engine correction passed the 328-case affected run and the full check on signed 75f48a8.
The original dialog author owns its checkbox-removal overlay at composition.
The independent review found the existing-checkout branch gap recorded in issue 591; acceptance remains pending.

## 577. A linked question could finish another worker's task

Linked question admission now requires the task owner or the project's lead.
Completion checks that authority again against the current task owner and project membership.
Holding or answering the question does not grant authority over its linked task.
The first bounded corrected run passed another-worker refusal and own-task and lead controls.
Cross-project, reassignment, and rebuild coverage are retained or extended in this unit.

## 578. A failed creation had no way to release its durable reservation

The owner-only project.creation.abandon command finishes a recorded creation intent without changing the filesystem.
The command shares the lifecycle lane so abandonment cannot race an active creation.
The typed client, command-line interface, and Model Context Protocol inventories include the command's access decision.
The command adds no visible control to the mock.
Interrupted-creation and replaced-folder safety checks remain required.

## 579. A slow Git mutation could hold the global writer

Git mutations now take a request lane, perform a short writer preflight, run Git under the existing runtime gate outside the writer, and record the outcome in a short transaction.
The runtime gate remains the only Git queue.
No Git gate holder acquires the SQL writer.
The original 250 millisecond negative observation remains limited evidence.
The corrected bounded regression passed an actual independent writer operation while a real Git merge child remained held at a controlled barrier.
Registration, creation planning and final verification, Design recording, mock recording and approval, and file-context preparation now also observe Git outside the writer.
Their final admissions rerun against current state instead of appending an old prepared event plan.
Separate stale-binding, revision, access and recipient controls, and a queued-registration and creation barrier regression have been written for these additional paths.
The unit 4 bounded run passed the queued-registration and creation barrier, including a positive independent writer completion while real Git remained held.
It also passed 19 stale-state controls.
Four new Design controls failed with a generic refusal.
Two preserved narrow diagnostics traced that refusal to missing Design planner and read registrations in the handler maps, despite complete source maps, remote procedure declarations, and access entries.
The eager maps captured an incomplete module cycle under the Design-first import graph.
Both maps now initialize lazily once, retaining their exact contents and stable identities.
The corrected bounded run passed all 23 observation controls and all five fresh child import orders, and recursive and root typing passed.
The same run retained one architecture failure for two direct caller-encoder imports from the log module.
The caller encoder now has one writer-free identity module used directly by all consumers.
Git attempt writer orchestration now belongs to commands rather than the project piece.
The boundary correction and joined current Machines and guidance contracts passed the 147-case affected run and full verification on signed 75f48a8.
Future W10B guidance rendering was not joined and remains unproved.
These results do not establish a universal runtime separation claim.

The first full check exposed a same-request start/stop regression because the request lane covered runner setup and stop settlement.
The handler now releases that lane before a non-process continuation, while process commands retain request-before-process ownership through cleanup.
Lifecycle ownership comes first, and archive members are acquired after the request lane.
The original five-second start oracle and Git uncertainty controls are unchanged.
New overlap controls exercise both archive and stop ownership orders, with positive member-lane acquisition after a recorded stop attempt.
The lane correction passed the 328-case affected run, including all eight original start/setup cases and both overlap controls.
The subsequent full check passed on signed 75f48a8.
Independent round-one review found no lock-order defect; correction-unit acceptance remains pending.

## 580. Placement could claim an unsupported workspace move

A project.place request that changes its workspace or machine now refuses until machine pairing exists.
The Machines page now displays the assigned checkout without offering another checkout as an available move.
It explains that changing placement requires unavailable machine pairing.
Its source was joined onto the independently accepted foundation cb049eae before editing.
Static installation and login guidance now lives in one typed page module, with the existing visible text preserved.
The discovery contract and engine return runtime facts instead of static page guidance.
The current frontend and guidance contracts passed their affected checks and the full check on signed 75f48a8.
The owner subsequently required disabled placement and retry controls with pairing hover advice, so this correction restores those controls without request handlers.
The new control source still needs its own verification and independent re-review.
The static helper remains for W10B; later rendering is not claimed.

## 581. Recording mocks could bypass stage authority

A mocks command that changes the project stage now uses the same lead-or-owner authority as an explicit stage change.
A member can still record a revision that leaves the stage unchanged.
Owner approval retains its existing authority.

## 582. Context search bounded its result but not its complete reply

Context search retains its exact 64 kibibyte result limit and truthful truncation flag.
It now checks the complete owner or member reply, including the request identity and member data wrapper, against 256 kibibytes.
An oversized wrapper receives a fixed safe refusal without changing read marks.

## 583. Creation used independent and stacked Git queues

Creation now uses the runtime's shared Git service through its existing gate.
The private queue inside each Git service has been removed.
Both prospective placement observations and final checkout verification run before their short admission transactions.
The final creation admission rechecks its durable intent, settings, registered placements, reservations, collisions and current lead before planning the launch.
Creation filesystem witnesses remain because interrupted mkdir and replaced-folder ownership must still be proven before adopting an existing folder.
Abandonment releases only the durable reservation and never removes a witness, checkout, branch, or user file.

## 584. Restart could resume a member of an unfinished archive

Restart now attempts to finish durable archive intents before it considers reloading agents.
An archive that cannot finish remains visibly unfinished.
Paused and interrupted agents whose project is archiving or archived are excluded from automatic reload and account recovery.
The reload input check also enforces this rule.

## 585. Network Git shared the short read subprocess timeout

Explicit fetch, pull, and push now use a separate bounded network subprocess timeout.
Local read subprocess limits remain short.
Cancellation still reaps the child process group and never deletes a lock without proving ownership.
A possible mutation followed by timeout remains uncertain under issue 575.

## 586. Credential filenames were filtered inconsistently

The original correction shared the credential-name predicate across repository artifacts, context references, and Git paths.
Independent review found that applying it to every Git path also blocked owner mutations and whole-result reads; issue 589 records that correction.
Containment, symlink, nested-repository, redaction, and complete reply limits remain enforced.
Real confined safe-file and owner/member refusal controls are required before delivery.

## 587. Repository configuration runs with the owner's Unix authority

LGTM Studio is a local program for one owner.
An owner-controlled repository can configure Git content filters or merge drivers that run as that same Unix user.
The current security boundary accepts that repository-configuration scope.
This unit documents the limit and does not claim to sandbox owner-controlled Git configuration or introduce a different threat model.


## 588. Aggregate untracked patches repeated full status scans

The original Git author isolated a recursive aggregate diff call that repeated HEAD and status reads for every untracked file.
The manager supplied that paused author's exact two-file patch for the shared correction in this unit.
Both owner and filtered agent aggregates now reuse one complete status snapshot and one HEAD observation, then use the same bounded direct no-index patch per admitted untracked file.
Literal paths, binary flags, full text statistics, byte and entry bounds, symlink checks and agent exclusions remain consequential in the adopted real process-count controls.
This is one canonical correction, shared with issue 598; its new proof and independent re-check remain pending.

The original Git author's sealed diagnostic recorded 71 recursive entries and 302 actual Git child calls.
Its original five-second assertion failed with 55 child calls unsettled.
The observed gate wait was 0.027 milliseconds, with no competing admission during that execution.
Call-to-spawn intervals and child wall intervals remain separate evidence, without a CPU, network or load cause claim.
The original narrower three-path preparation and all its proof remain archived in that author's retained worktree.
The author's later accepted-source join supersedes those engine paths with the canonical implementation and regressions from b974da0.
The original browser failures remain failed; the accepted flow proofs do not prove the subsequently joined Git page.

The joined page's later full12 passed its unit checks and failed three browser cases.
Its aggregate returned complete data near the original assertion boundary, without a proved allocation between gate waiting and child work.
The page also withheld received sync counts behind final working identity checks and invalidated coherent data after read-only review preparation.
Shared projection completeness restarted Git reads even while the connection remained live.
Seven consequential mounted controls failed on that original page; a lost preparation reply remained uncertain in the eighth passing compatibility control.
The scoped UI correction separates received counts from mutation readiness, preserves read continuity with explicit reconnect recovery, and retains review readiness only for an exact matching coherent generation.
The candidate's two mounted files passed all 50 controls, and web typing and credits passed.
The canonical aggregate engine implementation is unchanged.
The later full15 passed 7,675 unit tests and 36 browser cases, but the layout case again missed its five-second 71-file assertion.
Its second aggregate delivered complete data and the observer later counted 71 wrappers; the assertion deadline was not recorded, so that trace does not establish the cause.
The unchanged selected run16 passed and remains inconclusive about that failure.
The layout fixture now indexes its same 71 real files before opening the page, leaving file contents, layout assertions, commit count and deadlines unchanged.
The separate real aggregate regressions retain the untracked-file and process-count coverage.
The corrected layout case passed its eight viewport and theme combinations remotely with the original assertions and deadlines.
All nine selected real aggregate regressions also passed remotely, including the six 71-file owner and agent cases.
These results do not retrospectively establish the cause of the full15 failure.
The complete remote check then passed all 7,675 unit tests and all 37 browser cases, with two unit tests skipped.
The temporary browser observer, assertion reporter and explicit aggregate probe were subsequently removed from delivery under the owner's observability rule.
Their original source and artifacts remain in the retained investigation evidence.
The observer-free related browser run passed ten cases and failed the final push count assertion.
One diagnostic execution and three bounded repetitions passed, so those observations do not establish the cause of that failure.
The browser now requires the visible push acknowledgment separately before its existing fresh outgoing-count assertion.
Both assertions retain the default five-second timeout, and the case retains its original 120-second timeout.
All temporary observations were removed again before delivery.

## 589. Credential-name exclusion blocked owner Git operations and whole agent reads

The round-one independent review found that the credential-name predicate was inside the shared literal Git path validator.
Owner stage, unstage and discard operations consequently refused ordinary tracked credential-shaped filenames.
Aggregate diffs also failed instead of omitting excluded agent-visible files.
The correction keeps ordinary owner literal path rules and applies the shared predicate before actual agent-visible file and patch reads.
Agent working, staged, committed and review aggregates omit excluded entries, including renames with an excluded side.
Context and artifact exclusions, containment, symlink checks, redaction and reply budgets remain.
Consequential owner mutation and agent read controls passed on that signed source.
The full check on signed 27e38c85, exact source 6b6cd964, passed recursive/root typing, 7,565 tests across 500 files with two skips, all 20 browser cases, and credits.
The original Grade 6 and later Grade 7 reviews remain preserved; the current whole-unit correction and independent re-check remain pending.

## 590. Git failures lost known reasons and uncertain attempts accumulated

The original attempt marker treated every failure after a subprocess started as uncertain.
The reply asked for an identical retry even when no positive reconciliation was supported.
The correction preserves fixed conflicts, rejected push, diverged pull and refused-remote reasons only when actual Git evidence establishes them.
Those determinate outcomes have ordinary durable refusals or explicit refused review outcomes and replay without another mutation.
Timeout, cancellation and lost outcome transport remain unknown.
Issue 595 records the later review finding that the initial determinate classifier was too broad after local partial effects; its correction is not credited to the prior full pass.
The fixed unknown reply is “Git outcome is uncertain; refresh Git state”.
A successful actual Git state read with a pending attempt holds the workspace operation lane before observing Git, then takes each original request lane before a short writer transaction.
Ordinary reads without a pending attempt keep only the shared Git gate, as issue 597 requires.
Current workspace, root, placement and caller access are checked again before cleanup.
The existing GitFinished event carries an optional uncertain outcome, and the existing receipt preserves the original caller, request and body hash.
Its bounded optional refusal enum preserves the five known Git outcome codes across replay while ordinary refusal prose stays redacted.
The old request remains terminal uncertainty after cleanup and restart; it cannot execute again or claim success or refusal.
A failed or stale read leaves the attempt unchanged, and a live mutation cannot be closed by a queued refresh.
The project piece remains free of writer orchestration, and no Git gate is acquired under the writer.
The original crash, ancestry, writer-latch and open-review controls remain, with new cleanup, binding and authority controls written.
The full check on signed 27e38c85, exact source 6b6cd964, passed recursive/root typing, 7,565 tests across 500 files with two skips, all 20 browser cases, and credits.
The original Grade 6 and later Grade 7 reviews remain preserved; the current whole-unit correction and independent re-check remain pending.

## 591. Existing repository creation could persist a feature branch as main

Creation previously recorded the main checkout's current branch without requiring main or master.
The review route then refused that permanent destination even after an external branch switch.
Creation and preview now require main or master before a new intent or filesystem effect, and saved intents are checked before resumed effects.
Final main-state observation also refuses a non-main destination.
The exact actionable pre-effect reason is “check out main or master in the main repository checkout before creating a project”.
An initial branch refusal enters current final admission and receives a terminal receipt only while no intent exists; unfinished-intent and unavailable-account retries keep their existing policy.
The New project controller's original author will consume this fixed reason directly at composition; no peer controller is edited here.
First-main initialization, dedicated worktrees, intent ownership, receipt identity and owner review remain.
The full check on signed 27e38c85, exact source 6b6cd964, passed recursive/root typing, 7,565 tests across 500 files with two skips, all 20 browser cases, and credits.
The original Grade 6 and later Grade 7 reviews remain preserved; the current whole-unit correction and independent re-check remain pending.

## 592. Task reassignment left a valid linked question permanently open

An answer previously refused when the original asker no longer had authority over the linked task.
The new task owner then remained blocked by that open question.
A valid holder answer now closes the question and delivers its redacted answer normally.
Only the TaskChanged completion event is omitted when the original asker lacks current task authority.
The task's projected state and answer history preserve that distinction.
Holder checks, atomic delivery, terminal receipt and authorized task completion remain.
The full check on signed 27e38c85, exact source 6b6cd964, passed recursive/root typing, 7,565 tests across 500 files with two skips, all 20 browser cases, and credits.
The original Grade 6 and later Grade 7 reviews remain preserved; the current whole-unit correction and independent re-check remain pending.

## 593. Git process-wrapper tests are sensitive to host load

The independent Opus round-one review observed eight default five-second timeouts in main-review.test.ts at a load near 39 on 38 processors.
All 31 cases passed when the reviewer separately used a 60-second timeout.
That is attributed reviewer evidence, not a builder rerun or a passing result at the original timeout.
The wrappers start a Node.js process for each Git call.
This unit records the sensitivity without increasing timeouts, rewriting wrappers broadly or running a loaded local full.
Original failures, original timeouts and the lightly loaded remote full proof remain preserved.


## 595. Broad failure text marked partial Git effects as determinate

The Grade 7 re-review found that local permission errors and mixed-reference fetch failures could acquire a known refusal after Git had changed files or references.
Local process failures now remain conservative and never map permission text to authentication_required.
Only explicit fetch, pull and push boundaries can classify constrained remote refusal evidence; push rejection is specific to push, and pull divergence uses its exact terminal diagnostic.
Conflict admission still requires both MERGE_HEAD and actual unmerged entries.
Real partial fast-forward merge, pull permission, mixed-reference fetch and main-approval controls retain actual changed bytes/references and uncertainty without a durable refusal or successful review decision.
Implementation and controls are written; new proof and independent re-check remain pending.

## 596. Refresh made the old reconciliation branches mostly unreachable

The state refresh policy clears attempts into terminal uncertainty, so commit and approval reconciliation on identical retry added a parallel policy that the page rarely reached.
Those retry reconciliation branches are retired.
An old attempt returns uncertainty before and after refresh, while exact caller, command and body reservations survive rebuild.
A new owner approval request still uses the existing actual two-ancestor containment proof without another Git merge.
The read comment now documents terminal uncertainty receipts.
The actual post-Git SQL failure, writer latch, parent/ancestry and open-review controls remain, with expectations updated to this simpler policy.
New proof and independent re-check remain pending.

## 597. Ordinary Git state reads unnecessarily queued for mutation lanes

The state-read cleanup originally acquired a workspace operation lane even when no pending attempt existed.
It now observes current authority and workspace identity, then takes that lane only if the current workspace has a pending attempt.
The ordinary path retains the shared runtime Git gate and does not clean up attempts that started after its check.
The pending path retains current binding/access admission, original request lanes and short writer settlement after Git observations.
A positive ordinary-read overlap and the existing real held-Git pending-refresh controls cover the two paths without changing deadlines.
New proof and independent re-check remain pending.

## 598. Filtered review patches omitted bounded files without marking truncation

An agent review selected paths from its bounded file list but did not mark the resulting patch truncated when that list omitted files.
Its diff now reports truncation whenever the filtered file list is truncated, while owner aggregate range behavior remains.
Its aggregate working-read cost is the same status-rescan defect as issue 588 and uses that one supplied canonical correction.
New bounded review and adopted literal-path/process-count/binary/size/symlink controls preserve credential filtering and reply limits.
New proof and independent re-check remain pending.

## 600. Common remote authentication refusals conservatively remain uncertain

Found: 2026-11-10, in the independent Opus check of the whole flow-fix unit.
State: open, accepted as a minor safe-side limitation.

A common SSH public-key refusal includes multiple diagnostic lines.
An HTTPS server can also prefix its authentication refusal with a server message.
The strict pre-effect grammar does not recognize these complete shapes, so they report terminal uncertainty rather than authentication_required.
The manager accepted the reviewed unit at Grade 8, with no blockers, majors or flags.
The classifier stays conservative in this change.
Any later widening must prove exact pre-effect refusal shapes without treating local partial effects as authentication failures.

## 594. Board subject retries could replace a committed reply after an uncertain outcome

Found: 2026-11-10, by the W08 conversation author and the root's recovery review.
State: The correction has local actual-handler proof and passed the second ordinary full's unit stage. The full failed three other browser cases. Browser acceptance remains outstanding.

The Board subject discarded its request identifier on every typed command error.
Editing the reply also replaced its request before the original outcome was known.
Navigation discarded the local attempt.
A database failure or a later admission error can follow a committed first transport attempt.
Those errors do not establish that the original reply was refused.

The existing authenticated owner-session conversation registry now retains the complete reply body, target, addressees, and request identifier.
An uncertain reply has an explicit recovery action that sends that same payload through navigation and draft edits.
A bounded authenticated event read can establish a durable refusal for the exact owner, command, and request.
An unavailable read or a later admission error leaves the original attempt frozen.
Success, a confirmed durable refusal, or owner-session disposal retires the attempt.
Explicit Read post, access checks, subject focus, and plain-text rendering remain in place.

Two controls failed against the original Board subject.
The actual CommandHandler, database, receipt, and board-event regressions now cover a lost committed reply, an edited draft, navigation, and a later admission error.
They verify one stored reply, the unchanged receipt, and no duplicate delivery.
The same proof covers a receipted planner refusal followed by a corrected new attempt, logout, expiry, and late completion.
The external harness and browser session transport in these local tests remain controlled fixtures.

## Conversation in-unit follow-on: cancellation outlived its conditional action

Found: 2026-11-10, in the second ordinary conversation full verification.
State: The original mounted Thread failed three settlement controls. The correction has focused local proof and awaits a newly authorized full verification.

The Stop reply action mounted only while an actual delivery was active.
Its settlement effect disappeared when terminal evidence removed that action.
The worker became idle, but the conversation still said that it was waiting for the turn to end.
The mounted Thread now owns settlement throughout its loaded history lifetime.
A stop acknowledgement alone still does not establish that a reply stopped.
Only actual terminal evidence for that agent after the original delivery settles the attempt.
Incomplete history retains the original attempt, and a late acknowledgement cannot restore a settled attempt.
The mounted regression covers stopped and normally ended turns, a later actual prompt and cancellation, navigation, unrelated terminal evidence, and active and idle offline controls without writes or draft loss.
The former standalone action settlement test moved into this mounted production Thread proof.
This is a correction inside the conversation unit, with no separate issue number under the manager's rule.

The same failed browser run found two fixture steps that expected Send while an actual turn still owned Stop reply.
The history fixture now completes the addressed member's actual Board read and reply before ending that turn.
It retains the original Board delivery, complete outgoing source, receipt, viewer, reopen, and reconnect assertions.
The foundation fixture ends its historical current reservation through the real runner event path.
It checks both active Stop reply and idle Send prompt during an actual transport outage, including the complete draft and absence of mutation frames or runner writes.
Neither fixture adds another Send control, submits through Enter to evade an active control, or extends a timeout.
These browser fixture changes have type proof but have not yet executed in a newly authorized browser run.

## Conversation in-unit follow-on: a committed team post did not invalidate the shell snapshot

Found: 2026-11-10, after the first bounded conversation-workspace browser journey.
State: The authorized one-tag correction is prepared. The consequential authenticated socket control awaits execution where a Unix socket can listen.

The browser journey committed an actual owner Board post, but its original five-second assertion did not find the new message.
The failed run did not measure the poll phase, read duration, visibility, or rendering schedule.
Those timing details remain unproved.
Reading the complete event path established a separate concrete gap.
The existing shell watcher received Board post events but advanced its cursor without refreshing its snapshot.
The team conversation therefore had no immediate event-driven invalidation through Shell's snapshot sequence.

The existing watcher now includes only `board.PostWritten` in its refresh tags.
It reuses the actual minimum-sequence snapshot read, provider, coherent recovery, Shell sequence prop, and owner `board.peek` read.
The existing poll, timeouts, authorization, owner lifetimes, and oversized-event predicate are unchanged.
Root explicitly authorized this accepted foundation file as an overlay within the conversation unit.
No separate issue number is allocated.

The new mounted App, provider, Shell, and team control uses the real authenticated socket, handler, SQLite writer, and committed event stream.
It holds only the team reader's fallback poll and records the actual event, minimum snapshot, owner peek, and rendered post.
It checks the saved older anchor, offset, and Latest action with explicitly simulated layout.
It also compares actual member read marks, acknowledgements, and durable events before and after owner viewing.
The first local attempt failed at socket listen with `EPERM`, before reaching a behavioral assertion.
That environment failure is preserved and is not an original behavioral red.
The original and candidate inputs are preserved for separate execution authority.
The original browser journey, later oracles, and timeouts remain unchanged.

## Conversation proof update after the accepted flow join

The manager's corrected actual-stream original run failed the new-post assertion, and its candidate run passed with the same test and only the watcher tag changed.
The actual after-sync watcher hashes are preserved in the selected original-run-3.log and candidate-run-2.log.
The earlier first two reported original runs are withdrawn histories and are not behavioral results.
The manager's third complete workspace journey passed once on content b25415e2, full identity 34978da4, parent 6c4657a.
It retained the original timeout and all full-input, receipt, authority, anchor, unread, lifecycle and owner-session disposal assertions.
The two intervening fixture corrections opened actual phone navigation before the unchanged exact logout action and named the same worker in its member-status read while checking the returned identity.
The complete failed runs, original source pins, reached screenshots and correction deltas remain sealed.
The W08 work is now composed onto accepted flow b974da06 without relabelling that old-pin pass as proof of this composition.
A new exact ordinary full and fresh independent whole-unit review remain outstanding.
The reviewer must explicitly check both browser fixture corrections and every prior authority and recovery edit.

## Conversation visible parity correction after the signed author handoff

Found: 2026-11-10, in the fresh independent review of signed f4605ad59246088b33b459a0dfb512c198456746.
The agent header showed connection state but omitted the actual role and activity.
The lead summary counted only the selected agent's requests.
Team Chat omitted its actual member count.
The panel toggle occupied an extra row, and the desktop panel added close and full-view controls.
The manager requires all four visible findings to be corrected within this conversation delivery.
No owner exception or new issue number is claimed.

Five new mounted application controls failed on the untouched original production source.
The raw result and exact inputs remain sealed separately from the signed source's passing full.
The correction reads actual roster roles and lifecycle state, existing project and team membership, and existing complete request rows.
A lead's own team requests and the owner's attention remain separate counts.
The existing owner-only attention filter is unchanged.
The team count follows current roster membership and the selected project and team.
Owner board peek remains non-consuming.

The header occupies one 32-pixel line.
The existing tab row holds the sole desktop panel toggle, and Chat opens the current conversation in full.
Only the compact drawer keeps Close, with its existing focus containment, Escape and opener restoration.
The new controls retain their exact original assertions for the candidate proof.
The browser journey adds loaded header, real member count, tab-row placement and panel controls across all eight size and theme combinations.
Its original timeout, complete request bodies and keys, permission authority, both latest fixture corrections, exact read-mark equality, unread and full lifecycle and session tails remain intact.
The original signed source and all passed and failed histories remain preserved.
The changed source needs its own manager browser and full evidence and independent review.


## 602. An accepted capacity hold left the conversation offering Stop reply

Found: 2026-11-10, by the fresh nonauthor W08 whole-unit review on signed 11dfcea.
The manager allocated this number and assigned the correction to the root lead.
An accepted delivery's capacity hold records DeliveryHeld without DeliveryRequeued or TurnEnded.
The engine becomes idle, but active-reply derivation and cancellation settlement omitted that same-delivery event.
The owner saw Stop reply or its stale recovery instead of the normal Send action.

The first original regression failed setup because its initial thread read omitted the required after cursor.
That run is preserved and is not behavioral red evidence.
The corrected original remote run failed both accepted-hold cases at the visible Stop assertion.
Its unaccepted-requeue control passed.
All three use the real handler, SQLite, committed history and a mounted production Thread.

Both browser folds now retire only a matching agent and delivery when DeliveryHeld arrives.
The existing cancellation identity guard prevents a late acknowledgement from restoring the retired attempt.
The draft remains, the normal Send action returns, and a capacity hold does not claim Reply stopped.
No engine capacity policy, authority, transport, timeout or session lifetime changes.
Status: root correction prepared; candidate remote proof and fresh independent review remain pending.

## 603. A refused start hid the model and effort remedy

Found: 2026-11-10, in the fresh independent review of signed 89c5acd.
The manager allocated this number to the original conversation author.
Composer hides its complete form while the agent is halted.
That form contains the sole AgentTools instance, so the owner cannot change a refused model or effort or recover an uncertain configuration command.
Resume alone can repeat the refused selection.

The new original controls mount the production Thread with the actual command handlers and SQLite log.
The adapter and browser transport are controlled explicitly.
They retain a draft from the real starting state, require reachable advertised choices and configuration recovery after refusal, and resume through the real lifecycle handler.
They also require the same configuration body and request key after a lost committed reply, one durable choice, applied evidence and no prompt while halted.
The original remote run on 4fd8cd2 failed both refusal controls at the hidden tools assertion.
Composer now hides the message input, context additions and send action while keeping its single existing configuration tools mounted and reachable.
The message and recovery send guards still refuse a halted submission.
Status: correction prepared; affected remote proof is next.

## 604. Activity titles and paths bypassed the bounded reader

Found: 2026-11-10, in the fresh independent review of signed 89c5acd.
The manager allocated this number to the original conversation author.
The collapsed tool summary, expanded tool title and file-change path render complete provider strings on the ordinary conversation surface.
The input, output and diff already use the bounded reader, but their labels do not.

The new original controls store contract-valid long labels through the actual SQLite log and mount the production Thread.
They require bounded collapsed and expanded output, exact full reading and copying, unchanged stored evidence, inert markup and no interactive reader inside a summary.
Short labels, actual tool status and complete input, output and diff readers remain consequential controls.
The original remote run on 4fd8cd2 failed with a 40,055-character collapsed summary and a 40,906-character ordinary path.
Its short-label control passed.
Titles and paths now use the existing full reader, and the collapsed summary uses the same bounded preview without interactive descendants.
The original stored strings, status, input, output and diff are unchanged.
Status: correction prepared; affected remote proof is next.

## 605. Durable conversation refusals kept recovery locked forever

Found: 2026-11-10, by the independent review of signed 9a9d2f1.
The manager allocated this number to the original conversation author.
Issues 603 and 604 are closed by that review, and their changes remain.
Composer and AgentTools retain every failed request as uncertain.
A planner refusal has a durable receipt, so replaying that same request cannot succeed even after the cause is repaired.
The original controls use the real handler and SQLite for a disappearing selected file and changed advertised model and effort choices.
They require the old key to keep its refusal after repair and a corrected explicit request to use a new key.
Only positive durable refusal evidence for the exact owner, command and request may retire an attempt.
Missing, unavailable, incomplete or unrelated evidence must preserve the complete original request.
The original remote run on d453837 exited 1 with all four behavioral controls failing.
Each reached its real durable receipt and proved that repair did not change replay before failing at the locked control.
The correction captures a bounded pre-command sequence in the existing conversation attempt.
A shared read checks at most 64 subsequent events within two seconds and requires the exact owner, command, request and returned sequence.
Only that positive refusal retires the attempt, preserving the current draft and references.
Missing or unavailable evidence retains the frozen body and key through navigation and later admission failures.
Late evidence cannot restore a disposed owner session.
The candidate remote run on 4e4ddbc passed 92 cases in nine affected files, including all four original controls.
Real lost-committed-reply controls also preserve each prompt, team post and configuration through a later actual invalid-credential refusal and exact receipt recovery, with one effect.
Mounted evidence controls retain immutable requests for missing anchors, unrelated callers, commands and keys, stale sequences, incomplete or unavailable reads and evidence beyond the 64-event bound.
Navigation retains later edits, while logout and expiry discard protected state and ignore late evidence.
Web typing and copied-code credits passed on the same candidate.
The combined remote command exited 129 only at the final Git whitespace check because the remote source copy excludes its Git metadata.
The local read-only Git whitespace check passed.
Status: corrected; the author result records the final full-check outcome and lead handoff.

The first correction full on 8c9eeb4 passed 516 files and 7,715 tests, with two skips, but its browser suite exited 1 with 26 passes.
The conversation journey had not observed the intended lost prompt reply at its five-second assertion.
Its captured page retained the next draft alongside the preceding successful send acknowledgement.
The fixture had waited for runner delivery, which does not establish browser acknowledgement or coherent write admission.
It now requires the preceding empty acknowledged draft and the real enabled Stop reply control before starting the next send fault.
The original fault, four identical prompt frames, complete body and key, owner authority, eight-view matrix and lifecycle/session consequences remain unchanged.
The exact blocked guard at the original keypress was not measured, and no production timing defect is claimed.


## 608. The eight-project browser journey has too little time

Found: 2026-11-10, while finishing the independently reviewed W08 correction.
State: corrected under the manager disposition; the related browser file must pass before merge.

The New project journey creates eight real projects, Git worktrees and leads, and opens every exact thread.
Its default 30-second budget repeatedly expired after six or seven creations on unrelated commits.
Earlier successful durations ranged from 17.4 to 26.9 seconds.
The manager identified this as a tight test budget rather than a W08 regression.
Only this test now uses a 120-second budget.
Every creation, persistence, single-lead, branch and exact-thread assertion remains unchanged.
The previous failed full and isolated failure remain recorded as failures.
The manager requires the failed and related new-project browser file, without another full check or review round.

## 573. Repository registration discarded uncertain typed failures

Found: 2026-11-09, during W07B's source review of W10B's independent registration controller.
The manager allocated this number and approved the bounded author correction.

The controller treated every typed `CommandError` as a conclusive admission refusal.
The public application programming interface also uses that error for database failures.
The original authenticated controls reproduced add and locate requests losing their frozen identity at controlled boundaries before append and after actual commit.
The original web logout control also showed that the typed-error path skipped the session probe and retained the private draft.
The original source archive, unchanged-source manifest, observations, and normal exit 1 remain under `.proof/w10b/recovery-red-1*`.
Two additional failed assertions in that run expected `Git: not_repository` for a folder outside the configured root.
The actual fixed admission reason was `Git: invalid_path`.
The corrected controls preserve the same no-registration and editable-retry assertions with that actual reason.

The author correction keeps database, generic, and unknown failures uncertain.
Only exact proved pre-registration admission reasons release the frozen request.
Every failed operation now probes the session, including a typed refusal.
An actual unauthorized session response disposes the private state and invokes expiry.
The constructor and public controller and content exports remain unchanged.
Corrected add and locate controls require the same request through Cancel and retry, one actual registration effect, editable recovery after conclusive refusal, and disposal after actual web logout.
The first bounded remote proof passed recursive and root typing and stopped at two pre-append recovery fixture assertions.
Those assertions expected the deliberately latched writer to recover in the same service.
The corrected fixtures retain the same controller, complete body, and request while the writer remains latched, then close the actual services and run normal restart recovery before retrying.
They assert a new authenticated client and the unchanged controller and payload.
The ten actual-engine controls and nine controlled presentation regressions then passed locally with one worker.
The restart helper names its empty host process reader and signal control; it does not kill actual host processes.
No production writer, receipt, database row, or view was repaired or weakened.
Status: bounded correction proof passed; independent review remains pending.

## Recorded mock companions lost their private folder scope in the unfinished display unit

Found: 2026-11-10, during the bounded actual opaque-frame prerequisite.
This correction belongs to the unfinished W10B display unit.
No separate issue number has been allocated.

The document carried its private session identity in its query.
Its root-relative stylesheet and image had neither that identity nor a usable referrer.
They reached the unchanged no-editor fallback and returned empty 503 responses.
The module request failed without an observed response status.
Its exact failure mechanism remains unproved.
The original failed native run and the later passive diagnostic remain preserved.

The bounded author correction scopes direct stylesheet, script and image addresses
in the delivered HTML to the same issued private session.
Root-relative and ordinary relative addresses resolve against the actual selected route.
The recorded source and companion files remain unchanged.
The engine still verifies the recorded fingerprint before making that delivery representation.
The parser adds no owner API authority, cookie, origin or folder access.
The opaque sandbox and Content Security Policy remain unchanged.

Nested root-relative addresses in stylesheets or modules remain unsupported.
This correction is not general rendering acceptance.
Actual module execution, orange pixels, decoded images, editor import and isolation
still need the separately authorized browser proof.
Status: engine typing and all 27 focused controls passed; native retry is held.

## 574. Incomplete mock history cleared an uncertain approval

Found: 2026-11-09, during W10B's author review of approval recovery.
The manager allocated this number and approved the smallest helper correction.

An incomplete paged history read returned the same stale outcome as a conclusively superseded revision.
The Mocks page therefore discarded its session-owned uncertain approval request.
The original controlled document object model regression showed the recovery action disappearing after an incomplete read.
Its unchanged source, original log, and normal exit 1 remain under `.proof/w10b/recovery-red-1*`.

The helper now keeps incomplete history uncertain.
The exact request and revision stay available through navigation and later retry.
The regression requires incomplete history to issue no replacement approval command and preserves the original request for successful recovery.
The correction adds no history contract, parser, owner authority, or synthetic approval.
The exact corrected source remained frozen throughout bounded remote proof 1.
That run passed recursive and root typing, then stopped at two unrelated pre-append registration recovery controls.
The document object model command was consequently unexecuted.
This entry was appended after the remote run exited, as an explicitly recorded document-only delta.
The later local controlled presentation run passed all nine regressions, including incomplete history, navigation, and recovery with the original request.
Status: bounded correction proof passed; independent review remains pending.

## 601. The editor image config reference was unavailable in the containerd store

Found: 2026-11-10, during manager preparation for the W10B native display proof.
The manager allocated this number.
The approved image was present under its transferred name and tag on the remote personal computer.
The engine's config-digest reference returned `No such image`.
The original remote typing failure, later passing typing and Docker inspection records remain preserved separately.

The owner ruled that every host finds the editor by `lgtm-openpencil:w10b-cb71737-build1`.
The engine now inspects that local tag on every launch and requires Linux on AMD64.
No digest lookup or equality decides image presence.
A missing image is refused without building, pulling, retagging or choosing a fallback.
The existing `--pull=never`, non-root user, isolated network, folder mounts, resource limits, socket deadline and owned-name cleanup remain.
The native fixture uses the same tag and checks the actual generated container name.
Its original display, import, pixel, isolation and cleanup assertions remain.
Temporary static launcher diagnostics are retained separately and must not be committed.
Status: product and fixture corrected; independent remote typing and focused checks passed.
The native follow-up below records the later startup failures and their disposition.
The issue remains open pending unit review and integration.


### The later editor boot failure is separate from image presence

The source23 and direct remote native cases started the named editor image and opened its frame.
The registered document assertion failed before the capability assertion ran.
The approved temporary boot-notice read then measured a localStorage SecurityError in the opaque sandbox.
The original failures, cleanup outcomes and temporary observation remain preserved in website-1/w10b-document-import.
On 2026-11-10, the owner approved adding allow-same-origin to the editor iframe and its content security policy sandbox directive.
Recorded mocks keep their opaque sandbox.
The editor keeps its separate display hostname, credential-omitting document import, owner-cookie exclusion, frame ancestors, referrer policy, revocation and logout controls.
The temporary boot-notice read was removed before this correction's commit.
No OpenPencil source patch or image rebuild is applied.
At product commit e740c19, remote engine, web and native-input typing passed.
All 34 tests across the display boundaries, project review and actual engine review files passed.
The related native case first exposed an unhandled Playwright response-body read, then Docker's CAP_NET_BIND_SERVICE spelling.
The case now proves file bytes with a credential-omitting browser read of the exact issued URL, while retaining the original import status, component and canvas checks.
The capability assertion normalizes only the optional CAP_ prefix and still requires exactly the one approved capability.
The final native run passed in 10.6 seconds, including actual modules, WebAssembly, registered file import, screenshots, owner isolation, logout and cleanup.
Its outcome records completed=true and owned containers absent; a separate Docker listing was empty.
The screenshots still show OpenPencil's font-unavailable-or-substituted warning.
This proves the selected document renders, but does not establish exact font fidelity or whole-unit acceptance.
All original failed logs remain in website-1/w10b-document-import, alongside the passing logs and screenshots.

### The first ordinary full check found two missed repository guards

The full remote check of 720077d returned 1 after typechecking passed.
Vitest reported 7,650 passing tests, two skipped tests and two failing guards; browser and credit stages did not run.
The display input callback constructed an owner credential outside webCaller.
It now obtains and revalidates its caller through webCaller before each engine input read.
The pure display-boundary and markup tests also omitted their required rebuild declarations.
Both now register noLog=true because neither opens an event log.
The original full log and direct exit remain preserved in website-1/w10b-document-import.

## 606. Previously inspected worktree summaries hide fresh row counts

The independent W09 review found that cached working changes overrode later count reads for an uninspected worktree.
After visiting two worktrees, changes in the first could remain displayed as a clean checkout while inspecting the second.
A newer partial or unavailable result was also hidden by that older working view.
The correction keeps working data authoritative only for the currently inspected row and uses the existing count generation for other rows.
The focused control retains genuine Git reads beneath narrow partial, unavailable and held-reply boundaries, and checks that aborted generations cannot replace newer counts.
The original focused control failed against unchanged production with a genuine new file still displayed as zero changes.
Candidate focused and full proof are recorded under the existing build loop.

## 607. Split Git comparisons omit side headings

The independent W09 review found that real split comparisons omitted the mock's Before and After headings and accessible side identity.
The correction adds paired headings and labeled line groups in the shared comparison renderer.
Unified fallback, paired row alignment, literal patch rendering and the single phone gutter remain required.
Focused renderer controls cover both workspace and dialog consumers, and the existing eight-combination browser journey retains its original consequences and deadlines.
Both original renderer controls failed against unchanged production because the two headings were absent.
Candidate focused and full proof are recorded under the existing build loop.

## Unallocated full-check failures during the W09 minor corrections

The ordinary remote full check on commit `1b24026` passed typing and 7,678 unit tests, with two existing skips, but failed two browser cases.
The Git lost-reply case retained the initial unconfirmed acknowledgment instead of publishing terminal uncertainty within its original five-second assertion.
A later single-case execution with a temporary fixture observer passed, which does not explain the full-run failure.
The new-project eight-size creation case reached its original 30-second case timeout while creating the eighth project.
Neither failure has an established cause, and no deadline was increased.
The complete full output and both original failure contexts remain in `.scratch/w09-evidence/minor-corrections/` in the W09 author worktree.
The full-check requirement remains unmet, and issue numbers remain manager-owned.

The later full on `8c50353` passed typing and all unit tests but failed three Git browser publication assertions and the same project-creation case.
A bounded registered-handler and wire observation reproduced the lost-reply failure without changing its original oracle.
Its five-second assertion began before the typed commit failure arrived, and the final coherent identity read was still pending when the assertion failed.
An auxiliary checkout count read also entered the shared runtime Git gate before the inspected state read.
The UI now defers those auxiliary summaries until the inspected coherent working refresh publishes, while keeping current count generations and their cancellation guards.
A consequential mounted control failed against the original production ordering because an auxiliary read started while the inspected refresh was held.
The original browser assertions and deadlines remain unchanged, and this observation does not establish a load, network or universal latency cause.
The manager owns the separate new-project disposition; that case is not repeated to chase a pass.


## 609. The Git lost-reply assertion is timing-sensitive in a full browser run

Found: 2026-11-10, while finishing the independently reviewed W09 correction.
State: fixed by the web-flaky investigation.

The full check on signed d71de21 passed typing, 507 unit files and 36 browser cases.
The lost-reply assertion at git.spec.ts:269 still saw the initial unconfirmed acknowledgement within its unchanged five-second budget.
The unchanged isolated case then passed in 11.1 seconds, including 9.8 seconds in the case.
The manager accepted the combined gate under the build-loop rules and authorized the merge.
The full remains exit 1, and the isolated rerun remains exit 0.
This does not establish a cause or close the timing issue.
If it recurs in the merged full, the manager requires an earlier acknowledgement or a wait on the correct event rather than a longer deadline.

It recurred in the final merged full on 4f9ae0a, at git.spec.ts:271.
The alert still showed the initial unconfirmed acknowledgement after five seconds.
The unchanged case passed on its own in 10.0 seconds.
The fix stays as stated above: wait on the correct event, not a longer deadline.
It is the next unit on area/website after the master merge.
The original logs and failure contexts remain in the W09 author result.

The web-flaky investigation reproduced the lost-reply failure once in two full browser repetitions with two workers.
The engine log contained one completed commit.
The page still showed the initial unconfirmed acknowledgment while its coherent Git refresh was pending.
The test now observes that acknowledgment and the completed refresh before checking terminal uncertainty.
The same run reproduced the fetch assertion with the old incoming count once in two repetitions.
The synchronization test now observes the fetch, pull, and commit acknowledgment before checking each subsequent count.
Every assertion retains its original five-second deadline.

A related timing failure appeared in the full run of the rename branch on 2026-11-12, at git.spec.ts:316.
After Pull, the sync line still said "1 incoming" after five seconds.
The unchanged case passed on its own in 24.5 seconds.

The corrected lost-reply and synchronization cases each passed 20 remote repetitions with two browser workers.
The repeat run used zero retries and retained the original assertion deadlines.

The final remote check passed all TypeScript checks, all 532 unit test files, all 48 browser cases, and the credit check.
The unit suite retained its two pre-existing skips.
The fixes are in signed commits `eeab43a` and `3e5f892`.


## 610. The merged shell constrained the Git workspace width

Found: 2026-11-10, in the manager's full check of merged 2b482a2.
The general shell section rule had higher specificity than the Git workspace override.
It applied a 1,200-pixel maximum width and automatic margins to the Git layout.
The existing Git layout browser assertion failed on the computed maximum width.
The general rule now excludes both the conversation and the Git workspace.
No Git layout assertion, deadline or other style rule changes.
The failed merged full remains recorded as exit 1, with all 525 unit files and 37 other browser cases passing.
The lead runs the complete Git browser file after this correction.
The manager owns the subsequent merged full and service check.
The requested complete Git browser file passed remotely, with all 11 cases passing in 3.3 minutes and wrapper exit 0.
The existing layout assertion passed without an assertion or deadline change.


## W11 integration corrections without a new issue allocation

Found: 2026-11-10, while checking the accepted website against the original browser reference.

The accepted Shell did not mount the delivered first-run Setup, Mocks, or repository Design pages.
The integration now uses the original author exports and the authenticated owner's existing controller lifetimes.
Setup requires positive durable completion, and project stages omit Design when the complete mock history has no screens.
Historical browser fixtures explicitly complete setup without bypassing the genuine first-run journey.

A complete mock revision history with no approval did not prove that a generic typed CommandError was a durable refusal.
A real writer-boundary control reproduced retirement of the original approval identity before append.
Approval now keeps its exact body and key across ambiguous failures and navigation.
It retires that attempt only after success, conclusively stale revision evidence, or a durable owner CommandRefused event for that exact approval.
The real before-append and after-commit controls recover one approval after runtime restart.

Repository Design's evidence table and editor did not provide live component View previews.
The existing isolated display path now selects a registered repository revision and component identity.
It reuses the current owner issuance, opaque sandbox, session revocation, fingerprint, path and private-data checks.
Component previews are inert while the owner can still open and close them.
Unsupported source formats explicitly remain unavailable.
The original mock and editor retain their existing interaction policies.

The historical live reply assertion expected a literal Agent data prefix that the current plain-text export no longer renders.
The correction preserves the complete exact sentence and exactly one new reply block.
The W11 builder result records the actual live failures, ordinary full overlap, later corrections and their validation separately.

The actual-provider first-run journey also established a created lead with
`model-refused` and an exact durable `project.setup.complete` prerequisite
refusal. The inline Open lead conversation button previously retried Setup
completion, so the owner could not reach the existing model/effort remedy.
It now opens that same lead's existing Thread as a Setup detour. Return to
first project retains the original project and creation. Setup remains pending
until configure/resume succeeds. Only an exact durable completion refusal
permits a new completion key; ambiguous failures retain the original key.

The continuing independent review reproduced a reload defect after that first
project committed with a failed lead. Reload lost the in-memory created project,
showed another editable creation form, and allowed a second project. Setup now
reads the complete existing project collection under a stable engine sequence.
One existing project exposes its same lead and completion controls. Multiple
projects require an explicit choice; no latest-project assumption is made.
Incomplete or failed reads cannot enable replacement creation. No private draft
is persisted, and no new API, event or synthetic completion is introduced.
The regression reloads both model and effort failures before real configure,
resume and completion, and separately preserves ambiguous multiple-project state.

### W11 actual-provider selector boundary (unallocated)

The real Codex adapter selector does not advertise the exact requested gpt-6.1-sol. The minimal owned-service probe confirmed that the request's configId belongs to that same selector and that the correctly shaped setting receives InvalidParams. It printed fixed booleans, without options, raw errors or credentials. This is an external provider/adapter configuration limit, not an established local runner bug. The requested model and provider remain unchanged. Actual-provider completion, private-login halt and restart receipt/rebuild proof remain incomplete. W11 merge is blocked pending manager disposition. The named W11 builder result retains the failed attempts and ordinary diagnostic log.

The manager subsequently traced this historical blocker to the pinned
codex-acp2.5.0 bundling Codex0.165.0. The appended manager disposition authorizes
exactly codex-acp2.6.0 and its lockfile, which resolves Codex0.166.0, while keeping
gpt-6.1-sol/high. Current adapter MCP/terminal internals and Codex0.166.0 approval
and environment handling were rechecked. The existing issue236 configuration
still applies; no shim, provider/model substitution or weaker choice check was
added. Related tests and actual live outcomes remain in the W11 builder result.

The authorized upgraded actual-provider web journey subsequently exited0 at the
unchanged gpt-6.1-sol/high. It completed real tool/board handoff, exact answer
replay, exact reply/file bytes, stop/resume, private-login failure and halted
composer consequences, and service-restart receipt/rebuild checks. The original
failed probes and same-copy overlap remain historical evidence. The final signed
ordinary full and continuing independent review are separate requirements.

The signed W11 full on 79cd51d passed all 525 unit files and 42 browser cases,
but the serial eight-size Mocks/Design journey reached its overall 30-second
limit at the enabled second approval button, after the matrix and stale refusal.
Its approved overall budget is now 60 seconds for page/worktree setup, sixteen
captures, stale refusal, actual approval and reload. Individual deadlines and
all behavioral assertions remain unchanged. The failed/related pair passed
in 20.7 seconds. The other full failure recurred at issue 609's original Git
terminal-uncertainty assertion. The unchanged isolated case passed with bounded
temporary handler timing observations; those observations do not explain the
full failure. Issue 609 remains open and its cause unproved. The Git source,
assertion and deadlines are unchanged, and temporary observations were removed.

## 611. The mock preview issuance observation failed in the W11 full

Open: on signed 5e12347, new-project.spec.ts:605 observed status 0 instead of 200 within five seconds in full4. The unchanged uninstrumented case and credits then passed. The cause remains unproved. The manager accepted that combined gate without changing the assertion or deadline.

The same registered component journey failed again in the final merged full on 4f9ae0a, at a different assertion.
At new-project.spec.ts:626, the preview frame's body never received data-loaded="yes" within five seconds.
The unchanged case passed on its own in 24.6 seconds.
Both failures are in the mock and component preview path under a full parallel browser run.
The cause remains unproved.

It recurred at new-project.spec.ts:605 in the full run of the rename branch on 2026-11-12, with status 0 instead of 200.
The unchanged case passed on its own in 27.3 seconds.

It recurred at the preview frame's data-loaded check in the full run of the earlier-names cleanup on 2026-11-12.
The unchanged case passed on its own in 24.5 seconds.

## 612. The built web page prints raw engine data and has weak component design

Open: found on 2026-11-10 while comparing the page in `packages/web` with the mock.
The page's colours and type match the mock's tokens. The faults are in the components.
An agent thread prints raw engine envelopes and identifiers, with no avatar, name or time.
The phone notification offer stays on every page and takes about 105 pixels.
The Terminal tab is a two-line placeholder.
No screen has a clear primary button.
The Git tab shows broken glyphs and a folder named ".".
Machines and Subscriptions mostly say "not available yet".
The rebuilt mock in `design/mock/` is the proposed reference for fixing these.

## 613. Agents carry invented personal names in the engine and the older mock

Open: the owner rejected invented agent names on 2026-11-10. An agent is named by its role.
The engine still gives each project lead a name from a fixed list at
`packages/engine/src/project/lifecycle.ts:21`. The list starts with Sage and Rowan.
The test `packages/engine/test/api/subscribe-visibility.test.ts` uses those names.
The files under `design/data/` also use such names. The older `design/workbench.html` used
them too, until it was removed on 2026-11-12.
The rebuilt mock in `design/mock/` names every agent by its role.
The engine change is not made yet, because the lead's name is passed to the agent start
at `lifecycle.ts:251` and is written into stored events.

## 614. The design file lags the rebuilt mock's tokens and names

Open: found on 2026-11-10 while building the repository Design page in `design/mock/`.
The design file is `design/lgtm.fig`.
Its `Agent row` variants show the name "Rowan", which breaks the rule that agents are named
by role.
It has 15 colour variables, while `design/mock/css/tokens.css` has 38 colours.
Thirteen of the shared colours were retuned in code, and only `surface` and
`primary-contrast` still agree.
It has no type, space, density, shape or motion variables.
The Design page marks every such value "Only in code" or "Retuned in code" until the file
catches up.
The full list of changes is in `design/mock/feedback/2026-11-10-design-categories.md`,
under "What LGTM Studio's file must change to meet the standard".
The Design lead agent proposes those changes, and the owner approves them.

## 615. The mock's Git tab replaces its structure with a blank page when there is no worktree

Open: found on 2026-11-10 during the second round of the mock.
The Git tab draws one centred "No worktrees yet" message at
`design/mock/js/screens/git.js:713` when a project has no worktree.
The rule since round 2 is that a screen with no data keeps its structure.
The Git tab should keep its Changes and History columns, with an empty row in each.
The round 2 brief did not list the Git tab's empty state, so it was left as it is.

## 616. The repository Design page draws every screen frame as a live copy of the mock

Open: found on 2026-11-10 while building the Design page in `design/mock/`.
Each screen frame on the Screens sheets is a frame that loads the whole mock at that
screen's address.
A flow with eight frames starts eight copies of the mock, each with its own data.
The page takes about a second longer to settle on the larger flows, and it uses more memory
than a picture would.
A real build should draw the frames from the design file, or from stored pictures, and load
a live copy only for the frame the owner opens.

## 617. The first marketing page pass overflowed on small phones and stretched its phone image

Found: 2026-11-11, during the LGTM Studio marketing page browser checks.
State: fixed in the marketing page before handoff.

At a viewport width of 320 pixels, the workflow grid kept its children's intrinsic minimum width.
The grid extended 20 pixels past the viewport's right edge.
The mobile screenshot also kept its HTML height after CSS reduced its width.
It appeared stretched in the phone frame.
The workflow grid's children now permit shrinking.
Images now preserve their natural aspect ratio.
The browser check retains the 320-pixel overflow assertion.

## 618. Marketing dark mode needed separate input and surface colors

Found: 2026-11-11, while adding the marketing page's dark theme.
State: fixed before handoff.

The first dark-mode pass reused the light text token inside the pale email field.
The entered address failed the browser's minimum text contrast check.
The input and the keyboard skip link now use a dedicated dark text color.
The input placeholder retains its readable color in both modes.
Screenshot frame shadows also keep a dark surface color instead of following the text color.
The browser check retains the email-field and skip-link contrast assertions.

## 619. The remote test computer kept folder and slice names from before the rename

Found: 2026-11-12, during the rename to LGTM Studio.
State: fixed on 2026-11-12, after the owner chose to start fresh.

The first rename pass kept the remote copies' folder, the shared systemd slice and the SSH connection socket under their earlier names.
It did so because older branches still ran remote tests, and two slices could exceed the owner's memory limit.
The owner then chose to reset the workspace, so no older branch runs there.
The copies now live in `~/Work/lgtm-studio`, every remote command shares `lgtm-remote.slice`, and the socket is named `lgtm-remote-%C`.

## 620. Settings the web page stored in the browser are lost by the rename

Found: 2026-11-12, during the rename to LGTM Studio.
State: accepted.

The web page and the mock store the theme, panel sizes and dismissed notices under keys named after the product.
The rename changed those keys to start with `lgtm-`.
A browser that used the page before the rename shows the defaults once, and then remembers new choices.

## 621. The Reverse Fig profile for the mock points at the removed workbench

Found: 2026-11-12, while removing the older workbench from `design/`.
State: fixed on 2026-11-12.

The profile `skills/reverse-fig/profiles/lgtm-mock.mjs` builds `design/lgtm.fig` from the web mock.
It opens `http://127.0.0.1:4178/workbench.html`, and its component snippets use the workbench's class names.
The workbench was removed on 2026-11-12, so the profile cannot run until it is pointed at `design/mock/`.
The rebuilt mock uses different class names, so the snippets need rewriting as well as the address.
The fix points the profile at `http://127.0.0.1:4178/mock/#/home` and copies the rebuilt mock's markup.
The components are now Button, Status dot, Agent row, Connection status, Segmented control, Inline link, Count and Badge.
The agent rows show role names, such as Builder 2, in place of the invented name Rowan.
`design/lgtm.fig` was made again from the rebuilt mock, and 15 of its 32 variants match the browser within 3 percent.

## 622. The Machines page counts capacity-held agents as agent slots

Found: 2026-11-13, while writing the checked gap table for connecting the mock.
State: open.

The current website's Machines page shows a number of held agent slots (`packages/web/src/admin/machines.tsx:20-21`).
It counts the agents whose `capacityHeld` flag is true.
That flag means a delivery was held because the model provider was at capacity (`packages/engine/src/routing/deliveries.ts:246`).
It does not mean a machine slot is in use, so the number is wrong.
The engine has no agent-slot record for a machine.
The gap table is `.plans/plans/connect-mock/gap-table.md`.

## 623. The live website shows the page's default settings, not the engine's

Found: 2026-11-13, while connecting the mock to the engine (step 1 of the connect-mock plan).
State: fixed for Service settings and Phone notifications in step 2.

These pages now read their settings from the engine when opened.
The Home notification offer reads the same carrier and dismissal settings.
Unsupported settings are empty.
Unset role overrides stay empty because the engine does not return effective role defaults.
Appearance keeps browser preferences, as intended.
Supplied actions call the authenticated client API.

## 624. The live website's Machines page has no figures for the engine's machine

Found: 2026-11-13, while connecting the mock to the engine.
State: open.

The engine sends no processor, memory, agent slot, address, operating system or harness version for any machine.
The live website therefore shows a dash for processor and memory, and "Scanning…" for the harnesses.
Its agent count reads "0 of 0", in the warning colour, because the slot limit is unknown and is stored as 0.
The engine calls its own computer `local` until machine pairing exists, so the page names the machine `local`.

## 625. The browser logs an error when a signed-out page checks its session

Found: 2026-11-13, while connecting the mock to the engine.
State: accepted.

The live website asks `POST /api/session` whether it is signed in, and the engine answers 401 when it is not.
A wrong password at `POST /api/login` is also answered with 401.
Browsers log each 401 answer to the console as "Failed to load resource", although the page handles it.
The browser tests therefore ignore console errors that name status 401.

## 626. `lgtm serve --detach` does not say why the service failed to start

Found: 2026-11-13, while starting the engine with a test state folder for the live website.
State: open.

With a long `LGTM_HOME`, the engine's socket path exceeds 100 bytes, and the service exits at once.
The service prints "socket path exceeds 100 bytes", but `serve --detach` discards the child's output.
The launcher reports only "lgtm: service failed to start".
Running `node packages/engine/src/service.ts` directly shows the reason.

## 627. The live board inferred sprint status from its phase.

The first connection put a sprint into a column from its phase and completion time.
The engine derives status from its completion text and task states.
This change maps those four engine states and leaves Backlog empty.
It also removes the mock's default priority, roadmap dates, and eight-phase progress from live board rendering.

## 628. Project settings rendered values the engine does not store.

The first connection supplied enabled test and review switches and a derived task prefix.
The settings page also proposed a work assignment from the mock's model lists.
This change leaves these live fields empty and keeps their actions on the explicit refusal.
The lead's model and effort choices now come from the configuration read.

## 629. A failed Git read hid independent task history.

The new task detail read initially treated history and changed files as one successful operation.
A refused Git read therefore hid history that the engine had returned.
This change applies each successful read and shows the reason for each failed read.
The browser fixture now registers a real temporary Git repository and its workspace settings.

## 630. The sidebar did not refresh the owner's saved name.

The connection originally read the owner's name only when it connected.
Saving a display name during first run left the sidebar showing its old value.
The connection now reads the settings again when their change arrives on the stream.

## 631. The mock hides message post actions in a narrow panel.

The existing message styles hide the post action buttons when the panel is narrower than 720 pixels.
This also happens on a desktop when the sidebar and channel list reduce the panel width.
The browser test uses a wide viewport to exercise those existing controls.
Changing this layout remains outside this connection change.

## 632. Generic dialogs closed before a live request finished.

The mock's rename and confirmation dialogs close before their callbacks run.
A live rename or archive therefore had no pending control and lost its draft on refusal.
These dialogs now support waiting for a reply when the caller requests it.
The connected project actions use this option.
The standalone mock retains its immediate callbacks.

## 633. Repository placeholders asserted that unknown data was absent.

The repository page rendered a missing remote address as "None".
Project settings rendered the same missing address as "No remote".
The engine does not hold a remote address, so these statements were not supported by its records.
The live fields now remain empty.
The live repository description also omits the mock's promise that a lead will write it.

## 634. The full browser check failed in three unchanged website cases.

State: fixed by the web-flaky investigation.

The full check at `04eb7aa` passed all TypeScript checks and all 528 test files.
Its browser run passed the three Studio cases and failed three existing website cases.
The Git staging case could not find the expected disabled "Commit 2 files" button after staging.
The Git synchronization case retained "1 incoming" after Pull.
The registered component preview case did not observe the expected document response.
The affected website source, engine source, contracts, client source, and test bodies have no changes from `8f9f321` in this branch.
The result file records the baseline checks for these failures.

The web-flaky investigation reproduced the bulk-stage and component failures in a two-worker full browser run.
The Git event log recorded a successful stage before the failed count assertion.
The page was still refreshing its coherent state when that assertion expired.
The test now waits for the stage acknowledgment and the completed refresh before checking the count.
The component document returned 200 before the style assertion expired with its stylesheet still pending.
The test now observes the exact issued document response before checking its separately authorized assets.
It also finishes each reopened component document and its assets before changing its source or closing it.
Those waits correct test ordering faults.
The same investigation found repeated engine workspace validation on every component request.
Issue web-flaky-1 records that product performance fault and its correction.
The same correction separates the synchronization command acknowledgments from their subsequent counts.

The corrected bulk-stage and component-preview cases each passed 20 remote repetitions with two browser workers.
The same run also passed 20 synchronization cases and 20 heavy Git layout cases.
The complete repeat run passed all 120 cases in 18.9 minutes without retries.

The final remote check passed all TypeScript checks, all 532 unit test files, all 48 browser cases, and the credit check.
The unit suite retained its two pre-existing skips.
The fixes are in signed commits `eeab43a` and `3e5f892`.


## 635. A failed logout claimed that the engine had ended the session.

Found: 2026-11-13, in the review of the first live website connection.
State: fixed.

The connection treated every logout response as a confirmed session revocation.
It now removes the records immediately and shows a persistent warning unless the engine confirms the logout.
An older session probe could also restore the records after logout.
Session attempts now invalidate older replies.

## 636. Truncated snapshots left references to missing records.

Found: 2026-11-13, in the review of the first live website connection.
State: fixed.

The mapping retained requests whose agents were absent from the mapped roster.
Other bounded lists could leave missing repositories, projects, teams, sprints, tasks, or request holders.
The mapping now recovers agent membership from unambiguous retained evidence.
It omits children with missing required parents and clears optional links to omitted records.
It does not turn a missing request holder into an owner-held request.

## 637. Account and configuration events left the website stale.

Found: 2026-11-13, in the review of the first live website connection.
State: fixed.

Four account and configuration event types advanced the subscription cursor without refreshing mapped records.
Those events now request a fresh snapshot before advancing the cursor.
Oversized event markers use the same refresh rule.

## 638. Lifecycle updates kept the previous activity text.

Found: 2026-11-13, in the review of the first live website connection.
State: fixed.

An agent could resume working while its activity still said that it was signed out.
The connection now recomputes the display state with the contracts helper.

## 639. Failed retries postponed the offline deadline.

Found: 2026-11-13, in the review of the first live website connection.
State: fixed.

Every failed attempt restarted the offline timer and claimed a new contact time.
Retries now share one outage deadline.
Only a successful connection or a received stream item updates the last contact time.

## 640. Refused settings changes still displayed Saved.

Found: 2026-11-13, in the review of the first live website connection.
State: fixed.

The Saved indicator bypassed the store's refusal guard.
Its write now passes through the guarded update function.

## 641. Unconnected controls simulated successful service actions.

Found: 2026-11-13, in the review of the first live website connection.
State: fixed.

Reconnect now claimed success before the connection answered.
Update checks, workflow checks, restarts, and harness scans also simulated successful work.
The screen audit found similar pairing, repository discovery, account sign-in, message nudge, design-opening, download, and generated commit-message paths.
A refused full run also scheduled a callback that tried to update a run that had never been created.
Unconnected actions now show the required refusal notice before their simulation starts.
Reconnect now leaves its status to the real connection.
The standalone mock retains its simulation.

## 642. The logout test supplied its own record cleanup.

Found: 2026-11-13, in the review of the first live website connection.
State: fixed.

The previous rendering test supplied an ended session and empty records itself.
Its name now describes that limited assertion.
New tests invoke the actual logout control through the real connection.
They inspect every mapped collection after confirmed and unconfirmed logout attempts.

## 643. The separate browser gate reported four failures outside the studio page.

Found: 2026-11-13, while verifying the connection review fixes on commit `7f56967`.
State: fixed by the web-flaky investigation.

The separate browser run passed 42 cases and failed four cases.
The Git bulk-stage case at `packages/web/e2e/git.spec.ts:208` could not find the expected disabled Commit 2 files button.
The Git fetch case at `packages/web/e2e/git.spec.ts:315` still displayed 0 incoming after its five-second deadline.
Issue 609 already records a related Git synchronization timing failure.
The logout-draft case at `packages/web/e2e/new-project.spec.ts:225` exceeded its 30-second limit.
The component-preview case at `packages/web/e2e/new-project.spec.ts:605` did not observe the expected successful document response.
The live studio case and the standalone mock case both passed.
The original output is in `.foundry/remote-browser.log` in the `connect-fix` worktree.
These failures were not investigated or attributed to a cause in this change.
The lead owns the completion-gate assessment.
The final full check on commit `c813a51` passed all 530 unit test files and 44 browser cases.
The Git bulk-stage case failed at the same assertion.
The registered-component preview case failed earlier at `packages/web/e2e/new-project.spec.ts:590`, where its expected heading was absent from the frame.
The live studio case and the standalone mock case passed again.
The final output is in `.foundry/remote-check.log` in the `connect-fix` worktree.

The web-flaky correction separates the Git command acknowledgment from the coherent refresh.
It separates display issuance, the exact document response, and rendered asset evidence.
The original five-second assertion deadlines remain unchanged.
Its logout correction is recorded in issue 653.
The reproduced fetch report receives the same acknowledgment ordering correction in issue 609.

The web-flaky repeat run passed all 120 cases in 18.9 minutes with two workers and zero retries.
It included 20 repetitions each of bulk staging, lost-reply recovery, synchronization, logout, component preview, and the heavy Git layout journey.

The final remote check passed all TypeScript checks, all 532 unit test files, all 48 browser cases, and the credit check.
The unit suite retained its two pre-existing skips.
The fixes are in signed commits `eeab43a` and `3e5f892`.


## 644. A fast first response could leave the live page on its checking screen.

Found: 2026-11-13, in the full browser check on commit `06eb0a0`.
State: fixed.

The store registered its listener in a passive effect.
The initial session and snapshot could arrive before that listener existed.
The store then held the signed-in records while the page still displayed its empty checking screen.
The listener now registers in a layout effect before those asynchronous replies can arrive.
The regression test uses the actual connection with immediate responses.
The logout-control tests no longer delay their initial session response.
The earlier delay had masked this product race in the test harness.

## 645. Live request cards used the mock's fixed permission options.

The mock's compact approval card always offered its own Allow and Deny identifiers.
A harness can send different identifiers and persistent options.
The live card now renders the engine's complete option list.
The standalone mock keeps its original choices.
The browser test answers a permission with a harness-specific identifier.

## 646. Reading an absent thread could write into the live store.

The mock's thread reader created an empty thread when none existed.
Live threads are engine records, so that read now returns an empty list without writing.
The live connection clears thread records when the owner session ends.

## 647. A snapshot refresh could skip queued conversation events.

The live connection advanced its stream cursor when it published a refreshed snapshot.
A lifecycle event could trigger a snapshot that already included later prompt and reply events.
Those events were then skipped when they arrived on the stream.
The connection now advances the stream cursor only after processing each stream item.
The first snapshot still anchors the initial subscription.
The browser test verifies that a sent prompt appears before any reload.

## 648. A fast session check could leave the page on its loading screen.

The store subscribed its rendering listener in a delayed effect.
A fast session check and snapshot could publish before that listener existed.
The store now subscribes in a layout effect, before browser responses can arrive.
The browser journey checks a signed-in reload after live actions.

## 649. Context selection needs the registered worktree identity.

A team's worktree can also be the project's registered checkout.
The live context picker now uses the engine's worktree identifiers from the project and team records.
It maps the search reply's result before displaying tasks and files.
The browser test attaches a task identity to a real prompt in a temporary Git repository.

## 650. Reads could start before the live connection was ready.

Home could try its request and phone-offer reads before the transport became available.
Home now starts those reads when the connection reports that it is live.
A failed request uses the existing temporary notice, so its reason does not remain over the controls indefinitely.

## 651. Some supplied labels were still shown as identifiers.

The live composer showed an account identifier instead of its display name.
Prompt context showed a task identifier instead of its available label.
The roster did not distinguish an agent whose task was under review.
The open screens now read account names and map task labels and the Reviewing state.
The account reader retains only the identifier, harness, and display name.

## 652. The live idle lane could claim that no work was assigned.

An idle agent can still own an active task.
The mock's fallback reason said "Nothing assigned" for that agent.
The live lane now leaves the reason empty when the engine supplies no reason.
The linked task remains visible.
The standalone mock keeps its original wording.

## 653. The existing project-creation logout journey can time out.

Found: 2026-11-13, during the full remote check of `8577d48`.
State: fixed by the web-flaky investigation.

The case at `packages/web/e2e/new-project.spec.ts:225` reached its unchanged 30-second limit.
The other 45 browser cases passed.
The captured page showed the Machines registration form with its default values after login.
The snapshot does not establish which awaited operation exhausted the limit.
The same case passed alone at the required baseline, `8f9f321`.
A bounded five-run comparison at that baseline then produced four identical timeouts and one pass.
The production web source, engine source, and affected test file are unchanged from that baseline.
The cause remains unproved.
The task result records the complete checks and baseline comparisons.

## 654. The snapshot could not be read once an account was added without an enabled flag

Found: 2026-11-13, while setting up the first real project on LGTM Studio itself.
State: fixed in the same change.

An account added with `lgtm accounts` and no `enabled` field is stored without that field.
The `client.snapshot` reply requires a true or false value for each account.
The engine sent the unset value, so the reply could not be encoded and every snapshot failed.
The current website and the live website both stayed on "Reconnecting", with no error shown.
The engine now reports such an account as enabled, which is how account picking already treats it.
The test is case 3.1a in `packages/engine/test/client/snapshot.test.ts`.

## 655. The live website stays on "Reconnecting" when the snapshot fails, and says nothing

Found: 2026-11-13, in the same check as issue 654.
State: open.

When `client.snapshot` fails for a reason other than a lost connection, the live website retries without end.
It shows "Reconnecting" and gives the owner no reason.
The connection in `packages/studio/src/connection.ts` drops the error.
The owner should see that the service answered and what it said.

## 656. The live approval card overflowed, and a delivered answer showed the engine's wrapper

Found: 2026-11-13, by the owner, on the first real project.
State: fixed in the same change.

The live approval card showed each of the harness's options as its own button.
A long standing option, such as "Yes, and don't ask again for commands that start with ...", ran past the card's edge.
The card now has "Allow" and "Deny", as the mock designed it.
A standing option from the harness sits in the menu beside its button, with the harness's wording as the note.
An option of a kind the page does not know stays a button, and its text now wraps.
A delivered answer appeared in the thread as "Data from another agent [...] (delivery ...): Answer to question ...".
That text is the wrapper the engine puts around data for an agent's safety.
The thread now shows one short line, "Answer delivered: ...", and shows other passed data without the wrapper.
The context figure in the composer showed fifteen decimal places, and is now a whole percentage.

## 657. The engine labels the owner's answer as "Data from another agent"

Found: 2026-11-13, in the same check as issue 656.
State: open.

The wrapper around an answer the owner gave begins "Data from another agent" (`packages/engine/src/routing/envelope.ts:18`).
The agent that asked is told the answer came from an agent, when it came from the owner.

## 658. An open live page stays on "Offline" after the service restarts

Found: 2026-11-13, by hand on the first real project.
State: open.

A restart of the service ends the browser's session.
An open page of the live website then shows "Offline" and stays there.
Only a reload brings up the Login page.
The page should notice that the service answers again and ask the owner to sign in.

## 659. The live Mocks tab did not read recorded bundles.

The first live connection left each project's mock record empty.
It also hid the Mocks tab because the snapshot does not carry a bundle flag.
The step 2 adapter now reads complete mock history when the tab opens.
It shows the Design stage tab and preserves whole revision approval semantics.
A browser test covers current artifacts, stale artifact refusal, approval, and reload.
This problem is fixed on the worker branch.

## 660. The live repository design page used the sample's fixed sheets.

The page did not read the registered design, components, or tokens.
The step 2 adapter now loads those records when the page opens.
The canvas retains its menus and tables without inventing flows or token modes.
The isolated display controls restore keyboard focus after their requests finish.
Browser tests cover actual mock and component documents, private URL revocation,
and the editor route's refusal of changed design evidence.
The expanded standalone test also caught and verified a palette regression introduced
while connecting this page.
This problem is fixed on the worker branch.

## 661. Machines displayed unsupported capacity and installation placeholders.

The live page treated a zero slot limit as real capacity.
It also showed a persistent scanning state without reading harness discovery.
The step 2 adapter now loads discovery and the saved workspace and web port.
The page leaves unrecorded status, hardware, versions, limits, and timestamps empty.
It counts worktrees from the loaded workspace records.
Pairing, renaming, removing, and changing the limit retain the existing refusal.
Browser tests cover these refusals, discovery, rescanning, and repository registration.
This problem is fixed on the worker branch.

## 662. Search treated unavailable repository metadata as known.

The switcher showed "No remote" when the engine had not supplied a remote.
Its wider agent text also used a lifecycle display word as activity.
The live search mapping now indexes only the loaded repository, project, sprint,
team, and role fields that the engine supplies.
The existing word ranking remains in place.
Unit tests cover the search mapping and ranking.
The browser test covers navigation, empty results, and archived project exclusion.
No search request is made to the engine.
This problem is fixed on the worker branch.

## 663. Display cleanup depended on a live socket.

The new display adapter initially applied the socket guard to closing a frame.
A lost socket could therefore prevent navigation cleanup from reaching the
Hypertext Transfer Protocol (HTTP) endpoint.
Closing an issued frame now remains available with the owner's session cookie
after the socket or the connection closes.
Opening a frame still requires the live connection.
A focused test verifies both cleanup cases and the authenticated request options.
This problem is fixed on the worker branch.

## 664. A legacy Git browser case retained its initial uncertainty message.

The full check on `c8f7009` passed all 529 unit test files.
Its browser run failed the existing lost-reply case at `git.spec.ts:271`.
The page retained its initial database acknowledgment warning instead of the
expected terminal uncertainty message.
Six focused repetitions of this case passed on baseline `803db7f`.
The affected website source, engine source, and test body are unchanged.
The cause has not been established.
The worker result records the full check and baseline comparison outcomes.

## 665. The known repository dialog referenced an unavailable local variable.

The merge review found that opening the live dialog for a known repository
referenced a `details` variable that the dialog did not define.
The dialog now uses the repository's recorded local folder.
It does not construct a folder from an unknown workspace setting.
A regression test opens the dialog and checks the actual registered path.
This problem is fixed in the merge.

## 666. An answered question or approval card lost its contents.

The owner reported this on 2026-11-13.
An answered card in a thread shrank to its title and a short answer line.
The summary, the recommendation and the report under "Details" were gone.
The card now keeps everything it showed before the answer.
The answer buttons stay in their row and are disabled.
The chosen button is highlighted, in green for an allow or an accept and in red for a deny.
A typed answer shows as "You answered" with the owner's words, and a cancelled request shows "Cancelled".
"Details" stays usable beside them.
The recommendation line leaves an answered card, and the row names the accepted answer instead.
The change is in `BriefCard` in `design/mock/js/ui.js`, and the live website carries the chosen option's kind as `answerKind`.
This is a change to the visible mock, and it awaits the owner's approval of the look.

## 667. A lead repeated its question as a message after asking it.

The owner reported this on 2026-11-13.
The project lead called the `ask` tool, and the owner saw the question as a card.
The lead then wrote "Sent through LGTM Studio:" and the same question again as an ordinary message.
The tool's description did not say that the recipient already sees the question.
The description in `packages/mcp/src/tools.ts` now says so, and it tells the agent not to repeat the question.
This has not been checked against a real agent.
A running agent keeps the old description until it is started again.
The website does not hide a repeated question, because hiding an agent's free text could hide a real message.

## 668. A live approval card showed the raw command as its title.

The owner reported this on 2026-11-13.
The Codex harness names a permission request with the command itself.
The card's title was therefore a long command line.
The live website now writes a plain title when the harness's description is only the command.
Examples are 'Run "rm" in the terminal' and "Run a Python script of 40 lines".
A harness's own description is kept when it differs from the command.
The plain title names the program and not the agent's intent, because no harness reports the intent.
The command and the folder under "Details" now sit in code boxes with a copy button.
A long command scrolls inside its box, which is at most 260 pixels high.
The folder now comes from the tool's own working folder when the harness reports one.

## 669. A tool row in a live thread grew to the size of its command.

The owner reported this on 2026-11-13.
The grey row that shows an agent's tool call used the whole command as its one-line label.
A long script filled the page, and its output had no limit either.
The closed row now shows the first line of the command, cut with an ellipsis.
The full command and the output open inside the row, in code boxes that scroll and can be copied.

## 670. An answered question shows its accepted answer beside the buttons.

The owner reported this on 2026-11-13.
An answered question card puts the accepted answer in the button row, between "Deny" and "Details".
The owner finds that placement odd.
The owner wants a short form of the accepted answer on its own line above the buttons, as the card's second or third line.
The owner will work on this part of the look later, so it is recorded and not changed.

## 671. A fast connection reply could leave a reloaded page blank.

Found: 2026-11-13, while testing the service screens against the real engine.
State: fixed in this change.

The store subscribed after the browser painted the page.
A fast session check and snapshot could arrive before that subscription existed.
The page then kept its initial checking screen until another update arrived.
The store now subscribes during layout, before asynchronous connection replies can arrive.

## 672. Registered workspaces need their project and team links joined.

Found: 2026-11-13, while connecting the Git picker.
State: fixed in this change.

A registered workspace need not hold a project identifier or a team identifier.
Projects and teams name their workspaces in their own records.
The mapping now joins those records so that the Git picker includes their worktrees.

## 673. The settings contract does not return effective role defaults.

Found: 2026-11-13, while connecting Service settings.
State: open.

The role settings request returns stored overrides.
It does not return the effective limits after the engine applies its defaults and role files.
The website shows an empty number for an unset limit.
An unset switch is labelled as not set by the service.
Worker stall time edits the service-wide stall limit.
The separate lead and assigned timers have no matching setting and remain empty.

## 674. Notification retries need the original receipt after a lost reply.

Found: 2026-11-13, while connecting notification delivery actions.
State: fixed in this change.

A carrier exchange can finish before its reply reaches the browser.
A repeated click must recover the original request instead of creating another delivery.
The connection keeps the request identifier until a reply confirms the result.
The notification page keeps the original alert generation and attempt while recovery is pending.
A unit test checks that recovery reuses the identifier.

## 675. Git destinations must keep their workspace identifiers.

Found: 2026-11-13, while reviewing the integration mapping.
State: fixed in this change.

The page displays a parent branch name.
A branch name alone does not identify a registered workspace.
The mapping also keeps the parent workspace identifier.
Integration and main review use that identifier to select their destinations.

## 676. The existing website's browser assertions failed in the full check.

Found: 2026-11-13, during the final remote check of the Studio Git and service screens.
State: open.

The full check of commit `5802092` passed all typechecks and 7,909 unit tests.
All three Studio browser journeys passed.
The existing website's bulk staging test failed at `git.spec.ts:208`.
Its five-second assertion could not find the disabled `Commit 2 files` button.
The failure snapshot showed that staging had succeeded while the working refresh remained pending.
The existing component preview test failed at `new-project.spec.ts:605`.
It observed issuance status 0 instead of 200 within five seconds.
The preview failure is already described in issue 611.
Both unchanged tests passed in isolation against baseline `8f9f321`.
That isolated pass does not establish either failure's cause.
No production code, assertion, or deadline was changed for these failures.
The full parallel browser suite was then run against an isolated export of baseline `8f9f321`.
It reproduced both failures at the exact same assertions.
It also reached the existing logout test's 30-second timeout at `new-project.spec.ts:225`.
The implementation branch's full run passed that logout test.
The baseline run finished with 43 passed tests and three failed tests.
The implementation run finished with 45 passed browser tests and two failed browser tests.
The complete comparison is recorded in the builder's result.
The first area merge's full check passed all 529 unit files and 7,920 unit tests.
All five merged Studio browser cases passed.
Three existing website cases failed.
The Git lost-reply case failed at `git.spec.ts:271`, as described in issue 609.
The logout-draft case exceeded its 30-second limit at `new-project.spec.ts:225`.
The component preview case failed at its `data-loaded` assertion at `new-project.spec.ts:626`, as described in issue 611.
Their causes remain unproved.

The review merge's full check passed 532 unit files and 7,960 unit tests.
All five Studio browser cases passed.
The existing website's cases failed at `git.spec.ts:208`, `git.spec.ts:271`, and `new-project.spec.ts:626`.
The final merge with area commit `aed0fce` passed 533 unit files and 7,980 unit tests.
All six Studio browser cases passed.
The browser suite finished with 48 passed cases and two failed cases.
The lost-reply case failed at `git.spec.ts:271`, as described in issue 609.
The component preview case observed issuance status 0 instead of 200 at `new-project.spec.ts:605`, as described in issue 611.
The separate credits check passed.
No existing website assertion or deadline was changed.

## 677. The automatic merge retained duplicate shared declarations.

Found: 2026-11-13, while merging the accepted board work into the Git builder's branch.
State: fixed in the merge.

Both builders added a request method to the live website's test connection.
The automatic merge kept both methods without reporting a conflict.
The Studio type check rejected the duplicate identifier.
The automatic merge also duplicated the JavaScript request export and the dialog's live import.
The merge now keeps one request method, one request export, and one live import.
The test connection keeps the board builder's request recording.

## 678. The review control fixtures did not load connected service settings.

Found: 2026-11-13, while merging the step 1 review fixes with the connected service pages.
State: fixed in the merge.

Four review regression tests looked for controls before the service settings had loaded.
Their fake connection refused every read and did not install the live mapping functions.
The fixture now installs the same mappings as the live entry point.
It returns explicit settings read replies and waits for the service controls to become ready.
It checks that opening the screen issued only known reads.
The original refusal assertions still inspect every request after each control is clicked.
The service browser journey also waits for the standing-rules write to finish before clicking its next control.
The streamed setting can update before the write's final refresh has completed.
The test keeps its original refusal assertion and deadlines.
The initial stall-time input also waits for the settings fieldset's pending state to clear.
A later remote run observed an empty value after the initial stall-time edit.
The remote settings save also waits for the form to report no unsaved changes before reloading.
A subsequent run read the previous check-in value after reloading.

## 679. The Home reader retained an answered request after logout.

Found: 2026-11-13, while merging the chat work with the connection review fixes.
State: fixed in the merge.

The chat reader kept answered requests across snapshot updates.
It also restored an answered request when logout cleared the connection's records.
The reader now retains an answered request only while its agent is still present.
A regression test loads an answered request through the Home reader and clicks the actual logout control.
It checks that the connection signs out and the request store becomes empty.

## 680. The Nudge regression test still expected an unconnected control after the merge.

The web-flaky investigation reproduced five failures in five runs with two browser workers.
Every trace stopped before logout at an attempt to fill a read-only repository name.
The asynchronous project read had selected the existing Actual Product repository.
Its registration detour correctly preserves that repository's name.
The old test passed only when it opened the detour before that default selection arrived.
This was a test fault.
The test now explicitly selects New repository before entering its private registration draft.
The corrected journey still verifies the real logout, the next login, and both cleared drafts.

The corrected logout journey passed all 20 remote repetitions with two browser workers and zero retries.
Its real session revocation and cleared-draft assertions remain intact.

The final remote check passed all TypeScript checks, all 532 unit test files, all 48 browser cases, and the credit check.
The unit suite retained its two pre-existing skips.
The fixes are in signed commits `eeab43a` and `3e5f892`.

## 681. The merged Messages module imported the live binding twice.

Found: 2026-11-13, during the remote browser check of this merge.
State: fixed in this merge.

Both branches added the live binding to the Messages module's imports.
Git kept both declarations when it merged the import lists.
The browser rejected the module and left both the live page and the standalone mock blank.
The test transformer accepted the declarations, so the Studio tests did not expose the error.
Removing the redundant import lets the browser parse the module.

## 682. The board mapping replaced worker names with role labels.

Found: 2026-11-13, during the merged chat browser journey.
State: fixed in this merge.

The area board mapping replaced each worker's engine name with its role label.
The chat roster needs the engine name to identify a worker and its controls.
The merged mapping keeps worker names and retains the area's project lead and team lead labels.
The browser journey checks the same worker in the blocked lane and the table.


## web-flaky-1. A component preview repeated its Git workspace validation for every artifact.

Found: 2026-11-13, while reproducing issues 634 and 643.
State: fixed.

The component display read verified the design file, its tokens, and every registered component independently.
Each artifact verification repeated the same repository and workspace Git checks.
The selected component then repeated those checks once more.
The browser repeated this work for the document and every authorized asset request.
A real two-component registration started 60 Git processes for one component read.
The browser trace showed pending document and asset reads while its assertion deadlines expired.
Separating the browser's document and asset waits exposed the journey's unchanged 60-second limit.
This was a product performance fault as well as a test ordering fault.

The engine now verifies the workspace once within the request's Git gate.
It still checks every artifact's current bounded bytes, path, and registered fingerprint.
It still checks the selected component's private data and dedicated folder.
It retains no verification across requests.
The regression test rejects changed design bytes, tokens, sibling components, selected components, branches, symbolic links, and agent access on subsequent reads.
That test fails against the old engine at 60 Git processes and passes with the correction.
No timeout, retry, authentication rule, or display authority was changed.

The corrected browser journey passed all 20 remote repetitions alongside the other Git and logout cases.
The complete two-worker repeat run passed all 120 cases in 18.9 minutes with zero retries.

The final remote check passed all TypeScript checks, all 532 unit test files, all 48 browser cases, and the credit check.
The unit suite retained its two pre-existing skips.
The fixes are in signed commits `eeab43a` and `3e5f892`.

## 683. A plain-word approval description was read as a command.

The full check on 2026-11-13 found this in the live chat browser journey.
The fix for issue 668 treated a harness's description as the command whenever the tool's input was not readable.
A request without its source event, such as a row on Home, then turned "Run Studio checks" into 'Run "Run" in the terminal'.
The description now stands in for the command only when the engine marks the input as cut.
A unit test covers the plain-word case.

## 684. Service settings shows no models for any harness.

The owner reported this on 2026-11-13.
The owner changed the default harness to Claude on "Service settings" and saw no models.
The same happened for the other two harnesses.
The engine's harness list carries an empty model list for every harness.
The engine learns a harness's models only from a running agent, through `client.agent.configuration`.
The page therefore has nothing to offer before an agent of that harness runs.
The page also does not say why the list is empty.
A fix needs the engine to ask a harness for its models without a running agent.
This is not fixed.

## 685. The Messages tab shows no board on a project without teams.

The owner reported this on 2026-11-13.
The project "Connect website engine" has a lead and no team.
The engine opens a channel for each team, so this project has no channel and no posts.
The tab shows "No channels yet", which is what the engine holds.
The owner expected to see a message board.
Whether a project gets a channel from its first day is the owner's decision.
This is not changed.

## 686. The Mocks tab is absent on a project without mocks.

The owner reported this on 2026-11-13.
The live website shows the "Mocks" tab only when a project is in its design stage or has a recorded mock.
The project "Connect website engine" has neither, so the tab is not shown.
The mock behaves the same way with its sample data.
Whether the tab should always show, with an empty state, is the owner's decision.
This is not changed.

## 687. The owner judged Subscriptions and Service settings unfinished.

The owner reported this on 2026-11-13.
The owner said that "Service settings" needs a lot of work and is acceptable for now.
The owner said that "Subscriptions" needs work before a release.
The owner did not yet say what is missing on either page.

## s5-workflows-1. The build-loop diagram still contains a hard exit after round six.

The owner removed the review limit on 2026-11-11.
The prose now asks for approval before every further round.
The steps under "Next round" still send round six to cutting, splitting, or accepting the plan.
The default workflow definition follows the newer decision and repeats the approval request.
The historical specification was left unchanged.

## s5-workflows-2. Workflow editing does not select or execute a project's workflow.

The engine had no stored workflow definition when this work began.
The new definition store and visual editor provide configuration operations.
Project selection and workflow execution remain the later build-loop work.
The Workflows page states that projects still run the default workflow.

## s5-workflows-3. The remote helper needs approval outside the restricted tool environment.

The local package installation first failed because its store lock was read-only.
The remote test helper first failed because the restricted environment presented an unsafe system Secure Shell configuration file.
Automatic approval review initially rejected the remote sync because the destination was unverified.
The repository's remote-checks document identifies the default address as the owner's test computer.
Providing that evidence allowed the required helper and the pinned dependency installation to run.
No system configuration was changed.

## s5-workflows-4. An existing project push command parity test failed once in the full run.

The first full check failed the dotted `project.push` terminal dispatch case.
The same case passed immediately when run by itself.
No project push implementation was changed in this work.
The final full check determines whether the failure repeats.
The initial output is retained in the worker's result artifacts.
