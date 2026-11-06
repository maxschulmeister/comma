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
  /** Hash of the element's identity: its link or image and its label, and the links and images in it. */
  fingerprint?: string
  /**
   * Number of look-alikes (same tag, text, context and fingerprint) when the comment was made, if more than one.
   * Only their position tells them apart, so they must all still be there. If such twins swap places, nothing on
   * the page shows it, so the pin stays at the position.
   */
  twins?: number
  /**
   * Other elements had the same or a similar text (and the same identity) when the comment was made:
   * product cards with the same "Free delivery" line, "Flight from London to Paris" and "… Paris to London".
   * Then only the same text with the same neighbors is this element.
   */
  repeated?: boolean
  /**
   * For repeated text: the closest container that tells the element apart from its look-alikes (a product card).
   * `depth`: levels up from the element. `hash`: hash of the start of the container's text and its links and images.
   */
  scope?: { depth: number; hash: string }
  /**
   * For a short label that is not a link or image itself ("Add to cart"): the largest small container with links or
   * images (its card). `hash`: hash of those links and images, without icons in buttons.
   * A filter that shows another product in the same card changes them.
   */
  card?: { depth: number; hash: string }
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
// Short texts ("Learn more", "Pricing") repeat on pages. Their context must match too.
const SHORT_TEXT = 25
const MIN_CONTEXT = 0.8
const MIN_LEAD = 0.02
// Containers: how far up we look, and how much of their text we compare (the start: a card's title, not its stock count).
const MAX_SCOPE_DEPTH = 6
const SCOPE_LENGTH = 200
// A card is small: a container with more text is a page section, and its links change for other reasons.
const MAX_CARD_DEPTH = 4
const MAX_CARD_TEXT = 300
const IDENTITY_SELECTOR = "[href],[src],[srcset]"
// Elements that point to a page or show an image. Not `href="#…"`: icons (`<use href="#cart">`) and in-page links.
const URL_SELECTOR = "[href]:not([href^='#']),[src],[srcset]"
const BUTTON_SELECTOR = "button,[role=button]"

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

function ancestorAt(el: Element, depth: number) {
  let node: Element | null = el
  for (let i = 0; i < depth && node; i++) node = node.parentElement
  return node && node !== document.body && node !== document.documentElement ? node : null
}

// A container's text start and its links and images: two cards with the same text can show other products.
const scopeHash = (el: Element | null) =>
  el ? hashOf(`${normalize(el.textContent).slice(0, SCOPE_LENGTH)};${fingerprintOf(el)}`) : ""

// The container of `el` that tells it apart from the most look-alikes: the closest one that tells it apart from all
// outside it, else the one that tells it apart from most ("Free shipping" in two of three cards: the card title, not
// the wrapper). Look-alikes inside it are twins in the same card ("Reserve" in two rate rows of one hotel room):
// only their position tells them apart.
function scopeOf(el: Element, others: Element[]): Anchor["scope"] {
  let best: { depth: number; hash: string; apart: number } | undefined
  for (let depth = 1; depth <= MAX_SCOPE_DEPTH; depth++) {
    const node = ancestorAt(el, depth)
    if (!node) break
    const outside = others.filter((o) => !node.contains(o))
    if (outside.length === 0) break
    const hash = scopeHash(node)
    const apart = outside.filter((o) => scopeHash(ancestorAt(o, depth)) !== hash).length
    if (apart > (best?.apart ?? 0)) best = { depth, hash, apart }
    if (apart === outside.length) break
  }
  return best && { depth: best.depth, hash: best.hash }
}

// The links and images in a container that say which item it shows. Not icons in buttons: the same cart or heart
// icon is on every card, and it changes when a user toggles it.
function cardUrls(node: Element) {
  const urls: string[] = []
  for (const x of [node, ...Array.from(node.querySelectorAll(URL_SELECTOR))]) {
    if (!x.matches(URL_SELECTOR) || x.closest(BUTTON_SELECTOR)) continue
    for (const name of CHILD_IDENTITY) {
      const value = x.getAttribute(name)
      if (value !== null) urls.push(`${name}=${identityUrl(name, value)}`)
    }
  }
  return urls
}

const cardHash = (node: Element | null) => (node ? hashOf(cardUrls(node).join(";")) : "")

// The largest small container of a short label with links or images: they say which item it is (see Anchor.card).
// The largest, not the closest: an action row ("Add to cart", "Size guide") has links that are on every card.
// It holds none of the look-alikes: a list of cards is not a card. A link or image is its own identity: no card.
function cardOf(el: Element, lookAlikes: Element[]): Anchor["card"] {
  if (el.matches(URL_SELECTOR)) return undefined
  let card: Anchor["card"]
  for (let depth = 1; depth <= MAX_CARD_DEPTH; depth++) {
    const node = ancestorAt(el, depth)
    if (!node || normalize(node.textContent).length > MAX_CARD_TEXT || lookAlikes.some((o) => node.contains(o))) break
    if (cardUrls(node).length > 0) card = { depth, hash: cardHash(node) }
  }
  return card
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
  anchor.fingerprint = fingerprintOf(el)
  // Look-alikes elsewhere on the page. Not the element's own wrappers or labels (`<button><span>Add</span>`).
  const lookAlikes = Array.from(document.getElementsByTagName(anchor.tag)).filter(
    (x) =>
      !x.contains(el) &&
      !el.contains(x) &&
      !x.closest("comma-widget") &&
      similarity(textOf(x), anchor.text) >= MIN_TEXT &&
      fingerprintOf(x) === anchor.fingerprint,
  )
  if (lookAlikes.length > 0) {
    anchor.repeated = true
    anchor.scope = scopeOf(el, lookAlikes)
  }
  if (anchor.text.length < SHORT_TEXT) anchor.card = cardOf(el, lookAlikes)
  const twins = lookAlikesOf(anchor).length
  if (twins > 1) anchor.twins = twins
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

// The element is in a container like the anchor's (see Anchor.scope and Anchor.card).
const inScope = (anchor: Anchor, el: Element) => {
  if (anchor.scope && scopeHash(ancestorAt(el, anchor.scope.depth)) !== anchor.scope.hash) return false
  if (!anchor.card) return true
  const card = ancestorAt(el, anchor.card.depth)
  return !!card && cardHash(card) === anchor.card.hash
}

// Elements with the same tag, text, context, fingerprint and container.
function lookAlikesOf(anchor: Anchor) {
  return Array.from(document.getElementsByTagName(anchor.tag)).filter(
    (el) =>
      !el.closest("comma-widget") &&
      textOf(el) === anchor.text &&
      contextOf(el) === anchor.context &&
      (!anchor.fingerprint || fingerprintOf(el) === anchor.fingerprint) &&
      inScope(anchor, el),
  )
}

// Attributes that say what an element is or where it goes. Not `title` or `value`: they change often.
const OWN_IDENTITY = ["href", "src", "srcset", "alt", "aria-label", "name", "data-testid"]
const CHILD_IDENTITY = ["href", "src", "srcset"]
// Query parameters that do not change what a URL points to.
const TRACKING = /^(utm_\w+|fbclid|gclid|msclkid|mc_cid|mc_eid|_ga|ref)$/i
// For images also: size, format, cache and signature parameters (image services, signed storage URLs).
const IMAGE_VOLATILE =
  /^(w|h|width|height|q|quality|fit|fm|format|auto|dpr|crop|ixlib|v|t|ts|cb|_|sig|signature|s|expires|token|policy|key-pair-id|googleaccessid|x-amz-[\w-]+|x-goog-[\w-]+)$/i

// The part of a link or image URL that says what it is: path, query and fragment, without volatile parameters.
// A `srcset` is a list of image URLs with sizes ("a.jpg 1x, b.jpg 2x"): the identity of each URL.
function identityUrl(name: string, value: string): string {
  if (name === "srcset") {
    return value
      .split(",")
      .map((candidate) => identityUrl("src", candidate.trim().split(/\s+/)[0] ?? ""))
      .join(" ")
  }
  const [base = "", hash] = value.split("#", 2)
  const [path = "", query] = base.split("?", 2)
  const params = new URLSearchParams(query ?? "")
  for (const key of [...params.keys()]) {
    if (TRACKING.test(key) || (name === "src" && IMAGE_VOLATILE.test(key))) params.delete(key)
  }
  const rest = params.toString()
  return `${path}${rest ? `?${rest}` : ""}${hash !== undefined ? `#${hash}` : ""}`
}

// Hash (FNV-1a) of the identity attributes of the element and of the links and images in it (first 50).
function fingerprintOf(el: Element) {
  const parts: string[] = []
  for (const name of OWN_IDENTITY) {
    const value = el.getAttribute(name)
    if (value !== null) parts.push(`${name}=${CHILD_IDENTITY.includes(name) ? identityUrl(name, value) : value}`)
  }
  for (const child of Array.from(el.querySelectorAll(IDENTITY_SELECTOR)).slice(0, 50)) {
    for (const name of CHILD_IDENTITY) {
      const value = child.getAttribute(name)
      if (value !== null) parts.push(`>${name}=${identityUrl(name, value)}`)
    }
  }
  // An image in a <picture> shows one of the picture's sources: they are part of what it shows.
  if (el.localName === "img" && el.parentElement?.localName === "picture") {
    for (const source of Array.from(el.parentElement.querySelectorAll("source[srcset]"))) {
      parts.push(`<srcset=${identityUrl("srcset", source.getAttribute("srcset") ?? "")}`)
    }
  }
  return hashOf(parts.join(";"))
}

// FNV-1a.
function hashOf(s: string) {
  let hash = 0x811c9dc5
  for (const char of s) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193)
  return (hash >>> 0).toString(16)
}

function query(selector: string | undefined) {
  if (!selector) return null
  try {
    return document.querySelector(selector)
  } catch {
    return null // A stored selector can be invalid in this browser.
  }
}

/**
 * The element of the anchor, or null (detached).
 * `previous`: the element found before on this page. If it is still there with the same text and identity, it stays,
 * also when its neighbors changed. After a reload there is no previous element, so the neighbors must match again.
 * Repeated text is the exception: only its neighbors tell the copies apart (a list can reuse a row for another item).
 */
export function resolveAnchor(anchor: Anchor, previous?: Element | null): Element | null {
  // Repeated text: only the same text with the same neighbors and container is this element (see Anchor.repeated).
  const sameAsRepeated = (el: Element) =>
    !anchor.repeated || (textOf(el) === anchor.text && contextOf(el) === anchor.context && inScope(anchor, el))

  if (
    previous?.isConnected &&
    previous.localName === anchor.tag &&
    textOf(previous) === anchor.text &&
    (!anchor.fingerprint || fingerprintOf(previous) === anchor.fingerprint) &&
    inScope(anchor, previous) &&
    sameAsRepeated(previous)
  ) {
    return previous
  }

  // A developer-made anchor is trusted.
  const own = anchor.selectors.anchor && query(`[data-comment-anchor="${CSS.escape(anchor.selectors.anchor)}"]`)
  if (own) return own

  const byId = query(anchor.selectors.id && `#${CSS.escape(anchor.selectors.id)}`)
  const byCss = query(anchor.selectors.css)
  // Anchors made before fingerprints existed have none: then any fingerprint is fine.
  const sameIdentity = (el: Element) => !anchor.fingerprint || fingerprintOf(el) === anchor.fingerprint

  // A stable id is proof, when the element still has about the same text and the same identity.
  // An id can name a slot that a list reuses for another item: repeated text needs its neighbors too.
  if (
    byId?.localName === anchor.tag &&
    similarity(textOf(byId), anchor.text) >= MIN_TEXT &&
    sameIdentity(byId) &&
    inScope(anchor, byId) &&
    sameAsRepeated(byId)
  ) {
    return byId
  }
  // The id names an element with this repeated text, but with other neighbors: a reused slot, or a look-alike
  // took the old neighbors. The id and the neighbors disagree: no proof either way.
  if (anchor.repeated && byId?.localName === anchor.tag && textOf(byId) === anchor.text && sameIdentity(byId)) {
    return null
  }

  // One pass over all elements with the same tag and identity: exact look-alikes, and scores for changed text.
  const short = anchor.text.length < SHORT_TEXT
  const exact: Element[] = []
  let best: { el: Element; score: number } | null = null
  let second = 0
  for (const el of Array.from(document.getElementsByTagName(anchor.tag))) {
    if (el.closest("comma-widget")) continue
    const ownText = textOf(el)
    const text = similarity(ownText, anchor.text)
    if (text < MIN_TEXT || !sameIdentity(el) || !inScope(anchor, el)) continue
    const ownContext = contextOf(el)
    if (ownText === anchor.text && ownContext === anchor.context) exact.push(el)
    const context = anchor.context ? similarity(ownContext, anchor.context) : 1
    // Changed text. Not `text < 1`: "London to Paris" and "Paris to London" have the same letter pairs.
    const changed = ownText !== anchor.text
    // Changed text needs the same neighbors: "plan A" and "plan B" headings are similar, their neighbors are not.
    // Short text repeats on pages ("Learn more"), so it always needs them.
    if ((short || changed) && context < MIN_CONTEXT) continue
    // Similar text was on the page more than once: only the exact text, neighbors and container tell the copies apart.
    // "MacBook Pro 14-inch" and "16-inch" are similar neighbors of the same "Free delivery" text.
    if (anchor.repeated && (changed || ownContext !== anchor.context)) continue
    // No neighbors to compare: changed text cannot be checked, and a position is no proof.
    if (!anchor.context && changed) continue
    const score = text * 0.7 + context * 0.3
    if (!best || score > best.score) {
      second = best?.score ?? 0
      best = { el, score }
    } else if (score > second) second = score
  }

  // Twins: they must all still be there, and the position (CSS path) must point to one of them.
  if ((anchor.twins ?? 1) > 1) {
    if (exact.length !== anchor.twins) return null
    return byCss && exact.includes(byCss) ? byCss : null
  }
  if (exact.length === 1) return exact[0] ?? null
  // It was unique. Now there are identical copies: no way to tell which one it is.
  if (exact.length > 1) return null

  // The text or the context changed. The best must be clearly better than the second.
  // A position (CSS path) is no proof here: it can point to a new look-alike.
  if (!best || best.score - second < MIN_LEAD) return null
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
