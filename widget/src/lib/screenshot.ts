// Screenshots of the visible part of the page, without comma. A chunk of its own: it loads on the first screenshot.
// modern-screenshot copies the page into an SVG <foreignObject>, so the browser draws it. Known limit: images and
// fonts from other sites without CORS stay blank.
import { domToCanvas } from "modern-screenshot"
import type { Box } from "@/anchor"
import { HOST_TAG } from "./dom"

const TRANSPARENT = new Set(["transparent", "rgba(0, 0, 0, 0)"])

const notComma = (node: Node) => !(node instanceof Element && node.localName === HOST_TAG)

/** A box of the page (viewport coordinates), copied from the smallest element around it, not from the whole page: on
 * a long page, that takes seconds. Parts of the page that only overlap the box from elsewhere (a sticky header) do
 * not show. */
export async function screenshotBox(box: Box, near: Element): Promise<File> {
  const part = around(near, box)
  if (!part) return screenshotPage(box)
  const rect = part.getBoundingClientRect()
  const scale = Math.min(window.devicePixelRatio || 1, 2)
  const drawn = await domToCanvas(part, { scale, backgroundColor: backgroundOf(part), filter: notComma })
  return toFile(crop(drawn, { ...box, x: box.x - rect.x, y: box.y - rect.y }, rect, scale))
}

// The smallest element that contains the box, below <body>.
function around(near: Element, box: Box) {
  for (let el: Element | null = near; el && el !== document.body; el = el.parentElement) {
    const r = el.getBoundingClientRect()
    if (r.left <= box.x && r.top <= box.y && r.right >= box.x + box.width && r.bottom >= box.y + box.height) return el
  }
  return null
}

// The color that shows behind the element: its own, or the first of its parents.
function backgroundOf(el: Element) {
  for (let at: Element | null = el; at; at = at.parentElement) {
    const color = getComputedStyle(at).backgroundColor
    if (!TRANSPARENT.has(color)) return color
  }
  return "#fff"
}

/** The visible page, or only a box of it (viewport coordinates). */
export async function screenshotPage(box?: Box): Promise<File> {
  const root = document.documentElement
  // The page color shows through a transparent page in the browser, not in a PNG.
  const background =
    [root, document.body].map((e) => getComputedStyle(e).backgroundColor).find((c) => !TRANSPARENT.has(c)) ?? "#fff"
  // The open panel pushes the page with a margin on <html>, on its side (see the panel). The screenshot shows only
  // the page: without the margin, so the page starts at x 0 of the image.
  const style = getComputedStyle(root)
  const left = Number.parseFloat(style.marginLeft) || 0
  const right = Number.parseFloat(style.marginRight) || 0
  const view = { width: root.clientWidth - left - right, height: root.clientHeight }
  const scale = Math.min(window.devicePixelRatio || 1, 2)
  const page = await domToCanvas(root, {
    // The viewport without scrollbars. The page scroll position stays.
    ...view,
    scale,
    backgroundColor: background,
    // The scroll position: move the page up. A margin, not a transform, so `position: fixed` stays in place.
    style: { marginTop: `${-window.scrollY}px`, marginLeft: `${-window.scrollX}px` },
    filter: notComma,
  })
  return toFile(box ? crop(page, { ...box, x: box.x - left }, view, scale) : page)
}

async function toFile(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("Cannot make the image")
  return new File([blob], "screenshot.png", { type: "image/png" })
}

// Only the part of the box that is on screen.
function crop(page: HTMLCanvasElement, box: Box, view: { width: number; height: number }, scale: number) {
  const x = Math.max(0, Math.floor(box.x))
  const y = Math.max(0, Math.floor(box.y))
  const width = Math.min(view.width, Math.ceil(box.x + box.width)) - x
  const height = Math.min(view.height, Math.ceil(box.y + box.height)) - y
  if (width <= 0 || height <= 0) throw new Error("The box is not on screen")
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas
    .getContext("2d")
    ?.drawImage(page, x * scale, y * scale, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
  return canvas
}
