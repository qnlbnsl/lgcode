# Notifications and their delivery

Notifications can use ntfy, email, or both.
Each enabled carrier receives every enabled alert kind.
A failure from one carrier does not block the other carrier.
The website exposes these controls on Notifications in the service navigation.

## Email uses the owner's mail server

Email uses the owner's Simple Mail Transfer Protocol (SMTP) server.
The owner supplies its host, port, user name, password or app key, sender address, and recipient address.
LGTM Studio has no maker-operated mail relay.

The engine uses Nodemailer 10.5.0 from npm.
Nodemailer is maintained and implements SMTP authentication, message encoding, and Transport Layer Security (TLS).
Using the library avoids maintaining a second SMTP implementation in this repository.
Its [SMTP documentation](https://nodemailer.com/smtp) describes the transport options.
No library source was copied into this repository.

Choose TLS from connection for a server that expects encryption immediately, usually on port 465.
Choose Require STARTTLS for a server that upgrades the connection, usually on port 587.
STARTTLS is the SMTP command that starts TLS encryption.
A remote connection cannot fall back to cleartext.
The plain connection option accepts only the literal loopback address `127.0.0.1`.
That option supports a local relay and the local fake server used by the tests.
Certificate verification remains enabled.

Passwords and access tokens use the existing owner-only `secrets.json` store.
The store writes the file with mode `0600`.
Clients receive only whether a secret is set.
Secret fields start empty and clear after submission.
Changing a mail host, port, connection security, or user name clears the old secret association.
Changing a sender or recipient keeps that association.
Turning a carrier off preserves its configuration and secret.
Clear password removes the email secret association.

## Test messages report transport acceptance

Each carrier has its own Send a test action.
A successful email result means that the owner's SMTP server accepted the message for its recipient.
It does not prove that the final mailbox received it.
A successful ntfy result means that the configured ntfy server accepted the request.
Failures use fixed diagnostics without a server response or a credential.
A test message creates no alert or stored event.
An explicit test bypasses quiet hours.

## Quiet hours hold open alerts

Quiet hours use a start time, an end time, and a named time zone.
The start is included and the end is excluded.
The times must differ.
A window can cross midnight.
The selected time zone determines daylight-saving transitions.
The default window is disabled and uses 22:00 to 07:00 in UTC.
UTC means Coordinated Universal Time.

Open alerts are eligible for delivery when quiet hours end.
Alerts that were answered or dismissed while held are not sent.
The failure override lets alerts of kind `failure` through during quiet hours.
Manual retries respect quiet hours and the carrier's enabled state.

## Merge and sprint alert sources

Opening an owner main-branch review raises a merge alert.
Deciding or replacing that review clears its alert.
Completing a sprint raises a sprint alert.
Sprint alerts are off by default.
A sprint alert's key includes its project identifier.
An owner can dismiss a completed sprint's alert.
These sources use existing engine events.
No merge or sprint control needs a refusal.

## Client application programming interface actions

The client application programming interface (API) exposes every control.
All notification settings and actions require the owner credential.

- `client.alerts.settings` returns the carrier list, secret-presence flags, alert kinds, and quiet hours.
- `client.alerts.carrier.set` configures a carrier and enables it.
- `client.alerts.carrier.enabled.set` changes one carrier's enabled state.
- `client.alerts.carrier.set-token` stores a secret through the existing redacted ingress.
- `client.alerts.carrier.clear-token` clears one carrier's secret.
- `client.alerts.test` sends a test through the named carrier.
- `client.alerts.quiet.set` changes the entire quiet-hours setting.
- `client.alerts.settings.set` changes one alert kind.
- `client.alerts.list` returns the individual carrier delivery results.
- `client.alerts.retry` retries the named carrier using the displayed generation and attempt.

The optional `name` field selects `ntfy` or `email` on test, token, and retry requests.
Omitting it preserves the original ntfy behavior.
An email token request's origin is the JSON encoding of `[host, port, security, username]`.
The secret value belongs only in the redacted `value` field.
The old single-carrier response fields remain available for existing ntfy clients.
New carrier implementations register their transport, validation, and secret binding in `client/alerts/carriers/index.ts`.
Their public settings schema also belongs in the shared contracts.
