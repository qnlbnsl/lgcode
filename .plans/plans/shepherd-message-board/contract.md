# The message board's contract

Status: **version 12, for the foundry-roles plan to build on.** Written by
the board's planner on 2026-11-03. Version 11 is `attack/contract-v11.md`.
This version follows the owner's choice of one web password (rows 149, 150):
the words about devices go, and no rule of the board changes. It builds on the
client API contract version 15
(`668a341`), whose copy is `client-api-contract-v15.md` in this folder, and on
the engine at `9e386b0` (row 144). A later change to this file goes to `plans-lead` as a
question first. The board's plan is `.plans/plans/shepherd-message-board/plan.md`;
its decisions are rows in `decisions.md` in the same folder, named in
brackets below.

The owner answered the board's question Q1 on 2026-11-03: the plans edit
the engine directly wherever they need to (row 99). There is no extension
seam and no rule that existing engine behaviour stays the same (lead
ruling L26). The client API plan's units 1a and 1b turn the engine's fixed
lists into lists a piece adds to, and the board adds its own entries in
its own units. Names and shapes follow the client API's contract
(`.plans/plans/shepherd-client-api/contract.md` on `worker/plans-api`,
version 15 at `668a341`). "Edit EN" below is that contract's section 6,
edit EN. The security rules of lead rulings L13 and L16 to L25 stay
exactly as ruled; they are now properties of engine code.

The board's code lives in the engine's two packages:
`packages/contracts/src/board/` for its schemas, tables and pure
conditions, and `packages/engine/src/board/` for the rest (row 100). The
board changes two things the engine already does. An agent waiting for a
board answer is not settled, and a blocking `wait` gives way when its
waiter is asked a board question ("Waiting", below). The board's plan
lists every engine change with the tests it updates.

## What the board is

The message board is the part of Shephrd that lets agents and the owner
talk in channels, and that decides who is woken by a message. It is built
on the engine. It adds commands, events, one view, one reactor and the
board's entries in the engine's rule tables, and it reaches agents only through the engine's own
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
- **Live agent:** an agent that is not stopped and not crashed. A crashed
  agent is not live, but it stays a member of its channels (row 84).
- **Ancestor:** an agent above another by the engine's fixed `parent`
  links, whatever either agent's state. Membership and reach use ancestors,
  never holder availability (lead ruling L18).
- **Ceiling:** the permission level an agent was started with, as its
  `AgentStarted` event records it. The board's view keeps it, because the
  engine's agents view keeps only the current mode (row 73).
- **Disposition:** how one addressee's part in an open post ended:
  `replied`, `gone`, `removed` or `undeliverable`.
- **Completion:** the board's notice to a post's agent author that the post
  closed: its outcome, every disposition, the reply that decided each
  addressee's part, the number of replies, and as much of the deciding
  replies' text as fits its budget (rows 69, 88, 111).
- **Manager:** the agent, or the owner, that manages a plain or group
  channel. It is stored, not computed (rows 85, 106). A direct channel has
  no manager.
- **Acting manager:** while a channel's manager is crashed, or interrupted
  with a session that cannot reload, the owner and the manager's nearest
  ancestor that is in neither state, and not stopped, may use the
  manager's commands. Acting gives rights only, never membership (row 106).
- **Read by an agent:** a post is read by an agent once a wake carrying it
  to that agent is accepted, or once a `board.read` page that returned it
  to that agent has written its marks (rows 48, 104).

## Channels (rows 10, 11, 12, 27, 45, 56, 65, 66, 68, 74, 76, 84, 85, 94, 96)

- A channel has an id, a name, a manager, a member list, an optional
  engine group label, and whether the owner or an agent opened it. Every
  command names a channel by its id. A name matches
  `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`, the engine's slug pattern, and is unique
  among the channels of one manager.
- **The manager.** The opener is a plain or group channel's first manager.
  The manager seat moves only when the current manager stops, even if it has
  been resumed before the reactor runs: the reactor then writes
  `board.ManagerChanged`, naming the nearest ancestor that is
  not stopped, not crashed, and not interrupted with a session that cannot
  reload, or the owner if there is none. A crash, an interrupt, a pause, an
  account change or a resume moves nothing; a stop is final, so rights
  never return. A new manager becomes a member, with its read state at the
  channel's last post. While the manager is crashed, or interrupted with a
  session that cannot reload, the acting manager may use its commands, and
  joins nothing (row 106).
- **Plain channel.** Opened with `board.open`. An agent opener is an
  explicit member from `board.ChannelOpened`, so it stays a member whatever
  happens to the manager seat. A manager may add an agent it holds, and its
  own holder. A manager may remove any member. A plain channel has at most
  64 members.
- **Group channel.** Opened with `board.open` and a group label. Its
  members are computed from the engine's agents at every check, never
  stored:
  - Every group channel has an **anchor**. In a channel an agent opened,
    the anchor is the opener; an agent may not name any other anchor. In a
    channel the owner opened, the anchor is the agent the owner names when
    opening it; to reach every carrier, the owner names the root agent.
  - An agent that carries the label and is not stopped is a member if the
    anchor is that agent or one of its ancestors. A crash, an interrupt, a
    pause or a resume does not change membership. A carrier elsewhere in
    the tree is not a member, whether it was started with the label or
    given it later by `group`.
  - The anchor and the current manager are always members while they are
    not stopped, whether or not they carry the label.
  - The anchor never moves. When the manager seat moves on a stop, the new
    manager is a member, but the channel takes in no one else. An acting
    manager is not a member.
  - An agent may not bind a label that no agent in its own subtree
    carries.
  - Inside the anchor's subtree, any parent may give its own child the
    label, and that child joins. This is accepted, because every agent in
    the subtree is already under the anchor's authority.
  - A group channel has no member limit of its own; its size follows the
    engine's labels.
  A group channel is the roles plan's "team channel": there is one
  membership list, the engine's group (roles request 5: **accepted**,
  within these rules).
- **Direct channel.** Opened implicitly by `board.post` with a `direct`
  target. It has exactly two members: two agents, one agent and the owner,
  or one agent and a Shephrd service (lead ruling L17). A service opens one
  with its own `board.post`; it is never woken and never reads with
  `board.read`. The pair has one direct channel, and its two members never
  change. A direct channel has no manager, so nothing moves when either
  side crashes or stops (row 106). Its **grant** holds while
  one side is the other's parent, the pair shares a plain or group
  channel, or one side is the owner or a service. A crash does not end a
  grant, because it does not change membership. It may be opened, and
  each later post in it is allowed, only while the grant holds. The check
  runs on every post, not only at the open.
- **When a direct grant ends,** every addressee of an open post in that
  channel that needs a reply is resolved `removed`, in the reactor's batch
  that sees the change. Each such post then closes by the outcome table,
  and its author gets its completion. Later posts are refused. The
  channel's history stays readable to its two members (row 68).

## Who may wake whom: the board's reach check (rows 45, 61, 67, 73, 86, 87)

The client API lets a piece's delivery reach an agent outside the calling
agent's tree only when the piece's reach check allows it (client API
contract, section 2 and edit E18). The board writes its entry in the
engine's reach table (edit E18). The engine consults it on every board wake, inside or outside the
caller's tree and with no caller (lead ruling L22). It runs once when the
wake is queued, against the views snapshot projected with the command's own
batch, and again in the transaction that sends it; a wake that fails at
send is withdrawn, and the dispatcher goes on to the target's next queued
delivery (lead rulings L19, L23). The check stays in force while the board
is switched off.

The check is told which wake it judges, by its delivery id and its source
`{ namespace: "board", id: <wake id> }` (lead ruling L23). It finds that wake by
its source id in the `board.WakeBuilt` index, which at queue time holds the
batch's own `board.WakeBuilt`, because that event comes before the delivery in
the batch (row 132). It judges each post and completion the wake
carries on its own. A post may ride in a wake to agent T only if:

1. it is in a channel T is a member of now;
2. for a direct channel, the channel's grant still holds;
3. for a group channel, T is a member by the group-channel rule;
4. if it needs T's reply, its author's ceiling is at least T's, or T is
   the author's ancestor or descendant. The owner and Shephrd's services
   always pass this rule.

A post from a Shephrd service in its direct channel with agent T passes
all four rules: T is a member, the grant of an agent-and-service pair
always holds while T is not stopped, and services pass rule 4 (lead rulings L17,
L22, L23).

A completion with no reply text always passes. A completion that carries
reply text is judged by rules 1 to 3 as a post of its channel: if the
author is no longer a member, the wake fails, and the reactor rebuilds the
completion with its outcome, dispositions and reason, and no reply text
(row 87). While the board is switched off, such a wake is still withdrawn,
and its completion stays owed until the board is switched on.

**When a post fails.** Whenever the board builds or rebuilds a wake, or the
engine withdraws one that failed at send:

- a post that needs no reply is left out, and stays unread;
- a post that needs T's reply resolves T as `removed` in the same batch,
  which may close the post by the outcome table;
- an old carried post never causes a new command to be refused.

The board's reactor re-applies the check to every still-queued board wake
whose target or carried posts a batch touches, as one of its level rules
(row 105).

**What rule 4 protects.** A narrower agent cannot wake a wider one or
oblige it to reply. A no-reply post from a narrower author may still ride
in a wider agent's digest; the control on that text is the data envelope
(SECURITY.md rule 7). The reach check grants no other right: it never
allows `stop`, `answer`, `compact`, `resume` or an engine `prompt`.

## Posts (rows 14, 15, 16, 26, 28, 49, 54, 57, 69, 70, 72, 78, 84, 88, 93, 94, 95)

A post has:

| Field | Meaning |
| --- | --- |
| `postId` | The board's id for it. |
| `channelId` | The channel it is in. |
| `author` | The owner, an agent, or a Shephrd service by name. |
| `text` | At most 16,384 characters. Before it is written, secrets are redacted, and control characters other than newline and tab are removed. |
| `to` | Its addressees: agent members of the channel, or the owner. At most 16. Never its own author, and never a service. |
| `reply` | `none`, or `any` or `all`: whether it needs a reply, and from how many addressees. |
| `replyTo` | Optional: the post it answers. It must be in the same channel, and the caller must still be a member of it. |

- **Who is woken.** A post whose `reply` is `any` or `all` wakes exactly its
  addressees, minus its author, minus the owner and services (the owner is
  told by an alert). A post whose `reply` is `none` wakes nobody. A post
  that needs a reply must name at least one addressee, and none may be an
  agent that is stopped, crashed, or interrupted with a session that cannot
  reload. An agent may have at most 64 open posts of its own that need a
  reply.
- **Each addressee ends one way.** Each addressee of an open post that
  needs a reply gets one disposition:

  | What happens to the addressee | Its disposition |
  | --- | --- |
  | It replies in the same channel | `replied` |
  | It stops or crashes | `gone` |
  | It is interrupted, and the engine shows its session cannot reload | `gone`, at once |
  | It is interrupted, and its reload fails | `gone` |
  | It is interrupted, and its session can reload | none while recovery tries it |
  | It leaves the channel, or loses reach to it | `removed` |
  | Two board wakes carrying this post to it are returned before either is accepted | `undeliverable` |
  | It pauses | none; the post waits |

  A disposition is set once. The one change allowed: while the post is
  still open, a reply from an addressee with any other disposition makes
  it `replied`. That covers `gone`, `undeliverable`, and `removed` once the
  addressee is a member again. A crash and a stop are judged only by these
  lifecycle rows, never as leaving the channel. A stop, a crash or a leaving
  that happened after the post keeps its effect even if it was undone before
  the reactor ran ("The board's reactor", below; row 143).

- **How a post closes.**

  | What happens to the post | It closes as |
  | --- | --- |
  | `any` mode, the first `replied` | `answered` |
  | `all` mode, every addressee has a disposition, at least one `replied` | `answered` |
  | Either mode, every addressee has a disposition, none `replied` | `unanswerable` |
  | The owner replies | `answered` |
  | `board.close` | `withdrawn` |
  | The author stops, or is removed from the channel, after the post | `withdrawn` |

  When the author crashes, or is interrupted and cannot reload, its open
  posts stay open and replies are still recorded. A crash never counts as
  leaving the channel.
- **Completions.** At a close, an agent author is owed a completion,
  except when the author withdrew the post itself or stopped after the post,
  even if it has since been resumed and whatever closed the post (row 143). A post
  withdrawn by someone else, or because its author was removed from the
  channel, owes a completion with that reason. An owed completion is a
  durable reason to wake the author: it survives merging, cleanup, a
  return and the author's crash. The reactor queues a wake for it whenever
  no queued or sent board wake carries it. While a queued or sent wake
  carries it, it is not packed into any other wake; it becomes free again
  only when that wake is returned or withdrawn (row 115). It is discharged
  only when the engine accepts a wake carrying it. After two returns
  without an accept it is no longer re-queued: it rides the author's next
  board wake, `board.status` shows it as "delivery failed", and
  `board.flush` can still send it. When an agent stops, its owed
  completions are dropped: the board's view folds the engine's
  `AgentStopped` to do so, and a later resume does not bring them back
  (row 114).
- **A completion's size.** A completion always carries the post's id, its
  outcome, every addressee's disposition, for each `replied` addressee the
  id of the reply that decided its part, the id of the owner's reply if
  that closed the post, and the total number of replies. That is at most
  17 ids, whatever the number of replies. It carries the deciding replies'
  text in reply order only while it stays within 64 KiB as JSON encodes
  it. Every other reply, and any deciding reply whose text is left out, is
  read with `board.read` and `repliesTo`, and the completion ends with "N
  more replies; run board.read with repliesTo <postId>" (rows 88, 111).
- A reply from anyone who is not an addressee or the owner closes
  nothing.
- **A collection is a post in `all` mode.** A lead's hand-off post to three
  workers, in `all` mode, wakes the lead once, when the last worker
  replies or otherwise ends. This is the "work done" signal that replaces
  `RESULT: done` lines (roles request 3: **accepted**, in this form).
- **The owner as addressee.** A post that needs the owner's reply raises
  one owner alert of kind `board.post`, keyed `post:<postId>`, through the
  client API's alert sources. The source names that kind and key, the
  author's agent id, and the post's id as its subject. It never names a
  title: the title comes from the client API's fixed table, to which the
  board adds one entry for its kind (row 122). The alert ends when the post
  closes. A tap opens the author's thread, where the board's entry in the
  subject panel reads and answers the post ("The board's entry on the
  thread page", below). The board never writes the engine's `OwnerNeeded`
  (row 35). One agent may have at most 3 open posts that need the owner's
  reply; a fourth is refused with the reason. A post from a service that
  needs a reply may not name the owner in `to`; a service reaches the owner
  through its own alert kind, and such a post would have no thread for its
  alert to open (row 122).
- **Open matters at the alert reactor's first start.** The board supplies
  `openMatters(views)` in the client API's table (contract section 4). It is
  a pure function over the rebuilt views. For each open post that needs a
  reply from the owner, it returns `{ key: "post:<postId>", kind:
  "board.post", agentId: <the post's author>, subject: <postId> }`, the same
  values the board's alert source gives. Only the first-start scan calls it
  (row 131).
- **Shephrd as author** (roles request 4: **accepted**; the "needs-reply
  kind" part is already the `reply` field, so no kind label is added). A
  post from one of Shephrd's own services, such as `roles.sheepdog`, records
  that service's name as its author. Services exist only inside Shephrd's
  process and call commands through the engine's in-process service path
  (client API contract, section 2, "Services", and edit E13). No socket or network caller
  can set a service author, so an agent cannot forge a Shephrd notice
  (row 36).
- **Posts cannot be deleted.**

## How a wake reaches an agent (rows 5, 17, 18, 23, 46, 47, 52, 53, 59, 69, 72, 74, 79, 80, 82, 88, 91)

- Every wake is an engine delivery: content `prompt`, with the piece
  source `{ namespace: "board", id: <wake id> }` (rows 23, 37). The
  engine's dispatcher sends it through `Runner.prompt` when the agent can
  take it. The board never reads an agent's run mode, so an ACP agent and an
  interactive agent are woken the same way (roles request 1:
  **accepted**; this is the one delivery interface).
- In the same transaction as each wake, the board writes
  `board.WakeBuilt`, naming the wake by its source id, its target, the posts
  it carries, the posts that need the target's reply, and the completions
  it carries. It cannot name the delivery id, because the batch path turns
  the delivery request into `DeliveryQueued` after the planner's own events,
  so that id does not exist yet (edit E23; row 132). The board's view learns
  it by folding that `DeliveryQueued`, whose source names the wake. The
  wake's status is read from the engine's deliveries view; the board does
  not keep it twice.
- **The body.** A wake's body is plain text, at most 256 KiB as JSON
  encodes it ("Sizes", below). It carries, in order: the target's owed
  completions that no other queued or sent wake carries, using at most
  128 KiB; every open post that needs the target's reply, that the target
  has not read, and that no other queued or sent wake carries to it; up to
  20 of the target's oldest unread posts that need no reply; and a count
  of the rest. Completions never use the 20 digest places. Completions past
  their 128 KiB stay owed and ride the next wake. Posts past the byte cap
  stay open and unread, and the body ends with "N more posts need your
  reply; run board.read with incoming set". Once this wake is accepted or
  returned, the reactor queues another wake for the posts it left out, so
  no question waits for a new post or a `board.flush` (row 104).
- **Each post in the body** has a header line built only from fixed words
  and the engine-authenticated id of its author: `owner`, `service <name>`,
  or `agent <id>`. No post text and no agent-chosen name appears in it.
  Then come the channel's id, never its name, the reply mode, and the
  post's state when the wake was built. A wake the reactor builds names each
  post's original author the same way. The post's text follows between its
  own fresh markers, with a leading slash escaped (rows 52, 63).
- **The sender.** The engine wraps the whole body in its agent-text
  envelope, with the sender label `board`, never `owner` (client API
  contract, edit E15; lead ruling L16). The true author of each post is
  in that post's header.
- **Merging.** An agent has at most one board wake that is queued and was
  never sent. A new post for it withdraws that wake and queues one
  combined wake, in the same transaction. A wake that was sent and then
  put back in the queue, after a pause or a restart, keeps its place and is
  never merged; new posts go into one other wake. A wake already sent is
  never changed. A merged or replaced wake is a new delivery, so it goes to
  the back of the target's queue (row 62).
- **Cleanup.** When a post closes, the board removes it from every
  still-queued wake that carries it. When only one addressee's part in a
  post ends, the board removes the post only from that addressee's own
  queued wakes; in `all` mode, one worker's reply leaves another worker's
  queued wake unchanged. Either way it happens in the same transaction: the
  board withdraws the wake, and queues one replacement built from the
  target's current duties: completions still owed, and open posts that
  still need its reply. A completion that was already discharged is never
  carried again (row 115). A wake already sent
  may cost its target a turn on a closed post; its header said the post's
  state when it was built.
- **Returned wakes.** The engine writes `DeliveryReturned` for a board wake
  it returns, and no source rule applies to it (edit E16; row 126). A board
  wake the engine returns before accepting it counts one return for each post and completion it carried, for its
  target. The reactor's level rules then queue a new wake for whatever is
  still owed. A second such return for the same post and target resolves
  that addressee as `undeliverable`; a second return of a completion
  follows the completion rule above. A wake returned after it was accepted
  is not queued again, as the engine never re-queues an accepted delivery:
  its posts were read and its completions discharged at acceptance, and the
  return counts toward nothing (row 110, which amends row 91).
- **Leaving a channel.** When an agent leaves a channel, its still-queued
  board wakes are withdrawn and rebuilt without that channel's posts, in
  the same transaction, or in the reactor's batch for a group label
  change. The dispatcher's own check stops a wake that the reactor has not
  yet rebuilt. Text already sent cannot be recalled.
- **Stopped or crashed targets.** A wake for an agent that stops or crashes
  is withdrawn and never returned to anyone. That is the board's entry in
  the engine's source-rule table (edit E16). No wake is queued for a stopped
  or crashed agent, because the piece batch path refuses a `DeliveryQueued`
  for one (edit E23, check 2; row 125). A crashed agent's completions
  stay owed; a stopped agent's are dropped. When a stopped agent is
  resumed, its read state in every channel it is a member of restarts at
  that channel's last post, so its first wake carries nothing written
  while it was stopped (row 114).
- **A withdrawal after a reload.** When a withdrawal leaves its target in
  the state that a reload sets, with nothing queued or sent, the first step
  of `withWaitChecks`, which the batch path runs, writes `StateChanged idle`
  in the same batch. The board writes nothing for this (edits E17, E18;
  rows 134, 137).
- **A held queue.** The roles plan can hold a target's queue after a capacity
  error. The hold is on the queue, not on one delivery, and the engine owns
  it, so the board has no rule for it. A held wake is a queued wake that was
  sent, so it is not merged, cleanup may withdraw it, and it counts no return.
  A wake the board withdraws and replaces stays behind the hold, and the
  reactor's guard counts it as a queued wake (row 138). An open hold keeps its
  agent unsettled in the engine's part of the settled test, even once its queue
  is empty (client API section 3, its row 177), and the board adds nothing for
  it (rows 141, 142).
- **Restarts.** The board holds one logical wake per post and target, and
  its commands act once per request id. A wake that was sent but not proven
  received may be sent again after a restart, as the engine allows.

## Settled and waiting (rows 33, 51, 69, 77, 89, 90)

- A queued or sent wake makes its target "not settled" in the engine's
  terms, so a `wait` on that agent does not end while it still has a post
  to read.
- **Hold unsettled** (edit E19). An agent is not settled while any of
  these holds:
  - it has an open post of its own that needs a reply, so a `wait` on a
    lead that is waiting for a board answer does not end early;
  - it has an owed completion that has not failed twice;
  - it is an addressee with no disposition of an open post that needs a
    reply, it has not read that post, and no queued or sent board wake
    carries the post to it. This covers a return, a send-time withdrawal
    and a post left out by the byte cap, and the reactor repairs each of
    them by queuing a wake (row 104). An addressee that took its question,
    by a wake or by `board.read`, and ended its turn without replying is
    settled, as the engine would say; its asker stays unsettled on its own
    open post.
- **Incoming** (edit E20, lead ruling L15). A blocking `wait` is
  cancelled with "request held" while its waiter is an addressee with no
  disposition of an open post that needs a reply. The engine checks this
  when the wait opens and after every batch. Two agents cannot wait on each
  other through the board.
- `packages/contracts/src/board/` exports both conditions,
  `holdsUnsettled` and `holdsIncoming`, as pure functions of the board's
  view, whose type it also holds, and of the engine's delivery statuses by
  delivery id from edit E19's input (lead ruling L28; rows 102, 104). The
  third clause needs both, because it asks whether a queued or sent board
  wake carries a post.
- **The owner's wait** (row 103). A client does not hold the board's view,
  so it cannot compute the conditions from the stream. The board's snapshot
  section and `board.status` with no agent carry their results: the ids of
  the agents for which each condition holds, including `ownerHeld`, and the
  sequence they were computed at. The client helper `waitForAgents` never
  ends a wait on a board result older than the stream it has applied. It
  reads `board.status` with no agent at open, when the engine's part of the
  settled test says the waited agents are settled, and when the stream shows
  `board.PostWritten`, `board.AddresseeResolved` or `board.PostClosed`, the
  events that can change the board's `ownerHeld`. A waited member in
  `ownerHeld` that is not stopped or crashed ends the wait at once with exit
  2. Before a settled result, if the read is newer than the stream it has
  applied, it applies the stream up to that sequence and decides again. It
  ends the wait as settled only when the engine's part and the board's lists
  agree at one sequence. So a return with no board event does not end the
  owner's wait, and an accepted completion ends it with no later board
  event. No timer and no polling are added.
- **One gate before any end** (client API contract, section 3). Before the
  client helper ends an owner's wait for any reason, settled, resolved or
  owner-held, it reads `board.status` with no agent, which returns the lists
  and a sequence L, applies the stream up to L, and decides again.
  `board.status` must build its lists and its sequence from one views value,
  and return that value's own sequence, so L is at a batch's end.
- **The owner-held list** (rows 123, 130). `ownerHeld` holds the ids of the
  agents that are the authors of an open post with the owner in `to`. While
  a post is open, the owner has no disposition in it, because the owner's
  reply closes it. Only the owner can end this hold. An agent waiting on
  another agent that waits for the owner is not on the list.
  `packages/contracts/src/board/` exports the list as a pure function of the
  board's view, `ownerHeld`. The board adds no tag to the client API's table
  of events that can change it: a stop closes the author's posts through
  `board.PostClosed`, and no other event adds or removes a post.

## Reading (rows 19, 39, 48, 53, 55, 71, 75, 79, 80, 85, 88, 89)

- A member reads a channel's posts with `board.read`. It is a read with
  marks (edit E4; row 108): it is checked against the caller's current
  access on every request, including a resent one, it is never
  deduplicated, and its page is stored nowhere. Its `board.Read` marks are
  written through the piece batch path (edit E23) as the caller, with no
  receipt. Marks only move read state forward, so writing them twice is
  safe. It uses the client API's paged-read shape: `after`, `limit` (at most 200), and a reply of `items`
  and `next` (row 39). A page also closes when its encoded size passes
  512 KiB, and it always holds at least one item. With `open` set, it returns the caller's own open posts instead.
  With `incoming` set, it returns the open posts across the caller's
  channels that need its reply and where it has no disposition. With
  `repliesTo` set to a post id, it returns the replies to that post, for a
  member of its channel. With `post` set to a post id, it returns that one
  post, with its channel id, author, `to`, reply mode, `replyTo` and state,
  to a member of its channel or the owner, and marks it read (row 122).
- **Read state** is kept per member and channel, as a watermark (every
  post at or before it is read) plus the post ids read above it. A
  member's watermark starts at the channel's last post when it joins:
  for a plain channel, at the `board.ChannelMembersChanged` that adds it;
  for a group channel, at the `AgentStarted` or `AgentGrouped` that first
  makes it a member; for a new manager, at its `board.ManagerChanged`; for
  an agent resumed from `stopped`, at the change out of `stopped` (row 114).
  A crash and a resume from a crash keep a member's read state. Older posts are read with `board.read` and never ride
  in its wakes. A post becomes read when a wake carrying it is accepted, or
  when a `board.read` page returns it. Paging back never makes a post
  unread. Unread counts, `board.status` and `board.flush` all use this one
  rule.
- Every board event is `owner-only`: the live stream shows it to the
  owner and Shephrd's services, and to no agent.
- `client.event` is agent-callable, under the read rule, and is in the MCP
  tool pin with `client.snapshot`, `client.roster` and `client.thread`. An
  agent's reply to `client.thread` and `client.event` is `{ requestId, data }`,
  where `data` is the data envelope around one line of JSON. The tool and the
  command line return it unchanged. Owner-only events stay unavailable to an
  agent. So an agent can read no board event this way (row 135).
- **The board's part of `client.snapshot`** is absent for an agent,
  through the board's `snapshotFor` entry (edit E9, lead ruling L15).
  For the owner and services it holds no post text, and is at
  most 256 KiB encoded. Every part of it comes from the one views value the
  snapshot reads, and its sequence is that value's own (edit E9). It holds,
  first, the ids of the agents for which `holdsUnsettled` holds, of those
  for which `holdsIncoming` holds, and of those on `ownerHeld`, and the
  sequence they were computed at; this part is bounded by the number of
  agents and is never left out. Then come the open posts' metadata (id,
  channel, author, `to`, reply mode, `replyTo`, dispositions), owed
  completions, the channels (id, name, kind, manager, anchor, label,
  explicit members), unread counts per member and channel, and the queued
  board wakes' ids. If that would pass the cap, it sets `truncated`, and
  the client pages the rest with `board.channels` and `board.status`.
  While the board is switched off, the section says `disabled`, and its
  condition lists and `ownerHeld` are empty (row 116).
  Post text is read with `board.read`.
- **Privacy has stated edges.** Through the board's commands, a channel is
  readable only by its members and the owner. Channels separate routing
  and limit mistakes; they are not a secrecy boundary. Every agent runs as
  the owner's user and can read the event log on disk, and a member's
  parent sees what the member was sent, because the engine shows a parent
  its child's whole thread. A post's text is stored in
  `board.PostWritten`, in every wake's `DeliveryQueued` and the engine's
  `PromptSent`, in the receipts of the `board.post` that wrote it and of
  any command whose batch queued its wakes, in the board's view in memory,
  in client caches, and in the harness's own session files. A planner's
  receipt holds its batch and a reply of ids and counts only (edit E3).
  `board.read` writes no receipt, and its page is stored nowhere; its
  `board.Read` event names its reader and post ids only (rows 108, 136). Closing a post erases
  no copy.

## Commands the board adds to the API

Every command goes through the engine's command handler, as a planner or
a read in the engine's tables (edits E3, E4), so it has the engine's
caller identity and access check. Every batch the board writes passes the
piece batch path's checks (edit E23).

- **Five planners** (edit E3; row 107): `board.open`, `board.members`,
  `board.post`, `board.close` and `board.flush`. Each writes one
  transaction and has a receipt. Its reply holds ids and counts only, taken
  from its own batch: the channel id; the member count; the post id; the
  post id and outcome; the wake id, or none. A resent request id returns
  the stored reply and writes nothing.
- **Three reads** (edit E4; row 108): `board.read`, a read with marks,
  `board.channels` and `board.status`. Each is checked against the
  caller's current access on every request, is never deduplicated, and is
  stored nowhere.

Each command whose access
includes agents is a Shephrd tool for agents and a `shephrd board <name>`
subcommand. A logged-in web session is the owner (row 149).

| Command | Who may call it | What it does |
| --- | --- | --- |
| `board.open` | The owner, or any agent | Opens a plain or group channel and returns its id. Only the owner names a group channel's anchor; an agent naming another anchor is refused (row 96). |
| `board.members` | The owner, or the channel's manager | Adds or removes members of a plain channel. |
| `board.post` | The owner, a member, or a Shephrd service | Writes a post in a channel, or in a direct channel with `direct`, and queues its wakes. Returns the post id. |
| `board.close` | The post's author, the channel's manager or acting manager, the owner, or a Shephrd service | Withdraws an open post and removes it from queued wakes (row 50). |
| `board.read` | The owner, or a member; never a service | Returns a page of a channel's posts after a cursor, the caller's own open posts (`open`), the posts waiting for its reply (`incoming`), or the replies to one post (`repliesTo`), or one post by its id (`post`), and marks them read. |
| `board.channels` | The owner, or any agent | Lists the channels the caller can read, in the paged shape, closing at 512 KiB encoded. |
| `board.status` | The owner, a Shephrd service, the agent's holder, or the agent itself | For one agent, ids, counts and states only, never post text or channel names. By default, a fixed-size summary: unread, incoming open, own open, owed and failed-completion counts; whether a board wake is queued or sent; the results of `holdsUnsettled` and `holdsIncoming`; and the sequence it was computed at. With `detail` set to `incoming`, `own` or `completions`, the matching list in the paged shape, closing at 512 KiB encoded: post ids, channel ids, reply modes, addressees and dispositions (roles request 7: **accepted**; rows 74, 89). With no agent, for the owner and services only: the ids of the agents for which each condition holds, the ids on `ownerHeld`, and the sequence of the one views value they come from, bounded by the number of agents (rows 103, 123). |
| `board.flush` | The owner, or a Shephrd service; never an agent | Queues one board wake now with the agent's owed completions, including failed ones, and its unread posts, if it has any. Does nothing if the agent already has a never-sent board wake queued (rows 62, 92; roles request 6: **accepted** in this form). Refused with the engine's reason if the agent is stopped or crashed (row 125). |

When the board is switched off (row 58), every command but `board.status`
is refused with "board disabled", a reason the engine's public error
filter passes (rows 116, 117). `board.status` stays readable and says
`disabled`, with empty condition lists and an empty `ownerHeld`.

## Events the board adds to the log

`board.ChannelOpened`, `board.ChannelMembersChanged`,
`board.ManagerChanged`, `board.PostWritten`, `board.AddresseeResolved`,
`board.PostClosed`, `board.WakeBuilt` and `board.Read`. Their schemas are in `packages/contracts/src/board/`, as
`BoardEvent`, which joins the engine's `Event` union (edit E5). None has a top-level `agentId` field, and all are
`owner-only`. Every one is rebuilt into the board's view from the log, and
the engine's rebuild check covers it. `board.Read` is written only when it
marks at least one unread post. Each event carries everything its fold needs,
because a reducer reads only the event and the sequence: `board.ChannelOpened`
names its opener, `board.Read` its reader, and `board.PostClosed` its outcome,
who closed it, and whether a completion is owed (row 136). Each board event keeps every agent's
lifecycle state, through the board's `keepInEveryState` line in the
engine's lifecycle table (edit E5; row 112).

The board's view also folds these engine events: `DeliveryQueued` with a
board source (to learn the wake's delivery id, row 132), `DeliveryAccepted` and
`DeliveryReturned` for board wakes, `AgentStarted`, `AgentGrouped`,
`AgentStopped` (to drop owed completions and record the stop's sequence),
`AgentCrashed` and `AgentReloadFailed` (to record that sequence), and the
`StateChanged` out of `stopped` (to restart read state) (rows 114, 143).

The board asks for its wakes by returning delivery requests, which the
piece batch path turns into `DeliveryQueued` through the piece-delivery
helper (edits E15, E23), with its own piece source (edit E16). It
withdraws only a delivery of its own that is still queued (edit E17). A
returned board wake carries the sender `piece { namespace: "board" }` in
its `DeliveryReturned` (edit E15; row 109).

## Sizes: the board's largest event and page (row 127)

The client API's budgets are in its section 5, "Message size": a page closes
at 900 KiB of encoded items, and `client.subscribe` replaces an event over
256 KiB with a `client.Oversized` marker. A client then reads a
state-bearing event whole with `client.event`, and applies it before anything
later (client API row 137). A client that subscribes uses two connections, so a
512 KiB `board.read` page does not delay a stream's acknowledgement (edit E32). A piece's stated largest event is checked against
the 900 KiB page budget, and an event over 256 KiB is allowed (row 133). The
board states its largest in `packages/contracts/src/board/limits.ts`, and the
client API's test `packages/contracts/test/size-limits.test.ts` checks them as
real encoded frames.

| What | The board's largest | Against the budget |
| --- | --- | --- |
| A page: `board.read`, `board.channels`, `board.status` with `detail` | 512 KiB of encoded items, with at least one item | Under the 900 KiB page budget. One post encodes to at most about 64 KiB, so one item never passes it. |
| A board event: `board.PostWritten` | One post of 16,384 characters, with at most 16 addressees: about 64 KiB | Under the page budget, and under 256 KiB, so it is never replaced by a marker, and the owner's wait always sees it in the stream. |
| A board event: `board.WakeBuilt` | Ids only, for what one body of 256 KiB can carry. Each item costs its header and markers in the body, so the event stays well under the body's size | Under the page budget, and under 256 KiB, so it is never replaced by a marker. |
| An engine event: the `DeliveryQueued` and `PromptSent` of a wake | A body of 256 KiB, plus the engine's envelope and the event's own fields | Under the page budget. It may pass 256 KiB, and in `client.subscribe` it then becomes a `client.Oversized` marker. `client.event` and `client.thread` return it whole to whoever the read rule lets see it; an agent gets it inside the data envelope. `subscribe` is unchanged. |
| A snapshot section | 256 KiB, with the condition lists always whole | Counted in the client API's test on its large fixture, which fails above 4 MiB. |

## The board's table entries (row 136)

Every function this plan adds to a per-piece table (view reducer, reach check, hold-unsettled, request-held, source rule, secret keep list, `snapshotFor`, alert source, `openMatters`) is called through the engine's `guardPiece` (client API contract, section 1, edit E30). If it throws, the engine logs the namespace, the table and the error's class name, with no event text, and uses the stated fallback. This plan adds no wrapper of its own, and no direct call. A reducer reads the event and the sequence, and nothing else from the envelope, because a projection passes placeholders for the rest.

The fallbacks are in the client API contract, section 1. For the board, a throw
means this:

| Table | The fallback | What it means for the board |
| --- | --- | --- |
| Reach check | Refuse | A wake is not queued, or is withdrawn at send. A refused queue writes `CommandRefused`, so it cannot loop. |
| Hold-unsettled | Holds | The agent is not settled. |
| Request-held | Does not hold | A blocking wait is not cancelled. |
| Source rule | Withdraw | The same as the board's entry. |
| Secret keep list | Skip collection | The board's entry is "none", and it cannot throw. |
| `snapshotFor` | Section left out, with a mark | The owner's wait still has `board.status` through its gate. |
| Alert source, `openMatters` | Nothing raised | That post has no alert. The error log shows it. |
| View reducer | The view stays as it was | Live, projected and rebuilt views still agree. |

`board.status` and `ownerHeld` are in no table. A throw in a read fails that read
alone, and the owner's wait does not end on a failed read.

## The board's reactor (rows 104, 105, 124, 125)

- Every rule of the reactor is a level rule: a condition over the board's
  view and the engine's views, and the duty it owes while the condition
  holds. Examples: the five rules in the next bullet; a direct grant that
  fails makes its addressees `removed`; a still-queued wake carrying a post its target
  may no longer read is rebuilt; an owed completion or an unread open
  must-reply post that no queued or sent wake carries is queued, while its
  target is neither stopped nor crashed and has no board wake queued or
  sent, until its return count reaches two.
- **A stop, a crash or a leaving stays true after it is undone** (row 143).
  A resume or a rejoin can land before the reactor's next transaction, also
  while the board is switched off, so a rule cannot ask only about an agent's
  state now. The board's view keeps, from the events it folds: for each agent,
  the sequence of its last stop, and of its last crash or failed reload; for
  each channel and member, the sequence at which the member last left it; for
  each post, its own sequence; and for each channel, the sequence at which its
  manager took the seat. The rules compare them, and no list of pending duties
  is kept:

  | The rule | It applies when |
  | --- | --- |
  | An addressee with no disposition is `gone` | It stopped, crashed or failed a reload after the post, or it is now interrupted and not reloadable |
  | An addressee with no disposition is `removed` | It left the channel after the post, or it is not a member now |
  | An open post of an agent author closes `withdrawn`, with no completion | The author stopped after the post |
  | An open post of an agent author closes `withdrawn`, with a completion that gives the reason | The author left the channel after the post, or it is not a member now, and it did not stop after the post |
  | A plain or group channel gets `board.ManagerChanged` | Its manager stopped after taking the seat |

  So "the author stopped after posting" and "the manager stopped after taking
  the seat" stay true after a resume, and a post written after the resume or
  the rejoin is not caught. A disposition or a close that has already committed
  makes its rule false, so a reply is never overridden. An interrupt that a
  resume undoes counts for nothing, because the agent can still take its wake.
  A direct grant is judged only as it stands now: if a grant lapses and returns
  before the reactor runs, the post stays open, because its addressee can
  still be reached and can still answer.
- It runs after every committed batch, over the agents, channels and posts
  that batch touches, and over the whole state at start-up and when the
  board is switched on. It keeps no position: a duty lost to a restart is
  found again by the next run.
- It writes only through the piece batch path (edit E23), recorded with the
  caller `piece { namespace: "board" }`. It gives that path a function from
  the views to its batch, so the batch is built inside the writer's
  transaction, from the views the checks read (edit E23). A refused batch
  is not written; the engine records one `CommandRefused`, with the sequence
  of the batch the reactor was handling or, in a whole-state run, of the
  views it read, and the reactor tries that duty again only after a later
  batch touches it, or at start-up. A `CommandRefused` touches nothing, so a
  refusal never starts another run.
- It follows the client API's rules for every reactor (section 1, row 108).
  It starts only after `recovery.whenReady`, so an interrupted agent that
  recovery can still reload is never judged early. It writes no first-start
  event, because it keeps no position. On `LogWriteFailed` it stops, and a
  restart finds its duties again by the whole-state run. A defect is logged
  at error level with no event text, and the reactor restarts after a pause
  with a whole-state run.

## For Shephrd's own services

A roles service, such as the sheepdog, uses the board through the
engine's in-process service path (edit E13), under its own service name:

- `board.post`, to post a notice. Its author is the service's name.
- `board.close`, to withdraw a post nobody will answer.
- `board.flush`, to hand an agent its unread posts and owed completions
  now.
- `board.status`, to read whether a post is waiting for an agent, or,
  with no agent, which agents each condition holds for.
  `packages/engine/src/board/` also exports the same answer as a pure function over
  the board's view, for code that already holds a snapshot.

A service cannot read a channel's posts with `board.read`.

## Switching the board off (row 58)

Once a board event is in the log, only a build that includes the board can
rebuild the log. So the board is never removed; rolling back means
switching it off. Its schemas, view, delivery-source rule and reach check
stay in force, so the dispatcher still checks queued board wakes. Its
commands but `board.status` are refused, and its reactor and conditions
stop. Board wakes already queued are still sent if they pass the reach
check; a wake that fails is withdrawn and not rebuilt until the board is
switched on. Waits on board authors may then end early, and the owner's
wait agrees with an agent's, because `board.status` reports empty
condition lists and an empty `ownerHeld`. When the board is switched on, its reactor runs once over
the whole state (row 116).

## The board's entry on the thread page (row 122)

An alert for a board post opens the author's thread. The client API's thread
page has a subject panel, with a table keyed by namespace (client API
section 4, "The subject panel"; its unit 7b builds the panel and its
fallback). The board's plan writes the board's entry, in
`packages/web/src/thread/subjects/board.tsx`.

- **Before a tap.** The entry shows the alert's fixed title and a button. It
  runs no command, because opening a link runs no state-changing command and
  `board.read` writes marks.
- **On a tap.** It calls `board.read` with `post` set to the alert's post
  id. The post's text is agent text, so it is shown as React text only, never
  as HTML or Markdown, and it looks different from Shephrd's controls. The
  author is shown by the same fixed words and id as a wake's header.
- **Answering.** While the post is open, the entry offers a reply box. It
  calls `board.post` with the post's channel id and `replyTo` set to the
  post's id, and with one request id for each reply, so a double tap acts
  once. The owner's reply closes the post `answered`, so the alert ends and
  the author is woken once with its completion. A closed post shows its state
  and no reply box.

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
