import { useMemo, useRef, useState } from "react"
import { useShellData } from "../data/ShellDataProvider.tsx"
import { shellHref, type ShellRoute } from "../routes.ts"
import { visibleText } from "../thread/text.tsx"
import { useContainedFocus } from "./focus.ts"

export function QuickSwitcher({ close, navigate }: { readonly close: () => void; readonly navigate: (route: ShellRoute) => void }) {
  const { navigation, snapshot } = useShellData()
  const ref = useRef<HTMLDivElement>(null)
  useContainedFocus(true, ref, close)
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const items = useMemo(() => [
    ...(navigation?.repositories.map((row) => ({ name: row.name, detail: "Repository", route: { page: "repository", repoId: row.repoId } as ShellRoute })) ?? []),
    ...(navigation?.projects.filter((row) => row.archivedAt === undefined).map((row) => ({ name: row.name, detail: "Project", route: { page: "project", projectId: row.projectId, tab: "board" } as ShellRoute })) ?? []),
    ...(navigation?.teams.map((row) => ({ name: row.name, detail: navigation.projects.find((project) => project.projectId === row.projectId)?.name ?? "Team",
      route: { page: "project", projectId: row.projectId, teamId: row.teamId, tab: "chat" } as ShellRoute })) ?? []),
    ...(snapshot?.agents.map((row) => ({ name: row.name, detail: row.role, route: { page: "thread", agentId: row.agentId } as ShellRoute })) ?? [])
  ], [navigation, snapshot])
  const needle = query.trim().toLocaleLowerCase()
  const results = items.filter((item) => item.name.toLocaleLowerCase().includes(needle)).sort((a, b) =>
    Number(b.name.toLocaleLowerCase().startsWith(needle)) - Number(a.name.toLocaleLowerCase().startsWith(needle)) || a.name.localeCompare(b.name) || shellHref(a.route).localeCompare(shellHref(b.route)))
  const selected = Math.min(index, Math.max(0, results.length - 1))
  const choose = (route: ShellRoute) => { close(); navigate(route) }
  return <div className="modal-cover" onClick={close}>
    <div ref={ref} className="quick-dialog" role="dialog" aria-modal="true" aria-label="Find project or agent" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
      <input data-autofocus aria-label="Find project or agent" role="combobox" aria-expanded="true" aria-controls="quick-results" aria-autocomplete="list"
        aria-activedescendant={results.length ? `quick-result-${selected}` : undefined} value={query}
        placeholder="Find project or agent…" onChange={(event) => { setQuery(event.target.value); setIndex(0) }} onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            if (results.length) { const next = (selected + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length; setIndex(next); document.getElementById(`quick-result-${next}`)?.scrollIntoView?.({ block: "nearest" }) }
          } else if (event.key === "Enter" && results[selected]) { event.preventDefault(); choose(results[selected].route) }
        }} />
      <div id="quick-results" role="listbox" aria-label="Current destinations">
        {results.map((item, position) => <a key={shellHref(item.route)} id={`quick-result-${position}`} href={shellHref(item.route)} role="option" tabIndex={-1} aria-selected={position === selected}
          onMouseMove={() => setIndex(position)} onClick={(event) => { event.preventDefault(); choose(item.route) }}><strong>{visibleText(item.name)}</strong><small>{visibleText(item.detail)}</small></a>)}
        {!results.length && <p>No matching projects or agents.</p>}
      </div>
    </div>
  </div>
}
