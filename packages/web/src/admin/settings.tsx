import { useEffect, useRef, useState, type FormEvent } from "react"
import { PublicWebAddress, publicAddressError, type AlertKind, type AlertSettings, type WebSettings, type WebServerState } from "@shephrd/contracts"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { requestId, useAdminApi } from "./api.ts"

type Web = WebSettings & { readonly serverState: typeof WebServerState.Type }
const input = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement

function PushSetting({ kind, push, busy, onChange }: {
  readonly kind: AlertKind
  readonly push: boolean
  readonly busy: boolean
  readonly onChange: (push: boolean) => void
}) {
  const control = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const element = control.current!
    const change = () => onChange(element.checked)
    element.addEventListener("change", change)
    return () => element.removeEventListener("change", change)
  }, [onChange])
  useEffect(() => {
    if (!busy) control.current!.checked = push
  }, [push, busy])
  return <label><input ref={control} type="checkbox" defaultChecked={push} disabled={busy} /> Push for {kind}</label>
}

export function Settings({ onSessionExpired }: { readonly onSessionExpired: () => void }) {
  const { run, busy, message, setMessage } = useAdminApi(onSessionExpired)
  const [alerts, setAlerts] = useState<AlertSettings>()
  const [web, setWeb] = useState<Web>()

  async function load() {
    const settings = await run((client) => Effect.gen(function* () {
      const alerts = yield* client["client.alerts.settings"]({ requestId: requestId() })
      const web = yield* client["client.web.settings"]({ requestId: requestId() })
      return { alerts, web }
    }))
    if (settings !== undefined) {
      setAlerts(settings.alerts)
      setWeb(settings.web)
    }
  }
  useEffect(() => { void load() }, [run])

  async function setPush(kind: AlertKind, push: boolean) {
    const reply = await run((client) => client["client.alerts.settings.set"]({ requestId: requestId(), kind, push }))
    if (reply !== undefined) {
      setAlerts((settings) => settings && { ...settings, kinds: settings.kinds.map((entry) => entry.kind === kind ? { kind, push } : entry) })
      setMessage("Alert push setting saved.")
    }
  }

  async function saveCarrier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const carrier = { _tag: "ntfy" as const, server: input(form, "server").value, topic: input(form, "topic").value }
    const reply = await run((client) => client["client.alerts.carrier.set"]({ requestId: requestId(), carrier }))
    if (reply !== undefined) {
      // Read the canonical origin and whether changing it cleared the token.
      await load()
    }
  }

  async function clearCarrier() {
    const reply = await run((client) => client["client.alerts.carrier.set"]({ requestId: requestId(), carrier: { _tag: "none" } }))
    if (reply !== undefined) await load()
  }

  async function saveToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const control = input(event.currentTarget, "token")
    const value = Redacted.make(control.value, { label: "secret value" })
    control.value = ""
    try {
      if (alerts?.carrier._tag !== "ntfy") return
      const origin = alerts.carrier.server
      const reply = await run((client) => client["client.alerts.carrier.set-token"]({
        requestId: requestId(), origin, nonce: crypto.randomUUID(), value
      }))
      if (reply !== undefined) {
        setAlerts((settings) => settings && { ...settings, tokenSet: true })
        setMessage("Carrier token saved.")
      }
    } finally {
      Redacted.wipeUnsafe(value)
    }
  }

  async function clearToken() {
    const reply = await run((client) => client["client.alerts.carrier.clear-token"]({ requestId: requestId() }))
    if (reply !== undefined) {
      setAlerts((settings) => settings && { ...settings, tokenSet: false })
      setMessage("Carrier token cleared.")
    }
  }

  async function saveWeb(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const publicAddress = input(form, "publicAddress").value.trim()
    if (publicAddress !== "" && !Schema.is(PublicWebAddress)(publicAddress)) {
      setMessage(publicAddressError)
      return
    }
    if (input(form, "proxyMode").checked && publicAddress === "") {
      setMessage("Proxy mode requires an HTTPS public address.")
      return
    }
    const settings: WebSettings = {
      enabled: input(form, "enabled").checked,
      port: Number(input(form, "port").value),
      heartbeatSeconds: Number(input(form, "heartbeatSeconds").value),
      proxyMode: input(form, "proxyMode").checked,
      ...(publicAddress === "" ? {} : { publicAddress })
    }
    const reply = await run((client) => client["client.web.settings.set"]({ requestId: requestId(), settings }))
    if (reply !== undefined) {
      setMessage("Web settings saved. Reconnect to check the server state. A port change applies at the next service start.")
    }
  }

  return <section aria-label="Settings">
    <h2>Settings</h2>
    {message && <p role="status">{message}</p>}
    <button disabled={busy} onClick={() => { void load() }}>Refresh settings</button>
    {alerts === undefined || web === undefined ? <p role="status">{busy ? "Loading settings…" : "Settings have not loaded."}</p> : <>
      <section aria-label="Alert push settings">
        <h3>Alert push settings</h3>
        {alerts.kinds.map(({ kind, push }) => <PushSetting key={kind} kind={kind} push={push} busy={busy} onChange={(value) => { void setPush(kind, value) }} />)}
      </section>
      <h3>Alert carrier</h3>
      <form aria-label="Alert carrier" onSubmit={(event) => { void saveCarrier(event) }} key={`carrier-${alerts.carrier._tag === "ntfy" ? `${alerts.carrier.server}/${alerts.carrier.topic}` : "none"}`}>
        <fieldset disabled={busy}>
          <legend>Carrier destination</legend>
          <label>Server<input name="server" type="url" defaultValue={alerts.carrier._tag === "ntfy" ? alerts.carrier.server : ""} required /></label>
          <label>Topic<input name="topic" defaultValue={alerts.carrier._tag === "ntfy" ? alerts.carrier.topic : ""} pattern="[-_A-Za-z0-9]{1,64}" maxLength={64} required /></label>
          <button type="submit">Save carrier</button>
          <button type="button" onClick={() => { void clearCarrier() }}>Clear carrier</button>
        </fieldset>
      </form>
      <h3>Carrier token</h3>
      <p>{alerts.tokenSet ? "Token set" : "No token set"}</p>
      <p>Token destination: {alerts.carrier._tag === "ntfy" ? alerts.carrier.server : "No carrier configured"}</p>
      <form aria-label="Carrier token" onSubmit={(event) => { void saveToken(event) }} key={`token-${alerts.carrier._tag === "ntfy" ? alerts.carrier.server : "none"}`}>
        <fieldset disabled={busy}>
          <legend>Write-only token</legend>
          <label>New token<input name="token" type="password" autoComplete="off" required disabled={alerts.carrier._tag !== "ntfy"} /></label>
          <button type="submit" disabled={alerts.carrier._tag !== "ntfy"}>Set token</button>
          <button type="button" disabled={!alerts.tokenSet} onClick={() => { void clearToken() }}>Clear token</button>
        </fieldset>
      </form>
      <h3>Web server</h3>
      <p>Server state (last read): {web.serverState}</p>
      <p>Configured port (last read): {web.port}</p>
      <p>Saving closes web connections. Turning the server off or changing its public address may require the terminal to restore access. A port change applies at the next service start.</p>
      <form aria-label="Web server settings" onSubmit={(event) => { void saveWeb(event) }} key={`web-${JSON.stringify(web)}`}>
        <fieldset disabled={busy}>
          <legend>Web server settings</legend>
          <label><input name="enabled" type="checkbox" defaultChecked={web.enabled} /> Enable web server</label>
          <label>Port<input name="port" type="number" min={1} max={65535} defaultValue={web.port} required /></label>
          <label>Heartbeat seconds<input name="heartbeatSeconds" type="number" min={1} defaultValue={web.heartbeatSeconds} required /></label>
          <label><input name="proxyMode" type="checkbox" defaultChecked={web.proxyMode} /> Use proxy mode</label>
          <label>Public address (HTTPS)<input name="publicAddress" type="url" placeholder="https://shephrd.example" aria-describedby="public-address-help" defaultValue={web.publicAddress ?? ""} /></label>
          <p id="public-address-help">Use HTTPS through your proxy. For an SSH tunnel, open http://127.0.0.1 at the server’s port and leave the public address empty.</p>
          <button type="submit">Save web settings</button>
        </fieldset>
      </form>
    </>}
  </section>
}
