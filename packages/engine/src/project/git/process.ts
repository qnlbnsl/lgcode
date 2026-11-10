import { spawn } from "node:child_process";
import { GitFailure } from "./types.ts";

export interface ProcessReply { readonly stdout: string; readonly stderr: string; readonly code: number; readonly truncated: boolean }
export interface ProcessLimits { readonly bytes: number; readonly timeoutMs: number }

export const boundedUtf8 = (buffer: Buffer, maximum: number): string => {
  // Re-encoding also bounds replacement characters for invalid UTF-8. Stream
  // decoding drops a cut multi-byte suffix rather than expanding the reply.
  const valid = Buffer.from(buffer.toString("utf8"));
  return new TextDecoder().decode(valid.subarray(0, maximum), { stream: true });
};

// Shell-free arguments, disabled repository read helpers, and no inherited Git
// routing/configuration variables. Authentication still uses the user's normal
// credential setup for explicit fetch/pull/push operations.
const safeEnvironment = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
  LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat",
});
const gitOptions = ["--no-pager", "--literal-pathspecs", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
  "-c", "diff.external=", "-c", "core.quotePath=false", "-c", "color.ui=false", "-c", "log.showSignature=false"];

export const gitProcess = (
  cwd: string, args: ReadonlyArray<string>, limits: ProcessLimits, signal: AbortSignal, truncate = false,
): Promise<ProcessReply> => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(new GitFailure({ reason: "cancelled" })); return; }
  const child = spawn("git", [...gitOptions, ...args], {
    cwd, env: safeEnvironment(), shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  });
  const out: Buffer[] = [], err: Buffer[] = [];
  let bytes = 0, stderrBytes = 0, truncated = false;
  let failure: GitFailure | undefined;
  let stopping = false, escalation: ReturnType<typeof setTimeout> | undefined;
  const send = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== "win32" && child.pid !== undefined) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch { /* The child may already have exited. */ }
  };
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // Git's signal handlers roll back only the locks Git itself acquired,
    // including a linked checkout's per-worktree index. Never guess ownership
    // from a lock's age/existence or unlink a shared lock from this process.
    send("SIGTERM");
    escalation = setTimeout(() => send("SIGKILL"), 250);
  };
  const abort = () => { failure ??= new GitFailure({ reason: "cancelled" }); stop(); };
  const timer = setTimeout(() => { failure ??= new GitFailure({ reason: "timeout" }); stop(); }, limits.timeoutMs);
  signal.addEventListener("abort", abort, { once: true });
  child.stdout.on("data", (data: Buffer) => {
    const remaining = Math.max(0, limits.bytes - bytes);
    if (remaining > 0) out.push(data.subarray(0, remaining));
    bytes += data.length;
    if (bytes > limits.bytes) {
      truncated = true;
      if (!truncate) failure ??= new GitFailure({ reason: "output_limit" });
      stop();
    }
  });
  child.stderr.on("data", (data: Buffer) => {
    const remaining = Math.max(0, 16_384 - stderrBytes);
    if (remaining > 0) err.push(data.subarray(0, remaining));
    stderrBytes += data.length;
    if (stderrBytes > 16_384) { failure ??= new GitFailure({ reason: "output_limit" }); stop(); }
  });
  child.on("error", (error: NodeJS.ErrnoException) => {
    failure ??= new GitFailure({ reason: error.code === "ENOENT" ? "git_unavailable" : "git_failed" });
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    clearTimeout(escalation);
    signal.removeEventListener("abort", abort);
    // Also reap a descendant that closed its pipes and ignored SIGTERM even
    // when Git exited before the grace timer. No delayed kill may outlive us.
    if (stopping) send("SIGKILL");
    if (failure !== undefined) reject(failure);
    else resolve({ stdout: boundedUtf8(Buffer.concat(out), limits.bytes), stderr: boundedUtf8(Buffer.concat(err), 16_384), code: code ?? -1, truncated });
  });
});

export const processFailure = (reply: ProcessReply): GitFailure => {
  const text = reply.stderr;
  const reason = /index\.lock|another git process/i.test(text) ? "busy"
    : /authentication|permission denied|could not read (?:Username|Password)|terminal prompts disabled/i.test(text) ? "authentication_required"
    : /could not resolve|unable to access|could not read from remote|connection refused|does not appear to be a git repository/i.test(text) ? "network_failed"
    : /\[rejected\]|non-fast-forward|fetch first/i.test(text) ? "push_rejected" : "git_failed";
  // Only an actual completed Git response proving a rejection/refusal settles
  // a started operation. A disconnect or generic transport failure does not.
  // Git/curl can omit the port detail or report only the fixed suffix. A
  // phrase in the quoted URL or an incomplete response is not evidence.
  const refusedConnection = !reply.truncated && reason === "network_failed"
    && /^fatal: unable to access '[^\r\n]*': (?:Failed to connect to [^\r\n]+: )?Could not connect to server\r?$/im.test(text);
  const determinate = reply.code > 0 && (refusedConnection || /\[rejected\]|non-fast-forward|fetch first|could not resolve|connection refused|does not appear to be a git repository|authentication failed|permission denied|terminal prompts disabled/i.test(text));
  return new GitFailure({ reason, ...(determinate ? { determinate: true } : {}) });
};
