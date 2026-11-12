import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { build } from "vite";
import { connect, type Client } from "@lgtm/client";
import type { AgentId, RequestId, AccountId, HarnessId } from "@lgtm/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { resolveHarnessDefaults } from "../src/runner/harnesses.ts";
import { startLiveService, type LiveService } from "./live/service.ts";
import { webProject } from "./live/webProject.ts";
import { assertReply, replySentence } from "./live/webReply.ts";

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
  let page!: Page;
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
        owner = await run(connect({ environment: { LGTM_HOME: service.state }, attempts: 1 }).pipe(Scope.provide(scope)));
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
    await page.getByRole("form", { name: "Prompt agent", exact: true }).getByRole("textbox").fill(text);
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
      // Explicit configured choices keep this proof's same model/effort reachable
      // after a failed spawn. They are not negotiated-capability claims.
      await run(owner!.harnesses({ requestId: id(), operation: "set", harness: { ...codex, models: ["gpt-6.1-sol"], efforts: ["high"] } }));
      await run(owner!.accounts({ requestId: id(), operation: "add", account: { id: codexAccount, harness: codexHarness, displayName: "Codex", enabled: true,
        environment: { CODEX_CONFIG: JSON.stringify({ shell_environment_policy: { inherit: "core" } }),
          ...(process.env.CODEX_HOME === undefined ? {} : { CODEX_HOME: process.env.CODEX_HOME }) } } }));
      await run(owner!["project.settings.set"]({ requestId: id(), settings: { workspaceFolder: service!.work, shell: "/bin/sh",
        lead: { harness: codexHarness, account: { _tag: "named", accountId: codexAccount }, model: "gpt-6.1-sol", effort: "high", permission: "ask" } } }));
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
      await expect(page.getByRole("main", { name: "Set up LGTM Studio", exact: true })).toBeVisible();
    });
    const projectJourney = await webProject(page, owner!, origin, step, (agent) => agents.push(agent));
    const workerLink = () => page.getByRole("navigation", { name: "Projects", exact: true }).locator(".agent-link").filter({ hasText: "Web live worker" });
    const navigation = async () => {
      const menu = page.getByRole("button", { name: "Open navigation", exact: true });
      if (await menu.isVisible() && await menu.getAttribute("aria-expanded") !== "true") await menu.click();
    };
    await step("agent listed", async () => { await navigation(); await expect(workerLink()).toBeVisible(); });
    await step("thread opens", async () => {
      await workerLink().click();
      await expect(page.getByRole("heading", { name: "Web live worker", exact: true })).toBeVisible();
    });
    const firstPrompt = () => page.getByRole("article", { name: "Outgoing delivery", exact: true }).filter({ hasText: "HELLO_WEB" });
    const messages = () => page.getByRole("article", { name: "Agent message", exact: true });
    let replyIndex = 0;
    const replies = () => messages().nth(replyIndex);
    await step("first prompt shown once", async () => {
      await idle();
      await expect(firstPrompt()).toHaveCount(1);
      await expect(firstPrompt()).toContainText("Accepted");
      await expect(page.getByRole("article", { name: "Sent prompt", exact: true })).toHaveCount(0);
    });
    await step("one prompt, one reply block", async () => {
      replyIndex = await messages().count();
      await send(`Reply with exactly this sentence and nothing else. Do not use any tools: ${replySentence}`);
      await expect(replies()).toHaveText(replySentence, { timeout: 180_000 });
      await idle();
      await assertReply(messages(), replyIndex, replySentence);
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
      await expect(replies()).toHaveText(replySentence);
      await expect(page.getByRole("article", { name: "Permission answer", exact: true })).toHaveCount(1);
      await expect(page.getByRole("article", { name: "Agent message", exact: true }).filter({ hasText: "printf" })).toHaveCount(1);
    });
    await step("stop from page reaches actual stopped state", async () => {
      await page.getByRole("button", { name: "Stop agent", exact: true }).click();
      await expect(page.getByRole("button", { name: "Resume agent", exact: true })).toBeVisible();
      await expect.poll(async () => (await snapshot()).agents.find((agent) => agent.agentId === agentId)?.state._tag).toBe("stopped");
    });
    await step("stopped agent remains visible in the roster", async () => {
      await page.goto(`${origin}/#/`); await navigation();
      await expect(workerLink()).toContainText("Stopped");
      await workerLink().click();
    });
    await step("resume from page reaches actual idle state", async () => {
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
      const form = page.getByRole("form", { name: "Prompt agent", exact: true });
      await expect(form.locator("textarea")).toBeHidden();
      await expect(page.getByRole("button", { name: "Send prompt", exact: true })).toBeHidden();
      const before = await run(owner!["client.thread"]({ requestId: id(), agentId: failedId, after: 0 as never, limit: 100 }));
      // Even a programmatic submit cannot bypass the real halted composer.
      await form.evaluate((node: HTMLFormElement) => node.requestSubmit());
      const after = await run(owner!["client.thread"]({ requestId: id(), agentId: failedId, after: 0 as never, limit: 100 }));
      if (!("items" in before) || !("items" in after)) throw new Error("Failed-start thread unavailable");
      expect(after.items).toEqual(before.items);
      await page.goto(`${origin}/#/`);
      await expect(page.locator(".failed-start-list")).toContainText("private login");
    });
    await step("project: restart rebuilds the linked result, lead delivery and exact answer receipt", async () => {
      await run(Scope.close(scope!, Exit.void)); scope = undefined; owner = undefined;
      await service!.stop();
      service = startLiveService(process.env, { root: service!.root, output: "", known: new Map() }, password);
      await openOwner();
      // Owner cookies are deliberately in-memory and revoked by service stop.
      // Reauthenticate through the real page before inspecting rebuilt state.
      await page.reload();
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await projectJourney.verify(owner!);
    });
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
