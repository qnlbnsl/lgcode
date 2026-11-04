import * as Schema from "effect/Schema"

export const WebSettings = Schema.Struct({
  enabled: Schema.Boolean,
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  heartbeatSeconds: Schema.Int.check(Schema.isGreaterThan(0)),
  proxyMode: Schema.Boolean,
  publicAddress: Schema.optionalKey(Schema.NonEmptyString)
})
export type WebSettings = typeof WebSettings.Type
export const WebServerState = Schema.Literals(["running", "off", "port-taken", "no-password"])
export const defaultWebSettings: WebSettings = { enabled: true, port: 8787, heartbeatSeconds: 25, proxyMode: false }
