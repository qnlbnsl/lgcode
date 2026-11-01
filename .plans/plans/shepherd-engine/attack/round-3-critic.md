# Round 3: plan critic report on plan-v3.md

Verdict: **REVISE.**

This review covers only the round-2 patches as they affect the owner
overview, the owner's four build steps, the checkability of the new and
changed criteria, traceability for rows 49 to 63, and gate 10. Line numbers
refer to `attack/plan-v3.md`. Known gaps 1 to 6 are not re-reported. The
owner's rulings on rows 17, 47 and 49 are not re-opened.

## Top finding

The owner's steps 2, 3 and 4 say to run commands "in the Shepherd folder",
and criterion 1.4 hard-codes the main checkout's path. Row 17 says each unit
is built in its own worktree and committed to a local `engine` branch, and
rollout step 1 only creates that branch. Nothing says the main checkout
switches to `engine`. If the main checkout stays on `master`, it holds no
`herdr-plugin.toml`, no `package.json` and no scripts. Then `herdr plugin
link` finds nothing to link, and `pnpm record-fixtures` does not exist. The
owner's second step would fail at the end of unit 1, and the third step
would block unit 6a.

## Findings

1. **MAJOR. Owner readability and ordering (which checkout).** This is the
   top finding above. Evidence: lines 85-93, 103, 246-247 and 306, and row 17
   (line 869). **Fix:** say in rollout step 1 and in the overview that the
   main checkout is switched to `engine` after the first commit, and that
   each finished unit is merged into it. Name that folder in each owner step.

2. **MAJOR. Checkability (criteria 3.1 and 7.5, row 55).** Criterion 3.1
   asserts the owner-only list "equal to the lists in row 55". Row 55 does
   not give that list; it says "every owner-only command", which is
   circular. Criterion 7.3 also lets agents call `subscribe`. Row 55 keeps
   `subscribe` out of the tool server, yet criterion 7.5 says the tool server
   offers "exactly the agent-callable commands". Evidence: lines 396, 617,
   619 and 907. **Fix:** write one table with three columns: agent-callable
   tool, agent-callable through the command-line tool only, and owner-only.
   Point 3.1 and 7.5 at that table.

3. **MAJOR. Checkability (criterion 6.9 has no fixture source).** Criterion
   6.9 reads `packages/testing/fixtures/errors/`. Neither criterion 8.2 nor
   task 8a.4 produces that folder. No task writes the out-of-usage text that
   row 42 takes "from the adapters' source". The overview's step 3 does not
   say that the recorder also runs each harness signed out. Evidence: lines
   92-102, 567, 665, 678 and row 42 (line 894). **Fix:** have 8.2 and 8a.4
   list the error fixture files, and add a task for the source-derived
   out-of-usage samples.

4. **MAJOR. Round-2 critic finding 4 is only partly fixed (criterion 6.14).**
   Criterion 6.14 requires `SECURITY.md` to name the harnesses that have no
   deny-read rule. That list is found during unit 6a. `SECURITY.md` is
   read-only in every scope, and no lead task writes the list. The current
   text (`SECURITY.md` lines 36-41) names no harnesses. **Fix:** add a lead
   task after unit 6a that writes the list into `SECURITY.md`. Then make 6.14
   check the unit's report, or check that lead task.

5. **MINOR. Owner readability (the Herdr link after the build, and the
   startup-hook check).** Step 2 says only what happens "until the engine is
   built". After unit 7b, every Herdr start runs the real service, against
   the owner's real state folder. The WS-7 Verify line puts the startup-hook
   check in step 4, but neither step 4 nor criterion 8.6 mentions it.
   Evidence: lines 88-91, 103-107, 650 and 669. **Fix:** state that
   consequence and how to unlink. Add "the startup hook started one service"
   to step 4 and to 8.6.

6. **MINOR. Checkability (criterion 5.4's table).** The `stop` row asserts
   that waits are cancelled, but its event column omits "wait cancelled".
   The `resume` row's "re-sent or carry-on queued" is two outcomes in one
   case. The `accounts` and `harnesses` rows do not say whether the plain
   command reads or changes settings. Evidence: lines 511, 512, 515 and 518.
   **Fix:** split `resume` into one row per outcome. Add the missing event.
   Name each command's write form.

7. **MINOR. Checkability (criteria 5.8 and 1.7).** Criterion 5.8 says "at
   the right time" but gives no expected outcome for three cases: "compact
   then wait", "orchestrator → lead → worker", and "any and all". Criterion
   1.7 claims every needed dependency but checks four. `pnpm ls` shows
   resolved versions, not exact pins. Evidence: lines 499 and 309. **Fix:**
   state the expected wake for each case. Make 1.7 list the full expected
   set, and check the exact specifiers with `grep` on
   `packages/engine/package.json`.

8. **MINOR. Traceability (row 52 against the tasks).** Row 52 says "task
   6c.2 implements steps 4-10". The plan gives the sweep to 6c.2 and steps
   3-10 to 6d.1. Criterion 6.7 also leaves out step 9's re-check of every
   open wait. Evidence: row 52 (line 904), lines 565, 584 and 586.
   **Fix:** correct row 52 to name 6d.1. Add "every open wait re-checked
   once" to 6.7.

9. **MINOR. Gate 10 (scope validity).** The lead edits the `AGENTS.md`
   "Status" section before unit 1 (line 790, row 46). All three
   `scope.json` files pin that section's hash, `9426248c3fed`, so
   `scope.py check` fails at launch. The `engine/backend` scope may edit
   `docs/features.md`, yet row 63 says build units do not. **Fix:** have the
   lead re-run the scoping skill after the Status edit. Remove
   `docs/features.md` from the backend scope's edit list.

10. **MINOR. Gate 10 (the load does not follow the sheet).** The sheet fixes
    10 units on Sol: 3, 4a, 4c, 5b, 6b, 6c, 7b, 8a, 8b and 8c. The other
    nine alternate between the two vendors, which gives about 14 to 15
    OpenAI builds, not 13. Every cyber attacker is Daybreak Blue, an OpenAI
    tier, so the attack split is not 4 and 4. Evidence: lines 822-831; the
    model sheet's builder table and "Who checks what". **Fix:** recompute
    the split per unit and restate both vendor totals.

## Smaller observations, not counted above

- Criterion 3.5's table yields ten displayed states, including "Signed
  out". The spec's state list (spec lines 311-325) still says an agent is
  always in exactly one of nine states, and the amendment does not add the
  tenth. Add one sentence to the amendment.
- Row 15 is marked "superseded by rows 21, 48". Those rows replaced only its
  loopback fallback, not the stdio tool-server decision, and task 7b.3
  still cites row 15. Mark only the fallback clause as superseded.
- Criterion 8.2 says each fixture header records the adapter version and
  the negotiated protocol version, but neither its test nor its on-device
  step looks at the header.

## Answers to the attack questions

1. **Can the owner understand the overview alone? Mostly.** Each of the four
   steps says what it does, what it costs and what declining means. Steps 2
   to 4 do not say which checkout to run them in. Step 2 does not say what
   the link does once the engine is built. Nothing misstates the three
   rulings (findings 1 and 5).
2. **Were round-2 critic findings 4, 5, 7, 9, 10 and 11 fixed as folded?**
   Findings 5, 9 and 11 are fixed. Finding 7 is fixed, except that the
   overview leaves out the signed-out error capture. Finding 10 is fixed for
   3.5 and 4.6, but 8.2 omits the error fixtures. Finding 4 is only partly
   fixed: the `SECURITY.md` harness list has no writer (findings 3 and 4).
3. **Is every new or changed criterion checkable? Mostly.** Criteria 3.1,
   5.4, 5.8, 1.7, 6.9's inputs and 6.14 fall short (findings 2, 3, 4, 6 and
   7).
4. **Does traceability cover rows 49 to 63 and every amendment subsection?
   Yes, with one error.** Every row from 49 to 63 maps to a criterion or a
   task, and so do all ten amendment subsections. Row 52 names the wrong
   task (finding 8).
5. **Does gate 10 pass? Partly.** Every unit has a valid work area, a
   complexity, a scope file that exists and a reason, and the section names
   no models. The internal totals add up: 19 × 3 + 8 = 65, and 29 + 36 = 65.
   The vendor split does not follow the sheet. The scope hashes go stale
   after the lead's Status edit. `scope.py check` was not run, because this
   review is read-only (findings 9 and 10).
