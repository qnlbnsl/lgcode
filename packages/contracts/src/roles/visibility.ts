import type { VisibilityClass } from "../visibility.ts"
import { rolesEventTags } from "./events.ts"

export const rolesVisibility = Object.fromEntries(rolesEventTags.map((tag) => [tag, "owner-only"])) as
  Record<typeof rolesEventTags[number], VisibilityClass>
