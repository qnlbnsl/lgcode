# Question 1 for plans-lead: the roles need small engine additions

The roles are meant to sit on the engine without changing it. Scouting the
engine at `8ff4c9b` (`scouting.md`, Scout E) shows five places where that
cannot hold without a cost the Foundry would feel. May this plan include one
workstream of engine additions, built on `engine` and reviewed like an
engine unit? Or must each one be worked around?

**My recommendation: allow the workstream, items 1 to 4; item 5 is a choice.**
Each item below gives what is missing, why the roles need it, and the
workaround if the answer is no.

1. **An LGTM Studio service credential, below the owner.** The engine knows two
   callers: the owner (and devices, which act as the owner) and agents. The
   sheepdog is a separate program, because `service.ts` has no extension
   point. With only the owner's credential, every nudge, compaction and
   retry it makes is logged as the owner's, and a bug in it has the owner's
   full rights. The addition is a third caller kind, `service`, with a fixed
   list of allowed commands (subscribe, prompt as a nudge, compact, resume)
   and its own name in the log. Workaround: the sheepdog uses the owner's
   credential. That breaks the audit trail and widens a bug's reach.
   This may instead come from the client API's contract, if its device
   credentials can carry a scope (requests.md, item 3).
2. **Standing rules checked before a request is delivered.** Today a
   permission request is delivered to an idle holder at once, as a prompt.
   A rule answered from outside the engine arrives after that delivery, so
   the lead still pays a full wake for a request the rule settles. Saving
   those wakes is the reason for standing rules. The addition is a seam in
   `routing/permissions.ts:permissionRequested`: the engine asks the rule
   matcher (code this plan writes, in its own package) before it routes
   the request, and a match writes "answered by standing rule N" in the same
   transaction. The rules themselves are owner-only events. Workaround:
   rules answer from outside after the delivery; each match still costs the
   holder a wake.
3. **Capacity errors told apart from other errors.** `runner/classify.ts`
   knows "out of usage" and "signed out" only. A "model at capacity" or
   "529 overloaded" reply is returned to the sender as a failed delivery,
   which wakes the lead with a prompt. The addition is a third class that
   puts the message back in the queue and pauses the agent with the reason
   "capacity", so the sheepdog can retry it after five minutes, as
   `capacity-retry.sh` does today. Workaround: the sheepdog watches
   `DeliveryReturned` and re-sends; the lead is still woken once per error.
4. **Token and prompt-cache usage on `TurnEnded`.** The engine records no
   context size. Compaction timed to the prompt cache needs the last call's
   input and cache tokens and the cache's lifetime. The addition is optional
   usage fields on `TurnEnded`, filled when the adapter reports them.
   Workaround: the sheepdog reads Claude's transcript files from the
   account's config folder, as `context-keeper.sh` does. That works for
   Claude only and depends on a file layout the adapter does not promise.
5. **Role rules enforced, or only advised.** `role` is a free string that
   nothing reads. A rule such as "a worker cannot start agents" or "a worker
   does not ask the owner" can be enforced only in the command handler,
   which is an engine change. The other choice is that role rules are a
   briefing (what `orient` tells each agent) plus a sheepdog report when an
   agent breaks one. I lean to advice in this version, because enforcement
   is a product choice about how strict the Foundry should be. If the
   owner wants enforcement, it is a small addition to the command handler,
   reading a role table that the team's definition (outside this
   repository) supplies.
