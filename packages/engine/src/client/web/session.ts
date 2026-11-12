import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as Redacted from "effect/Redacted";

const digest = (text: string) => createHash("sha256").update(text).digest();
export const cookieName = "lgtm_session";
export const makeSession = (password: Redacted.Redacted<string> | undefined, register: (secret: Redacted.Redacted<string>) => void) => {
  const expected = digest(password === undefined ? "" : Redacted.value(password));
  let token = "";
  const rotate = () => { token = randomBytes(32).toString("base64url"); register(Redacted.make(token)); };
  rotate();
  return {
    rotate,
    checkPassword: (value: unknown) => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 4096
      && timingSafeEqual(digest(value), expected),
    valid: (cookie: string | undefined) => {
      const values = (cookie ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${cookieName}=`));
      if (values.length !== 1) return false;
      return timingSafeEqual(digest(values[0]!.slice(cookieName.length + 1)), digest(token));
    },
    cookie: (secure: boolean) => `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/${secure ? "; Secure" : ""}`,
  };
};
export type Session = ReturnType<typeof makeSession>;
