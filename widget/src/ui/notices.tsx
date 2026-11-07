import { XIcon } from "@phosphor-icons/react"
import { useEffect, useRef } from "react"
import { refresh } from "@/client"
import { Button } from "@/components/ui/button"
import { NARROW, useMedia } from "@/lib/media"
import { getState, type Notice, setState, useStore } from "@/store"
import { panelLeftEdge, panelRightEdge } from "./panel"
import { panelSide } from "./view"

let nextId = 0

/** Shows a short message: what an action did ("Thread resolved"), with an optional action ("Undo"). */
export function notify(text: string, action?: Notice["action"]) {
  setState({ notice: { id: ++nextId, text, action } })
  return nextId
}

/** A pin move that did not reach the server. The pin is back at its old place. */
export const tellMoveFailed = () => notify("Could not move the comment. Try again.")

const dismiss = (id: number) => {
  if (getState().notice?.id === id) setState({ notice: null })
}

/**
 * One status region that is always there, so screen readers announce each message.
 * A plain message goes after 4 s. A message with an action stays until it is closed or replaced.
 */
export function Notices() {
  const notice = useStore((s) => s.notice)
  // Above the toolbar, on the panel's side. With the panel open: on the page, beside the panel.
  const side = useStore(panelSide)
  const leftEdge = useStore(panelLeftEdge)
  const rightEdge = useStore(panelRightEdge)
  const narrow = useMedia(NARROW)

  useEffect(() => {
    if (!notice || notice.action) return
    const timer = setTimeout(() => dismiss(notice.id), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  // The comments loaded, then updates failed: they can be out of date. Polling goes on; the message goes when an
  // update works again.
  const updatesFailed = useStore((s) => s.loaded && s.loadFailed)
  const updatesNotice = useRef<number | null>(null)
  useEffect(() => {
    if (updatesFailed) {
      updatesNotice.current = notify("Cannot reach comma. Comments may be out of date.", {
        label: "Try again",
        run: () => void refresh(),
      })
    } else if (updatesNotice.current !== null) {
      dismiss(updatesNotice.current)
      updatesNotice.current = null
    }
  }, [updatesFailed])

  return (
    <div
      role="status"
      data-slot="notices"
      className="pointer-events-none fixed bottom-16 max-[639px]:left-1/2 max-[639px]:-translate-x-1/2"
      style={narrow ? undefined : side === "left" ? { left: leftEdge + 16 } : { right: rightEdge + 16 }}
    >
      {notice && (
        <div
          // A new message is a new element, so it comes up again.
          key={notice.id}
          className="comma-notice pointer-events-auto flex items-center gap-1 rounded-full bg-foreground py-1 pr-1 pl-3.5 text-background text-sm shadow-lg"
        >
          <span className="whitespace-nowrap">{notice.text}</span>
          {notice.action && (
            <Button
              size="xs"
              variant="ghost"
              data-notice-action
              className="text-background underline underline-offset-2 hover:bg-background/15 hover:text-background"
              onClick={() => {
                const run = notice.action?.run
                dismiss(notice.id)
                run?.()
              }}
            >
              {notice.action.label}
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            className="rounded-full text-background hover:bg-background/15 hover:text-background"
            aria-label="Dismiss"
            onClick={() => dismiss(notice.id)}
          >
            <XIcon />
          </Button>
        </div>
      )}
    </div>
  )
}
