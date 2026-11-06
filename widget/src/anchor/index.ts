// Anchors: what we store about the element a comment is pinned to, and how we find that element again.
// Rule: a comment never points to a wrong element. If we are not sure, `resolveAnchor` returns null (detached).

export type Box = { x: number; y: number; width: number; height: number }

export type Anchor = {
  selectors: { anchor?: string; id?: string; css?: string }
  tag: string
  /** First characters of the element text, or of its labels (alt, aria-label…) when it has no text. */
  text: string
  /** Text of nearby elements. Tells repeated elements apart ("Learn more" in three cards). */
  context: string
  /** Pin: position in % of the element box. */
  point?: { x: number; y: number }
  /** Region: box in % of the element box. Can be < 0 or > 100. */
  rect?: Box
  /** Viewport width when the comment was created. */
  viewport: number
}

const TEXT_LENGTH = 120
const CONTEXT_LENGTH = 60
const MIN_TEXT = 0.8
const MIN_SCORE = 0.75
const MIN_LEAD = 0.02

const normalize = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()

function textOf(el: Element) {
  const text = normalize(el.textContent).slice(0, TEXT_LENGTH)
  if (text) return text
  const labels = ["alt", "aria-label", "title", "placeholder", "name"].map((a) => el.getAttribute(a))
  const src = el.getAttribute("src")?.split(/[?#]/)[0]?.split("/").pop()
  return normalize([...labels, src].filter(Boolean).join(" ")).slice(0, TEXT_LENGTH)
}

// Text of the previous and next sibling. If the element has no siblings with text, use the parent's.
function contextOf(el: Element) {
  let node: Element | null = el
  for (let level = 0; node && node !== document.body && level < 4; level++) {
    const before = node.previousElementSibling ? normalize(node.previousElementSibling.textContent) : ""
    const after = node.nextElementSibling ? normalize(node.nextElementSibling.textContent) : ""
    if (before || after) return `${before.slice(-CONTEXT_LENGTH)}|${after.slice(0, CONTEXT_LENGTH)}`
    node = node.parentElement
  }
  return ""
}

// Ids made by frameworks change between builds or renders: ":r3:", "radix-…", "headlessui-…", "ember123".
export function isStableId(id: string) {
  return (
    /^[A-Za-z][\w-]*$/.test(id) &&
    !/\d{3,}/.test(id) &&
    !/^(radix|headlessui|react-aria|mui|ember|yui|ext-gen|base-ui|downshift|rc-|tw-)/i.test(id)
  )
}

const TEST_ATTRIBUTES = ["data-testid", "data-test", "data-cy"]

// A CSS path from the closest stable point (id, data-comment-anchor, test id, body). No class names.
function cssPath(el: Element) {
  const parts: string[] = []
  let node: Element | null = el
  while (node && node !== document.documentElement) {
    if (node === document.body) {
      parts.unshift("body")
      break
    }
    if (node.id && isStableId(node.id)) {
      parts.unshift(`#${CSS.escape(node.id)}`)
      break
    }
    const anchor = node.getAttribute("data-comment-anchor")
    if (anchor) {
      parts.unshift(`[data-comment-anchor="${CSS.escape(anchor)}"]`)
      break
    }
    const tag = node.localName
    const test = TEST_ATTRIBUTES.find((a) => node?.hasAttribute(a))
    if (test) {
      const part = `${tag}[${test}="${CSS.escape(node.getAttribute(test) ?? "")}"]`
      if (document.querySelectorAll(part).length === 1) {
        parts.unshift(part)
        break
      }
    }
    const parent: Element | null = node.parentElement
    const same = parent ? Array.from(parent.children).filter((c) => c.localName === tag) : []
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag)
    node = parent
  }
  return parts.join(" > ")
}

const round = (n: number) => Math.round(n * 100) / 100

export function createAnchor(el: Element, at: { point: { x: number; y: number } } | { rect: Box }): Anchor {
  const r = el.getBoundingClientRect()
  const px = (x: number) => (r.width ? ((x - r.left) / r.width) * 100 : 50)
  const py = (y: number) => (r.height ? ((y - r.top) / r.height) * 100 : 50)
  const anchor: Anchor = {
    selectors: {},
    tag: el.localName,
    text: textOf(el),
    context: contextOf(el),
    viewport: window.innerWidth,
  }
  const own = el.getAttribute("data-comment-anchor")
  if (own) anchor.selectors.anchor = own
  if (el.id && isStableId(el.id)) anchor.selectors.id = el.id
  anchor.selectors.css = cssPath(el)
  if ("point" in at) anchor.point = { x: round(px(at.point.x)), y: round(py(at.point.y)) }
  else {
    const { x, y, width, height } = at.rect
    anchor.rect = {
      x: round(px(x)),
      y: round(py(y)),
      width: round(r.width ? (width / r.width) * 100 : 100),
      height: round(r.height ? (height / r.height) * 100 : 100),
    }
  }
  return anchor
}

function bigrams(s: string) {
  const out = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

// 1 = same text, 0 = nothing in common (Dice coefficient on character pairs).
export function similarity(a: string, b: string) {
  a = a.toLowerCase()
  b = b.toLowerCase()
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const ga = bigrams(a)
  const gb = bigrams(b)
  let common = 0
  for (const [g, n] of ga) common += Math.min(n, gb.get(g) ?? 0)
  return (2 * common) / (a.length - 1 + (b.length - 1))
}

function query(selector: string | undefined) {
  if (!selector) return null
  try {
    return document.querySelector(selector)
  } catch {
    return null // A stored selector can be invalid in this browser.
  }
}

export function resolveAnchor(anchor: Anchor): Element | null {
  // A developer-made anchor is trusted.
  const own = anchor.selectors.anchor && query(`[data-comment-anchor="${CSS.escape(anchor.selectors.anchor)}"]`)
  if (own) return own

  const byId = query(anchor.selectors.id && `#${CSS.escape(anchor.selectors.id)}`)
  const byCss = query(anchor.selectors.css)

  // Fast path: the selector finds an element with the same text and context.
  for (const el of [byId, byCss]) {
    if (el?.localName === anchor.tag && textOf(el) === anchor.text && contextOf(el) === anchor.context) return el
  }

  // Score all elements with the same tag. The best must be clearly better than the second.
  let best: { el: Element; score: number } | null = null
  let second = 0
  for (const el of Array.from(document.getElementsByTagName(anchor.tag))) {
    if (el.closest("comma-widget")) continue
    const text = similarity(textOf(el), anchor.text)
    if (text < MIN_TEXT) continue
    let score = text * 0.7 + similarity(contextOf(el), anchor.context) * 0.3
    if (el === byId) score += 0.05
    if (el === byCss) score += 0.03
    if (!best || score > best.score) {
      second = best?.score ?? 0
      best = { el, score }
    } else if (score > second) second = score
  }
  if (!best || best.score < MIN_SCORE || best.score - second < MIN_LEAD) return null
  return best.el
}

// The pin point (width and height 0) or the region, in viewport coordinates.
export function anchorBox(anchor: Anchor, el: Element): Box {
  const r = el.getBoundingClientRect()
  if (anchor.rect) {
    return {
      x: r.left + (r.width * anchor.rect.x) / 100,
      y: r.top + (r.height * anchor.rect.y) / 100,
      width: (r.width * anchor.rect.width) / 100,
      height: (r.height * anchor.rect.height) / 100,
    }
  }
  const p = anchor.point ?? { x: 50, y: 50 }
  return { x: r.left + (r.width * p.x) / 100, y: r.top + (r.height * p.y) / 100, width: 0, height: 0 }
}
