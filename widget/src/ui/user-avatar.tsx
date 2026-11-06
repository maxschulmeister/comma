import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { initials, userColor } from "@/lib/format"
import type { User } from "@/types"

/** Avatar from the app token, else initials on a color from the user id. */
export function UserAvatar({
  user,
  size = "sm",
  className,
}: {
  user: User | undefined
  size?: "sm" | "default" | "lg"
  className?: string
}) {
  const name = user?.name ?? "Unknown"
  return (
    <Avatar size={size} className={className}>
      {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback
        className="font-medium text-white text-[10px] group-data-[size=sm]/avatar:text-[10px]"
        style={{ backgroundColor: user ? userColor(user.id) : undefined }}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
