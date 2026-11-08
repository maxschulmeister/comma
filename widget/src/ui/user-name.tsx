import { cn } from "cn"
import type { User } from "@/types"

/** A name, with "Guest" after it for guests: anyone can sign in as a guest with any name. */
export function UserName({ user, className }: { user: User | undefined; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-baseline gap-1", className)}>
      <span className="truncate">{user?.name ?? "Unknown"}</span>{" "}
      {user?.kind === "guest" && <span className="shrink-0 font-normal text-muted-foreground text-xs">Guest</span>}
    </span>
  )
}

/** For accessible names: "Ada Lee (guest)". */
export const nameOf = (user: User | undefined) =>
  `${user?.name ?? "Unknown"}${user?.kind === "guest" ? " (guest)" : ""}`
