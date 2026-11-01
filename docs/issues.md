# Shepherd: problems found

A running list of problems found while building or using Shepherd. Add a
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
State: fixed in unit 2: `bin/shepherd` follows links, and
`launcher-links.test.ts` covers it. Commit: 87e2d4c. The first fix used
`readlink` from `PATH`; issue 20 replaced that.

What happened: `bin/shepherd` found its checkout with `dirname "$0"` and does
not follow a symbolic link to the file itself. A link such as
`~/.local/bin/shepherd -> <repo>/bin/shepherd` makes it look for
`bin/stub-entry.ts` next to the link, and Node.js exits 1 with
`Cannot find module`.
What should happen: the launcher resolves its own path through any links,
or prints a clear message when the entry file is missing.
Why it matters: a link on the path is a likely way for the owner to run
`shepherd` from any terminal.

## 8. The launcher looks up `dirname` on the path

Found: 2026-11-01, in the unit 1 review.
State: fixed in unit 2: the launcher uses `${self%/*}` instead of `dirname`.
Commit: 87e2d4c. The first fix still ran `readlink` from `PATH` before the
chosen Node.js, which the focused review found; issue 20 fixed that, so now
only shell builtins and the chosen Node.js run.

What happened: `bin/shepherd` ran `dirname` from `PATH`. Decision 22 allows
a path lookup only for `node`.
What should happen: the launcher uses shell parameter expansion, so
`node` is the only program found through `PATH`.
Why it matters: a hostile path could run another program first. The risk
is low, because such a path already controls the permitted `node`
fallback, and the fix costs nothing.

## 9. The `onlyBuiltDependencies` list is not enforced on pnpm 12

Found: 2026-11-01, in the unit 1 review (adds to issue 3).
State: partly fixed in unit 2: `pnpm-workspace.yaml` now says at the old key
that the list is not enforced and that `allowBuilds` is the policy (commit:
87e2d4c). Still open: the owner decides whether criterion 1.6 and its frozen
test should name `allowBuilds` instead.

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
`VP_REMOTE_CACHE_URL`, which only the vite-plus tool reads; Shepherd runs
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
Shepherd"`, but Herdr names an action's label `title`, as the Synapse
manifest does. Neither the plan's task 1f nor the unit 1 manifest test named
the field, so the test passed.
What should happen: each `[[actions]]` entry has `id`, `title`, `contexts`
and `command`.
Why it matters: Herdr cannot load Shepherd at all until the manifest parses.

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
State: open; belongs to the unit that builds the service logger.

What happens: decision 57 says the copied ACP protocol debug logging stays off
outside tests. That is true of `logProtocol` in `effect-acp/src/protocol.ts`
(lines 263-272), which the `logIncoming` and `logOutgoing` options gate. Four
other calls are not gated: `protocol.ts` lines 503 and 599, and
`_internal/shared.ts` lines 37 and 53. They log the cause of a handler defect or
an encoding failure, which can include a value the handler held. Line 547 logs
only structural diagnostics.
What should happen: the service's logger passes through the redactor before
Shepherd registers any extension handler, and a test greps its output for
planted secrets, as decision 57 requires. Shepherd never sets `logIncoming`,
`logOutgoing` or `logger` outside tests.
Rule for the units that run ACP (6a, 6d and 7a): install the redacting service
logger before constructing any ACP runner or handler. Keep wire logging off,
except behind the temporary-home test gate of decision 74. Test planted secrets
through four paths: the core path, notification handlers, extension-handler
defects, and encoding failures.
Why it matters: until then, a handler defect could write a secret to the log.
No Shepherd code registers a handler yet, so nothing leaks today.

## 14. Copied environment helpers default to the whole process environment

Found: 2026-11-01, in the unit 2 security read.
State: open; belongs to the unit that starts harness processes.

What happens: `mergeProviderInstanceEnvironment` (`instanceEnvironment.ts`) and
`makeClaudeEnvironment` (`ClaudeHome.ts`) use `process.env` when the caller
passes no base environment.
What should happen: Shepherd always passes an explicit base environment, so an
agent gets exactly `SHEPHERD_SOCKET` and `SHEPHERD_TOKEN` and what the harness
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

## 16. The ACP schema generator cannot finish in Shepherd

Found: 2026-11-01, in the unit 2 security read.
State: open; low priority.

What happens: `effect-acp/scripts/generate.ts` downloads schema files from
GitHub and ends by running `pnpm exec vp fmt`. The `vp` program belongs to the
vite-plus tool, which Shepherd does not install, so the last step fails after
the files are written.
What should happen: if Shepherd regenerates the schemas, the formatting step is
replaced by a Shepherd tool, and the change is recorded in the README table.
Why it matters: someone running `generate` gets a confusing failure.

## 17. T3 Code has no unit test for the replay helpers

Found: 2026-11-01, in unit 2.
State: fixed; recorded in `third_party/t3code/README.md`.

What happened: criterion 2.4 needs a test named `replayTranscript.test.ts`, but
T3 Code has none for `provider-testing`. A test was written for Shepherd, with
a fixture, and the README table marks both as written for Shepherd.
What should happen: nothing further.
Why it matters: the copied helpers would otherwise have no test at all.

## 18. The first-party packages did not depend on the copied packages

Found: 2026-11-01, in the focused review of unit 2.
State: fixed in the commit "fix(unit-2): link the copies, harden the checker and launcher" (unit 2 fix round 1); `copied-package-edges.test.ts` covers it.

What happened: after a frozen install, `import.meta.resolve` failed with
`ERR_MODULE_NOT_FOUND` from `packages/engine` and `packages/testing` for the
copied packages. Decision rows 23 and 71 require these edges before the
manifests freeze.
What should happen: `engine` depends on `@shepherd/t3-effect-acp`,
`@shepherd/t3-node-sqlite` and `@shepherd/t3-provider-instance`. `testing`
depends on `@shepherd/t3-effect-acp` and `@shepherd/t3-provider-testing`, all as
`workspace:*`. Nothing depends on `@shepherd/t3-source-control`, which has no
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
State: open; the owner decides.

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

## 32. A failed COMMIT left the copied SQLite client's transaction open

Found: 2026-11-01, in the unit 4a review.
State: fixed in `third_party/t3code/node-sqlite/src/nodeSqliteClient.ts`.

What happened: the copied client (from T3 Code,
`packages/shared/src/nodeSqliteClient.ts`) passed no `onCommitFailure` to
`Client.make`. SQLite can keep a transaction open after a COMMIT fails, for
example on a deferred foreign-key violation, so the rows of the failed batch
stayed on the writer connection and the next transaction on it was unsafe.
What should happen: a failed COMMIT is rolled back on the same connection. If
that rollback fails too, the connection is not reused.
The fix: `onCommitFailure` runs `ROLLBACK` and counts SQLite's "no transaction
is active" error as clean. A failed rollback poisons the connection, and each
later hand-out retries the rollback first, as Effect's `makeSqliteAcquirers`
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
State: accepted by the manager for now, because the repository is private;
the owner decides whether to keep it.

What happened: `packages/testing/fixtures/claude.ndjson` (lines 5 and 13-15,
about 50 KB each) and `codex.ndjson` (line 5), and the third harness's `cursor.ndjson` (line 10,
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
is eight or more characters long. Under pnpm, `npm_package_name` is
`shepherd`, so ordinary text such as a source note naming
`shepherd-engine` becomes `<redacted>-engine`. The re-recorded
`errors/cursor-out-of-usage.json` was over-scrubbed this way, so the earlier
committed copy was kept.
What should happen: the scrubber redacts the values of account variables and
of names that can hold secrets, and leaves well-known values that are not
secret, such as the package name, version and script name.
Why it matters: over-scrubbing is the safe direction, but it corrupts the
fixtures' text and can hide real differences between recordings.

## 38. The third harness's greeting fixture records an out-of-usage reply

Found: 2026-11-01, by the lead, reading the `cursor.ndjson` recorded at e93bb00.
State: open. The fixture is committed as recorded.

What happened: `packages/testing/fixtures/cursor.ndjson` is the
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
text with a normal stop reason, so Shepherd cannot tell it from a reply by the
stop reason alone.

## 39. The read-only connection exists only when the SQLite layer turns on its reader workers

Found: 2026-11-01, while writing the unit 4b tests.
State: open.

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
State: open for unit 7a.

What happens: `PubSub.unbounded` in `packages/engine/src/log/EventLog.ts`
keeps publishing committed events while a subscriber is open. If the consumer
of `Stream.fromSubscription` in `packages/engine/src/log/subscribe.ts` stops
reading without closing, its backlog keeps every later event in memory.
What should happen: unit 7a owns a bound or a disconnect rule for a slow
client. T3 Code's `apps/server/src/orchestration-v2/LiveStreamBudget.ts`,
line 333, is a pattern for budgeting the buffered live events during replay.
Why it matters: one stalled client must not exhaust the engine's memory.

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
State: open for unit 6a's restart recovery.

What happens: the command's receipt is stored with the first append. If the runner then rejects the start and the follow-up append (`AgentStartFailed` or `AgentReloadFailed`, with the token revocation) itself fails, a retry returns the stored success without calling the runner again.
Why it matters: the agent stays in "starting" with a live token until the engine restarts.
What should happen: restart recovery, or a sweep in unit 6a, moves an agent that has sat in "starting" with no runner session to "start failed" and revokes its token.

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

## 68. A committed permission answer can fail to reach its runner

Found: 2026-11-01, while building unit 5c.
State: the live process path is fixed in unit 6a. Restart reconciliation remains open for unit 6d.

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

## 75. The wait contract has no owner waiter

Found: 2026-11-01, while building unit 5d.
State: open for the contracts scope and unit 7.

What happens: `WaitOpened` requires the waiter's agent identifier, and `Delivery.target` must be an agent. The engine therefore refuses a `wait` from the owner with "command refused".
Why it matters: decision row 26 gives the owner's terminal `shepherd wait --block`. `AGENTS.md` rule 5 requires that what the owner can do from the terminal is also possible through the API.
What should happen: the contracts give a wait an owner waiter, at least for blocking waits, which create no delivery.

## 76. Engine notices name the owner as their sender

Found: 2026-11-01, while building unit 5d.
State: open for the contracts scope.

What happens: a wait's wake, a wait's crash notice and a returned-delivery notice are deliveries the engine writes. `Actor` has only the owner and agents, so these deliveries carry the owner as sender. Their text is still wrapped in the data envelope, and a wake carries its wait as `source`.
Why it matters: a client cannot tell an engine notice from the owner's own prompt by its sender. A notice that fails is returned to the owner, which ends there, so no notice loops.
What should happen: the contracts add an engine sender, or the plan states that the owner sender with a data envelope marks an engine notice.

## 77. A blocking wait's retry and its cancellation window

Found: 2026-11-01, while building unit 5d.
State: the cancellation window is fixed in unit 5d's fix round 1. The retry part is open for unit 7a, which owns the transport and its connection handling.

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
State: open for unit 6d.

What happens: the committed-event follower starts with the command handler and sends on `SessionOpened`, `DeliveryQueued`, `TurnEnded`, `DeliveryReturned` and `DeliveryRequeued`. It does not send what was queued before it started.
Why it matters: during recovery, events that recovery itself commits could start sends before recovery has re-checked waits or reconciled sessions.
What should happen: unit 6d decides when the follower becomes active during recovery, and how the queues that existed before it started are drained, such as by step 10 calling `dispatchQueued` for each agent.

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
State: open for unit 6d.

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
State: open for unit 6d to handle unsupported recovery, a macOS implementation and host verification.

What happens: `recovery/orphans.ts` provides the Linux reader and an explicit
unsupported macOS reader. The macOS reader throws before the sweep can send
a signal.
What should happen: a macOS implementation reads the boot identity, process
group, start time, user and executable, and passes criterion 6.8 on a macOS
host before recovery uses it.
Why it matters: a sweep must refuse unsupported process identity checks
rather than signal a group based only on its number. The lead authorized
this stub for unit 6c.

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
State: the unbounded wait is fixed in unit 6c fix round 1. The absent-leader
case and the recovery response remain open for unit 6d.

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

## 128. Classified pauses need trustworthy error sources and reset times

Found: 2026-11-01, in unit 6c's focused review, finding F-4, and the unit 6b
review's ruling A3, relayed by engine-lead in board post 980.
State: error-source classification is fixed in unit 6c fix round 1. Reset
times remain open for the merge of units 6b and 6c, with engine-lead deciding
the wiring.

What happened: the runner classified a successful turn's text, so ordinary
agent prose containing "authentication required" could produce a signed-out
pause. Unit 6b would then apply that pause to the entire account.
What changed: a signed-out classification requires an actual error reply
in `turn.error`. Successful text can produce only an out-of-usage pause,
and only for cursor, whose recorded transcript uses that text form
(issue 38). All other harnesses classify only their error replies. The
same restrictions apply to an injected classifier.
What remains: the real classifier returns only the pause class. The runner
still omits `resetAt` even when an error reply supplies `data.resetsAt`.
Unit 6b adds `resetAt` to the runner's pause outcome, and the fake agent's
`out_of_usage` step already supplies `data.resetsAt`. No recorded fixture
holds a reset time yet, as recorded in the fix-round brief.
What should happen: the merge carries the error reply's reset time into
the pause outcome, and recorded fixtures eventually verify the real
adapter's reset-time form. The classifier signature stays unchanged here.
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
State: open for unit 6d.

What happens: row 53 says a pause before the session opens keeps no session, and when it clears the engine opens the session and then sends the first prompt. The start path (`commands/start.ts`) writes the agent, spawns, and records the session in one flow. A provider limit reported before `SessionOpened` has no pause path, and no frozen test covers it.
What should happen: a start that is paused before its session opens keeps no session reference, and the account return opens the session first and then sends the first prompt.
Why it matters: without it, such an agent stays stopped instead of waiting for its account. The change needs the start path restructured, which is larger than unit 6b's scope.

## 116. A crash between an "account available" commit and the return write leaves agents paused

Found: 2026-11-01, by engine-u6bb, building unit 6b.
State: open for unit 6d.

What happens: the agents on an account return to idle in a second transaction, written by `accounts/available.ts` after it sees the committed `AccountAvailable`. If the service stops between the two commits, the account is available and its agents stay paused. Nothing re-runs the return at startup.
What should happen: startup recovery runs the return once for every available account that still has paused agents. The return is idempotent, so a second run writes nothing.
Why it matters: those agents would never resume without an owner `accounts mark-available` call, which the owner cannot know to make.

## 117. The timer and the persistent secret store are not wired into a running service

Found: 2026-11-01, by engine-u6bb, building unit 6b.
State: open for the unit that assembles the service.

What happens: `packages/engine/src/index.ts` exports nothing, so `startAccountTimers` (`accounts/timers.ts`) and the persistent secret store layer (`accounts/SecretStore.ts`) are called only from tests. The `AcpRunner` layer also now needs `FileSystem` and `Path` services for the Codex shadow home.
What should happen: the assembly starts `startAccountTimers` inside the service scope, provides the persistent `SecretStore` layer over the state folder, and provides the Node file system and path services.
Why it matters: without the timer an out-of-usage account returns only by owner action, against rows 28 and 53.

## 118. A classified pause drops the provider's error text

Found: 2026-11-01, by engine-u6bb, building unit 6b.
State: open; no change planned until the owner asks.

What happens: the `promptReply` pause outcome carries an `error` string, but the pause path writes only the fixed reasons ("account needs sign-in", "account is out of usage, no reset time known") so that no provider text reaches the log, a view or a reply.
What should happen: if a diagnostic is wanted, unit 6c classifies and redacts it before it is stored, and the owner decides where it is shown.
Why it matters: an owner sees that an account is paused but not what the provider said, which makes odd limit messages harder to diagnose.

## 119. Unreferenced secrets are never collected

Found: 2026-11-01, by engine-u6bb, building unit 6b.
State: open for unit 6d; the follow-up of issue 57.

What happens: `accounts/SecretStore.ts` stores a value before the account event that references it commits. A failed commit, or a replaced secret, leaves a value in `secrets.json` that no account event refers to.
What should happen: startup recovery lists the secret references still used in the account views and removes the others from `secrets.json`.
Why it matters: an unused credential stays on disk (mode 0600) longer than the owner expects.

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
