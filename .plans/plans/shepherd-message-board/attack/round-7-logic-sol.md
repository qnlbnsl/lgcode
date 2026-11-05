revise
Grade: 7  B/M/m: 0/1/0  Flags: none

## Review scope and evidence

This review covers only the acknowledgement change in decision rows 152 to 155 and its consequences. The reviewed checkout is clean at `9e386b0b0fef88a1951a1a088ed5ac78e6b711cc`. No repository file was changed.

In the citations below, `contract.md`, `plan.md` and `decisions.md` are the frozen files in `board-r7/shepherd-message-board/`. The `inputs/` paths are relative to `board-r7/`. All `packages/` citations refer to the recorded engine commit. This is a review of decisions, not verification of the future board implementation.

## Findings

### R7-L1. MAJOR. An accepted delivery can end in an error without the turn-end event that advances the new rule

Category: Bug, failure handling. Evidence status: confirmed. Responsible builder: the board backend builder, coordinating any required engine change with the client API builder.

The new reminder and `no-answer` steps require a recorded non-compaction `TurnEnded` after taking the question or accepting its reminder (`contract.md:465`, `contract.md:474`, `contract.md:483`). The fourth hold-unsettled clause also depends on the turn-end sequence (`contract.md:547`). The plan does not provide another terminal-error transition for these duties.

The cited engine does not persist that event for an ordinary failed turn. A content update can accept the delivery before the terminal reply (`packages/engine/src/routing/deliveries.ts:111`). An ordinary error calls `failed`, which returns the delivery and writes `StateChanged idle` (`packages/engine/src/routing/deliveries.ts:130`, `packages/engine/src/routing/deliveries.ts:171`). Although the runner subsequently emits its internal `turnEnded` signal (`packages/engine/src/runner/AcpRunner.ts:271`, `packages/engine/src/runner/AcpRunner.ts:276`), `currentTurn` requires the agent still to be working (`packages/engine/src/routing/deliveries.ts:81`). Consequently, the handler's call to `turnEnded` produces no event once that error has made the agent idle (`packages/engine/src/routing/deliveries.ts:92`, `packages/engine/src/commands/CommandHandler.ts:153`).

Two concrete consequences follow from this one missing transition:

1. An otherwise idle addressee accepts question P, optionally acknowledges it, and then gets an ordinary terminal error without replying. There is no post-acceptance `TurnEnded`. P is already read, and an accepted-then-returned wake is deliberately neither retried nor counted (`contract.md:397`). Neither incoming-post hold-unsettled clause applies: one requires an unread post, and the other requires a later turn end (`contract.md:542`, `contract.md:547`). With no other duties, an agent wait or the owner's sequence-checked wait can therefore finish as settled without a reminder, `no-answer`, or the promised notice.
2. P's original turn succeeds, so the reactor sends its one reminder. The reminder is accepted and then its turn gets an ordinary error. The earlier successful turn end keeps the fourth hold-unsettled clause true, but there is no turn end after the reminder's acceptance to permit `no-answer`. The accepted reminder is not retried. With no later external turn, the wait stays open indefinitely. Restarting reconstructs the same sequences and cannot supply the missing event.

The board and sheepdog have independent switches. A later sheepdog nudge can incidentally supply another turn, but the board's new durable, bounded rule must not require that unpromised intervention to complete. This does not challenge the accepted rule against retrying an already accepted delivery.

Suggested fix: explicitly cover an ordinary terminal failure after acceptance in the plan's durable turn-ending policy. If `TurnEnded` remains the sole trigger, plan the engine adjustment needed to record that terminal end despite the transition to idle, with wait checks seeing the corresponding board hold in the same batch. Preserve the single-reminder bound, the no-timer rule, and the rule against replaying an accepted delivery. Add the initial-question and reminder-error cases to criteria 4.6 and 4.13 (`plan.md:808`, `plan.md:815`).

A source probe executed the recorded commit's extracted `failed` and `turnEnded` functions with an accepted delivery. It produced `DeliveryReturned`, `StateChanged idle`, then an empty result for the following turn-end signal. The probe used an owner sender to avoid dependencies on the future piece-source representation; it establishes the engine transition, not board integration. Its first extraction attempt used an incorrect comment delimiter and failed before execution. Correcting the delimiter and asserting extraction bounds made the probe pass. No probe files were written. The full suite was not run; this checkout has no `node_modules`.

## Risk register

| Id | Severity | Fallout | Probability | Score and band | Evidence | Owner | Decision and deadline |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R7-L1 | 6. A promised wait or durable failure notification is wrong until another action repairs it. | 3. The owner can repair the affected run by prompting or closing the post. | 4. One ordinary provider or adapter failure after acceptance is sufficient. | 72, schedule. | Confirmed from the recorded engine and frozen rules. | Board backend builder, with the client API builder for the engine transition. | Owner decision pending. Within this phase, or a dated follow-up with an owner. |

There is no closing evidence yet.

## Truth table for the interacting rules

This table assumes no unrelated duty unless the row names one. Its sources are `contract.md:433`, `contract.md:474`, `contract.md:499`, `contract.md:506`, and `contract.md:532`.

| State | Wake or disposition duty | Settled and waiting consequence |
| --- | --- | --- |
| Unread open question, with no carrying wake | Queue the original wake. | The unread-question clause holds unsettled across repair. |
| Read without acknowledging, while the original wake is still queued | Keep the original wake. | The queued delivery prevents settling. |
| Acknowledged, with only the original question queued | Withdraw it in the acknowledgement transaction. | A successful later turn end must create the reminder duty before any wait finishes. |
| Acknowledged, with another question, completion, notice or reminder queued | Rebuild from the remaining duties. | The remaining delivery continues to prevent settling. |
| Taken, successful turn ended, no disposition or dependent work | Queue one reminder. | The fourth clause bridges the interval before queueing. |
| Reminder accepted, a subsequent successful turn ended, no disposition or dependent work | Write `no-answer` and owe the asker's notice. | The addressee may settle; incoming still holds; an agent asker's open post keeps that asker unsettled. |
| Own open must-reply post, healthy owed completion, or open non-blocking wait | Defer the reminder and `no-answer`. | The own-post, completion or engine condition still prevents settling. |
| Ordinary error after the original acceptance | No qualifying recorded turn end. | R7-L1: the wait can finish early. |
| Ordinary error after the reminder acceptance | No qualifying second recorded turn end. | R7-L1: the existing hold can remain indefinitely. |
| Paused or interrupted | Defer this rule; apply the existing reload and lifecycle policy. | Existing engine wait outcomes remain applicable. |
| Open capacity hold, including an empty held queue | Keep duties behind the hold. | The engine prevents settling until release; cleanup must not release the hold. |
| Stop, crash or leaving, including after `no-answer` | Resolve `gone` or `removed` and apply normal cleanup. | The reminder must not outlive its duty. |
| Another addressee replies in `any` mode | Close and remove other queued reminders. | A completion replaces the open-post duty as specified. |
| Another addressee replies in `all` mode, with one at `no-answer` | Keep the collection open. | The asker remains unsettled until the outstanding part ends or the post is closed. |

## Proposed post-build checks

1. **PB-R7-1, board backend and engine.** Exercise R7-L1 through the real runner-event handler, both with and without explicit acknowledgement, before and after reminder acceptance. Include a restart after each terminal-error batch. Require the log, rebuilt view, board status, engine wait and owner helper to agree that there is no premature settlement or permanent reminder hold.
2. **PB-R7-2, board backend.** Kill between reminder construction, queueing, acceptance, turn end, `no-answer`, notice queueing and notice acceptance. Repeat each reactor run. Require at most one accepted reminder and one notice per post and target, subject to the stated bounded return policy. Include late replies and stop, crash and leaving races. Evidence must include persisted events and rebuilt-view equality.
3. **PB-R7-3, board backend.** Acknowledge original-only and mixed wakes, a returned wake and a wake behind a capacity hold. Require original-question removal, preservation of the other duties and of the hold, no removal of a reminder, and no recall of a sent wake. Close in both reply modes. Check engine and owner waits at every complete batch.
4. **PB-R7-4, board backend.** Keep each deferral condition open separately, then finish the dependent work and its response turn. Require no premature reminder or `no-answer`. Test the mutual-question case with the sheepdog enabled as an integration control, without adding another board reminder policy.
5. **PB-R7-5, board and web builders.** Verify the owner's wait across `TurnEnded` and `board.AddresseeResolved`, using a status result and stream at the same sequence. Check live and first-start `board.no-answer` alerts for a post with multiple silent addressees: one alert key per post, the intended thread target, and clearing on close.
6. **PB-R7-6, board backend.** Measure the final encoded `{ requestId, data }` frame, including string escaping and envelope overhead. Fill pages with quotes, backslashes, control characters and multibyte text. Require the stated 512 KiB cap and the client API's 900 KiB budget to hold, with correct cursors and marks for only the returned items. Require the shared `agentReadReply`, fresh markers and unchanged tool and command-line output (`contract.md:606`, `contract.md:616`; `plan.md:869`).

## Noted, not filed

The acknowledgement authorization, idempotence and queued-wake cleanup are consistent at the decision level. Reading alone retains the safety net. Acknowledgement does not discharge a completion or end the incoming duty (`contract.md:435`, `contract.md:445`, `contract.md:454`).

The successful-turn path has a finite per-post and target bound. Its notices create no new posts. The count and acceptance sequences have a log-backed representation; their actual folding and restart behavior remain post-build checks (`contract.md:478`, `contract.md:523`; `plan.md:530`). No separate loop finding was found.

Keeping `no-answer` open, allowing a late reply, retaining `holdsIncoming`, and deferring while dependent work remains are explicit decisions, not findings. The owner's wait already watches the chosen resolution event and rechecks status before ending (`contract.md:553`, `contract.md:565`, `contract.md:582`).

The roles plan explicitly covers idle dependency cycles with its stall rule and long active turns with its runaway rule (`inputs/roles-plan.md:887`, `inputs/roles-plan.md:944`, `inputs/roles-plan.md:945`). No additional confirmed break in that coverage was found. This does not repair R7-L1's board wait behavior.

The labelled-read decision names one shared builder and requires measuring the wrapped reply. No separate confirmed envelope defect was found; final wire-size measurement is PB-R7-6. The known gaps were not re-filed. Findings are recorded here for the lead to carry into the repository's issue list; the read-only brief permits no issue-list edit.

The assigned scratch directory was empty and was removed. This result is the only file written.
