import { useEffect, useRef, type ReactNode } from "react"

export function AdminConfirm({ title, children, confirm, busy, disabled = false, onCancel, onConfirm }: {
  readonly title: string
  readonly children: ReactNode
  readonly confirm: string
  readonly busy: boolean
  readonly disabled?: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    dialog.current!.showModal()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return <dialog ref={dialog} className="admin-dialog" aria-labelledby="admin-confirm-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}>
    <h2 id="admin-confirm-title">{title}</h2>
    {children}
    <div className="admin-actions">
      <button type="button" disabled={busy} onClick={onCancel} autoFocus>Cancel</button>
      <button type="button" className="admin-primary" disabled={busy || disabled} onClick={onConfirm}>{confirm}</button>
    </div>
  </dialog>
}
