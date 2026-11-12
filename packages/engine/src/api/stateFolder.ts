import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { legacyStateFolderName, stateFolderName } from "@lgtm/contracts/legacyNames";

// An installation from before the rename keeps its folder: the old name is
// used while it exists and the new one does not.
const preferCurrent = (parent: string): string => {
  const current = resolve(parent, stateFolderName);
  const legacy = resolve(parent, legacyStateFolderName);
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
};

export const stateFolder = (environment: Record<string, string | undefined>): string => {
  if (environment.LGTM_HOME !== undefined) return resolve(environment.LGTM_HOME);
  if (environment.XDG_STATE_HOME !== undefined) return preferCurrent(environment.XDG_STATE_HOME);
  if (environment.HOME === undefined) throw new Error("home folder is unavailable");
  return preferCurrent(resolve(environment.HOME, ".local/state"));
};

// No repair of unsafe permissions: fail before creating the lock, credential
// or database, and inspect the path itself rather than following a link.
export const prepareStateFolder = (folder: string): void => {
  if (Buffer.byteLength(join(folder, "engine.sock")) > 100) throw new Error("socket path exceeds 100 bytes");
  process.umask(0o077);
  let stats;
  try { stats = lstatSync(folder); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("state folder cannot be inspected");
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    stats = lstatSync(folder);
  }
  if (stats.isSymbolicLink()) throw new Error("state folder is a symbolic link");
  if (!stats.isDirectory()) throw new Error("state folder is not a directory");
  if (stats.uid !== process.getuid?.()) throw new Error("state folder is owned by another user");
  if ((stats.mode & 0o7777) !== 0o700) throw new Error("state folder mode is not 0700");
};
