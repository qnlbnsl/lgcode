# Client API design decisions, 2026-11-03

## What this note is

This note records the owner's decisions from design talk 1 for Shephrd's
client API, the second of its four pieces. The talk was held on 2026-11-03
with the design partner `design-api` and the lead `plans-lead`. The full
outcome, written during the talk, is the team artifact
`client-api-design-talk-1.md`.

Each decision below gives the owner's exact words, what it changes in the
client API plan, and what it rules out. The plan is
`.plans/plans/shepherd-client-api/plan.md`. Its decision log is
`decisions.md` in the same folder, and the row numbers below refer to it.

Abbreviations: API means application programming interface. TLS means
Transport Layer Security, the encryption a browser uses for HTTPS. ntfy is a
small notification service with a phone app. Caddy is a web server that is
often used as a reverse proxy.

## Decision 1: the phone reaches Shephrd through the owner's own proxy

**The owner's exact words:** "yes. a caddy or something proxy that will proxy
to localloopback"

**Decision.** Shephrd adds one web server for the web page and the API. It
listens only on the loopback address. Remote access goes through the owner's
own reverse proxy, such as Caddy, over the owner's WireGuard. The proxy
carries the encryption (row 76).

**What it changes.** The plan builds a loopback web server that serves the
page and the API. It checks the `Origin` and `Host` headers and limits
connections. The plan documents an example proxy setup, with Caddy as the
example.

**What it rules out.** Shephrd builds no TLS of its own, no certificate
handling, no relay, and no Tailscale integration. The web server never
listens on a non-loopback address.

## Decision 2: phone alerts go through ntfy, behind one sender interface

**The owner's exact words:** "hmmmm. so the app will be expo based. so
idk.... for now ntfy is fine. i already have a server running at
192.168.143.4."

**The owner's exact words, in the addendum at the end of the talk:** "ok.
keep alert behind an interfce that can then change the pn carrier." ("pn"
means push notification.)

**Decision.** Alerts are sent to an ntfy topic. The alert sender sits behind
one interface, so the carrier can later change, for example to Expo's push
service for the future phone app, without changing the alert rules. ntfy is
the first and only carrier this plan builds (rows 77, 83).

**What it changes.** The ntfy server's address and the topic are settings.
They have no default value in the code. The owner's server address is a
value the owner sets; it is not written into the code or the default
settings. Each alert names its kind, the agent and the agent's team, and
links to the agent's thread on the page. It carries no thread text and no
secret.

**What it rules out, for now.** Web Push is not built in this plan.

## Decision 3: remote access comes before Shephrd's own Unix user

**The owner's exact words:** "no. for now we get it running first. then once
it is up and running it can improve as we use it. i need this built asap. my
workflows are being severely affected due to the issues in herdr synapse"

**Decision.** Remote access ships in this plan without Shephrd's own Unix
user. The own-user setup comes later, once Shephrd is in daily use. This is
the owner's explicit approval to break the order that SECURITY.md promised,
"It is planned for before remote access is built" (row 78).

**What it changes.** The plan has no own-user unit, and remote access is not
gated on one. SECURITY.md's paragraph "Agents can read Shephrd's own files"
now says that the owner approved remote access first, and that the own-user
setup is still planned. The accepted limit stays written down: any agent can
read Shephrd's state folder, including the stored account keys.

**What it rules out.** An own-user unit in this plan, and a plan that stops
at loopback.

## Decision 4: an alert's link opens the thread, and the owner answers there

**The owner's exact words:** "a. so it will open teh webpage and all but i
need auth to get in. for now it will just be open we can add auth later"

**Decision.** An alert's link opens the agent's thread on the web page. The
owner answers there. There are no signed one-question links (row 79).

**What it changes.** Alert links point at the thread. No new kind of
credential is added. Opening a link never runs a command by itself.

**What it rules out.** Signed guest links.

## Decision 5: the web server is open for now

**The owner's exact words:** "b. for now just leave it be. i want to start
using it. only me on my network so does not matter"

**Decision.** The web page and the API on the loopback web server start with
no authentication. Authentication is added later. This is the owner's
explicit approval to suspend SECURITY.md rule 2, "Every API request is
authenticated, including on loopback", for the loopback web server (row 80).

**What the owner was told it costs, before deciding.** Until authentication
is added, every agent on the machine can reach the open server on
`127.0.0.1`, for example with `curl`, and so can anyone who reaches the
owner's proxy. Either can act with the owner's full control. An agent stuck
on an approval could approve itself, or start agents with full access. That
bypasses the permission ceiling and the ancestry check that the engine's own
socket enforces.

**What it changes.** No pairing unit is needed before the web page works.
Pairing with a one-time code moves to a later plan. The engine's own Unix
socket keeps its authentication unchanged; only the new web server is open.
SECURITY.md says that rule 2 is suspended for the loopback web server, and
states the risk above.

## The owner's condition on the open web server

**The owner's exact words:** "like make it in a way that we can add pairing
without major refactors"

**Decision.** The web server is built so that pairing and authentication
slot in later without major refactoring (row 81). In practice:

- Every request to the web server passes through one function that decides
  who the caller is. While the server is open, it always answers "the owner,
  through the open web server".
- The web page sends its credential header from one place in its client,
  and the header is empty for now.
- The engine's existing per-device credentials, in
  `packages/engine/src/identity/devices.ts`, are the credential that pairing
  will issue.

Adding pairing later then means changing that one function and adding the
pairing commands, not reworking every route.

## Decision 6: three commands work only at the computer

**The owner's exact words:** "yes."

**Decision.** Three commands work only at the computer itself: creating a
pairing code, changing the web server's settings, and adding a standing
permission rule. They run only over the engine's Unix socket with the owner
credential, from the owner's terminal or a Herdr pane. The web server
refuses them, whatever the caller (row 82).

**Why.** Each of the three outlives a moment's access: new devices, wider
exposure, or an automatic allow. While the web server is open, this also
stops an agent that reaches the page from granting itself a standing allow
through the page. It is a guard and not a boundary while the server is open:
a web caller can start a program that reads the owner credential (row 142).

**What it changes.** AGENTS.md rule 5, "a web or mobile client is never a
second-class citizen", is narrowed for these three commands by the owner's
choice. Contract section 2 lists every other exception, each of which came
from a lead's ruling for the owner to review (row 142).

**What it rules out.** Running those three commands from the web page or a
phone.

## The guard against agents on the same machine

The owner's reason for an open server, "only me on my network", covers the
network but not the agents on the same machine. The lead asked the planner
to evaluate a guard that costs almost nothing and adds no authentication,
and to decide (row 84).

**The guard.** When a connection to the web server opens, Shephrd finds the
process at the other end of the loopback connection and applies the
engine's existing rule for agents' processes to it.

1. The kernel's socket tables, `/proc/net/tcp` and `/proc/net/tcp6`, list
   each loopback connection with its two ports, the user id that owns it and
   its socket's inode number.
2. If that user id is not Shephrd's own user id, the connection is refused,
   unless proxy mode is on and the user id matches the "proxy user id"
   setting, which the owner sets at the computer. A reverse proxy that runs
   as its own user, such as `caddy`, passes only this way, and its requests
   are always judged as public. The first draft let every other user id
   through; the lead's review ruling replaced that (rows 92, 133).
3. If the user id is Shephrd's own, Shephrd finds the process that holds the
   socket's inode, by reading the `/proc/<pid>/fd` links of the owner's
   processes. It then walks that process's parents and applies the engine's
   check from `packages/engine/src/api/ancestry.ts`: a process in a recorded
   agent adapter's process group, or descended from a recorded adapter, is an
   agent.
4. An agent's process is refused, and so is a socket that an agent's process
   holds along with another process. A same-user process whose owner cannot
   be found is also refused, so a lookup failure fails closed.
5. In proxy mode, a public request is refused when its last
   `X-Forwarded-For` entry, the one the proxy adds, is missing, is one of the
   host's own addresses, or is outside the "allowed client networks" setting,
   which the owner sets at the computer and which has no default. An agent
   that connects to the proxy's public address on the same machine arrives
   with the host's own address. Outside proxy mode, a request that carries a
   forwarded header is refused (rows 89, 91, 113, 133).

**Whether it holds.** It holds against an agent, or a program an agent
starts, that connects to the web server directly. That is the easy case the
owner was warned about: an agent running `curl` against `127.0.0.1`. It is a
guard, like the engine's existing ancestry check, and not a security
boundary.

**What it costs.** One read of the two socket tables and one scan of the
owner's processes' open files when a connection opens, after the `Host` and
`Origin` checks, not on every message.
The web page holds one WebSocket open, so this runs rarely. There is no new
dependency, and Shephrd already runs on Linux only.

**Where it fails.** A deliberate agent can get past it in these ways:

- It starts a process that leaves its process tree, for example with
  `setsid` and a double fork, so the process has no agent ancestor.
- It asks a program that is not its descendant to connect for it, such as
  a user service manager, a scheduled job, or a terminal outside its tree.
- It reaches the web server through the proxy from another machine or
  network namespace whose address is inside the allowed client networks and
  is not one of the host's own.
- Its adapter dies, so an orphaned process no longer has a recorded ancestor.

**What was chosen.** Build the guard, in the one function that decides the
caller, and say plainly in SECURITY.md that it stops accidents and simple
misuse, not a hostile agent. It adds no authentication, as the owner
deferred authentication. The real fix is authentication, with pairing, which
slots into the same function.

## What stays open

- When authentication and pairing are added, and when Shephrd's own Unix
  user is built. The owner deferred both to "once it is up and running".
- Whether the phone may choose "Allow always" while the web server has no
  login. This is the owner's question 6, and the plan folds the recommended
  answer, marked pending (row 95).
