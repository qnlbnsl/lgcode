# Remote access through the owner's proxy

Shephrd serves plain Hypertext Transfer Protocol (HTTP) on loopback.
The default page address is `http://127.0.0.1:8787`.
The engine's Unix socket remains available when the web server is off.
A valid web session has the owner's full authority through the application
programming interface (API).

The reverse proxy, WireGuard peers, firewall, certificates, and name resolution
are the owner's setup.
The configuration below is an example, rather than an installed service.
It assumes that Caddy and Shephrd run on the same host.
The owner must adapt it to the actual network before using it.

## Set the password on the Shephrd service alone

Set `SHEPHRD_WEB_PASSWORD` to a long, random string in the environment of the
service that starts the engine.
Use a private service environment file or the service manager's secret input.
Keep the value out of command arguments, shell history, repository files, and
logs.
A missing value or a value shorter than eight characters leaves the web server
in `no-password` state.
Eight characters is an acceptance floor, rather than a recommended length.

Never put `SHEPHRD_WEB_PASSWORD` in Herdr's environment or a shared shell profile.
An interactive agent's pane inherits Herdr's environment.
The engine removes the variable from its own environment before spawning agents.
That removal does not protect against an agent running as the same user.
Such an agent can still read the engine's initial environment through `/proc`.
The state folder and stored account keys have the same local-user limit.
See [SECURITY.md](../SECURITY.md) for this boundary.

Changing the password means changing the service environment and restarting the
engine.
A restart ends every existing web session.
Logging out also ends every client's session.
The browser does not store the password.
The session token is held in a cookie that page scripts cannot read.

## Connect the phone through WireGuard

Give the host and phone separate WireGuard peers.
Route the host's WireGuard address through the phone's tunnel.
This example uses `10.77.0.1` for the host and `10.77.0.0/24` for the WireGuard
network.
Replace both with the owner's addresses.
Keep the proxy's listening port inaccessible through the home network and the
public network.

The example Caddyfile serves `http://10.77.0.1:8080` and forwards to Shephrd's
loopback port:

```caddyfile
http://10.77.0.1:8080 {
    bind 10.77.0.1

    @wireguard remote_ip 10.77.0.0/24
    handle @wireguard {
        reverse_proxy 127.0.0.1:8787
    }

    handle {
        respond "Forbidden" 403
    }
}
```

The `bind` directive restricts the listening interface.
The `remote_ip` matcher restricts the immediate peer's address.
The fallback refuses other peers.
Check other Caddy sites and listeners for wildcard bindings on the same port.
These directives are documented in Caddy's [bind reference](https://caddyserver.com/docs/caddyfile/directives/bind),
[remote_ip reference](https://caddyserver.com/docs/caddyfile/matchers#remote-ip),
and [reverse_proxy reference](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
These references were checked on 2026-11-04.

With an `http` public address, only what the owner runs in front of Shephrd
protects the password and session cookie in transit.
In this example, that protection is the WireGuard tunnel.
Shephrd adds no transport encryption.
If the owner uses `https` instead, the proxy must provide Transport Layer
Security (TLS), and the phone must trust its certificate.

## Match the web settings to the proxy

Open the local page and log in.
In Settings, enable proxy mode and set the public address to the proxy's exact
site address.
For the example, the two settings are `proxyMode: true` and
`publicAddress: "http://10.77.0.1:8080"`.
The public address contains a scheme, host, and optional port.
It contains no path, credentials, query, or fragment.
Proxy mode requires a public address.

The same record can be set from the owner's terminal:

```sh
shephrd client web settings set --input '{"settings":{"enabled":true,"port":8787,"heartbeatSeconds":25,"proxyMode":true,"publicAddress":"http://10.77.0.1:8080"}}'
shephrd client web settings
```

Saving web settings closes existing web connections.
A port change applies at the next engine start.
Turning the server off or choosing an unreachable public address may require
the terminal to restore access.
Proxy mode keeps Shephrd's listener on loopback.

Preserve the browser's `Origin` header through the proxy.
It must match the public address's scheme, host, and port.
Shephrd accepts a public request when `Host` or `Origin` names that address.
This accommodates a proxy that rewrites `Host`.
An ordinary page navigation can omit `Origin`, so keep the public `Host` for
static file requests.
Forwarded headers are refused outside proxy mode.
Their values do not select a scheme or relax authentication.
The session cookie is `Secure` for a public request with an `https` public
address.
An `http` public address does not earn that attribute.

## Protect account secrets and ntfy alerts

Store an account key with `shephrd accounts set-secret <account-id> <env-name>`.
The command reads the secret from standard input without echoing it.
Never paste a key into an account's ordinary environment values.
Those values can appear in settings and event history.

On the owner's ntfy server, enable authentication and set
`auth-default-access: deny-all`.
Give a dedicated regular user write-only access to the alert topic for Shephrd.
Give a different regular user read-only access to that topic for the phone.
Issue separate tokens for those users.
Do not use an administrator token.
The permissions come from the users' topic access rules.
See ntfy's [access control documentation](https://docs.ntfy.sh/config/#access-control),
checked on 2026-11-04.

In Shephrd's Settings, set the ntfy server and topic before storing its token.
Use the carrier token form or `shephrd client alerts carrier set-token`.
The terminal command displays the server for confirmation and reads the token
without echoing it.
Check that server before supplying the token.
The carrier token is distinct from an account key and the web password.
Shephrd cannot enforce the ntfy server's access rules.

An alert carries its kind, a fixed title, the agent's name and team, and an
optional thread link.
The link exists only when proxy mode and a public address are configured.
Opening it navigates to the thread without answering the request.
The owner logs in and reads the request before answering.

## Do not open the page during a web outage

A `client.web-down` alert means the page must not be opened.
Use the owner's terminal to read `shephrd client web settings` and investigate
the outage before returning to the browser.
The engine can keep running while the web server cannot bind its port.

Another local user can occupy the loopback port while Shephrd's web server is
down or has never started.
The owner's proxy can then forward the real public address to that program.
It could serve a fake login page, capture the typed password, and cache a
hostile page under that address.
The `Host` and `Origin` checks do not stop local programs from sending forged
headers.
Confirm that the intended service owns the listener before opening the page.
If a fake page may have been opened, change the password, restart the engine,
and clear the affected browser's site data before using the page again.

## Recover from a lost phone

Remove the lost phone's WireGuard peer first.
Change `SHEPHRD_WEB_PASSWORD` in the service environment and restart the engine
to end every web session.
Revoke the phone's ntfy token and provision a new token for its replacement.
Rotate the Shephrd publishing token too if it may have been exposed, and update
the carrier's stored token.

Remote revocation does not erase data already copied to the phone.
Remove notifications and browser data where possible.
The page keeps threads in memory rather than browser storage.
Notifications, the ntfy server's cache, exported threads, and proxy access logs
have their own retention.
The carrier's attempt to clear a notification does not prove erasure.

## Checks reserved for the owner

After the actual proxy exists, check these steps on the owner's devices.
The headless browser test does not replace them.

1. On mobile data with WireGuard enabled, open the public address, log in, and
   read the situation view.
2. On mobile data with WireGuard disabled, confirm that the page is unreachable.
3. From a second device on the home network without WireGuard, confirm that the
   page is unreachable.
4. Confirm that the proxy preserves `Origin` and forwards the expected `Host`.
   Confirm that the cookie's `Secure` attribute matches the configured scheme.
5. Receive a real permission alert through ntfy, open its thread link, inspect
   the input, answer the request, and read the answer in the thread.
6. Record the devices, proxy settings without secrets, date, and results in the
   run's result file.
