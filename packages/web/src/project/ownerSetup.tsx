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
  readonly onOpenLead?: (project: Project) => void
}

// Shell owns this accepted session. Setup neither constructs nor disposes it.
// The same accepted form stays mounted through Back. Shell keeps this setup
// mount hidden during Machines/Settings detours and mounts no second dialog.
export function OwnerSetup({ creation, disabled, onAddRepository, onSettings, onOpenLead, ...setup }: OwnerSetupProps) {
  return <Setup {...setup} {...(onOpenLead === undefined ? {} : { onOpenLead })} renderProject={(onCreated, checking) => <FirstProject creation={creation}
    disabled={disabled || checking} onAddRepository={onAddRepository} onSettings={onSettings} {...(onOpenLead === undefined ? {} : { onOpenLead })} onCreated={onCreated} />} />
}
function FirstProject(props: {
  readonly creation: NewProjectSession; readonly disabled?: boolean
  readonly onAddRepository: () => void; readonly onSettings: () => void; readonly onOpenLead?: (project: Project) => void; readonly onCreated: (project: Project) => void
}) {
  // Inline presentation does not need to open Home's native dialog. Refresh
  // uses the actual accepted controller and preserves any frozen attempt.
  useEffect(() => { void props.creation.refresh() }, [props.creation])
  return <NewProjectDialog {...props} presentation="setup" />
}
