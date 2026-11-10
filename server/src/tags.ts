// Tags on threads ("Bug", "Content"). The project config names some (or comma's defaults). People make more.
// A tag is its name: case does not matter, so "bug" and "Bug" are one tag.
import { z } from "zod"

/** The widget maps each color to Tailwind colors for the light and dark theme. */
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
