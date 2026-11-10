// The filter chips of the panel: "Tag is Bug", "Started by is not Ann". Plain data, kept with the review (view.ts).
import type { Thread } from "@/types"
import { sameName } from "./format"

/** The fields, in the order of the filter menu. */
export const FILTER_FIELDS = ["tag", "startedBy", "assignee"] as const
export type FilterField = (typeof FILTER_FIELDS)[number]
export const FIELD_LABELS: Record<FilterField, string> = { tag: "Tag", startedBy: "Started by", assignee: "Assignee" }

/** Threads whose field is one of the values ("is"), or none of them ("is not"). No values: all threads. */
export type FilterRule = { field: FilterField; op: "is" | "is not"; values: string[] }

/** The value of "Unassigned" in an Assignee rule. No user id is empty. */
export const UNASSIGNED = ""

/** The values of a thread for a field. */
export function valuesOf(thread: Thread, field: FilterField): string[] {
  if (field === "startedBy") return [thread.createdBy]
  if (field === "assignee") return [thread.assigneeId ?? UNASSIGNED]
  return thread.tags
}

/** The rules from storage. Keeps the valid ones with values. */
export function readRules(value: unknown): FilterRule[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((r) =>
    FILTER_FIELDS.includes(r?.field) &&
    (r.op === "is" || r.op === "is not") &&
    Array.isArray(r.values) &&
    r.values.length > 0 &&
    r.values.every((v: unknown) => typeof v === "string")
      ? [{ field: r.field, op: r.op, values: r.values }]
      : [],
  )
}

/**
 * Changes the tag names in the rules: another person can rename or delete a tag (`null`). A rule with no tags left goes
 * out. Nothing changed: the same rules.
 */
export function renameTags(rules: FilterRule[], rename: (name: string) => string | null): FilterRule[] {
  let changed = false
  const next = rules.flatMap((rule) => {
    if (rule.field !== "tag") return [rule]
    const values = rule.values.flatMap((name) => rename(name) ?? [])
    if (values.length === rule.values.length && values.every((v, i) => v === rule.values[i])) return [rule]
    changed = true
    return values.length > 0 ? [{ ...rule, values }] : []
  })
  return changed ? next : rules
}

/** A thread matches all rules. */
export function matchesRules(thread: Thread, rules: FilterRule[]) {
  return rules.every((rule) => {
    if (rule.values.length === 0) return true
    // Tag names: case does not matter. User ids: they must be the same.
    const same = rule.field === "tag" ? sameName : (a: string, b: string) => a === b
    const found = valuesOf(thread, rule.field).some((v) => rule.values.some((f) => same(f, v)))
    return rule.op === "is" ? found : !found
  })
}
