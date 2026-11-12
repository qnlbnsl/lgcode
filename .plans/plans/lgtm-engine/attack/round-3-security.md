# Round 3: security threat model of plan-v3

Reviewer lens: security threat model, round 3 (the final round), isolated
context. Target: `attack/plan-v3.md`, with `decisions.md` appended verbatim.
Scope: only the round-2 patches, decision rows 52, 54, 55, 56, 57, 58, 61 and
62, and criteria 5.1, 5.10-5.12, 6.1, 6.14, 7.1, 7.5 and 7.8-7.12. Context
read: the engine spec's final section "Changes after the plan review",
`SECURITY.md`, `AGENTS.md`, `attack/round-2-findings.md`,
`attack/round-2-security.md` and `attack/known-gaps.md`. The known gaps are
not re-reported. Row 47 (agents can read the state folder; the rules stop
mistakes, not a hostile agent) is the owner's ruling and is not re-opened.
Every finding below is a case an agent reaches by an ordinary mistake, or a
case involving another local user, not a deliberately hostile agent.

Line numbers refer to `attack/plan-v3.md`. "Row N" means decision row N.
Acronyms: ACP (Agent Client Protocol), MCP (Model Context Protocol), RPC
(remote procedure call), TOCTOU (time of check to time of use).

## Verdict

**REVISE.**

The top finding is that round 2's BLOCKER is only half closed. Row 54
(line 906) and criterion 7.9 (line 623) still make the owner credential the
default whenever both LGTM Studio variables are absent. The half-stripped case
is now refused, but the fully stripped case is the more common one: a shell
started with `env -i`, a Codex agent whose `shell_environment_policy` uses
`inherit = "core"` or `"none"`, or any tool runner that rebuilds the
environment from its own allow-list. In each of these, an agent's `lgtm`
command silently acts as the owner. The client picks the most powerful
identity by the absence of a signal, so it still fails open.

The other patches are sound in direction. Four leave a gap that needs a
decision before the build; the rest need one sentence and a test case each.

## Findings

### 1. BLOCKER: with both variables stripped, an agent's command still runs as the owner (Security, access)

**Evidence:** row 54, line 906 ("the owner credential only when both
`LGTM_SOCKET` and `LGTM_TOKEN` are unset"); criterion 7.9, line 623;
post-build check SEC-PB-5, line 717, removes only `LGTM_TOKEN`; round-2
security finding 1 named `env -i` and environment-rebuilding tool runners as
ordinary causes.

The fix closes only the case in which one variable survives. When an agent's
shell loses both, which is what `env -i`, Codex's `inherit = "core"` and
`inherit = "none"` policies, `systemd-run --user`, cron and most sandbox
wrappers do, the client reads the owner credential from the default state
folder and acts as the owner. The agent can then start full-access children
in any folder and answer any permission request, and the log names the owner
as the caller. Node's `os.homedir()` falls back to the password database when
`HOME` is unset, so even `env -i` finds the default folder.

**Fix:**

- Make the owner identity an explicit opt-in that the environment cannot
  supply by inheritance, for example a `--owner` flag (Herdr actions pass
  it), and refuse every command that has neither a token nor the flag.
- When the flag is given, have the client walk its parent processes and
  refuse if any ancestor is a recorded adapter process (pid and start time
  from the `processes` table), so an agent that copies the flag is still
  stopped by mistake.
- Extend criterion 7.9 and SEC-PB-5: with both variables removed, and with
  `env -i`, `lgtm` refuses.

### 2. MAJOR: `lgtm mcp` can inherit the client's owner fallback (Security, access)

**Evidence:** criterion 7.8, line 622 ("gets its token from the environment
only, never from its arguments"); task 7b.1, line 635 (the identity rule lives
in the shared client); task 7b.3, line 637; row 55, line 907 (the tool list
excludes owner-only commands, but the caller's identity decides authority).

Criterion 7.8 contrasts the environment with the arguments, not with the
owner credential file. A builder who reuses the shared client in `lgtm
mcp` gets row 54's fallback. If an adapter launches its MCP server without
the `env` given in `session/new` (Codex starts MCP servers with a minimal
default environment plus the configured `env`, and an adapter that drops that
field leaves neither variable), every tool call from that agent runs as the
owner. Excluding owner-only tools does not help: `start` and permission
answers made with the owner identity bypass the ceiling entirely.

**Fix:** state in row 55 and criterion 7.8 that `lgtm mcp` never uses the
owner credential, and that it exits with an error, before connecting, when
`LGTM_TOKEN` is absent. Add that case to `token-source.test.ts`.

### 3. MAJOR: the refused folders are compared by name, with no "inside" or "contains" rule (Security, access and integrity)

**Evidence:** row 56, line 908 ("may not use the owner's home folder itself,
the state folder, or LGTM Studio's own plugin root"); criterion 5.12, line 503
("a child in `$HOME`, the state folder or the plugin root is refused");
round-2 finding 4's fix said "is or contains"; task 6a.1, line 578, sets the
spawn's `cwd` only; recovery step 7 in row 52, line 904, reloads with no
re-check.

Five gaps remain.

- **Inside and containing folders.** As written, a child in
  `<plugin root>/packages/engine` is allowed and edits the running engine's
  source, and a child in `~/.local/state` contains the state folder and gets
  its harness's write sandbox over the event log. "Itself" is right only for
  `$HOME`.
- **Symlinked roots.** The plugin root is normally reached through Herdr's
  link, so `HERDR_PLUGIN_ROOT` may be a symlink path. If the refused set is
  not resolved with `realpath`, it never equals the child's resolved path.
  The plan also does not say where the engine learns the plugin root; a
  service restarted from an agent's shell has no `HERDR_*` variables.
- **Bind mounts and case-insensitive macOS paths.** A string comparison of
  real paths misses a bind mount of the state folder and a differently cased
  path on a case-insensitive APFS volume. Comparing device and inode numbers
  of the child folder and each of its ancestors catches both.
- **Reload.** Recovery step 7 reloads every agent at its stored path with no
  re-check, and a spawn's `cwd` is resolved again by the kernel, so a folder
  replaced by a symlink while the service was down moves the reloaded agent.
- **Session folder.** Only the spawn's `cwd` is the resolved path. The
  `session/new` `cwd`, which is the harness's sandbox root, is not stated.

**Fix:** refuse, for agent-started children, a resolved folder that equals,
is inside, or contains the state folder or the plugin root, or that equals or
contains `$HOME`. Compare by device and inode along the ancestor chain, not
by string. Derive the plugin root from the engine's own script path, resolved
with `realpath` at start. Re-check at every spawn, including recovery reloads,
and pass the resolved path as the `session/new` `cwd`. Add each case to
criterion 5.12, including a symlinked plugin root and a subfolder of it.

### 4. MAJOR: a settings-file write is routed to the owner only when the harness asks (Security, access)

**Evidence:** row 56, line 908 ("requests to write a harness settings file
... are routed to the owner"); round-2 finding 5's fix bullets 3 and 4
(start sessions with project and local settings sources off where possible;
state that the ceiling covers only widening visible through ACP), neither
folded; row 61, line 913, adds a launch-time deny rule for reads only.

In edit mode, harnesses write files inside the workspace without asking, and
a shell command such as `sed -i` names no structured path at all. So the
usual way an agent "helpfully" adds `permissions.allow` or `defaultMode` to
`.claude/settings.local.json` produces no permission request, and row 56
never fires. Every later agent started in that folder, including read-only
siblings, loads the widened rules. The list also omits files that widen
tools just as well: `.claude/commands/*.md` (whose `allowed-tools` header
grants tools), `.claude/agents/`, `.mcp.json`, and the account-level
`CLAUDE_CONFIG_DIR/settings.json`.

**Fix:** add the harness settings paths to row 61's launch-time rule as
deny-write rules where the harness supports them. Where an adapter allows it,
start sessions without project and local settings sources, and record per
harness whether it can. Extend the path list as above. State in row 56 and
SECURITY.md that writes the harness does not ask about are outside the
ceiling.

### 5. MINOR: the "recovering" window accepts connections with tokens that step 4 will revoke (Security, access)

**Evidence:** row 52, line 904, step 2 (listen, refuse every RPC with
"recovering") and step 4 (revoke every token); row 48 (credential checked
once, on upgrade; revocation closes connections through an in-memory
signal); criterion 5.1, line 492 (revocation re-checked inside the writer
transaction, which covers commands but not reads or `subscribe`); criterion
7.10, line 624.

Between steps 2 and 4, every pre-restart token is still valid, so a leftover
background process holding one completes the upgrade and keeps an
authenticated connection. Only its RPCs are refused. Step 4 is a bulk update
during recovery; the plan does not say it fires the per-connection
invalidation signal. If it does not, that connection survives into serving
at step 9, where reads and `subscribe` are not re-checked inside a writer
transaction. The upgrade check also runs before step 3's migrations, against
an older schema. Commands stay safe, so the exposure is limited to reads the
token's agent could make anyway.

**Fix:** refuse the upgrade itself (HTTP 503 "recovering") until step 9, so
no connection exists across the revocation, and have `lgtm mcp` retry an
upgrade refusal as it retries "recovering". Check revocation when a read or
`subscribe` starts. Extend criterion 7.10: a pre-restart token's connection
attempt during recovery is refused, and fails after step 9.

### 6. MINOR: the carry-over window is sized to the raw secret, and base64 forms depend on alignment (Security, secrets; SECURITY.md rule 6)

**Evidence:** row 57, line 909 ("a carry-over window as long as the longest
live secret"; "raw, base64, base64url, URL-encoded and hex forms");
criterion 5.11, line 502 (the split case is tested, but not for an encoded
form).

The hex form is twice as long as the raw secret, base64 a third longer, and
percent-encoding up to three times. A window as long as the raw secret lets
an encoded secret that crosses a chunk boundary through. Separately, the
base64 of a secret embedded in a longer value, such as `Basic
base64(user:key)` or a base64 dump of a `.env` file, depends on the secret's
offset modulo 3, so matching only `base64(secret)` misses two of the three
alignments. Hex also has upper- and lower-case forms.

**Fix:** size the window to the longest encoded form minus one. For base64
and base64url, match the stable core of each of the three alignments (drop
the first and last partial characters). Match hex in both cases. Add an
encoded split and an embedded `Basic` header to criterion 5.11.

### 7. MINOR: hashing "token-shaped substrings" has no bounded shape, and short account secrets redact ordinary text (Security, secrets and integrity)

**Evidence:** row 57, line 909 ("hashes token-shaped substrings and matches
them against stored token and device hashes"); row 52 and the risk table
(the redactor runs inside `append`, inside the single writer).

If a token is plain base64url of 32 bytes, every 43-character window of a
long base64 run, such as a minified bundle or an image an agent read, is
token-shaped. Hashing each window and looking it up runs inside the single
writer, so one large tool output stalls every command. Matching only
delimited runs is cheap but misses a token glued to other base64 text. On
the other side, an account secret that is short or common (`true`, a
four-digit PIN) is removed from every string field, including paths and
diffs, which corrupts the stored record.

**Fix:** give tokens and device credentials a fixed, distinctive prefix and
a checksum suffix (for example `shp_a_` and `shp_d_`), and hash only after a
prefix and checksum match. Keep the hash set in memory. Refuse to register an
account secret shorter than 16 characters. Add a large-output case to
criterion 5.11 with a time bound.

### 8. MINOR: `LGTM_TEST_DEBUG=1` is an inheritable variable that turns on a test-only surface in a real service (Security, access)

**Evidence:** row 62, line 914; criterion 7.12, line 626; task 7a.2, line
633; row 57, line 909 ("protocol debug logging stays off outside tests",
with "outside tests" undefined).

A real service inherits the environment of whoever starts it. Known gap 5
makes restarts manual, so the owner or an agent often restarts the service
from a shell inside the LGTM Studio checkout, where a developer's `.envrc` or
an exported test variable can carry the flag. `debug.compare-views` is
owner-only and read-only, so the direct impact is small. The larger risk is
that the same flag becomes the switch for "outside tests" logging, which
would log every protocol message, including `session/new` with the agent
token, behind only the redactor.

**Fix:** enable the debug group only when the flag is set and
`LGTM_HOME` is a `mkdtemp` folder under the system temporary folder, and
write a "debug enabled" event and log line at start. Gate protocol logging by
a separate test-only setting, never by this flag, and assert in criterion
7.11 that it stays off when the flag is on.

### 9. MINOR: the socket check dropped round 2's ancestor rule and leaves a check-then-connect race through symlinked ancestors (Security, access)

**Evidence:** row 54, line 906 (`lstat` of the socket's folder only, and the
socket "owned by the current user"); round-2 finding 1's fix required every
ancestor to be owned by root or the user and not writable by group or
others.

`lstat` checks only the last folder. If the path named by `LGTM_SOCKET`
(set, for example, by a cloned repository's `.envrc`) passes through a folder
that another local user can write, that user can swap an ancestor symlink
between the check and `connect`, and the credential goes to their socket. The
row also does not say that the socket itself is checked with `lstat` and
must be a socket, not a symlink to one.

**Fix:** resolve the path with `realpath`, check every ancestor of the result
(owned by root or the user, not group- or other-writable unless sticky), and
connect to the resolved path. On Linux, open the folder with `O_DIRECTORY |
O_NOFOLLOW`, check it with `fstat`, and connect through
`/proc/self/fd/<n>/engine.sock`. Require `lstat` of the socket to report a
socket owned by the user.

### 10. MINOR: any later open and close of `engine.lock` in the service releases the lifetime lock (Security, integrity)

**Evidence:** row 52, line 904, step 1 ("The kernel releases the lock when
the process dies"); row 37 and criterion 7.1, line 615 (the service checks
every file in the folder at start); task 7a.2, line 633.

On Linux and macOS, SQLite's lock is a POSIX advisory lock, which the kernel
drops when the process closes any descriptor for that file, not only
SQLite's. If the start-up mode check, the no-follow file creation of row 37,
or any later code opens and closes `engine.lock` after step 1, the lock is
silently gone and a second service can start, sweep the first one's adapters
and write the same database. SQLite's own documentation lists this as a
cause of corruption.

**Fix:** state in row 52 that after step 1 nothing in the process opens
`engine.lock` except the lock connection, that mode checks use `lstat` only,
and that the lock file uses the rollback journal, not WAL. In criterion 7.4,
run the folder check after the lock is taken and then start a second
service.

## Round-2 findings 2 to 12: were they fixed as folded?

- **2 (decision 47's promises).** Fixed by row 61 and criterion 6.14.
  Criterion 6.14 asserts only that the rule is passed to the fake agent. No
  post-build check confirms that a real harness refuses the read, or records
  that a harness's rule covers file tools but not shell commands such as
  `cat`. Add one live-check line per harness.
- **3 (interrupted agents keep tokens).** Fixed by row 52 step 4 and
  criterion 5.1, except for connections made during the recovering window
  (finding 5).
- **4 (ceiling holes).** Partly fixed (finding 3).
- **5 (persistent "allow always", settings files).** Partly fixed (finding 4).
- **6 (redactor gaps).** Fixed in design, with the window and alignment gaps
  in finding 6 and the cost and short-secret gaps in finding 7.
- **7 (envelope, slash commands).** Fixed by row 58 and criterion 5.10. Two
  small gaps: "whitespace" does not say whether zero-width characters and a
  byte-order mark are stripped first, and post-build check SEC-PB-2 (line
  714) still tests child text reaching a parent, the path round 2 showed
  cannot matter, instead of an agent's `prompt` or `start` first prompt
  beginning with `/` reaching a real child. The escape character must also
  be proven not to be trimmed away by each real harness.
- **8 (`set-secret` and MCP parity).** Fixed by row 55 and criterion 7.5,
  apart from the identity question in finding 2.
- **9 (service log).** Mostly fixed by row 57 and criterion 7.11. Round 2's
  third bullet, sending `serve --detach` output to a 0600 file in the state
  folder, was not folded: task 7a.3 (line 634) still does not say where that
  output goes, and criterion 7.11 greps only standard output and standard
  error.
- **10 (`LGTM_*` wildcard).** Fixed by row 57 and criterion 6.1.
- **11 (loopback HTTP fallback).** Fixed by row 63. Task 7b.3 still cites
  row 15 as an anchor; cite rows 21 and 48 instead.
- **12 (lock takes no lock).** Fixed by row 52 step 1, with the descriptor
  pitfall in finding 10.

## Answers to the attack questions

1. **Row 54 and criterion 7.9 against round-2 finding 1.** Not fully closed.
   The fully stripped environment still yields the owner identity (finding
   1), `lgtm mcp` can inherit that fallback (finding 2), and the dropped
   ancestor rule leaves a check-then-connect race for another local user
   (finding 9). A socket inode swap inside the 0700 folder itself needs the
   owner's user, which row 47 accepts.
2. **Round-2 findings 2-12.** Findings 3, 8, 10, 11 and 12 are fixed;
   findings 2, 6, 7 and 9 are fixed with small gaps; findings 4 and 5 are
   partly fixed (findings 3 and 4 above). None of the fixes opens a new
   hole, except that the lock fix depends on the descriptor rule in finding
   10.
3. **The recovering window.** Anyone with a pre-restart credential can
   complete the upgrade; only RPCs are refused. Commands from a revoked
   token are refused after step 4, but a connection made before step 4 may
   survive into serving and read, unless step 4 closes it (finding 5).
4. **`LGTM_TEST_DEBUG=1`.** Yes, an inherited environment can turn it on
   in a real service; the direct impact is small, but the flag must not
   also gate protocol logging (finding 8).
5. **Row 56 under symlinks, bind mounts, macOS case and worktrees.** It does
   not hold as written: the refused set is not resolved, inside and
   containing folders are not covered, and string comparison misses bind
   mounts and case. A worktree whose common directory is in the plugin root
   is correctly allowed, but a subfolder of the plugin root is not refused
   (finding 3).
6. **Row 57's redactor.** Sound in shape. The window must cover encoded
   lengths, base64 needs three alignments (finding 6), and token hashing
   needs a distinctive prefix to bound cost inside the writer and a minimum
   secret length to avoid corrupting text (finding 7).

## Post-build checks proposed

- **SEC-PB-6.** On each real harness, an agent with the deny-read rule runs
  both a file-tool read and a shell `cat` of a file in the state folder.
  Expected: each refusal, or the gap, is recorded per harness in the
  live-check log and in SECURITY.md.
- **SEC-PB-7.** On each real harness, an agent's `prompt` to its child that
  begins with " /compact" and with "\n/compact". Expected: the child runs no
  command; the escape survives the harness's own trimming.
- **SEC-PB-8.** On real Codex with `shell_environment_policy.inherit =
  "core"`, the agent runs `lgtm status`. Expected: refused, not the
  owner.

## Noted, not filed

- A worktree agent can write hooks and `core.fsmonitor` into the shared
  common directory, which then run when the owner uses git in the main
  checkout. That is a deliberate act, within row 47's ruling.
- After the service stops, a same-user process can bind `engine.sock` and
  collect credentials. This is row 47's hostile-agent case.
