import { lstatSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as Effect from "effect/Effect";

// Only this module opens engine.lock. In particular no liveness probe opens
// it: closing another descriptor for this inode would release POSIX locks.
export const takeLock = (folder: string) => Effect.acquireRelease(Effect.try({
  try: () => {
    const path = join(folder, "engine.lock");
    try {
      const stats = lstatSync(path);
      if (!stats.isFile() || stats.uid !== process.getuid?.() || (stats.mode & 0o7777) !== 0o600) throw new Error("lock file refused");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const database = new DatabaseSync(path, { timeout: 0 });
    try {
      database.exec("PRAGMA busy_timeout=0; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS lifetime (id INTEGER PRIMARY KEY); INSERT OR REPLACE INTO lifetime VALUES (1); COMMIT;");
      return database;
    } catch (error) {
      database.close();
      if (typeof error === "object" && error !== null && "errcode" in error && error.errcode === 5) return undefined;
      throw error;
    }
  },
  catch: () => new Error("service lock failed"),
}), (database) => Effect.sync(() => { database?.close(); }));
