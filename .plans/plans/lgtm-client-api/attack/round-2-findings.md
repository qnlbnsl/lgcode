# Review round 2 findings and how each was folded

This file lists every finding of review round 2, on commit `04e1f83`, with its
fix, its decision row and the criterion that checks it. Six reviewers found 1
blocker, 18 majors and 30 minors, with grades 5 to 7 and no refusals. Everything
is folded as contract version 10, on top of version 9, and rows 130 to 157 of
`decisions.md` record the choices. The lead's rulings 1 to 13 are rows 130 to 142.

A finding that several reviewers report shares one decision row and one fix.

## Threat model review, Opus (`round-2-threat-model-opus.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| TM2-1 | major | The owner approves a title, not the action. | Edit E29 carries the tool input. The page shows it before Allow, or a fixed warning. | 132 | 1.42, 7.12 |
| TM2-2 | major | A proxied request can be judged as a local browser. | A proxy-user peer is always public. With proxy mode off, a forwarded header is refused. PB-2 fails on a missing header. | 133 | 10.2, 10.3 |
| TM2-3 | major | `localhost` is allowed, and only `127.0.0.1` is bound. | `localhost` is dropped, and only `http://127.0.0.1:<port>` is printed or linked. | 134 | 5.4, 10.3 |
| TM2-4 | minor | Narrowing the settings leaves live connections open. | Any settings change closes every web connection. | 140 | 5.16, 10.2 |
| TM2-5 | minor | The caller it watches can switch off the lasting-setting alert. | More sources, no device switch for its push, the old carrier, and the terminal's list. | 139 | 6.17 |
| TM2-6 | minor | `set-token` binds to whatever server is current. | The payload names the origin, a mismatch is refused, and the terminal shows the server first. | 138 | 6.14 |
| TM2-7 | minor | An account's environment can read the token slot. | The reserved prefix is refused by the planner, the runner and collection. | 138 | 1.39, 6.13 |
| TM2-8 | minor | Collection at run time can delete a new secret. | Collection stays at start-up, and a clear removes one value. | 130 | 1.39 |
| TM2-9 | minor | The reserved device id names places that cannot hold it. | The event schema and the side-row insert enforce it. | 154 | 1.34 |
| TM2-10 | minor | `client.thread` gives an agent raw text, and the allow-list goes. | An agent's page is in the data envelope, and the derived tool list is pinned. | 140 | 2.5, 3.3 |
| TM2-11 | minor | The carrier's server has no canonical form. | The URL parser, one canonical origin, and a topic rule. | 138 | 6.15 |
| TM2-12 | minor | "Accounts without secrets" is undefined. | Names and flags with no values, a warning in the setup document, and an issue. | 141 | 3.1, 10.3 |
| TM2-13 | minor | The security documents state more than the design delivers. | One sentence in each, and one list of the exceptions. | 142 | none; a document change |

## Architect review (`round-2-architect-sol.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| R2-A1 | major | Live collection has no writer boundary. | The same fix as TM2-8. | 130 | 1.39 |
| R2-A2 | major | An earlier success prevents delivery after a carrier change. | The delivery generation. | 131 | 6.8, 6.11 |
| R2-A3 | major | The first-start scan cannot list a piece's matters. | A per-piece `openMatters(views)`. | 136 | 6.16 |
| R2-m1 | minor | The reserved-id check names the wrong places. | The same fix as TM2-9. | 154 | 1.34 |
| R2-m2 | minor | An oversized global event has no thread to read it from. | `client.event`. | 137 | 3.8 |

## Critic review (`round-2-critic-sol.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| C2-01 | major | An oversized state event moves the cursor with no state or recovery. | The client library reads and applies it first, with `client.event`. | 137 | 3.8, 7.14 |
| C2-02 | major | Rotating the slot overwrites the token before the log commits. | A fresh name for each value, selected by the event. | 138 | 6.14 |
| C2-03 | major | A settled-only read cannot give the promised early exit. | The stream's named events also trigger the read. | 135 | 3.6 |
| C2-04 | minor | The uniqueness check runs too late. | It compares the groups before the merge, with a negative fixture. | 155 | 1.3 |
| C2-05 | minor | Resume's follow-up writes lose the acting device. | The device travels with the caller through `reload`. | 152 | 1.11 |

## Logic review, Sol (`round-2-logic-sol.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| R2-L1 | blocker | Run-time collection can delete a secret before its commit. | The same fix as TM2-8, with a named barrier test. | 130 | 1.39 |
| R2-L2 | major | An oversized state event leaves the page's picture wrong. | The same fix as C2-01. | 137 | 3.8, 7.14 |
| R2-L3 | major | Carrier replacement has conflicting rules and no generation. | The delivery generation. | 131 | 6.11 |
| R2-L4 | minor | The reserved-id check names a factory with no id. | The same fix as TM2-9. | 154 | 1.34 |

## Threat model review, Sol (`round-2-threat-model-sol.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| R2-TM-1 | major | Run-time collection can remove a committed credential. | The same fix as TM2-8. | 130 | 1.39 |
| R2-TM-2 | major | Replacing a revoked token has no recovery for exhausted alerts. | A token change makes undelivered alerts pending, and retries never stop. | 131 | 6.11 |

## Logic review, Opus (`round-2-logic-opus.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| Major 1 | major | Run-time collection can delete a secret just stored. | The same fix as TM2-8. | 130 | 1.39 |
| Major 2 | major | A withdrawal on the recovered path leaves an agent working. | The same batch writes `StateChanged idle`. | 143 | 1.43 |
| Major 3 | major | Exhaustion loses the phone alert for good. | Retries continue at the cap, and `final` is only a mark. | 131 | 6.11 |
| Major 4 | major | Oversized markers and the snapshot leave open requests undefined. | The snapshot's rows, and marker recovery. The stated-maxima test uses the page budget. | 137 | 2.6, 3.1, 3.8 |
| Major 5 | major | A question's alert never returns after a resume. | A level rule raises it again. | 144 | 6.2 |
| Minor 1 | minor | A dismiss has no source event. | `sourceSequence` is optional, and only a reactor's write moves the position. | 145 | 6.2 |
| Minor 2 | minor | The held rule has no precedence over the member table. | A truth table, and a decision on descendants. | 146 | 3.6 |
| Minor 3 | minor | "After every batch" contradicts "no polling". | The engine's part runs after every batch, and a piece's list at named reads. | 135 | 3.6 |
| Minor 4 | minor | `board.WakeBuilt` cannot name a delivery the path mints. | Requests follow the planner's events, and the event names the source id. | 147 | 1.20 |
| Minor 5 | minor | A connection is not judged again when the settings change. | The same fix as TM2-4. | 140 | 5.16 |
| Minor 6 | minor | The filter has no combination rule. | A truth table, and an empty list is refused. | 148 | 3.4 |
| Minor 7 | minor | Edit E16 covers only a queued delivery. | Queued or sent. | 149 | 1.15 |
| Minor 8 | minor | Edit E2 and section 2 misstate `pass-up`. | Both sentences are corrected. | 149 | 1.4 |
| Minor 9 | minor | The client's fold of the wait inputs has no home. | `settled.ts`, with a property test. | 150 | 3.5 |
| Minor 10 | minor | The web server's outage has no writer or lifetime. | The supervisor writes it, held until ready, one across restarts. | 151 | 5.15 |
| Minor 11 | minor | The rollback's step has no command. | `client.alerts.carrier.set` takes "none", and `set-token` needs a server. | 138 | 6.14, 6.15 |
| Minor 12 | minor | The first-start scan cannot find a piece's matters. | The same fix as R2-A3. | 136 | 6.16 |
| Minor 13 | minor | The lasting-setting alert goes through the setting it reports. | The same fix as TM2-5. | 139 | 6.17 |
| Minor 14 | minor | A read's marks do not record the device. | The batch table says so. | 152 | 1.11 |
| Minor 15 | minor | A rescan can raise a false alert, and E28 leaves a request unexplained. | The source skips a closed subject, and the reason is named. | 153 | 1.41, 6.1, 7.12 |
