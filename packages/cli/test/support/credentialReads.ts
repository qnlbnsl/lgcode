// Read auditing is installed in-process for the client and as a Node preload
// for the real CLI. Only the planted credential path is recorded; bytes are not.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

export const auditCredentialReads = (credential: string, marker: string): (() => void) => {
  const read = fs.readFileSync;
  fs.readFileSync = function (...args: Parameters<typeof fs.readFileSync>) {
    if (String(args[0]) === credential) fs.appendFileSync(marker, "read\n");
    return Reflect.apply(read, fs, args);
  } as typeof fs.readFileSync;
  syncBuiltinESMExports();
  return () => { fs.readFileSync = read; syncBuiltinESMExports(); };
};

if (process.env.SHEPHRD_TEST_CREDENTIAL_PATH && process.env.SHEPHRD_TEST_CREDENTIAL_READS) {
  auditCredentialReads(process.env.SHEPHRD_TEST_CREDENTIAL_PATH, process.env.SHEPHRD_TEST_CREDENTIAL_READS);
}
