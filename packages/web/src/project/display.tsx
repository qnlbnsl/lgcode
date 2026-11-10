import { useEffect, useRef, useState } from "react"
import * as Schema from "effect/Schema"
import { DisplayFrame, type DisplayOpen } from "@lgcode/contracts/project/display"
import "./display.css"

type Props = {
  readonly selection?: DisplayOpen
  readonly title: string
  readonly action: string
  readonly disabled?: boolean
  readonly inert?: boolean
  readonly viewport?: "phone" | "desktop"
  readonly onSessionExpired: () => void
}

// The owner endpoint supplies the private frame identity. Repository metadata
// and caller URLs never become iframe authority, and load is not a readiness
// oracle. Actual document/import/pixel proof remains a browser requirement.
export function IsolatedDisplay(props: Props) {
  return <DisplayContent key={JSON.stringify(props.selection)} {...props} />
}
function DisplayContent({ selection, title, action, disabled = false, inert = false, viewport, onSessionExpired }: Props) {
  const [frame, setFrame] = useState<DisplayFrame>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [unclosed, setUnclosed] = useState(false)
  const viewportHost = useRef<HTMLDivElement>(null)
  const current = useRef<DisplayFrame | undefined>(undefined)
  const alive = useRef(true), generation = useRef(0), expired = useRef(onSessionExpired)
  expired.current = onSessionExpired
  const release = async (value: DisplayFrame) => {
    const response = await fetch("/api/display/close", { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ id: value.id }),
      keepalive: true, signal: AbortSignal.timeout(10_000) })
    if (response.status === 401 && alive.current) expired.current()
    if (!response.ok) throw new Error("display close unconfirmed")
  }
  const close = async () => {
    generation.current++
    const value = current.current
    setFrame(undefined)
    if (value === undefined) { setBusy(false); return }
    setBusy(true)
    try {
      await release(value)
      if (current.current?.id === value.id) current.current = undefined
      if (alive.current) { setUnclosed(false); setMessage("") }
    } catch {
      if (alive.current) { setUnclosed(true); setMessage("Could not confirm closing the display. Retry closing before reopening.") }
    } finally { if (alive.current) setBusy(false) }
  }
  const open = async () => {
    if (busy || disabled || selection === undefined || current.current !== undefined) return
    const attempt = ++generation.current
    setBusy(true); setMessage("")
    try {
      const response = await fetch("/api/display/open", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify(selection), signal: AbortSignal.timeout(20_000) })
      if (response.status === 401) { if (alive.current) expired.current(); return }
      if (!response.ok) throw new Error("display unavailable")
      const text = await response.text()
      if (text.length > 16_384) throw new Error("display unavailable")
      const value = Schema.decodeUnknownSync(DisplayFrame, { onExcessProperty: "error" })(JSON.parse(text))
      const origin = new URL(value.displayOrigin), url = new URL(value.url)
      if (origin.origin !== value.displayOrigin || origin.protocol !== "https:" || origin.hostname === location.hostname
        || url.origin !== origin.origin || url.username || url.password || value.expiresAt <= Date.now()) throw new Error("display unavailable")
      if (!alive.current || attempt !== generation.current) { await release(value); return }
      current.current = value; setFrame(value)
    } catch { if (alive.current && attempt === generation.current) setMessage("The isolated display could not be opened. Check the display settings and connection, then retry.") }
    finally { if (alive.current && attempt === generation.current) setBusy(false) }
  }
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false; generation.current++
      const value = current.current; current.current = undefined
      // A pending open is allowed to finish so its real returned identity can
      // be closed, rather than losing that identity on a route change.
      if (value !== undefined) void release(value).catch(() => {})
    }
  }, [])
  useEffect(() => { if (disabled) void close() }, [disabled])
  useEffect(() => {
    if (frame === undefined) return
    const timer = setTimeout(() => { void close() }, Math.max(0, frame.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [frame])
  useEffect(() => {
    const host = viewportHost.current
    if (host === null || viewport === undefined || frame === undefined) return
    const width = viewport === "phone" ? 390 : 1440, height = viewport === "phone" ? 844 : 900
    const update = () => {
      const scale = Math.min(1, host.clientWidth / width)
      host.style.setProperty("--preview-width", `${width}px`)
      host.style.setProperty("--preview-height", `${height}px`)
      host.style.setProperty("--preview-scale", String(scale))
      host.style.setProperty("--preview-scaled-height", `${height * scale}px`)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [viewport, frame])
  return <section className="review-display" aria-label={title}>
    {frame === undefined ? <>
      <p role="status">{busy ? "Updating display…" : "No display is open."}</p>
      <button disabled={busy || disabled || selection === undefined || unclosed} onClick={() => void open()}>{action}</button>
    </> : <>
      <div ref={viewportHost} inert={inert} className={[inert ? "review-display-inert" : "", viewport === undefined ? "" : "review-display-viewport"].join(" ")}><iframe tabIndex={inert ? -1 : undefined} className="review-display-frame" title={title} src={frame.url} sandbox={selection?._tag === "editor" ? "allow-scripts allow-same-origin" : "allow-scripts"} referrerPolicy="same-origin" /></div>
      <button disabled={busy} onClick={() => void close()}>Close display</button>
    </>}
    {unclosed && <button disabled={busy} onClick={() => void close()}>Retry closing display</button>}
    {message && <p role="alert">{message}</p>}
  </section>
}
