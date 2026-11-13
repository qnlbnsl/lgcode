import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  assertNoSecrets, cleanupUnit7b, fakeEngine, finishCli, prepareRoot, serviceEnvironment, startCli, succeed, until,
} from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);
const words = ["client", "alerts", "carrier"];
const origin = "https://push.example";

it("6.14 set-token shows the current server, confirms it, and sends only a stdin value with the origin and nonce", async () => {
  const root = prepareRoot(); const token = randomUUID();
  const peer = await fakeEngine(root, { onRequest: (frame, socket) => {
    if (frame.tag === "client.alerts.settings") succeed(socket, frame, { requestId: frame.payload.requestId, kinds: [], carrier: { _tag: "ntfy", server: origin, topic: "phone" }, tokenSet: false });
    else succeed(socket, frame, { requestId: frame.payload.requestId });
  } });
  const child = startCli(root, [...words, "set-token"], serviceEnvironment(root));
  const ready = await until("the selected server to be displayed before token input", () => {
    if ((child.stdout() + child.stderr()).includes(origin)) return { ready: true };
    return child.exited() ? { ready: false } : false;
  });
  expect(ready.ready, "6b must display the selected server before consuming a token").toBe(true);
  expect(peer.requests.map((frame) => frame.tag)).toEqual(["client.alerts.settings"]);
  child.child.stdin.end(`yes\n${token}\n`);
  expect(await finishCli(child), "6b must install the terminal's stdin-only token command").toEqual({ code: 0, signal: null });
  expect(child.stdout() + child.stderr()).toContain(origin);
  expect(child.stdout() + child.stderr()).toMatch(/confirm|continue|proceed|yes|sure/i);
  expect(peer.requests.map((frame) => frame.tag)).toEqual(["client.alerts.settings", "client.alerts.carrier.set-token"]);
  const payload = peer.requests[1]!.payload;
  expect(payload.origin).toBe(origin);
  expect(payload.value === token).toBe(true);
  expect(typeof payload.nonce).toBe("string"); expect(payload.nonce.length).toBeGreaterThan(0);
  const { value: _value, ...metadata } = payload;
  expect(JSON.stringify(metadata).includes(token)).toBe(false);
  assertNoSecrets(child, [token]);
});

it("6.14 declining the displayed server performs no token write", async () => {
  const root = prepareRoot();
  const peer = await fakeEngine(root, { onRequest: (frame, socket) => succeed(socket, frame, {
    requestId: frame.payload.requestId, kinds: [], carrier: { _tag: "ntfy", server: origin, topic: "phone" }, tokenSet: false,
  }) });
  const child = startCli(root, [...words, "set-token"], serviceEnvironment(root)); child.child.stdin.end("no\n");
  await finishCli(child);
  expect(child.stdout() + child.stderr(), "the confirmation must name the actual selected server").toContain(origin);
  expect(peer.requests.map((frame) => frame.tag)).toEqual(["client.alerts.settings"]);
});

it.each(["positional", "JSON input"])("6.14 the installed token command rejects a value in argv via %s without echoing it", async (form) => {
  const root = prepareRoot();
  const help = startCli(root, [...words, "set-token", "--help"], serviceEnvironment(root));
  expect((await finishCli(help)).code, "an unknown-command refusal must not satisfy this test").toBe(0);
  const peer = await fakeEngine(root); const token = randomUUID();
  const args = form === "positional" ? [token] : ["--input", JSON.stringify({ origin, nonce: "argv", value: token })];
  const child = startCli(root, [...words, "set-token", ...args], serviceEnvironment(root)); child.child.stdin.end();
  expect((await finishCli(child)).code).not.toBe(0);
  expect(peer.requests).toHaveLength(0); assertNoSecrets(child, [token]);
});

it("6.14 clear-token dispatches the authenticated owner command without a secret field", async () => {
  const root = prepareRoot(); const peer = await fakeEngine(root, { onRequest: (frame, socket) => succeed(socket, frame, { requestId: frame.payload.requestId }) });
  const child = startCli(root, [...words, "clear-token"], serviceEnvironment(root)); child.child.stdin.end();
  expect(await finishCli(child)).toEqual({ code: 0, signal: null });
  expect(peer.requests).toHaveLength(1); expect(peer.requests[0]!.tag).toBe("client.alerts.carrier.clear-token");
  expect(Object.keys(peer.requests[0]!.payload)).toEqual(["requestId"]);
});

it("review 4: email password input confirms the configured SMTP destination and never accepts argv secrets", async () => {
  const root = prepareRoot(), password = randomUUID();
  const carrier = { _tag: "email", host: "mail.example.test", port: 465, security: "tls", username: "mail-owner", from: "owner@example.test", to: "recipient@example.test" };
  const peer = await fakeEngine(root, { onRequest: (frame, socket) => {
    if (frame.tag === "client.alerts.settings") succeed(socket, frame, { requestId: frame.payload.requestId, kinds: [], carrier: { _tag: "none" }, tokenSet: false, carriers: [{ name: "email", carrier, enabled: false, tokenSet: false }] });
    else succeed(socket, frame, { requestId: frame.payload.requestId });
  } });
  const child = startCli(root, [...words, "set-token", "email"], serviceEnvironment(root));
  const ready = await until("email destination shown before consuming password", () => (child.stdout() + child.stderr()).includes(carrier.host) ? { ready: true } : child.exited() ? { ready: false } : false);
  expect(ready.ready).toBe(true);
  expect(child.stdout() + child.stderr()).toContain(String(carrier.port));
  expect(child.stdout() + child.stderr()).toContain(carrier.username);
  child.child.stdin.end(`yes\n${password}\n`);
  expect((await finishCli(child)).code).toBe(0);
  expect(peer.requests[1]!.payload).toMatchObject({ name: "email", origin: JSON.stringify([carrier.host, carrier.port, carrier.security, carrier.username]), value: password });
  assertNoSecrets(child, [password]);
  for (const extra of [[password], ["--input", JSON.stringify({ value: password })]]) {
    const rejected = startCli(root, [...words, "set-token", "email", ...extra], serviceEnvironment(root)); rejected.child.stdin.end();
    expect((await finishCli(rejected)).code).not.toBe(0); assertNoSecrets(rejected, [password]);
  }
  expect(peer.requests).toHaveLength(2);
});
