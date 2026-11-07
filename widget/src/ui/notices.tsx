import { ArrowClockwiseIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react"
import { cn } from "cn"
import { useEffect, useRef, useState } from "react"
import { refresh } from "@/client"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { getState, type Notice, setState, useStore } from "@/store"

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
 * The messages, beside the toolbar (see Toolbar). One status region that is always there, so screen readers announce
 * each message. `floating`: a pill over the page. Else plain text in the open panel's bottom row. `from`: the toolbar's
 * side, where a message comes from.
 * A message goes after 4 s, one with Undo after 8 s, but not while the mouse is on it or the keyboard focus is in it.
 * The last message stays while it fades out.
 */
export function Notices({ floating, from }: { floating: boolean; from: "left" | "right" | "below" }) {
  const notice = useStore((s) => s.notice)
  const last = useRef(notice)
  if (notice) last.current = notice
  const shown = last.current
  const content = useRef<HTMLDivElement>(null)

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
  return (
    <div
      role="status"
      data-slot="notices"
      className="flex min-w-0"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={(event) => setFocused((event.target as Element).matches(":focus-visible"))}
      onBlur={() => setFocused(false)}
    >
      <div
        ref={content}
        className={cn(
          // As high as the toolbar, and ↶ as large as its buttons: the two pills are a pair.
          "pointer-events-auto flex h-10 min-w-0 items-center gap-0.5 whitespace-nowrap text-xs transition-[opacity,translate,visibility] duration-200 ease-out",
          floating && "rounded-full bg-background shadow-lg ring-1 ring-foreground/10",
          floating ? (action ? "ps-3.5 pe-1" : "px-3.5") : "px-2",
          // Hidden: it fades toward the toolbar, and comes out of it.
          !notice && "invisible opacity-0",
          !notice && floating && { left: "-translate-x-1", right: "translate-x-1", below: "translate-y-1" }[from],
        )}
      >
        <span className="truncate">{shown?.text}</span>
        {shown && action && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
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
      </div>
    </div>
  )
}
