// Comment body: Tiptap JSON. Only the nodes and marks of the composer are allowed.
// Unknown attributes are dropped. Anything else is rejected.
import { z } from "zod"

export const MAX_BODY_BYTES = 40_000
export const MAX_TEXT_LENGTH = 10_000

const href = z
  .string()
  .max(2000)
  .refine((h) => /^(https?:|mailto:)/i.test(h), "Links must use http, https or mailto")

const mark = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("strike") }),
  z.object({ type: z.literal("code") }),
  z.object({ type: z.literal("link"), attrs: z.object({ href }) }),
])

const inline = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1), marks: z.array(mark).max(5).optional() }),
  z.object({ type: z.literal("hardBreak") }),
  z.object({
    type: z.literal("mention"),
    attrs: z.object({ id: z.string().min(1).max(100), label: z.string().max(200).nullable().optional() }),
  }),
])

const paragraph = z.object({ type: z.literal("paragraph"), content: z.array(inline).optional() })

type Block =
  | z.infer<typeof paragraph>
  | { type: "bulletList"; content: ListItem[] }
  | { type: "orderedList"; attrs?: { start?: number }; content: ListItem[] }
type ListItem = { type: "listItem"; content: Block[] }

const listItem: z.ZodType<ListItem> = z.lazy(() =>
  z.object({ type: z.literal("listItem"), content: z.array(block).min(1) }),
)
const block: z.ZodType<Block> = z.lazy(() =>
  z.discriminatedUnion("type", [
    paragraph,
    z.object({ type: z.literal("bulletList"), content: z.array(listItem).min(1) }),
    z.object({
      type: z.literal("orderedList"),
      attrs: z.object({ start: z.number().int().min(0).max(100_000).optional() }).optional(),
      content: z.array(listItem).min(1),
    }),
  ]),
)

export const BodySchema = z.object({ type: z.literal("doc"), content: z.array(block).min(1) })
export type Body = z.infer<typeof BodySchema>

type Node = { type: string; text?: string; attrs?: { id?: string; label?: string | null }; content?: Node[] }

// Plain text (for search and previews) and mentioned user ids.
export function readBody(body: Body) {
  const mentions = new Set<string>()
  const blockText = (node: Node): string => {
    if (node.type === "text") return node.text ?? ""
    if (node.type === "hardBreak") return "\n"
    if (node.type === "mention") {
      if (node.attrs?.id) mentions.add(node.attrs.id)
      return `@${node.attrs?.label ?? node.attrs?.id ?? ""}`
    }
    const children = node.content ?? []
    if (node.type === "paragraph") return children.map(blockText).join("")
    return children.map(blockText).join("\n")
  }
  const text = (body.content as Node[]).map(blockText).join("\n").trim()
  return { text, mentions: [...mentions] }
}

export function parseBody(input: unknown) {
  if (JSON.stringify(input ?? null).length > MAX_BODY_BYTES) return { error: "The comment is too long" } as const
  const parsed = BodySchema.safeParse(input)
  if (!parsed.success) return { error: "The comment has content that is not allowed" } as const
  const { text, mentions } = readBody(parsed.data)
  if (text.length > MAX_TEXT_LENGTH) return { error: "The comment is too long" } as const
  return { body: parsed.data, text, mentions } as const
}
