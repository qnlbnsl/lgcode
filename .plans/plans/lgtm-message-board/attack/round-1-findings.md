# Round 1 findings and where each is folded

Round 1 reviewed plan version 1 (`attack/plan-v1.md`, frozen at
`44cd371`). Six reviews came in: architecture, critic, logic (two
models) and threat model (two models). Together they filed 0 blockers,
33 majors and 16 minors, with grades of 6 to 7. The reviews are copied
here as `attack/round-1-*.md`. The lead's rulings for this round are L13
(reach through channel membership, by a piece reach check) and L14
(exclusions without an owner quote are marked WIDENED), both in post #60.
The lead approved the board's six seam requests as L15 (post #69), and
the resulting contract change as L16 (post #75).

Every finding is folded into plan version 2. Findings about the same
problem share one decision row. "Row" means a row in `decisions.md`;
"criterion" means a criterion in `plan.md`.

## Shared fixes

| Problem | Findings | Row | Proved by |
|---|---|---|---|
| Who may wake whom: siblings, group channels, direct pairs, the permission ceiling | A1, C05, L6, threat M1, M2, M3 | 45, 61 | Criteria 2.6, 2.7, 2.9; seam item 15 |
| The wake index, requeued wakes and returned wakes | A2, C02, L1, logic M2, logic m1, threat M6 | 46 | Criteria 3.4, 4.3 |
| Queued wakes left behind when a post closes | A3, C04, L4 | 47 | Criterion 3.5 |
| Read state for a wake that carries only some unread posts | A4, C07, L2, logic M5, threat m3 | 48 | Criterion 2.3 |
| One outcome table for replies, crashes, stops and resumes | L3, logic M3, logic m2, logic m3 | 49 | Criteria 3.3, 4.1, 4.2 |
| Repairing a post, and leaving a channel | C03, logic M4, L5, TM-2, threat m6 | 49, 50 | Criteria 3.10, 4.4 |
| Deadlock with a blocking wait, the owner's wait helper, and the snapshot | logic M1, L7, logic m4, threat M0 | 51 | Criteria 4.7, 5.9, 6.3 |

## Every finding

### Architecture review (`round-1-architect-sol.md`)

| Finding | Severity | Folded as |
|---|---|---|
| A1. Channel messaging conflicts with the frozen caller rule | Major | Row 45, under lead ruling L13; the client API adds seam item 15 at `d72fe26` (row 61) |
| A2. The wake index ignores retry and return transitions | Major | Row 46: status is read from the engine's deliveries view; requeued wakes keep their place; a returned wake is re-queued once |
| A3. Closing a post leaves obsolete wakes queued | Major | Row 47; criterion 3.5 |
| A4. One read cursor cannot represent a partly delivered backlog | Major | Row 48; criterion 2.3 |
| A5. Rollback is unsupported once board records are in the log | Major | Row 58: rollback means "board disabled"; criterion 5.10 |
| A6. The restart guarantee is stronger than the engine's | Minor | Row 59; criterion 6.5 split into two cases |

### Critic review (`round-1-critic-sol.md`)

| Finding | Severity | Folded as |
|---|---|---|
| C01. Neither new package is registered with the test runner | Major | Criterion 1.9 (`pnpm vitest list`); known gap 5 names `vitest.config.ts`; rollout step 1 |
| C02. The wake view ignores real delivery transitions | Major | Row 46 |
| C03. Removing a live addressee can strand a question | Major | Rows 49, 50: the addressee is resolved `removed`; criterion 4.4 |
| C04. Closing a question leaves obsolete queued wakes | Major | Row 47; criterion 3.5 |
| C05. Sibling messaging conflicts with the frozen API rule | Major | Row 45 under L13; row 61 |
| C06. The scope exclusions are broader than the owner's words | Major | Row 44: four exclusions marked WIDENED, for the lead to confirm with the owner (L14); known gap 7 |
| C07. Selective wakes have no rule for read holes | Major | Row 48 |
| C08. The wait criterion overstates what the settled hook controls | Minor | Criterion 4.6 limited to idle agents, with a pause control case |
| C09. The document-update rule conflicts with the lead-only ruling | Minor | Row 60; the conventions paragraph |

### Logic review, first model (`round-1-logic-opus.md`)

| Finding | Severity | Folded as |
|---|---|---|
| M1. A blocking wait deadlocks on a board question to its waiter | Major | Row 51, the incoming condition (L15); criterion 4.7 |
| M2. A returned board wake is lost | Major | Row 46 (4); criterion 4.3 |
| M3. The board treats a crash as final, but a crashed agent can resume | Major | Row 49: an addressee's crash is final as `gone`, judged when it happens; an author's crash suspends its posts; criterion 4.2 |
| M4. An open post cannot be withdrawn, and outlives its addressees' membership | Major | Row 50: `board.close` and removal; criteria 3.10, 4.4 |
| M5. One read cursor cannot record a partial wake | Major | Row 48 |
| m1. The view ignores requeued deliveries | Minor | Row 46 (3) |
| m2. The wake set is not filtered to live agents | Minor | Row 49: the wake set holds live agents only |
| m3. `all` mode has two conflicting close rules | Minor | Row 49: one table |
| m4. The owner's `wait --block` and an agent's `wait` disagree | Minor | Row 51: `waitForAgents` applies the pieces' conditions (L15) |
| m5. Two channel limits cannot be enforced as written | Minor | Row 56 |
| m6. A reply need not be in its post's channel | Minor | Row 57; criterion 2.10 |

### Logic review, second model (`round-1-logic-sol.md`)

| Finding | Severity | Folded as |
|---|---|---|
| L1. The board omits delivery transitions the engine produces | Major | Row 46 |
| L2. One cursor cannot acknowledge a sparse set of posts | Major | Row 48 |
| L3. A partly answered collection has two outcomes after a crash | Major | Row 49 |
| L4. Closing a question leaves obsolete queued wakes | Major | Row 47 |
| L5. Membership removal has no rule for queued text or open questions | Major | Row 50 |
| L6. The frozen caller rule and sibling messaging disagree | Major | Row 45 under L13; row 61 |
| L7. A blocking engine wait can deadlock on a child's board question | Major | Row 51; criterion 4.7 |

### Threat model, first model (`round-1-threat-model-opus.md`)

| Finding | Severity | Folded as |
|---|---|---|
| M0. The board's part of `client.snapshot` is unfiltered for agents | Major | Row 51 (3), approved in L15; criteria 5.9, 6.3 |
| M1. A group channel can reach agents the opener never held | Major | Row 45, rule 3, including an empty label and re-checking at every join; criterion 2.6 |
| M2. Direct-message reach outlives the shared channel | Major | Row 45, rule 2, checked on every post; criterion 2.7 |
| M3. Board wakes skip the permission ceiling | Major | Row 45, rule 4; criterion 2.9 |
| M4. An agent's name can forge the author line | Major | Rows 52, 63: the header holds no agent-chosen name (lead ruling L16); criterion 3.6 |
| M5. No byte limits on wakes and read pages | Major | Row 53; criteria 3.8, 5.8; post-build check 9 |
| M6. A returned board wake is ignored | Major | Row 46 (4); criterion 4.3 |
| m1. Any agent can flood the owner's phone | Minor | Row 54; criterion 3.9 |
| m2. The privacy statement leaves out reading from disk | Minor | Row 55 |
| m3. No inventory of stored copies, and no deletion story | Minor | Row 55; row 48 writes `board.Read` only when it marks a post; a purge path goes to the lead as a possible issue |
| m4. Channel names can be squatted | Minor | Row 56: channels by id; names unique per manager |
| m5. The access table disagrees about whether a service can read | Minor | Criterion 2.8 and `contract.md` version 3: a service can post but not read |
| m6. A queued wake keeps a left channel's posts | Minor | Row 50 (3); criterion 4.4 |
| m7. A reply may sit in a different channel | Minor | Row 57; criterion 2.10 |

### Threat model, second model (`round-1-threat-model-sol.md`)

| Finding | Severity | Folded as |
|---|---|---|
| TM-1. A reply can forward a private channel's text to another channel's asker | Major | Row 57; criterion 2.10 |
| TM-2. Removing a member does not revoke pending wakes | Major | Row 50 (3), stating that sent text cannot be recalled; criterion 4.4 |

## Proposed post-build checks

Each review proposed checks that need code to answer. Those already
covered by a criterion are not repeated; the rest are in `plan.md`,
"Post-build checks", 1 to 11.

| Proposed check | Where it is now |
|---|---|
| ARCH-PB-1, PB-C05, PB-L6, SEC-BOARD-4 | Criteria 2.4 to 2.9, 6.3 |
| ARCH-PB-2, PB-C02, PB-L1 | Criteria 3.4, 4.3; post-build check 1 |
| ARCH-PB-3, PB-C03, PB-L4 | Criterion 3.5 |
| ARCH-PB-4, PB-C06, PB-L2, SEC-BOARD-6 | Criterion 2.3 |
| ARCH-PB-5 | Criterion 5.10 |
| ARCH-PB-6, PB-L8 | Criterion 6.5; post-build checks 1 and 11 |
| PB-C01 | Criterion 1.9 |
| PB-C04, PB-L5, SEC-BOARD-2 | Criterion 4.4 |
| PB-C07 | Criterion 4.6 |
| PB-C08 | Post-build checks 1 to 3 |
| PB-L3 | Criterion 4.1 |
| PB-L7 | Criterion 4.7 |
| PB-L9 | Criterion 4.5 |
| L-PB1 | Row 62; criterion 4.5 |
| L-PB2, L-PB3 | Post-build check 5 |
| L-PB4, L-PB6 | Row 62; criterion 3.11 |
| L-PB5 | Criterion 2.3; row 48 names one writer |
| TM-1 (threat, first model) | Criteria 5.9, 6.3 |
| TM-2 (threat, first model) | Criterion 3.6 |
| TM-3 | Post-build check 6 |
| TM-4 | Post-build check 4 |
| TM-5 | Post-build check 7 |
| TM-6, SEC-BOARD-3 | Criteria 5.2, 5.5; post-build check 8 |
| TM-7 | Post-build check 9 |
| SEC-BOARD-1 | Criterion 2.10 |
| SEC-BOARD-5 | Criterion 3.7; post-build checks 3 and 10 |
