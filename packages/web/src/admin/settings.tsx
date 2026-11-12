import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { PublicWebAddress, publicAddressError, WebSettings, type AlertKind, type AlertSettings, type WebServerState } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { requestId, useAdminApi } from "./api.ts"
import { useMutationDisabled } from "../data/ShellDataProvider.tsx"
import { applyTheme, themeChoice, writePreference, type ThemeChoice } from "../shell/preferences.ts"
import { AdminConfirm } from "./confirm.tsx"
import "./admin.css"

type Web = WebSettings & { readonly serverState: typeof WebServerState.Type }
const input = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement
const pushLabels: Record<AlertKind, string> = {
  approval: "Approvals", question: "Questions", failure: "Agent failures", account: "Subscription problems", other: "Other attention",
  "client.web-down": "Web server down", "board.post": "Posts needing your reply", "board.no-answer": "Unanswered posts",
  "roles.stall": "Stalled agents", "roles.replace": "Worker replacement", "roles.runaway": "Work exceeding its expected length",
  "roles.rule-first-use": "First use of a permission rule"
}
const sections = [["appearance", "Appearance"], ["notifications", "Phone notifications"], ["service", "Notification service"], ["web", "Web server"]] as const

function PushSetting({ kind, push, busy, saving, onChange }: {
  readonly kind: AlertKind; readonly push: boolean; readonly busy: boolean; readonly saving: boolean; readonly onChange: (push: boolean) => void
}) {
  const control = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const element = control.current!
    const change = () => onChange(element.checked)
    element.addEventListener("change", change)
    return () => element.removeEventListener("change", change)
  }, [onChange])
  useEffect(() => { if (!saving) control.current!.checked = push }, [push, saving])
  return <div><label className="admin-check"><input aria-label={`Push for ${kind}`} ref={control} type="checkbox" defaultChecked={push} disabled={busy} />{pushLabels[kind]}</label>
    {kind === "roles.rule-first-use" && <p className="admin-note">A permission rule lets an agent perform a matching action without asking again.</p>}
  </div>
}

export function Settings({ onSessionExpired }: { readonly onSessionExpired: () => void }) {
  const { run, busy, message, setMessage } = useAdminApi(onSessionExpired)
  const offline = useMutationDisabled()
  const [alerts, setAlerts] = useState<AlertSettings>()
  const [web, setWeb] = useState<Web>()
  const [theme, setTheme] = useState(themeChoice)
  const [section, setSection] = useState<string>("appearance")
  const [saved, setSaved] = useState("")
  const [uncertain, setUncertain] = useState(false)
  const [disableWeb, setDisableWeb] = useState<WebSettings>()
  const root = useRef<HTMLElement>(null)
  const token = useRef<HTMLInputElement>(null)
  const tokenControl = useCallback((element: HTMLInputElement | null) => {
    if (element === null && token.current !== null) token.current.value = ""
    token.current = element
  }, [])
  const locked = busy || offline || uncertain

  async function load() {
    const settings = await run((client) => Effect.gen(function* () {
      const alerts = yield* client["client.alerts.settings"]({ requestId: requestId() })
      const web = yield* client["client.web.settings"]({ requestId: requestId() })
      return { alerts, web }
    }))
    if (settings !== undefined) {
      setAlerts(settings.alerts)
      setWeb(settings.web)
      setUncertain(false)
      setSaved("")
      return true
    }
    setUncertain(true)
    return false
  }
  useEffect(() => { void load() }, [run])
  useEffect(() => {
    if (alerts === undefined || web === undefined) return
    const query = new URL(location.href).hash.split("?")[1]
    const focus = new URLSearchParams(query).get("focus")
    if (focus === "carrier" || focus === "token" && alerts.carrier._tag === "none") root.current?.querySelector<HTMLInputElement>('[name="server"]')?.focus()
    else if (focus === "token") token.current?.focus()
  }, [alerts === undefined, web === undefined])
  useEffect(() => {
    const element = root.current
    if (!element) return
    const scroller = element.closest(".view-body") ?? element.parentElement
    if (!scroller) return
    const update = () => {
      const top = scroller.getBoundingClientRect().top + 40
      let selected: string = "appearance"
      for (const [id] of sections) {
        const target = document.getElementById(`admin-settings-${id}`)
        if (target && target.getBoundingClientRect().top <= top) selected = id
      }
      if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) selected = "web"
      setSection(selected)
    }
    scroller.addEventListener("scroll", update, { passive: true })
    return () => scroller.removeEventListener("scroll", update)
  }, [alerts === undefined, web === undefined])

  function unknown() {
    setUncertain(true)
    setSaved("")
  }
  async function setPush(kind: AlertKind, push: boolean) {
    if (locked) return
    const reply = await run((client) => client["client.alerts.settings.set"]({ requestId: requestId(), kind, push }))
    if (reply !== undefined) {
      setAlerts((settings) => settings && { ...settings, kinds: settings.kinds.map((entry) => entry.kind === kind ? { kind, push } : entry) })
      setSaved(`push-${kind}`)
      setMessage("Alert push setting saved.")
    } else {
      if (!await load()) unknown()
      setMessage("Could not complete the request. Check the refreshed setting before trying again.")
    }
  }

  async function saveCarrier(form: HTMLFormElement) {
    if (locked || alerts === undefined || !form.reportValidity()) return
    const carrier = { _tag: "ntfy" as const, server: input(form, "server").value.trim(), topic: input(form, "topic").value.trim() }
    let origin: string
    try {
      const url = new URL(carrier.server)
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error()
      origin = url.origin
    } catch { setMessage("Enter a notification server address without a user name or password."); return }
    if (alerts.carrier._tag === "ntfy" && origin === alerts.carrier.server && carrier.topic === alerts.carrier.topic) {
      input(form, "server").value = origin
      return
    }
    if (token.current) token.current.value = ""
    const reply = await run((client) => client["client.alerts.carrier.set"]({ requestId: requestId(), carrier }))
    if (reply !== undefined) await load()
    else unknown()
  }

  async function clearCarrier() {
    if (locked) return
    if (token.current) token.current.value = ""
    const reply = await run((client) => client["client.alerts.carrier.set"]({ requestId: requestId(), carrier: { _tag: "none" } }))
    if (reply !== undefined) await load()
    else unknown()
  }

  async function saveToken(form: HTMLFormElement) {
    if (locked || alerts?.carrier._tag !== "ntfy") return
    const control = input(form, "token")
    if (control.value === "") return
    const value = Redacted.make(control.value, { label: "secret value" })
    control.value = ""
    try {
      const origin = alerts.carrier.server
      const reply = await run((client) => client["client.alerts.carrier.set-token"]({
        requestId: requestId(), origin, nonce: crypto.randomUUID(), value
      }))
      if (reply !== undefined) {
        setAlerts((settings) => settings && { ...settings, tokenSet: true })
        setSaved("token")
        setMessage("Carrier token saved.")
      } else unknown()
    } finally { Redacted.wipeUnsafe(value) }
  }

  async function clearToken() {
    if (locked) return
    if (token.current) token.current.value = ""
    const reply = await run((client) => client["client.alerts.carrier.clear-token"]({ requestId: requestId() }))
    if (reply !== undefined) {
      setAlerts((settings) => settings && { ...settings, tokenSet: false })
      setSaved("")
      setMessage("Carrier token cleared.")
    } else unknown()
  }

  async function testNotification() {
    if (locked || alerts?.carrier._tag !== "ntfy" || !alerts.tokenSet) return
    const reply = await run((client) => client["client.alerts.test"]({ requestId: requestId() }))
    setMessage(reply === undefined ? "Could not confirm the test result. It may have been sent. Sending another test may duplicate it."
      : reply.accepted ? "The notification service accepted the test. Phone arrival is not confirmed."
      : `The notification service did not accept the test: ${reply.reason ?? "carrier delivery failed"}.`)
  }

  async function writeWeb(settings: WebSettings) {
    if (locked) return
    setDisableWeb(undefined)
    const reply = await run((client) => client["client.web.settings.set"]({ requestId: requestId(), settings }))
    if (reply !== undefined) {
      setSaved("web")
      setMessage("Web settings saved. Reconnect to check the server state. A port change applies at the next service start.")
    }
    // The listener can close its own acknowledgement socket. Only a fresh
    // canonical read can unlock another edit after this operation.
    setUncertain(true)
  }
  async function saveWeb(form: HTMLFormElement) {
    if (locked || web === undefined || !form.reportValidity()) return
    const publicAddress = input(form, "publicAddress").value.trim()
    if (publicAddress !== "" && !Schema.is(PublicWebAddress)(publicAddress)) { setMessage(publicAddressError); return }
    if (input(form, "proxyMode").checked && publicAddress === "") { setMessage("Proxy mode requires an HTTPS public address."); return }
    const settings: WebSettings = {
      enabled: input(form, "enabled").checked, port: Number(input(form, "port").value),
      heartbeatSeconds: Number(input(form, "heartbeatSeconds").value), proxyMode: input(form, "proxyMode").checked,
      ...(publicAddress === "" ? {} : { publicAddress }),
      ...(input(form, "displayAddress").value.trim() === "" ? {} : { display: {
        publicAddress: input(form, "displayAddress").value.trim(), port: Number(input(form, "displayPort").value)
      } })
    }
    if (!Schema.is(WebSettings)(settings)) { setMessage("Enter valid ports and a positive whole number of seconds. Displays require a different HTTPS hostname and listener port."); return }
    const { serverState: _, requestId: _request, ...previous } = web as Web & { requestId?: string }
    if (JSON.stringify(settings) === JSON.stringify(previous)) return
    if (web.enabled && !settings.enabled) {
      input(form, "enabled").checked = true
      setDisableWeb(settings)
      return
    }
    await writeWeb(settings)
  }
  const submit = (event: FormEvent<HTMLFormElement>, save: (form: HTMLFormElement) => Promise<void>) => { event.preventDefault(); void save(event.currentTarget) }
  const savedMark = (key: string) => saved === key ? <span className="admin-saved" role="status">Saved</span> : null
  return <section ref={root} className="admin-page" aria-label="Service settings">
    <div className="admin-page-top"><h2>Service settings</h2><button disabled={busy} onClick={() => { void load() }}>Refresh settings</button></div>
    {message && <p role="status">{message}</p>}
    {offline && <p className="admin-note">Reconnect before changing service settings.</p>}
    {uncertain && <p className="admin-warning">Refresh settings to check the saved state before changing another field.</p>}
    <div className="admin-settings-layout">
      <nav className="admin-settings-nav" aria-label="Service settings sections">{sections.map(([id, label]) => <button type="button" key={id} aria-current={section === id ? "true" : undefined}
        onClick={() => { document.getElementById(`admin-settings-${id}`)?.scrollIntoView({ block: "start" }); setSection(id) }}>{label}</button>)}</nav>
      <div className="admin-settings-sections">
        <section className="admin-settings-section" id="admin-settings-appearance"><h3>Appearance</h3>
          <div className="admin-actions" role="group" aria-label="Color mode">{([["light", "Light"], ["dark", "Dark"], ["system", "Match system"]] as const).map(([value, label]) => <button key={value} aria-pressed={theme === value}
            onClick={() => { const choice: ThemeChoice = value; writePreference("lgtm-theme", choice); applyTheme(choice); setTheme(choice) }}>{label}</button>)}</div>
          <p className="admin-note">Saved in this browser. Match system follows the device’s light or dark setting.</p>
        </section>
        {alerts === undefined || web === undefined ? <p role="status">{busy ? "Loading settings…" : "Settings have not loaded."}</p> : <>
          <section className="admin-settings-section" id="admin-settings-notifications" aria-label="Alert push settings"><h3>Phone notifications</h3>
            <div className="admin-push-list">{alerts.kinds.map(({ kind, push }) => <div key={kind}><PushSetting kind={kind} push={push} busy={locked} saving={busy} onChange={(value) => { void setPush(kind, value) }} />{savedMark(`push-${kind}`)}</div>)}</div>
          </section>
          <section className="admin-settings-section" id="admin-settings-service"><h3>Notification service</h3>
            <p className="admin-note">LGTM Studio sends phone notifications through an ntfy server.</p>
            <form aria-label="Alert carrier" onSubmit={(event) => submit(event, saveCarrier)} onBlur={(event) => { if (event.target instanceof HTMLInputElement) void saveCarrier(event.currentTarget) }}
              key={`carrier-${alerts.carrier._tag === "ntfy" ? `${alerts.carrier.server}/${alerts.carrier.topic}` : "none"}`}>
              <fieldset disabled={locked}><label>Server<input name="server" type="url" defaultValue={alerts.carrier._tag === "ntfy" ? alerts.carrier.server : ""} required /></label>
                <label>Topic<input name="topic" defaultValue={alerts.carrier._tag === "ntfy" ? alerts.carrier.topic : ""} pattern="[-_A-Za-z0-9]{1,64}" maxLength={64} required /></label>
              </fieldset>
            </form>
            <p><span>{alerts.tokenSet ? "Token set" : "No token set"}</span> {savedMark("token")}</p>
            <p className="admin-note">Token destination: {alerts.carrier._tag === "ntfy" ? alerts.carrier.server : "No carrier configured"}</p>
            <form aria-label="Carrier token" onSubmit={(event) => submit(event, saveToken)} key={`token-${alerts.carrier._tag === "ntfy" ? alerts.carrier.server : "none"}`}>
              <fieldset disabled={locked}><div className="admin-field-row"><label>Notification service token<input aria-label="New token" ref={tokenControl} name="token" type="password" autoComplete="off" disabled={alerts.carrier._tag !== "ntfy"}
                onBlur={(event) => { void saveToken(event.currentTarget.form!) }} /></label>
                <button type="button" disabled={alerts.carrier._tag !== "ntfy" || !alerts.tokenSet} onClick={() => { void testNotification() }}>Send test notification</button></div>
                <p className="admin-note">{alerts.carrier._tag !== "ntfy" ? "Set the notification service first." : !alerts.tokenSet ? "Set the token first." : "The token is write-only. Its value is never read back."}</p>
                <div className="admin-actions"><button type="button" disabled={!alerts.tokenSet} onClick={() => { void clearToken() }}>Clear token</button>
                  <button type="button" disabled={alerts.carrier._tag === "none"} onClick={() => { void clearCarrier() }}>Clear carrier</button></div>
              </fieldset>
            </form>
          </section>
          <section className="admin-settings-section" id="admin-settings-web"><h3>Web server</h3>
            <p>Server state (last read): {web.serverState}</p><p>Configured port (last read): {web.port}</p>
            <p className="admin-note">Saving closes web connections. Turning the server off or changing its public address may require the terminal to restore access. A port change applies at the next service start.</p>
            <form aria-label="Web server settings" key={`web-${JSON.stringify(web)}`} onSubmit={(event) => submit(event, saveWeb)}
              onBlur={(event) => { if (event.target instanceof HTMLInputElement && event.target.type !== "checkbox") void saveWeb(event.currentTarget) }}>
              <fieldset disabled={locked}><label className="admin-check"><input name="enabled" type="checkbox" defaultChecked={web.enabled} onChange={(event) => { void saveWeb(event.currentTarget.form!) }} />Enable web server</label>
                <div className="admin-form-grid"><label>Port<input name="port" type="number" min={1} max={65535} defaultValue={web.port} required /></label>
                  <label>Check-in interval, in seconds<input aria-label="Heartbeat seconds" name="heartbeatSeconds" type="number" min={1} defaultValue={web.heartbeatSeconds} required /></label></div>
                <label className="admin-check"><input name="proxyMode" type="checkbox" defaultChecked={web.proxyMode} onChange={(event) => { void saveWeb(event.currentTarget.form!) }} />Use proxy mode</label>
                <label>Public address (HTTPS)<input name="publicAddress" type="url" placeholder="https://lgtm.example" aria-describedby="public-address-help" defaultValue={web.publicAddress ?? ""} /></label>
                <p className="admin-note" id="public-address-help">Use HTTPS through your proxy. For an SSH tunnel, open http://127.0.0.1 at the server’s port and leave the public address empty.</p>{savedMark("web")}
                <label>Preview and design address (HTTPS)<input name="displayAddress" type="url" defaultValue={web.display?.publicAddress ?? ""} aria-describedby="display-address-help" /></label>
                <label>Preview and design listener port<input name="displayPort" type="number" min={1} max={65535} defaultValue={web.display?.port ?? ""} /></label>
                <p className="admin-note" id="display-address-help">Use a different hostname through your proxy, with its own loopback port. Leave the address empty to disable previews and the design editor.</p>
              </fieldset>
            </form>
          </section>
        </>}
      </div>
    </div>
    {disableWeb && <AdminConfirm title="Turn off the web server?" confirm="Turn off" busy={busy} disabled={offline} onCancel={() => setDisableWeb(undefined)} onConfirm={() => { void writeWeb(disableWeb) }}>
      <p>This closes web access. Use the terminal to turn the server on again.</p>
    </AdminConfirm>}
  </section>
}
