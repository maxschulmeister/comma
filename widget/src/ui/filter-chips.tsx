// The filter chips below the panel's search: "Tag is Bug", "Started by is not Ann". Click "is" to change it to "is not",
// click the values to change them, × removes the chip. The filter menu adds chips (see panel.tsx).
import { XIcon } from "@phosphor-icons/react"
import { cn } from "cn"
import { type ReactNode, type RefObject, useMemo, useRef, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { FIELD_LABELS, type FilterField, type FilterRule, UNASSIGNED, valuesOf } from "@/lib/filters"
import { sameName } from "@/lib/format"
import { getState, useStore } from "@/store"
import { PickerOption, PickerSearch } from "./picker"
import { tagDot } from "./tags"
import { UserAvatar } from "./user-avatar"
import { UserName } from "./user-name"

const opLabel = (rule: FilterRule) =>
  rule.values.length > 1 ? (rule.op === "is" ? "is any of" : "is none of") : rule.op === "is" ? "is" : "is not"

/** A value a chip can have. `label`: for the search and the chip. `content`: the row in the picker. */
type Option = { value: string; label: string; content: ReactNode }

/** The values a chip can have: the project's tags, or the people of the threads (me first). */
function useOptions(field: FilterField, chosen: string[]): Option[] {
  const tags = useStore((s) => s.tags)
  const threads = useStore((s) => s.threads)
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.session?.user.id)
  return useMemo(() => {
    const text = (label: string) => <span className="min-w-0 flex-1 truncate">{label}</span>
    if (field === "tag") {
      return tags.map((t) => ({
        value: t.name,
        label: t.name,
        content: (
          <>
            <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", tagDot(t.color))} />
            {text(t.name)}
          </>
        ),
      }))
    }
    // The values that are chosen stay, also when their threads are gone: they can be taken off.
    const ids = new Set(chosen)
    for (const t of threads) for (const id of valuesOf(t, field)) ids.add(id)
    ids.delete(UNASSIGNED)
    const name = (id: string) => users[id]?.name ?? "Unknown"
    // The guest mark shows, as in the other lists: anyone can sign in as a guest with any name.
    const person = (id: string) => ({
      value: id,
      label: name(id),
      content: (
        <>
          <UserAvatar user={users[id]} />
          <UserName user={users[id]} className="flex-1" />
        </>
      ),
    })
    const unassigned = {
      value: UNASSIGNED,
      label: "Unassigned",
      content: (
        <>
          <span aria-hidden className="size-6 shrink-0 rounded-full border border-muted-foreground border-dashed" />
          {text("Unassigned")}
        </>
      ),
    }
    const others = [...ids].filter((id) => id !== me).sort((a, b) => name(a).localeCompare(name(b)))
    return [...(field === "assignee" ? [unassigned] : []), ...(me ? [person(me)] : []), ...others.map(person)]
  }, [field, chosen, tags, threads, users, me])
}

/** The values of a chip: a search field, and the choices with a check. */
function FilterPicker({
  rule,
  options,
  onToggle,
}: {
  rule: FilterRule
  options: Option[]
  onToggle: (value: string) => void
}) {
  const [query, setQuery] = useState("")
  const matching = (text: string) => options.filter((o) => o.label.toLowerCase().includes(text.trim().toLowerCase()))
  const shown = matching(query)
  return (
    <>
      <PickerSearch
        label={rule.field === "tag" ? "Search tags" : "Search people"}
        value={query}
        onChange={setQuery}
        // An exact match first, then the first match (as in the tag picker of a thread).
        onEnter={(text) => {
          const found = matching(text)
          const match = found.find((o) => sameName(o.label, text)) ?? found[0]
          if (match) onToggle(match.value)
        }}
      />
      <ul className="max-h-56 overflow-y-auto">
        {shown.map((o) => (
          <li key={o.value}>
            <PickerOption
              checked={rule.values.includes(o.value)}
              aria-pressed={rule.values.includes(o.value)}
              onClick={() => onToggle(o.value)}
            >
              {o.content}
            </PickerOption>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="p-1.5 text-muted-foreground text-sm">No matches</p>}
    </>
  )
}

const part =
  "flex h-full items-center border-l px-1.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"

/** Changes a chip: a new rule, or `null` to remove it. */
type ChangeChip = (change: (rule: FilterRule) => FilterRule | null) => void

function FilterChip({
  rule,
  editing,
  onEditingChange,
  onChange,
  returnFocus,
}: {
  rule: FilterRule
  editing: boolean
  onEditingChange: (open: boolean) => void
  onChange: ChangeChip
  returnFocus: RefObject<HTMLElement | null>
}) {
  const options = useOptions(rule.field, rule.values)
  // The chip stays after its picker closes: it has values.
  const stays = useRef(true)
  const label = FIELD_LABELS[rule.field]
  const op = opLabel(rule)
  const values = rule.values.map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ")
  const flip = (r: FilterRule): FilterRule => ({ ...r, op: r.op === "is" ? "is not" : "is" })
  const toggle = (value: string) =>
    onChange((r) => ({
      ...r,
      values: r.values.includes(value) ? r.values.filter((v) => v !== value) : [...r.values, value],
    }))
  return (
    <fieldset
      aria-label={`${label} ${op} ${values}`}
      className="flex h-6 min-w-0 max-w-full items-center overflow-hidden rounded-md border bg-background text-xs"
    >
      <span className="shrink-0 px-1.5 text-muted-foreground">{label}</span>
      <button
        type="button"
        className={cn(part, "shrink-0 text-muted-foreground hover:text-foreground")}
        title={`Change to “${opLabel(flip(rule))}”`}
        onClick={() => onChange(flip)}
      >
        {op}
      </button>
      <Popover
        open={editing}
        onOpenChange={(open) => {
          onEditingChange(open)
          if (open) return
          // A chip that got no values goes.
          onChange((r) => {
            stays.current = r.values.length > 0
            return stays.current ? r : null
          })
        }}
      >
        <PopoverTrigger render={<button type="button" className={cn(part, "min-w-0 font-medium")} />}>
          <span className="truncate">{values || "…"}</span>
        </PopoverTrigger>
        {/* The focus goes back to the chip, or to the filter menu when the chip has gone. */}
        <PopoverContent
          align="start"
          className="w-60 gap-1 p-1"
          aria-label={label}
          finalFocus={() => stays.current || returnFocus.current}
        >
          <FilterPicker rule={rule} options={options} onToggle={toggle} />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label="Remove filter"
        title="Remove filter"
        className={cn(part, "shrink-0 px-1 text-muted-foreground hover:text-foreground [&_svg]:size-3")}
        onClick={() => {
          onChange(() => null)
          returnFocus.current?.focus()
        }}
      >
        <XIcon />
      </button>
    </fieldset>
  )
}

/**
 * The chips. `editing`: the chip whose picker is open. Changes start from the rules in the state, not from the last
 * render: it can be one render behind (see debounceRendering in main.tsx), and a quick second click must not undo the
 * first.
 */
export function FilterChips({
  onChange,
  editing,
  onEditingChange,
  returnFocus,
}: {
  onChange: (rules: FilterRule[]) => void
  editing: number | null
  onEditingChange: (index: number | null) => void
  returnFocus: RefObject<HTMLElement | null>
}) {
  const changeChip =
    (i: number): ChangeChip =>
    (change) => {
      const current = getState().filters.rules
      const rule = current[i]
      if (!rule) return
      const next = change(rule)
      // No change: no new rules. They would filter the list again, and that closes an open thread that they do not show.
      if (next === rule) return
      onChange(next ? current.map((r, j) => (j === i ? next : r)) : current.filter((_, j) => j !== i))
    }
  const rules = useStore((s) => s.filters.rules)
  if (rules.length === 0) return null
  return (
    <ul aria-label="Filters" className="flex flex-wrap gap-1">
      {rules.map((rule, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a chip is its place in the list; two chips can be the same.
        <li key={i} className="flex min-w-0 max-w-full">
          <FilterChip
            rule={rule}
            editing={editing === i}
            onEditingChange={(open) => onEditingChange(open ? i : null)}
            onChange={changeChip(i)}
            returnFocus={returnFocus}
          />
        </li>
      ))}
    </ul>
  )
}
