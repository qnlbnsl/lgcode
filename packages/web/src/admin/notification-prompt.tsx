import { useEffect, useRef, useState } from "react"
import type { AlertSettings, RequestId } from "@lgtm/contracts"
import { useMutationDisabled, useShellData } from "../data/ShellDataProvider.tsx"
import { shellHref } from "../routes.ts"
import { readPreference, writePreference } from "../shell/preferences.ts"
import { commandOutcome, requestId, useAdminApi } from "./api.ts"
import "./admin.css"

export function NotificationPrompt({ onSessionExpired }: { readonly onSessionExpired: () => void }) {
  const data = useShellData()
  const offline = useMutationDisabled()
  const { run, busy, message, setMessage } = useAdminApi(onSessionExpired)
  const [settings, setSettings] = useState<AlertSettings>()
  const [readAt, setReadAt] = useState<number>()
  const [dismissed, setDismissed] = useState(() => readPreference("lgtm-phone-notifications-dismissed") === "true")
  const dismissal = useRef<RequestId | undefined>(undefined)
  const sequence = data.snapshot?.sequence
  const request = data.requests?.find((row) => row.status === "open" && row.holder._tag === "owner")
  useEffect(() => {
    if (!data.complete || request === undefined || dismissed || sequence === undefined || busy || readAt === sequence) return
    setReadAt(sequence)
    setSettings(undefined)
    void run((client) => client["client.alerts.settings"]({ requestId: requestId() })).then((reply) => {
      if (reply !== undefined) setSettings(reply)
    })
  }, [data.complete, request === undefined, dismissed, sequence, busy, readAt, run])
  if (!data.complete || request === undefined || settings === undefined || dismissed || settings.pushPromptDismissed || settings.carrier._tag !== "none") return null
  async function dismiss() {
    if (busy || offline) return
    dismissal.current ??= requestId()
    const reply = await run((client) => commandOutcome(client["client.alerts.prompt.dismiss"]({ requestId: dismissal.current! })))
    if (reply === undefined) return
    dismissal.current = undefined
    if (reply._tag === "acknowledged") {
      writePreference("lgtm-phone-notifications-dismissed", "true")
      setDismissed(true)
      setSettings((value) => value && { ...value, pushPromptDismissed: true })
      data.retry()
    } else {
      setReadAt(undefined)
      setMessage("The notification offer could not be dismissed. Review the refreshed settings before trying again.")
    }
  }
  return <aside className="admin-page admin-notification-prompt" aria-label="Phone notification offer">
    <p>A request is waiting for you. Would you like notifications?</p>
    <div className="admin-actions"><a href={`${shellHref({ page: "service", service: "settings" })}?focus=carrier`}>Set up notifications</a>
      <button disabled={busy || offline} onClick={() => { void dismiss() }}>{dismissal.current === undefined ? "Not now" : "Retry dismissal"}</button></div>
    {message && <p role="status">{message}</p>}
  </aside>
}
