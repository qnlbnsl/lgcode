import { isRepositoryCredentialPath } from "@lgcode/contracts";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { GitFailure } from "./types.ts";

export const inside = (root: string, path: string): boolean => {
  const part = relative(root, path);
  return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`));
};
export const refuse = (): never => { throw new GitFailure({ reason: "invalid_path" }); };
export const cleanText = (text: string, maximum = 4096): boolean => typeof text === "string" && text.length > 0
  && Buffer.byteLength(text) <= maximum && !text.includes("\0") && !/[\r\n]/.test(text);
export const slug = (name: string): string => {
  if (!cleanText(name, 256)) return refuse();
  const value = name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/, "");
  if (value === "") return refuse();
  return value;
};

// NOFOLLOW and NONBLOCK avoid redirects and FIFOs. One extra byte detects a
// concurrent growth without reading an unbounded file.
export const smallFile = async (path: string, maximum: number): Promise<Buffer> => {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile()) return refuse();
    if (info.size > maximum) throw new GitFailure({ reason: "output_limit" });
    const buffer = Buffer.alloc(maximum + 1);
    let count = 0;
    while (count <= maximum) {
      const next = await file.read(buffer, count, maximum + 1 - count, count);
      if (next.bytesRead === 0) break;
      count += next.bytesRead;
    }
    if (count > maximum) throw new GitFailure({ reason: "output_limit" });
    return buffer.subarray(0, count);
  } finally { await file.close(); }
};

export const directory = async (root: string, folder: string): Promise<string> => {
  if (!cleanText(folder) || !isAbsolute(folder)) return refuse();
  const path = await realpath(folder);
  if (!inside(root, path) || !(await stat(path)).isDirectory()) return refuse();
  return path;
};

// Follow the same two-way linked-worktree convention as identity/ceiling.ts.
// A .git indirection may only point at metadata beneath this workspace.
export const checkedMetadata = async (root: string, folder: string): Promise<string> => {
  const dot = join(folder, ".git"), info = await lstat(dot);
  if (info.isDirectory()) return directory(root, dot);
  if (!info.isFile()) return refuse();
  const match = /^gitdir: ([^\r\n]+)\r?\n?$/.exec((await smallFile(dot, 4096)).toString("utf8"));
  if (match === null) return refuse();
  const gitdir = await directory(root, resolve(folder, match[1]!));
  const common = await directory(root, resolve(gitdir, (await smallFile(join(gitdir, "commondir"), 4096)).toString("utf8").trimEnd()));
  if (await realpath(dirname(gitdir)) !== await realpath(join(common, "worktrees"))) return refuse();
  const backlink = (await smallFile(join(gitdir, "gitdir"), 4096)).toString("utf8").trimEnd();
  if (await realpath(resolve(gitdir, backlink)) !== await realpath(dot)) return refuse();
  return common;
};

// No pathspec syntax, parent traversal, Git metadata, symlink component, or
// nested checkout is accepted. Deleted leaf paths are valid for add/restore.
export const filePath = async (folder: string, path: string): Promise<string> => {
  if (!cleanText(path) || isAbsolute(path) || path.includes("\\") || isRepositoryCredentialPath(path)) return refuse();
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || part.toLowerCase() === ".git")) return refuse();
  let current = folder;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]!);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) return refuse();
      if (i < parts.length - 1) {
        if (!info.isDirectory()) return refuse();
        try { await lstat(join(current, ".git")); return refuse(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      } else if (!info.isFile()) return refuse();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return current;
};
