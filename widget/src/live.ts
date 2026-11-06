// Keeps thread anchors attached to page elements and tells the UI when the layout changes.
import { useSyncExternalStore } from "react"
import { type Anchor, anchorBox, type Box, resolveAnchor } from "./anchor"
import { getState, subscribe } from "./store"
import type { Thread } from "./types"

type Listener = () => void

// --- Resolved elements, per thread on the current page ---

let resolved = new Map<string, Element | null>()
const anchorKeys = new Map<string, string>()
const resolvedListeners = new Set<Listener>()
let lastThreads: Thread[] | null = null
let lastPage = ""
let timer: ReturnType<typeof setTimeout> | undefined

function resolveAll() {
  const { threads, page } = getState()
  lastThreads = threads
  lastPage = page
  const next = new Map<string, Element | null>()
  let changed = false
  for (const thread of threads) {
    if (thread.page !== page) continue
    // The element found before for the same anchor stays while it keeps its text (see resolveAnchor).
    const key = JSON.stringify(thread.anchor)
    const before = anchorKeys.get(thread.id) === key ? resolved.get(thread.id) : null
    const el = resolveAnchor(thread.anchor, before)
    anchorKeys.set(thread.id, key)
    next.set(thread.id, el)
    if (resolved.get(thread.id) !== el) changed = true
  }
  if (changed || next.size !== resolved.size) {
    resolved = next
    for (const listener of resolvedListeners) listener()
  }
}

function scheduleResolve(delay = 120) {
  clearTimeout(timer)
  timer = setTimeout(resolveAll, delay)
}

/** Element of each thread on this page. null: detached. */
export function useResolved() {
  return useSyncExternalStore(
    (listener) => {
      resolvedListeners.add(listener)
      return () => resolvedListeners.delete(listener)
    },
    () => resolved,
  )
}

// --- Layout ticks: scroll, resize, DOM changes. At most one per animation frame. ---

let tick = 0
let frame = 0
const tickListeners = new Set<Listener>()

export function requestLayout() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    tick++
    for (const listener of tickListeners) listener()
  })
}

export function useLayoutTick() {
  return useSyncExternalStore(
    (listener) => {
      tickListeners.add(listener)
      return () => tickListeners.delete(listener)
    },
    () => tick,
  )
}

export function startTracking() {
  const observer = new MutationObserver(() => {
    invalidateClipping()
    scheduleResolve()
    requestLayout()
  })
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
  const resize = new ResizeObserver(() => requestLayout())
  resize.observe(document.documentElement)
  const onLayout = () => requestLayout()
  window.addEventListener("scroll", onLayout, { capture: true, passive: true })
  window.addEventListener("resize", onLayout)
  document.addEventListener("transitionend", onLayout, true)
  document.addEventListener("animationend", onLayout, true)
  document.fonts?.addEventListener?.("loadingdone", onLayout)
  const unsubscribe = subscribe(() => {
    const { threads, page } = getState()
    if (threads !== lastThreads || page !== lastPage) {
      resolveAll()
      requestLayout()
    }
  })
  resolveAll()
  return () => {
    observer.disconnect()
    resize.disconnect()
    unsubscribe()
    window.removeEventListener("scroll", onLayout, true)
    window.removeEventListener("resize", onLayout)
  }
}

// --- Positions ---

const clipCache = new WeakMap<Element, { tick: number; ancestors: Element[] }>()
let clipTick = -1

// Ancestors that clip their content (overflow other than visible).
function clippingAncestors(el: Element) {
  const cached = clipCache.get(el)
  if (cached && cached.tick === clipTick) return cached.ancestors
  const ancestors: Element[] = []
  for (
    let node = el.parentElement;
    node && node !== document.body && node !== document.documentElement;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node)
    if (style.overflowX !== "visible" || style.overflowY !== "visible") ancestors.push(node)
    if (style.position === "fixed") break
  }
  clipCache.set(el, { tick: clipTick, ancestors })
  return ancestors
}

/** Clears cached clipping ancestors after DOM changes. */
export function invalidateClipping() {
  clipTick++
}

function isVisible(el: Element, box: Box) {
  if (!el.isConnected) return false
  if (typeof el.checkVisibility === "function" && !el.checkVisibility({ visibilityProperty: true })) return false
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  for (const ancestor of clippingAncestors(el)) {
    const r = ancestor.getBoundingClientRect()
    if (cx < r.left - 1 || cx > r.right + 1 || cy < r.top - 1 || cy > r.bottom + 1) return false
  }
  return true
}

/** The box in page coordinates (viewport + scroll), or null when the element is hidden. */
export function pageBox(anchor: Anchor, el: Element) {
  const box = anchorBox(anchor, el)
  if (!isVisible(el, box)) return null
  return { x: box.x + window.scrollX, y: box.y + window.scrollY, width: box.width, height: box.height }
}

/** Current page path, and updates on client-side navigation (pushState, replaceState, popstate). */
export function watchPage(onChange: (page: string) => void) {
  const check = () => onChange(location.pathname)
  const wrap = (name: "pushState" | "replaceState") => {
    const original = history[name]
    history[name] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args)
      queueMicrotask(check)
      return result
    }
  }
  wrap("pushState")
  wrap("replaceState")
  window.addEventListener("popstate", check)
  window.addEventListener("hashchange", check)
}
