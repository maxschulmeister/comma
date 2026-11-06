import { FunnelSimpleIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react"
import { cn } from "cn"
import { type KeyboardEvent, type RefObject, useEffect, useMemo, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { plural, timeAgo } from "@/lib/format"
import { useResolved } from "@/live"
import { type Filters, setState, useStore } from "@/store"
import type { Thread } from "@/types"
import { openThread, panelElements } from "./pins"
import { SignInForm } from "./sign-in"
import { threadLink } from "./thread"
import { UserAvatar } from "./user-avatar"

export const PANEL_WIDTH = 360
export const NARROW = "(max-width: 639px)"

const lastActivity = (t: Thread) => t.comments.at(-1)?.createdAt ?? t.updatedAt

/** Threads in the panel: filters, search and sort. */
export function visibleThreads(threads: Thread[], filters: Filters, page: string, me: string | undefined) {
  const q = filters.query.trim().toLowerCase()
  const list = threads.filter((t) => {
    if (filters.scope === "page" && t.page !== page) return false
    if (!filters.resolved && t.status === "resolved") return false
    if (filters.mine && (!me || !t.comments.some((c) => c.authorId === me || c.mentions.includes(me)))) return false
    if (q && !t.comments.some((c) => c.text.toLowerCase().includes(q))) return false
    return true
  })
  return list.sort((a, b) => {
    if (filters.sort === "unread" && a.unread !== b.unread) return a.unread ? -1 : 1
    return lastActivity(b) - lastActivity(a)
  })
}

// Push mode: the page gets a right margin, so its content reflows next to the panel.
function usePushPage(active: boolean) {
  useEffect(() => {
    if (!active) return
    const media = matchMedia(NARROW)
    const style = document.createElement("style")
    style.dataset.comma = "push"
    const apply = () => {
      style.textContent = media.matches ? "" : `html { margin-right: ${PANEL_WIDTH}px !important; }`
    }
    apply()
    media.addEventListener("change", apply)
    document.head.append(style)
    return () => {
      media.removeEventListener("change", apply)
      style.remove()
    }
  }, [active])
}

/**
 * Opened from the toolbar, the focus moves into the panel (see `closePanel` for the way back).
 * On narrow screens the panel covers the page, so the page is inert (no focus, no clicks) while it is open.
 */
function useFocusManagement(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const aside = ref.current
    if (!aside) return
    const root = aside.getRootNode() as ShadowRoot
    const opener = root.activeElement instanceof HTMLElement ? root.activeElement : null
    if (opener?.closest("[data-slot=toolbar]")) aside.querySelector<HTMLElement>("input")?.focus()
    const media = matchMedia(NARROW)
    const wasInert = document.body.inert
    const apply = () => {
      document.body.inert = wasInert || media.matches
    }
    apply()
    media.addEventListener("change", apply)
    return () => {
      media.removeEventListener("change", apply)
      document.body.inert = wasInert
    }
  }, [ref])
}

/** Closes the panel. If the focus is in it, the focus goes back to the toolbar button. */
function closePanel(aside: HTMLElement | null) {
  const root = aside?.getRootNode() as ShadowRoot | undefined
  if (aside && root && aside.contains(root.activeElement)) {
    root.querySelector<HTMLElement>("[data-panel-button]")?.focus()
  }
  setState({ panelOpen: false })
}

export function Panel() {
  const open = useStore((s) => s.panelOpen)
  usePushPage(open)
  if (!open) return null
  return <PanelContent />
}

function PanelContent() {
  const threads = useStore((s) => s.threads)
  const filters = useStore((s) => s.filters)
  const page = useStore((s) => s.page)
  const me = useStore((s) => s.session?.user.id)
  const signedIn = useStore((s) => !!s.session)
  const loaded = useStore((s) => s.loaded)
  const openThreadId = useStore((s) => s.openThreadId)
  const resolved = useResolved()
  const listRef = useRef<HTMLUListElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  useFocusManagement(asideRef)
  const list = useMemo(() => visibleThreads(threads, filters, page, me), [threads, filters, page, me])
  const setFilters = (patch: Partial<Filters>) => setState((s) => ({ filters: { ...s.filters, ...patch } }))

  const activate = (thread: Thread) => {
    if (thread.page !== page) {
      location.assign(threadLink(thread))
      return
    }
    resolved.get(thread.id)?.scrollIntoView({ block: "center", behavior: "smooth" })
    openThread(thread.id)
  }

  // ↑ and ↓ move between threads.
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-slot=panel-item]") ?? [])
    const root = listRef.current?.getRootNode() as ShadowRoot | undefined
    const index = buttons.indexOf(root?.activeElement as HTMLButtonElement)
    const next = event.key === "ArrowDown" ? Math.min(buttons.length - 1, index + 1) : Math.max(0, index - 1)
    buttons[next]?.focus()
    event.preventDefault()
  }

  return (
    <aside
      ref={asideRef}
      aria-label="Comments"
      data-slot="panel"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) closePanel(asideRef.current)
      }}
      className="fixed inset-y-0 right-0 flex w-[360px] flex-col border-l bg-background shadow-lg max-[639px]:w-full max-[639px]:border-l-0"
    >
      <header className="flex h-11 shrink-0 items-center gap-1 border-b pr-1.5 pl-3">
        <h2 className="flex-1 font-medium text-sm">Comments</h2>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Filter and sort" title="Filter and sort" />}
          >
            <FunnelSimpleIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Show</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={filters.scope} onValueChange={(scope) => setFilters({ scope })}>
                <DropdownMenuRadioItem value="page">This page</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="all">All pages</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={filters.mine}
              onCheckedChange={(mine) => setFilters({ mine })}
              disabled={!signedIn}
            >
              Only my threads
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filters.resolved}
              onCheckedChange={(resolved) => setFilters({ resolved })}
            >
              Show resolved
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Sort</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={filters.sort} onValueChange={(sort) => setFilters({ sort })}>
                <DropdownMenuRadioItem value="date">Newest first</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="unread">Unread first</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" aria-label="Close comments" onClick={() => closePanel(asideRef.current)}>
          <XIcon />
        </Button>
      </header>

      <div className="shrink-0 border-b p-2">
        <InputGroup>
          <InputGroupAddon>
            <MagnifyingGlassIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search comments"
            placeholder="Search"
            value={filters.query}
            onChange={(e) => setFilters({ query: e.currentTarget.value })}
          />
        </InputGroup>
      </div>

      {!signedIn ? (
        <div className="p-4">
          <SignInForm title="Sign in to see comments" />
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-muted-foreground text-xs">
          {loaded ? (
            <>
              <p className="font-medium text-foreground">{filters.query ? "No comments match" : "No comments"}</p>
              {!filters.query && (
                <p>
                  Press <Kbd>C</Kbd> to add a comment.
                </p>
              )}
            </>
          ) : (
            <p>Loading…</p>
          )}
        </div>
      ) : (
        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1" aria-label="Threads" onKeyDown={onKeyDown}>
          {list.map((thread) => (
            <PanelItem
              key={thread.id}
              thread={thread}
              active={thread.id === openThreadId}
              detached={thread.page === page && !resolved.get(thread.id)}
              showPage={filters.scope === "all"}
              onActivate={() => activate(thread)}
            />
          ))}
        </ul>
      )}
    </aside>
  )
}

function PanelItem({
  thread,
  active,
  detached,
  showPage,
  onActivate,
}: {
  thread: Thread
  active: boolean
  detached: boolean
  showPage: boolean
  onActivate: () => void
}) {
  const author = useStore((s) => s.users[thread.createdBy])
  const first = thread.comments[0]
  const replies = thread.comments.length - 1
  return (
    <li>
      <button
        type="button"
        data-slot="panel-item"
        data-thread={thread.id}
        ref={(el) => {
          if (el) panelElements.set(thread.id, el)
          else panelElements.delete(thread.id)
        }}
        aria-current={active || undefined}
        className={cn(
          "flex w-full gap-2 rounded-md p-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
          active && "bg-muted",
        )}
        onClick={onActivate}
      >
        <UserAvatar user={author} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className={cn("truncate text-xs", thread.unread ? "font-semibold" : "font-medium")}>
              {author?.name ?? "Unknown"}
            </span>
            <span className="shrink-0 text-muted-foreground text-xs">{timeAgo(lastActivity(thread))}</span>
            <span className="flex-1" />
            {thread.unread && (
              <span className="size-2 shrink-0 rounded-full bg-blue-500">
                <span className="sr-only">Unread</span>
              </span>
            )}
          </span>
          {showPage && <span className="truncate font-mono text-[10px] text-muted-foreground">{thread.page}</span>}
          <span className={cn("line-clamp-2 text-xs/relaxed", !thread.unread && "text-muted-foreground")}>
            {first?.text || "Image"}
          </span>
          {(replies > 0 || detached || thread.status === "resolved") && (
            <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
              {replies > 0 && plural(replies, "reply", "replies")}
              {thread.status === "resolved" && <Badge variant="secondary">Resolved</Badge>}
              {detached && <Badge variant="outline">Detached</Badge>}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
