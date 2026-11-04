import type { Session } from "./session.ts";

// This is the sole boundary from an untrusted web cookie to engine authority.
export const webCaller = (session: Session, headers: Readonly<Record<string, string | undefined>>) =>
  headers.authorization === undefined && session.valid(headers.cookie) ? { _tag: "owner" } as const : undefined;
