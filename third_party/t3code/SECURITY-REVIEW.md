# Security review of the code copied from T3 Code

This file records the security read of every file copied from
[T3 Code](https://github.com/pingdotgg/t3code) into this folder. It was written
for unit 2 of the engine plan, on 2026-11-01, against T3 Code commit
`6fc9144a60c4a5f45089316ddd5f7371bafd3bf2`. The review follows decisions 39
and 57. The script `scripts/check-credits.sh` fails when a copied file is
missing from the table at the end of this file.

## What was looked for

Each file was read for these problems:

- Running other programs, or building shell commands from data.
- Reading or writing files, or creating links, outside the paths the caller names.
- Passing the whole process environment on to a child process.
- Logging or returning secrets, prompts, or message payloads.
- Dynamic code: `eval`, `new Function`, or code strings built from data.
- Network access and install-time scripts.

The five `package.json` files carry no `preinstall`, `install`, `postinstall` or
`prepare` script. Every dependency in them comes from the workspace catalog, and
none needs a build step, so `allowBuilds` is unchanged.

## Logging calls in the ACP protocol file

The file `effect-acp/src/protocol.ts` is identical to the T3 Code file
`packages/effect-acp/src/protocol.ts`, so the line numbers below are the same in
both. Decision 57 says the copied ACP protocol debug logging stays off outside
tests, and that the service's logger passes through the redactor.

| Lines | Call | Level | What it can contain | How it is kept off or redacted |
|---|---|---|---|---|
| 263-272 | `logProtocol`, which ends in `Effect.logDebug("ACP protocol event")` at line 272 | Debug | The whole protocol event: raw wire text and decoded messages, so prompts and tool output | Off. The function returns at once unless the caller passed `logIncoming` (line 264) or `logOutgoing` (line 267), and both options are unset by default. Its callers are lines 285, 305, 540, 700, 724, 731, 936 and 950, and line 700 checks `logIncoming` again. LGcode's engine must never set either option outside tests. A caller can also pass its own `logger` option, which receives the same events; LGcode must not pass one. Decision 57 also requires a test that greps the service's output for planted secrets. |
| 503 | `Effect.logError("ACP extension request handler failed for '<method>'", cause)` | Error | The cause of a defect in an extension request handler, which can carry anything the handler held | On, because no option gates it. It reaches the Effect logger only, and the service's logger passes through the redactor (decision 57). Until that logger exists, no LGcode code registers an extension handler, so the call cannot fire. |
| 547 | `Effect.logWarning("Dropped an ACP notification that failed to decode")` | Warning | Only structural diagnostics: operation, method, request identifier, issue count, issue kinds, path depth, and a summary of field paths and reasons such as "missing" or "wrong type". It never contains a payload value. The code reads `decodeFailureDiagnostics` at lines 184-192. | On, and safe. It logs once for each distinct failure on a connection. Field names come from the agent, so the service logger still redacts it. |
| 599 | `Effect.logWarning(error)` with annotations for method, request identifier and operation | Warning | An encoding error whose `cause` field holds the schema failure for the value an extension handler returned, so it can include that value | On, because no option gates it. It reaches the Effect logger only, and the service's logger passes through the redactor (decision 57). No extension handler exists in LGcode yet. |

The calls at lines 503 and 599 are not gated by the logging options, which is
the part of decision 57's wording that is not literally true of the copy. The
copy is unchanged. Instead, the service's logger redacts them, and the rule that
LGcode registers no extension handler holds until that logger is built. This
is recorded as an issue in `docs/issues.md`.

## Other logging calls found

| File and line | Call | Handling |
|---|---|---|
| `effect-acp/src/_internal/shared.ts` line 37 | `Effect.logError("ACP notification handler failed", cause)` | Logs the cause of a defect in a notification handler. Redacted by the service logger. |
| `effect-acp/src/_internal/shared.ts` line 53 | `Effect.logError("ACP request handler failed for '<method>'", defect)` | Logs a defect in a request handler. Redacted by the service logger. |
| `node-sqlite/src/nodeSqliteClient.ts` lines 451 and 626 | `Effect.logWarning(...)` with a `reason` string | The reason is an error message or a SQLite version, never a statement parameter or row. |
| `provider-instance/src/CodexHomeLayout.ts` line 280 | `Effect.logWarning(...)` with a directory path | Logs a path inside the second harness's home. No secret. |
| `effect-acp/scripts/generate.ts` lines 437 and 482 | `Effect.log(...)` | Counts of generated schemas. The script is not run by LGcode. |

## Findings that are not logging

| Finding | Where | Fix |
|---|---|---|
| The whole process environment is passed on by default, because `baseEnv` defaults to `process.env`. | `provider-instance/src/instanceEnvironment.ts` line 9, `provider-instance/src/ClaudeHome.ts` line 34 | LGcode must always pass an explicit environment that holds exactly `LGCODE_SOCKET` and `LGCODE_TOKEN` plus what the harness needs (decision 57). Recorded in `docs/issues.md`. The copy is unchanged. |
| The helper writes the environment values it is given to a JSON file next to the stub, with the default file mode. | `provider-testing/src/fakeCli.ts` lines 21-22 | The helper is for tests, under a temporary folder. Tests must never pass a real secret to it. Recorded in `docs/issues.md`. |
| The generator downloads schema files over HTTPS from GitHub and then runs `pnpm exec vp fmt`. The `vp` program is not installed in LGcode, so the last step fails. | `effect-acp/scripts/generate.ts` lines 95 and 490 | The script only runs when someone runs `pnpm --filter @lgcode/t3-effect-acp generate`. It is not part of `pnpm check`, the build, or the service. Recorded in `docs/issues.md`. |
| The shadow-home setup removes a real directory recursively when it blocks a shared link. | `provider-instance/src/CodexHomeLayout.ts` around line 270 | The removal is limited to three fixed names (`mcp-oauth-locks`, `thread-writer-locks`, `.sqlite-maintenance.lock`) inside the shadow home that LGcode owns. LGcode must never set the shadow home to a folder it does not own. |
| The replay reader keeps the raw text of a bad line in its error value, although the error message does not show it. | `provider-testing/src/replayTranscript.ts` lines 12-23 | Replay files are test fixtures. Recorded fixtures must be redacted before they are committed. |
| One regular expression can take quadratic time on a very long line with many spaces. | `source-control/src/mergeMessage.ts`, the `co-authored-by` pattern | The input is a commit message that the engine itself builds. Accepted, no fix. |

## Table of files

The two metadata files in each package (`package.json` and `tsconfig.json`) are
LGcode's own and are not listed.

The three generated files under `effect-acp/src/_generated/` (19,457 lines in
all) were scanned and were not read line by line. The scan used these commands
from that folder:

- `grep -hE '^import ' *.ts | sort -u` printed one line, the import of
  `effect/Schema`, so the files import nothing else.
- `grep -nE 'process\.|require\(|import\(|eval\(|new Function|child_process|"node:|fetch\(|Effect\.|console\.|globalThis|Deno\.|Bun\.' *.ts`
  matched three lines, all of them text inside description strings (the words
  "process" and "processing"), and no code.
- The files hold schema declarations, plus short arrow functions that only
  delay a reference to another schema (`Schema.suspend`). A search for
  top-level functions and classes found none.

Rows for these files say "scanned, not read line by line".

| File | Result |
|---|---|
| `effect-acp/scripts/generate.ts` | Finding: downloads from GitHub and runs `pnpm exec vp fmt`; development only, not run by LGcode. See "Findings that are not logging". |
| `effect-acp/src/_generated/meta.gen.ts` | scanned, not read line by line; no findings. See the method above. |
| `effect-acp/src/_generated/schema-v1.gen.ts` | scanned, not read line by line; no findings. See the method above. |
| `effect-acp/src/_generated/schema.gen.ts` | scanned, not read line by line; no findings. See the method above. |
| `effect-acp/src/_internal/shared.ts` | Finding: logs handler defects at lines 37 and 53; redacted by the service logger. |
| `effect-acp/src/_internal/stdio.test.ts` | read, no findings |
| `effect-acp/src/_internal/stdio.ts` | Finding: the copied Stdio service discards its own standard error writes, but it does not read or drain the child's `stderr`. Unit 6a must drain the child's standard error and redact it before it is logged or stored. |
| `effect-acp/src/agent.test.ts` | read, no findings |
| `effect-acp/src/agent.ts` | read, no findings. It passes the logging options through unchanged and has no logging call of its own. |
| `effect-acp/src/client.test.ts` | read, no findings |
| `effect-acp/src/client.ts` | read, no findings. It spawns nothing itself; the caller supplies the process handle. It passes the logging options through unchanged and has no logging call of its own. |
| `effect-acp/src/compat.ts` | read, no findings |
| `effect-acp/src/errors.test.ts` | read, no findings |
| `effect-acp/src/errors.ts` | read, no findings. Error messages hold method names and structural diagnostics, not payload values. |
| `effect-acp/src/protocol.test.ts` | read, no findings |
| `effect-acp/src/protocol.ts` | Findings: logging calls at lines 263-272, 503, 547 and 599, described above. |
| `effect-acp/src/rpc.ts` | read, no findings |
| `effect-acp/src/schema.test.ts` | read, no findings |
| `effect-acp/src/schema.ts` | read, no findings |
| `effect-acp/test/fixtures/acp-mock-peer.ts` | read, no findings. It reads only `ACP_MOCK_*` variables and runs only in tests. |
| `effect-acp/test/fixtures/antigravity-initialize.json` | read, no findings |
| `node-sqlite/src/nodeSqliteClient.ts` | read, no findings. Extension loading is off (`allowExtension: false`, lines 318 and 869). The worker source is a fixed string; the database path is passed as worker data, never joined into code. The warning calls at lines 451 and 626 carry no row data. |
| `node-sqlite/test/nodeSqliteClient.test.ts` | read, no findings |
| `provider-instance/src/baseSchemas.ts` | read, no findings |
| `provider-instance/src/ClaudeHome.ts` | Finding: `makeClaudeEnvironment` defaults to the whole process environment; see "Findings that are not logging". |
| `provider-instance/src/CodexHomeLayout.ts` | Findings: the recursive removal of three fixed names, and the warning at line 280; see above. The file keeps `auth.json` private and refuses a link in its place. |
| `provider-instance/src/CodexManagedHome.ts` | read, no findings. The instance identifier is limited to letters, digits, hyphens and underscores by its pattern, so it cannot climb out of the state directory. |
| `provider-instance/src/HostProcess.ts` | read, no findings |
| `provider-instance/src/instanceEnvironment.ts` | Finding: the whole process environment is the default base; see above. |
| `provider-instance/src/pathExpansion.ts` | read, no findings |
| `provider-instance/src/providerInstance.ts` | read, no findings. Variable names and identifiers are checked by pattern. |
| `provider-instance/src/secretReference.ts` | read, no findings. A reference points at a secret held elsewhere; the secret itself is never stored. |
| `provider-instance/src/settings.ts` | read, no findings |
| `provider-instance/test/CodexHomeLayout.test.ts` | read, no findings |
| `provider-instance/test/symlinks.ts` | read, no findings. It writes only under a fresh temporary folder. |
| `provider-testing/src/HostProcess.ts` | read, no findings |
| `provider-testing/src/baseSchemas.ts` | read, no findings |
| `provider-testing/src/fakeCli.ts` | Finding: writes the given environment to a JSON file with the default mode; tests must pass no real secret. |
| `provider-testing/src/replaySchemas.ts` | read, no findings |
| `provider-testing/src/replayTranscript.ts` | Finding: the parse error keeps the raw line; fixtures must be redacted. |
| `provider-testing/test/fixtures/greeting.ndjson` | read, no findings |
| `provider-testing/test/replayTranscript.test.ts` | read, no findings |
| `source-control/src/mergeMessage.test.ts` | read, no findings |
| `source-control/src/mergeMessage.ts` | Finding: one pattern is quadratic on a very long line; accepted. |
