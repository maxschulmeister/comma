import { SmileyIcon } from "@phosphor-icons/react"
import { lazy, Suspense, useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { afterEvent } from "@/lib/dom"
import { getState } from "@/store"

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "🙏"]

export const emojiBaseUrl = () => `${getState().server}/w/emoji`

type EmojiEntry = { label: string; hexcode: string; emoji: string; tags?: string[]; group?: number }
type Entry = { emoji: string; names: string[]; label: string; tags: string[] }

let data: Promise<Entry[]> | null = null

// Emoji data (Emojibase) with Slack names (`:tada:`). Loads once, on the first `:`.
function loadEmoji() {
  data ??= Promise.all([
    fetch(`${emojiBaseUrl()}/en/data.json`).then((r) => r.json() as Promise<EmojiEntry[]>),
    fetch(`${emojiBaseUrl()}/en/shortcodes/iamcal.json`).then((r) => r.json() as Promise<Record<string, string | string[]>>),
  ])
    .then(([list, shortcodes]) =>
      // Group 2 is skin tone and hair parts. Entries without a group are regional indicators.
      list
        .filter((e) => e.group !== undefined && e.group !== 2)
        .map((e) => {
          const codes = shortcodes[e.hexcode]
          const names = codes ? (Array.isArray(codes) ? codes : [codes]) : []
          return { emoji: e.emoji, names, label: e.label.toLowerCase(), tags: e.tags ?? [] }
        }),
    )
    .catch(() => {
      data = null
      return []
    })
  return data
}

/** `:name:` autocomplete. Slack names that start with the query come first, then words, then tags. */
export async function searchEmoji(query: string) {
  const q = query.toLowerCase()
  const scored: { entry: Entry; score: number }[] = []
  for (const entry of await loadEmoji()) {
    let score = -1
    if (entry.names.some((n) => n.startsWith(q))) score = 0
    else if (entry.names.some((n) => n.includes(`_${q}`))) score = 1
    else if (entry.label.startsWith(q) || entry.label.includes(` ${q}`)) score = 2
    else if (entry.tags.some((t) => t.startsWith(q))) score = 3
    if (score >= 0) scored.push({ entry, score })
  }
  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, 8).map(({ entry }) => {
    const name = entry.names[0] ?? entry.label.replace(/[^a-z0-9]+/g, "_")
    return { id: name, label: entry.emoji, detail: `:${name}:` }
  })
}

const Picker = lazy(() => import("./emoji-picker"))

/** Emoji picker button. Loads the picker and its data on first open. */
export function EmojiButton({
  onSelect,
  label = "Add emoji",
  className,
  returnFocus,
}: {
  onSelect: (emoji: string) => void
  label?: string
  className?: string
  /** Where the focus goes after a pick. Default: the button. */
  returnFocus?: () => HTMLElement | null | undefined
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
      <PopoverContent
        className="w-auto p-0"
        side="top"
        align="start"
        collisionPadding={8}
        finalFocus={returnFocus ? () => returnFocus() ?? true : true}
      >
        <Suspense
          fallback={
            <div className="flex h-80 w-72 items-center justify-center">
              <Spinner />
            </div>
          }
        >
          <Picker
            onSelect={(emoji) =>
              afterEvent(() => {
                setOpen(false)
                onSelect(emoji)
              })
            }
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}
