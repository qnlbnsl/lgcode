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
State: fixed in unit 2: `bin/shepherd` follows links with a `readlink` loop,
and `launcher-links.test.ts` covers it. Commit: UNIT2.

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
State: fixed in unit 2: the launcher uses `${self%/*}`, and only `readlink`
runs before the chosen Node.js. Commit: UNIT2.

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
UNIT2). Still open: the owner decides whether criterion 1.6 and its frozen
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
`vitest.config.ts` because no test reads them. Commit: UNIT2.

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
(lines 263-272), which the `logIncoming` and `logOutgoing` options gate. Three
other calls are not gated: `protocol.ts` lines 503 and 599, and
`_internal/shared.ts` lines 37 and 53. They log the cause of a handler defect or
an encoding failure, which can include a value the handler held. Line 547 logs
only structural diagnostics.
What should happen: the service's logger passes through the redactor before
Shepherd registers any extension handler, and a test greps its output for
planted secrets, as decision 57 requires. Shepherd never sets `logIncoming`,
`logOutgoing` or `logger` outside tests.
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

