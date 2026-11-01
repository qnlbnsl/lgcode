# What ACP means, and where it fits in Shepherd

Researched on 2026-10-30. The sources are listed at the end.

## Three different things are called ACP

The acronym ACP has been used by three unrelated protocols. In the coding-agent
world, and in anything that mentions T3 Code, Zed, Claude Code, or Codex, ACP
means the **Agent Client Protocol**. The other two, the Agent Communication
Protocol (from IBM, for agents talking to other agents, since folded into
Google's Agent2Agent protocol) and the Agentic Commerce Protocol (from OpenAI
and Stripe, for agents making purchases), are not relevant to Shepherd.

## What the Agent Client Protocol is

The Agent Client Protocol is an open standard, started by Zed and now
community-governed under the `agentclientprotocol` organisation on GitHub,
under the Apache License 2.0. It defines how a client (an editor, a desktop
app, a web console) drives a coding agent (Claude Code, Codex, Gemini CLI,
OpenCode, and others).

It is often described as "the Language Server Protocol for coding agents".
Before the Language Server Protocol, every editor needed its own plugin for
every language. Before ACP, every editor needed its own integration for every
agent. With one shared protocol, N clients and M agents need N plus M
integrations instead of N times M.

The protocol is JSON-RPC, which is a simple request-and-response format
written in JSON. For a local agent, the client starts the agent as a child
process and the two exchange JSON-RPC messages over the process's standard
input and output. The client asks the agent to open a session, sends it a
prompt, and receives a stream of updates back: the agent's text, its plan,
the tool calls it makes, and requests for permission. The agent can also ask
the client to read or write a file or to run a terminal command. The
specification also describes remote agents over HTTP or WebSocket, but says
that full remote support is still a work in progress.

ACP reuses the data formats of the Model Context Protocol (MCP) where it can.
The two protocols point in different directions. MCP connects an agent to
tools and data. ACP connects a person's client to the agent.

## Why it seemed to contradict "every harness is proprietary"

The intuition is correct: Claude Code and Codex each speak their own protocol
natively. ACP does not replace those protocols. It wraps them.

- **Claude Code** does not speak ACP natively. An adapter,
  `claude-agent-acp`, uses Anthropic's Claude Agent SDK to run Claude Code and
  translates its events into ACP.
- **Codex** has its own JSON-RPC interface, the Codex app-server. An adapter,
  `codex-acp`, translates it into ACP.
- **Gemini CLI** and a growing number of others speak ACP natively.

So ACP is a common language spoken through translators. Each harness keeps
its proprietary core, and an adapter sits in front of it.

## How T3 Code actually does it

T3 Code, the multi-agent app that Shepherd's thread view takes inspiration
from, mostly does **not** use ACP. It talks to each harness through that
harness's own best interface:

- Codex through the Codex app-server over JSON-RPC.
- Claude Code through the Claude Agent SDK and the `claude` executable.
- Cursor and OpenCode through their own SDKs.
- Grok, and any agent from the ACP registry, through ACP.

Its phone and web clients do not speak ACP either. They connect to a T3
server running on the owner's machine, over an authenticated WebSocket. A
device is added with a one-time pairing link or QR code. The server keeps each
thread (its messages, approvals, and changed files) after the client closes.

The lesson for Shepherd is that ACP is a way for a server to drive agents. It
is not the protocol between the server and a phone.

## Where ACP would fit in Shepherd

Herdr runs each agent as an interactive terminal program in a pane. Herdr
Synapse coordinates agents by reading those panes and typing into them,
without patching any harness. That approach works with any agent that has a
terminal interface, but the only structured information it gets is whatever
can be read off the screen.

ACP, or a harness's own SDK, gives the opposite trade. The agent runs without
a terminal interface, and the server receives structured events: each
message, each tool call, each permission request, and each changed file. That
structure is exactly what a good thread view on a phone needs.

This leaves Shepherd with a design decision, recorded as an open question in
[../features.md](../features.md):

1. **Terminal panes only, as Synapse does.** This works with every Herdr agent
   today. Threads on a phone would be reconstructed from terminal output.
2. **ACP or SDK sessions only.** This gives clean, structured threads. The
   agents would no longer be interactive panes that the owner can type into
   inside Herdr.
3. **Both.** Herdr panes stay the place where agents live. Shepherd uses
   ACP or an SDK where a harness supports it, to get structured events, and
   falls back to the terminal where it does not.

**Decided on 2026-10-30: option 3, with ACP built first.** Each harness gets
a run-mode setting. ACP mode comes first because it is the quickest start and
covers every harness at once. Interactive mode follows, for harnesses where
the terminal program is cheaper or better, which today means Claude: through
ACP, Claude runs on the Agent SDK, and T3 Code reports that the Agent SDK
drains the 5-hour limit faster than interactive Claude Code. See
`docs/features.md`, section 1.

Whatever is chosen, Shepherd's own client API, the one the web page and the
mobile app use, is a separate protocol designed by Shepherd. ACP sits behind
the server, between Shepherd and the agents.

## Sources

1. Agent Client Protocol, introduction: https://agentclientprotocol.com/get-started/introduction
2. Agent Client Protocol, list of agents: https://agentclientprotocol.com/get-started/agents
3. Agent Client Protocol, list of clients: https://agentclientprotocol.com/get-started/clients
4. The `agentclientprotocol` organisation on GitHub: https://github.com/agentclientprotocol
5. Marc Nuri, "Agent Client Protocol (ACP): The LSP for AI Coding Agents Explained": https://blog.marcnuri.com/agent-client-protocol-acp-introduction
6. Zed, "Claude Code via ACP", 3 September 2025: https://zed.dev/blog/claude-code-via-acp
7. T3 Code on GitHub: https://github.com/pingdotgg/t3code
8. Flavio Copes, "A deep dive into T3 Code", updated 16 October 2026: https://flaviocopes.com/t3-code/
