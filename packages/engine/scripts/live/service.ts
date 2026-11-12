import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, createWriteStream, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Unit 8c: the fresh service that `pnpm live-check` runs the journey against.
// It is a child process of the script (`src/service.ts`), in a folder of its
// own under /tmp, with its own owner credential. It is not the service that
// Herdr's startup hook started: that one is only looked at, never touched.
//
// The script stops only what it started: this child, its descendants, and any
// process that names this run's own folder as a whole path (the adapters the
// child started). Each is signalled only while its recorded identity holds.

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
  // SIGKILL only the service child; recovery owns its recorded adapters.
  readonly restart?: (signal?: AbortSignal) => Promise<LiveService>;
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
  return { ...environment, LGTM_HOME: state, LGTM_TEST_DEBUG: "1", TMPDIR: "/tmp" };
};

// ---- Which processes belong to this run (findings F4 and F10) ------------
//
// A process belongs to the run when it is the service child, a descendant of
// it, or any process whose working folder, environment value or command-line
// argument is the run's folder or a path inside it. "Inside" is decided on
// whole path parts: `<root>-other` is not inside `<root>`. A process is
// signalled only after its identity (pid and start time, field 22 of
// /proc/<pid>/stat) matches the one recorded when the run found it, so a pid
// that was reused by a stranger is never signalled.

interface Stat { readonly state: string; readonly parent: number; readonly start: string }

const statOf = (pid: number): Stat | undefined => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const [state, parent, start] = [fields[0], fields[1], fields[19]];
    return state === undefined || parent === undefined || start === undefined ? undefined : { state, parent: Number(parent), start };
  } catch { return undefined; }
};

const alive = (pid: number): boolean => {
  const stat = statOf(pid);
  return stat !== undefined && stat.state !== "Z";
};

const within = (root: string, path: string): boolean => path === root || path.startsWith(`${root}/`);

// A value names the folder when it is a path inside it, or an option that sets one (`--dir=/tmp/...`).
const valueWithin = (root: string, value: string): boolean => {
  if (within(root, value)) return true;
  const equals = value.indexOf("=");
  return equals > 0 && within(root, value.slice(equals + 1));
};

const namesRoot = (pid: number, root: string): boolean => {
  try {
    if (within(root, readlinkSync(`/proc/${pid}/cwd`))) return true;
  } catch { /* gone, or not ours to read */ }
  try {
    if (readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").some((entry) => within(root, entry.slice(entry.indexOf("=") + 1)))) return true;
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").some((argument) => valueWithin(root, argument));
  } catch { return false; }
};

const livePids = (): ReadonlyArray<number> => {
  try { return readdirSync("/proc").filter((name) => /^\d+$/.test(name)).map(Number).filter((pid) => pid !== process.pid); } catch { return []; }
};

// Processes of this user that belong to the run: those that name its folder,
// and the descendants of those and of `seeds` (the service child).
export const processesNaming = (root: string, except: ReadonlyArray<number> = [], seeds: ReadonlyArray<number> = []): ReadonlyArray<number> => {
  const pids = livePids().filter((pid) => alive(pid));
  const owned = new Set<number>(pids.filter((pid) => seeds.includes(pid) || namesRoot(pid, root)));
  const parents = new Map(pids.map((pid) => [pid, statOf(pid)?.parent] as const));
  for (let grew = true; grew;) {
    grew = false;
    for (const pid of pids) {
      const parent = parents.get(pid);
      if (!owned.has(pid) && parent !== undefined && owned.has(parent)) { owned.add(pid); grew = true; }
    }
  }
  return [...owned].filter((pid) => !except.includes(pid));
};

const sleep = (milliseconds: number): Promise<void> => new Promise((done) => setTimeout(done, milliseconds));

// Waits until nothing is left, polling; true when it was reached in time.
const until = async (done: () => boolean, milliseconds: number): Promise<boolean> => {
  for (let waited = 0; ; waited += 50) {
    if (done()) return true;
    if (waited >= milliseconds) return false;
    await sleep(50);
  }
};

const signal = (pid: number, name: NodeJS.Signals): void => { try { process.kill(pid, name); } catch { /* gone; a process that stays is found by the liveness check */ } };

export const startLiveService = (parent: Readonly<Record<string, string | undefined>>, reuse?: { readonly root: string; readonly output: string; readonly known: Map<number, string> }, webPassword?: string): LiveService => {
  const root = reuse?.root ?? realpathSync(mkdtempSync("/tmp/lgtm-live-"));
  chmodSync(root, 0o700);
  const state = join(root, "state");
  const work = join(root, "work");
  if (reuse === undefined) mkdirSync(work, { mode: 0o700 });
  const logFile = join(root, "service.log");
  const log = createWriteStream(logFile, { mode: 0o600, flags: "a" });
  const child: ChildProcess = spawn(process.execPath, [servicePath], { env: { ...serviceEnvironment(parent, state), ...(webPassword === undefined ? {} : { LGTM_WEB_PASSWORD: webPassword }) }, stdio: ["ignore", "pipe", "pipe"] });
  const both: Array<string> = reuse === undefined ? [] : [reuse.output];
  const known = reuse?.known ?? new Map<number, string>();
  const remember = (): void => {
    for (const pid of processesNaming(root, [], [child.pid!])) {
      const start = statOf(pid)?.start;
      if (start !== undefined) known.set(pid, start);
    }
  };
  for (const stream of [child.stdout!, child.stderr!]) {
    stream.setEncoding("utf8").on("data", (chunk: string) => { both.push(chunk); log.write(chunk); });
  }
  let done = false;
  let stopping = false;
  let restarting = false;
  const closed = new Promise<void>((resolve) => { child.once("close", () => { done = true; log.end(); resolve(); }); });
  return {
    root, state, work, logFile, pid: child.pid!,
    output: () => both.join(""),
    exited: () => done,
    stop: async () => {
      stopping = true;
      const killed: Array<number> = [];
      const mine = (pid: number): boolean => statOf(pid)?.start === known.get(pid);
      const survivors = (): ReadonlyArray<number> => [...known.keys()].filter((pid) => mine(pid) && alive(pid));
      const sweep = (name: NodeJS.Signals): void => {
        remember();
        // Identity is checked again just before each signal.
        for (const pid of survivors()) signal(pid, name);
      };
      remember();
      if (!done) signal(child.pid!, "SIGTERM");
      await Promise.race([closed, sleep(10_000)]);
      sweep("SIGTERM");
      await until(() => survivors().length === 0, 5_000);
      if (survivors().length > 0) {
        for (const pid of survivors()) killed.push(pid);
        sweep("SIGKILL");
        await until(() => survivors().length === 0, 5_000);
      }
      const left = survivors();
      if (left.length > 0) throw new Error(`cleanup was not confirmed: ${left.join(", ")} still running`);
      return killed;
    },
    restart: async (abort) => {
      if (abort?.aborted || stopping || restarting) throw new Error("restart cancelled or already requested");
      restarting = true;
      if (done) throw new Error("the service exited before the restart probe");
      remember();
      // ChildProcess.kill addresses our unreaped child, never an arbitrary pid.
      if (!child.kill("SIGKILL")) throw new Error("SIGKILL was not delivered to the service child");
      await closed;
      if (abort?.aborted || stopping) throw new Error("restart cancelled before a replacement was started");
      return startLiveService(parent, { root, output: both.join(""), known }, webPassword);
    },
    remove: () => { rmSync(root, { recursive: true, force: true }); },
  };
};
