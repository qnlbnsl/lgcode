// Criterion 7.9, the engine half (unit 7a; row 64): the engine refuses the
// owner credential from a caller inside a live adapter's process tree,
// including one with both Shepherd variables stripped. The caller is a Node.js
// script that the fake agent runs with its `exec` step; it reads the owner
// credential file itself and sends its true ancestor chain and process group
// (`test/support/socketClient.ts` names the headers). The service is a real
// child process; the agents are the fake agent only.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import { afterEach, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { ancestryHeaders, authorization, ownerBearer, upgradeStatus } from "../support/socketClient.ts";
import {
  makeServiceRoot, ownerClient, peekEcho, startFakeAgent, startService, stopAllServices, waitFor, waitServing,
  type ServiceRoot,
} from "../support/serviceProcess.ts";

registerRebuildCheck({ noLog: true });

// Every requirement is provided inside the test; the cast keeps the missing
// production modules from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>, timeout: number) =>
  it.live(name, () => test() as Effect.Effect<void, unknown, never>, timeout);
afterEach(async () => { await stopAllServices(); });

const wsModule = pathToFileURL(createRequire(import.meta.url).resolve("ws")).href;

// argv: socket path, owner credential file, report file, mode. Mode
// "orphan" starts a copy of itself in the same process group and exits, so
// the copy is re-parented away from the adapter and keeps only its group.
const callerSource = `
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import WebSocket from ${JSON.stringify(wsModule)};
const [socketPath, credentialFile, report, mode] = process.argv.slice(2);
const stat = (pid) => { const t = readFileSync("/proc/" + pid + "/stat", "utf8"); return t.slice(t.lastIndexOf(")") + 2).trim().split(/\\s+/); };
if (mode === "orphan") {
  spawn(process.execPath, [process.argv[1], socketPath, credentialFile, report, "orphaned", String(process.pid)], { stdio: "ignore" }).unref();
  process.exit(0);
}
const run = () => {
  const chain = [];
  let pid = process.pid;
  for (let depth = 0; depth < 64 && pid > 0; depth++) {
    let fields;
    try { fields = stat(pid); } catch { break; }
    chain.push(pid + ":" + fields[19]);
    pid = Number(fields[1]);
  }
  const headers = {
    Authorization: "Bearer " + readFileSync(credentialFile).toString("base64url"),
    "Shepherd-Ancestors": chain.join(","), "Shepherd-Process-Group": stat(process.pid)[2],
  };
  const done = (status, body) => { writeFileSync(report, JSON.stringify({ status, body, chain, group: Number(stat(process.pid)[2]),
    socket: process.env.SHEPHERD_SOCKET ?? null, token: process.env.SHEPHERD_TOKEN ? "present" : null })); process.exit(0); };
  const socket = new WebSocket("ws+unix://" + socketPath + ":/", { headers });
  socket.once("open", () => { socket.terminate(); done(101, ""); });
  socket.once("unexpected-response", (_request, response) => {
    let body = ""; response.setEncoding("utf8"); response.on("data", (c) => { body += c; }); response.on("end", () => done(response.statusCode, body));
  });
  socket.once("error", () => done(0, "error"));
};
if (mode === "orphaned") {
  const original = Number(process.argv[6]);
  const wait = () => { if (process.ppid !== original) run(); else setTimeout(wait, 20); };
  wait();
} else run();
`;

interface Report { readonly status: number; readonly body: string; readonly chain: ReadonlyArray<string>; readonly group: number; readonly socket: string | null; readonly token: string | null }

const readReport = (file: string) => waitFor<Report>(`the caller's report ${file}`, () => {
  try { return JSON.parse(readFileSync(file, "utf8")) as Report; } catch { return undefined; }
}, 30_000);

const setup = (root: ServiceRoot) => {
  const caller = join(root.root, "caller.mjs");
  writeFileSync(caller, callerSource);
  return caller;
};

live("7.9 the owner credential is refused from inside a live adapter's tree: with the agent's variables, with both Shepherd variables stripped, and from a re-parented process left in the adapter's group (breaks if the engine trusts the credential alone, checks only the parent, or ignores the process group)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    const caller = setup(root);
    const service = startService(root);
    yield* waitServing(root, service);
    const credentialFile = join(root.state, "owner-credential");
    const reports = { kept: join(root.root, "kept.json"), stripped: join(root.root, "stripped.json"), orphan: join(root.root, "orphan.json") };

    // Control: the same script, run by the test itself, is outside every adapter's tree.
    const control = join(root.root, "control.json");
    spawn(process.execPath, [caller, root.socket, credentialFile, control, "direct"], { stdio: "ignore" });
    expect((yield* readReport(control)).status).toBe(101);

    const agent = yield* Effect.scoped(Effect.gen(function* () {
      const owner = yield* ownerClient(root);
      return yield* startFakeAgent(root, owner, owner, {
        script: { turns: [[
          { step: "exec", argv: [caller, root.socket, credentialFile, reports.kept, "direct"] },
          { step: "exec", argv: [caller, root.socket, credentialFile, reports.stripped, "direct"], strip: ["SHEPHERD_SOCKET", "SHEPHERD_TOKEN"] },
          { step: "exec", argv: [caller, root.socket, credentialFile, reports.orphan, "orphan"], strip: ["SHEPHERD_SOCKET", "SHEPHERD_TOKEN"] },
          { step: "slow", ms: 60_000 },
        ]] },
        prompt: "Call Shepherd as the owner.",
      });
    }));
    const adapterPid = (yield* waitFor("the fake agent's echo", () => peekEcho(agent.echo))).pid;

    const kept = yield* readReport(reports.kept);
    expect(kept.token).toBe("present");
    expect(kept.chain.some((entry) => entry.startsWith(`${adapterPid}:`))).toBe(true);
    expect(kept.status).toBe(403);

    const stripped = yield* readReport(reports.stripped);
    expect([stripped.socket, stripped.token]).toEqual([null, null]);
    expect(stripped.status).toBe(403);

    const orphan = yield* readReport(reports.orphan);
    expect(orphan.chain.some((entry) => entry.startsWith(`${adapterPid}:`)), "the orphaned caller still had the adapter as an ancestor").toBe(false);
    expect(orphan.group).toBe(adapterPid);
    expect(orphan.status).toBe(403);

    const secret = ownerBearer(root.state);
    for (const report of [kept, stripped, orphan]) expect(report.body).not.toContain(secret);
    // The service still serves the owner outside the tree afterwards.
    expect((yield* Effect.promise(() => upgradeStatus(root.socket, { ...authorization(secret), ...ancestryHeaders() }))).status).toBe(101);
  }), 120_000);

live("7.9 the owner credential without an ancestor chain, or with a malformed one, is refused (breaks if a missing chain is read as 'outside every adapter', which any caller could choose)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    const service = startService(root);
    yield* waitServing(root, service);
    const bearer = authorization(ownerBearer(root.state));
    const own = ancestryHeaders();
    for (const headers of [
      bearer,
      { ...bearer, "Shepherd-Process-Group": own["Shepherd-Process-Group"]! },
      { ...bearer, "Shepherd-Ancestors": own["Shepherd-Ancestors"]! },
      { ...bearer, "Shepherd-Ancestors": "not a chain", "Shepherd-Process-Group": own["Shepherd-Process-Group"]! },
      { ...bearer, "Shepherd-Ancestors": own["Shepherd-Ancestors"]!, "Shepherd-Process-Group": "-1" },
    ]) {
      const outcome = yield* Effect.promise(() => upgradeStatus(root.socket, headers));
      expect([Object.keys(headers).join(","), outcome.status]).toEqual([Object.keys(headers).join(","), 403]);
    }
  }), 60_000);
