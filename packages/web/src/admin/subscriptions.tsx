import { useEffect, useRef, useState, type FormEvent } from "react"
import type { Account, AccountId, ClientSnapshot, HarnessId, HarnessSettings, RequestId } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { useMutationDisabled, useShellData } from "../data/ShellDataProvider.tsx"
import { visibleText } from "../thread/text.tsx"
import { commandOutcome, requestId, useAdminApi } from "./api.ts"
import { AdminConfirm } from "./confirm.tsx"
import "./admin.css"

type Pending = { readonly requestId: RequestId } & (
  | { readonly operation: "add" | "set"; readonly account: Account }
  | { readonly operation: "remove" | "disable"; readonly accountId: AccountId }
)
const control = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement
export function Subscriptions({ onSessionExpired }: { readonly onSessionExpired: () => void }) {
  const data = useShellData()
  const { run, busy, message, setMessage } = useAdminApi(onSessionExpired)
  const offline = useMutationDisabled()
  const [state, setState] = useState<{ accounts: ReadonlyArray<Account>; snapshot: ClientSnapshot; harnesses: ReadonlyArray<HarnessSettings> }>()
  const [editing, setEditing] = useState<Account | "new">()
  const [removing, setRemoving] = useState<Account>()
  const [uncertain, setUncertain] = useState(false)
  const [stale, setStale] = useState(false)
  const pending = useRef<Pending | undefined>(undefined)
  const secretForm = useRef<HTMLFormElement>(null)
  const locked = busy || offline || uncertain || stale

  async function load() {
    const value = await run((client) => Effect.gen(function* () {
      const accounts = yield* client.accounts({ requestId: requestId(), operation: "list" })
      const snapshot = yield* client["client.snapshot"]({ requestId: requestId() })
      const harnesses = yield* client.harnesses({ requestId: requestId(), operation: "list" })
      return { accounts: accounts.accounts, snapshot, harnesses: harnesses.harnesses }
    }))
    if (value !== undefined) {
      setState(value)
      setStale(false)
      if (pending.current === undefined) setUncertain(false)
    } else setStale(true)
  }
  useEffect(() => { void load() }, [run])
  useEffect(() => {
    const secret = secretForm.current?.elements.namedItem("secret")
    return () => { if (secret instanceof HTMLInputElement) secret.value = "" }
  }, [editing])

  async function write(change?: Omit<Extract<Pending, { operation: "add" | "set" }>, "requestId"> | Omit<Extract<Pending, { operation: "remove" | "disable" }>, "requestId">) {
    if (busy || offline || change !== undefined && (uncertain || stale)) return
    if (pending.current === undefined) {
      if (change === undefined) return
      pending.current = { ...change, requestId: requestId() }
    }
    setRemoving(undefined)
    setUncertain(true)
    const reply = await run((client) => commandOutcome(client.accounts(pending.current!)))
    if (reply === undefined) return
    pending.current = undefined
    setUncertain(false)
    if (reply._tag === "acknowledged") setEditing(undefined)
    await load()
    if (reply._tag === "acknowledged") data.retry()
    setMessage(reply._tag === "acknowledged" ? "Subscription settings saved." : "The subscription change was refused. Review the refreshed settings.")
  }
  function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (locked || editing === undefined) return
    const form = event.currentTarget
    const home = control(form, "home").value.trim()
    const original = editing === "new" ? undefined : editing
    // Existing environment and secret references are retained verbatim by a
    // rename. This form never reads or constructs a credential value.
    const { home: _home, ...previous } = original ?? { id: crypto.randomUUID() as AccountId, harness: control(form, "harness").value as HarnessId }
    const account: Account = { ...previous, displayName: control(form, "name").value.trim(), ...(home === "" ? {} : { home }) }
    void write({ operation: original === undefined ? "add" : "set", account })
  }
  async function saveSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (locked || editing === undefined || editing === "new") return
    const form = event.currentTarget
    const field = control(form, "secret")
    const value = Redacted.make(field.value, { label: "secret value" })
    field.value = ""
    try {
      const reply = await run((client) => client["accounts set-secret"]({ requestId: requestId(), accountId: editing.id,
        name: control(form, "variable").value, nonce: crypto.randomUUID(), value }))
      if (reply === undefined) setUncertain(true)
      else { await load(); data.retry(); setMessage("Subscription secret saved. Its value is not read back.") }
    } finally { Redacted.wipeUnsafe(value) }
  }
  return <section className="admin-page" aria-label="Subscriptions">
    <div className="admin-page-top"><h2>Subscriptions</h2><div className="admin-actions"><button disabled={busy} onClick={() => { void load() }}>Refresh subscriptions</button>
      <button disabled={locked || state === undefined || state.harnesses.length === 0} onClick={() => setEditing("new")}>Add subscription</button></div></div>
    {message && <p role="status">{message}</p>}
    {offline && <p className="admin-note">Reconnect before changing subscriptions.</p>}
    {stale && <p className="admin-warning">Showing the last loaded subscriptions. Refresh before changing them.</p>}
    {uncertain && <div className="admin-actions"><p>The previous change is unconfirmed. {pending.current === undefined ? "Refresh subscriptions to check its state." : "Retry the same change to recover its receipt."}</p>
      {pending.current !== undefined && <button disabled={busy || offline} onClick={() => { void write() }}>Retry same change</button>}</div>}
    {state === undefined ? <p role="status">{busy ? "Loading subscriptions…" : "Subscriptions have not loaded."}</p> : state.accounts.length === 0 ? <p>No subscriptions yet.</p> : <div className="admin-table-wrap"><table className="admin-table" aria-label="Subscriptions">
      <thead><tr><th>Name</th><th>Harness</th><th>Machine</th><th>Active agents</th><th>Usage</th><th>Readiness</th><th>Use for new work</th><th>Actions</th></tr></thead>
      <tbody>{state.accounts.map((account) => {
        const status = state.snapshot.accounts?.find((row) => row.id === account.id)
        const active = state.snapshot.agents.filter((row) => row.account === account.id && !["stopped", "crashed"].includes(row.state._tag)).length
        const enabled = account.enabled !== false
        return <tr key={account.id}><td className="admin-record-name">{visibleText(account.displayName ?? account.id)}</td><td>{visibleText(account.harness)}</td><td>This computer</td>
          <td>{active} active {active === 1 ? "agent" : "agents"}</td><td>Not reported</td>
          <td className="admin-record-status">{status === undefined ? "Readiness unavailable" : status.status === "available" ? "Available" : visibleText(status.status)}</td>
          <td><label className="admin-check"><input type="checkbox" aria-label={`Use ${visibleText(account.displayName ?? account.id)} for new work`} checked={enabled} disabled={locked}
            onChange={(event) => { void write(event.currentTarget.checked ? { operation: "set", account: { ...account, enabled: true } } : { operation: "disable", accountId: account.id }) }} />Use for new work</label></td>
          <td className="admin-row-actions"><button disabled={locked} onClick={() => setEditing(account)}>Edit</button><button disabled={locked} onClick={() => setRemoving(account)}>Remove</button></td>
        </tr>
      })}</tbody></table></div>}
    <p className="admin-note">Provider sign-in and usage are not available here yet. Readiness is the engine’s last reported account state.</p>
    {editing !== undefined && state !== undefined && <section className="admin-settings-section" aria-label="Subscription settings"><h3>{editing === "new" ? "Add subscription" : "Subscription settings"}</h3>
      <form aria-label="Subscription settings" onSubmit={saveAccount} key={editing === "new" ? "new" : editing.id}>
        <fieldset disabled={locked}><label>Name<input name="name" defaultValue={editing === "new" ? "" : editing.displayName ?? editing.id} required /></label>
          {editing === "new" ? <label>Harness<select name="harness" required>{state.harnesses.map((row) => <option key={row.id} value={row.id}>{visibleText(row.id)}</option>)}</select></label> : <p>Harness: {visibleText(editing.harness)}</p>}
          <label>Private login home<input name="home" defaultValue={editing === "new" ? "" : editing.home ?? ""} pattern="/.*" /></label>
          <p className="admin-note">Optional absolute folder for this subscription’s existing private login. This does not start a sign-in.</p>
          <div className="admin-actions"><button type="submit">Save subscription</button><button type="button" onClick={() => setEditing(undefined)}>Cancel</button></div>
        </fieldset>
      </form>
      {editing !== "new" && <form ref={secretForm} aria-label="Subscription secret" onSubmit={(event) => { void saveSecret(event) }} key={`secret-${editing.id}`}>
        <fieldset disabled={locked}><legend>Write-only configuration</legend><label>Environment variable<input name="variable" required pattern="[A-Za-z_][A-Za-z0-9_]*" /></label>
          <label>New secret<input name="secret" type="password" autoComplete="off" required minLength={16} /></label><div><button type="submit">Set secret</button></div>
        </fieldset>
      </form>}
    </section>}
    {removing && <AdminConfirm title={`Remove ${visibleText(removing.displayName ?? removing.id)}?`} confirm="Remove subscription" busy={busy} disabled={offline} onCancel={() => setRemoving(undefined)} onConfirm={() => { void write({ operation: "remove", accountId: removing.id }) }}>
      <p>This removes the configured subscription. It does not sign out of the provider or stop its existing agents.</p>
    </AdminConfirm>}
  </section>
}
