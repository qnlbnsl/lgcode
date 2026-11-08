import { PassThrough } from "node:stream";
import { render } from "ink";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, expect, it, vi } from "vitest";
import { ViewerApp } from "../src/app.ts";
import { connectViewer, type ViewerClient } from "../src/connection.ts";
import { envelope, permission, question, snapshot } from "../../client/test/support/unit3.ts";
import { cleanupUnit7b, fakeEngine, prepareRoot, refuse, serviceEnvironment, succeed, until } from "../../testing/test/support/unit7b.ts";
import { CommandHandler } from "../../engine/src/commands/CommandHandler.ts";
import { makeFakeRunner } from "../../engine/test/support/fakeRunner.ts";
import { makeFakeSecrets, makeRig, ownerCredential, provideRig, readLog, removeRig, seedAccount, seedAgent, seedHarness } from "../../engine/test/support/handlerRig.ts";

const dispose: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of dispose.splice(0).reverse()) await close();
  await cleanupUnit7b();
  vi.unstubAllEnvs();
});

const mountViewer = (client: ViewerClient) => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => stdin });
  const stdout = Object.assign(new PassThrough(), { columns: 110, rows: 35, isTTY: false });
  let output = "";
  stdout.on("data", (data) => { output += String(data); });
  const app = render(<ViewerApp client={client} />, {
    stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream, debug: true, patchConsole: false, exitOnCtrlC: false,
  });
  const screen = () => output.slice(output.lastIndexOf("LGcode viewer"));
  dispose.push(async () => { app.unmount(); await app.waitUntilExit(); await client.close(); stdin.destroy(); stdout.destroy(); });
  return { screen, key: (text: string) => { stdin.write(text); } };
};

it.each(["prompt", "question", "permission"] as const)("FR-014 retires an acknowledged %s before a failed snapshot and Enter cannot resend it", async (kind) => {
  const root = prepareRoot();
  let acknowledged = false;
  const event = kind === "permission" ? permission(9) : question(9);
  const peer = await fakeEngine(root, { onRequest: (frame, socket) => {
    if (frame.tag === "client.snapshot") {
      if (acknowledged) { refuse(socket, frame, "snapshot unavailable"); return; }
      const row = { id: `${kind}-9`, agentId: "agent-a", holder: { _tag: "owner" }, sourceSequence: 9 };
      succeed(socket, frame, { requestId: frame.payload.requestId, ...snapshot({
        requests: kind === "permission" ? [row] : [], questions: kind === "question" ? [row] : [],
      }) });
    } else if (frame.tag === "client.thread") succeed(socket, frame, { requestId: frame.payload.requestId, items: [] });
    else if (frame.tag === "client.subscribe") { /* stays live */ }
    else if (frame.tag === "client.event") succeed(socket, frame, { requestId: frame.payload.requestId,
      envelope: kind === "permission" ? envelope(9, { ...event.event, toolInput: { command: "inspect configuration" } }) : event });
    else if (frame.tag === "prompt" || frame.tag === "answer") {
      acknowledged = true;
      succeed(socket, frame, { requestId: frame.payload.requestId, ...(frame.tag === "prompt" ? { deliveryId: "sent-once" } : {}) });
    } else throw new Error(`Unexpected request: ${frame.tag}`);
  } });
  const app = mountViewer(await connectViewer(serviceEnvironment(root)));
  await until("ready viewer", () => app.screen().includes("Requests held by owner:") && !app.screen().includes("Connecting"));
  app.key(kind === "prompt" ? "p" : "a");
  await until("composer or reviewed request", () => app.screen().includes(kind === "prompt" ? "Owner draft" : kind === "question" ? "Enter: write answer" : "Enter: submit"));
  if (kind === "question") { app.key("\r"); await until("answer composer", () => app.screen().includes("Owner draft")); }
  if (kind !== "permission") {
    app.key("\u001b[200~Only once.\u001b[201~");
    await until("owner draft text", () => app.screen().includes("Only once."));
  }
  app.key("\r");
  await until("post-send snapshot failure", () => acknowledged && app.screen().toLowerCase().includes("refresh") && !app.screen().includes("Working…"));
  const completedScreen = app.screen();
  app.key("\r");
  // Keep the two keypresses in separate input reads; Ink otherwise parses
  // adjacent writes as a single key sequence.
  await new Promise<void>((resolve) => setImmediate(resolve));
  // A following composer proves Ink consumed Enter after the failure. Checking
  // only the old frame's controls could pass before the key was processed.
  app.key("p");
  await until("Enter and following key handled after acknowledgement", () => app.screen().includes("Owner draft to agent-a")
    || peer.requests.filter((frame) => frame.tag === "prompt" || frame.tag === "answer").length > 1);
  expect(peer.requests.filter((frame) => frame.tag === "prompt" || frame.tag === "answer")).toHaveLength(1);
  expect(completedScreen).toContain(kind === "permission" ? "Answered." : "Sent.");
  expect(completedScreen).toContain("roster could not be refreshed");
  expect(completedScreen).not.toContain("Owner draft");
  expect(app.screen()).not.toContain("Only once.");
});

it("FR-014 retries a lost prompt acknowledgement with the same wire body and one real SQLite receipt and delivery", async () => {
  const rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("LGCODE_HOME", rig.stateFolder);
  try {
    await Effect.runPromise(Effect.gen(function* () {
      const runner = yield* makeFakeRunner();
      yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
        yield* seedAccount();
        yield* seedHarness();
        yield* seedAgent({ id: "agent-a", state: "idle" });
        const handler = yield* CommandHandler;
        const sql = yield* SqlClient.SqlClient;
        yield* Effect.promise(async () => {
          const root = prepareRoot();
          let loseAcknowledgement = true;
          const peer = await fakeEngine(root, { onRequest: (frame, socket) => {
            if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...snapshot() });
            else if (frame.tag === "client.thread") succeed(socket, frame, { requestId: frame.payload.requestId, items: [] });
            else if (frame.tag === "client.subscribe") { /* stays live */ }
            else if (frame.tag === "prompt") void Effect.runPromise(handler.execute(ownerCredential, "prompt", frame.payload)).then((reply) => {
              if (loseAcknowledgement) socket.terminate();
              else succeed(socket, frame, reply);
            });
            else throw new Error(`Unexpected request: ${frame.tag}`);
          } });
          const app = mountViewer(await connectViewer(serviceEnvironment(root)));
          await until("ready viewer", () => app.screen().includes("Requests held by owner:") && !app.screen().includes("Connecting"));
          app.key("p");
          await until("prompt composer", () => app.screen().includes("Owner draft"));
          app.key("\u001b[200~Keep this exact body.\u001b[201~");
          await until("draft text", () => app.screen().includes("Keep this exact body."));
          app.key("\r");
          await until("uncertain send after transport retries", () => app.screen().includes("failed or was refused") && !app.screen().includes("Working…"));
          expect(app.screen()).toContain("Keep this exact body.");
          const first = peer.requests.find((frame) => frame.tag === "prompt")!.payload;
          loseAcknowledgement = false;
          app.key("\r");
          await until("acknowledged retry", () => app.screen().includes("Sent.") && !app.screen().includes("Working…"));
          const attempts = peer.requests.filter((frame) => frame.tag === "prompt");
          expect(attempts.length).toBeGreaterThan(1);
          expect(attempts.map((frame) => frame.payload)).toEqual(attempts.map(() => first));
          expect(await Effect.runPromise(sql`SELECT request_id FROM receipts WHERE caller = 'owner' AND request_id = ${first.requestId}`)).toHaveLength(1);
          const rows = await Effect.runPromise(readLog.pipe(Effect.provideService(SqlClient.SqlClient, sql)));
          expect(rows.filter((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.content._tag === "prompt"
            && row.event.delivery.content.text === "Keep this exact body.")).toHaveLength(1);
          // Close while the real handler and database are still alive.
          for (const close of dispose.splice(0).reverse()) await close();
        });
      }));
    }));
  } finally { removeRig(rig); }
});

it.each(["question", "permission"] as const)("FR-014 retains an uncertain %s answer's identity, and retires confirmed and refused attempts", async (kind) => {
  const root = prepareRoot();
  let outcome: "lost" | "sent" | "refused" = "lost";
  const peer = await fakeEngine(root, { onRequest: (frame, socket) => {
    if (outcome === "lost") socket.terminate();
    else if (outcome === "refused") refuse(socket, frame);
    else succeed(socket, frame, { requestId: frame.payload.requestId });
  } });
  const client = await connectViewer(serviceEnvironment(root));
  dispose.push(() => client.close());
  const body = kind === "question" ? { kind, id: "question-9", text: "Exact answer." }
    : { kind, id: "permission-9", optionId: "once" };
  await expect(client.answer(body)).rejects.toBeDefined();
  const first = peer.requests[0]!.payload;
  outcome = "sent";
  await client.answer(body);
  expect(peer.requests.map((frame) => frame.payload)).toEqual(peer.requests.map(() => first));
  await client.answer(body);
  expect(peer.requests.at(-1)!.payload.requestId).not.toBe(first.requestId);
  outcome = "refused";
  await expect(client.answer(body)).rejects.toMatchObject({ _tag: "CommandError" });
  const refused = peer.requests.at(-1)!.payload;
  outcome = "sent";
  await client.answer(body);
  expect(peer.requests.at(-1)!.payload.requestId).not.toBe(refused.requestId);
  outcome = "lost";
  await expect(client.answer(body)).rejects.toBeDefined();
  const uncertain = peer.requests.at(-1)!.payload;
  outcome = "sent";
  const changed = kind === "question" ? { kind, id: "question-9", text: "Edited answer." }
    : { kind, id: "permission-9", optionId: "reject" };
  await client.answer(changed);
  expect(peer.requests.at(-1)!.payload.requestId).not.toBe(uncertain.requestId);
  expect(peer.requests.at(-1)!.payload).toMatchObject(changed);
});
