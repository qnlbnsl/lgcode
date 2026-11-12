import { spawn } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { agentEnvironment, cleanupUnit7b, fakeEngine, finishCli, prepareRoot, serviceEnvironment } from "../../../packages/testing/test/support/unit7b.ts";

const dispose: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of dispose.splice(0).reverse()) await close();
  await cleanupUnit7b();
});
const startPane = (environment: Record<string, string>) => {
  const child = spawn(process.execPath, [new URL("../src/openPane.ts", import.meta.url).pathname], { env: environment, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let done = false;
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => { done = true; resolve({ code, signal }); });
  });
  dispose.push(async () => { if (!done) child.kill("SIGKILL"); await exit; });
  return { child, stderr: () => stderr, stdout: () => "", exit, exited: () => done };
};

it("runs the Node launcher and opens the declared pane without granting an agent an owner action", async () => {
  const root = prepareRoot();
  await fakeEngine(root);
  const binary = join(root.root, "fake-herdr");
  const args = join(root.root, "pane-arguments");
  writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' "$@" > '${args}'\n`);
  chmodSync(binary, 0o700);
  const environment = { ...serviceEnvironment(root), HERDR_BIN_PATH: binary };
  const action = startPane(environment);
  expect((await finishCli(action)).code).toBe(0);
  expect(readFileSync(args, "utf8").trim().split("\n")).toEqual(["plugin", "pane", "open", "--plugin", "lgtm", "--entrypoint", "view"]);
  const agent = startPane({ ...agentEnvironment(root), HERDR_BIN_PATH: binary });
  expect((await finishCli(agent)).code).toBe(1);
});

it("refuses a pane action when the engine rejects its process identity, before invoking Herdr", async () => {
  const root = prepareRoot();
  const server = createServer();
  let refused = false;
  server.on("upgrade", (_request, socket) => {
    refused = true;
    socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  await new Promise<void>((resolve) => server.listen(root.socket, resolve));
  chmodSync(root.socket, 0o600);
  dispose.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const binary = join(root.root, "must-not-run");
  const marker = join(root.root, "invoked");
  writeFileSync(marker, "no");
  writeFileSync(binary, `#!/bin/sh\nprintf yes > '${marker}'\n`);
  chmodSync(binary, 0o700);
  const action = startPane({ ...serviceEnvironment(root), HERDR_BIN_PATH: binary });
  expect((await finishCli(action)).code).toBe(1);
  expect(refused).toBe(true);
  expect(readFileSync(marker, "utf8")).toBe("no");
  expect(action.stderr()).toContain("owner viewer pane could not be opened");
});
