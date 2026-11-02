import { main, realDeps } from "./live/run.ts";

// Unit 8c, criterion 8.6: `pnpm live-check`. Not part of `pnpm check`; see
// `live/run.ts`. All the work is in `main`, which a test runs with fakes.

const write = (line: string): void => { process.stdout.write(`${line}\n`); };

main(process.argv.slice(2), realDeps(process.env, write)).then(
  (code) => { process.exitCode = code; },
  // The message of an unexpected error may hold anything a library repeated,
  // a credential included, so only the kind of error is printed.
  (error: unknown) => { process.stderr.write(`live-check crashed (${error instanceof Error ? error.name : "unknown error"}); its message is not printed in case it holds a secret\n`); process.exitCode = 1; },
);
