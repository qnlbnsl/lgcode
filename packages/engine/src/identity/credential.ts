// Pattern: T3 Code apps/server/src/auth/utils.ts (`createHash`, line 27; MIT
// licence). Only the idea of storing a SHA-256 digest instead of the secret
// was reused, no code.
import { createHash, randomBytes } from "node:crypto";

import * as Data from "effect/Data";
import * as Redacted from "effect/Redacted";

// Both reasons are fixed text. Neither ever repeats the submitted value, and
// a database failure carries no SQLite message, which can quote stored data.
export class InvalidCredential extends Data.TaggedError("InvalidCredential")<{
  readonly reason: "invalid credential";
}> {}

export class CredentialCheckFailed extends Data.TaggedError("CredentialCheckFailed")<{
  readonly reason: "credential check failed";
}> {}

// The wire form of an agent token (decision row 73):
// a fixed prefix, 32 random bytes in base64url (43 characters, no padding),
// an underscore, and the first eight lowercase hexadecimal digits of the
// SHA-256 digest of those bytes. The checksum lets a malformed value be
// refused before any table is read, and the prefix is what the redactor
// searches for before it hashes anything.
export type CredentialPrefix = "shp_a_";

export const credentialLength = 6 + 43 + 1 + 8;

const shape = /^shp_a_[A-Za-z0-9_-]{43}_[a-f0-9]{8}$/;

export const sha256Hex = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

const checksumOf = (bytes: Uint8Array): string => sha256Hex(bytes).slice(0, 8);

export const mintCredential = (prefix: CredentialPrefix): {
  readonly token: Redacted.Redacted<string>;
  readonly tokenHash: string;
} => {
  const bytes = randomBytes(32);
  const raw = `${prefix}${bytes.toString("base64url")}_${checksumOf(bytes)}`;
  return { token: Redacted.make(raw), tokenHash: sha256Hex(raw) };
};

// True when `raw` has the shape, the given prefix, a
// canonical base64url payload of exactly 32 bytes and a matching checksum.
// It hashes only the 32 decoded bytes, so its cost is fixed.
export const hasValidChecksum = (raw: string, prefix?: CredentialPrefix): boolean => {
  if (raw.length !== credentialLength || !shape.test(raw)) return false;
  if (prefix !== undefined && !raw.startsWith(prefix)) return false;
  const payload = raw.slice(6, 49);
  const bytes = Buffer.from(payload, "base64url");
  // 43 characters carry 258 bits; a non-canonical spelling of the same bytes
  // is refused so each credential has exactly one accepted form.
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== payload) return false;
  return checksumOf(bytes) === raw.slice(50);
};
