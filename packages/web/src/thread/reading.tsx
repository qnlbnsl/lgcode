import { useConversation } from "../data/ShellDataProvider.tsx"
import { useLayoutEffect, useRef, useState } from "react"
import { type ConversationIdentity } from "./conversationState.tsx"

export function useConversationReading(identity: ConversationIdentity, revision: unknown, loaded: boolean) {
  const { entry } = useConversation(identity)
  const scroller = useRef<HTMLDivElement>(null)
  const [away, setAway] = useState(entry.state.reading?.bottom === false)
  // Each visible reader keeps its own anchor. A simultaneous dock's scroll
  // must not move this reader; the shared value is for the next navigation.
  const local = useRef({ entry, reading: entry.state.reading })
  if (local.current.entry !== entry) local.current = { entry, reading: entry.state.reading }
  const save = () => {
    const node = scroller.current
    if (!node) return
    const bottom = node.scrollHeight - node.scrollTop - node.clientHeight <= 24
    const top = node.getBoundingClientRect().top
    const first = [...node.querySelectorAll<HTMLElement>("[data-sequence]")].find((row) => row.getBoundingClientRect().bottom > top)
    const reading = { bottom, offset: first ? first.getBoundingClientRect().top - top : node.scrollTop,
      ...(first?.dataset.sequence === undefined ? {} : { sequence: Number(first.dataset.sequence) }) }
    local.current.reading = reading
    entry.update({ reading })
    setAway(!bottom)
  }
  const restore = () => {
    const node = scroller.current
    if (!node || !loaded) return
    const saved = local.current.reading
    if (!saved || saved.bottom) node.scrollTop = node.scrollHeight
    else {
      const anchor = [...node.querySelectorAll<HTMLElement>("[data-sequence]")].find((row) => Number(row.dataset.sequence) === saved.sequence)
      if (anchor) node.scrollTop += anchor.getBoundingClientRect().top - node.getBoundingClientRect().top - saved.offset
    }
    setAway(saved?.bottom === false)
  }
  useLayoutEffect(() => {
    restore()
  }, [entry, revision, loaded])
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(restore)
    observer.observe(node)
    return () => observer.disconnect()
  }, [entry, loaded])
  const latest = () => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; save() }
  return { scroller, onScroll: save, away, latest }
}
