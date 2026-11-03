# The message board's contract

Status: **draft, for the foundry-roles plan to build on.** Written by the
board's planner on 2026-11-03. A later change to this file goes to
`plans-lead` as a question first. The board's plan is
`.plans/plans/shepherd-message-board/plan.md`; its decisions are rows in
`decisions.md` in the same folder, named in brackets below.

This contract assumes the answer to the board's question Q1 is "yes": the
board is built inside the engine's process, adding to the engine without
changing anything that exists (row 9). The lead has sent that question to
the owner. The board is a "piece" registered through the engine extension
point that the client API plan's first unit builds (rows 32, 34). Names and
shapes follow the client API's frozen contract v2
(`.plans/plans/shepherd-client-api/contract.md` on `worker/plans-api` at
`75ab185`, with the addendum `cd1d836` and seam items 13 and 14; row 42).
If the owner says "no", this file is withdrawn and rewritten.

## What the board is

The message board is the part of Shephrd that lets agents and the owner
talk in channels, and that decides who is woken by a message. It is built
on the engine. It adds commands, events and one internal module, and it
reaches agents only through the engine's own delivery queue.

The board knows nothing about teams, roles, phases or workflows (`AGENTS.md`
rule 6). The roles plan decides which channels exist and who is in them.

## Words used here

- **Member:** an agent, or the owner, who may read a channel and post in it.
  The owner can read and post in every channel without being listed.
- **Holder of an agent:** the agent's nearest ancestor that is idle or
  working, as the engine's `holderAbove` finds it, or the owner when there
  is none. This is the engine's rule for who may prompt an agent.
- **Wake:** an engine delivery that the board queues for an agent. It
  costs the agent one turn.
- **Live agent:** an agent that is not stopped and not crashed.

## Channels (rows 10, 11, 12, 27)

- A channel has an id, a name, a manager, a member list, and an optional
  engine group label.
- **Plain channel.** Opened with `board.open`. The opener is its manager. A
  manager may add an agent it holds, and its own holder. A manager may
  remove any member. When a manager stops or crashes, its rights pass to
  its own holder.
- **Group channel.** Opened with `board.open` and a group label. Its members
  are the live agents that carry that label in the engine, and they change
  when the engine's `group` command changes the label. Only the owner, or
  an agent that holds or is held by every agent carrying the label when the
  channel opens, may bind a channel to a label. A group channel is the
  roles plan's "team channel": there is one membership list, the engine's
  group (roles request 5: **accepted**).
- **Direct channel.** Opened implicitly by `board.post` with a `direct`
  target. It has exactly two members: two agents, or one agent and the
  owner. An agent may open one with its holder, with an agent it holds, or
  with an agent it already shares a channel with. The owner may open one
  with any agent. The pair has one direct channel.
- Limits: at most 64 members; a name is a slug of at most 64 characters,
  unique among open channels (row 25).

## Posts (rows 14, 15, 16, 26, 28)

A post has:

| Field | Meaning |
| --- | --- |
| `postId` | The board's id for it. |
| `channelId` | The channel it is in. |
| `author` | The owner, an agent, or a Shephrd service by name. |
| `text` | At most 16,384 characters, redacted before it is written. |
| `to` | Its addressees: members of the channel, or the owner. At most 16. |
| `reply` | `none`, or `any` or `all`: whether it needs a reply, and from how many addressees. |
| `replyTo` | Optional: the post it answers. |

- **Who is woken.** A post whose `reply` is `any` or `all` wakes exactly its
  addressees, minus its author. A post whose `reply` is `none` wakes
  nobody. A post that needs a reply must name at least one addressee.
- **Closing.** A post that needs a reply stays open. In `any` mode, the
  first reply from an addressee or the owner closes it. In `all` mode, it
  closes when every live addressee has replied. At the close, the author is
  woken once, with the replies. A reply from anyone else closes nothing.
- **A collection is a post in `all` mode.** A lead's hand-off post to three
  workers, in `all` mode, wakes the lead once, when the last worker
  replies. This is the "work done" signal that replaces `RESULT: done`
  lines (roles request 3: **accepted**, in this form).
- **Unanswerable posts.** A post that needs a reply cannot be addressed to
  an agent that is already stopped or crashed. When every remaining
  addressee of an open post stops or crashes, the post closes as
  unanswerable and its author is woken once, with the reason. When the
  author stops or crashes, its open posts close as withdrawn, and nobody is
  woken. A paused or interrupted addressee keeps the post (row 21).
- **The owner as addressee.** A post that needs the owner's reply raises
  one owner alert of kind `board.post`, keyed `post:<postId>`, through the
  client API's alert sources. It ends when the post closes. The board never
  writes the engine's `OwnerNeeded` (row 35).
- **Shephrd as author** (roles request 4: **accepted**; the "needs-reply
  kind" part is already the `reply` field, so no kind label is added). A
  post from one of Shephrd's own services, such as `roles.sheepdog`, records
  that service's name as its author. Services exist only inside Shephrd's
  process and call commands through the extension point's in-process path
  (client API contract, section 2, "Services"). No socket or network caller
  can set a service author, so an agent cannot forge a Shephrd notice
  (row 36).

## How a wake reaches an agent (rows 5, 17, 18, 23)

- Every wake is an engine delivery: content `prompt`, with the piece
  source `{ namespace: "board", id: <wake id> }` (rows 23, 37). The
  engine's dispatcher sends it through `Runner.prompt` when the agent can
  take it. The board never reads an agent's run mode, so an ACP agent and an
  interactive agent are woken the same way (roles request 1:
  **accepted**; this is the one delivery interface).
- A wake's body is plain text. Each post in it sits between its own fresh
  markers, after a line saying who wrote it, in which channel, and what
  reply it needs, with a leading slash escaped. The engine wraps the whole
  body in its agent-text envelope and shows the sender as the board (client
  API contract, seam item 14; row 41).
- An agent has at most one board wake waiting to be sent. A new wake for
  it withdraws the waiting one and queues one combined wake, in the same
  transaction. A wake already sent is never changed.
- A wake also carries up to 20 of the agent's unread posts that did not
  need its reply, with a count of the rest.
- A wake for an agent that stops or crashes is withdrawn and never returned
  to anyone.
- A queued or sent wake makes its target "not settled" in the engine's
  terms, so a `wait` on that agent does not end while it still has a post
  to read.
- An agent with an open post of its own that needs a reply is also not
  settled. The board registers this condition with the extension point; a
  `wait` on a lead that is waiting for a board answer does not end early
  (row 33).

## Reading

- A member reads a channel's posts with `board.read`, in the client API's
  paged-read shape: `after`, `limit` (at most 200), and a reply of `items`
  and `next` (row 39). Reading moves the member's read position for that
  channel.
- A wake's posts count as read when the engine records the wake as
  accepted.
- Every board event is `owner-only`: the live stream shows it to the
  owner, the owner's devices and Shephrd's services, and to no agent.
- **Privacy.** Through the board, a channel is readable only by its members
  and the owner. A member's parent can still see what the member was sent
  and read, because the engine shows a parent its child's whole thread.

## Commands the board adds to the API

Every command goes through the engine's command handler, through the
extension point, so it has the engine's caller identity, request ids,
receipts and one transaction per command. Each command whose access
includes agents is a Shephrd tool for agents and a `shephrd board <name>`
subcommand. "Owner" includes the owner's paired devices; a device's post is
recorded with the owner as author and the device in the log's `device`
field (row 40).

| Command | Who may call it | What it does |
| --- | --- | --- |
| `board.open` | The owner, or any agent | Opens a plain or group channel and returns its id. |
| `board.members` | The owner, or the channel's manager | Adds or removes members of a plain channel. |
| `board.post` | The owner, a member, or a Shephrd service | Writes a post in a channel, or in a direct channel with `direct`, and queues its wakes. Returns the post id. |
| `board.read` | The owner, or a member | Returns a page of a channel's posts after a cursor, or the caller's open posts, and moves the caller's cursor. |
| `board.channels` | The owner, or any agent | Lists the channels the caller can read. |
| `board.status` | The owner, a Shephrd service, the agent's holder, or the agent itself | For one agent: unread counts, open posts waiting for its reply, its own open posts and whom each waits on, and whether a board wake is queued or sent (roles request 7: **accepted**). |
| `board.flush` | The owner, or a Shephrd service; never an agent | Queues one board wake now with the agent's unread posts, if it has any (roles request 6: **accepted** in this form). |

## Events the board adds to the log

`board.ChannelOpened`, `board.ChannelMembersChanged`, `board.PostWritten`,
`board.PostClosed` and `board.Read`. Their schemas are in
`packages/board-contracts`, as `BoardEvent`. None has a top-level `agentId`
field, and all are `owner-only`. Every one is rebuilt into the board's view
from the log, and the engine's rebuild check covers it.

The board also queues and withdraws engine deliveries, through the
extension point's planning helpers, with its own piece source.

## For Shephrd's own services

A roles service, such as the sheepdog, uses the board through the
extension point's in-process command path, under its own service name:

- `board.post`, to post a notice. Its author is the service's name.
- `board.flush`, to hand an agent its unread posts now.
- `board.status`, to read whether a post is waiting for an agent.
  `packages/board` also exports the same answer as a pure function over
  the board's view, for code that already holds a snapshot.

## What the board refuses, and why

- **A work state per agent** (roles request 2: **refused**). Work states and
  work items are outside the board's plan (row 4). The roles plan can
  derive "assigned, working, waiting on whom, done" from the engine's
  states and waits and from `board.status`, which already says whom each
  open post waits on.
- **Tracking prompt-cache deadlines** (part of roles request 6:
  **refused**). Cache timing is harness-specific and belongs to the roles
  plan. The board gives the sheepdog `board.flush` to act on it.
- **Kind labels** such as question, blocked, hand-off and done (part of
  roles request 4). A kind list is a workflow vocabulary. The `reply` field
  carries the only thing the wake rule needs. Kinds are recorded as a
  feature idea.

## What the board does not do

- It does not steer a message into a running turn. ACP cannot add to a
  running turn, so a wake for a working agent waits until the turn ends.
- It does not build interactive-mode delivery. When that runner is added,
  it receives the same deliveries.
- It writes no system posts of its own for joins, exits or state changes.
  Those are engine events.
