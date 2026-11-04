import { useEffect, useRef, useState, type FormEvent } from "react"
import { Situation } from "./situation.tsx"
import { Alerts } from "./admin/alerts.tsx"
import { Settings } from "./admin/settings.tsx"

type Session = "checking" | "login" | "owner" | "unavailable"
type Page = "situation" | "alerts" | "settings"
function currentPage(): Page {
  const page = new URLSearchParams(location.search).get("page")
  return page === "alerts" || page === "settings" ? page : "situation"
}

export function App() {
  const [session, setSession] = useState<Session>("checking")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [probe, setProbe] = useState(0)
  const [page, setPage] = useState(currentPage)
  const action = useRef<AbortController | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/session", {
      method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal
    }).then((response) => {
      if (!controller.signal.aborted) {
        setSession(response.ok ? "owner" : response.status === 401 ? "login" : "unavailable")
      }
    }).catch(() => {
      if (!controller.signal.aborted) setSession("unavailable")
    })
    return () => controller.abort()
  }, [probe])

  useEffect(() => () => action.current?.abort(), [])

  useEffect(() => {
    const change = () => setPage(currentPage())
    addEventListener("popstate", change)
    return () => removeEventListener("popstate", change)
  }, [])

  function sessionExpired() {
    setMessage("Your session ended. Log in again.")
    setSession("login")
  }

  function logIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (action.current !== undefined) return
    const password = event.currentTarget.elements.namedItem("password") as HTMLInputElement
    // Keep the password out of React state and clear the control before I/O.
    // Only fetch owns the request body after this synchronous handler returns.
    const body = JSON.stringify({ password: password.value })
    password.value = ""
    const controller = new AbortController()
    action.current = controller
    setBusy(true)
    setMessage("")
    void fetch("/api/login", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body, signal: controller.signal
    }).then((response) => {
      if (controller.signal.aborted) return
      if (response.ok) setSession("owner")
      else setMessage(response.status === 401 ? "The password was not accepted." : "Log in is unavailable. Try again.")
    }).catch(() => {
      if (!controller.signal.aborted) setMessage("Could not reach Shephrd. Try again.")
    }).finally(() => {
      if (!controller.signal.aborted) {
        action.current = undefined
        setBusy(false)
      }
    })
  }

  function logOut() {
    if (action.current !== undefined) return
    const controller = new AbortController()
    action.current = controller
    setBusy(true)
    setMessage("")
    void fetch("/api/logout", {
      method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal
    }).then((response) => {
      if (controller.signal.aborted) return
      if (response.ok || response.status === 401) setSession("login")
      else setMessage("Log out failed. Try again.")
    }).catch(() => {
      if (!controller.signal.aborted) setMessage("Could not log out. Try again.")
    }).finally(() => {
      if (!controller.signal.aborted) {
        action.current = undefined
        setBusy(false)
      }
    })
  }

  return <main>
    <header>
      <h1>Shephrd</h1>
      {session === "owner" && <button aria-label="Log out" disabled={busy} onClick={logOut}>Log out</button>}
    </header>
    {message && <p role="alert">{message}</p>}
    {session === "checking" && <p role="status">Checking your session…</p>}
    {session === "unavailable" && <section aria-label="Connection unavailable">
      <p role="alert">Could not check your session.</p>
      <button onClick={() => { setSession("checking"); setProbe((value) => value + 1) }}>Try again</button>
    </section>}
    {session === "login" && <form aria-label="Log in" onSubmit={logIn}>
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="off" required disabled={busy} />
      <button type="submit" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
    </form>}
    {session === "owner" && <>
      <nav aria-label="Pages">
        {([
          ["situation", "/", "Situation"], ["alerts", "/?page=alerts", "Alerts"], ["settings", "/?page=settings", "Settings"]
        ] as const).map(([target, href, label]) => <a key={href} href={href}
          aria-current={page === target ? "page" : undefined}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            history.pushState(null, "", href)
            setPage(target)
          }}>{label}</a>)}
      </nav>
      {page === "alerts" ? <Alerts onSessionExpired={sessionExpired} />
        : page === "settings" ? <Settings onSessionExpired={sessionExpired} />
        : <Situation onSessionExpired={sessionExpired} />}
    </>}
  </main>
}
