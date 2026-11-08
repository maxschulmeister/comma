// Names for page elements: "Heading: Pricing". For screen readers in comment mode, and for thread headers.

const KINDS: Record<string, string> = {
  p: "Paragraph",
  li: "List item",
  img: "Image",
  svg: "Image",
  a: "Link",
  button: "Button",
  input: "Field",
  textarea: "Field",
  select: "Field",
  table: "Table",
}

export function kindOf(tag: string, role?: string | null) {
  if (/^h[1-6]$/.test(tag)) return "Heading"
  if (role === "img") return "Image"
  return KINDS[tag] ?? "Element"
}

/** The start of a text, on one line, without a final period. */
export const shortText = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[.!?]$/, "")

/** "Heading: Pricing", or "Image" without text. */
export function describe(kind: string, text: string) {
  const short = shortText(text)
  return short ? `${kind}: ${short}` : kind
}
