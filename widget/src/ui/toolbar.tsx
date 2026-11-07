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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { setState, useStore } from "@/store"
import { setCommentMode, togglePins } from "./shortcuts"
import { SignInForm } from "./sign-in"
import { UserAvatar } from "./user-avatar"
import { panelSide } from "./view"

/**
 * Small floating bar: comment mode, show or hide the pins, panel with unread count, user menu. It does not move: it stays in the bottom
 * corner on the panel's side, so the open panel takes it in, and the same click opens and closes the panel.
 * Narrow screens: centered, also over the panel, which then covers the screen.
 * Over the page it floats (ring and shadow). In the open panel it is part of the panel: no ring, no shadow. They go
 * with the panel's slide-in (150 ms).
 */
export function Toolbar() {
  const commentMode = useStore((s) => s.commentMode)
  const panelOpen = useStore((s) => s.panelOpen)
  const side = useStore(panelSide)
  const align = side === "left" ? "start" : "end"
  const pinsVisible = useStore((s) => s.pinsVisible)
  const key = useStore((s) => s.shortcut?.toUpperCase())
  const me = useStore((s) => s.session?.user)
  const unread = useStore((s) => s.threads.filter((t) => t.unread && t.status === "open").length)
  const [signInAnchor, setSignInAnchor] = useState<HTMLElement | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)

  // Mirrored with the panel on the left: the account is at the outer corner on both sides.
  const items = [
    <Tooltip key="comment">
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
    </Tooltip>,
    <Tooltip key="eye">
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            data-pins-button
            // Hiding takes the open thread off the page, and showing brings it back: a click here keeps it until then.
            data-keeps-thread
            aria-label={pinsVisible ? "Hide comments" : "Show comments"}
            onClick={togglePins}
          />
        }
      >
        {pinsVisible ? <EyeIcon /> : <EyeSlashIcon />}
      </TooltipTrigger>
      <TooltipContent>
        {pinsVisible ? "Hide comments" : "Show comments"} {key && <Kbd>⇧{key}</Kbd>}
      </TooltipContent>
    </Tooltip>,
    <Tooltip key="panel">
      <TooltipTrigger
        render={
          <Button
            variant={panelOpen ? "secondary" : "ghost"}
            size="icon"
            className="relative rounded-full"
            data-panel-button
            // Opening the panel keeps the open thread: its item shows there.
            data-keeps-thread
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
    </Tooltip>,
    <DropdownMenu key="account">
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
      <DropdownMenuContent align={align} side="top" className="w-52">
        {me && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate">
                {me.name}
                {me.kind === "guest" && " (guest)"}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
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
    </DropdownMenu>,
  ]

  return (
    <div
      role="toolbar"
      aria-label="Comments"
      data-slot="toolbar"
      className={cn(
        "fixed bottom-4 flex items-center gap-0.5 rounded-full bg-background p-1 ring-foreground/10 transition-shadow duration-150 ease-out max-[639px]:left-1/2 max-[639px]:-translate-x-1/2",
        side === "left" ? "min-[640px]:left-4" : "min-[640px]:right-4",
        panelOpen ? "shadow-none ring-0" : "shadow-lg ring-1",
      )}
    >
      {side === "left" ? items.toReversed() : items}

      <Popover open={signInOpen && !me} onOpenChange={setSignInOpen}>
        <PopoverContent anchor={signInAnchor} side="top" align={align} className="w-64">
          <SignInForm title="Sign in" />
        </PopoverContent>
      </Popover>
    </div>
  )
}
