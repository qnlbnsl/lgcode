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

## 49. The folder ceiling and the stream redactor leave four duties to later units

Found: 2026-11-01, while building unit 5a.
State: open; each item names the unit that owns it.

What happens: unit 5a's ceiling and redactor meet criteria 5.11 and 5.12, but
four limits remain.

- A protected folder bind-mounted somewhere inside a requested folder is not
  found. Decision row 65 compares device and inode along the real path's
  ancestors, which catches a folder that is, is inside, or is an ancestor of a
  protected folder, including a bind mount of the protected folder itself.
  Finding a mount below the requested folder would need a walk of the whole
  tree or a read of the mount table.
- The worktree check cannot prove that git created the worktree. It accepts a
  `.git` file only when it names `<common directory>/worktrees/<name>` with a
  `commondir` file, and it checks git's `gitdir` back-link when that file
  exists. The frozen fixtures have no back-link, so its absence is accepted.
  An agent that can write inside the parent repository's common directory can
  still make a new `worktrees/<name>` entry that passes.
- A folder grant lives in memory. Unit 6d's recovery reload (decision row 52,
  step 7) must rebuild it by calling `checkFolder` with the stored request and
  then compare the result with the stored real path before it calls
  `folderForSpawn`. A short race also remains between `folderForSpawn` and the
  spawn itself; unit 6a should call it immediately before spawning.
- `redactChunk` keeps a carry for each item until that item's final chunk.
  Unit 6a must send a final chunk for every item, including items cut off by a
  crash or an interruption, or the carries stay in memory.

What should happen: units 6a and 6d meet the grant, race and final-chunk
duties above. The owner decides whether the first two limits need a mount
table read or a required back-link, and SECURITY.md states the remaining
limit.
Why it matters: each limit is a way for an agent-started child to reach a
folder, or for the service to hold memory, beyond what the ceiling promises.
