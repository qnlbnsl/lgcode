import { spawn } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkStartupHook, listServicesFromProc, realStartupHookDeps, type StartupHookResult } from "./startupHook.ts";

type Environment = Readonly<Record<string, string | undefined>>;
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export const herdrInstalled = (environment: Environment): boolean => {
  const binary = environment.HERDR_BIN_PATH || "herdr";
  const candidates = binary.includes("/") ? [binary] : (environment.PATH ?? "").split(delimiter).map((folder) => join(folder, binary));
  return candidates.some((path) => { try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; } });
};

const processStart = (pid: number): string | undefined => {
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").at(-1)!.split(" ");
    return fields[0] === "Z" ? undefined : fields[19];
  } catch { return undefined; }
};

// Exercise the plugin's declared hook twice in private state. The owner's
// engine and lock are never opened or signalled. Herdr itself is optional.
export const checkPluginHook = async (environment: Environment, signal?: AbortSignal): Promise<StartupHookResult | undefined> => {
  if (!herdrInstalled(environment)) return undefined;
  const manifest = readFileSync(new URL("../herdr-plugin.toml", import.meta.url), "utf8");
  const entry = /\[\[startup\]\]([\s\S]*?)(?=\n\[|$)/.exec(manifest)?.[1];
  const text = entry === undefined ? undefined : /^command\s*=\s*(\[[^\n]+\])/m.exec(entry)?.[1];
  const command: unknown = text === undefined ? undefined : JSON.parse(text);
  if (!Array.isArray(command) || command.length !== 3 || command[0] !== "lgcode" || command[1] !== "serve" || command[2] !== "--detach") {
    throw new Error("the Herdr plugin startup command must be lgcode serve --detach");
  }
  const root = mkdtempSync("/tmp/lgcode-herdr-hook-");
  const state = join(root, "state");
  const home = join(root, "home");
  mkdirSync(home, { mode: 0o700 });
  const bin = fileURLToPath(new URL("../../../bin", import.meta.url));
  const env = { HOME: home, PATH: `${bin}${delimiter}${environment.PATH ?? ""}`, LGCODE_HOME: state, LGCODE_NODE: process.execPath };
  const owned = new Map<number, string>();
  const remember = () => {
    for (const service of listServicesFromProc()) {
      if (service.environment.LGCODE_HOME !== state) continue;
      const start = processStart(service.pid);
      if (start !== undefined) owned.set(service.pid, start);
    }
  };
  const launch = () => new Promise<void>((done, fail) => {
    const child = spawn(command[0], command.slice(1), { env, stdio: "ignore", signal, timeout: 35_000 });
    let failed = false;
    child.once("error", () => { failed = true; });
    child.once("close", (code) => code === 0 && !failed ? done() : fail(new Error("the Herdr plugin startup command failed")));
  });
  try {
    await launch();
    remember();
    await launch();
    const result = await checkStartupHook(realStartupHookDeps(env));
    return result.passed ? { ...result, reason: "the plugin's declared hook starts one private service and a second invocation reuses it" } : result;
  } finally {
    remember();
    const alive = () => [...owned].filter(([pid, start]) => processStart(pid) === start);
    for (const [pid] of alive()) { try { process.kill(pid, "SIGTERM"); } catch { /* exited */ } }
    const deadline = Date.now() + 5_000;
    while (alive().length > 0 && Date.now() < deadline) await sleep(25);
    for (const [pid] of alive()) { try { process.kill(pid, "SIGKILL"); } catch { /* exited */ } }
    const killDeadline = Date.now() + 5_000;
    while (alive().length > 0 && Date.now() < killDeadline) await sleep(25);
    if (alive().length > 0) throw new Error("cleanup of the private Herdr hook service was not confirmed");
    rmSync(root, { recursive: true, force: true });
  }
};
