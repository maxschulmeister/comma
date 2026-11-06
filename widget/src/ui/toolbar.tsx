import {
  ChatCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  SignInIcon,
  SignOutIcon,
  TrayIcon,
  UserIcon,
} from "@phosphor-icons/react"
import { cn } from "cn"
import { useState } from "react"
import { signOut } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { NARROW, useMedia } from "@/lib/media"
import { setState, useStore } from "@/store"
import { PANEL_WIDTH } from "./panel"
import { setCommentMode, togglePins } from "./shortcuts"
import { SignInForm } from "./sign-in"
import { UserAvatar } from "./user-avatar"

/** Small floating bar: comment mode, panel with unread count, user menu. */
export function Toolbar() {
  const commentMode = useStore((s) => s.commentMode)
  const panelOpen = useStore((s) => s.panelOpen)
  const pinsVisible = useStore((s) => s.pinsVisible)
  const key = useStore((s) => s.shortcut?.toUpperCase())
  const me = useStore((s) => s.session?.user)
  const unread = useStore((s) => s.threads.filter((t) => t.unread && t.status === "open").length)
  const narrow = useMedia(NARROW)
  const [signInAnchor, setSignInAnchor] = useState<HTMLElement | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)

  // On narrow screens the open panel covers the screen and has its own close button.
  if (narrow && panelOpen) return null
  return (
    <div
      role="toolbar"
      aria-label="Comments"
      data-slot="toolbar"
      className="fixed bottom-4 flex items-center gap-0.5 rounded-full bg-background p-1 shadow-lg ring-1 ring-foreground/10 max-[639px]:left-1/2 max-[639px]:-translate-x-1/2"
      style={{ right: narrow ? undefined : panelOpen ? PANEL_WIDTH + 16 : 16 }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={commentMode ? "default" : "ghost"}
              size="icon"
              className="rounded-full"
              aria-label="Comment mode"
              aria-pressed={commentMode}
              onClick={() => setCommentMode(!commentMode)}
            />
          }
        >
          <ChatCircleIcon weight={commentMode ? "fill" : "regular"} />
        </TooltipTrigger>
        <TooltipContent>Comment {key && <Kbd>{key}</Kbd>}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={panelOpen ? "secondary" : "ghost"}
              size="icon"
              className="relative rounded-full"
              data-panel-button
              aria-label={unread ? `Comments, ${unread} unread` : "Comments"}
              aria-pressed={panelOpen}
              onClick={() => setState({ panelOpen: !panelOpen })}
            />
          }
        >
          <TrayIcon />
          {unread > 0 && (
            <span
              aria-hidden
              data-slot="unread-count"
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 font-medium text-[10px] text-white tabular-nums"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent>All comments</TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              ref={setSignInAnchor}
              variant="ghost"
              size="icon"
              className={cn("rounded-full", me && "p-0.5")}
              aria-label={me ? `Account: ${me.name}` : "Account"}
            />
          }
        >
          {me ? <UserAvatar user={me} className="size-6" /> : <UserIcon />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-52">
          {me && (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate">
                {me.name}
                {me.kind === "guest" && " (guest)"}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          )}
          <DropdownMenuItem onClick={togglePins}>
            {pinsVisible ? <EyeSlashIcon /> : <EyeIcon />}
            {pinsVisible ? "Hide comments" : "Show comments"}
            {key && <DropdownMenuShortcut>⇧{key}</DropdownMenuShortcut>}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {me ? (
            <DropdownMenuItem onClick={signOut}>
              <SignOutIcon />
              Sign out
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setSignInOpen(true)}>
              <SignInIcon />
              Sign in
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover open={signInOpen && !me} onOpenChange={setSignInOpen}>
        <PopoverContent anchor={signInAnchor} side="top" align="end" className="w-64">
          <SignInForm title="Sign in" />
        </PopoverContent>
      </Popover>
    </div>
  )
}
