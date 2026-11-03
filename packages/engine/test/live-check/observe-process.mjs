// A test helper for dry-run.test.ts, loaded with `node --import`. It records,
// in the file named by OBSERVE_LOG, every folder this process asks to create
// and every child process it asks to start, so a test can say what the
// process itself did instead of counting folders that other runs may own.
import childProcess from "node:child_process";
import fs from "node:fs";
import module from "node:module";

const log = process.env.OBSERVE_LOG;
const note = (what, detail) => { fs.appendFileSync(log, `${what} ${String(detail)}\n`); };
note("observer", "started");

const wrap = (target, name, describe) => {
  const original = target[name];
  target[name] = function (...args) { note(name, describe(args)); return original.apply(this, args); };
};
for (const name of ["mkdtempSync", "mkdirSync", "mkdir", "mkdtemp", "writeFileSync", "createWriteStream"]) wrap(fs, name, (args) => args[0]);
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) wrap(childProcess, name, (args) => args[0]);
// The wrapped functions are what `import { mkdtempSync } from "node:fs"` sees.
module.syncBuiltinESMExports();
