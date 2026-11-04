import { randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import * as Effect from "effect/Effect";
import { afterEach, expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { processWeb } from "../support/processWeb.ts";
import { fakeAgentPath, ownerClient, startFakeAgent, stopAllServices, turnEnded } from "../support/serviceProcess.ts";
import { connected, login, post, rpc } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });
afterEach(stopAllServices);

it("5.17/E34 secret collection: catches omitting a scalar-looking password or the session token from the service redactor", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    // The inferred-secret gate deliberately excludes numeric values. E34
    // must register this usable password explicitly, even after deletion.
    const password = randomBytes(8).readBigUInt64BE().toString();
    const process = yield* processWeb(password);
    const { ctx, root, service } = process;
    const { cookie } = yield* login(ctx);
    const session = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
    const wrong = yield* Effect.promise(() => post(ctx, "/api/login", { password: `${password}x` }));
    expect(wrong.status).toBe(401);
    // The adapter substitutes these generated test values at its stdout
    // boundary. Neither account settings nor an account secret registers
    // them, and the engine therefore receives an actual unredacted frame.
    const inputPath = join(root.root, "generated-input.json");
    writeFileSync(inputPath, JSON.stringify({ password, session }), { mode: 0o600 });
    const adapter = join(root.bin, "fake-adapter");
    writeFileSync(adapter, `#!${globalThis.process.execPath}
const fs = await import('node:fs');
const original = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => {
  const text = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
  if (!text.includes('RUNTIME_SECRET_SENTINEL')) return original(chunk, ...args);
  const planted = JSON.parse(fs.readFileSync(${JSON.stringify(inputPath)}, 'utf8'));
  return original(text.replaceAll('RUNTIME_SECRET_SENTINEL', planted.password + ' ' + planted.session), ...args);
};
await import(${JSON.stringify(pathToFileURL(fakeAgentPath).href)});
`);
    chmodSync(adapter, 0o755);
    const owner = yield* ownerClient(root);
    const agent = yield* startFakeAgent(root, owner, owner, {
      script: { turns: [[{ step: "text", text: "agent says RUNTIME_SECRET_SENTINEL" }], []] }, prompt: "Exercise redaction.",
    });
    yield* turnEnded(owner, agent.agentId);
    const socket = yield* connected(ctx, cookie);
    const reply = yield* rpc(socket, "prompt", { requestId: "web-redaction-prompt", agentId: agent.agentId, text: `owner says ${password} ${session}` });
    expect(reply._tag).toBe("Success");
    const replies = [wrong.body, JSON.stringify(reply)];
    replies.push(JSON.stringify(yield* rpc(socket, "accounts", { requestId: "web-redaction-accounts", operation: "list" })));
    const database = new DatabaseSync(join(root.state, "events.sqlite"), { readOnly: true });
    try {
      const events = database.prepare("SELECT payload_json FROM events ORDER BY sequence").all();
      const receipts = database.prepare("SELECT * FROM receipts").all();
      const text = events.map((row) => JSON.parse(row.payload_json as string)).find((event) => event._tag === "ThreadItem" && event.content?._tag === "text" && event.content.text.startsWith("agent says"));
      expect(text?.content.text === "agent says [REDACTED] [REDACTED]", "the raw adapter text must be redacted before append").toBe(true);
      const channels = { "event log": JSON.stringify(events), receipts: JSON.stringify(receipts), "client replies": replies.join("\n") };
      for (const [channel, output] of Object.entries(channels)) {
        for (const secret of [password, session]) {
          const forms = [secret, Buffer.from(secret).toString("base64"), Buffer.from(secret).toString("hex"), encodeURIComponent(secret)];
          expect(forms.some((value) => output.includes(value)), `${channel} leaked a generated web secret`).toBe(false);
        }
      }
    } finally { database.close(); }
    service.child.kill("SIGTERM"); yield* Effect.promise(() => service.exit);
    expect([password, session].some((value) => service.output().includes(value)), "service log leaked a generated web secret").toBe(false);
  })));
});

it("5.6 service restart: catches a session token surviving a real engine process restart", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const process = yield* processWeb();
    const { cookie } = yield* login(process.ctx);
    yield* process.restart();
    expect((yield* Effect.promise(() => post(process.ctx, "/api/session", undefined, { Cookie: cookie }))).status).toBe(401);
    const fresh = yield* login(process.ctx);
    expect(fresh.cookie === cookie, "engine restart reused the session token").toBe(false);
  })));
});
