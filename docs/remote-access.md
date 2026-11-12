# Remote access through the owner's proxy

LGTM Studio serves plain Hypertext Transfer Protocol (HTTP) on loopback.
The default page address is `http://127.0.0.1:8787`.
The engine's Unix socket remains available when the web server is off.
A valid web session has the owner's full authority through the application
programming interface (API).

The reverse proxy, WireGuard peers, firewall, certificates, and name resolution
are the owner's setup.
The configuration below is an example, rather than an installed service.
It assumes that Caddy and LGTM Studio run on the same host.
The owner must adapt it to the actual network before using it.

## Use a Secure Shell local forward for interim access

The owner chose Hypertext Transfer Protocol Secure (HTTPS) or loopback access
on 2026-11-04.
A configured public address must use HTTPS.
Plain HTTP public addresses are refused, even inside WireGuard.
The browser needs a secure context for its request identifiers.

Secure Shell (SSH) must already permit the account to connect to the host.
Until the HTTPS proxy is ready, run this on the device with the browser:

```sh
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8787:127.0.0.1:8787 qnlbnsl@SERVER
```

Replace `SERVER` with the host's reachable SSH name or address.
Leave the command running, then open `http://127.0.0.1:8787` and log in.
This is a local port forward, because the listener is on the browser's device.
The public address can remain empty, with proxy mode off.
If the service uses another port, use that same number in both positions of
`-L` and in the browser address.
LGTM Studio compares `Host` exactly against `127.0.0.1:<server-port>`.
A different forwarded port is refused.
The name `localhost` is also refused; type `127.0.0.1` exactly.
If the local port is occupied, free it or change the service port and restart
before creating a matching forward.

## Set the password on the LGTM Studio service alone

Set `LGTM_WEB_PASSWORD` to a long, random string in the environment of the
service that starts the engine.
Use a private service environment file or the service manager's secret input.
Keep the value out of command arguments, shell history, repository files, and
logs.
A missing value or a value shorter than eight characters leaves the web server
in `no-password` state.
Eight characters is an acceptance floor, rather than a recommended length.

Never put `LGTM_WEB_PASSWORD` in Herdr's environment or a shared shell profile.
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

Resolve `lgtm.home.arpa` to `10.77.0.1` on the phone through the owner's
Domain Name System (DNS) setup.
Use a self-signed certificate for `lgtm.home.arpa` at the external proxy.
Place its certificate and private key in the proxy's files, shown here as
`/etc/caddy/lgtm.crt` and `/etc/caddy/lgtm.key`.
Allow the proxy to read the key, and keep it private.
Creating and renewing these files is the owner's proxy setup.
The example Caddyfile serves `https://lgtm.home.arpa:8443` and forwards to
LGTM Studio's loopback port:

```caddyfile
https://lgtm.home.arpa:8443 {
    bind 10.77.0.1
    tls /etc/caddy/lgtm.crt /etc/caddy/lgtm.key

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

The proxy provides Transport Layer Security (TLS) with the self-signed certificate.
The browser's certificate warning is expected.
For example, Chromium may show "Your connection is not private" with
`NET::ERR_CERT_AUTHORITY_INVALID`.
For this owner's proxy, open the warning's advanced options and choose the
option to proceed to `lgtm.home.arpa` before logging in.
The owner accepted this continuation on 2026-11-04.
No certificate or certificate authority needs to be installed in the device's
trust store.
LGTM Studio does not depend on certificate trust.
A private WireGuard network does not remove the HTTPS requirement.
Caddy documents certificate and key files in its [TLS reference](https://caddyserver.com/docs/caddyfile/directives/tls).
This reference was checked on 2026-11-04.
LGTM Studio's connection from the proxy remains HTTP on loopback.
LGTM Studio holds no certificate and performs no certificate generation or trust setup.
The browser tests ignore certificate errors for the self-signed proxy and prove
login and authenticated requests without installing trust.

## Match the web settings to the proxy

Open the local page and log in.
In Settings, enable proxy mode and set the public address to the proxy's exact
site address.
For the example, the two settings are `proxyMode: true` and
`publicAddress: "https://lgtm.home.arpa:8443"`.
The public address contains `https://`, a lower-case host, and an optional nondefault port.
It contains no path, credentials, query, or fragment.
Proxy mode requires a public address.

The same record can be set from the owner's terminal:

```sh
lgtm client web settings set --input '{"settings":{"enabled":true,"port":8787,"heartbeatSeconds":25,"proxyMode":true,"publicAddress":"https://lgtm.home.arpa:8443"}}'
lgtm client web settings
```

Saving web settings closes existing web connections.
A port change applies at the next engine start.
Turning the server off or choosing an unreachable public address may require
the terminal to restore access.
Proxy mode keeps LGTM Studio's listener on loopback.

Preserve the browser's `Origin` header through the proxy.
It must match the public address's scheme, host, and port.
LGTM Studio accepts a public request when `Host` or `Origin` names that address.
This accommodates a proxy that rewrites `Host`.
An ordinary page navigation can omit `Origin`, so keep the public `Host` for
static file requests.
Forwarded headers are refused outside proxy mode.
Their values do not select a scheme or relax authentication.
The session cookie is `Secure` for a public request with an `https` public
address.
An HTTP public address is refused by the settings schema, engine and web page.

## Protect account secrets and ntfy alerts

Store an account key with `lgtm accounts set-secret <account-id> <env-name>`.
The command reads the secret from standard input without echoing it.
Never paste a key into an account's ordinary environment values.
Those values can appear in settings and event history.

On the owner's ntfy server, enable authentication and set
`auth-default-access: deny-all`.
Give a dedicated regular user write-only access to the alert topic for LGTM Studio.
Give a different regular user read-only access to that topic for the phone.
Issue separate tokens for those users.
Do not use an administrator token.
The permissions come from the users' topic access rules.
See ntfy's [access control documentation](https://docs.ntfy.sh/config/#access-control),
checked on 2026-11-04.

In LGTM Studio's Settings, set the ntfy server and topic before storing its token.
Use the carrier token form or `lgtm client alerts carrier set-token`.
The terminal command displays the server for confirmation and reads the token
without echoing it.
Check that server before supplying the token.
The carrier token is distinct from an account key and the web password.
LGTM Studio cannot enforce the ntfy server's access rules.

An alert carries its kind, a fixed title, the agent's name and team, and an
optional thread link.
The link exists only when proxy mode and a public address are configured.
Opening it navigates to the thread without answering the request.
The owner logs in and reads the request before answering.

## Do not open the page during a web outage

A `client.web-down` alert means the page must not be opened.
Use the owner's terminal to read `lgtm client web settings` and investigate
the outage before returning to the browser.
The engine can keep running while the web server cannot bind its port.

Another local user can occupy the loopback port while LGTM Studio's web server is
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
Change `LGTM_WEB_PASSWORD` in the service environment and restart the engine
to end every web session.
Revoke the phone's ntfy token and provision a new token for its replacement.
Rotate the LGTM Studio publishing token too if it may have been exposed, and update
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

1. On mobile data with WireGuard enabled, open the public address, continue past
   the expected self-signed certificate warning, log in, and read the situation
   view without installing certificate trust.
2. On mobile data with WireGuard disabled, confirm that the page is unreachable.
3. From a second device on the home network without WireGuard, confirm that the
   page is unreachable.
4. Confirm that the proxy preserves `Origin` and forwards the expected `Host`.
   Confirm that the public session cookie has the `Secure` attribute.
5. Receive a real permission alert through ntfy, open its thread link, inspect
   the input, answer the request, and read the answer in the thread.
6. Record the devices, proxy settings without secrets, date, and results in the
   run's result file.
