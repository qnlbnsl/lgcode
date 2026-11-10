import { useEffect, type ComponentProps } from "react"
import type { Project } from "@lgcode/contracts"
import type { NewProjectSession } from "./creation.ts"
import { NewProjectDialog } from "./newProject.tsx"
import { Setup } from "./setup.tsx"

type OwnerSetupProps = Omit<ComponentProps<typeof Setup>, "renderProject"> & {
  readonly creation: NewProjectSession
  readonly disabled?: boolean
  readonly onAddRepository: () => void
  readonly onSettings: () => void
}

// Shell owns this accepted session. Setup neither constructs nor disposes it.
// The same accepted form stays mounted through Back. Shell keeps this setup
// mount hidden during Machines/Settings detours and mounts no second dialog.
export function OwnerSetup({ creation, disabled, onAddRepository, onSettings, ...setup }: OwnerSetupProps) {
  return <Setup {...setup} renderProject={(onCreated) => <FirstProject creation={creation}
    {...(disabled === undefined ? {} : { disabled })} onAddRepository={onAddRepository} onSettings={onSettings} onCreated={onCreated} />} />
}
function FirstProject(props: {
  readonly creation: NewProjectSession; readonly disabled?: boolean
  readonly onAddRepository: () => void; readonly onSettings: () => void; readonly onCreated: (project: Project) => void
}) {
  // Inline presentation does not need to open Home's native dialog. Refresh
  // uses the actual accepted controller and preserves any frozen attempt.
  useEffect(() => { void props.creation.refresh() }, [props.creation])
  return <NewProjectDialog {...props} presentation="setup" />
}
