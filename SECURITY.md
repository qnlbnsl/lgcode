# Security Policy

## Supported versions

Shepherd has no release yet. Until the first tagged release, only the current
`main` branch receives security fixes. After that, the latest tagged release
and `main` will receive them.

## Reporting a vulnerability

Do not report a vulnerability in a public issue.

Use GitHub's private vulnerability reporting for this repository, at
`https://github.com/qnlbnsl/sheprd/security/advisories/new`. If that page is
not available, email the maintainer at qnlbnsl@gmail.com with "Shepherd
security" in the subject line.

Include these details:

- The Shepherd version or commit, the Herdr version, and the platform.
- The impact: what an attacker can read, change, or run.
- A minimal reproduction.

Redact message boards, local paths, credentials, API tokens, pairing links,
and raw provider responses before you send anything.

## What Shepherd protects, and what it does not

Shepherd runs with the same local-user permissions as Herdr. It is not a
sandbox. The coding agents it manages can run commands and change files as
that user, and Shepherd does not stop them. Run untrusted repositories inside
an external sandbox.

Agents can read Shepherd's own files. The agents run as the owner's user, so
any agent can read Shepherd's state folder, including the owner's credential,
the stored account keys and the event log. File permissions cannot stop a
program that runs as the same user. Shepherd's permission rules (the
permission ceiling, the folder rule and the approval routing) therefore stop
an agent's mistakes, not a deliberately hostile agent. Where a harness
supports it, Shepherd adds a rule that forbids its agents to read the state
folder, but that rule is a guard against accidents, not a wall. The owner
accepted this limit on 2026-11-01. The real fix is to run Shepherd as its own
user, so its private files are out of the agents' reach. It is planned for
before remote access is built.

The part of Shepherd that needs the most care is its client API, because it
lets a web page, a desktop app, or a phone control agents that can run
commands on the host. Anyone who can reach that API with a valid credential
can, in effect, run code on the machine.

## Security rules the design keeps

These rules apply to every change. A change that breaks one is a security bug.

1. **The API listens on the loopback address by default.** Listening on any
   other address is an explicit setting that the owner turns on.
2. **Every API request is authenticated, including on loopback.** There is no
   unauthenticated mode.
3. **A new device is paired with a short-lived, single-use pairing code.**
   A pairing code is never reusable and never stored in plain text.
4. **Each device gets its own credential, and each credential can be revoked
   on its own.** Revoking one phone does not sign out every client.
5. **Remote access goes over an encrypted channel**, such as TLS, a Tailscale
   tailnet, or an SSH tunnel. Shepherd does not offer plain HTTP to a
   non-loopback address.
6. **Secrets never reach logs, the message board, or a client.** This covers
   API tokens, pairing codes, and the agent harnesses' own login tokens.
7. **Text from an agent is data, not a command.** A message on the board
   cannot change permissions, teams, or settings unless the owner's
   credential approves it.
