import {
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowsOutCardinalIcon,
  CheckCircleIcon,
  CheckIcon,
  DotsThreeIcon,
  EnvelopeSimpleIcon,
  LinkSimpleIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  SmileyIcon,
  TrashIcon,
  UserCirclePlusIcon,
  XIcon,
} from "@phosphor-icons/react"
import { cn } from "cn"
import { type RefObject, useEffect, useRef, useState } from "react"
import {
  deleteComment,
  deleteThread,
  editComment,
  fileUrl,
  reply,
  searchUsers,
  setAssignee,
  setRead,
  setStatus,
  toggleReaction,
} from "@/client"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { describe, kindOf, shortText } from "@/lib/describe"
import { pressInsideWidget } from "@/lib/dom"
import { describeContext } from "@/lib/env"
import { fullDate, plural, timeAgo } from "@/lib/format"
import { setState, threadTakesFocus, useStore } from "@/store"
import type { Comment, Thread, User } from "@/types"
import { CommentBody } from "./body"
import { Composer } from "./composer"
import { toggleDetails } from "./details-state"
import { EmojiButton, QUICK_REACTIONS } from "./emoji"
import { notify } from "./notices"
import { SignInForm } from "./sign-in"
import { UserAvatar } from "./user-avatar"
import { nameOf, UserName } from "./user-name"

export const threadLink = (thread: Thread) => `${location.origin}${thread.page}#comma=${thread.id}`

/** Where the thread's element is: on this page, not found on this page, or on another page. */
export type Placement = "here" | "missing" | "elsewhere"

type Confirm = {
  title: string
  description: string
  action: string
  run: () => Promise<unknown>
  done: string
  /** Deletes the thread: the focus goes to the Comments button. */
  removesThread?: boolean
}

// Where the focus goes when the open thread closes, if not back to its pin: an action that removes the thread
// chooses it (Undo after resolve, the Comments button after delete). Found when the thread has closed.
let focusOnClose: (() => HTMLElement | null | undefined) | null = null
/** Where the focus goes when the open thread closes, once. */
export function setFocusOnClose(find: () => HTMLElement | null | undefined) {
  focusOnClose = find
}
export function takeFocusOnClose() {
  const find = focusOnClose
  focusOnClose = null
  return find?.() ?? null
}

/** The content of the thread popover: comments, reactions, actions and the reply box. */
export function ThreadView({
  thread,
  placement,
  listRef,
}: {
  thread: Thread
  placement: Placement
  /** The comment list. The popover focuses it first, so no button (and its tooltip) gets the focus. */
  listRef: RefObject<HTMLDivElement | null>
}) {
  const me = useStore((s) => s.session?.user)
  const resolver = useStore((s) => (thread.resolvedBy ? s.users[thread.resolvedBy] : undefined))
  const assignee = useStore((s) => (thread.assigneeId ? s.users[thread.assigneeId] : undefined))
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const close = () => setState({ openThreadId: null })
  const label = describe(kindOf(thread.anchor.tag), thread.anchor.text)
  const detailsOpen = useStore((s) => s.detailsOpen)
  const takesFocus = useStore(threadTakesFocus)

  // Opening a thread marks it as read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the thread opens.
  useEffect(() => {
    if (thread.unread && me) setRead(thread, true).catch(() => {})
  }, [thread.id])

  // New comments. At the end of the list (or with my own reply), the list follows them, and replies by others are
  // read. Reading older comments, the list stays, and a button shows how many are new. Screen readers hear them.
  const users = useStore((s) => s.users)
  const shownCount = useRef(thread.comments.length)
  const atEnd = useRef(true)
  const [newBelow, setNewBelow] = useState(0)
  const [heard, setHeard] = useState("")
  const toEnd = () => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
    atEnd.current = true
    setNewBelow(0)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: when comments are added.
  useEffect(() => {
    const added = thread.comments.slice(shownCount.current)
    shownCount.current = thread.comments.length
    const others = added.filter((c) => c.authorId !== me?.id)
    const last = others.at(-1)
    if (last) setHeard(`${users[last.authorId]?.name ?? "Someone"} replied`)
    if (added.length === 0 || others.length < added.length || atEnd.current) {
      toEnd()
      if (others.length > 0 && me) setRead(thread, true).catch(() => {})
    } else setNewBelow((n) => n + others.length)
  }, [thread.comments.length])
  const onScroll = () => {
    const list = listRef.current
    if (!list) return
    atEnd.current = list.scrollHeight - list.scrollTop - list.clientHeight < 24
    if (atEnd.current && newBelow > 0) {
      setNewBelow(0)
      if (me) setRead(thread, true).catch(() => {})
    }
  }

  const act = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.")
    }
  }

  const resolved = thread.status === "resolved"
  const own = !!me && me.id === thread.createdBy
  const canDeleteThread = own || !!me?.isAdmin
  const move = () => setState({ moving: thread.id, openThreadId: null })

  return (
    <div className="flex max-h-[min(560px,calc(100vh-32px))] flex-col" data-slot="thread">
      <div className="flex items-center gap-0.5 border-b py-1 pr-1 pl-3">
        <span className="flex-1 truncate font-medium text-xs" title={label}>
          {label}
        </span>
        {me && <AssignButton thread={thread} assignee={assignee} />}
        {me && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={resolved ? "Reopen" : "Resolve"}
                  onClick={() =>
                    act(async () => {
                      await setStatus(thread, resolved ? "open" : "resolved")
                      if (resolved) return notify("Thread reopened")
                      const root = listRef.current?.getRootNode() as ShadowRoot | undefined
                      focusOnClose = () => root?.querySelector<HTMLElement>("[data-slot=notices] [data-notice-action]")
                      close()
                      notify("Thread resolved", {
                        label: "Undo",
                        run: () =>
                          void setStatus(thread, "open")
                            .then(() => setState({ openThreadId: thread.id }))
                            .catch((e: Error) => notify(e.message)),
                      })
                    })
                  }
                />
              }
            >
              {resolved ? <ArrowCounterClockwiseIcon /> : <CheckCircleIcon />}
            </TooltipTrigger>
            <TooltipContent>{resolved ? "Reopen" : "Resolve"}</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Thread actions" />}>
            <DotsThreeIcon weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              onClick={() =>
                act(async () => {
                  await navigator.clipboard.writeText(threadLink(thread))
                  notify("Link copied")
                })
              }
            >
              <LinkSimpleIcon />
              Copy link
            </DropdownMenuItem>
            {own && (
              <DropdownMenuItem onClick={move}>
                <ArrowsOutCardinalIcon />
                Move
              </DropdownMenuItem>
            )}
            {me && (
              <DropdownMenuItem
                onClick={() =>
                  act(async () => {
                    close()
                    await setRead(thread, false)
                    notify("Marked as unread")
                  })
                }
              >
                <EnvelopeSimpleIcon />
                Mark as unread
              </DropdownMenuItem>
            )}
            {canDeleteThread && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() =>
                    setConfirm({
                      title: "Delete thread?",
                      description: "This deletes the thread and all its replies.",
                      action: "Delete thread",
                      done: "Thread deleted",
                      removesThread: true,
                      run: () => deleteThread(thread),
                    })
                  }
                >
                  <TrashIcon />
                  Delete thread
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={close}>
          <XIcon />
        </Button>
      </div>

      {placement === "missing" && (
        <div className="flex items-start gap-2 border-b bg-muted/60 px-3 py-2 text-xs">
          <p className="flex-1 text-pretty">
            Element not found. It was on: {kindOf(thread.anchor.tag)} “{shortText(thread.anchor.text)}”.
          </p>
          {own && (
            <Button size="xs" variant="outline" onClick={move}>
              Move
            </Button>
          )}
        </div>
      )}
      {placement === "elsewhere" && (
        <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2 text-xs">
          <p className="flex-1">This comment is on another page.</p>
          <a href={threadLink(thread)} className={buttonVariants({ size: "xs", variant: "outline" })}>
            Open page
          </a>
        </div>
      )}
      {(assignee || thread.context || thread.screenshot) && (
        <div className="flex flex-col border-b text-muted-foreground text-xs">
          {assignee && <span className="truncate px-3 pt-1.5 last:pb-1.5">Assigned to {nameOf(assignee)}</span>}
          {(thread.context || thread.screenshot) && (
            // The line opens the details (in the panel or a dialog): the screenshot at full size and more about the page.
            <button
              type="button"
              onClick={toggleDetails}
              aria-expanded={detailsOpen}
              aria-label={`${thread.context ? describeContext(thread.context) : "Screenshot"}, details`}
              title={detailsOpen ? "Hide details" : "Show details"}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <span className="flex-1 truncate">{thread.context && describeContext(thread.context)}</span>
              {thread.screenshot && (
                <img
                  src={fileUrl(thread.screenshot)}
                  alt=""
                  className="block h-5 w-8 shrink-0 rounded-sm border bg-muted object-cover object-left-top"
                />
              )}
            </button>
          )}
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {heard}
      </p>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={listRef}
          tabIndex={-1}
          data-slot="thread-comments"
          className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
          onScroll={onScroll}
        >
          {resolved && (
            <p className="flex items-center gap-1.5 px-3 py-1 text-muted-foreground text-xs">
              <CheckIcon className="shrink-0" />
              <span className="truncate">
                Resolved{thread.resolvedBy && ` by ${nameOf(resolver)}`}
                {thread.resolvedAt && ` · ${timeAgo(thread.resolvedAt)}`}
              </span>
            </p>
          )}
          {thread.comments.map((comment, index) => (
            <CommentItem
              // A new user gets new items: an unsaved edit of the previous user goes away.
              key={`${comment.id}:${me?.id ?? ""}`}
              comment={comment}
              onDelete={() =>
                setConfirm(
                  index === 0
                    ? {
                        title: "Delete thread?",
                        description: "This is the first comment. Deleting it deletes the thread and all its replies.",
                        action: "Delete thread",
                        done: "Thread deleted",
                        removesThread: true,
                        run: () => deleteComment(comment),
                      }
                    : {
                        title: "Delete comment?",
                        description: "You cannot undo this.",
                        action: "Delete comment",
                        done: "Comment deleted",
                        run: () => deleteComment(comment),
                      },
                )
              }
              onError={setError}
            />
          ))}
        </div>
        {newBelow > 0 && (
          <Button
            size="xs"
            variant="secondary"
            className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full shadow-sm"
            onClick={() => {
              toEnd()
              if (me) setRead(thread, true).catch(() => {})
            }}
          >
            <ArrowDownIcon />
            {plural(newBelow, "new reply", "new replies")}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="px-3 pb-1 text-destructive text-xs">
          {error}
        </p>
      )}

      <div className="border-t p-2">
        {me ? (
          <Composer
            // A new user gets a new composer with their own draft.
            key={`${thread.id}:${me.id}`}
            draftKind={`reply:${thread.id}`}
            placeholder="Reply"
            label="Reply"
            submitLabel="Send reply"
            // With the details open, the reviewer goes from thread to thread there: the focus stays.
            autoFocus={takesFocus}
            onSubmit={(body, files) => reply(thread.id, body, files)}
          />
        ) : (
          <SignInForm title="Sign in to reply" />
        )}
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const current = confirm
                setConfirm(null)
                if (current)
                  void act(async () => {
                    const root = listRef.current?.getRootNode() as ShadowRoot | undefined
                    if (current.removesThread)
                      focusOnClose = () => root?.querySelector<HTMLElement>("[data-panel-button]")
                    await current.run().catch((error) => {
                      focusOnClose = null
                      throw error
                    })
                    notify(current.done)
                  })
              }}
            >
              {confirm?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Assign the thread to someone in the project. The thread shows as unread for them. */
function AssignButton({ thread, assignee }: { thread: Thread; assignee: User | undefined }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [people, setPeople] = useState<User[]>([])

  useEffect(() => {
    if (!open) return
    let current = true
    const timer = setTimeout(() => {
      searchUsers(query.trim())
        .then((users) => current && setPeople(users))
        .catch(() => {})
    }, 150)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [open, query])

  const pick = (user: User | null) => {
    setOpen(false)
    setQuery("")
    setAssignee(thread, user?.id ?? null)
      .then(() => notify(user ? `Assigned to ${nameOf(user)}` : "Unassigned"))
      .catch((e: Error) => notify(e.message))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Assign"
            title={assignee ? `Assigned to ${nameOf(assignee)}` : "Assign"}
          />
        }
      >
        {assignee ? <UserAvatar user={assignee} className="size-5" /> : <UserCirclePlusIcon />}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-60 gap-1 p-1" aria-label="Assign">
        <InputGroup>
          <InputGroupAddon>
            <MagnifyingGlassIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            autoFocus
            aria-label="Search people"
            placeholder="Search people"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && people[0]) {
                e.preventDefault()
                pick(people[0])
              }
            }}
          />
        </InputGroup>
        <ul className="max-h-56 overflow-y-auto">
          {people.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md p-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => pick(user)}
              >
                <UserAvatar user={user} />
                <UserName user={user} className="flex-1" />
                {user.id === thread.assigneeId && <CheckIcon className="shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
        {assignee && (
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => pick(null)}>
            Unassign
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function CommentItem({
  comment,
  onDelete,
  onError,
}: {
  comment: Comment
  onDelete: () => void
  onError: (message: string) => void
}) {
  const author = useStore((s) => s.users[comment.authorId])
  const me = useStore((s) => s.session?.user)
  const [editing, setEditing] = useState(false)
  const own = me?.id === comment.authorId
  const name = nameOf(author)

  return (
    <article className="group/comment flex gap-2 px-3 py-1.5" aria-label={`Comment by ${name}`}>
      <UserAvatar user={author} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-h-6 items-center gap-1.5">
          <UserName user={author} className="font-medium text-sm" />
          <time
            className="shrink-0 text-muted-foreground text-xs"
            dateTime={new Date(comment.createdAt).toISOString()}
            title={fullDate(comment.createdAt)}
          >
            {timeAgo(comment.createdAt)}
          </time>
          {comment.editedAt && <span className="text-muted-foreground text-xs">(edited)</span>}
          <span className="flex-1" />
          {own && !editing && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Comment actions"
                    className="opacity-0 pointer-coarse:opacity-100 focus-visible:opacity-100 group-hover/comment:opacity-100 aria-expanded:opacity-100"
                  />
                }
              >
                <DotsThreeIcon weight="bold" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <PencilSimpleIcon />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <TrashIcon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {editing && own ? (
          <Composer
            draftKind={`edit:${comment.id}`}
            initial={comment.body as never}
            placeholder="Edit comment"
            label="Edit comment"
            submitLabel="Save"
            allowFiles={false}
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              await editComment(comment, body)
              setEditing(false)
            }}
          />
        ) : (
          comment.text && (
            <div className="text-sm/relaxed">
              <CommentBody body={comment.body} />
            </div>
          )
        )}
        {comment.files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {comment.files.map((file, i) => (
              <a
                key={file.id}
                href={fileUrl(file)}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-md border bg-muted"
                aria-label={`Open image ${i + 1} of ${comment.files.length} from ${name}`}
              >
                <img
                  src={fileUrl(file)}
                  alt=""
                  width={file.width}
                  height={file.height}
                  className="block h-auto max-h-40 w-auto max-w-full object-contain"
                  style={{ aspectRatio: `${file.width} / ${file.height}` }}
                />
              </a>
            ))}
          </div>
        )}
        <Reactions comment={comment} onError={onError} />
      </div>
    </article>
  )
}

function Reactions({ comment, onError }: { comment: Comment; onError: (message: string) => void }) {
  const me = useStore((s) => s.session?.user)
  const users = useStore((s) => s.users)
  const [open, setOpen] = useState(false)
  const react = (emoji: string) => {
    setOpen(false)
    toggleReaction(comment, emoji).catch((e: Error) => onError(e.message))
  }
  if (!me && comment.reactions.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      {comment.reactions.map((r) => {
        const mine = !!me && r.userIds.includes(me.id)
        const names = r.userIds.map((id) => nameOf(users[id])).join(", ")
        return (
          <Tooltip key={r.emoji}>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="xs"
                  aria-pressed={mine}
                  aria-label={`${r.emoji} ${r.userIds.length}: ${names}`}
                  disabled={!me}
                  className={cn(
                    "h-6 rounded-full px-1.5 text-xs",
                    mine && "border-primary bg-primary/15 hover:bg-primary/25",
                  )}
                  onClick={() => react(r.emoji)}
                />
              }
            >
              <span className="text-sm leading-none">{r.emoji}</span>
              <span className="tabular-nums">{r.userIds.length}</span>
            </TooltipTrigger>
            <TooltipContent>{names}</TooltipContent>
          </Tooltip>
        )
      })}
      {me && (
        <Popover open={open} onOpenChange={(next, details) => setOpen(next || pressInsideWidget(details))}>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Add reaction"
                title="Add reaction"
                className={cn(
                  "rounded-full",
                  comment.reactions.length === 0 &&
                    "opacity-0 pointer-coarse:opacity-100 focus-visible:opacity-100 group-hover/comment:opacity-100 aria-expanded:opacity-100",
                )}
              />
            }
          >
            <SmileyIcon />
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-auto flex-row gap-0.5 p-1">
            {QUICK_REACTIONS.map((emoji) => (
              <Button
                key={emoji}
                variant="ghost"
                size="icon-sm"
                aria-label={`React with ${emoji}`}
                onClick={() => react(emoji)}
              >
                <span className="text-base leading-none">{emoji}</span>
              </Button>
            ))}
            <EmojiButton label="More reactions" onSelect={react} />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
