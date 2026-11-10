// Tags on threads ("Bug", "Content"). The project config names some (or comma's defaults). People make more.
// A tag is its name: case does not matter, so "bug" and "Bug" are one tag.
import { z } from "zod"
import { sql } from "./db"

/** The widget maps each color to Tailwind colors (see widget/src/ui/tags.tsx). */
export const TAG_COLORS = ["gray", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const

export const TagSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[^\p{Cc}]+$/u, "A tag name is one line of text"),
  color: z.enum(TAG_COLORS),
})
export type TagInput = z.infer<typeof TagSchema>

/** A tag of the project. `createdBy`: null for the tags of the config. */
export type Tag = TagInput & { createdBy: string | null }

/** For projects without `tags` in the config. */
export const DEFAULT_TAGS: TagInput[] = [
  { name: "Bug", color: "red" },
  { name: "Change", color: "blue" },
  { name: "Content", color: "violet" },
  { name: "Design", color: "pink" },
  { name: "Question", color: "amber" },
  { name: "Idea", color: "green" },
]

/** The same key for the same name in any case. */
export const tagKey = (name: string) => name.trim().toLowerCase()

export type TagRow = { name: string; color: TagInput["color"]; created_by: string }

/** The tags that people made in the project, in the order of their names. */
export const customTagsSql = (project: string) =>
  sql("select name, color, created_by from tags where project = ? order by key", project)

/**
 * All tags of the project: the config's first, then the ones that people made. A tag that the config has too (added
 * to the config later) is the config's.
 */
export function projectTags(configTags: TagInput[], rows: TagRow[]): Tag[] {
  const inConfig = new Set(configTags.map((t) => tagKey(t.name)))
  return [
    ...configTags.map((t) => ({ ...t, createdBy: null })),
    ...rows
      .filter((r) => !inConfig.has(tagKey(r.name)))
      .map((r) => ({ name: r.name, color: r.color, createdBy: r.created_by })),
  ]
}
