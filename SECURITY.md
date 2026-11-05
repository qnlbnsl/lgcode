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

Redact message boards, local paths, credentials, API tokens, the web password,
session cookies, and raw provider responses before you send anything.

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
user, so its private files are out of the agents' reach. It is still
planned. On 2026-11-03 the owner approved building remote access before it,
so that Shephrd is in use sooner. Until it is built, any agent can read
Shephrd's state folder, including the stored account keys.

Agents can also read the web password. Agents run as the owner's user, so an
agent can read the engine's first environment through `/proc`, even though the
engine deletes the variable and agents do not inherit it. The password protects
against the network. It is not a boundary against an agent on the same user
until the own-user setup exists. The owner accepted this limit on 2026-11-03.

The part of Shephrd that needs the most care is its client API, because it
lets a web page, a desktop app, or a phone control agents that can run
commands on the host. Anyone who can reach that API with a valid credential
can, in effect, run code on the machine. On the web server, that credential is
one password.

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
   unauthenticated mode. The engine's Unix socket uses the owner credential and
   agent tokens. The web server uses one password, which the service reads from
   the local environment variable `SHEPHRD_WEB_PASSWORD`, and the session that a
   correct password earns. A logged-in session is the owner. If the variable is
   not set, the web server does not start. Only the login route and the page's
   static files, which hold no data, are served with no session.

   The loopback port has a limit of its own. While the web server is down, or
   when it never started, another local user can bind `127.0.0.1` at its port,
   because that needs no rights. That program can show a fake login form and
   capture the password. In proxy mode, the proxy sends the phone's requests to
   it, and it can serve a page with a long cache lifetime under the real public
   address. `docs/remote-access.md` says that a `client.web-down` alert means the
   page must not be opened. A local program can also send any header, so the
   `Host` and `Origin` checks stop web pages and not local programs.
3. **The password is checked in constant time and is not kept by the browser.**
   A login carries it in the request body, never in a URL. One person uses
   Shephrd, and the owner chose no rate limits and no lockouts on 2026-11-03.
4. **A session is one random token per engine start, held in memory only.**
   Logging out replaces the token, which signs out every client. Changing the
   password means restarting the engine, which also ends the session. A browser
   holds the token in an `HttpOnly`, `SameSite=Strict` cookie, which is `Secure`
   on a public request when the public address is `https`.
5. **An encrypted channel for remote access is the owner's setup**, such as TLS, a
   Tailscale tailnet, or an SSH tunnel. Shephrd serves plain HTTP on loopback and
   does not offer it to a non-loopback address. A configured public address must use
   HTTPS, even inside a private network, by the owner’s decision on 2026-11-04.
   The owner supplies the external proxy's certificate. The owner's later
   clarification on 2026-11-04 accepts a self-signed certificate and continuation
   past the expected browser certificate warning. Certificate trust installation
   is not required. Shephrd holds no certificate and performs no trust setup.
   An SSH local forward provides interim access at `http://127.0.0.1:<port>`, with identical ports on
   the device and server. `localhost` remains refused. The owner’s earlier words,
   on 2026-11-03:
   "Let's just focus on plain HTTP. That's what the software itself is doing, right? Then, whatever proxy we add on to it, that proxies to localhost. We'll figure this out then. Because I have to set up a local certificate authority so that I can do ARPA DNS certs"
6. **Secrets never reach logs, the message board, or a client.** This covers
   API tokens, the web password, the session token, and the agent harnesses'
   own login tokens. Agents do not inherit the web password's variable.
   Explicit secrets from `secrets.json`, resolved `secret:` variables,
   harness login files, the web password, and owner and agent credentials stay
   registered at any length.
   A value inferred only from an inherited environment variable whose name
   matches `KEY`, `TOKEN`, `SECRET` or `PASSWORD` is registered only at eight
   or more characters when its trimmed text is nonempty, is neither `true`
   nor `false`, and is not a plain number.
7. **Text from an agent is data, not a command.** A message on the board
   cannot change permissions, teams, or settings unless the owner's
   credential approves it.
