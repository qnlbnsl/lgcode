import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, createWriteStream, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Unit 8c: the fresh service that `pnpm live-check` runs the journey against.
// It is a child process of the script (`src/service.ts`), in a folder of its
// own under /tmp, with its own owner credential. It is not the service that
// Herdr's startup hook started: that one is only looked at, never touched.
//
// The script stops only what it started: this child, and any process whose
// environment names this run's own folder (the adapters the child started). A
// pid that does not name the folder is never signalled.

export const servicePath = fileURLToPath(new URL("../../src/service.ts", import.meta.url));

export interface LiveService {
  readonly root: string;
  readonly state: string;
  readonly work: string;
  readonly pid: number;
  readonly output: () => string;
  readonly exited: () => boolean;
  readonly logFile: string;
  // Stops the service and the adapters it started. Returns the pids that had
  // to be killed because they ignored the first signal.
  readonly stop: () => Promise<ReadonlyArray<number>>;
  readonly remove: () => void;
}

// What the adapters need to find their own sign-in, and nothing else of the
// owner's environment. HOME stays the owner's, because the logins live there.
const INHERITED = [
  "PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "SHELL",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME",
] as const;

export const serviceEnvironment = (parent: Readonly<Record<string, string | undefined>>, state: string): Record<string, string> => {
  const environment: Record<string, string> = {};
  for (const name of INHERITED) if (parent[name] !== undefined) environment[name] = parent[name]!;
  // The fresh state folder must win over any state variable the owner has set.
  return { ...environment, SHEPHRD_HOME: state, SHEPHRD_TEST_DEBUG: "1", TMPDIR: "/tmp" };
};

const alive = (pid: number): boolean => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z";
  } catch { return false; }
};

const namesRoot = (pid: number, root: string): boolean => {
  try {
    return readFileSync(`/proc/${pid}/environ`, "utf8").includes(root) || readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(root);
  } catch { return false; }
};

// Processes of this user whose environment or command line names the run's
// folder. The folder name is random and unique to this run.
export const processesNaming = (root: string, except: ReadonlyArray<number> = []): ReadonlyArray<number> => {
  let names: ReadonlyArray<string>;
  try { names = readdirSync("/proc"); } catch { return []; }
  return names.filter((name) => /^\d+$/.test(name)).map(Number)
    .filter((pid) => pid !== process.pid && !except.includes(pid) && alive(pid) && namesRoot(pid, root));
};

const sleep = (milliseconds: number): Promise<void> => new Promise((done) => setTimeout(done, milliseconds));

const signal = (pid: number, name: NodeJS.Signals): void => { try { process.kill(pid, name); } catch { /* gone */ } };

export const startLiveService = (parent: Readonly<Record<string, string | undefined>>): LiveService => {
  const root = realpathSync(mkdtempSync("/tmp/shephrd-live-"));
  chmodSync(root, 0o700);
  const state = join(root, "state");
  const work = join(root, "work");
  mkdirSync(work, { mode: 0o700 });
  const logFile = join(root, "service.log");
  const log = createWriteStream(logFile, { mode: 0o600 });
  const child: ChildProcess = spawn(process.execPath, [servicePath], { env: serviceEnvironment(parent, state), stdio: ["ignore", "pipe", "pipe"] });
  const both: Array<string> = [];
  for (const stream of [child.stdout!, child.stderr!]) {
    stream.setEncoding("utf8").on("data", (chunk: string) => { both.push(chunk); log.write(chunk); });
  }
  let done = false;
  const closed = new Promise<void>((resolve) => { child.once("close", () => { done = true; log.end(); resolve(); }); });
  return {
    root, state, work, logFile, pid: child.pid!,
    output: () => both.join(""),
    exited: () => done,
    stop: async () => {
      const killed: Array<number> = [];
      if (!done) signal(child.pid!, "SIGTERM");
      await Promise.race([closed, sleep(10_000)]);
      if (!done) { killed.push(child.pid!); signal(child.pid!, "SIGKILL"); await Promise.race([closed, sleep(5_000)]); }
      // The adapters the service started should have ended with it.
      const strays = processesNaming(root);
      for (const pid of strays) signal(pid, "SIGTERM");
      for (let waited = 0; waited < 5_000 && strays.some(alive); waited += 100) await sleep(100);
      for (const pid of strays.filter(alive)) { killed.push(pid); signal(pid, "SIGKILL"); }
      return killed;
    },
    remove: () => { rmSync(root, { recursive: true, force: true }); },
  };
};
