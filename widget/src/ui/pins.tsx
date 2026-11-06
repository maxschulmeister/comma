import { cn } from "cn"
import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef, useState } from "react"
import { type Box, createAnchor } from "@/anchor"
import { createThread, moveThread } from "@/client"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Popover, PopoverContent } from "@/components/ui/popover"
import { elementAt, pressInsideWidget } from "@/lib/dom"
import { plural, timeAgo } from "@/lib/format"
import { NARROW, useMedia } from "@/lib/media"
import { pageBox, useLayoutTick, useResolved } from "@/live"
import { type Draft, getState, setState, useStore } from "@/store"
import type { Thread } from "@/types"
import { Composer } from "./composer"
import { SignInForm } from "./sign-in"
import { ThreadView } from "./thread"
import { UserAvatar } from "./user-avatar"

/** Elements a thread popover can attach to: pins and clusters on the page, items in the panel. */
export const pinElements = new Map<string, HTMLElement>()
export const panelElements = new Map<string, HTMLElement>()

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

export const openThread = (id: string) => setState({ openThreadId: id, draft: null })

export function PinsLayer() {
  const threads = useStore((s) => s.threads)
  const page = useStore((s) => s.page)
  const pinsVisible = useStore((s) => s.pinsVisible)
  const openThreadId = useStore((s) => s.openThreadId)
  const draft = useStore((s) => s.draft)
  // On narrow screens the panel covers the page: pins behind it take no focus.
  const panelOpen = useStore((s) => s.panelOpen)
  const narrow = useMedia(NARROW)
  const covered = panelOpen && narrow
  const resolved = useResolved()
  useLayoutTick()
  const [hovered, setHovered] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)

  const items: Item[] = []
  for (const thread of threads) {
    if (thread.page !== page) continue
    if (thread.id !== openThreadId && (!pinsVisible || thread.status !== "open")) continue
    const el = resolved.get(thread.id)
    const box = el && pageBox(thread.anchor, el)
    if (!box) continue
    const point = drag?.id === thread.id ? drag : tip(box)
    items.push({ thread, box, x: point.x, y: point.y })
  }
  const groups = cluster(items, openThreadId)
  const regions = items.filter((i) => i.thread.anchor.rect && (i.thread.id === openThreadId || i.thread.id === hovered))

  return (
    <div className="absolute top-0 left-0" data-slot="pins" inert={covered}>
      {regions.map(({ thread, box }) => (
        <Region key={thread.id} box={box} />
      ))}
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
      const target = elementAt(e.clientX, e.clientY)
      if (!target) return onDrag(null)
      const anchor = createAnchor(target, { point: { x: e.clientX, y: e.clientY } })
      moveThread(thread, getState().page, anchor)
        .catch(() => {})
        .finally(() => onDrag(null))
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  const label = `Comment by ${author?.name ?? "Unknown"}${thread.unread ? ", unread" : ""}: ${first?.text.slice(0, 80) ?? ""}`

  // No preview while the thread is open: it would also take the Escape key.
  return (
    <HoverCard open={preview && !open} onOpenChange={setPreview}>
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
      {!open && first && (
        <HoverCardContent side="right" align="start" sideOffset={8} className="w-64">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{author?.name ?? "Unknown"}</span>
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
                      <span className="block truncate font-medium text-xs">
                        {users[thread.createdBy]?.name ?? "Unknown"}
                      </span>
                      <span className="line-clamp-2 text-muted-foreground text-xs">{first?.text || "Image"}</span>
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
  const page = useStore((s) => s.page)
  const resolved = useResolved()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const id = thread?.id

  // The pin or cluster on the page, else the item in the panel.
  useLayoutEffect(() => {
    const el = id ? (pinElements.get(id) ?? panelElements.get(id) ?? null) : null
    if (el !== anchor) setAnchor(el)
  })

  const detached = !!thread && (thread.page !== page || !resolved.get(thread.id))
  return (
    <Popover
      open={!!thread && !!anchor}
      onOpenChange={(open, details) => {
        if (!open && !pressInsideWidget(details)) setState({ openThreadId: null })
      }}
    >
      <PopoverContent
        anchor={anchor}
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className="w-80 gap-0 p-0"
        aria-label="Comment thread"
        initialFocus={listRef}
        finalFocus={anchor?.isConnected ? { current: anchor } : true}
      >
        {thread && <ThreadView thread={thread} detached={detached} listRef={listRef} />}
      </PopoverContent>
    </Popover>
  )
}

function DraftComposer({ draft }: { draft: Draft }) {
  const me = useStore((s) => s.session?.user)
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  useLayoutTick()
  const box = pageBox(draft.anchor, draft.element)
  if (!box) return null
  const point = tip(box)
  return (
    <>
      {draft.anchor.rect && <Region box={box} />}
      <div
        ref={setEl}
        aria-hidden
        data-slot="draft-pin"
        className={cn(pinShape, "ring-2 ring-primary")}
        style={{ left: point.x, top: point.y - PIN, width: PIN, height: PIN }}
      >
        <UserAvatar user={me} className="size-full" />
      </div>
      <Popover
        open={!!el}
        onOpenChange={(open, details) => {
          // The text stays as a draft (see Composer).
          if (!open && !pressInsideWidget(details)) setState({ draft: null })
        }}
      >
        <PopoverContent
          anchor={el}
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="w-80 p-2"
          aria-label="New comment"
        >
          {me ? (
            <Composer
              // A new user gets a new composer with their own draft.
              key={me.id}
              draftKey="new"
              placeholder="Add a comment"
              label="Comment"
              submitLabel="Post comment"
              onSubmit={async (body, files) => {
                const thread = await createThread({ page: draft.page, anchor: draft.anchor, body, files })
                // A slow answer: the user may be on another page or writing another comment by now.
                if (getState().draft === draft) setState({ draft: null, openThreadId: thread.id })
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
