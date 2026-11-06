import type { WebSettings } from "@sheprd/contracts";

const forwardedHeaders = ["x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "forwarded"];
export const requestPolicy = (headers: Readonly<Record<string, string | undefined>>, settings: WebSettings, port: number, staticNavigation: boolean) => {
  const host = headers.host;
  const origin = headers.origin;
  const localHost = `127.0.0.1:${port}`;
  const localOrigin = `http://${localHost}`;
  const forwarded = forwardedHeaders.some((name) => Object.hasOwn(headers, name));
  if (!settings.proxyMode && forwarded) return { accepted: false, secure: false };
  const address = settings.proxyMode ? settings.publicAddress : undefined;
  const publicHost = address === undefined ? undefined : new URL(address).host;
  const isPublic = settings.proxyMode && (forwarded || host === publicHost || origin === address);
  if (isPublic) {
    const named = host === publicHost || origin === address;
    // A static navigation may arrive from an external link without an Origin.
    const accepted = named && (origin === address || (staticNavigation && origin === undefined && host === publicHost));
    return { accepted, secure: accepted && address?.startsWith("https:") === true };
  }
  return { accepted: host === localHost && (staticNavigation && origin === undefined || origin === localOrigin), secure: false };
};
