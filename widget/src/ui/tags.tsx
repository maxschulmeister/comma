// Tags on threads ("Bug", "Content"): the pills, and the picker that adds and removes them.
import { CheckIcon, MagnifyingGlassIcon, TagIcon } from "@phosphor-icons/react"
import { cn } from "cn"
import { useState } from "react"
import { setThreadTag } from "@/client"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useStore } from "@/store"
import type { TagColor, Thread } from "@/types"
import { notify } from "./notices"

// Full class names, so Tailwind finds them. Text on its tint: 4.5:1 or more in both themes.
const PILL: Record<TagColor, string> = {
  gray: "bg-neutral-100 text-neutral-700 dark:bg-neutral-500/20 dark:text-neutral-300",
  red: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  green: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  pink: "bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-300",
}

const DOT: Record<TagColor, string> = {
  gray: "bg-neutral-500",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The color of a tag of the project. Gray if the project does not have it. */
function useTagColor(name: string): TagColor {
  return useStore((s) => s.tags.find((t) => sameName(t.name, name))?.color ?? "gray")
}

export function TagPill({ name, className }: { name: string; className?: string }) {
  const color = useTagColor(name)
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-40 items-center truncate rounded-full px-2 font-medium text-xs",
        PILL[color],
        className,
      )}
    >
      {name}
    </span>
  )
}

/** The tags of a thread, as pills. */
export function TagList({ names, className }: { names: string[]; className?: string }) {
  return (
    <ul aria-label="Tags" className={cn("flex flex-wrap gap-1", className)}>
      {names.map((name) => (
        <li key={name} className="flex min-w-0">
          <TagPill name={name} />
        </li>
      ))}
    </ul>
  )
}

/** Adds tags to the thread and removes them. Anyone who is signed in can. */
export function TagButton({ thread }: { thread: Thread }) {
  const tags = useStore((s) => s.tags)
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const shown = tags.filter((t) => t.name.toLowerCase().includes(q))
  const has = (name: string) => thread.tags.some((n) => sameName(n, name))

  const toggle = (name: string) =>
    setThreadTag(thread, name, !has(name)).catch(() => notify("Could not change the tags"))

  return (
    <Popover onOpenChange={(open) => !open && setQuery("")}>
      <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Tags" title="Tags" />}>
        <TagIcon />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-60 gap-1 p-1" aria-label="Tags">
        <InputGroup>
          <InputGroupAddon>
            <MagnifyingGlassIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            autoFocus
            aria-label="Search tags"
            placeholder="Search tags"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]) {
                e.preventDefault()
                void toggle(shown[0].name)
              }
            }}
          />
        </InputGroup>
        <ul className="max-h-56 overflow-y-auto">
          {shown.map((tag) => (
            <li key={tag.name}>
              <button
                type="button"
                aria-pressed={has(tag.name)}
                className="flex w-full items-center gap-2 rounded-md p-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => void toggle(tag.name)}
              >
                <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOT[tag.color])} />
                <span className="flex-1 truncate">{tag.name}</span>
                {has(tag.name) && <CheckIcon className="shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
