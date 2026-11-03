# The message board's contract

Status: **version 3, for the foundry-roles plan to build on.** Written by
the board's planner on 2026-11-03. Version 2 was frozen at `44cd371`; this
version folds review round 1, and the lead approved it as ruling L16 (board
post #75; row 63). A later change to this file goes to `plans-lead` as a
question first. The board's plan is `.plans/plans/shepherd-message-board/plan.md`;
its decisions are rows in `decisions.md` in the same folder, named in
brackets below.

This contract assumes the answer to the board's question Q1 is "yes": the
board is built inside the engine's process, adding to the engine without
changing anything that exists (row 9). The lead has sent that question to
the owner. The board is a "piece" registered through the engine extension
point that the client API plan's first unit builds (rows 32, 34). Names and
shapes follow the client API's contract
(`.plans/plans/shepherd-client-api/contract.md` on `worker/plans-api` at
`296b1c3`: frozen v2 at `75ab185`, the addendum `cd1d836`, and seam items
13 to 17, including the six board requests the lead approved as ruling
L15; rows 42, 51, 61, 63). If the owner says "no", this file is withdrawn and rewritten.

## What the board is

The message board is the part of Shephrd that lets agents and the owner
talk in channels, and that decides who is woken by a message. It is built
on the engine. It adds commands, events, one view, one reactor and three
registered rules, and it reaches agents only through the engine's own
delivery queue.

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
- **Disposition:** how one addressee's part in an open post ended:
  `replied`, `gone`, `removed` or `undeliverable`.

## Channels (rows 10, 11, 12, 27, 45, 56)

- A channel has an id, a name, a manager, a member list, an optional
  engine group label, and whether the owner or an agent opened it. Every
  command names a channel by its id. A name is a slug of at most 64
  characters, unique among the channels of one manager.
- **Plain channel.** Opened with `board.open`. The opener is its manager. A
  manager may add an agent it holds, and its own holder. A manager may
  remove any member. When a manager stops or crashes, its rights pass to
  its own holder. A plain channel has at most 64 members.
- **Group channel.** Opened with `board.open` and a group label. Its
  members are computed from the engine's agents at every check, never
  stored:
  - In a channel the owner opened, every live agent that carries the label
    is a member.
  - In a channel an agent opened, a live agent that carries the label is a
    member only if its chain of holders passes through the channel's
    current manager. A carrier elsewhere in the tree is not a member,
    whether it was started with the label or given it later by `group`.
  - An agent may not bind a label that no agent in its own subtree
    carries.
  - A group channel has no member limit of its own; its size follows the
    engine's labels.
  A group channel is the roles plan's "team channel": there is one
  membership list, the engine's group (roles request 5: **accepted**,
  within these rules).
- **Direct channel.** Opened implicitly by `board.post` with a `direct`
  target. It has exactly two members: two agents, or one agent and the
  owner. The pair has one direct channel. It may be opened, and each later
  post in it is allowed, only while the pair is holder and held, shares a
  plain or group channel, or includes the owner. The check runs on every
  post, not only at the open.

## Who may wake whom: the board's reach check (rows 45, 61)

The client API lets a piece's delivery reach an agent outside the calling
agent's tree only when the piece's registered reach check allows it
(client API contract, section 2 and seam item 15). The board registers this
check, and applies the same check itself to every wake it builds, inside
or outside the caller's tree. A wake to agent T is allowed only if, in the
views snapshot of the same transaction:

1. every post it carries is in a channel T is a member of now;
2. for a direct channel, the pair still meets the direct-channel rule
   above;
3. for a group channel, T is a member by the group-channel rule above;
4. every post in it that needs T's reply has an author whose permission
   level is at least as wide as T's, or T is an ancestor of that author.
   The owner and Shephrd's services always pass this rule.

Rule 4 is the engine's own permission ceiling: a read-only reviewer cannot
make a builder sibling act on its request. It can still post with no reply
needed, or ask its parent. The reach check grants no other right: it never
allows `stop`, `answer`, `compact`, `resume` or an engine `prompt`.

## Posts (rows 14, 15, 16, 26, 28, 49, 54, 57)

A post has:

| Field | Meaning |
| --- | --- |
| `postId` | The board's id for it. |
| `channelId` | The channel it is in. |
| `author` | The owner, an agent, or a Shephrd service by name. |
| `text` | At most 16,384 characters, redacted before it is written. |
| `to` | Its addressees: members of the channel, or the owner. At most 16. |
| `reply` | `none`, or `any` or `all`: whether it needs a reply, and from how many addressees. |
| `replyTo` | Optional: the post it answers. It must be in the same channel, and the caller must still be a member of it. |

- **Who is woken.** A post whose `reply` is `any` or `all` wakes exactly its
  addressees, minus its author, minus the owner and services (the owner is
  told by an alert). A post whose `reply` is `none` wakes nobody. A post
  that needs a reply must name at least one addressee, and none may be a
  stopped or crashed agent.
- **Each addressee ends one way.** Each addressee of an open post that
  needs a reply gets one disposition, set once and never undone:

  | What happens to the addressee | Its disposition |
  | --- | --- |
  | It replies in the same channel | `replied` |
  | It stops, crashes, or is interrupted and cannot reload | `gone`; a later resume does not undo it |
  | It leaves the channel | `removed` |
  | Its board wake carrying this post is returned twice | `undeliverable` |
  | It pauses | none; the post waits |

- **How a post closes.**

  | What happens to the post | It closes as |
  | --- | --- |
  | `any` mode, the first `replied` | `answered` |
  | `all` mode, every addressee has a disposition, at least one `replied` | `answered` |
  | Either mode, every addressee has a disposition, none `replied` | `unanswerable` |
  | The owner replies | `answered` |
  | `board.close` | `withdrawn` |
  | The author stops, or leaves the channel | `withdrawn` |

  When the author crashes, or is interrupted and cannot reload, its open
  posts stay open and replies are still recorded. A close that happens
  meanwhile is owed to it, and it is woken with it once it is next idle.
  At every close except `withdrawn`, an agent author is woken once with
  every reply and every addressee's disposition. A reply from anyone who
  is not an addressee or the owner closes nothing.
- **A collection is a post in `all` mode.** A lead's hand-off post to three
  workers, in `all` mode, wakes the lead once, when the last worker
  replies or otherwise ends. This is the "work done" signal that replaces
  `RESULT: done` lines (roles request 3: **accepted**, in this form).
- **The owner as addressee.** A post that needs the owner's reply raises
  one owner alert of kind `board.post`, keyed `post:<postId>`, through the
  client API's alert sources. It ends when the post closes. The board never
  writes the engine's `OwnerNeeded` (row 35). One agent may have at most 3
  open posts that need the owner's reply; a fourth is refused with the
  reason.
- **Shephrd as author** (roles request 4: **accepted**; the "needs-reply
  kind" part is already the `reply` field, so no kind label is added). A
  post from one of Shephrd's own services, such as `roles.sheepdog`, records
  that service's name as its author. Services exist only inside Shephrd's
  process and call commands through the extension point's in-process path
  (client API contract, section 2, "Services"). No socket or network caller
  can set a service author, so an agent cannot forge a Shephrd notice
  (row 36).
- **Posts cannot be deleted.**

## How a wake reaches an agent (rows 5, 17, 18, 23, 46, 47, 52, 53, 59)

- Every wake is an engine delivery: content `prompt`, with the piece
  source `{ namespace: "board", id: <wake id> }` (rows 23, 37). The
  engine's dispatcher sends it through `Runner.prompt` when the agent can
  take it. The board never reads an agent's run mode, so an ACP agent and an
  interactive agent are woken the same way (roles request 1:
  **accepted**; this is the one delivery interface).
- In the same transaction as each wake, the board writes
  `board.WakeBuilt`, naming the wake, its delivery, its target and the
  posts it carries. The wake's status is read from the engine's deliveries
  view; the board does not keep it twice.
- **The body.** A wake's body is plain text, at most 256 KiB of UTF-8. It
  carries every post that needs the target's reply, then up to 20 of the
  target's oldest unread posts that need no reply, then a count of the
  rest. Posts past the byte cap stay open and unread, and the body says
  how many there are.
- **Each post in the body** has a header line built only from fixed words
  and the engine-authenticated id of its author: `owner`, `service <name>`,
  or `agent <id>`. No post text and no agent-chosen name appears in it.
  Then come the channel's id and name, the reply mode, and the post's
  state when the wake was built. A wake the reactor builds names each
  post's original author the same way. The post's text follows between its
  own fresh markers, with a leading slash escaped (rows 52, 63).
- **The sender.** The engine wraps the whole body in its agent-text
  envelope, with the sender label `board`, never `owner` (client API
  contract, seam item 14; lead ruling L16). The true author of each post is
  in that post's header.
- **Merging.** An agent has at most one board wake that is queued and was
  never sent. A new post for it withdraws that wake and queues one
  combined wake, in the same transaction. A wake that was sent and then
  put back in the queue, after a pause or a restart, keeps its place and is
  never merged; new posts go into one other wake. A wake already sent is
  never changed. A merged or replaced wake is a new delivery, so it goes to
  the back of the target's queue (row 62).
- **Cleanup.** When a post closes, or one addressee's part in it ends, the
  board removes that post from every still-queued wake that carries it, in
  the same transaction: it withdraws the wake, and queues one replacement
  if other posts in it still need a reply. A wake already sent may cost its
  target a turn on a closed post; its header said the post's state when it
  was built.
- **Returned wakes.** A board wake the engine returns is queued again once
  with the posts that still need a reply. A second return for the same post
  and target resolves that addressee as `undeliverable`.
- **Leaving a channel.** When an agent leaves a channel, its still-queued
  board wakes are withdrawn and rebuilt without that channel's posts, in
  the same transaction, or in the reactor's batch for a group label
  change. Text already sent cannot be recalled.
- **Stopped or crashed targets.** A wake for an agent that stops or crashes
  is withdrawn and never returned to anyone.
- **Restarts.** The board holds one logical wake per post and target, and
  its commands act once per request id. A wake that was sent but not proven
  received may be sent again after a restart, as the engine allows.

## Settled and waiting (rows 33, 51)

- A queued or sent wake makes its target "not settled" in the engine's
  terms, so a `wait` on that agent does not end while it still has a post
  to read.
- **Hold unsettled** (seam item 12). An agent with an open post of its own
  that needs a reply is not settled, so a `wait` on a lead that is waiting
  for a board answer does not end early.
- **Incoming** (seam item 16, lead ruling L15). A blocking `wait` is cancelled with
  "request held" while its waiter is an addressee of an open post that
  needs its reply and that it has not answered. The engine checks this
  when the wait opens and after every batch. Two agents cannot wait on each
  other through the board.
- `packages/board-contracts` exports both conditions as pure functions,
  `holdsUnsettled` and `holdsIncoming`, and the client helper
  `waitForAgents` applies them (lead ruling L15).

## Reading (rows 19, 39, 48, 53, 55)

- A member reads a channel's posts with `board.read`, in the client API's
  paged-read shape: `after`, `limit` (at most 200), and a reply of `items`
  and `next` (row 39). A page also closes when its encoded size passes
  512 KiB. With `open` set, it returns the caller's open posts instead.
- **Read state** is kept per member and channel, as a watermark (every
  post at or before it is read) plus the post ids read above it. A post
  becomes read when a wake carrying it is accepted, or when a `board.read`
  page returns it. Paging back never makes a post unread. Unread counts,
  `board.status` and `board.flush` all use this one rule.
- Every board event is `owner-only`: the live stream shows it to the
  owner, the owner's devices and Shephrd's services, and to no agent. The
  board's part of `client.snapshot` is its whole view for the owner,
  devices and services, and is absent for an agent, through the seam's
  `snapshotFor` hook (seam item 17, lead ruling L15).
- **Privacy has stated edges.** Through the board's commands, a channel is
  readable only by its members and the owner. Channels separate routing
  and limit mistakes; they are not a secrecy boundary. Every agent runs as
  the owner's user and can read the event log on disk, and a member's
  parent sees what the member was sent, because the engine shows a parent
  its child's whole thread. A post's text is stored in
  `board.PostWritten`, in every wake's `DeliveryQueued` and the engine's
  `PromptSent`, in the board's view in memory, in device caches, and in
  the harness's own session files.

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
| `board.close` | The post's author, the channel's manager, the owner, or a Shephrd service | Withdraws an open post and removes it from queued wakes (row 50). |
| `board.read` | The owner, or a member; never a service | Returns a page of a channel's posts after a cursor, or the caller's open posts, and marks them read. |
| `board.channels` | The owner, or any agent | Lists the channels the caller can read. |
| `board.status` | The owner, a Shephrd service, the agent's holder, or the agent itself | For one agent: unread counts, open posts waiting for its reply, its own open posts and whom each waits on, and whether a board wake is queued or sent (roles request 7: **accepted**). |
| `board.flush` | The owner, or a Shephrd service; never an agent | Queues one board wake now with the agent's unread posts, if it has any. Does nothing if the agent already has a never-sent board wake queued (row 62; roles request 6: **accepted** in this form). |

When the board is switched off (row 58), every command is refused with
"board disabled".

## Events the board adds to the log

`board.ChannelOpened`, `board.ChannelMembersChanged`, `board.PostWritten`,
`board.AddresseeResolved`, `board.PostClosed`, `board.WakeBuilt` and
`board.Read`. Their schemas are in `packages/board-contracts`, as
`BoardEvent`. None has a top-level `agentId` field, and all are
`owner-only`. Every one is rebuilt into the board's view from the log, and
the engine's rebuild check covers it. `board.Read` is written only when it
marks at least one unread post.

The board also queues and withdraws its own engine deliveries, through the
extension point's helpers, with its own piece source. It withdraws only a
delivery of its own that is still queued (seam item 13).

## For Shephrd's own services

A roles service, such as the sheepdog, uses the board through the
extension point's in-process command path, under its own service name:

- `board.post`, to post a notice. Its author is the service's name.
- `board.close`, to withdraw a post nobody will answer.
- `board.flush`, to hand an agent its unread posts now.
- `board.status`, to read whether a post is waiting for an agent.
  `packages/board` also exports the same answer as a pure function over
  the board's view, for code that already holds a snapshot.

A service cannot read a channel's posts with `board.read`.

## Switching the board off (row 58)

Once a board event is in the log, only a service with the board registered
can rebuild the log. So the board is never removed; rolling back means
switching it off. Its schemas, view and delivery-source rule stay
registered. Its commands are refused, and its reactor and conditions stop.
Board wakes already queued are still sent. Waits on board authors may then
end early.

## What the board refuses, and why

- **A work state per agent** (roles request 2: **refused**). Work states and
  work items are outside the board's plan (row 4; marked WIDENED for the
  owner's confirmation, row 44). The roles plan can derive "assigned,
  working, waiting on whom, done" from the engine's states and waits and
  from `board.status`, which already says whom each open post waits on.
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
- It does not recall text already sent to an agent.
