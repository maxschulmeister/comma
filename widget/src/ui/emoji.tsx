import { SmileyIcon } from "@phosphor-icons/react"
import { lazy, Suspense, useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { getState } from "@/store"

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "🙏"]

export const emojiBaseUrl = () => `${getState().server}/w/emoji`

type EmojiEntry = { label: string; emoji: string; tags?: string[]; group?: number }

let data: Promise<EmojiEntry[]> | null = null

function loadEmoji() {
  data ??= fetch(`${emojiBaseUrl()}/en/data.json`)
    .then((r) => r.json() as Promise<EmojiEntry[]>)
    // Group 2 is skin tone and hair components. Entries without a group are regional indicators.
    .then((list) => list.filter((e) => e.group !== undefined && e.group !== 2))
    .catch(() => {
      data = null
      return []
    })
  return data
}

export const emojiName = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")

/** `:name:` autocomplete. Names that start with the query come first, then tags. */
export async function searchEmoji(query: string) {
  const q = query.toLowerCase()
  const list = await loadEmoji()
  const scored: { entry: EmojiEntry; score: number }[] = []
  for (const entry of list) {
    const name = emojiName(entry.label)
    const score = name.startsWith(q)
      ? 0
      : name.includes(`_${q}`)
        ? 1
        : entry.tags?.some((t) => t.startsWith(q))
          ? 2
          : -1
    if (score >= 0) scored.push({ entry, score })
    if (scored.length > 200) break
  }
  scored.sort((a, b) => a.score - b.score)
  return scored
    .slice(0, 8)
    .map(({ entry }) => ({ id: emojiName(entry.label), label: entry.emoji, detail: `:${emojiName(entry.label)}:` }))
}

const Picker = lazy(() => import("./emoji-picker"))

/** Emoji picker button. Loads the picker and its data on first open. */
export function EmojiButton({
  onSelect,
  label = "Add emoji",
  className,
}: {
  onSelect: (emoji: string) => void
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} className={className} />
        }
      >
        <SmileyIcon />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" side="top" align="start" collisionPadding={8}>
        <Suspense
          fallback={
            <div className="flex h-80 w-72 items-center justify-center">
              <Spinner />
            </div>
          }
        >
          <Picker
            onSelect={(emoji) => {
              setOpen(false)
              onSelect(emoji)
            }}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}
