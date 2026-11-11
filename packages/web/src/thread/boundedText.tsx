import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { DataText, visibleText } from "./text.tsx"

export const textPreview = (text: string) => text.split("\n", 13).slice(0, 12).join("\n").slice(0, 16_384)

// Bound the ordinary conversation surface. Full text is mounted only by an
// explicit action and stays a single plain block for browser Find and Copy.
export function BoundedText({ text, label = "Message" }: { readonly text: string; readonly label?: string }) {
  const [full, setFull] = useState(false)
  const [copied, setCopied] = useState("")
  // Bound single-line output too: twelve lines alone can still mount megabytes.
  const preview = textPreview(text)
  const truncated = preview.length < text.length
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied("Copied.") }
    catch { setCopied("Copy unavailable. Open in full to select the text.") }
  }
  return <><DataText text={truncated ? preview : text} />
    {truncated && <><p>{visibleText(label)} · {new TextEncoder().encode(text).byteLength.toLocaleString()} bytes · preview</p>
      <button type="button" onClick={() => setFull(true)}>Open {visibleText(label)} in full</button>
      <button type="button" onClick={() => { void copy() }}>Copy {visibleText(label)}</button>
      {copied && <p role="status">{copied}</p>}
      {full && <FullText text={text} label={label} close={() => setFull(false)} />}
    </>}
  </>
}
function FullText({ text, label, close }: { readonly text: string; readonly label: string; readonly close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    const node = dialog.current, surface = node?.closest(".conversation")
    if (!node || !surface) return
    const fit = () => {
      const rect = surface.getBoundingClientRect()
      Object.assign(node.style, { inset: "auto", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
    }
    fit()
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(fit)
    observer?.observe(surface)
    window.addEventListener("resize", fit)
    return () => { observer?.disconnect(); window.removeEventListener("resize", fit) }
  }, [])
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.showModal(); heading.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return <dialog className="full-thread-text" ref={dialog} aria-label={`${visibleText(label)} in full`} onCancel={(event) => { event.preventDefault(); close() }}>
    <header><h2 tabIndex={-1} ref={heading}>{visibleText(label)}</h2><button onClick={close}>Back to conversation</button></header>
    <DataText text={text} />
  </dialog>
}
