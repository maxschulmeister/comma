import { XIcon } from "@phosphor-icons/react"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { NARROW, useMedia } from "@/lib/media"
import { getState, type Notice, setState, useStore } from "@/store"
import { panelRightEdge } from "./panel"

let nextId = 0

/** Shows a short message: what an action did ("Thread resolved"), with an optional action ("Undo"). */
export function notify(text: string, action?: Notice["action"]) {
  setState({ notice: { id: ++nextId, text, action } })
}

const dismiss = (id: number) => {
  if (getState().notice?.id === id) setState({ notice: null })
}

/**
 * One status region that is always there, so screen readers announce each message.
 * A plain message goes after 4 s. A message with an action stays until it is closed or replaced.
 */
export function Notices() {
  const notice = useStore((s) => s.notice)
  const panelEdge = useStore(panelRightEdge)
  const narrow = useMedia(NARROW)

  useEffect(() => {
    if (!notice || notice.action) return
    const timer = setTimeout(() => dismiss(notice.id), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  return (
    <div
      role="status"
      data-slot="notices"
      className="pointer-events-none fixed bottom-16 max-[639px]:left-1/2 max-[639px]:-translate-x-1/2"
      style={{ right: narrow ? undefined : panelEdge + 16 }}
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
