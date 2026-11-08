// Runs in the page (see browser-run.ts): finds the element of a SitePing annotation and makes a comma anchor for it.
// Like comma, it never picks a wrong element: if it is not sure, the thread is detached.
import { createAnchor, similarity } from "../../widget/src/anchor"
import type { SitepingAnnotation } from "./import"
import { placeOf } from "./place"

// As in comma's anchors: about the same text, and the best clearly better than the second.
const MIN_TEXT = 0.8
const MIN_LEAD = 0.1
// Shorter texts repeat on pages ("Learn more"): a scan for them is not sure.
const SHORT_TEXT = 25

const normalize = (s: string) => s.replace(/\s+/g, " ").trim()
// SitePing's text: the first 256 characters of the element's text, trimmed, then the first 120.
const textOf = (el: Element) => normalize((el.textContent ?? "").slice(0, 256).trim().slice(0, 120))

function byCss(selector: string) {
  try {
    return selector ? [...document.querySelectorAll(selector)] : []
  } catch {
    return [] // Not valid in this browser.
  }
}

function byXpath(path: string) {
  try {
    const node = path
      ? document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
      : null
    return node instanceof Element ? node : null
  } catch {
    return null
  }
}

function findElement(a: SitepingAnnotation) {
  const tag = a.tag.toLowerCase()
  const text = normalize(a.text)
  const matches = byCss(a.css).filter((el) => el.localName === tag)
  const xpath = byXpath(a.xpath)
  const atPath = xpath?.localName === tag ? xpath : null

  // 1. The selectors agree (the CSS selector can also match copies, as in a looping logo strip), and the text is
  //    about the same. Without text, this is the only proof.
  if (atPath && matches.includes(atPath) && (!text || similarity(textOf(atPath), text) >= MIN_TEXT)) return atPath
  if (!text) return null

  // 2. One selector still points to an element with the same text.
  const same = [...new Set([matches.length === 1 ? matches[0] : null, atPath])].filter(
    (el): el is Element => !!el && textOf(el) === text,
  )
  if (same.length > 0) return same.length === 1 ? (same[0] ?? null) : null

  // 3. The element moved, or its text changed a little: the one element with clearly the most similar text.
  if (text.length < SHORT_TEXT) return null
  let best: Element | null = null
  let score = 0
  let second = 0
  for (const el of Array.from(document.getElementsByTagName(tag))) {
    const s = similarity(textOf(el), text)
    if (s > score) [best, score, second] = [el, s, score]
    else if (s > second) second = s
  }
  return score >= MIN_TEXT && score - second >= MIN_LEAD ? best : null
}

function anchorFor(a: SitepingAnnotation) {
  const el = findElement(a)
  if (!el) return null
  // The place comes from SitePing: the element can be hidden now (a variant that is not shown), without a box.
  const { point: _, ...anchor } = createAnchor(el, { point: { x: 0, y: 0 } })
  return { ...anchor, ...placeOf(a.rect), viewport: a.viewport.width }
}

Object.assign(window, { commaSiteping: { anchorFor } })
