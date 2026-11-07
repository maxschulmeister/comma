// The details of a thread: the screenshot of the element, and where the comment was made. Two layouts (view menu,
// or the project default `details`): a layer of the side panel (default), or a dialog over the page.
// They follow the open thread. Previous and next go through the panel list, so a reviewer can keep them open.
// A chunk of its own: it loads when the details open first.
import { CaretDownIcon, CaretUpIcon, CopyIcon, XIcon } from "@phosphor-icons/react"
import { cn } from "cn"
import { type CSSProperties, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react"
import { fileUrl } from "@/client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { describe, kindOf } from "@/lib/describe"
import { fullDate } from "@/lib/format"
import { getState, setState, useStore } from "@/store"
import type { Thread } from "@/types"
import { closeDetails, dialogFinalFocus } from "./details-state"
import { notify } from "./notices"
import { showThread, usePanelList } from "./panel"
import { threadLink } from "./thread"
import { nameOf } from "./user-name"
import { arrowKeys, panelSide } from "./view"

type Fact = { label: string; value: string; code?: boolean }

function facts(thread: Thread): { title: string; facts: Fact[] }[] {
  const c = thread.context
  const first = thread.comments[0]
  const groups = [
    {
      title: "Comment",
      facts: [
        { label: "By", value: nameOf(getState().users[thread.createdBy]) },
        { label: "Date", value: fullDate(thread.createdAt) },
        ...(first?.text ? [{ label: "Text", value: first.text }] : []),
      ],
    },
    {
      title: "Element",
      facts: [
        { label: "Type", value: kindOf(thread.anchor.tag) },
        ...(thread.anchor.text
          ? [{ label: "Text", value: thread.anchor.text.replace(/\s+/g, " ").slice(0, 200) }]
          : []),
        ...(thread.anchor.selectors.css ? [{ label: "Selector", value: thread.anchor.selectors.css, code: true }] : []),
      ],
    },
  ]
  if (!c) return groups
  const scroll = c.scroll
  return [
    ...groups,
    {
      title: "Page",
      facts: [
        { label: "Title", value: c.title || "No title" },
        { label: "URL", value: c.url, code: true },
        ...(scroll
          ? [
              {
                label: "Scrolled",
                value:
                  scroll.x || scroll.y
                    ? `${scroll.y} px down${scroll.x ? `, ${scroll.x} px right` : ""}`
                    : "Top of the page",
              },
            ]
          : []),
      ],
    },
    {
      title: "Device",
      facts: [
        { label: "Browser", value: c.browser },
        { label: "System", value: c.os },
        { label: "Window", value: `${c.viewport.width} × ${c.viewport.height}${c.dpr !== 1 ? ` at ${c.dpr}×` : ""}` },
        ...(c.theme ? [{ label: "Theme", value: c.theme === "dark" ? "Dark" : "Light" }] : []),
        ...(c.language ? [{ label: "Language", value: c.language }] : []),
        ...(c.timeZone ? [{ label: "Time zone", value: c.timeZone }] : []),
      ],
    },
  ]
}

/** Markdown for an issue tracker: the facts, the screenshot and a link back to the thread. */
function bugReport(thread: Thread) {
  const lines: string[] = []
  for (const group of facts(thread)) {
    lines.push(`**${group.title}**`)
    for (const f of group.facts) lines.push(`- ${f.label}: ${f.code ? `\`${f.value}\`` : f.value}`)
    lines.push("")
  }
  if (thread.screenshot) lines.push(`![Screenshot](${fileUrl(thread.screenshot)})`, "")
  lines.push(`[Open in comma](${threadLink(thread)})`)
  return lines.join("\n")
}

/** The open thread, its place in the panel list, and the way to the previous and next one. */
function useOpenThread() {
  const thread = useStore((s) => s.threads.find((t) => t.id === s.openThreadId))
  const list = usePanelList()
  // The details belong to the open thread. When it closes, they close too.
  useEffect(() => {
    if (!thread) setState({ detailsOpen: false })
  }, [thread])
  const index = thread ? list.findIndex((t) => t.id === thread.id) : -1
  return {
    thread,
    index,
    count: list.length,
    previous: index > 0 ? list[index - 1] : undefined,
    next: index >= 0 ? list[index + 1] : undefined,
  }
}

type Nav = ReturnType<typeof useOpenThread>

/** "2 of 5", and the previous and next buttons. */
function Stepper({ nav, go }: { nav: Nav; go: (thread: Thread | undefined) => void }) {
  return (
    <>
      {nav.index >= 0 && (
        <span className="px-1 text-muted-foreground text-xs tabular-nums">
          {nav.index + 1} of {nav.count}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous comment"
        title="Previous comment (↑)"
        // aria-disabled, not disabled: a focused button keeps the focus at the end of the list.
        aria-disabled={!nav.previous}
        className="aria-disabled:cursor-default aria-disabled:opacity-50"
        onClick={() => go(nav.previous)}
      >
        <CaretUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next comment"
        title="Next comment (↓)"
        // aria-disabled, not disabled: a focused button keeps the focus at the end of the list.
        aria-disabled={!nav.next}
        className="aria-disabled:cursor-default aria-disabled:opacity-50"
        onClick={() => go(nav.next)}
      >
        <CaretDownIcon />
      </Button>
    </>
  )
}

/** Opens the thread next to its pin. The focus stays in the details, so ↑ and ↓ go on. */
function goKeepingFocus(target: Thread | undefined, details: HTMLElement | null | undefined) {
  if (!target) return
  showThread(target, { keepPanel: true, focus: false })
  setTimeout(() => {
    const active = (details?.getRootNode() as ShadowRoot | undefined)?.activeElement
    if (details && !(active instanceof HTMLElement && details.contains(active))) {
      details.focus({ preventScroll: true })
    }
  })
}

/** ↑ and ↓ go to the previous and next thread. */
function stepKeys(event: KeyboardEvent<HTMLElement>, nav: Nav, go: (thread: Thread | undefined) => void) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
  go(event.key === "ArrowUp" ? nav.previous : nav.next)
  event.preventDefault()
}

function Facts({ thread }: { thread: Thread }) {
  return (
    <>
      {facts(thread).map((group) => (
        <section key={group.title} className="flex flex-col gap-1.5">
          <h3 className="font-medium text-muted-foreground text-xs">{group.title}</h3>
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-xs">
            {group.facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd className={f.code ? "break-all font-mono text-[11px]" : "text-pretty break-words"}>{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </>
  )
}

function CopyReport({ thread }: { thread: Thread }) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="self-start"
      onClick={() =>
        navigator.clipboard.writeText(bugReport(thread)).then(
          () => notify("Bug report copied"),
          () => notify("Could not copy. Allow the clipboard for this site."),
        )
      }
    >
      <CopyIcon />
      Copy as bug report
    </Button>
  )
}

/** The size on the page: the screenshot is made at the pixel ratio of the author's screen, up to 2. */
function pageSize(thread: Thread) {
  const shot = thread.screenshot
  const ratio = Math.min(thread.context?.dpr ?? 1, 2)
  return shot ? { width: shot.width / ratio, height: shot.height / ratio } : { width: 0, height: 0 }
}

// --- Layer of the side panel ---

export function DetailsLayer() {
  const nav = useOpenThread()
  const { toPage } = arrowKeys(useStore(panelSide))
  const [zoom, setZoom] = useState(false)
  const layerRef = useRef<HTMLElement>(null)
  // Opened from the list (the arrow away from the page), the focus was on the panel or an item under the layer: it
  // moves here.
  // Opened from the thread's info line, it stays there.
  useEffect(() => {
    const layer = layerRef.current
    const active = (layer?.getRootNode() as ShadowRoot | undefined)?.activeElement
    if (layer && (!active || layer.parentElement?.contains(active))) layer.focus({ preventScroll: true })
  }, [])
  const { thread } = nav
  if (!thread) return null

  const go = (target: Thread | undefined) => goKeepingFocus(target, layerRef.current)

  return (
    <section
      ref={layerRef}
      aria-label="Details"
      tabIndex={-1}
      data-slot="details"
      data-keeps-thread
      className="absolute inset-0 z-10 flex flex-col bg-background outline-none"
      onKeyDown={(event) => {
        if ((event.key === "Escape" && !event.defaultPrevented) || event.key === toPage) {
          event.preventDefault()
          closeDetails()
        } else stepKeys(event, nav, go)
      }}
    >
      {/* Close (×), not a back arrow: "back" has no direction when the panel can be on either side. */}
      <header className="flex h-11 shrink-0 items-center gap-1 border-b pr-1.5 pl-3">
        <h2 className="flex-1 font-medium text-sm">Details</h2>
        <Stepper nav={nav} go={go} />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close details"
          title="Close details (Esc)"
          onClick={closeDetails}
        >
          <XIcon />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        {thread.screenshot && (
          <button
            type="button"
            onClick={() => setZoom(true)}
            aria-label="Show the screenshot at full size"
            className="block shrink-0 cursor-zoom-in self-start overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img
              src={fileUrl(thread.screenshot)}
              alt="Screenshot of the element"
              width={thread.screenshot.width}
              height={thread.screenshot.height}
              className="block h-auto max-h-60 w-auto max-w-full object-contain"
            />
          </button>
        )}
        <Facts thread={thread} />
        <CopyReport thread={thread} />
      </div>
      {zoom && thread.screenshot && <Lightbox thread={thread} onClose={() => setZoom(false)} />}
    </section>
  )
}

/** The image at the size it had on the page. Larger than the window: it fits first, a click shows the full size. */
function Lightbox({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const size = pageSize(thread)
  const fits = size.width <= window.innerWidth - 48 && size.height <= window.innerHeight - 48
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-keeps-thread
        className="block max-h-[calc(100vh-2rem)] w-auto max-w-[calc(100vw-2rem)] overflow-auto bg-background p-0 sm:max-w-[calc(100vw-2rem)]"
      >
        <DialogTitle className="sr-only">Screenshot</DialogTitle>
        <Zoomable
          thread={thread}
          fits={fits}
          fit={{ maxWidth: "calc(100vw - 2rem)", maxHeight: "calc(100vh - 2rem)" }}
        />
      </DialogContent>
    </Dialog>
  )
}

/** The screenshot at its page size. If it does not fit, it fits first (`fit`), and a click toggles the full size. */
function Zoomable({ thread, fits, fit }: { thread: Thread; fits: boolean; fit: CSSProperties }) {
  const [full, setFull] = useState(false)
  const size = pageSize(thread)
  if (!thread.screenshot) return null
  return (
    <button
      type="button"
      disabled={fits}
      onClick={() => setFull(!full)}
      aria-label={full ? "Fit the screenshot" : "Show the screenshot at full size"}
      className={cn(
        "block outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
        full ? "cursor-zoom-out" : "cursor-zoom-in",
      )}
    >
      <img
        src={fileUrl(thread.screenshot)}
        alt="Screenshot of the element"
        className="block h-auto max-w-none"
        style={{
          width: full || fits ? size.width : undefined,
          aspectRatio: `${size.width} / ${size.height}`,
          ...(!fits && !full && fit),
        }}
      />
    </button>
  )
}

// --- Dialog over the page ---

export function DetailsDialog() {
  const nav = useOpenThread()
  const { toPage } = arrowKeys(useStore(panelSide))
  const paneRef = useRef<HTMLDivElement>(null)
  const [paneWidth, setPaneWidth] = useState(Number.POSITIVE_INFINITY)
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure again when the pane appears.
  useLayoutEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    const observer = new ResizeObserver(() => setPaneWidth(pane.clientWidth - 32))
    observer.observe(pane)
    return () => observer.disconnect()
  }, [!!nav.thread])
  const { thread } = nav
  if (!thread) return null
  const go = (target: Thread | undefined) =>
    goKeepingFocus(target, paneRef.current?.closest<HTMLElement>("[data-slot=dialog-content]"))

  return (
    <Dialog open onOpenChange={(open) => !open && closeDetails()}>
      <DialogContent
        data-keeps-thread
        showCloseButton={false}
        finalFocus={dialogFinalFocus}
        onKeyDown={(event) => {
          if (event.key === toPage) closeDetails()
          else stepKeys(event, nav, go)
        }}
        className="flex max-h-[calc(100vh-4rem)] w-[min(1000px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <header className="flex h-11 shrink-0 items-center gap-1 border-b pr-1.5 pl-4">
          <DialogTitle className="shrink-0 font-medium text-sm">Details</DialogTitle>
          <span className="min-w-0 flex-1 truncate px-2 text-muted-foreground text-xs">
            {describe(kindOf(thread.anchor.tag), thread.anchor.text)}
          </span>
          <Stepper nav={nav} go={go} />
          <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close details" />}>
            <XIcon />
          </DialogClose>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] max-[719px]:grid-cols-1 max-[719px]:overflow-y-auto">
          <div ref={paneRef} className="flex min-h-0 items-start justify-center overflow-auto bg-muted/50 p-4">
            {thread.screenshot ? (
              <div className="overflow-hidden rounded-md border bg-background shadow-sm">
                <Zoomable
                  key={thread.id}
                  thread={thread}
                  fits={pageSize(thread).width <= paneWidth}
                  fit={{ maxWidth: paneWidth }}
                />
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">No screenshot.</p>
            )}
          </div>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l p-4 max-[719px]:border-t max-[719px]:border-l-0">
            <Facts thread={thread} />
            <CopyReport thread={thread} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
