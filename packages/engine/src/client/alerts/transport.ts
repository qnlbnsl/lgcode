import { isIP } from "node:net";

const privateV4 = (host: string): boolean => {
  const [a, b] = host.split(".").map(Number);
  return a === 127 || a === 10 || (a === 172 && b! >= 16 && b! <= 31)
    || (a === 192 && b === 168) || (a === 169 && b === 254);
};
const privateLiteral = (host: string): boolean => {
  if (isIP(host) === 4) return privateV4(host);
  if (isIP(host) !== 6) return false;
  if (host === "::1" || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host)) return true;
  // URL canonicalization writes mapped IPv4 literals as two hex words.
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/i.exec(host);
  if (mapped === null) return false;
  const high = parseInt(mapped[1]!, 16); const low = parseInt(mapped[2]!, 16);
  return privateV4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
};
export const carrierOrigin = (input: string): string | undefined => {
  try {
    const url = new URL(input);
    if (url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") return undefined;
    if (url.protocol !== "https:" && (url.protocol !== "http:" || !privateLiteral(url.hostname.replace(/^\[|\]$/g, "")))) return undefined;
    return url.origin;
  } catch { return undefined; }
};
