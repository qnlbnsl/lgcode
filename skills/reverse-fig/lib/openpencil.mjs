// Runs the OpenPencil command-line tool. REVERSE_FIG_OPENPENCIL names another copy of its
// openpencil.js; otherwise the copy installed next to this skill is used.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const installed = join(skillDir, 'node_modules', '@open-pencil', 'cli', 'bin', 'openpencil.js');
export const fontsDir = join(skillDir, 'node_modules', '@open-pencil', 'core', 'assets');

export function openpencil(args, { input } = {}) {
  const bin = process.env.REVERSE_FIG_OPENPENCIL || installed;
  if (!existsSync(bin)) throw new Error(`OpenPencil is not installed. Run: npm install --prefix ${skillDir}`);
  const run = spawnSync(process.execPath, [bin, ...args], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`openpencil ${args[0]} failed:\n${run.stderr || run.stdout}`);
  return run.stdout;
}
