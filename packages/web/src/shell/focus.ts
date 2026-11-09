import { useEffect, type RefObject } from "react"

export function shortcutInField(target: EventTarget | null) {
  return target instanceof Element && target.closest("input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[data-terminal],.xterm") !== null
}
export function useContainedFocus(open: boolean, element: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open || element.current === null) return
    const root = element.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const focusable = () => [...root.querySelectorAll<HTMLElement>("a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex='0']")]
      .filter((item) => !item.closest("[hidden],[inert]") && item.getAttribute("aria-hidden") !== "true" && getComputedStyle(item).display !== "none" && getComputedStyle(item).visibility !== "hidden")
    ;(root.querySelector<HTMLElement>("[data-autofocus]") ?? focusable()[0] ?? root).focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close() }
      if (event.key === "Tab") {
        const items = focusable()
        const index = items.indexOf(document.activeElement as HTMLElement)
        if (event.shiftKey ? index <= 0 : index < 0 || index === items.length - 1) {
          event.preventDefault()
          ;(event.shiftKey ? items.at(-1) : items[0])?.focus()
        }
      }
    }
    const focusin = (event: FocusEvent) => { if (event.target instanceof Node && !root.contains(event.target)) (focusable()[0] ?? root).focus() }
    document.addEventListener("keydown", keydown, true)
    document.addEventListener("focusin", focusin)
    return () => {
      document.removeEventListener("keydown", keydown, true)
      document.removeEventListener("focusin", focusin)
      if (previous?.isConnected) previous.focus()
    }
  }, [open, element, close])
}
