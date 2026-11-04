# Review round 1 findings and how each was folded

This file lists every finding of review round 1, on commit `ae967bf`, with its
fix, its decision row and the criterion that checks it. Six reviewers found 1
blocker, 39 majors and 34 minors, with grades 5 to 6 and no refusals. Everything
is folded as contract version 8, and rows 91 to 128 of `decisions.md` record the
choices. The lead's rulings 1 to 6 are in rows 91 to 101.

A finding that several reviewers report shares one decision row and one fix. Two reviewers
each number a finding TM-1 to TM-4, so the tables below keep them apart.

## Threat model review, Opus (`round-1-threat-model-opus.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| TM-1 | blocker | Nothing enforces who can reach the proxy. | The example Caddyfile binds the WireGuard address and matches the WireGuard network. Proxy mode gains the computer-only allowed client networks, with no default. | 91 | 10.2, 10.3, 10.4 |
| TM-2 | major | Any other local user gets the owner's control. | Another user id passes only in proxy mode, and only with the computer-only proxy user id. | 92 | 5.6 |
| TM-3 | major | A web caller can send a stored secret to any server through the ntfy settings. | One fixed token slot with no reference in the settings. A change of origin clears it. Transport rules are stated. | 93 | 6.13, 6.14, 6.15 |
| TM-4 | major | The ntfy token has no way in, and restart recovery deletes it. | `set-token` at the computer, and edit E27 keeps the slot through secret collection. | 94 | 1.39, 1.40, 6.14 |
| TM-5 | major | Persistent allows and settings-write approvals work from the web. | Question 6 to the owner. Folded as the recommended answer in edit E28, marked pending. | 95 (pending) | 1.41 |
| TM-6 | major | The open-web caller has no path into the command handler. | One in-process `open-web` credential shape, built only by `webCaller`'s constructor. | 96 | 1.34 |
| TM-7 | major | The client group's access and visibility table is not written. | One table in contract section 5. Every client event is owner-only. Streams and secret-setting commands are not tools. | 97 | 2.5, 2.9 |
| TM-8 | minor | Other settings that outlast access stay open to the web. | They are listed. None moved to the computer-only list. A change from the open server raises an alert. | 98 | 6.17 |
| TM-9 | minor | `debug.compare-views` is described as callable by a device. | The owner credential alone, refused by name on the web server. | 99 | 1.4, 5.5 |
| TM-10 | minor | The own-address check passes when the proxy sends no forwarded address. | A missing last address is refused, in one truth table. | 113 | 10.2 |
| TM-11 | minor | Shephrd never checks that remote access is encrypted. | A public address must be `https`, and a public request must carry `X-Forwarded-Proto: https`. | 113 | 5.16, 10.2 |
| TM-12 | minor | The carrier's transport and topic have no rules. | `docs/remote-access.md` advises deny-all and separate tokens. The carrier refuses plain HTTP and redirects. | 115 | 6.15, 10.3 |
| TM-13 | minor | Agent-chosen alert text has no bound. | Team and name caps, fixed labels, and titles from a table typed over the kinds. | 114 | 6.4, 6.5 |
| TM-14 | minor | The attack-pass claim does not match the sizing table. | Passes on units 1a, 1b, 3, 5, 7b and 10. Criterion 7.4 covers links and Markdown. The page's content policy is tighter. | 117 | 5.10, 7.4 |
| TM-15 | minor | There is no data inventory, deletion plan or lost-phone plan. | A stored-copies table, no thread data in browser storage, `AlertSender.clear`, and a lost-phone section. | 116 | 3.7, 6.7, 7.11, 10.3 |
| TM-16 | minor | A folded request hides what the owner approves. | A request's full text is visible before Allow, and agent text looks different from Shephrd's controls. | 118 | 7.12 |
| TM-17 | minor | The contract and the roles plan disagree on two access entries. | The roles plan adds `release` in its own unit and folds `roles.rules.add` at access `owner` alone. | 120 | 5.5 |
| TM-18 | minor | The access check runs after the receipt lookup. | Edit E2 moves it before the lookup. A device's refusal writes no receipt. | 100 | 1.35 |
| TM-19 | minor | SECURITY.md rule 7 is not amended. | The suspension paragraph says that an approval over the open server needs no credential. | 101 | none; a document change |
| TM-20 | minor | The connection cap has no number or fairness. | 32 connections, a new one closes the oldest, and a refused one does not count. `Host` and `Origin` run before the process scan. | 119 | 5.7, 5.11 |

## Threat model review, Sol (`round-1-threat-model-sol.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| TM-1 | major | A new alert credential is removed during start-up. | Edit E27, with the same fix as Opus TM-4. | 94 | 1.39 |
| TM-2 | major | A read transaction does not make a snapshot agree with its cursor. | One value from `views.snapshot`, with that value's own sequence. | 103 | 1.7, 3.1 |
| TM-3 | major | The credential's outbound boundary is not stated for an editable destination. | The same fix as Opus TM-3. | 93 | 6.13, 6.14, 6.15 |
| TM-4 | major | The regression gate leaves out the test runner. | The root `pnpm check`, with a summary that shows tests ran. | 111 | 1.1 |

## Architect review (`round-1-architect-sol.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| A1 | major | Edit E3 wrongly limits the after-commit hook to waits. | `afterCommit` stays for every engine planner. A piece's planner never sets it. | 102 | 1.33 |
| A2 | major | The client routes every stream to engine `subscribe`. | Edit E24 dispatches by the command's tag. | 109 | 2.7 |
| A3 | major | Unknown events are handled after the decoder that rejects them. | Edit E25 adds a tolerant wire form at the RPC boundary. | 109 | 2.4 |
| A4 | major | The snapshot leaves out state that the settled test needs. | A wait-state section with open deliveries, open waits and `reloadable`. | 104 | 3.1, 3.5 |
| A5 | major | Sharing `settled` alone cannot keep the wait's exit codes. | Edit E19 also moves `reasonOf` and the any and all rule. The contract has a member table. | 104 | 1.16, 3.6 |
| A6 | major | The 1 MiB budget has no bound for existing engine data. | The limit is inbound only. Pages have a byte budget, and the stream has an oversized marker. | 105 | 1.10, 2.6, 3.3, 3.4 |
| A7 | major | A durable alert record does not settle the send's crash window. | At-least-once delivery, derived from the log. | 106 | 6.3, 6.11 |
| A8 | major | A board alert has no way to read and answer its subject on the page. | A subject panel keyed by namespace, with a fallback. The board's plan writes its entry. | 112 | 7.13 |
| m1 | minor | Edit E21 relies on an index that omits thread events. | An indexed `thread_agent_id` column, filled for old rows. | 125 | 1.10 |
| m2 | minor | Rollout has no rollback after the first new event. | A "Rolling back" section: turn behaviour off and fix forward. | 127 | none; a plan section |
| m3 | minor | The planned interface tests are outside test discovery. | The lead's setup adds the `web` and `viewer` projects and `.tsx` discovery. | 111 | 1.1 |

## Logic review, Sol (`round-1-logic-sol.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| R1 | major | Edit E3 removes the effects that perform lifecycle commands. | The same fix as architect A1. | 102 | 1.33 |
| R2 | major | Edit E9 cannot get a coherent snapshot from a read transaction. | The same fix as threat model Sol TM-2. | 103 | 1.7 |
| R3 | major | The owner's wait omits terminal outcomes. | The same fix as architect A5. | 104 | 3.5, 3.6 |
| R4 | major | Recording an alert does not settle external delivery. | The same fix as architect A7. | 106 | 6.11 |
| R5 | minor | The regression command succeeds without running the suite. | The same fix as threat model Sol TM-4. | 111 | 1.1 |
| R6 | minor | Edit E21 relies on an index that omits queued deliveries. | The same fix as architect m1. | 125 | 1.10 |

## Critic review (`round-1-critic-sol.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| C01 | major | The main gate runs no tests, and new interface tests are not discovered. | The same fix as threat model Sol TM-4 and architect m3. | 111 | 1.1 |
| C02 | major | A read transaction cannot make live views and cursor atomic. | The same fix as threat model Sol TM-2. | 103 | 1.7 |
| C03 | major | The 1 MiB criterion has no finite bound. | The same fix as architect A6, and a 4 MiB snapshot test. | 105 | 2.6, 3.3 |
| C04 | major | The client's stream dispatcher always calls `subscribe`. | Edit E24. | 109 | 2.7 |
| C05 | major | Unknown events are handled after the typed decoder. | Edit E25. | 109 | 2.4 |
| C06 | major | Start-up deletes a standalone token, and no way to set it is named. | Edit E27 and `set-token`. | 94 | 1.39, 6.14 |
| C07 | major | The plan promises exactly-once delivery without a crash policy. | At-least-once delivery, with the duplicate accepted. | 106 | 6.11 |
| C08 | major | The shared client is Node-only. | Edit E26: a core, a Node entry and a browser entry. This amends row 45. | 110 | 2.8, 7.11 |
| C09 | major | The VS Code exclusion has no owner quote. | Row 51 is marked WIDENED and open, and no extension is built. | 121 | none; a known gap |
| C10 | minor | Reads' marks have two different callers. | Marks use the calling caller, so edit E11 no longer lists them under `piece`. | 122 | 1.27 |
| C11 | minor | Refusal criteria contradict the refusal event. | A table states the exact writes for each refusal. | 122 | 1.32, 1.38 |
| C12 | minor | The claimed access to `debug.compare-views` does not match devices. | The same fix as threat model Opus TM-9. | 99 | 1.4 |
| C13 | minor | The board alert still promises a post, and the design offers a thread. | The link opens the thread, and the subject panel shows the post. | 112 | 7.13 |

## Logic review, Opus (`round-1-logic-opus.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| LOGIC-1 | major | The owner's wait cannot compute settled from the snapshot. | The wait-state section. | 104 | 3.1, 3.5 |
| LOGIC-2 | major | The helper has no `reasonOf`, so a stopped member hangs the wait. | Edit E19 moves `reasonOf`. | 104 | 1.16, 3.6 |
| LOGIC-3 | major | The closing table leaves alerts open, and closes one too early. | A level test over the views, with one table of closing rules. | 107 | 6.2 |
| LOGIC-4 | major | The snapshot's read transaction does not exist, and it can lose an event. | One views value and its sequence. | 103 | 1.7 |
| LOGIC-5 | major | Phone delivery has no defined guarantee. | At-least-once delivery, with a stated retry schedule. | 106 | 6.11 |
| LOGIC-6 | major | The alert reactor has no starting position on an old log. | A first-start event and a level scan, with `baseline` alerts that are never pushed. | 108 | 1.37, 6.16 |
| LOGIC-7 | major | The reactor's refusal cannot be built, and a failed write has no policy. | `CommandRefused.sourceSequence`, and a stop on `LogWriteFailed`. | 108 | 1.38 |
| LOGIC-8 | major | Nothing makes a reactor wait for recovery. | Reactors start after `whenReady`, and the batch path refuses before then. The web server answers HTTP 503. | 108, 113 | 1.36, 5.14 |
| LOGIC-9 | minor | Edits E22 and E23 rest on a check the handler does not make. | Check 2 is stated as new, per event, on the projected snapshot. | 122 | 1.20, 1.32 |
| LOGIC-10 | minor | The read rule's agreement does not survive a transition. | The claim holds for a fixed readable set. An agent refreshes its roster. | 123 | 1.28, 3.2 |
| LOGIC-11 | minor | The group filter and checkpoint are wrong on catch-up. | Current views, live and on catch-up. A checkpoint carries the last sequence scanned. | 124 | 3.4 |
| LOGIC-12 | minor | Edits E21 and E5 disagree with the views about thread events. | The engine's `threadAgent` rule, limited to engine tags. | 125 | 1.10 |
| LOGIC-13 | minor | The contract and edit E2 disagree on where access runs. | The same fix as threat model Opus TM-18. | 100 | 1.35 |
| LOGIC-14 | minor | `open-web` has no credential path. | The same fix as threat model Opus TM-6, with `open-web` refused as a device id. | 96 | 1.34 |
| LOGIC-15 | minor | Public address and proxy mode have no truth table. | The table in contract section 5, and the settings command's refusals. | 113 | 5.16, 10.1, 10.2 |
| LOGIC-16 | minor | Edit E16's "withdraw" has no meaning for a returned delivery. | The source rule asks one question, about a stopped or crashed target. | 126 | 1.15 |
| LOGIC-17 | minor | Three service paths are unnamed. | Edits E13 and E15 name them. | 126 | 1.12, 1.14 |
| LOGIC-18 | minor | `AlertCleared` has two writers, and dismissing a closed alert is undefined. | The dismiss planner writes its own clear, and a closed alert succeeds with no event. | 107 | 6.2 |
| LOGIC-19 | minor | An account key cannot be computed from the reactor's input. | Account alerts key on the event that names the account. | 107 | 6.1 |
| LOGIC-20 | minor | Anchors and text are stale. | Anchors and row ranges are corrected. | 128 | none; read by the reviewers |
