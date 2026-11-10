// Tags on threads ("Bug", "Content"): the pills, and the picker that adds and removes them.
import { CheckIcon, MagnifyingGlassIcon, PencilSimpleIcon, TagIcon } from "@phosphor-icons/react"
import { cn } from "cn"
import { useId, useRef, useState } from "react"
import { changeTag, createTag, setThreadTag } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useStore } from "@/store"
import type { Tag, TagColor, Thread } from "@/types"
import { notify } from "./notices"

// Full class names, so Tailwind finds them. Text on its tint: 4.5:1 or more.
const PILL: Record<TagColor, string> = {
  gray: "bg-neutral-100 text-neutral-700",
  red: "bg-red-100 text-red-800",
  orange: "bg-orange-100 text-orange-800",
  amber: "bg-amber-100 text-amber-800",
  green: "bg-green-100 text-green-800",
  teal: "bg-teal-100 text-teal-800",
  blue: "bg-blue-100 text-blue-800",
  violet: "bg-violet-100 text-violet-800",
  pink: "bg-pink-100 text-pink-800",
}

export const DOT: Record<TagColor, string> = {
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

// The order of the swatches. Gray last: a new tag gets a color that few tags have (see TagButton).
const COLORS: TagColor[] = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink", "gray"]
const colorName = (color: TagColor) => color[0].toUpperCase() + color.slice(1)

// The same as the server's limit.
const MAX_NAME = 32

export const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The color of a tag of the project. Gray if the project does not have it. */
function useTagColor(name: string): TagColor {
  return useStore((s) => s.tags.find((t) => sameName(t.name, name))?.color ?? "gray")
}

export function TagPill({ name, className }: { name: string; className?: string }) {
  const color = useTagColor(name)
  return (
    <span
      data-slot="tag"
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
            DOT[c],
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
  const name = query.trim()
  const q = name.toLowerCase()
  const shown = tags.filter((t) => t.name.toLowerCase().includes(q))
  const has = (name: string) => thread.tags.some((n) => sameName(n, name))
  const canCreate = name.length > 0 && name.length <= MAX_NAME && !tags.some((t) => sameName(t.name, name))
  // The tags that people made: their creator and admins change them. The config's tags change in the config.
  const canEdit = (tag: Tag) => !!tag.createdBy && (tag.createdBy === me?.id || !!me?.isAdmin)
  // Unless the person chooses: the color that the fewest tags have.
  const count = (c: TagColor) => tags.filter((t) => t.color === c).length
  const newColor = color ?? COLORS.reduce((best, c) => (count(c) < count(best) ? c : best))

  const toggle = (name: string) =>
    setThreadTag(thread, name, !has(name)).catch(() => notify("Could not change the tags"))

  const create = async () => {
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
            <InputGroup>
              <InputGroupAddon>
                <MagnifyingGlassIcon />
              </InputGroupAddon>
              <InputGroupInput
                ref={searchRef}
                type="search"
                autoFocus
                aria-label="Search tags"
                placeholder="Search tags"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return
                  e.preventDefault()
                  const match = shown.find((t) => sameName(t.name, name)) ?? shown[0]
                  if (match) void toggle(match.name)
                  else if (canCreate) void create()
                }}
              />
            </InputGroup>
            <ul className="max-h-56 overflow-y-auto">
              {shown.map((tag) => (
                <li key={tag.name} className="group/tag relative">
                  <button
                    type="button"
                    aria-pressed={has(tag.name)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md p-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                      canEdit(tag) && "pr-8",
                    )}
                    onClick={() => void toggle(tag.name)}
                  >
                    <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOT[tag.color])} />
                    <span className="flex-1 truncate">{tag.name}</span>
                    {has(tag.name) && <CheckIcon className="shrink-0" />}
                  </button>
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
            {canCreate && (
              <div className="flex flex-col gap-1 border-t pt-1">
                <ColorPicker value={newColor} onChange={setColor} />
                <Button variant="ghost" size="sm" className="justify-start" onClick={() => void create()}>
                  <span className="truncate">Create “{name}”</span>
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
