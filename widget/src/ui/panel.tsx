import {
  ArrowsOutSimpleIcon,
  CaretRightIcon,
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "@phosphor-icons/react"
import { cn } from "cn"
import { type KeyboardEvent, lazy, type RefObject, Suspense, useEffect, useMemo, useRef } from "react"
import { refresh } from "@/client"
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
import { shortText } from "@/lib/describe"
import { plural, timeAgo } from "@/lib/format"
import { NARROW, reducedMotion } from "@/lib/media"
import { pageBox, resolvedElement, useResolved } from "@/live"
import { type Filters, getState, type State, setState, useStore } from "@/store"
import type { Thread } from "@/types"
import { openDetails } from "./details-state"
import { focusOpenThread, openThread, setPanelElement } from "./pins"
import { setCommentMode } from "./shortcuts"
import { SignInForm } from "./sign-in"
import { threadLink } from "./thread"
import { UserAvatar } from "./user-avatar"
import { nameOf, UserName } from "./user-name"
import { detailsMode, panelMode, setDetailsMode, setPanelMode } from "./view"

export const PANEL_WIDTH = 360
/** The overlay panel's space to the window edges: it floats over the page, and this shows it. */
const PANEL_MARGIN = 8
/** The space the open panel takes at the right edge of the window. The toolbar and the notices stay left of it. */
export function panelRightEdge(s: State) {
  if (!s.panelOpen) return 0
  return panelMode(s) === "overlay" ? PANEL_WIDTH + PANEL_MARGIN : PANEL_WIDTH
}

const DetailsLayer = lazy(() => import("./details").then((m) => ({ default: m.DetailsLayer })))

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
  const push = useStore((s) => panelMode(s) === "push")
  usePushPage(open && push)
  // The details are a layer of the panel: they close with it. In dialog mode they do not need it.
  useEffect(() => {
    if (!open && getState().detailsOpen && detailsMode(getState()) === "panel") setState({ detailsOpen: false })
  }, [open])
  if (!open) return null
  return <PanelContent />
}

const setFilters = (patch: Partial<Filters>) => setState((s) => ({ filters: { ...s.filters, ...patch } }))

/** The threads in the panel's order, with its filters. The details go through them too. */
export function usePanelList() {
  const threads = useStore((s) => s.threads)
  const filters = useStore((s) => s.filters)
  const page = useStore((s) => s.page)
  const me = useStore((s) => s.session?.user.id)
  const openThreadId = useStore((s) => s.openThreadId)
  return useMemo(
    () => visibleThreads(threads, filters, page, me, openThreadId),
    [threads, filters, page, me, openThreadId],
  )
}

/**
 * Opens a thread from a list: scrolls to its element, or goes to its page.
 * On narrow screens the panel covers the page: it closes, so the thread opens next to its pin. The details keep it.
 */
export function showThread(thread: Thread, { keepPanel = false, focus = true } = {}) {
  if (thread.page !== getState().page) {
    location.assign(threadLink(thread))
    return
  }
  const el = resolvedElement(thread.id)
  if (!keepPanel && el && pageBox(thread.anchor, el) && matchMedia(NARROW).matches) setState({ panelOpen: false })
  el?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" })
  const open = getState().openThreadId === thread.id
  openThread(thread.id, focus)
  // Already open (selected with ↑ ↓): the popover does not open again, so the focus moves here.
  if (focus && open) setTimeout(focusOpenThread)
}

/** Opens a thread together with its details (the chevron of an item, or → in the list). */
function showWithDetails(thread: Thread) {
  // The focus goes to the details, not into the thread.
  showThread(thread, { keepPanel: true, focus: false })
  if (thread.page === getState().page) openDetails(true)
}

function PanelContent() {
  const filters = useStore((s) => s.filters)
  const page = useStore((s) => s.page)
  const signedIn = useStore((s) => !!s.session)
  const loaded = useStore((s) => s.loaded)
  const loadFailed = useStore((s) => s.loadFailed)
  const pendingLink = useStore((s) => !!s.pendingLink)
  const openThreadId = useStore((s) => s.openThreadId)
  // In dialog mode the details open over the page (see app.tsx).
  const detailsOpen = useStore((s) => s.detailsOpen && detailsMode(s) === "panel")
  const mode = useStore(panelMode)
  const details = useStore(detailsMode)
  const overlay = mode === "overlay"
  const resolved = useResolved()
  const listRef = useRef<HTMLUListElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  useFocusManagement(asideRef)
  const list = usePanelList()
  const activeFilters = [filters.scope === "all", filters.mine, filters.assigned, filters.resolved].filter(
    Boolean,
  ).length

  // ↑ and ↓ move between threads. ← goes to the thread on the page (as Enter). → opens it with its details;
  // ← in the details comes back.
  // The keys follow the screen: the page is on the left, the details are "in" an item.
  // ↑ ↓ select a thread: it opens at its pin and the focus stays here (a thread on another page only gets the
  // focus). ← (or Enter) goes into the thread. → opens it with its details.
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const root = listRef.current?.getRootNode() as ShadowRoot | undefined
    const threadOf = (el: Element | null | undefined) =>
      el instanceof HTMLElement ? list.find((t) => t.id === el.dataset.thread) : undefined
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const thread = threadOf(root?.activeElement)
      if (thread) {
        if (event.key === "ArrowRight") showWithDetails(thread)
        else showThread(thread)
        event.preventDefault()
      }
      return
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-slot=panel-item]") ?? [])
    const index = buttons.indexOf(root?.activeElement as HTMLButtonElement)
    const next = buttons[event.key === "ArrowDown" ? Math.min(buttons.length - 1, index + 1) : Math.max(0, index - 1)]
    event.preventDefault()
    if (!next || next === root?.activeElement) return
    next.focus()
    const thread = threadOf(next)
    if (thread && thread.page === page) showThread(thread, { keepPanel: true, focus: false })
  }

  return (
    <aside
      ref={asideRef}
      aria-label="Comments"
      data-slot="panel"
      onKeyDown={(e) => {
        // Escape closes the top layer first: the details (in the panel or the dialog) handle it.
        if (e.key === "Escape" && !e.defaultPrevented && !getState().detailsOpen) closePanel(asideRef.current)
      }}
      className={cn(
        "fixed flex w-[360px] flex-col bg-background max-[639px]:inset-0 max-[639px]:w-full",
        overlay
          ? "comma-panel-float inset-y-2 right-2 overflow-hidden rounded-xl border shadow-xl max-[639px]:rounded-none max-[639px]:border-0"
          : "inset-y-0 right-0 border-l shadow-lg max-[639px]:border-l-0",
      )}
    >
      {/* Under the details the list stays, so it keeps its scroll position. */}
      <div className="flex min-h-0 flex-1 flex-col" inert={detailsOpen}>
        <header className="flex h-11 shrink-0 items-center gap-1 border-b pr-1.5 pl-3">
          <h2 className="flex-1 font-medium text-sm">Comments</h2>
          {/* View: how the panel shows and where the details open. Each person chooses; it stays in this browser. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="View options" title="View options" />}
            >
              <SlidersHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Panel Mode</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={mode} onValueChange={setPanelMode}>
                  <DropdownMenuRadioItem value="overlay" title="Over the page. The page keeps its width.">
                    Overlay
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="push" title="Next to the page. Nothing is covered.">
                    Push
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Show Details</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={details} onValueChange={setDetailsMode}>
                  <DropdownMenuRadioItem value="panel" title="In the side panel">
                    Panel
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dialog" title="In a window over the page">
                    Dialog
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close comments"
            onClick={() => closePanel(asideRef.current)}
          >
            <XIcon />
          </Button>
        </header>

        <div className="flex shrink-0 items-center gap-1 border-b p-2">
          <InputGroup className="flex-1">
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
        </div>

        {!signedIn ? (
          <div className="p-4">
            <SignInForm title={pendingLink ? "Sign in to see this comment" : "Sign in to see comments"} />
          </div>
        ) : list.length === 0 ? (
          loaded ? (
            <EmptyState />
          ) : loadFailed ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-sm">
              <p className="text-pretty">Could not load comments.</p>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>
                Try again
              </Button>
            </div>
          ) : (
            <p className="flex flex-1 items-center justify-center text-muted-foreground text-sm">Loading…</p>
          )
        ) : (
          <ul
            ref={listRef}
            className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1"
            aria-label="Threads"
            onKeyDown={onKeyDown}
          >
            {list.map((thread) => (
              <PanelItem
                key={thread.id}
                thread={thread}
                active={thread.id === openThreadId}
                detached={thread.page === page && !resolved.get(thread.id)}
                showPage={filters.scope === "all"}
                onActivate={() => showThread(thread)}
                onDetails={() => showWithDetails(thread)}
              />
            ))}
          </ul>
        )}
      </div>
      {detailsOpen && (
        <Suspense fallback={null}>
          <DetailsLayer />
        </Suspense>
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
  onDetails,
}: {
  thread: Thread
  active: boolean
  detached: boolean
  showPage: boolean
  onActivate: () => void
  onDetails: () => void
}) {
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.session?.user.id)
  // The details open in the panel (a chevron: they slide in) or in a dialog (expand).
  const inDialog = useStore((s) => detailsMode(s) === "dialog")
  const first = thread.comments[0]
  // Unread: the newest comment by someone else is the news. The first comment stays as context.
  const newest = thread.unread ? [...thread.comments].reverse().find((c) => c.authorId !== me) : undefined
  const reply = newest && newest !== first ? newest : undefined
  const shown = reply ?? first
  const author = users[shown?.authorId ?? thread.createdBy]
  const assignee = thread.assigneeId ? users[thread.assigneeId] : undefined
  const replies = thread.comments.length - 1
  return (
    <li className="group relative">
      <button
        type="button"
        data-slot="panel-item"
        data-thread={thread.id}
        ref={(el) => setPanelElement(thread.id, el)}
        aria-current={active || undefined}
        // The open thread's own item: the focus goes there with → from the thread, and the thread stays open.
        data-keeps-thread={active || undefined}
        // Three states that must not look alike: hover (light), the open thread (darker, with a bar), focus (an
        // inset ring, so it does not cover the next item).
        className={cn(
          "relative flex w-full gap-2 rounded-md p-2 pr-8 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
          active
            ? "bg-muted before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
            : "group-hover:bg-muted/50",
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
      {/* The mouse way to the details, as high as the item. The keyboard way: → on the item. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Details: ${shortText(first?.text ?? "")}`}
        title="Details (→)"
        data-icon={inDialog ? "expand" : "chevron"}
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground [&_svg]:size-3.5"
        onClick={onDetails}
      >
        {inDialog ? <ArrowsOutSimpleIcon /> : <CaretRightIcon />}
      </button>
    </li>
  )
}
