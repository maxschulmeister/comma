import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  CheckIcon,
  DotsThreeIcon,
  EnvelopeSimpleIcon,
  LinkSimpleIcon,
  PencilSimpleIcon,
  SmileyIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react"
import { cn } from "cn"
import { type RefObject, useEffect, useState } from "react"
import { deleteComment, deleteThread, editComment, fileUrl, reply, setRead, setStatus, toggleReaction } from "@/client"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { pressInsideWidget } from "@/lib/dom"
import { fullDate, timeAgo } from "@/lib/format"
import { setState, useStore } from "@/store"
import type { Comment, Thread } from "@/types"
import { CommentBody } from "./body"
import { Composer } from "./composer"
import { EmojiButton, QUICK_REACTIONS } from "./emoji"
import { SignInForm } from "./sign-in"
import { UserAvatar } from "./user-avatar"

export const threadLink = (thread: Thread) => `${location.origin}${thread.page}#comma=${thread.id}`

type Confirm = { title: string; description: string; action: string; run: () => Promise<unknown> }

/** The content of the thread popover: comments, reactions, actions and the reply box. */
export function ThreadView({
  thread,
  detached,
  listRef,
}: {
  thread: Thread
  detached?: boolean
  /** The comment list. The popover focuses it first, so no button (and its tooltip) gets the focus. */
  listRef: RefObject<HTMLDivElement | null>
}) {
  const me = useStore((s) => s.session?.user)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const close = () => setState({ openThreadId: null })

  // Opening a thread marks it as read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the thread opens.
  useEffect(() => {
    if (thread.unread && me) setRead(thread, true).catch(() => {})
  }, [thread.id])

  // Show the newest comment.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a comment is added.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [thread.comments.length])

  const act = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.")
    }
  }

  const resolved = thread.status === "resolved"
  const canDeleteThread = !!me && (me.id === thread.createdBy || me.isAdmin)

  return (
    <div className="flex max-h-[min(560px,calc(100vh-32px))] flex-col" data-slot="thread">
      <div className="flex items-center gap-0.5 border-b py-1 pr-1 pl-3">
        <span className="flex-1 truncate font-medium text-xs">
          {copied ? "Link copied" : "Comment"}
          {detached && (
            <Badge variant="outline" className="ml-1.5">
              Detached
            </Badge>
          )}
        </span>
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
                      if (!resolved) close()
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
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                })
              }
            >
              <LinkSimpleIcon />
              Copy link
            </DropdownMenuItem>
            {me && (
              <DropdownMenuItem
                onClick={() =>
                  act(async () => {
                    close()
                    await setRead(thread, false)
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
                      action: "Delete",
                      run: async () => {
                        await deleteThread(thread)
                      },
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

      <div ref={listRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto py-1 outline-none">
        {resolved && (
          <p className="flex items-center gap-1.5 px-3 py-1 text-muted-foreground text-xs">
            <CheckIcon /> Resolved
          </p>
        )}
        {thread.comments.map((comment, index) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            onDelete={() =>
              setConfirm(
                index === 0
                  ? {
                      title: "Delete thread?",
                      description: "This is the first comment. Deleting it deletes the thread and all its replies.",
                      action: "Delete",
                      run: () => deleteComment(comment),
                    }
                  : {
                      title: "Delete comment?",
                      description: "You cannot undo this.",
                      action: "Delete",
                      run: () => deleteComment(comment),
                    },
              )
            }
            onError={setError}
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="px-3 pb-1 text-destructive text-xs">
          {error}
        </p>
      )}

      <div className="border-t p-2">
        {me ? (
          <Composer
            key={thread.id}
            draftKey={`reply:${thread.id}`}
            placeholder="Reply"
            label="Reply"
            submitLabel="Send reply"
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
                const run = confirm?.run
                setConfirm(null)
                if (run) void act(run)
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
  const name = author?.name ?? "Unknown"

  return (
    <article className="group/comment flex gap-2 px-3 py-1.5" aria-label={`Comment by ${name}`}>
      <UserAvatar user={author} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-h-6 items-center gap-1.5">
          <span className="truncate font-medium text-xs">{name}</span>
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
                    className="opacity-0 focus-visible:opacity-100 group-hover/comment:opacity-100 aria-expanded:opacity-100"
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
        {editing ? (
          <Composer
            draftKey={`edit:${comment.id}`}
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
            <div className="text-xs/relaxed">
              <CommentBody body={comment.body} />
            </div>
          )
        )}
        {comment.files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {comment.files.map((file) => (
              <a
                key={file.id}
                href={fileUrl(file)}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-md border bg-muted"
                aria-label="Open image"
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
        const names = r.userIds.map((id) => users[id]?.name ?? "Unknown").join(", ")
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
                    "opacity-0 focus-visible:opacity-100 group-hover/comment:opacity-100 aria-expanded:opacity-100",
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
