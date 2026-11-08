// Renders a stored comment body (Tiptap JSON). Only known nodes and marks. No innerHTML.
import type { ReactNode } from "react"

type Mark = { type: string; attrs?: { href?: unknown } }
type Node = {
  type: string
  text?: string
  marks?: Mark[]
  attrs?: { id?: unknown; label?: unknown; start?: unknown }
  content?: Node[]
}

const safeHref = (href: unknown) => (typeof href === "string" && /^(https?:|mailto:)/i.test(href) ? href : null)

function renderText(node: Node, key: number) {
  let out: ReactNode = node.text ?? ""
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") out = <strong>{out}</strong>
    else if (mark.type === "italic") out = <em>{out}</em>
    else if (mark.type === "strike") out = <s>{out}</s>
    else if (mark.type === "code") out = <code>{out}</code>
    else if (mark.type === "link") {
      const href = safeHref(mark.attrs?.href)
      if (href)
        out = (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {out}
          </a>
        )
    }
  }
  return <span key={key}>{out}</span>
}

function renderNode(node: Node, key: number): ReactNode {
  const children = () => (node.content ?? []).map(renderNode)
  switch (node.type) {
    case "doc":
      return <>{children()}</>
    case "paragraph":
      return <p key={key}>{node.content?.length ? children() : <br />}</p>
    case "bulletList":
      return <ul key={key}>{children()}</ul>
    case "orderedList": {
      const start = typeof node.attrs?.start === "number" ? node.attrs.start : undefined
      return (
        <ol key={key} start={start}>
          {children()}
        </ol>
      )
    }
    case "listItem":
      return <li key={key}>{children()}</li>
    case "hardBreak":
      return <br key={key} />
    case "mention":
      return (
        <span key={key} className="comma-mention">
          @{String(node.attrs?.label ?? node.attrs?.id ?? "")}
        </span>
      )
    case "text":
      return renderText(node, key)
    default:
      return null
  }
}

export function CommentBody({ body }: { body: unknown }) {
  if (!body || typeof body !== "object") return null
  return <div className="comma-prose">{renderNode(body as Node, 0)}</div>
}
