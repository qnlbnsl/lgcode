import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { request } from "node:http";
import { join, resolve } from "node:path";

import { stateFolder } from "@lgcode/client";

// Unit 8c: the startup-hook check (criterion 8.6). Herdr's `[[startup]]` entry
// runs `lgcode serve --detach` when Herdr starts.
// This check shows that this started exactly one service for that home.
//
// It only reads, and it reads little:
//
// - The process listing: the processes whose command line runs the engine's
//   `service.ts`, and, for each, the three variables that choose its state
//   folder (`LGCODE_HOME`, `XDG_STATE_HOME`, `HOME`). Nothing else of a
//   process's environment is kept, so nothing else can be printed.
// - Whether `engine.lock` exists, by looking at the path. The file is never
//   opened: closing a second descriptor of a POSIX-locked file would release
//   the service's lock (`src/lock.ts` is the only code that opens it).
// - Whether the socket answers an unauthenticated GET, which is the probe that
//   `serve --detach` itself uses.
//
// It never signals, stops or starts anything, and the real home's path and the
// process listing are arguments, so a test can plant a home under /tmp.

export interface ServiceProcess {
  readonly pid: number;
  // The three variables that choose the state folder, when the process has them.
  readonly environment: Readonly<Record<string, string | undefined>>;
}

export interface StartupHookDeps {
  // The environment that Herdr's startup command ran with, to find the real home.
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly listServices: () => ReadonlyArray<ServiceProcess>;
  readonly lockExists: (path: string) => boolean;
  readonly answers: (socketPath: string) => Promise<boolean>;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export type StartupHookResult =
  | { readonly passed: true; readonly pid: number; readonly state: string; readonly reason: string }
  | { readonly passed: false; readonly state: string; readonly reason: string; readonly pids: ReadonlyArray<number> };

const STATE_VARIABLES = ["LGCODE_HOME", "XDG_STATE_HOME", "HOME"] as const;

const canonical = (path: string): string => {
  try { return realpathSync(path); } catch { return resolve(path); }
};

const stateOf = (environment: Readonly<Record<string, string | undefined>>): string | undefined => {
  try { return canonical(stateFolder({ ...environment })); } catch { return undefined; }
};

// Reads the process listing from a /proc folder (Linux only, row 78). A
// process that cannot be read (it ended, or belongs to another user) is not a
// service of this user and is left out.
export const listServicesFromProc = (procRoot = "/proc"): ReadonlyArray<ServiceProcess> => {
  const services: Array<ServiceProcess> = [];
  let names: ReadonlyArray<string>;
  try { names = readdirSync(procRoot); } catch { return []; }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const argv = readFileSync(join(procRoot, name, "cmdline"), "utf8").split("\0");
      // `node <path>/engine/src/service.ts`, as `serve --detach` and the tests start it.
      if (!argv.slice(1).some((argument) => /(^|\/)engine\/src\/service\.ts$/.test(argument))) continue;
      const environment: Record<string, string> = {};
      for (const entry of readFileSync(join(procRoot, name, "environ"), "utf8").split("\0")) {
        const at = entry.indexOf("=");
        const key = at < 0 ? "" : entry.slice(0, at);
        if ((STATE_VARIABLES as ReadonlyArray<string>).includes(key)) environment[key] = entry.slice(at + 1);
      }
      services.push({ pid: Number(name), environment });
    } catch { /* gone, or not readable */ }
  }
  return services;
};

// The same probe as `serve --detach`: any HTTP answer on the socket.
export const socketAnswers = (socketPath: string): Promise<boolean> => new Promise((done) => {
  const call = request({ socketPath, path: "/", method: "GET", timeout: 1_000 }, (response) => { response.resume(); done(true); });
  call.once("error", () => done(false));
  call.once("timeout", () => { call.destroy(); done(false); });
  call.end();
});

export const realStartupHookDeps = (environment: Readonly<Record<string, string | undefined>>, procRoot = "/proc"): StartupHookDeps => ({
  environment,
  listServices: () => listServicesFromProc(procRoot),
  lockExists: existsSync,
  answers: socketAnswers,
  sleep: (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
});

// A service that is still recovering does not answer yet, so a missing answer
// is retried a few times before it counts.
const ANSWER_TRIES = 10;
const ANSWER_PAUSE_MS = 500;

export const checkStartupHook = async (deps: StartupHookDeps): Promise<StartupHookResult> => {
  const state = stateOf(deps.environment);
  if (state === undefined) return { passed: false, state: "(unknown)", reason: "the real home cannot be found: set HOME, LGCODE_HOME or XDG_STATE_HOME", pids: [] };
  const services = deps.listServices().filter((service) => stateOf(service.environment) === state);
  const pids = services.map((service) => service.pid).sort((a, b) => a - b);
  if (services.length === 0) {
    const lock = deps.lockExists(join(state, "engine.lock"));
    return {
      passed: false, state, pids,
      reason: lock
        ? `no service runs for ${state}, but engine.lock is there: a stale lock, so the service ran once and stopped, or the startup hook did not start one`
        : `no service runs for ${state}, and there is no engine.lock: the startup hook did not start one (is the Herdr plugin installed and Herdr restarted?)`,
    };
  }
  if (services.length > 1) {
    return { passed: false, state, pids, reason: `${services.length} services run for ${state} (processes ${pids.join(", ")}); exactly one is expected` };
  }
  const socket = join(state, "engine.sock");
  for (let attempt = 1; attempt <= ANSWER_TRIES; attempt += 1) {
    if (await deps.answers(socket)) {
      return { passed: true, pid: pids[0]!, state, reason: `one service runs for ${state} (process ${pids[0]}) and its socket answers` };
    }
    if (attempt < ANSWER_TRIES) await deps.sleep(ANSWER_PAUSE_MS);
  }
  return { passed: false, state, pids, reason: `one service process runs for ${state} (process ${pids[0]}), but its socket did not answer in ${ANSWER_TRIES} tries` };
};
