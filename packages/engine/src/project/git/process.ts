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
  const kill = () => {
    try {
      if (process.platform !== "win32" && child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch { /* The child may already have exited. */ }
  };
  const abort = () => { failure = new GitFailure({ reason: "cancelled" }); kill(); };
  const timer = setTimeout(() => { failure = new GitFailure({ reason: "timeout" }); kill(); }, limits.timeoutMs);
  signal.addEventListener("abort", abort, { once: true });
  child.stdout.on("data", (data: Buffer) => {
    const remaining = Math.max(0, limits.bytes - bytes);
    if (remaining > 0) out.push(data.subarray(0, remaining));
    bytes += data.length;
    if (bytes > limits.bytes) {
      truncated = true;
      if (!truncate) failure = new GitFailure({ reason: "output_limit" });
      kill();
    }
  });
  child.stderr.on("data", (data: Buffer) => {
    const remaining = Math.max(0, 16_384 - stderrBytes);
    if (remaining > 0) err.push(data.subarray(0, remaining));
    stderrBytes += data.length;
    if (stderrBytes > 16_384) { failure = new GitFailure({ reason: "output_limit" }); kill(); }
  });
  child.on("error", (error: NodeJS.ErrnoException) => {
    failure = new GitFailure({ reason: error.code === "ENOENT" ? "git_unavailable" : "git_failed" });
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    if (failure !== undefined) reject(failure);
    else resolve({ stdout: boundedUtf8(Buffer.concat(out), limits.bytes), stderr: boundedUtf8(Buffer.concat(err), 16_384), code: code ?? -1, truncated });
  });
});

export const processFailure = (reply: ProcessReply): GitFailure => {
  const text = reply.stderr;
  return new GitFailure({ reason: /index\.lock|another git process/i.test(text) ? "busy"
    : /authentication|permission denied|could not read (?:Username|Password)|terminal prompts disabled/i.test(text) ? "authentication_required"
    : /could not resolve|unable to access|could not read from remote|connection refused|does not appear to be a git repository/i.test(text) ? "network_failed"
    : /\[rejected\]|non-fast-forward|fetch first/i.test(text) ? "push_rejected" : "git_failed" });
};
