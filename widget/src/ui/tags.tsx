// Tags on threads ("Bug", "Content"): the pills, and the picker that adds and removes them.
import { PencilSimpleIcon, TagIcon } from "@phosphor-icons/react"
import { cn } from "cn"
import { useId, useRef, useState } from "react"
import { changeTag, createTag, setThreadTag } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { sameName } from "@/lib/format"
import { useStore } from "@/store"
import type { Tag, TagColor, Thread } from "@/types"
import { notify } from "./notices"
import { PickerOption, PickerSearch } from "./picker"

// In the order of the swatches. Gray last: a new tag gets a color that few tags have (see TagButton).
// Full class names, so Tailwind finds them. Pill text on its tint: 4.5:1 or more.
const STYLES: Record<TagColor, { pill: string; dot: string }> = {
  red: { pill: "bg-red-100 text-red-800", dot: "bg-red-500" },
  orange: { pill: "bg-orange-100 text-orange-800", dot: "bg-orange-500" },
  amber: { pill: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  green: { pill: "bg-green-100 text-green-800", dot: "bg-green-500" },
  teal: { pill: "bg-teal-100 text-teal-800", dot: "bg-teal-500" },
  blue: { pill: "bg-blue-100 text-blue-800", dot: "bg-blue-500" },
  violet: { pill: "bg-violet-100 text-violet-800", dot: "bg-violet-500" },
  pink: { pill: "bg-pink-100 text-pink-800", dot: "bg-pink-500" },
  gray: { pill: "bg-neutral-100 text-neutral-700", dot: "bg-neutral-500" },
}
const COLORS = Object.keys(STYLES) as TagColor[]
export const tagDot = (color: TagColor) => STYLES[color].dot
const colorName = (color: TagColor) => color[0].toUpperCase() + color.slice(1)

// The same as the server's limit.
const MAX_NAME = 32

/** The color of a tag of the project. Gray if the project does not have it. */
function useTagColor(name: string): TagColor {
  return useStore((s) => s.tags.find((t) => sameName(t.name, name))?.color ?? "gray")
}

export function TagPill({ name }: { name: string }) {
  const color = useTagColor(name)
  return (
    <Badge variant={null} data-slot="tag" className={cn("max-w-40 justify-start", STYLES[color].pill)}>
      {/* Its own box: a long name ends with "…". */}
      <span className="min-w-0 truncate">{name}</span>
    </Badge>
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

/** The color swatches, as radio buttons: arrow keys move between them. */
function ColorPicker({ value, onChange }: { value: TagColor; onChange: (color: TagColor) => void }) {
  const group = useId()
  return (
    <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-1.5 p-1.5">
      {COLORS.map((c) => (
        <input
          key={c}
          type="radio"
          name={group}
          aria-label={colorName(c)}
          title={colorName(c)}
          checked={c === value}
          onChange={() => onChange(c)}
          className={cn(
            "size-4 cursor-pointer appearance-none rounded-full outline-none ring-offset-2 ring-offset-popover checked:ring-2 checked:ring-foreground focus-visible:ring-2 focus-visible:ring-ring",
            tagDot(c),
          )}
        />
      ))}
    </div>
  )
}

/** Adds tags to the thread and removes them, and makes new tags. Anyone who is signed in can. */
export function TagButton({ thread }: { thread: Thread }) {
  const tags = useStore((s) => s.tags)
  const me = useStore((s) => s.session?.user)
  const [query, setQuery] = useState("")
  const [color, setColor] = useState<TagColor | null>(null)
  const [editing, setEditing] = useState<Tag | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const typed = query.trim()
  const matching = (text: string) => tags.filter((t) => t.name.toLowerCase().includes(text.toLowerCase()))
  const shown = matching(typed)
  const has = (name: string) => thread.tags.some((n) => sameName(n, name))
  const canCreate = (text: string) =>
    text.length > 0 && text.length <= MAX_NAME && !tags.some((t) => sameName(t.name, text))
  // The tags that people made: their creator and admins change them. The config's tags change in the config.
  const canEdit = (tag: Tag) => !!tag.createdBy && (tag.createdBy === me?.id || !!me?.isAdmin)
  // Unless the person chooses: the color that the fewest tags have.
  const count = (c: TagColor) => tags.filter((t) => t.color === c).length
  const newColor = color ?? COLORS.reduce((best, c) => (count(c) < count(best) ? c : best))

  const toggle = (name: string) =>
    setThreadTag(thread, name, !has(name)).catch(() => notify("Could not change the tags"))

  const create = async (name: string) => {
    try {
      const tag = await createTag(name, newColor)
      setQuery("")
      setColor(null)
      searchRef.current?.focus()
      await setThreadTag(thread, tag.name, true)
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not make the tag")
    }
  }

  // An exact match first, then the first match. No match: a new tag.
  const choose = (text: string) => {
    const found = matching(text)
    const match = found.find((t) => sameName(t.name, text)) ?? found[0]
    if (match) void toggle(match.name)
    else if (canCreate(text)) void create(text)
  }

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) return
        setQuery("")
        setColor(null)
        setEditing(null)
      }}
    >
      <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Tags" title="Tags" />}>
        <TagIcon />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-60 gap-1 p-1" aria-label="Tags">
        {editing ? (
          <TagEditor
            // A new form for each tag.
            key={editing.name}
            tag={editing}
            onDone={() => {
              setEditing(null)
              // After the form has gone: the search field is back.
              requestAnimationFrame(() => searchRef.current?.focus())
            }}
          />
        ) : (
          <>
            <PickerSearch ref={searchRef} label="Search tags" value={query} onChange={setQuery} onEnter={choose} />
            <ul className="max-h-56 overflow-y-auto">
              {shown.map((tag) => (
                <li key={tag.name} className="group/tag relative">
                  <PickerOption
                    checked={has(tag.name)}
                    aria-pressed={has(tag.name)}
                    className={cn(canEdit(tag) && "pr-8")}
                    onClick={() => void toggle(tag.name)}
                  >
                    <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", tagDot(tag.color))} />
                    <span className="flex-1 truncate">{tag.name}</span>
                  </PickerOption>
                  {canEdit(tag) && (
                    // Shows with the row (hover or focus), and always on touch screens.
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Edit ${tag.name}`}
                      title="Edit"
                      className="absolute top-1 right-1 opacity-0 focus-visible:opacity-100 group-hover/tag:opacity-100 [@media(hover:none)]:opacity-100"
                      onClick={() => setEditing(tag)}
                    >
                      <PencilSimpleIcon />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {canCreate(typed) && (
              <div className="flex flex-col gap-1 border-t pt-1">
                <ColorPicker value={newColor} onChange={setColor} />
                <Button variant="ghost" size="sm" className="justify-start" onClick={() => void create(typed)}>
                  <span className="truncate">Create “{typed}”</span>
                </Button>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Changes the name and color of a tag, or deletes it from the project, after a confirmation. */
function TagEditor({ tag, onDone }: { tag: Tag; onDone: () => void }) {
  const [name, setName] = useState(tag.name)
  const [color, setColor] = useState(tag.color)
  const [confirming, setConfirming] = useState(false)

  const run = async (change: { name: string; color: TagColor } | null) => {
    try {
      await changeTag(tag, change)
      onDone()
      if (!change) notify("Tag deleted")
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not change the tag")
    }
  }

  if (confirming)
    return (
      <div className="flex flex-col gap-2 p-1.5">
        <p className="text-pretty text-sm">Delete “{tag.name}”? It goes off all threads.</p>
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" autoFocus onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={() => void run(null)}>
            Delete tag
          </Button>
        </div>
      </div>
    )

  return (
    <form
      className="flex flex-col gap-1 p-0.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) void run({ name: name.trim(), color })
      }}
    >
      <Input aria-label="Name" value={name} maxLength={MAX_NAME} autoFocus onChange={(e) => setName(e.target.value)} />
      <ColorPicker value={color} onChange={setColor} />
      <div className="flex gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => setConfirming(true)}
        >
          Delete
        </Button>
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!name.trim()}>
          Save
        </Button>
      </div>
    </form>
  )
}
