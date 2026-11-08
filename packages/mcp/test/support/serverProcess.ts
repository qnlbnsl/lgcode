import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { agentEnvironment, bounded, type Process, type ServiceRoot } from "../../../testing/test/support/unit7b.ts";

const hosts: Array<Process> = [];
export const startServerHost = (root: ServiceRoot, fastClock = false): Process => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./serverHost.ts", import.meta.url))], {
    env: { ...agentEnvironment(root), ...(fastClock ? { LGCODE_TEST_FAST_RECOVERY_CLOCK: "1" } : {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let exited = false;
  child.stdout.setEncoding("utf8").on("data", (text: string) => { stdout += text; });
  child.stderr.setEncoding("utf8").on("data", (text: string) => { stderr += text; });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => { exited = true; resolve({ code, signal }); });
  });
  const host = { child, stdout: () => stdout, stderr: () => stderr, exited: () => exited, exit };
  hosts.push(host);
  return host;
};

export const stopServerHosts = async () => {
  for (const host of hosts.splice(0)) {
    if (!host.exited()) host.child.kill("SIGTERM");
    try { await bounded("the MCP test host to stop", host.exit, 2_000); }
    catch { host.child.kill("SIGKILL"); await host.exit; }
  }
};
