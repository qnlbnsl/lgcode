import { afterEach, expect, it } from "vitest";
import {
  assertNoSecrets, cleanupUnit7b, fakeEngine, finishCli, ownerCredential, prepareRoot, serviceEnvironment, startCli, succeed,
} from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);
const secret = "unit7b-stdin-secret-0123456789abcdef";

it("S01 catches reading the secret from argv, echoing stdin, truncating the input, or forwarding a secret outside its dedicated RPC value", async () => {
  const root = prepareRoot();
  const engine = await fakeEngine(root, { onRequest: (frame, socket) => {
    if (frame.tag !== "accounts set-secret") throw new Error("wrong RPC for secret input");
    assertNoSecrets(child, [secret, ownerCredential]); // inspect the live process before replying
    succeed(socket, frame, { requestId: frame.payload.requestId });
  } });
  const child = startCli(root, ["accounts", "set-secret", "account-7b", "API_KEY"], serviceEnvironment(root));
  // Wait for the process to exist before supplying data; inspect /proc while
  // stdin remains open, and again at the received RPC barrier.
  assertNoSecrets(child, [secret, ownerCredential]);
  child.child.stdin.write(secret.slice(0, 13));
  child.child.stdin.end(`${secret.slice(13)}\n`);
  const exit = await finishCli(child);
  expect(exit).toEqual({ code: 0, signal: null });
  expect(engine.requests).toHaveLength(1);
  const frame = engine.requests[0]!;
  expect(frame.tag).toBe("accounts set-secret");
  expect(frame.payload.accountId).toBe("account-7b");
  expect(frame.payload.name).toBe("API_KEY");
  expect(frame.payload.value === secret, "stdin secret was altered, truncated, or included its terminal newline").toBe(true);
  expect(typeof frame.payload.nonce).toBe("string");
  expect(frame.payload.nonce.length).toBeGreaterThan(0);
  const { value: _value, ...other } = frame.payload;
  expect(JSON.stringify(other).includes(secret), "secret duplicated into metadata").toBe(false);
  assertNoSecrets(child, [secret, ownerCredential]);
});

it("S02 catches accepting or echoing a secret argument instead of requiring standard input", async () => {
  const root = prepareRoot();
  const engine = await fakeEngine(root);
  // This synthetic hostile argument is deliberately in the test child's argv;
  // it must be refused without ever reaching the wire or either output pipe.
  const child = startCli(root, ["accounts", "set-secret", "account-7b", "API_KEY", secret], serviceEnvironment(root));
  child.child.stdin.end();
  const exit = await finishCli(child);
  expect(exit.code).not.toBe(0);
  expect(exit.signal).toBeNull();
  expect(engine.requests).toHaveLength(0);
  expect(engine.upgrades).toHaveLength(0);
  expect(child.stdout().includes(secret) || child.stderr().includes(secret), "secret argument echoed").toBe(false);
  expect(child.stderr()).toMatch(/stdin|standard input|argument/i);
});
