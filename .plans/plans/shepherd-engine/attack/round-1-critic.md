# Round 1: plan critic report on plan-v1.md

Verdict: **REVISE.**

Top finding: the plan says every change waits in a worktree until the owner
allows commits, but the Shepherd repository has no commits at all. Every file
in it, including `AGENTS.md`, the spec and `third_party/`, is untracked. A
worktree made from this repository would contain none of those files, and a
unit in one worktree cannot see the uncommitted work of the unit it depends
on. The plan cannot start as written.

Evidence for the top finding, gathered read-only on 2026-11-01:

- `git -C sheprd log` prints "your current branch 'master' does not have any
  commits yet".
- `git -C sheprd status --short` lists `.nvmrc`, `.plans/`, `AGENTS.md`,
  `CLAUDE.md`, `NOTICE`, `README.md`, `SECURITY.md`, `docs/` and
  `third_party/` as untracked.
- `git worktree list` shows only the main checkout at `0000000 [master]`.

## Findings

1. **MAJOR. Design (execution feasibility).** Overview paragraph 5, Rollout
   order last paragraph, decision 17. With zero commits, worktrees hold none
   of the repository's files, and dependent units (2 on 1, 3 on 2, and so on)
   cannot see each other's uncommitted changes. **Fix:** put a concrete choice
   to the owner: (a) one initial commit of the current documents, then one
   commit per unit on a branch, never pushed; or (b) no commits, all units
   built one after another in the main checkout, with no parallel units.
   State what each choice costs.

2. **MAJOR. Design (scope conflicts).** The scope files forbid edits the plan
   assigns. Unit 1 runs in `engine/infra`, whose `read_only` list includes
   `AGENTS.md` and `.plans/**`, and whose `edit` list does not include
   `packages/**`; yet task 1h edits `AGENTS.md` and re-accepts scopes (which
   writes `.plans/scopes/`), and tasks 1d and 1e create files under
   `packages/`. Unit 8c runs in `engine/backend`, but task 8c.1 writes
   `scripts/live-check.ts` and a root `package.json` script, which only
   `engine/infra` may edit. Units 1, 2 and 3 cannot write `docs/issues.md`, so
   `AGENTS.md` rule 3 ("in the same change that finds it") cannot be kept
   there; the guardrail row only says the backend scope may edit it.
   **Fix:** move 1d and 1e to a backend or contracts unit, make 1h and the
   scope re-acceptance a lead or owner step, move 8c.1 to infra, and say who
   records problems found in infra and contracts units.

3. **MAJOR. Bug (evidence ordering).** Criterion 6.2 needs recorded Claude
   Code and Codex sessions, and criterion 6.9 needs error fixtures "captured
   during the live check or from adapter source". The live check is unit 8c,
   the very last step, and it depends on 6a through 8b. No task records the
   first fixtures, and recording spends the owner's usage, which the Overview
   does not list among the things that need the owner. Gemini CLI and Cursor
   are not in the live check at all, and Cursor's agent is not open source,
   so "from adapter source" is not available for it. **Fix:** add an
   owner-run recording step before unit 6a, built on 8a.2, and list it in the
   Overview. For Gemini CLI and Cursor, name the exact source of each fixture
   or mark their classification as unverified until a later live check.

4. **MAJOR. Coverage (failure rules 1 and 5).** The approved spec's crash
   rule says the crashed agent's open permission requests close as
   cancelled, its parent is told, and an agent the owner started produces an
   "owner needed" event. That last part was one of the three gaps fixed when
   the spec was approved. Criterion 6.6 covers only the exit code, the
   redacted error lines, waits waking and no restart. Failure rule 5 also
   says a signed-out account is marked as needing sign-in and the owner is
   told, a paused agent records the reset time, and the account is used again
   once it is usable. Criteria 6.5 and 6.9 check only skipping and telling
   the two errors apart. **Fix:** extend 6.6 with the cancelled requests, the
   parent notification and "owner needed". Add a criterion 6.10 for the
   sign-in mark, the owner notification, the reset time and the return to
   use.

5. **MAJOR. Coverage (`harnesses` command, and what `start` applies).** The
   `harnesses` command appears only as a schema (3.1), an authorization row
   (5.3) and a task note (6b.2). No criterion shows that changing a harness's
   ACP command changes what the runner starts, or that the permission
   mapping is used. No task or criterion passes the chosen permission mode,
   model and effort to the adapter when an agent starts, so the permission
   ceiling compares modes that may never take effect. The key decision "The
   owner can change any harness's command through the API" has no evidence
   row. **Fix:** add criteria in WS-6: an override changes the spawned
   command; the mode, after mapping, plus the model and effort reach the
   session; and a mode the harness cannot map is refused with a reason.

6. **MAJOR. Design (an unmade decision).** The plan never says which port
   the engine listens on, or how the `shepherd` tool, `shepherd mcp` and the
   tests find it. Task 7a.3 mentions "a listening port" and criterion 6.1
   passes the token but not the address. A fixed default port would make
   test 7.4 collide with a live Shepherd on the host. **Fix:** decide it, for
   example a port chosen by the system and written to a file in the state
   folder, with the address passed to agents in an environment variable, and
   add a criterion for it.

7. **MAJOR. Design (dependencies).** In the execution-sizing table, no unit
   depends on 4b (`subscribe` without gaps), yet unit 7a serves `subscribe`.
   Unit 6a's tests use the fake agent (6.1) and replay (6.2), but 6a depends
   only on 5c and 2, not on 8a. Units 7a and 8b do not list 6b (accounts),
   though the service builds every layer and capability 12 is tested in 8b.
   WS-8's "Rollout detail: rollout steps 8 and 9" contradicts rollout step 4,
   which builds the fake agent. **Fix:** add 4b before 7a, 8a before 6a, and
   6b before 7a; change WS-8's rollout line to "steps 4, 8 and 9".

8. **MAJOR. Verifiability (rebuild check).** Criterion 4.4 says the rebuild
   check runs "after every engine test", and the spec counts the engine as
   done only when test kinds 4 and 5 pass. Nothing checks that every test
   registers the hook. The acceptance suite runs the real service, and
   failure 2 runs it as a separate child process, where its in-memory views
   cannot be reached by a hook in the test process. **Fix:** compare views
   through an owner-only command, or a test-only build flag, in the
   acceptance teardown, and add a test that fails if an engine test file does
   not use the hook.

9. **MINOR. Consistency (the `pnpm check` command).** WS-2's risk table says
   criterion 2.5's credit script "runs inside `pnpm check`", but task 1c
   defines `pnpm check` as `tsc -b` plus `vitest run`, and no task adds the
   script. Task 2a declares "`dependencies` `effect` only", but Scout A item 1
   shows `@effect/platform-node` imported in two `effect-acp` files, so
   criterion 2.1 ("pass unchanged") will fail under pnpm's strict package
   isolation. **Fix:** add the script to `pnpm check` in 1c, and declare
   `@effect/platform-node` in 2a.

10. **MINOR. Verifiability (ambiguous criteria).**
    - 1.4: "or the Herdr command the plugins docs name" leaves the command
      open.
    - 1.5: `<scoping skill>` is a placeholder, not a path.
    - 2.2 and 2.3: "if present, else written" means the test id is not known.
    - 7.1: the "encrypted-channel setting" is not defined anywhere, and
      encrypted remote access belongs to piece 2.
    - 7.6: "failed" is not mapped to the nine states (crashed, stopped,
      paused for a limit, interrupted?), and the spec does not define these
      exit codes.
    - 3.4: checking field names misses secrets placed in an account's
      free-form "extra environment" values.
    **Fix:** name the exact command, path and test, and list which states
    produce each exit code.

11. **MINOR. Consistency (owner-section claims).**
    - WS-7's "the service keeps itself running" contradicts its own risk row
      ("a crash leaves it down") and known gap 6.
    - The key decision "It opens no extra network port" contradicts the
      fallback in decision 15 (a loopback HTTP endpoint).
    - WS-2's overview says the NOTICE file lists every copied file, while
      criterion 2.5 says the NOTICE file names each package.
    - The spec's copy table lists `ClaudeHome.ts` under accounts, but the
      plan neither copies it nor says why.
    **Fix:** reword the three claims, and copy `ClaudeHome.ts` or record why
    it is not copied.

12. **MINOR. House style (owner readability).** The owner sections use
    terms they never explain: "worktree", "MCP" (never expanded in the owner
    sections; the spec expands it, but the plan does not), "the Foundry
    skill", "T3 Code" (never said to be an open-source coding-agent app),
    "SQLite", "WebSocket", "loopback address", "schema", "merged" (with no
    commits, nothing is merged), and "(decision 17)", an identifier the
    owner must remember. Decision 17 gives no options and no consequence for
    each answer. **Fix:** add a short plain-language explanation of each
    term, and rewrite decision 17 as two named options with their cost (see
    finding 1).

## Answers to the seven attack questions

1. **Completion claims without an evidence row: found.**
   - "The owner can change any harness's command through the API" (key
     decisions).
   - "Starting an agent never downloads code" (key decisions).
   - "The service keeps itself running" (WS-7).
   - "Account secrets live in one owner-only file ... never reaches the
     record or any client" (key decisions). No criterion checks that
     `secrets.json` has mode 0600, or searches the database and replies for
     account secret values; 5.1 checks only agent tokens.
   - "Accounts can be named" (WS-6). Criterion 6.5 checks only "any
     account".
   - "Messages for a busy agent wait for its turn to end" (WS-5). Criterion
     5.7 covers this. The interrupted and paused cases of failure rule 6 have
     no row.

2. **The overview and the details disagree: found.**
   - Findings 7 and 11 list the disagreements.
   - Ordering: WS-8 says it is built at rollout steps 8 and 9, but rollout
     step 4 builds the fake agent.
   - What is copied: the overview says the account settings are copied, but
     the spec's `ClaudeHome.ts` is silently dropped.
   - Who does what: the overview lists two things that need the owner. The
     details add more owner work: the Herdr-host check (1.4), a macOS run
     (6.8), and recording the replay fixtures (finding 3).

3. **Orphans in spec coverage: found.**
   - Crash notification and "owner needed" for an agent the owner started
     (finding 4).
   - Failure rule 5's owner notification and reset time (finding 4).
   - The behaviour of the `harnesses` command, and applying the mode, model
     and effort at start (finding 5).
   - The question flow: `ask` puts the asker in "waiting on an answer", and
     `answer` delivers the reply to it. Only acceptance file 8 could cover
     it, and no unit-level criterion does.
   - Unit 5b (`start`, `prompt` with the sender recorded, `stop`, `resume`
     from a stopped or crashed agent, `group`, `accounts`) has no
     behavioural criterion of its own. Only authorization (5.3) is checked.
   - Restart closing open permission requests is in task 6c.2 but not in
     criterion 6.7.
   - The nine states: criterion 3.3 checks only that they exist, not that
     each change of state writes an event, as the spec requires.
   - The six parts, the six test kinds and the rest of the commands table
     are mapped.

4. **Unverifiable criteria or infeasible tests: found.**
   - Finding 10 lists the ambiguous criteria.
   - Finding 8 covers the rebuild check, which cannot reach a service in
     another process.
   - Finding 3 covers fixtures that do not exist when their tests run.
   - Criterion 6.8 says both the Linux and the macOS path have a test, but
     the macOS path cannot run on a Linux host without a stub.
   - Nothing requires real accounts inside `pnpm check`. 8c is excluded from
     it, but criterion 6.2 cannot pass until fixtures exist, unless it is
     skipped.

5. **Owner paragraphs that need jargon or remembered identifiers: found
   (finding 12).** Decision 17 is mentioned, but its consequence is wrong:
   finding 1 shows the worktree assumption fails, and no options are given.

6. **Do the rollout order and the "Depends on" column agree? Partly.** There
   is no cycle in the table itself. Dependencies are missing (finding 7).
   There is an evidence cycle: 6.2 and 6.9 need output from 8c, which
   depends on 6a (finding 3).

7. **House rules the plan breaks: found.**
   - Rule 3: the infra and contracts scopes cannot write `docs/issues.md`.
     Also, "built" in `docs/features.md` means "merged and working", which
     cannot happen with no commits.
   - Rule 2's "name the source project and file in the commit message" has
     no task to carry it into the eventual commit.
   - Rule 7, and the scope boundaries for `AGENTS.md` and `.plans` (finding
     2).
   - Writing style: the acronyms RPC, WAL, NDJSON, QA and PID are used
     without being expanded in the implementation details, and several
     owner-section sentences carry more than one claim.
