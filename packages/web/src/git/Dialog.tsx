import { useEffect, useRef, type ReactNode } from "react"

export function GitDialog({ title, close, children, className = "" }: { readonly title: string; readonly close: () => void; readonly children: ReactNode; readonly className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const dismiss = useRef(close); dismiss.current = close
  useEffect(() => {
    const opener = document.activeElement
    ref.current?.showModal()
    return () => { ref.current?.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true }) }
  }, [])
  return <dialog ref={ref} className={`git-dialog ${className}`} aria-label={title} onCancel={(event) => { event.preventDefault(); dismiss.current() }}>
    <header><h2>{title}</h2><button aria-label={`Close ${title}`} onClick={close}>Close</button></header>{children}
  </dialog>
}
