# What the foundry roles need from the other two contracts

Written by the lgtm-foundry-roles planner on 2026-11-03, for the lead to
pass to the client API planner and the message board planner before their
contracts freeze. Each item says what the roles do with it. "The stall watch"
is piece 4's background watcher: it notices stalled, paused and failing
agents and nudges them or tells their lead, without spending their turns.

Facts these requests rest on, from `scouting.md` (Scout E): the engine has
no read command besides `subscribe`; an agent's `subscribe` shows only
itself and its direct children; a device credential acts as the full owner;
the engine records no token or prompt-cache usage; nothing in the engine
reads an agent's `role`.

## From the client API (piece 2)

1. **A roster query.** List agents with id, name, role, groups, parent,
   lifecycle state, open requests and questions, harness, account, model,
   effort, permission mode, folder, ACP session id and start time, filtered
   by group, role or parent. An agent may list its own subtree; the owner
   lists everything. The roles use it for `orient` (who am I, who is my
   parent, who are my children), for the Foundry's replacement of
   `herdr agent list`, and for the wrap-up attribution table.
2. **A thread read.** Read one agent's thread from a sequence number, and
   export it to a file. The roles use it to archive a finished team (Foundry
   Step 8) and to build a replacement worker's hand-off from records.
3. **A credential for an LGTM Studio service that is neither the owner nor an
   agent.** The stall watch and the standing-rule answerer must act without the
   owner's full rights, and the log must say "the stall watch" or "standing
   rule 4", not "the owner". Needed rights: subscribe to every event; prompt
   any agent with a nudge; ask an idle agent to compact; answer a permission
   request with a one-time allow, within the asker's ceiling, naming the
   rule; resume an agent after a capacity error. Nothing else: no `start`,
   no `accounts`, no `harnesses`, no "allow always". If the client API's
   device credentials can carry a scope, a scoped credential is enough;
   otherwise this is an engine change (see the question to the lead).
4. **Owner commands for the roles' settings,** so a phone is not
   second-class (AGENTS.md rule 5): list, add, disable and remove standing
   permission rules; read and change the stall watch's thresholds; snooze the
   stall watch for one group. These are owner-only.
5. **Alert kinds the roles raise.** The stall watch raises "agent stalled",
   "replace this worker", "runaway work" and "standing rule used for the
   first time". The client API's phone alerts should accept these, or say
   which of them are owner alerts and which stay on the board.
6. **Subscribe filters by group and by event kind.** Useful, not required:
   the stall watch can filter on its side.

## From the message board (piece 3)

1. **One delivery interface for every nudge.** The stall watch's "wake once"
   and its notices to a lead go through the board's delivery interface, so
   an ACP agent and an interactive agent get them the same way (AGENTS.md,
   "How agents are run").
2. **A work state per agent** (Synapse-list item 23: assigned, working,
   waiting on whom, done), recorded as events. The stall watch's stall rules
   (item 24) read it. If the board does not own work state, say so, and the
   roles will derive it from engine states and waits.
3. **A "work done" signal** that replaces the `RESULT: done` line in a
   result file, so a collection does not need file watching.
4. **A system author and a needs-reply kind,** so a stall watch notice to a
   lead is labelled as coming from LGTM Studio and wakes the lead at once.
5. **A team is an engine group.** The roles put a team's agents in one
   group label; the board should treat that group as the team's channel, so
   there is one membership list, not two.
6. **A hook for "deliver before the prompt cache expires".** The stall watch
   knows each Claude agent's cache deadline. The board's wake rules should
   either ask for it or accept a "flush now" from the stall watch, so posts that
   can wait arrive before the cache expires and not after.
7. **Who may wake whom.** The board's wake rules decide who receives a
   post. The stall watch only nudges an agent that is idle with work, so it
   needs to read whether a post is waiting for that agent.
