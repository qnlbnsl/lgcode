import { GitFailure, type Change, type Commit, type CommitFile, type ConflictSegment } from "./types.ts";

export const parseChanges = (text: string): Change[] => {
  const fields = text.split("\0"), changes: Change[] = [];
  for (let i = 0; i < fields.length && fields[i] !== ""; i++) {
    const field = fields[i]!;
    if (field.length < 4 || field[2] !== " ") throw new GitFailure({ reason: "git_failed" });
    const index = field[0]!, worktree = field[1]!, path = field.slice(3);
    const originalPath = /[RC]/.test(index + worktree) ? fields[++i] ?? null : null;
    const conflict = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(index + worktree);
    changes.push({ path, originalPath, index, worktree, conflict, untracked: index === "?",
      staged: !conflict && index !== " " && index !== "?", unstaged: !conflict && worktree !== " " });
  }
  return changes;
};
export const parseFiles = (text: string): CommitFile[] => {
  const fields = text.split("\0"), files: CommitFile[] = [];
  for (let i = 0; i < fields.length && fields[i] !== ""; i++) {
    const status = fields[i]!;
    const first = fields[++i];
    if (first === undefined) throw new GitFailure({ reason: "git_failed" });
    const rename = /^[RC]/.test(status), path = rename ? fields[++i] : first;
    if (path === undefined) throw new GitFailure({ reason: "git_failed" });
    files.push({ path, originalPath: rename ? first : null, status });
  }
  return files;
};
export const parseHistory = (text: string): Commit[] => {
  const fields = text.split("\0"), commits: Commit[] = [];
  for (let i = 0; i + 4 < fields.length; i += 5) {
    commits.push({ head: fields[i]!, parents: fields[i + 1]!.split(" ").filter(Boolean), author: fields[i + 2]!, at: fields[i + 3]!, title: fields[i + 4]! });
  }
  return commits;
};

// Lines include their terminator, so resolving does not add a final newline
// or change CRLF content. diff3 always supplies the common base for each hunk.
export const parseConflict = (text: string, markerSize: number): ConflictSegment[] => {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [], segments: ConflictSegment[] = [];
  const start = "<".repeat(markerSize), baseMark = "|".repeat(markerSize), middle = "=".repeat(markerSize), end = ">".repeat(markerSize);
  let i = 0;
  const is = (line: string | undefined, mark: string) => line !== undefined && (line.startsWith(mark + " ") || line.replace(/\r?\n$/, "") === mark);
  while (i < lines.length) {
    if (!is(lines[i], start)) {
      const line = i + 1, context: string[] = [];
      while (i < lines.length && !is(lines[i], start)) context.push(lines[i++]!);
      segments.push({ kind: "context", line, context });
      continue;
    }
    i++;
    const ours: string[] = [], base: string[] = [], theirs: string[] = [];
    while (i < lines.length && !is(lines[i], baseMark)) ours.push(lines[i++]!);
    if (i === lines.length) throw new GitFailure({ reason: "unsupported_conflict" });
    i++;
    while (i < lines.length && !is(lines[i], middle)) base.push(lines[i++]!);
    if (i === lines.length) throw new GitFailure({ reason: "unsupported_conflict" });
    i++;
    while (i < lines.length && !is(lines[i], end)) theirs.push(lines[i++]!);
    if (i === lines.length) throw new GitFailure({ reason: "unsupported_conflict" });
    i++;
    segments.push({ kind: "conflict", ours, base, theirs });
  }
  return segments;
};
