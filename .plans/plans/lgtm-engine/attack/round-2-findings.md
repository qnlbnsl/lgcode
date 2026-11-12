# Round 2 findings and outcomes

Four isolated lenses reviewed `plan-v2.md` on 2026-11-01, scoped to the
round-1 patches (decisions 20-48) and the mechanisms marked UNREVIEWED in
round 1. All four returned REVISE. Full reports: `round-2-critic.md`,
`round-2-logic.md`, `round-2-architect.md`, `round-2-security.md`.

Counts: 1 BLOCKER (security 1), 35 MAJOR (critic 9, logic 11, architect 7,
security 8), about 20 MINOR. Several findings repeat across lenses.

## Where the findings cluster

| Mechanism | Findings | Share of BLOCKER + MAJOR |
|---|---|---|
| Restart recovery, waits and three-step deliveries (decisions 25, 26, 28, 29, 31) | logic F1-F11; architect 1, 2, 3; security 3, 12 | 16 of 36 |
| Build order, scopes and dependencies (decisions 42, 46) | critic 1, 2, 3, 8; architect 5, 6 | 6 |
| Decision 47's promises have no task | critic 4, 5; security 2 | 3 |
| Client identity and socket trust | security 1 (BLOCKER) | 1 |
| Ceiling, redactor, envelope, secrets through MCP, service log | security 4-9; architect 7 | 7 |
| Criteria not checkable, `set_model` API | critic 7, 9; architect 4 | 3 |

The restart, wait and delivery mechanism drew the largest cluster in round 1
(logic 1-4, 8, 10) and again in round 2. Under review-rounds.md rule 9, that
is a sign the mechanism is too complex for its value. The owner is offered
simpler options before round 3 (decision 49, pending).

## Independent convergence

- Restart prompts agents before the socket exists: logic F6, architect 2.
- The SQLite lifetime lock takes no lock until a write: architect 3, security 12, logic (minor).
- Fixture recording needs adapters pinned later: critic 1, architect 6.
- Root scripts and lockfile outside every build scope: critic 2, architect 5.
- Decision 47's SECURITY.md text and deny rules have no task: critic 4, architect 12, security 2.
- `accounts set-secret` and `subscribe` must not be MCP tools: architect 7, security 8.
- Rows 15 and 16 still describe a loopback listener: critic 11, logic, architect 12, security 11.
- Launch totals add to 62, not 68: critic 12, architect 12.

## Outcomes (to fold into plan v3)

| Finding | Severity | Outcome |
|---|---|---|
| security 1: client falls back to the owner credential and trusts any socket path | BLOCKER | Fix: owner credential only when both `LGTM_SOCKET` and `LGTM_TOKEN` are unset; one set alone is refused; the client checks the socket folder (lstat, owner, 0700) before sending. |
| logic F1-F4, F10: settled waits wake early, never, or with a stale reason | MAJOR | Fix: settled becomes a predicate on current state (no unaccepted delivery, no held request, not in a compact turn); add "wait cancelled". Depends on decision 49. |
| logic F5-F9, F11; architect 1-3; security 3, 12: restart recovery | MAJOR | Depends on decision 49 (keep automatic recovery or simplify). Fixes common to both options: remove a stale `engine.sock` once the lock is held; take the lock with `BEGIN EXCLUSIVE` on a kept connection; revoke every token at restart; a two-process test. |
| logic F7, F12: error replies count as accepted; moves leave old deliveries | MAJOR / MINOR | Fix: only a successful reply or content update accepts; an error reply re-queues at the head; a move withdraws the old holder's delivery; requests never move back. |
| critic 1, architect 6: recorder needs later adapters | MAJOR | Fix: pin adapters in unit 1; harness path resolution and a minimal environment builder move into 8a. |
| critic 2, architect 5: scopes miss root files | MAJOR | Fix: unit 1 declares every dependency and root script (`record-fixtures`, `live-check`) up front. |
| critic 3: criterion 1.5 needs the CLI | MAJOR | Fix: unit 1 tests the launcher against a stub; `--version` moves to 7b. |
| critic 4, 5; security 2: decision 47 promises | MAJOR | Fix: a lead task writes SECURITY.md; a task and criterion add the per-harness deny rules; the overview lists the options and costs and says building proceeds on the assumption. |
| critic 6: row 17 stale | MAJOR | Already fixed: the owner allowed commits (row 17 closed 2026-11-01). |
| critic 7: recording and live-check requests incomplete | MAJOR | Fix: the overview states which harnesses must be installed and signed in, the folder and mode the real agents get, that recordings are saved in the repository, and what declining blocks. |
| critic 8: Herdr link timing | MAJOR | Fix: link at unit 1's end; the overview says a linked plugin runs `serve --detach` at each Herdr start. |
| critic 9, 10: criteria not checkable | MAJOR / MINOR | Fix: per-command event and view assertions for 5.4; a derivation table for 3.5; 4.6 uses a replaced views layer; 8.2 lists expected fixture files. |
| architect 4: `session/set_model` is not stable ACP v1 | MAJOR | Fix: use `session/set_config_option` (model, thought_level) first; record the negotiated protocol version. |
| architect 7, security 8: MCP parity | MAJOR | Fix: full parity for the command-line tool only; the MCP server excludes `subscribe`, `accounts set-secret`, `debug.compare-views` and owner-only commands, asserted by list. Refused events record only the command and reason. |
| security 4: folder ceiling holes | MAJOR | Fix: spawn by the stored real path, re-check on resume, read `.git` and `commondir` directly, refuse `$HOME`, the state folder and the plugin root. |
| security 5: persistent "allow always" and settings edits | MAJOR | Fix: options that persist, and writes to harness settings files, go to the owner. |
| security 6, 9: redactor gaps and service log | MAJOR | Fix: redact every string field after joining chunks, match encoded forms; route the service logger through the redactor; protocol logging off outside tests. |
| security 7: envelope forgery and slash commands | MAJOR | Fix: random per-envelope marker; escape a leading `/` in every prompt an agent sends. |
| architect 8-11, security 10, 11, critic 11, 12, logic minors | MINOR | Fix in plan v3 as prescribed in each report. |

## Post-build checks proposed

Architect PB-A8 to PB-A11 and security SEC-PB-4, SEC-PB-5, carried into
plan v3's "Post-build checks" section.
