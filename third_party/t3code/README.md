# Code taken from T3 Code

The files in this folder come from [T3 Code](https://github.com/pingdotgg/t3code),
copyright 2026 T3 Tools Inc., released under the MIT License. The licence
text is in [LICENSE](LICENSE) next to this file, and it must stay there for as
long as this code, or any code derived from it, is in Shepherd.

## Which files, and from where

The files were copied on 2026-11-01 from commit
`6fc9144a60c4a5f45089316ddd5f7371bafd3bf2` of `pingdotgg/t3code`. The
earlier copy of `mergeMessage.ts` and its test, made on 2026-10-30 from the same
commit, now lives in `source-control/src/`.

Every path in the table below is relative to this folder. The column "File in T3
Code" is relative to the root of the T3 Code repository. The column "Copyright
line" says `none in original` because no copied file carries a copyright line of
its own; the only copyright line is in [LICENSE](LICENSE). If a copyright line is
ever found in a copied file, the cell quotes it, and `scripts/check-credits.sh`
then checks that the file still contains it.

Each package also has a `package.json` and a `tsconfig.json` that Shepherd
wrote. They are not copied code and have no rows. Every package is named
`@shepherd/t3-<folder>` and uses only dependencies from the workspace catalog.
The security read of every file below is in [SECURITY-REVIEW.md](SECURITY-REVIEW.md).

| Package | File here | File in T3 Code | Copyright line | Changes |
|---|---|---|---|---|
| effect-acp | `effect-acp/scripts/generate.ts` | `packages/effect-acp/scripts/generate.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/_generated/meta.gen.ts` | `packages/effect-acp/src/_generated/meta.gen.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/_generated/schema-v1.gen.ts` | `packages/effect-acp/src/_generated/schema-v1.gen.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/_generated/schema.gen.ts` | `packages/effect-acp/src/_generated/schema.gen.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/_internal/shared.ts` | `packages/effect-acp/src/_internal/shared.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/_internal/stdio.test.ts` | `packages/effect-acp/src/_internal/stdio.test.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/_internal/stdio.ts` | `packages/effect-acp/src/_internal/stdio.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/agent.test.ts` | `packages/effect-acp/src/agent.test.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/agent.ts` | `packages/effect-acp/src/agent.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/client.test.ts` | `packages/effect-acp/src/client.test.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/client.ts` | `packages/effect-acp/src/client.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/compat.ts` | `packages/effect-acp/src/compat.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/errors.test.ts` | `packages/effect-acp/src/errors.test.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/errors.ts` | `packages/effect-acp/src/errors.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/protocol.test.ts` | `packages/effect-acp/src/protocol.test.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/protocol.ts` | `packages/effect-acp/src/protocol.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/rpc.ts` | `packages/effect-acp/src/rpc.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/schema.test.ts` | `packages/effect-acp/src/schema.test.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/src/schema.ts` | `packages/effect-acp/src/schema.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/test/fixtures/acp-mock-peer.ts` | `packages/effect-acp/test/fixtures/acp-mock-peer.ts` | none in original | Copied exactly. |
| effect-acp | `effect-acp/test/fixtures/antigravity-initialize.json` | `packages/effect-acp/test/fixtures/antigravity-initialize.json` | none in original | Copied exactly. |
| node-sqlite | `node-sqlite/src/nodeSqliteClient.ts` | `packages/shared/src/nodeSqliteClient.ts` | none in original | Two `worker.on("error")` handlers now turn the error into text with `cause instanceof Error ? cause.message : String(cause)`, because Shepherd's Node.js type package (26) types that error as `unknown`; T3 Code uses version 24. The `Client.make` call now passes an `onCommitFailure` that runs `ROLLBACK` on the connection and counts "no transaction is active" as clean. If that `ROLLBACK` fails, the connection is poisoned and each later hand-out retries it first, following `makeSqliteAcquirers` in Effect. Nothing else changed. |
| node-sqlite | `node-sqlite/test/nodeSqliteClient.test.ts` | `packages/shared/src/nodeSqliteClient.test.ts` | none in original | The test runner import changed from `vite-plus/test` to `vitest`, and the import of the client changed from `./nodeSqliteClient.ts` to `../src/nodeSqliteClient.ts`, because the test moved to `test/`. |
| provider-instance | `provider-instance/src/baseSchemas.ts` | `packages/contracts/src/baseSchemas.ts` | none in original | Excerpt: lines 1, 3 and 5-29 only (`TrimmedString`, `isNonBlank`, `TrimmedNonEmptyString`). The imports of `Option` and `SchemaGetter` were dropped because the excerpt does not use them. |
| provider-instance | `provider-instance/src/ClaudeHome.ts` | `apps/server/src/provider/Drivers/ClaudeHome.ts` | none in original | Import lines only: `ClaudeSettings` now comes from `./settings.ts`, `expandHomePath` from `./pathExpansion.ts`, and `HostProcess` from `./HostProcess.ts`. |
| provider-instance | `provider-instance/src/CodexHomeLayout.ts` | `apps/server/src/provider/Drivers/CodexHomeLayout.ts` | none in original | Import lines only: `ProviderDriverKind` now comes from `./providerInstance.ts`, `CodexSettings` from `./settings.ts`, `expandHomePath` from `./pathExpansion.ts`, and `HostProcess` from `./HostProcess.ts`. |
| provider-instance | `provider-instance/src/CodexManagedHome.ts` | `apps/server/src/provider/CodexManagedHome.ts` | none in original | Import lines only: `ProviderInstanceId` now comes from `./providerInstance.ts`, `CodexSettings` from `./settings.ts`, and the layout from `./CodexHomeLayout.ts`. |
| provider-instance | `provider-instance/src/HostProcess.ts` | `packages/shared/src/HostProcess.ts` | none in original | Written for Shepherd from the T3 Code file. It keeps only `Platform`, `HomeDirectory` and `isWindows`. The context keys are `@shepherd/t3-host-process/Platform` and `@shepherd/t3-host-process/HomeDirectory`, shared with the copy in `provider-testing`, so that no `@t3tools` name remains. |
| provider-instance | `provider-instance/src/instanceEnvironment.ts` | `packages/provider-core/src/server/instanceEnvironment.ts` | none in original | Import lines only: `ProviderInstanceEnvironment` now comes from `./providerInstance.ts` and `HostProcess` from `./HostProcess.ts`. |
| provider-instance | `provider-instance/src/pathExpansion.ts` | `packages/provider-core/src/server/pathExpansion.ts` | none in original | Copied exactly. |
| provider-instance | `provider-instance/src/providerInstance.ts` | `packages/contracts/src/providerInstance.ts` | none in original | Copied exactly. |
| provider-instance | `provider-instance/src/secretReference.ts` | `packages/contracts/src/secretReference.ts` | none in original | Copied exactly. |
| provider-instance | `provider-instance/src/settings.ts` | `packages/contracts/src/settings.ts` | none in original | Written for Shepherd. It holds small local types `CodexSettings` and `ClaudeSettings` with only the fields the copied code reads, in place of T3 Code's large settings-form schemas. |
| provider-instance | `provider-instance/test/CodexHomeLayout.test.ts` | `apps/server/src/provider/Drivers/CodexHomeLayout.test.ts` | none in original | Imports now point at `../src/CodexHomeLayout.ts`, `../src/settings.ts` and `./symlinks.ts`, because the test moved to `test/`. The `CodexSettings` schema decode became a small function that returns the local `CodexSettings` type with empty strings for missing fields. |
| provider-instance | `provider-instance/test/symlinks.ts` | `packages/shared/src/testing/symlinks.ts` | none in original | The temporary folder prefix changed from `t3-symlink-probe-` to `shepherd-symlink-probe-`. Nothing else changed. |
| provider-testing | `provider-testing/src/baseSchemas.ts` | `packages/contracts/src/baseSchemas.ts` | none in original | Excerpt: lines 1, 3, 5-29 and 31 (`TrimmedString`, `isNonBlank`, `TrimmedNonEmptyString`, `NonNegativeInt`). |
| provider-testing | `provider-testing/src/fakeCli.ts` | `packages/provider-testing/src/fakeCli.ts` | none in original | Import line only: `HostProcess` now comes from `./HostProcess.ts`. |
| provider-testing | `provider-testing/src/HostProcess.ts` | `packages/shared/src/HostProcess.ts` | none in original | Written for Shepherd from the T3 Code file. It keeps only `Platform`, with the same context key as the copy in `provider-instance`. |
| provider-testing | `provider-testing/src/replaySchemas.ts` | `packages/contracts/src/orchestrationV2.ts` | none in original | Excerpt: lines 4176-4220, the replay transcript schemas, under a new import header (`effect/Schema` and `./baseSchemas.ts`). |
| provider-testing | `provider-testing/src/replayTranscript.ts` | `packages/provider-testing/src/replayTranscript.ts` | none in original | Import line only: the schemas now come from `./replaySchemas.ts` instead of `@t3tools/contracts`. |
| provider-testing | `provider-testing/test/fixtures/greeting.ndjson` | none, written for Shepherd | none in original | Written for Shepherd. A three-line replay transcript used by the test below. |
| provider-testing | `provider-testing/test/replayTranscript.test.ts` | none, written for Shepherd | none in original | Written for Shepherd, because T3 Code has no unit test for these helpers. It covers decoding, fallback metadata, the four error cases, workspace placeholder replacement and reading a file URL. |
| source-control | `source-control/src/mergeMessage.ts` | `packages/source-control-core/src/server/mergeMessage.ts` | none in original | Copied exactly. Moved from `mergeMessage.ts` at the top of this folder. |
| source-control | `source-control/src/mergeMessage.test.ts` | `packages/source-control-core/src/server/mergeMessage.test.ts` | none in original | The test runner import changed from `vite-plus/test` to `vitest`. Its assertions are unchanged. Moved from `mergeMessage.test.ts` at the top of this folder. |

## What the code does

`removeAgentCredits(message)` removes the lines that credit a coding agent
from a commit message. It powers T3 Code's setting **Remove agent credits when
merging**.

It removes two kinds of line:

- A `Co-authored-by:` trailer whose email address belongs to a known agent:
  Claude (`noreply@anthropic.com`, `claude@anthropic.com`), Codex
  (`noreply@openai.com`, `codex@openai.com`), Cursor
  (`cursoragent@cursor.com`), and GitHub Copilot (`copilot@github.com`, or
  `noreply@github.com` only when the name is Copilot, because people use that
  address too).
- A footer such as "🤖 Generated with [Claude Code](https://claude.com/claude-code)"
  or "Generated by Codex", for Claude Code, Codex, Cursor, Copilot, OpenCode,
  Grok, and Antigravity.

It keeps everything else. Human co-authors stay credited. Lines inside code
fences, indented code, and block quotes are left alone, so an example of a
trailer in a commit message survives. Windows line endings are kept. If
nothing was removed, the message is returned unchanged.

## How T3 Code uses it

In T3 Code the setting is off by default, and each project can override it.
It applies only to the message of the merge commit or squash commit that T3
Code creates when it merges a pull request on GitHub, including auto-merge.
It does not rewrite the original commits, so a plain merge or a rebase keeps
their agent credits.

How Shepherd uses it is described in
[docs/features.md](../../docs/features.md), section 6.
