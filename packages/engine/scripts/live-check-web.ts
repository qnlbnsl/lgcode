import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { build } from "vite";
import { connect, type Client } from "@shephrd/client";
import type { AgentId, RequestId, AccountId, HarnessId } from "@shephrd/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { resolveHarnessDefaults } from "../src/runner/harnesses.ts";
import { startLiveService, type LiveService } from "./live/service.ts";

// This uses a real Codex account and browser. It is deliberately separate
// from pnpm check. Only this run's engine, agents and folders are cleaned up.
const codexHarness = "codex" as HarnessId;
const codexAccount = "codex" as AccountId;
const emptyAccount = "web-empty-login" as AccountId;
const id = () => randomUUID() as RequestId;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const unusedPort = (): Promise<number> => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as import("node:net").AddressInfo).port;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
let activeStep = "private engine";
const step = async (name: string, body: () => Promise<void>) => {
  activeStep = name;
  await body();
  process.stdout.write(`PASS ${name}\n`);
};
const main = async () => {
  const password = randomBytes(32).toString("base64url");
  let service: LiveService | undefined;
  let scope: Scope.Closeable | undefined;
  let owner: Client | undefined;
  let browser: Browser | undefined;
  let page: Page;
  let agentId: AgentId;
  let failedId: AgentId;
  const agents: AgentId[] = [];
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => cleanupPromise ??= (async () => {
    await browser?.close();
    if (owner !== undefined) for (const agentId of agents) {
      await run(owner.stop({ requestId: id(), agentId }).pipe(Effect.timeout(5_000), Effect.catch(() => Effect.void)));
    }
    if (scope !== undefined) await run(Scope.close(scope, Exit.void));
    if (service !== undefined) { await service.stop(); service.remove(); }
  })();
  const interrupted = () => { process.exitCode = 1; void cleanup(); };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  const openOwner = async () => {
    if (service === undefined) throw new Error("no engine");
    const socket = join(service.state, "engine.sock");
    for (let attempt = 0; (!existsSync(socket) || !existsSync(join(service.state, "owner-credential"))) && attempt < 200 && !service.exited(); attempt++) await sleep(50);
    scope = await run(Scope.make());
    for (let attempt = 0; ; attempt++) {
      try {
        owner = await run(connect({ environment: { SHEPHRD_HOME: service.state }, attempts: 1 }).pipe(Scope.provide(scope)));
        return;
      } catch {
        if (attempt >= 299 || service.exited()) throw new Error("Private engine did not become ready");
        await sleep(100);
      }
    }
  };
  const snapshot = () => run(owner!["client.snapshot"]({ requestId: id() }));
  const idle = async () => expect.poll(async () => (await snapshot()).agents.find((agent) => agent.agentId === agentId)?.state._tag,
    { timeout: 180_000, intervals: [250, 500, 1_000] }).toBe("idle");
  const send = async (text: string) => {
    await page.getByRole("textbox", { name: "Prompt agent", exact: true }).fill(text);
    await page.getByRole("button", { name: "Send prompt", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Prompt sent." })).toBeVisible();
  };
  try {
    const port = await unusedPort();
    const origin = `http://127.0.0.1:${port}`;
    await step("private engine", async () => {
      await build({ configFile: false, root: fileURLToPath(new URL("../../web", import.meta.url)), logLevel: "silent", build: { outDir: "dist" } });
      // Configure the random port through the API before enabling a password,
      // so even the bootstrap cannot bind the owner's normal web port.
      activeStep = "private engine: bootstrap";
      service = startLiveService(process.env);
      await openOwner();
      activeStep = "private engine: web settings";
      await run(owner!["client.web.settings.set"]({ requestId: id(), settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } }));
      await run(Scope.close(scope!, Exit.void)); scope = undefined; owner = undefined;
      activeStep = "private engine: bootstrap stop";
      await service.stop();
      activeStep = "private engine: web launch";
      service = startLiveService(process.env, { root: service.root, output: "", known: new Map() }, password);
      await openOwner();
      activeStep = "private engine: web ready";
      await expect.poll(async () => { try { return (await fetch(`${origin}/`)).status; } catch { return 0; } }, { timeout: 20_000 }).toBe(200);
      activeStep = "private engine: adapter discovery";
      const harnesses = await run(resolveHarnessDefaults({ binDirectory: fileURLToPath(new URL("../node_modules/.bin", import.meta.url)), path: process.env.PATH ?? "" }).pipe(Effect.provide(NodeServices.layer)));
      const codex = harnesses.harnesses.find((entry) => entry.id === "codex");
      if (codex === undefined) throw new Error("Codex adapter is not installed");
      activeStep = "private engine: harness setup";
      await run(owner!.harnesses({ requestId: id(), operation: "set", harness: codex }));
      await run(owner!.accounts({ requestId: id(), operation: "add", account: { id: codexAccount, harness: codexHarness, displayName: "Codex", enabled: true,
        environment: { CODEX_CONFIG: JSON.stringify({ shell_environment_policy: { inherit: "core" } }),
          ...(process.env.CODEX_HOME === undefined ? {} : { CODEX_HOME: process.env.CODEX_HOME }) } } }));
      activeStep = "private engine: agent start";
      const started = await run(owner!.start({ requestId: id(), name: "Web live worker", role: "worker", harness: codexHarness, account: { _tag: "named", accountId: codexAccount },
        permission: "ask", folder: service!.work, model: "gpt-6.1-sol", effort: "high", prompt: "Reply with exactly HELLO_WEB and do nothing else." }));
      agentId = started.agentId; agents.push(agentId);
      activeStep = "private engine: browser launch";
      browser = await chromium.launch();
      page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      page.setDefaultTimeout(20_000);
    });
    await step("log in", async () => {
      await page.goto(origin);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await expect(page.getByRole("region", { name: "Situation", exact: true })).toBeVisible();
    });
    await step("agent listed", async () => { await expect(page.getByRole("link", { name: "Web live worker", exact: true })).toBeVisible(); });
    await step("thread opens", async () => {
      await page.getByRole("link", { name: "Web live worker", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Thread: Web live worker", exact: true })).toBeVisible();
    });
    const firstPrompt = () => page.getByRole("article", { name: "Outgoing delivery", exact: true }).filter({ hasText: "HELLO_WEB" });
    const replies = () => page.getByRole("article", { name: "Agent message", exact: true }).filter({ hasText: "PINEAPPLE" });
    await step("first prompt shown once", async () => {
      await idle();
      await expect(firstPrompt()).toHaveCount(1);
      await expect(firstPrompt()).toContainText("Accepted");
      await expect(page.getByRole("article", { name: "Sent prompt", exact: true })).toHaveCount(0);
    });
    await step("one prompt, one reply block", async () => {
      await send("Reply with exactly PINEAPPLE and nothing else. Do not use any tools.");
      await expect(replies()).toHaveCount(1, { timeout: 180_000 });
      await idle();
      await expect(replies()).toHaveCount(1);
      await expect(replies()).toHaveText("Agent dataPINEAPPLE");
    });
    await step("shell permission answered from page and file written", async () => {
      await send("Use your shell tool to run exactly: printf 'hello-from-web\\n' > note.txt . Do nothing else. If permission is needed, request approval and wait for it. Do not use apply_patch.");
      const request = page.getByRole("region", { name: "Permission request", exact: true }).filter({ hasText: "note.txt" });
      await expect(request.getByRole("button", { name: "Yes, proceed", exact: true }).first()).toBeVisible({ timeout: 180_000 });
      await request.getByRole("button", { name: "Yes, proceed", exact: true }).first().click();
      await expect.poll(() => { try { return readFileSync(join(service!.work, "note.txt"), "utf8"); } catch { return ""; } }, { timeout: 180_000 }).toBe("hello-from-web\n");
      await idle();
      const command = page.getByRole("article", { name: "Agent message", exact: true }).filter({ hasText: "printf" });
      await expect(command).toHaveCount(1);
      await expect(command).toContainText("completed");
    });
    await step("reload retains prompts, replies, command and permission answer", async () => {
      await page.reload();
      await expect(firstPrompt()).toHaveCount(1);
      await expect(replies()).toHaveCount(1);
      await expect(page.getByRole("article", { name: "Permission answer", exact: true })).toHaveCount(1);
      await expect(page.getByRole("article", { name: "Agent message", exact: true }).filter({ hasText: "printf" })).toHaveCount(1);
    });
    await step("stop and resume from page", async () => {
      await page.getByRole("button", { name: "Stop agent", exact: true }).click();
      await expect(page.getByRole("button", { name: "Resume agent", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Situation", exact: true }).first().click();
      await expect(page.getByRole("region", { name: "Stopped", exact: true }).getByRole("link", { name: "Web live worker", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Web live worker", exact: true }).click();
      await page.getByRole("button", { name: "Resume agent", exact: true }).click();
      await idle();
      await expect(page.getByRole("button", { name: "Stop agent", exact: true })).toBeVisible();
    });
    await step("failed start shows reason in thread and on main page", async () => {
      // An extra account intentionally has its own empty login. No default
      // authentication is copied, and no model-switch offer is accepted.
      await run(owner!.accounts({ requestId: id(), operation: "add", account: { id: emptyAccount, harness: codexHarness, displayName: "Empty login", enabled: true } }));
      const failed = await run(owner!.start({ requestId: id(), name: "Web failed start", role: "worker", harness: codexHarness, account: { _tag: "named", accountId: emptyAccount },
        permission: "ask", folder: service!.work, model: "gpt-6.1-sol", effort: "high" }));
      failedId = failed.agentId; agents.push(failedId);
      await expect.poll(async () => (await snapshot()).agents.find((agent) => agent.agentId === failedId)?.startFailure, { timeout: 180_000 }).toBe("private-login-not-signed-in");
      await page.goto(`${origin}/#/thread/${encodeURIComponent(failedId)}`);
      await expect(page.getByRole("article", { name: "Failed start", exact: true })).toContainText("private login");
      await sendFailedPrompt();
      await page.getByRole("link", { name: "Situation", exact: true }).first().click();
      await expect(page.getByRole("region", { name: "Stopped", exact: true })).toContainText("private login");
    });
    async function sendFailedPrompt() {
      await page.getByRole("textbox", { name: "Prompt agent", exact: true }).fill("try again");
      await page.getByRole("button", { name: "Send prompt", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Failed to start:" })).toContainText("private login");
    }
  } finally {
    await cleanup();
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", interrupted);
  }
};
main().catch(() => {
  // Browser and adapter exceptions can repeat credentials. Print only the
  // fixed step name; neither their messages nor their stacks are public.
  process.stderr.write(`FAIL ${activeStep}\n`);
  process.exitCode = 1;
});
