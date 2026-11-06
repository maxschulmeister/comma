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
import { NARROW, reducedMotion } from "@/lib/media"
import { pageBox, useResolved } from "@/live"
import { type Filters, setState, useStore } from "@/store"
import type { Thread } from "@/types"
import { openThread, panelElements } from "./pins"
import { setCommentMode } from "./shortcuts"
import { SignInForm } from "./sign-in"
import { threadLink } from "./thread"
import { UserAvatar } from "./user-avatar"
import { nameOf, UserName } from "./user-name"

export const PANEL_WIDTH = 360

const lastActivity = (t: Thread) => t.comments.at(-1)?.createdAt ?? t.updatedAt

/** Threads in the panel: filters, search and sort. The open thread always shows (it can need its item as anchor). */
export function visibleThreads(
  threads: Thread[],
  filters: Filters,
  page: string,
  me: string | undefined,
  open: string | null,
) {
  const q = filters.query.trim().toLowerCase()
  const list = threads.filter((t) => {
    if (t.id === open) return true
    if (filters.scope === "page" && t.page !== page) return false
    if (!filters.resolved && t.status === "resolved") return false
    if (filters.mine && (!me || !t.comments.some((c) => c.authorId === me || c.mentions.includes(me)))) return false
    if (filters.assigned && (!me || t.assigneeId !== me)) return false
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

/**
 * Closes the panel. If the focus is in it, the focus goes back to the toolbar button, after the render:
 * on narrow screens the toolbar shows only when the panel is closed.
 */
function closePanel(aside: HTMLElement | null) {
  const root = aside?.getRootNode() as ShadowRoot | undefined
  const focused = !!aside && !!root && aside.contains(root.activeElement)
  setState({ panelOpen: false })
  if (focused) setTimeout(() => root?.querySelector<HTMLElement>("[data-panel-button]")?.focus())
}

export function Panel() {
  const open = useStore((s) => s.panelOpen)
  usePushPage(open)
  if (!open) return null
  return <PanelContent />
}

const setFilters = (patch: Partial<Filters>) => setState((s) => ({ filters: { ...s.filters, ...patch } }))

function PanelContent() {
  const threads = useStore((s) => s.threads)
  const filters = useStore((s) => s.filters)
  const page = useStore((s) => s.page)
  const me = useStore((s) => s.session?.user.id)
  const signedIn = useStore((s) => !!s.session)
  const loaded = useStore((s) => s.loaded)
  const pendingLink = useStore((s) => !!s.pendingLink)
  const openThreadId = useStore((s) => s.openThreadId)
  const resolved = useResolved()
  const listRef = useRef<HTMLUListElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  useFocusManagement(asideRef)
  const list = useMemo(
    () => visibleThreads(threads, filters, page, me, openThreadId),
    [threads, filters, page, me, openThreadId],
  )
  const activeFilters = [filters.scope === "all", filters.mine, filters.assigned, filters.resolved].filter(
    Boolean,
  ).length

  const activate = (thread: Thread) => {
    if (thread.page !== page) {
      location.assign(threadLink(thread))
      return
    }
    const el = resolved.get(thread.id)
    // On narrow screens the panel covers the page: it closes, so the thread opens next to its pin.
    if (el && pageBox(thread.anchor, el) && matchMedia(NARROW).matches) setState({ panelOpen: false })
    el?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" })
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
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="relative"
                aria-label={activeFilters ? `Filter and sort, ${activeFilters} on` : "Filter and sort"}
                title="Filter and sort"
              />
            }
          >
            <FunnelSimpleIcon />
            {activeFilters > 0 && (
              <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
            )}
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
              checked={filters.assigned}
              onCheckedChange={(assigned) => setFilters({ assigned })}
              disabled={!signedIn}
            >
              Assigned to me
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
          <SignInForm title={pendingLink ? "Sign in to see this comment" : "Sign in to see comments"} />
        </div>
      ) : list.length === 0 ? (
        loaded ? (
          <EmptyState />
        ) : (
          <p className="flex flex-1 items-center justify-center text-muted-foreground text-sm">Loading…</p>
        )
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

/** Says why the list is empty and offers the way out: other pages, resolved threads, filters, or a new comment. */
function EmptyState() {
  const threads = useStore((s) => s.threads)
  const filters = useStore((s) => s.filters)
  const page = useStore((s) => s.page)
  const me = useStore((s) => s.session?.user.id)
  const shortcut = useStore((s) => s.shortcut)
  const query = filters.query.trim()

  let title: string
  const hints: string[] = []
  const actions: { label: string; run: () => void }[] = []
  if (query) {
    title = `No comments match “${query}”`
    actions.push({ label: "Clear search", run: () => setFilters({ query: "" }) })
  } else if (
    (filters.mine || filters.assigned) &&
    visibleThreads(threads, { ...filters, mine: false, assigned: false }, page, me, null).length > 0
  ) {
    title = "No comments match the filters"
    actions.push({ label: "Clear filters", run: () => setFilters({ mine: false, assigned: false }) })
  } else {
    title = filters.scope === "page" ? "No comments on this page" : "No comments yet"
    const open = threads.filter((t) => t.status === "open")
    const elsewhere = open.filter((t) => t.page !== page)
    if (filters.scope === "page" && elsewhere.length > 0) {
      const unread = elsewhere.filter((t) => t.unread).length
      hints.push(
        `${plural(elsewhere.length, "comment", "comments")} on other pages${unread ? `, ${unread} unread` : ""}`,
      )
      actions.push({ label: "Show all pages", run: () => setFilters({ scope: "all" }) })
    }
    const resolvedHere = threads.filter(
      (t) => t.status === "resolved" && (filters.scope === "all" || t.page === page),
    ).length
    if (!filters.resolved && resolvedHere > 0) {
      hints.push(`${plural(resolvedHere, "resolved comment", "resolved comments")}`)
      actions.push({ label: "Show resolved", run: () => setFilters({ resolved: true }) })
    }
    actions.push({ label: "Add comment", run: () => setCommentMode(true) })
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
      <p className="text-balance font-medium text-sm">{title}</p>
      {hints.map((hint) => (
        <p key={hint} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ))}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {actions.map((action) => (
          <Button
            key={action.label}
            size="sm"
            variant={action.label === "Add comment" ? "default" : "outline"}
            onClick={action.run}
          >
            {action.label}
          </Button>
        ))}
      </div>
      {actions.at(-1)?.label === "Add comment" && shortcut && (
        <p className="mt-1 text-muted-foreground text-xs">
          Or press <Kbd>{shortcut.toUpperCase()}</Kbd>
        </p>
      )}
    </div>
  )
}

/** "Pricing · /pricing", or the path for threads made before comma kept the title. */
const pageLabel = (t: Thread) => (t.context?.title ? `${t.context.title} · ${t.page}` : t.page)

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
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.session?.user.id)
  const first = thread.comments[0]
  // Unread: the newest comment by someone else is the news. The first comment stays as context.
  const newest = thread.unread ? [...thread.comments].reverse().find((c) => c.authorId !== me) : undefined
  const reply = newest && newest !== first ? newest : undefined
  const shown = reply ?? first
  const author = users[shown?.authorId ?? thread.createdBy]
  const assignee = thread.assigneeId ? users[thread.assigneeId] : undefined
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
        <UserAvatar user={author} className="mt-0.5" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <UserName user={author} className={cn("text-sm", thread.unread ? "font-semibold" : "font-medium")} />
            {reply && <span className="shrink-0 text-muted-foreground text-xs">replied</span>}
            <span className="shrink-0 text-muted-foreground text-xs">{timeAgo(lastActivity(thread))}</span>
            <span className="flex-1" />
            {thread.unread && (
              <span className="size-2 shrink-0 rounded-full bg-blue-500">
                <span className="sr-only">Unread</span>
              </span>
            )}
          </span>
          {showPage && (
            <span className="truncate text-muted-foreground text-xs" title={thread.page}>
              {pageLabel(thread)}
            </span>
          )}
          <span className={cn("line-clamp-2 text-sm/relaxed", !thread.unread && "text-muted-foreground")}>
            {shown?.text || "Image"}
          </span>
          {reply && <span className="truncate text-muted-foreground text-xs">On: {first?.text || "Image"}</span>}
          {(replies > 0 || assignee || detached || thread.status === "resolved") && (
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground text-xs">
              {replies > 0 && <span>{plural(replies, "reply", "replies")}</span>}
              {assignee && <span className="truncate">Assigned to {nameOf(assignee)}</span>}
              {thread.status === "resolved" && <Badge variant="secondary">Resolved</Badge>}
              {detached && <Badge variant="outline">Element not found</Badge>}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
