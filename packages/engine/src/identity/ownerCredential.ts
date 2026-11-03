import { randomBytes } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, mkdirSync, openSync,
  readSync, realpathSync, statSync, unlinkSync, writeSync,
} from "node:fs";
import { join } from "node:path";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

// Every reason is fixed text: no path, no file content and no system error
// message, which can name the file.
class OwnerCredentialRefused extends Data.TaggedError("OwnerCredentialRefused")<{
  readonly reason: string;
}> {}

const filename = "owner-credential";
const credentialBytes = 32;

const refuse = (reason: string) => new OwnerCredentialRefused({ reason });

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

// Decision row 37: the state folder is 0700 and owned by the service's user,
// checked at every start. Any other permission bits are refused, never
// repaired, so the owner learns that it was open (fix round 1, ruling 6).
const checkStateFolder = (folder: string): string => {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const real = realpathSync(folder);
  const stats = statSync(real);
  if (!stats.isDirectory()) throw refuse("state folder is not a directory");
  if (stats.uid !== process.getuid?.()) throw refuse("state folder is owned by another user");
  if ((stats.mode & 0o7777) !== 0o700) throw refuse("state folder mode is not 0700");
  return real;
};

// Opens without following a symbolic link and without blocking on a FIFO,
// then checks what was actually opened.
const readExisting = (path: string): Buffer | undefined => {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return undefined;
    if (code === "ELOOP") throw refuse("owner credential is a symbolic link");
    throw refuse("owner credential cannot be opened");
  }
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) throw refuse("owner credential is not a regular file");
    if (stats.uid !== process.getuid?.()) throw refuse("owner credential is owned by another user");
    if ((stats.mode & 0o7777) !== 0o600) throw refuse("owner credential mode is not 0600");
    if (stats.size !== credentialBytes) throw refuse("owner credential is damaged");
    const bytes = Buffer.alloc(credentialBytes);
    let read = 0;
    while (read < credentialBytes) {
      const count = readSync(fd, bytes, read, credentialBytes - read, read);
      if (count === 0) throw refuse("owner credential is damaged");
      read += count;
    }
    return bytes;
  } finally {
    closeSync(fd);
  }
};

// The new file is written whole under a temporary name with an exclusive,
// no-follow open, then linked into place. `link` fails if the name exists,
// so a crash leaves either no credential or a complete one, and a second
// service starting at the same moment reads the first one's file.
const createNew = (folder: string, path: string): Buffer | undefined => {
  const bytes = randomBytes(credentialBytes);
  const temporary = join(folder, `.${filename}-${randomBytes(8).toString("hex")}`);
  const fd = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      let written = 0;
      while (written < credentialBytes) written += writeSync(fd, bytes, written, credentialBytes - written, written);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temporary, path);
    } catch (error) {
      if (errorCode(error) === "EEXIST") return undefined;
      throw error;
    }
  } finally {
    unlinkSync(temporary);
  }
  const directory = openSync(folder, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return bytes;
};

// The owner's terminal credential (criterion 5.2, decision row 37): 32
// random bytes in `<state folder>/owner-credential`, mode 0600, created on
// first start and never rewritten. It also sets the service's umask to 077,
// so every file the service creates afterwards is private.
export const loadOwnerCredential = (
  stateFolder: string,
): Effect.Effect<Redacted.Redacted<string>, OwnerCredentialRefused> =>
  Effect.try({
    try: () => {
      process.umask(0o077);
      const folder = checkStateFolder(stateFolder);
      const path = join(folder, filename);
      const bytes = readExisting(path) ?? createNew(folder, path) ?? readExisting(path);
      if (bytes === undefined) throw refuse("owner credential cannot be created");
      return Redacted.make(bytes.toString("base64url"));
    },
    catch: (error) => error instanceof OwnerCredentialRefused ? error : refuse("owner credential cannot be loaded"),
  });
