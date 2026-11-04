import { rolesMain } from "./live/rolesRun.ts";

// Only the owner runs this against real accounts. It is not part of pnpm check.
rolesMain(process.argv.slice(2), process.env).then(
  (code) => { process.exitCode = code; },
  // Library errors can repeat credentials. Never print their message or stack.
  () => { process.stderr.write("live-check:roles failed; no error details were printed\n"); process.exitCode = 1; },
);
