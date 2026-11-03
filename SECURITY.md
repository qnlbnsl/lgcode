# Security Policy

## Supported versions

Shephrd has no release yet. Until the first tagged release, only the current
`main` branch receives security fixes. After that, the latest tagged release
and `main` will receive them.

## Reporting a vulnerability

Do not report a vulnerability in a public issue.

Use GitHub's private vulnerability reporting for this repository, at
`https://github.com/qnlbnsl/sheprd/security/advisories/new`. If that page is
not available, email the maintainer at qnlbnsl@gmail.com with "Shephrd
security" in the subject line.

Include these details:

- The Shephrd version or commit, the Herdr version, and the platform.
- The impact: what an attacker can read, change, or run.
- A minimal reproduction.

Redact message boards, local paths, credentials, API tokens, pairing links,
and raw provider responses before you send anything.

## What Shephrd protects, and what it does not

Shephrd runs with the same local-user permissions as Herdr. It is not a
sandbox. The coding agents it manages can run commands and change files as
that user, and Shephrd does not stop them. Run untrusted repositories inside
an external sandbox.

Agents can read Shephrd's own files. The agents run as the owner's user, so
any agent can read Shephrd's state folder, including the owner's credential,
the stored account keys and the event log. File permissions cannot stop a
program that runs as the same user. Shephrd's permission rules (the
permission ceiling, the folder rule and the approval routing) therefore stop
an agent's mistakes, not a deliberately hostile agent. Where a harness
supports it, Shephrd adds a rule that forbids its agents to read the state
folder, but that rule is a guard against accidents, not a wall. The owner
accepted this limit on 2026-11-01. The real fix is to run Shephrd as its own
user, so its private files are out of the agents' reach. It is planned for
before remote access is built.

The part of Shephrd that needs the most care is its client API, because it
lets a web page, a desktop app, or a phone control agents that can run
commands on the host. Anyone who can reach that API with a valid credential
can, in effect, run code on the machine.

## Harnesses with no deny-read or deny-write rule

The rule above, which forbids an agent to read the state folder, needs the
harness to accept it. The same is true of the rule that forbids an agent to
change its own harness settings. In Shephrd's default settings, no harness
gets either rule today. The owner can set a launch rule for a harness in its
settings once one is verified.

- **`claude`.** Its adapter accepts permission rules only inside the
  session's metadata, and Shephrd's settings contract cannot express rules
  there yet. See issue 91 in `docs/issues.md`.
- **`codex`.** No launch-argument rule for it has been verified and recorded,
  so its default is no rule. See issue 104 in `docs/issues.md`.
- **`gemini`.** No launch-argument rule for it has been verified and
  recorded, so its default is no rule. See issue 104 in `docs/issues.md`.
- **`cursor`.** No launch-argument rule for it has been verified and
  recorded, so its default is no rule. See issue 104 in `docs/issues.md`.

For these harnesses, the folder rule, the permission ceiling and the approval
routing are the only guards. They stop an agent's mistakes, not a hostile
agent.

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
   tailnet, or an SSH tunnel. Shephrd does not offer plain HTTP to a
   non-loopback address.
6. **Secrets never reach logs, the message board, or a client.** This covers
   API tokens, pairing codes, and the agent harnesses' own login tokens.
   Explicit secrets from `secrets.json`, resolved `secret:` variables,
   harness login files, and owner, device and agent credentials stay
   registered at any length.
   A value inferred only from an inherited environment variable whose name
   matches `KEY`, `TOKEN`, `SECRET` or `PASSWORD` is registered only at eight
   or more characters when its trimmed text is nonempty, is neither `true`
   nor `false`, and is not a plain number.
7. **Text from an agent is data, not a command.** A message on the board
   cannot change permissions, teams, or settings unless the owner's
   credential approves it.
