# Round 2: security threat model of plan-v2

Reviewer lens: security threat model, round 2, isolated context.
Target: `attack/plan-v2.md`, with `decisions.md` appended verbatim. Scope: the
round-1 patches (decision rows 20 to 48, and the criteria and tasks they
produced), their consequences, and the mechanisms that round 1 marked
"UNREVIEWED MECHANISM". Context read: the engine spec, including its final
section "Changes after the plan review", `SECURITY.md`, `AGENTS.md`,
`attack/round-1-findings.md`, `attack/round-1-security.md` and
`attack/known-gaps.md`. The eight known gaps are not re-reported. Decision 47
is judged only on whether its written assumption and hardening are stated
honestly.

Line numbers refer to `attack/plan-v2.md` unless another file is named.
"Row N" means decision row N. Acronyms used: ACP (Agent Client Protocol), MCP
(Model Context Protocol), RPC (remote procedure call), TOCTOU (time of check
to time of use).

## Verdict

**REVISE.**

The top finding is that the shared client fails open to the owner's identity.
Task 7b.1 (line 546) says the client reads `LGTM_SOCKET` and
`LGTM_TOKEN`, "or the owner credential file". An agent's shell command
that runs `lgtm` without `LGTM_TOKEN` therefore acts as the owner,
with no error. This defeats the permission ceiling through an ordinary
mistake, which is exactly the case decision 47 says the ceiling still covers.
The same task also sends whichever credential it picked to whatever socket
`LGTM_SOCKET` names, without checking who owns that socket.

The patches are otherwise sound in direction. The Unix socket in a 0700
folder removes the browser and other-user attack surface of round 1, and the
token rotation, allow-listed environment and folder ceiling close the main
round-1 gaps. But each of those patches left a specific hole, listed below,
and two SECURITY.md binding rules (rule 6, secrets never reach logs, and
rule 7, agent text is data) are weaker in practice than the plan claims. No
finding needs the design rethought; each fix is a local decision plus a
test.

## Findings

### 1. BLOCKER: the client falls back to the owner credential, and trusts any socket path (Security, access)

**Evidence:** task 7b.1, line 546 ("reading `LGTM_SOCKET` and
`LGTM_TOKEN`, or the owner credential file"); row 33, line 774 (`HOME` is
kept, so the default state path resolves inside an agent's shell); row 47,
line 788 (the ceiling is claimed to stop mistakes); row 37, line 778 (only the
service checks the folder).

Agents reach LGTM Studio through the command-line tool as well as through MCP,
so the agent's shell needs the token. Any shell where the token is missing
makes the client read the owner credential from the default folder and act
as the owner. Ways the token goes missing in ordinary use include a harness
or owner setting that strips variables whose names contain `TOKEN` (Codex's
`shell_environment_policy` with `ignore_default_excludes = false` does this),
a subshell started with `env -i`, and a tool runner that rebuilds the
environment. The agent then starts full-access agents or changes harness
commands, and the log records the owner as the caller.

Separately, the client sends its credential to the socket that
`LGTM_SOCKET` names. If that variable points at another user's socket
(set by a cloned repository's `.envrc`, or left over in a shell), the owner
credential or an agent token goes to that user.

**Fix:**

- Use the owner credential only when `LGTM_SOCKET` and `LGTM_TOKEN`
  are both unset. When either is set and the other is missing, refuse with an
  error.
- Send the owner credential only to `engine.sock` in the folder that holds
  the credential file, never to a path taken from the environment.
- Before sending any credential, check with `lstat` that the socket's folder
  is not a symlink, is owned by the current user, is mode 0700, and that
  every ancestor folder is owned by root or the user and is not writable by
  group or others (sticky folders such as `/tmp` excepted). Do the same check
  in the service at start.
- Add tests to `packages/client/test/`: token unset with socket set is
  refused; a socket in a folder owned by another user, or reached through a
  symlink, is refused before any byte is sent.

### 2. MAJOR: decision 47's hardening and its SECURITY.md statement have no task, criterion or check (Security, access; honesty of a written assumption)

**Evidence:** row 47, line 788 ("this is written in SECURITY.md"; "The cheap
hardening is added regardless ... tested per harness"); overview item 3,
lines 67-72; `SECURITY.md` lines 22-27, which say nothing about agents
reading the state folder or the owner credential; row 46, line 787, gives no
scope the right to edit `SECURITY.md`; no criterion in WS-5, WS-6 or WS-7 and
no post-build check mentions a deny rule.

The row states, in the present tense, that the assumption is written in
`SECURITY.md`. It is not, and no unit is assigned to write it. The row also
promises per-harness deny rules "tested per harness", but no task builds them
and no criterion observes them. The plan also does not say where a deny rule
would be written. Claude Code's `permissions.deny` lives either in the
account's settings under `CLAUDE_CONFIG_DIR`, which may be the owner's own
everyday Claude settings, or in the project's `.claude/` folder, which the
agent can edit. A `Read(...)` rule also covers only the harness's file tools
unless the harness applies it to shell commands such as `cat`.

**Fix:**

- Add a task, in a named scope, that writes the decision 47 assumption into
  `SECURITY.md` under "What LGTM Studio protects, and what it does not".
- Add a task and a criterion for the deny rules: where each harness's rule is
  written, whether it covers shell reads, and a test in which a fake or
  recorded agent's read of the state folder is refused.
- Record, per harness, that Codex and Gemini CLI have no such rule, so the
  owner sees the residual risk when ruling.
- Until both tasks exist, change row 47's wording from "is written" and "is
  added" to "will be written" and "will be added".

### 3. MAJOR: an interrupted agent that cannot be reloaded keeps a valid token forever (Security, access and secrets)

**Evidence:** row 32, line 773 (revocation happens on spawn, stop and crash
only); row 31, line 772, step 5 (mark running agents interrupted) and step 6
(only reloaded agents get new tokens); criterion 6.7, line 480
("non-reloadable agents stay interrupted"); post-build check PB-A7, line 616,
covers only reloaded agents.

After a restart, an agent whose harness cannot reload its session stays
interrupted. Nothing revokes its token. When the socket opens at step 9, any
process still holding that token can act as the agent, with the agent's
rights over its children. Such processes include a background job that left
the process group (`setsid`, a `tmux` or Herdr pane, a container) and so
survived the sweep at step 4, and any file into which the agent wrote its
environment. The token stays valid until someone resumes or stops the agent.

Separately, criterion 7.2 tests that revocation closes open connections, but
nothing states that each command re-checks the caller's token inside the
writer transaction. A command already in flight when a stop is written can
therefore still be accepted.

**Fix:**

- At step 5, revoke every running agent's token in the same transaction that
  marks it interrupted. Mint new tokens only at step 6.
- Check the caller's token row (not revoked) inside the single-writer
  transaction for every command, and refuse otherwise.
- Extend criterion 6.7: after a restart, a non-reloadable agent's old token
  is refused. Extend criterion 7.2: a command sent on a connection while its
  token is being revoked is refused.

### 4. MAJOR: the folder ceiling has a time-of-check gap, admits the live plugin checkout, and runs `git` from `PATH` (Security, access)

**Evidence:** row 35(a), line 776; task 5a.2, line 443 ("folder containment
by `realpath` or same git common directory"); row 39, line 780 (absolute
paths, because `PATH` lookups "let a changed checkout change what the engine
runs"); round-1 security finding 2's fix, which refused the state folder, the
plugin root and `$HOME` for agents, was not carried into row 35.

There are four gaps.

- **Time of check to time of use.** The plan does not say that the spawn's
  working folder and the `session/new` `cwd` are the resolved path. If either
  uses the requested path, a symlink swapped after the check moves the child
  anywhere. The check also does not run again on `resume` or reload, when a
  stored folder may since have been replaced by a symlink.
- **The worktree rule admits the main checkout.** Every worktree of a
  repository shares its common directory with the main checkout. While
  LGTM Studio is developed with LGTM Studio, the main checkout is the linked plugin
  root, so any worker in a worktree can start a child that edits the running
  engine's source. This is a consequence of row 35(a) itself, not only of the
  decision 47 ruling.
- **No refused folders.** A parent working in `$HOME` can place a child in
  the state folder or the plugin root.
- **The engine runs `git`.** Computing the common directory by running `git`
  resolves `git` through the engine's `PATH`, which may include folders an
  edit-mode agent can write, such as `~/.local/bin`. A planted `git` then
  runs inside the engine, outside every harness sandbox, and can also return
  any directory it likes.

**Fix:**

- Store the `realpath` at `start`, spawn and open the session with that
  resolved path, and re-resolve and re-check it on every `resume` and reload.
- Compute the common directory without running `git`: read the folder's
  `.git` file and its `commondir` file, and compare their `realpath`s. If
  `git` must run, use an absolute path resolved at install time.
- Refuse, for agent callers, a folder that is or contains the state folder,
  the plugin root or `$HOME` itself.
- Add each case to criterion 5.3's authorization table, including a symlink
  swapped between `start` and `resume`.

### 5. MAJOR: widening that the adapter never reports as a mode change escapes the ceiling (Security, access)

**Evidence:** row 35(b) and (c), line 776 ("allow always" raises "the asker";
only mode changes "reported by the adapter" are checked); criterion 6.13,
line 486; post-build check SEC-PB-3, line 619 (maps option kinds, not their
scope).

Two kinds of widening are invisible to the checks.

- **Persistent "allow always" answers.** In Claude Code, an "always allow"
  answer can be saved as a rule in the project's `.claude/settings.local.json`
  rather than only for the session. That rule then applies to every later
  agent started in that folder, including read-only siblings whose ceiling is
  lower. Row 35(b) only raises the asker.
- **Harness settings files.** An agent at edit level, or a permission answer
  at edit level, can write a harness's settings: `permissions.allow` or
  `defaultMode` in `CLAUDE_CONFIG_DIR/settings.json`, which every agent on
  that account reads, or the project's `.claude/`, `.codex/`, `.gemini/` or
  `.cursor/` files. No mode change is reported, so criterion 6.13 never
  fires.

**Fix:**

- Classify each option's scope (once, session, persisted) in SEC-PB-3. Treat
  a persisted option as owner-only: route the request to the owner.
- Route any permission request whose target path is a harness settings file
  (the account's home settings and the project-level harness folders) to the
  owner, and add those paths to row 47's deny rules.
- Where the adapter allows it, start sessions with project and local
  settings sources turned off, so files written by agents are not loaded.
  Record per harness whether this is possible.
- State in row 35 that the ceiling covers only widening visible through ACP
  and these paths.

### 6. MAJOR: the redactor misses split, encoded and structured secrets, and cannot hold device credentials (Security, secrets; SECURITY.md rule 6)

**Evidence:** row 36, line 777 ("a redactor that holds every live secret
value (agent tokens, device credentials, account secrets)"); task 4a.2,
line 398 ("text passed through the redactor"); task 5a.3, line 444;
criterion 5.1, line 427 (only a plainly printed token is tested); round-1
security finding 5's fix asked for "raw and common encoded forms", which row
36 dropped.

- **Split across chunks.** ACP streams text and tool output in chunks. If
  each chunk is redacted on its own, a token that crosses a chunk boundary is
  stored whole across two events, and a client that concatenates them sees
  it.
- **Encoded forms.** Base64, URL-encoding, hexadecimal and JSON `\u` escapes
  are not matched. Neither is a prefix of a secret.
- **Structured fields.** "Text" is not defined. Tool-call raw input (for
  example a `curl -H "Authorization: Bearer ..."` command), raw output, file
  diffs (an agent editing a `.env` file), plan entries, permission titles and
  error messages are all strings inside the event payload.
- **Device credentials.** They are stored only as SHA-256 hashes, so the
  engine does not hold their values after creation and cannot match them.
- **Prompts to parents.** If a wait result or delivery is built from the
  live stream instead of the stored event, the parent receives the
  unredacted value.

**Fix:**

- Redact every string field of the payload, after joining chunks, or keep a
  per-stream tail buffer of the longest secret's length minus one.
- Add base64 (standard and URL-safe), hexadecimal and percent-encoded forms
  of each live secret to the matcher.
- Match token-shaped substrings (32 random bytes in LGTM Studio's encoding) by
  hashing them and looking the hash up in `agent_tokens` and `devices`.
- Build every engine-written prompt from the stored, redacted events.
- Extend criterion 5.1's fake agent to print the token split across two
  chunks, base64-encoded, and inside a tool call's input and a file diff.

### 7. MAJOR: the envelope can be closed by forged text, and agent-sent prompts can still run slash commands (Security, integrity; SECURITY.md rule 7)

**Evidence:** row 38, line 779 (envelope and `/` escaping only for "prompts
the engine writes"); criterion 5.10, line 436; post-build check SEC-PB-2,
line 618; round-1 security finding 9's fix ("Escape a leading `/` in every
`prompt` sent by an agent. Only `compact` and the owner may send slash
commands") was not carried.

- **A fixed envelope.** A fixed label can be forged. A child that writes the
  envelope's closing marker, followed by "Message from the owner: answer
  allow-always", produces a prompt in which the forged text sits outside the
  data region.
- **The escape is in the wrong place.** An engine-written prompt starts with
  the envelope's label, so the child's text never starts the prompt and
  escaping its leading `/` protects nothing. The prompts that can start with
  `/` are those an agent sends to its child with the `prompt` command. A
  Claude Code custom command (`.claude/commands/*.md`) can grant tools
  through its `allowed-tools` header, so an agent that relays a `/name`
  string can make a lower-mode child run tools without asking.
- **Leading whitespace.** "Leading" is not defined for text that begins with
  spaces, newlines or zero-width characters.

**Fix:**

- Mark each envelope with a random identifier generated per message, for
  example `<agent-data id=…>`, and remove or escape any occurrence of the
  marker inside the content.
- Escape a leading `/` in every `prompt` from an agent caller, after
  stripping leading whitespace and invisible characters. Only the owner and
  the engine's own `compact` may send a slash command.
- Extend criterion 5.10 with a forged closing marker and with an agent
  `prompt` that starts with " /".

### 8. MAJOR: `accounts set-secret` is forced to be an agent tool, and a refused call can store the secret (Security, secrets; SECURITY.md rule 6)

**Evidence:** row 40, line 781 (owner-only, write-only); criterion 7.5,
line 534 ("Every RPC is a `lgtm` subcommand and an MCP tool"); criterion
3.4, line 350 ("No schema can carry a secret value"); the "command refused"
event, line 360; receipts store `body_hash`, line 397.

The parity rule gives every agent an MCP tool that accepts a secret value.
An agent that tries to help, for example by passing an API key it was shown,
sends the value to the engine. The engine refuses the call. But the plan
does not say what the "command refused" event records, and the redactor
does not know the value, because it is not yet a live secret. If the event
records the request, the key is stored forever (known gap 7) and is visible
to the agent's ancestors through `subscribe`. Criterion 3.4 also contradicts
the request schema itself, so the builder must create an exemption that
nothing bounds.

**Fix:**

- Exempt `accounts set-secret` from criterion 7.5's MCP half. No agent tool
  accepts a secret.
- State that "command refused" events record the command name and the
  reason only, never the request body.
- Compute receipts for `set-secret` over the account id only, not the value.
- Bound criterion 3.4's exemption to that one request field, and add a test:
  a refused `set-secret` from an agent leaves the value in no table, event or
  reply.

### 9. MAJOR: the service's own log output is outside the redactor and has no stated destination (Security, secrets; SECURITY.md rule 6)

**Evidence:** row 36 and task 4a.2, line 398 (the redactor sits inside
`append` only); criterion 6.6, line 479 (only crash lines are scrubbed); task
7a.3, line 545 (`serve --detach` does not say where output goes); copied
`effect-acp` `src/protocol.ts` lines 503, 547 and 599 log handler failures
and decode failures with annotations that can carry payload fragments, and
lines 263-272 log every protocol message at debug level when
`logIncoming` or `logOutgoing` is on. The outgoing `session/new` message
carries the agent token in the `mcpServers` environment.

SECURITY.md rule 6 names logs explicitly. The plan has no control and no
test for the engine's own log output.

**Fix:**

- Route the service's logger through the redactor.
- Keep `logIncoming` and `logOutgoing` off outside tests.
- Write the `--detach` output to a 0600 file in the state folder.
- Add a test that greps the service's standard output, standard error and
  log file for the token and an account key after criterion 5.1's scenario.

### 10. MINOR: the environment rules disagree on `LGTM_*` and on where the token goes (Security, secrets)

**Evidence:** row 33, line 774 ("plus ... `LGTM_*`"); criterion 6.1,
line 474 (exactly `LGTM_SOCKET` and `LGTM_TOKEN`, in the adapter's
own environment); row 21, line 762 (both "in the `mcpServers` environment");
post-build check PB-A4, line 613 (expects no token in the adapter's session
files).

A wildcard copy of the engine's own `LGTM_*` passes `LGTM_HOME`,
`LGTM_NODE` and any stray `LGTM_TOKEN` from the environment that
started the service. That environment may be an agent's shell, if an agent
restarted the service after a crash. Placing the token in the adapter's
environment, which the agent's shell needs, means that an agent that prints
its environment writes the token into its harness's own transcript. That
contradicts PB-A4's expected result.

**Fix:**

- Name exactly the two runner-set variables in row 33.
- Delete `LGTM_TOKEN` from the service's own environment at start.
- Amend row 21 to say that the token is in the adapter's environment on
  purpose.
- Restate PB-A4 as "not found unless the agent printed it, and revoked
  either way".

### 11. MINOR: row 15 still specifies a loopback HTTP fallback for MCP (Security, access; SECURITY.md rule 1)

**Evidence:** row 15, line 756 ("fall back to an HTTP MCP endpoint on the
loopback address"); task 7b.3, line 548 (fallback over the Unix socket);
criterion 7.1, line 530 (no TCP listener); row 21, line 762 (Origin and Host
checks deferred to piece 2).

Rows 21 and 48 did not amend row 15. The harnesses' MCP clients may also be
unable to reach an HTTP MCP server on a Unix socket. Either way, a builder
is pushed toward a TCP listener in piece 1, without the Origin and Host
checks and connection limits that were deferred to piece 2. Criterion 7.1
would catch it, but only after the work was built.

**Fix:**

- Amend row 15 to match task 7b.3.
- State that if neither stdio nor the socket works for a harness, the build
  stops and the owner decides. A TCP listener is never added silently.

### 12. MINOR: the lifetime lock can be taken by two instances if it is only opened (Security, integrity)

**Evidence:** row 31, line 772, step 1 ("opened with
`locking_mode=EXCLUSIVE` and held"); task 7a.3, line 545; step 4 sweeps
recorded process groups that match.

In SQLite, `PRAGMA locking_mode=EXCLUSIVE` takes no lock until the
connection's first read or write. A literal implementation lets a second
instance start. That second instance then passes step 4's checks against
the first instance's live adapters, because their boot id, user, start time
and program all match, and kills them. It also writes the same database
beside the first instance's single writer, which breaks the receipt and
ordering guarantees.

**Fix:**

- State that the lock is acquired by running `BEGIN EXCLUSIVE` (or a write)
  right after the pragma, and that the connection stays open for the
  service's lifetime.
- State that `serve --detach` checks the lock without taking it, so it
  cannot race the service it starts.
- In criterion 7.4, start two real service processes.

## Answers to the attack questions

1. **Unix socket and Bearer on upgrade.** It holds against browsers and
   other users while the folder is correct. It fails at the client, which
   does not check the socket's owner, honours an environment-supplied path
   and falls back to the owner credential (finding 1). No ancestor or
   `lstat` check is specified (finding 1). Criterion 7.1's "every file 0600"
   contradicts the socket's own mode under umask 077 (0700); macOS ignores
   socket modes, so the folder is the only control there. Stale sockets are
   safe once the lock is real (finding 12).
2. **Agent tokens.** Rotation on reload and revocation on crash hold.
   Interrupted, non-reloadable agents keep valid tokens, and commands are not
   re-checked against revocation inside the transaction (finding 3). The
   token reaches the harness transcript whenever the agent prints its
   environment (finding 10), and the service log has no redaction (finding
   9). It does not reach process arguments (criterion 7.8 holds).
3. **Environment allow-list.** The list is `PATH`, `HOME`, `USER`, `LOGNAME`,
   `SHELL`, `LANG`, `LC_*`, `TERM`, `TMPDIR`, `TZ`, plus the account's
   variables and `LGTM_*`. `NODE_OPTIONS` is correctly absent. The
   `LGTM_*` wildcard leaks the starter's variables (finding 10). `PATH`
   is harmless to adapters, which use absolute paths, but becomes a sandbox
   escape once the engine runs `git` from it (finding 4). `HOME` enables the
   owner-credential fallback (finding 1).
4. **The permission ceiling.** It can be escaped through a symlink swapped
   between the check and the spawn or `resume`, through the worktree rule
   reaching the live plugin checkout, through a missing deny-list (finding
   4), and through persisted "allow always" rules and harness settings
   files that are never reported as mode changes (finding 5).
5. **The redactor inside `append`.** It misses secrets split across chunks,
   encoded secrets, secrets in tool-call input, output and diffs, and every
   device credential (finding 6).
6. **The envelope and `/` escaping.** A fixed envelope can be closed by
   forged text. The `/` escape is applied where it cannot matter, and not
   to agent `prompt` commands, where it can (finding 7).
7. **`debug.compare-views` and `accounts set-secret`.** `debug.compare-views`
   is owner-only (row 43, covered by criterion 5.3's table) and shows only
   what the owner already sees, so it holds. `accounts set-secret` becomes
   an agent tool through criterion 7.5, and a refused call can store the
   secret (finding 8).
8. **SECURITY.md binding rules.** Rule 1 is met more strongly by the socket,
   but row 15 still names a loopback HTTP fallback (finding 11), and the
   rule's text still says "loopback". Rule 2 holds in form, but the client
   fallback authenticates agents' requests as the owner (finding 1). Rule 4
   holds. Rule 6 is weakened by the redactor's gaps (finding 6), the
   service log (finding 9) and `set-secret` (finding 8). Rule 7 is weakened
   by the envelope and the slash commands (finding 7). Rules 3 and 5 belong
   to piece 2.

## Unreviewed mechanisms from round 1

- **The lifetime lock (row 31).** It is unsafe as worded (finding 12).
- **The Unix socket endpoint (rows 21, 48).** It is sound at the server and
  unsafe at the client (finding 1).
- **"Settled" as the wait condition (row 25).** No security consequence was
  found. It belongs to the logic lens.
- **Three-step deliveries (row 29).** No security consequence beyond the
  logic lens. A re-sent delivery could repeat an instruction that the
  adapter accepted just before a crash. That is an integrity question for
  the logic lens.
- **Rights passing up (row 27).** No escalation was found. An ancestor can
  answer only within its own mode, as row 35(b) requires.
- **The folder rule for children (row 35a).** See finding 4.
- **The "account available" timer (row 28).** No security consequence was
  found, provided the reset time is read from adapter errors and never from
  thread text. Criterion 6.9 should assert that.
- **`debug.compare-views` (row 43).** It holds (question 7).

## Post-build checks proposed

- **SEC-PB-4.** After an "always allow" answer on real `claude-agent-acp`
  0.99.1, inspect `.claude/settings.local.json` in the agent's folder and
  record each option's scope (finding 5).
- **SEC-PB-5.** On each real harness, run a shell command with
  `LGTM_TOKEN` removed and confirm that `lgtm` refuses to run
  instead of acting as the owner (finding 1).

## Noted, not filed

- After the engine stops, a same-user agent could bind `engine.sock` and
  collect credentials from clients that connect. This is the hostile-agent
  case that row 47 leaves to the owner.
- An agent can start a second engine under another `LGTM_HOME` and
  become its owner. This is also the row 47 case.
