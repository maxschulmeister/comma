import { ArrowClockwiseIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react"
import { cn } from "cn"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { refresh } from "@/client"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { getState, type Notice, type PanelSide, setState, useStore } from "@/store"

let nextId = 0

/** Shows a short message in the toolbar: what an action did ("Thread resolved"), with an optional action (Undo). */
export function notify(text: string, extra: Pick<Notice, "action" | "stay"> = {}) {
  setState({ notice: { id: ++nextId, text, ...extra } })
  return nextId
}

/** A pin move that did not reach the server. The pin is back at its old place. */
export const tellMoveFailed = () => notify("Could not move")

const dismiss = (id: number) => {
  if (getState().notice?.id === id) setState({ notice: null })
}

const ACTIONS = {
  undo: { label: "Undo", Icon: ArrowCounterClockwiseIcon },
  retry: { label: "Try again", Icon: ArrowClockwiseIcon },
}

/**
 * The messages, in the toolbar: on the side away from the corner, so the toolbar grows away from it and its buttons do
 * not move. One status region that is always there, so screen readers announce each message.
 * A message goes after 4 s, one with Undo after 8 s, but not while the mouse is on it or the keyboard focus is in it.
 * The area opens and closes with its width; the content stays in place on the buttons' side, and the last message
 * stays while the area closes.
 */
export function Notices({ side }: { side: PanelSide }) {
  const notice = useStore((s) => s.notice)
  const last = useRef(notice)
  if (notice) last.current = notice
  const shown = last.current
  const content = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    setWidth(notice ? (content.current?.scrollWidth ?? 0) : 0)
  }, [notice])

  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!notice || notice.stay || hovered || focused) return
    const timer = setTimeout(
      () => {
        // The focus is on its button (Resolve moves it there): it goes to the Comments button, not to the page.
        const root = content.current?.getRootNode() as ShadowRoot | undefined
        if (root?.activeElement && content.current?.contains(root.activeElement))
          root.querySelector<HTMLElement>("[data-panel-button]")?.focus()
        dismiss(notice.id)
      },
      notice.action ? 8000 : 4000,
    )
    return () => clearTimeout(timer)
  }, [notice, hovered, focused])

  // The comments loaded, then updates failed: they can be out of date. Polling goes on; the message goes when an
  // update works again.
  const updatesFailed = useStore((s) => s.loaded && s.loadFailed)
  const updatesNotice = useRef<number | null>(null)
  useEffect(() => {
    if (updatesFailed) {
      updatesNotice.current = notify("Cannot reach comma", {
        action: { kind: "retry", run: () => void refresh() },
        stay: true,
      })
    } else if (updatesNotice.current !== null) {
      dismiss(updatesNotice.current)
      updatesNotice.current = null
    }
  }, [updatesFailed])

  const action = shown?.action && ACTIONS[shown.action.kind]
  const parts = [
    <div key="message" className="flex items-center gap-1 ps-3 pe-0.5">
      <span className="max-w-36 truncate">{shown?.text}</span>
      {shown && action && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-full"
                aria-label={action.label}
                data-notice-action
                onClick={() => {
                  dismiss(shown.id)
                  shown.action?.run()
                }}
              />
            }
          >
            <action.Icon />
          </TooltipTrigger>
          <TooltipContent>{action.label}</TooltipContent>
        </Tooltip>
      )}
    </div>,
    <div key="divider" aria-hidden className="mx-1 h-5 w-px bg-foreground/10" />,
  ]

  return (
    <div
      role="status"
      data-slot="notices"
      // The toolbar's gap is in the content, so the closed area takes no room.
      className={cn(
        "flex shrink-0 overflow-hidden transition-[width] duration-200 ease-out",
        side === "left" ? "-ms-0.5 justify-start" : "-me-0.5 justify-end",
      )}
      style={{ width }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={(event) => setFocused((event.target as Element).matches(":focus-visible"))}
      onBlur={() => setFocused(false)}
    >
      <div
        ref={content}
        className={cn(
          "flex w-max shrink-0 items-center whitespace-nowrap text-sm transition-[opacity,visibility] duration-200 ease-out",
          !notice && "invisible opacity-0",
        )}
      >
        {side === "left" ? parts.toReversed() : parts}
      </div>
    </div>
  )
}
