import { useShellData } from "../data/ShellDataProvider.tsx"
import { shellHref, type ShellRoute } from "../routes.ts"
import { visibleText } from "../thread/text.tsx"
import { Empty, ReadState } from "./common.tsx"
import { ProjectTable } from "./HomePage.tsx"
import "./pages.css"

export function RepositoryTabs({ route }: { readonly route: Extract<ShellRoute, { page: "repository" }> }) {
  return <nav className="repository-tabs" aria-label="Repository views">
    <a href={shellHref({ page: "repository", repoId: route.repoId })} aria-current={route.tab !== "design" ? "page" : undefined}>Projects</a>
    <a href={shellHref({ page: "repository", repoId: route.repoId, tab: "design" })} aria-current={route.tab === "design" ? "page" : undefined}>Design</a>
  </nav>
}
export function RepositoryPage({ route }: { readonly route: ShellRoute }) {
  const { navigation } = useShellData()
  if (route.page !== "repository") return null
  if (navigation === undefined) return <section className="pages"><ReadState /></section>
  const repository = navigation.repositories.find((row) => row.repoId === route.repoId)
  if (repository === undefined) return <section className="pages"><Empty>This repository is unavailable.</Empty></section>
  const projects = navigation.projects.filter((row) => row.repoId === route.repoId)
  return <section className="pages" aria-label="Repository projects"><h1>{visibleText(repository.name)}</h1><RepositoryTabs route={route} />
    {projects.length ? <ProjectTable projects={projects} /> : <Empty>No projects in this repository yet.</Empty>}
  </section>
}
