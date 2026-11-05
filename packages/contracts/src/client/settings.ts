import * as Schema from "effect/Schema"

export const publicAddressError = "Public address must be a canonical HTTPS origin (https://host or https://host:port), with no credentials, path, query, fragment, or default port."
export const PublicWebAddress = Schema.String.check(Schema.makeFilter((address) => {
  try {
    const url = new URL(address)
    return url.protocol === "https:" && url.origin === address && url.username === "" && url.password === ""
      || publicAddressError
  } catch {
    return publicAddressError
  }
}))

export const WebSettings = Schema.Struct({
  enabled: Schema.Boolean,
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  heartbeatSeconds: Schema.Int.check(Schema.isGreaterThan(0)),
  proxyMode: Schema.Boolean,
  publicAddress: Schema.optionalKey(PublicWebAddress)
})
export type WebSettings = typeof WebSettings.Type
export const WebServerState = Schema.Literals(["running", "off", "port-taken", "no-password"])
export const defaultWebSettings: WebSettings = { enabled: true, port: 8787, heartbeatSeconds: 25, proxyMode: false }
