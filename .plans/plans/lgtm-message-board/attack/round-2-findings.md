# Round 2 findings and where each is folded

Round 2 reviewed plan version 2 (`attack/plan-v2.md`) and contract version
3 (`attack/contract-v3.md`). Six reviews came in: architecture, critic,
logic (two models) and threat model (two models). Together they filed 0
blockers, 24 majors and 15 minors, with no refusals. The reviews are copied
here as `attack/round-2-*.md`. The lead's rulings for this round are L17
(an agent and a service may share a direct channel, post #86), L18 (group
membership follows the fixed tree through the manager, and the manager is
always a member) and L19 (the dispatcher re-checks the board's reach check
when it sends), both in post #89.

Every finding is folded into plan version 3. Findings about the same
problem share one decision row. "Row" means a row in `decisions.md`;
"criterion" means a criterion in `plan.md`.

## Shared fixes

| Problem | Findings | Row | Proved by |
|---|---|---|---|
| Group membership followed holder availability, and the manager was not a member | C2-01, R2-L3, logic M2, threat S4 | 65 (L18) | Criterion 2.6 |
| An owner-opened group channel took in any labelled agent | threat S3 | 66 | Criterion 2.6 |
| A queued wake could be sent after reach was lost, and rebuilt wakes had no rule for old posts | C2-04, R2-TM-1, logic M3 | 67 (L19) | Criteria 2.11, 4.9; post-build check 7 |
| A direct channel's open questions were stranded when its grant ended | R2-A4, C2-03, R2-L2 | 68 | Criteria 2.7, 4.4 |
| The asker's closing notice could be lost | R2-A2, C2-02, R2-L4, logic m1, logic m5 | 69 | Criteria 3.3, 3.5, 4.2, 4.3 |
| An interrupted addressee that cannot reload was never resolved | R2-A3, R2-L1, logic M4 | 70 | Criteria 3.12, 4.1, 6.5; post-build check 12 |
| The owner's board snapshot could pass 1 MiB | R2-A1, threat S1, R2-TM-2 | 71 | Criterion 5.9; post-build check 13 |
| A 256 KiB wake could pass 1 MiB once JSON-encoded | C2-05, threat m1, R2-TM-3 | 72 | Criterion 3.8; post-build check 9 |
| Rule 4 compared current modes, not ceilings | threat S2, logic m7, threat m4 | 73 | Criterion 2.9 |
| Receipts were missing from the store list | threat m5, R2-TM-4 | 75 | Criterion 5.11 |

## Every finding

### Architecture review (`round-2-architect-sol.md`)

| Finding | Severity | Folded as |
|---|---|---|
| R2-A1. The full board snapshot defeats the transport size limit | Major | Row 71: no post text, a 256 KiB cap, `truncated` with a `board.status` fallback (lead ruling L21, row 83) |
| R2-A2. Returned completion wakes lose the answer they owe the asker | Major | Row 69: completions are durable, carried in `board.WakeBuilt`, discharged only on acceptance |
| R2-A3. An unreloadable interrupted addressee need not emit the event the reactor watches | Major | Row 70: resolved on `AgentInterrupted` by the engine's own test, and at start-up catch-up |
| R2-A4. Revoking a direct channel's grant strands an existing direct question | Major | Row 68 |

### Critic review (`round-2-critic-sol.md`)

| Finding | Severity | Folded as |
|---|---|---|
| C2-01. A group-channel manager cannot use the channel it opens | Major | Row 65 under L18: the manager is always a member |
| C2-02. Completion wakes have no durable lifecycle after they are queued | Major | Row 69 |
| C2-03. Revoking the shared-channel relationship strands existing direct questions | Major | Row 68 |
| C2-04. Group revocation can commit before the reactor removes an unsent copy | Major | Row 67 under L19: the dispatcher re-checks reach at send |
| C2-05. The UTF-8 wake cap does not bound the JSON event | Major | Row 72 |
| C2-06. The privacy criterion contradicts the stated thread exception | Minor | Row 81; criterion 6.3 rewritten with a positive control |

### Logic review, first model (`round-2-logic-opus.md`)

| Finding | Severity | Folded as |
|---|---|---|
| M1. Cleanup strips a post from every addressee's queued wake when one answers | Major | Row 82; criterion 3.5 |
| M2. Group membership and direct rights depend on lifecycle state | Major | Rows 65 (L18) and 68: both follow `parent` links |
| M3. No rule for a rebuilt wake carrying an old post that fails the reach check | Major | Row 67: per-post judgement; criterion 2.11 |
| M4. An interrupted addressee that cannot reload is never resolved | Major | Row 70 |
| m1. Reactor-queued wakes leave a window where the target counts as settled | Minor | Row 69 (8): the hold-unsettled condition covers it; criterion 4.3 |
| m2. The incoming condition counts "has not answered" | Minor | Row 77; criterion 4.7 |
| m3. A late reply from an addressee resolved `gone` is discarded | Minor | Row 70 (3): it counts as `replied`; criterion 3.12 |
| m4. An author may name itself in `to` | Minor | Row 78; criterion 3.12 |
| m5. An author is not told when someone else withdraws its question | Minor | Row 69 (1); criterion 3.3 |
| m6. A new member's read state starts at the first post | Minor | Row 79; criterion 2.3 |
| m7. The ceiling rule uses the current mode, so a narrowed lead cannot collect | Minor | Row 73; criterion 2.9 |

### Logic review, second model (`round-2-logic-sol.md`)

| Finding | Severity | Folded as |
|---|---|---|
| R2-L1. A non-reloadable interruption does not emit the selected event | Major | Row 70 |
| R2-L2. Revoking a direct channel's grant strands its questions | Major | Row 68 |
| R2-L3. Group membership changes with holder availability | Major | Row 65 under L18 |
| R2-L4. Completion notices are not independent reasons for a wake | Major | Row 69 |
| R2-L5. The byte-cap hint reads authored questions, not incoming ones | Minor | Row 80: `board.read` with `incoming`; criterion 3.8 |

### Threat model, first model (`round-2-threat-model-opus.md`)

| Finding | Severity | Folded as |
|---|---|---|
| S1. The board's snapshot section carries every post's text | Major | Row 71 |
| S2. The ceiling rule names no field, and the view holds the current mode | Major | Row 73: start ceilings, kept in the board's view |
| S3. An owner-opened group channel admits any agent's labelled child | Major | Row 66: the owner names an anchor |
| S4. Group membership narrows when the manager pauses and widens when it crashes | Major | Row 65 under L18: the anchor never moves |
| m1. The wake cap is measured before JSON escaping | Minor | Row 72 |
| m2. `board.status` may show post text to a non-member holder | Minor | Row 74 (1); criterion 5.6 |
| m3. The header contains the channel's agent-chosen name | Minor | Row 74 (2), (3): channel id only; slug pattern in the contract |
| m4. The ceiling claim is wider than rule 4 | Minor | Row 73: the claim is narrowed |
| m5. The store inventory leaves out receipts | Minor | Row 75; criterion 5.11 |

### Threat model, second model (`round-2-threat-model-sol.md`)

| Finding | Severity | Folded as |
|---|---|---|
| R2-TM-1. Group revocation can commit before an unauthorized queued wake is sent | Major | Row 67 under L19; the reach check stays registered when the board is off; criteria 4.9, 5.10 |
| R2-TM-2. The owner's full board snapshot cannot stay below the limit | Major | Row 71 |
| R2-TM-3. A 256 KiB UTF-8 wake can exceed 1 MiB once JSON-encoded | Major | Row 72 |
| R2-TM-4. The storage inventory omits command-receipt copies | Minor | Row 75 |

## Lead rulings folded

| Ruling | Row |
|---|---|
| L17, an agent and a service may share a direct channel | 76 (folding row 64) |
| L18, membership by the fixed tree; the manager is always a member | 65; the reading of "through the manager" confirmed as L21 (row 83) |
| L21, the answer to Q4 | 83 |
| L19, the dispatcher re-checks reach at send | 67 |
