import { spawn } from "node:child_process";
import { request } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stateFolder } from "@lgtm/engine/api/stateFolder";
import * as Effect from "effect/Effect";

const answers = (socketPath: string): Promise<boolean> => new Promise((resolve) => {
  const call = request({ socketPath, path: "/", method: "GET", timeout: 1_000 }, (response) => {
    response.resume();
    resolve(true);
  });
  call.once("error", () => resolve(false));
  call.once("timeout", () => { call.destroy(); resolve(false); });
  call.end();
});

// Probe the actual listener, including one still recovering. Neither an
// existing socket pathname nor opening engine.lock proves it is running.
export const serveDetach = (options: { readonly environment: Record<string, string | undefined> }) => Effect.gen(function* () {
  const socket = join(stateFolder(options.environment), "engine.sock");
  if (yield* Effect.promise(() => answers(socket))) return { outcome: "already running" } as const;
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../engine/src/service.ts", import.meta.url))], {
    env: options.environment, detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  child.unref();
  let exited = false;
  let exitCode: number | null = null;
  let failed = false;
  let ownsLock = false;
  child.on("message", (message: unknown) => {
    if (typeof message === "object" && message !== null && "_tag" in message && message._tag === "LgtmLockAcquired") ownsLock = true;
  });
  child.once("error", () => { failed = true; });
  child.once("exit", (code) => { exited = true; exitCode = code; });
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (failed || (exited && exitCode !== 0)) return yield* Effect.fail(new Error("service failed to start"));
    if ((ownsLock || exited) && (yield* Effect.promise(() => answers(socket)))) {
      return ownsLock ? { outcome: "started", pid: child.pid! } as const : { outcome: "already running" } as const;
    }
    if (Date.now() >= deadline) {
      if (!exited && child.pid !== undefined) {
        // This launcher created the detached group. Stop its startup work
        // before reporting failure, including any descendants it spawned.
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
      return yield* Effect.fail(new Error("service did not answer"));
    }
    yield* Effect.sleep(25);
  }
});
