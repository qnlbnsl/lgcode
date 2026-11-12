// Lucide Contributors 2022; portions copyright Cole Bemis 2013–2022 (Feather).
// Paths copied from lucide-static 0.460.0 icons/*.svg (ISC; Feather portions MIT).
// Reused from the older web mock's design/workbench.html and design/workbench.js, at commit
// bef4b1090a8dc783075f835e7c5e90dbc3b8aad9. See third_party/lucide/README.md and LICENSE.
import type { ReactNode } from "react"

const paths = {
  "arrow-left": <><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></>,
  "chevron": <><path d="m9 18 6-6-6-6"/></>,
  "chevron-down": <><path d="m6 9 6 6 6-6"/></>,
  "branch": <><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></>,
  "check": <><path d="M20 6 9 17l-5-5"/></>,
  "x": <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>,
  "command": <><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></>,
  "home": <><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></>,
  "search": <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>,
  "phone": <><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></>,
  "machines": <><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></>,
  "subscriptions": <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
  "settings": <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></>,
  "panel": <><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></>,
  "menu": <><path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/></>,
  "bell": <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>,
  "refresh": <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></>,
} satisfies Record<string, ReactNode>
export type IconName = keyof typeof paths
export function Icon({ name }: { readonly name: IconName }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}
