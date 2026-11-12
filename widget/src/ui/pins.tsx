import { cn } from "cn"
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { type Anchor, anchorBox, type Box } from "@/anchor"
import { createThread, moveThread, uploadFile } from "@/client"
import { Button } from "@/components/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Popover, PopoverContent } from "@/components/ui/popover"
import { closeDraft, loadDraft, newDraft, newDraftKey, saveDraft } from "@/drafts"
import { focusMovesTo, fromWidgetPart, pressInsideWidget } from "@/lib/dom"
import { pageContext } from "@/lib/env"
import { plural, timeAgo } from "@/lib/format"
import { shrinkImage } from "@/lib/image"
import { NARROW, useMedia } from "@/lib/media"
import { pageBox, showsPin, useLayoutTick, useResolved } from "@/live"
import { type Draft, getState, type State, setState, threadTakesFocus, useStore } from "@/store"
import type { Thread } from "@/types"
import { Composer } from "./composer"
import { focusOpenItem } from "./details-state"
import { takeFocusOnClose } from "./focus-on-close"
import { tellMoveFailed } from "./notices"
import { movedAnchor } from "./overlay"
import { SignInForm } from "./sign-in"
import { type Placement, ThreadView } from "./thread"
import { UserAvatar } from "./user-avatar"
import { nameOf, UserName } from "./user-name"
import { arrowKeys, detailsMode, panelLeftEdge, panelRightEdge, panelSide } from "./view"

/** Elements a thread popover can attach to: pins and clusters on the page, items in the panel. */
export const pinElements = new Map<string, HTMLElement>()
export const panelElements = new Map<string, HTMLElement>()

// The open thread's popover follows when its panel item appears (a link can open it before the list renders).
let anchorVersion = 0
const anchorListeners = new Set<() => void>()
export function setPanelElement(id: string, el: HTMLElement | null) {
  if (!el) {
    panelElements.delete(id)
    return
  }
  if (panelElements.get(id) === el) return
  panelElements.set(id, el)
  if (id === getState().openThreadId) {
    anchorVersion++
    for (const listener of anchorListeners) listener()
  }
}
const useAnchorVersion = () =>
  useSyncExternalStore(
    (listener) => {
      anchorListeners.add(listener)
      return () => anchorListeners.delete(listener)
    },
    () => anchorVersion,
  )

const PIN = 28
const CLUSTER_DISTANCE = 24

type Item = { thread: Thread; box: Box; x: number; y: number }

// The pin tip: the point, or the bottom-right corner of a region.
const tip = (box: Box) => ({ x: box.x + box.width, y: box.y + box.height })

// Pins closer than CLUSTER_DISTANCE merge. The open thread always has its own pin.
function cluster(items: Item[], keep: string | null) {
  const groups: { x: number; y: number; items: Item[] }[] = []
  for (const item of items) {
    const group =
      item.thread.id === keep
        ? undefined
        : groups.find(
            (g) => g.items[0]?.thread.id !== keep && Math.hypot(g.x - item.x, g.y - item.y) < CLUSTER_DISTANCE,
          )
    if (group) group.items.push(item)
    else groups.push({ x: item.x, y: item.y, items: [item] })
  }
  return groups
}

/**
 * Opens a thread. A draft with text stays as a pin. `focus: false`: the focus stays where it is (↑ ↓ in the panel list select a thread).
 * `fromList`: opened from the panel list, so Escape in the thread goes back there.
 */
export const openThread = (id: string, { focus = true, fromList = false } = {}) => {
  closeDraft()
  setState({ openThreadId: id, draftMove: null, threadFocus: focus, threadFromList: fromList })
}

// The open thread's comment list, for focusOpenThread.
let threadList: RefObject<HTMLDivElement | null> | null = null

/** Moves the focus into the open thread: its reply box, or its comment list (Enter, or the arrow toward the page, in
 * the panel list). */
export function focusOpenThread() {
  const list = threadList?.current
  const reply = list
    ?.closest("[data-slot=popover-content]")
    ?.querySelector<HTMLElement>("[data-slot=composer] .ProseMirror")
  ;(reply ?? list)?.focus()
}

export function PinsLayer() {
  const threads = useStore((s) => s.threads)
  const page = useStore((s) => s.page)
  const pinsVisible = useStore((s) => s.pinsVisible)
  const openThreadId = useStore((s) => s.openThreadId)
  const draft = useStore((s) => s.draft)
  const draftMove = useStore((s) => s.draftMove)
  // On narrow screens the panel covers the page: pins behind it take no focus.
  const panelOpen = useStore((s) => s.panelOpen)
  const narrow = useMedia(NARROW)
  const covered = panelOpen && narrow
  const resolved = useResolved()
  useLayoutTick()
  const [hovered, setHovered] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)

  const items: Item[] = []
  const view = { page, pinsVisible, openThreadId }
  for (const thread of threads) {
    if (!showsPin(view, thread)) continue
    const el = resolved.get(thread.id)
    const box = el && pageBox(thread.anchor, el)
    if (!box) continue
    const point = drag?.id === thread.id ? drag : tip(box)
    items.push({ thread, box, x: point.x, y: point.y })
  }
  const groups = cluster(items, openThreadId)
  const regions = items.filter((i) => i.thread.anchor.rect && (i.thread.id === openThreadId || i.thread.id === hovered))
  // An open element pin outlines its element, so readers see what the comment is about.
  const open = items.find((i) => i.thread.id === openThreadId && !i.thread.anchor.rect)
  const openElement = open && resolved.get(open.thread.id)

  return (
    <div className="absolute top-0 left-0" data-slot="pins" inert={covered}>
      {regions.map(({ thread, box }) => (
        <Region key={thread.id} box={box} />
      ))}
      {openElement && <ElementOutline el={openElement} />}
      {groups.map((group) =>
        group.items.length === 1 && group.items[0] ? (
          <Pin
            key={group.items[0].thread.id}
            item={group.items[0]}
            open={group.items[0].thread.id === openThreadId}
            onHover={setHovered}
            onDrag={setDrag}
          />
        ) : (
          <Cluster key={group.items.map((i) => i.thread.id).join()} x={group.x} y={group.y} items={group.items} />
        ),
      )}
      {draft && <DraftComposer draft={draft} />}
      {draftMove && <DraftMovePrompt move={draftMove} />}
      <ThreadPopover />
    </div>
  )
}

function Region({ box }: { box: Box }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/10"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    />
  )
}

function ElementOutline({ el }: { el: Element }) {
  const r = el.getBoundingClientRect()
  return (
    <div
      aria-hidden
      data-slot="anchor-outline"
      className="pointer-events-none absolute rounded-[2px] outline-2 outline-primary outline-offset-2 outline-solid"
      style={{ left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height }}
    />
  )
}

const pinShape =
  "absolute flex items-center justify-center rounded-full rounded-bl-none bg-background p-[3px] shadow-md ring-1 ring-foreground/15"

function Pin({
  item,
  open,
  onHover,
  onDrag,
}: {
  item: Item
  open: boolean
  onHover: (id: string | null) => void
  onDrag: (drag: { id: string; x: number; y: number } | null) => void
}) {
  const { thread } = item
  const me = useStore((s) => s.session?.user)
  const author = useStore((s) => s.users[thread.createdBy])
  const first = thread.comments[0]
  const replies = thread.comments.length - 1
  const dragged = useRef(false)
  const [preview, setPreview] = useState(false)
  const canMove = !!me && me.id === thread.createdBy

  // Drag to move. Only the thread author. A click without movement opens the thread.
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragged.current = false
    if (!canMove || event.button !== 0) return
    const start = { x: event.clientX, y: event.clientY }
    const move = (e: PointerEvent) => {
      if (!dragged.current && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return
      dragged.current = true
      onDrag({ id: thread.id, x: e.clientX + window.scrollX, y: e.clientY + window.scrollY })
    }
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
      if (!dragged.current || e.type === "pointercancel") return onDrag(null)
      const anchor = movedAnchor(thread, e.clientX, e.clientY)
      moveThread(thread, getState().page, anchor)
        .catch(tellMoveFailed)
        .finally(() => onDrag(null))
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  const label = `Comment by ${nameOf(author)}${thread.unread ? ", unread" : ""}: ${first?.text.slice(0, 80) ?? ""}`

  // No preview while the thread is open: it would also take the Escape key. The card stays mounted, so Base UI ends
  // its exit animation: unmounted earlier, it came back stuck when the thread closed.
  return (
    <HoverCard
      open={preview && !open}
      onOpenChange={(next, details) => {
        // Only the mouse shows the preview. When a thread closes, the focus goes back to its pin: a preview then
        // would stay until the focus moves on. The pin's label tells screen readers the same.
        if (next && details.reason === "trigger-focus") details.cancel()
        else setPreview(next)
      }}
    >
      <HoverCardTrigger
        delay={300}
        closeDelay={100}
        render={
          <button
            type="button"
            ref={(el) => {
              if (el) pinElements.set(thread.id, el)
              else pinElements.delete(thread.id)
            }}
            aria-label={label}
            aria-expanded={open}
            data-slot="pin"
            data-thread={thread.id}
            className={cn(
              pinShape,
              "pointer-events-auto cursor-pointer outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring",
              open && "scale-110 ring-2 ring-primary",
              canMove && "touch-none",
            )}
            style={{ left: item.x, top: item.y - PIN, width: PIN, height: PIN }}
            onPointerDown={onPointerDown}
            onPointerEnter={() => onHover(thread.id)}
            onPointerLeave={() => onHover(null)}
            onClick={() => {
              if (dragged.current) return
              if (open) setState({ openThreadId: null })
              else openThread(thread.id)
            }}
          />
        }
      >
        <UserAvatar user={author} className="size-full" />
        {thread.unread && (
          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-blue-500 ring-2 ring-background" />
        )}
      </HoverCardTrigger>
      {first && (
        <HoverCardContent side="right" align="start" sideOffset={8} className="w-64">
          <div className="flex items-center gap-1.5">
            <UserName user={author} className="font-medium" />
            <span className="shrink-0 text-muted-foreground">{timeAgo(first.createdAt)}</span>
          </div>
          <p className="line-clamp-3 text-muted-foreground">{first.text || "Image"}</p>
          {replies > 0 && <p className="mt-1 text-muted-foreground">{plural(replies, "reply", "replies")}</p>}
        </HoverCardContent>
      )}
    </HoverCard>
  )
}

function Cluster({ x, y, items }: { x: number; y: number; items: Item[] }) {
  const users = useStore((s) => s.users)
  const unread = items.some((i) => i.thread.unread)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const authors = [...new Set(items.map((i) => i.thread.createdBy))].slice(0, 2)
  return (
    <>
      <button
        ref={(el) => {
          ref.current = el
          for (const i of items) {
            if (el) pinElements.set(i.thread.id, el)
            else pinElements.delete(i.thread.id)
          }
        }}
        type="button"
        aria-label={`${plural(items.length, "comment", "comments")}${unread ? ", unread" : ""}`}
        aria-expanded={open}
        data-slot="cluster"
        className={cn(
          pinShape,
          "pointer-events-auto h-7 cursor-pointer gap-0.5 pr-2 outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring",
        )}
        style={{ left: x, top: y - PIN }}
        onClick={() => setOpen(!open)}
      >
        <span className="flex -space-x-2">
          {authors.map((id) => (
            <UserAvatar key={id} user={users[id]} className="size-[22px] ring-2 ring-background" />
          ))}
        </span>
        <span className="pl-0.5 font-medium text-xs tabular-nums">{items.length}</span>
        {unread && (
          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-blue-500 ring-2 ring-background" />
        )}
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverContent
          anchor={ref}
          side="right"
          align="start"
          sideOffset={8}
          className="w-64 gap-0 p-1"
          aria-label="Comments here"
        >
          <ul>
            {items.map(({ thread }) => {
              const first = thread.comments[0]
              return (
                <li key={thread.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 rounded-md p-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted"
                    onClick={() => {
                      setOpen(false)
                      openThread(thread.id)
                    }}
                  >
                    <UserAvatar user={users[thread.createdBy]} />
                    <span className="min-w-0 flex-1">
                      <UserName user={users[thread.createdBy]} className="font-medium text-sm" />
                      <span className="line-clamp-2 text-muted-foreground text-sm">{first?.text || "Image"}</span>
                    </span>
                    {thread.unread && (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500">
                        <span className="sr-only">Unread</span>
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </>
  )
}

function ThreadPopover() {
  const thread = useStore((s) => s.threads.find((t) => t.id === s.openThreadId))
  // With the details open, or selected in the panel list, the focus stays there.
  const takesFocus = useStore(threadTakesFocus)
  // The thread opens beside the panel, not under it. On narrow screens the panel covers the screen: no room beside it.
  const narrow = useMedia(NARROW)
  const leftEdge = useStore((s) => (narrow ? 0 : panelLeftEdge(s)))
  const rightEdge = useStore((s) => (narrow ? 0 : panelRightEdge(s)))
  // There, the details in the panel cover the screen too: the thread waits until they close.
  const underDetails = useStore((s) => narrow && s.detailsOpen && detailsMode(s) === "panel")
  const keys = arrowKeys(useStore(panelSide))
  const page = useStore((s) => s.page)
  const resolved = useResolved()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  // The anchor when the thread closes is gone already (no thread, no anchor): the focus goes back to the last one.
  const lastAnchor = useRef<HTMLElement | null>(null)
  if (anchor) lastAnchor.current = anchor
  const listRef = useRef<HTMLDivElement>(null)
  threadList = listRef
  const id = thread?.id
  useAnchorVersion()

  // The pin or cluster on the page, else the item in the panel. A pin under the floating panel cannot show its
  // thread beside it: the thread opens beside its item in the panel.
  useLayoutEffect(() => {
    const pin = id ? pinElements.get(id) : undefined
    const rect = pin?.getBoundingClientRect()
    const covered = !!rect && (rect.left < leftEdge || rect.right > window.innerWidth - rightEdge)
    const item = id ? panelElements.get(id) : undefined
    const el = (covered && item) || pin || item || null
    if (el !== anchor) setAnchor(el)
  })

  const placement: Placement = !thread
    ? "here"
    : thread.page !== page
      ? "elsewhere"
      : resolved.get(thread.id)
        ? "here"
        : "missing"
  return (
    <Popover
      open={!!thread && !!anchor && !underDetails}
      onOpenChange={(open, details) => {
        // Opened from the panel list: Escape goes back to its item, and the thread stays open (selected).
        if (details.reason === "escape-key" && getState().threadFromList && getState().panelOpen) {
          focusOpenItem()
          return
        }
        // The details and their lightbox show this thread: focus or Escape there keeps it open.
        const keep =
          focusMovesTo(details, "[data-keeps-thread]") ||
          (details.reason === "escape-key" && !!details.event && fromWidgetPart(details.event, "[data-keeps-thread]"))
        if (!open && !pressInsideWidget(details) && !keep) setState({ openThreadId: null })
      }}
    >
      <PopoverContent
        anchor={anchor}
        side="right"
        align="start"
        sideOffset={8}
        className="w-80 max-w-[calc(100vw-16px)] gap-0 p-0"
        aria-label="Comment thread"
        collisionPadding={{ top: 8, bottom: 8, left: 8 + leftEdge, right: 8 + rightEdge }}
        initialFocus={takesFocus ? listRef : false}
        finalFocus={() => takeFocusOnClose() ?? (lastAnchor.current?.isConnected ? lastAnchor.current : true)}
        // The arrow away from the page goes back to the panel (the arrow toward the page came here). In text, only
        // when it is empty: there the arrow has nothing to move.
        onKeyDown={(event) => {
          const target = event.target as HTMLElement
          if (event.key !== keys.fromPage || target.closest("input, textarea")) return
          if (target.isContentEditable && target.textContent?.trim()) return
          event.preventDefault()
          focusOpenItem()
        }}
      >
        {thread && <ThreadView thread={thread} placement={placement} listRef={listRef} />}
      </PopoverContent>
    </Popover>
  )
}

/** The draft pin and its composer. Closed, the pin stays while the draft has text: a click opens it again. */
function DraftComposer({ draft }: { draft: Draft }) {
  const me = useStore((s) => s.session?.user)
  const [el, setEl] = useState<HTMLButtonElement | null>(null)
  useLayoutTick()
  const box = pageBox(draft.anchor, draft.element)
  if (!box) return null
  const point = tip(box)
  return (
    <>
      {draft.anchor.rect ? <Region box={box} /> : draft.open && <ElementOutline el={draft.element} />}
      <button
        ref={setEl}
        type="button"
        aria-label="Unsent comment"
        aria-expanded={draft.open}
        data-slot="draft-pin"
        className={cn(
          pinShape,
          "pointer-events-auto cursor-pointer ring-2 ring-primary outline-none focus-visible:ring-ring",
          !draft.open && "opacity-75",
        )}
        style={{ left: point.x, top: point.y - PIN, width: PIN, height: PIN }}
        // Only opens: on touch, the click of the tap that placed the draft lands on this new pin.
        onClick={() => !draft.open && setState({ draft: { ...draft, open: true }, openThreadId: null })}
      >
        <UserAvatar user={me} className="size-full" />
      </button>
      <Popover
        open={draft.open && !!el}
        onOpenChange={(open, details) => {
          if (!open && !pressInsideWidget(details)) closeDraft()
        }}
      >
        <PopoverContent
          anchor={el}
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="w-80 max-w-[calc(100vw-16px)] p-2"
          aria-label="New comment"
        >
          {me ? (
            <Composer
              // A new user, or a discarded draft: a new composer.
              key={`${me.id}:${draft.id}`}
              draftKind={`new:${draft.page}`}
              anchor={draft.anchor}
              placeholder="Add a comment"
              label="Comment"
              submitLabel="Post comment"
              onDiscard={() => setState({ draft: null })}
              onSubmit={async (body, files) => {
                const thread = await createThread({
                  page: draft.page,
                  anchor: draft.anchor,
                  body,
                  files,
                  context: pageContext(),
                  screenshot: await elementScreenshot(draft.anchor, draft.element),
                })
                // A slow answer: the user may be on another page or writing another comment by now.
                if (getState().draft?.id === draft.id) setState({ draft: null, openThreadId: thread.id })
              }}
            />
          ) : (
            <SignInForm />
          )}
        </PopoverContent>
      </Popover>
    </>
  )
}

const SCREENSHOT_SPACE = 16
const SCREENSHOT_TIMEOUT = 5000

/** Uploads a screenshot of the element (or region) and the space around it. The comment does not wait for a failed
 * or slow one: the time limit is for the capture and the upload together. */
async function elementScreenshot(anchor: Anchor, el: Element) {
  const box = anchor.rect ? anchorBox(anchor, el) : el.getBoundingClientRect()
  const space = SCREENSHOT_SPACE
  const upload = async () => {
    const { screenshotBox } = await import("@/lib/screenshot")
    const file = await screenshotBox(
      { x: box.x - space, y: box.y - space, width: box.width + 2 * space, height: box.height + 2 * space },
      el,
    )
    return (await uploadFile(await shrinkImage(file))).id
  }
  try {
    return await Promise.race([
      upload(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timeout")), SCREENSHOT_TIMEOUT)),
    ])
  } catch {
    return undefined
  }
}

/** A click on another place while the draft has text: the draft moves there, or a new one starts. */
function DraftMovePrompt({ move }: { move: NonNullable<State["draftMove"]> }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  useLayoutTick()
  const box = pageBox(move.anchor, move.element)
  if (!box) return null
  const point = tip(box)
  const key = newDraftKey(move.page)
  const moveHere = () => {
    const saved = key && loadDraft(key)
    if (key && saved) saveDraft(key, { ...saved, anchor: move.anchor })
    setState((s) => ({
      draft: s.draft ? { ...s.draft, ...move, open: true } : newDraft(move.anchor, move.element, move.page),
      draftMove: null,
    }))
  }
  const startNew = () => {
    if (key) saveDraft(key, null)
    setState({ draft: newDraft(move.anchor, move.element, move.page), draftMove: null })
  }
  return (
    <>
      {move.anchor.rect && <Region box={box} />}
      <div
        ref={setEl}
        aria-hidden
        className={cn(pinShape, "border-2 border-primary border-dashed")}
        style={{ left: point.x, top: point.y - PIN, width: PIN, height: PIN }}
      />
      <Popover
        open={!!el}
        onOpenChange={(open, details) => {
          if (!open && !pressInsideWidget(details)) setState({ draftMove: null })
        }}
      >
        <PopoverContent
          anchor={el}
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="w-64"
          aria-label="Unsent comment"
        >
          <p className="font-medium text-sm">Move your unsent comment here?</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={moveHere}>
              Move here
            </Button>
            <Button size="sm" variant="outline" onClick={startNew}>
              Discard and start new
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
