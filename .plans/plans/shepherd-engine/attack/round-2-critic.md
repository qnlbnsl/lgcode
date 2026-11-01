# Round 2: plan critic report on plan-v2.md

Verdict: **REVISE.**

This review covers only the round-1 patches and their consequences. Line
numbers refer to `attack/plan-v2.md`. Known gaps 1 to 8 are not re-reported.

## Top finding

The owner is asked to run `pnpm record-fixtures` before unit 6a, but that
command cannot work at that point in the build. The recorder drives real
Claude Code and Codex adapters. Those adapters are only added as pinned
dependencies in task 6b.2 (line 498), which is part of unit 6b, and unit 6b
comes after unit 6a. Unit 8a, which builds the recorder, depends only on
unit 3 (line 704). Running the adapters through `npx` instead is forbidden by
row 18. The round-1 fix for critic finding 3 therefore puts a step on the
critical path that has nothing to run. Unit 6a waits on it (line 705), so
the build stops at rollout step 7.

## Findings

1. **MAJOR. Design (ordering).** This is the top finding above. Evidence:
   lines 215, 498, 575, 587, 704 and 705, and rows 18 and 42. **Fix:** move
   the adapter pins out of 6b.2 into unit 8a, or into an infra step before
   8a, and make 8a list that step as a dependency.

2. **MAJOR. Design (scope boundaries).** The fix for critic finding 2 is
   incomplete. `pnpm record-fixtures` and `pnpm live-check` need scripts in
   the root `package.json`, because pnpm runs root scripts from the root.
   Every new dependency also changes `pnpm-lock.yaml`. Both files are
   editable only in the `engine/infra` scope, yet units 8a, 6b and 8c run in
   `engine/backend` (lines 704, 706 and 711; `.plans/scopes/engine/infra/scope.json`).
   Criterion 1.1 uses `--frozen-lockfile`, so a stale lockfile fails it.
   **Fix:** have unit 1 declare every dependency and both root scripts up
   front, or add a short infra unit for them.

3. **MAJOR. Verifiability (new criterion 1.5).** Criterion 1.5 (line 260)
   requires `./bin/shepherd --version` to print a version in unit 1. The
   launcher runs `packages/cli/src/bin.ts` (task 1g, line 273), but that file
   is created by task 7b.2 (line 547). The infra scope cannot edit
   `packages/cli/src/` either. The criterion cannot pass in its own unit.
   **Fix:** let unit 1 check the launcher against a stub script inside
   `bin/`, and move the `--version` check to unit 7b.

4. **MAJOR. Traceability (row 47).** Row 47 (line 788) promises two things.
   The first is that the threat-model assumption is written into
   `SECURITY.md`, which overview item 3 also says (line 72). The second is a
   deny-read rule for the state folder in each harness that supports one,
   "tested per harness". Neither has a task or a criterion. Every scope also
   marks `SECURITY.md` read-only. The traceability table maps row 47 only to
   "owner ruling" (line 664). **Fix:** add a lead task for the
   `SECURITY.md` text, plus a task and a criterion for the deny-read rule in
   unit 6a or 6b.

5. **MAJOR. Owner readability (threat-model question).** Overview item 3
   (lines 67-72) asks the owner to "rule" but offers no choices. Row 47 names
   two stronger options: keeping the owner's credential in the OS keyring,
   or running agents as a separate Unix user. Their costs are not stated,
   and the rollout order never says whether building waits for this ruling.
   **Fix:** list each option with what it costs, and say that building
   proceeds on the written assumption if the owner does not answer.

6. **MAJOR. Gate 1 (row 17's assumption).** Row 17 (line 758) still assumes
   "Workers leave changes in their worktrees". Critic finding 1 showed that
   this cannot work: the repository has zero commits, so a worktree contains
   none of its files. The key decision on lines 106-107 says instead that the
   plan waits for the owner's answer. The decisions log and the overview now
   disagree. **Fix:** rewrite row 17's assumption as "build one unit at a
   time in the main checkout until the owner answers", and give the
   execution-sizing section that serial order.

7. **MAJOR. Owner readability (recording and the live check).** Overview
   items 4 and 6 (lines 73-77) leave out several things the owner needs to
   know before approving. They do not say that Gemini CLI and Cursor must be
   installed and signed in. They do not say which folder and which
   permission mode the real agents get, even though Shepherd's permission
   ceiling does not exist yet when recording runs. They do not say that the
   recordings are saved into the repository. They do not say that declining
   blocks unit 6a. **Fix:** state each of these in the overview.

8. **MAJOR. Consistency (the Herdr link).** Criterion 1.4 belongs to unit 1
   (rollout step 2, line 289), and the WS-1 summary claims that Herdr lists
   Shepherd's actions (lines 121-122). Rollout step 11 (line 219) puts the
   link at the very end instead. Overview item 5 does not mention that a
   linked plugin then runs `serve --detach` every time Herdr starts. The
   WS-7 startup-hook check (line 560) is not on the owner's list. **Fix:**
   choose one timing for the link, explain what it causes, and list the
   startup-hook check.

9. **MAJOR. Verifiability (new criterion 5.4).** Criterion 5.4 (line 430)
   says that seven commands "change what the spec says". That is not an
   observation a test can make. Yet 5.4 is the only evidence for
   capability 3 and capability 11, and the main evidence for capability 10's
   `stop` and `resume` (lines 635, 642 and 643). **Fix:** name, for each
   command, the event it writes and the change in the view that the test
   asserts.

10. **MINOR. Verifiability (new criteria 3.5, 4.6 and 8.2).** Criterion 3.5
    (line 351) says displayed states are derived "as row 24 says", but row 24
    (line 765) gives no rule for that derivation. It does not cover an agent
    that is signed out, or one that is waiting on two things at once.
    Criterion 4.6 (line 391) relies on a "test build" that the plan never
    defines. In criterion 8.2 (line 575), an exit code of 0 does not show
    that fixtures exist for all four harnesses. **Fix:** write the
    derivation table, name the mechanism that corrupts a view, and have 8.2
    list the expected fixture files.

11. **MINOR. Consistency (rows 15 and 16).** Row 15 (line 756) still falls
    back to "an HTTP MCP endpoint on the loopback address". Row 16 (line 757)
    still serves the API "over a WebSocket on 127.0.0.1". Both contradict
    task 7b.3, criterion 7.1 ("no TCP listener"), known gap 2 and rows 21 and
    48. The round-1 findings mark critic finding 11 as fixed, but these rows
    were not updated. **Fix:** mark both rows as superseded by rows 21 and 48.

12. **MINOR. Assorted consequences of the round-1 patches.**
    - Criterion 6.11 (line 484) does not cover refusing a mode or a model
      that the harness cannot map, although critic finding 5 asked for it
      and the risk row on line 514 promises it.
    - Three amendment rules have no criterion: "stopping an agent does not
      stop its children" (row 27), "the owner can mark an account available"
      (row 28), and "a blocking wait creates no delivery" (row 26).
    - The load arithmetic does not add up. The units need 62 launches, but
      the vendor totals on lines 713-718 come to 68.
    - The guard in criterion 4.4 (line 389) fails on unit 1's smoke test.
    - Units 1 to 3 cannot mark `docs/features.md` as built, although the
      conventions require it (line 241).

    **Fix:** extend criterion 6.11, add the three missing criteria, correct
    the totals, exempt the smoke tests from the guard, and give the
    `docs/features.md` update to the lead.

## Answers to the attack questions

1. **Can the owner act on the overview alone? Not fully.** The commit choice
   is well explained. The threat-model ruling offers no choices, and neither
   the fixture recording nor the Herdr link states its cost and side effects.
   None of the six actions says what happens if the owner declines
   (findings 5, 7 and 8).

2. **Does every new criterion name an observation? Mostly.** Criteria 1.5,
   3.5, 4.6, 5.4 and 8.2 cannot be checked as written (findings 3, 9 and 10).

3. **Do the sections agree? Partly.** The unit count of 18 and most of the
   dependency changes agree across sections. Four things disagree: when the
   Herdr link happens, when the adapters are installed relative to the
   recording, row 17, and the launch totals (findings 1, 6, 8 and 12).

4. **Were the round-1 critic findings fixed where claimed? Not all.**
   Findings 4, 6, 7, 8, 9, 10 and 12 are fixed. Findings 2, 3, 5 and 11 are
   only partly fixed, and finding 1 is fixed in the overview but not in
   row 17. Critic question 7, about `docs/features.md` being marked "built
   once merged" when nothing is merged, was not addressed (findings 1, 2, 6,
   11 and 12).

5. **Does traceability cover the amendment and decisions 20 to 48? No.**
   Row 47's hardening and `SECURITY.md` text map to nothing. Three rules
   from rows 26 to 28 have no criterion. Decisions 1 to 48 are mapped by a
   single blanket row rather than item by item (findings 4 and 12).

6. **Does gate 10 pass? Only partly.**
   - It passes on these points. Every unit has a valid work area from the
     model sheet, a complexity, a reason and a scope file that exists, and
     the section names no models.
   - It fails on these points. The scopes do not cover the root scripts or
     the lockfile that units 6b, 8a and 8c need, and unit 1 cannot reach
     `packages/cli/src`.
   - It is unverified on this point. `scope.py check` was not run, because
     this review was read-only.
