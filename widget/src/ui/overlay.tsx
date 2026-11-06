import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { type Box, createAnchor } from "@/anchor"
import { moveThread } from "@/client"
import { elementAt, HOST_TAG, isTyping } from "@/lib/dom"
import { useLayoutTick } from "@/live"
import { getState, setState, useStore } from "@/store"

const DRAG_MIN = 6

type Drag = { x: number; y: number; x2: number; y2: number }

const rectOf = (d: Drag): Box => ({
  x: Math.min(d.x, d.x2),
  y: Math.min(d.y, d.y2),
  width: Math.abs(d.x2 - d.x),
  height: Math.abs(d.y2 - d.y),
})

/** Opens the composer for a new thread on the element. When the user moves a pin, moves it there. */
export function placeAt(el: Element, at: Parameters<typeof createAnchor>[1]) {
  const { moving, threads, page } = getState()
  const thread = moving ? threads.find((t) => t.id === moving) : undefined
  if (thread) {
    setState({ moving: null, openThreadId: thread.id })
    void moveThread(thread, page, createAnchor(el, at)).catch(() => {})
    return
  }
  setState({ draft: { anchor: createAnchor(el, at), element: el, page }, openThreadId: null })
}

// Elements a keyboard user can pick with ↑ and ↓: text blocks, media and controls.
const PICKABLE =
  "h1,h2,h3,h4,h5,h6,p,li,dt,dd,blockquote,pre,figure,img,svg,video,canvas,table,a,button,input,select,textarea,[role=img],[data-comment-anchor]"

function pickable() {
  return Array.from(document.body.querySelectorAll(PICKABLE)).filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && (el.checkVisibility?.({ visibilityProperty: true }) ?? true)
  })
}

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

/** "Heading: Pricing", for screen readers. */
function describe(el: Element) {
  const kind = /^h[1-6]$/.test(el.localName) ? "Heading" : (KINDS[el.localName] ?? "Element")
  const text =
    (el.textContent ?? "").replace(/\s+/g, " ").trim() || el.getAttribute("alt") || el.getAttribute("aria-label") || ""
  return text ? `${kind}: ${text.slice(0, 80)}` : kind
}

const center = (el: Element) => {
  const r = el.getBoundingClientRect()
  return { point: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
}

// Keys in the panel or in a popup belong to them.
const fromWidgetUi = (event: Event) =>
  event
    .composedPath()
    .some(
      (n) =>
        n instanceof Element && (n.localName === "aside" || n.matches("[role=dialog],[role=alertdialog],[role=menu]")),
    )

// Comment mode: hover outlines the element under the cursor, click pins a comment to it,
// drag draws a region. On touch, a tap pins a comment and the page still scrolls.
// Keyboard: ↑ and ↓ pick an element, or Tab to a control. Enter comments on it.
export function CommentOverlay() {
  const moving = useStore((s) => s.moving)
  const [outline, setOutline] = useState<Box | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [picked, setPicked] = useState<Element | null>(null)
  const pickedRef = useRef<Element | null>(null)
  useLayoutTick()

  const pick = (el: Element | null) => {
    pickedRef.current = el
    setPicked(el)
  }

  // A layout effect: the keys work as soon as the overlay shows.
  useLayoutEffect(() => {
    const pick = (el: Element | null) => {
      pickedRef.current = el
      setPicked(el)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event) || fromWidgetUi(event) || getState().draft) return
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const list = pickable()
        if (list.length === 0) return
        event.preventDefault()
        const down = event.key === "ArrowDown"
        const index = pickedRef.current ? list.indexOf(pickedRef.current) : -1
        let next: Element | undefined
        if (index === -1) {
          const inView = list.filter((el) => {
            const r = el.getBoundingClientRect()
            return r.bottom > 0 && r.top < window.innerHeight
          })
          next = down ? (inView[0] ?? list[0]) : (inView.at(-1) ?? list.at(-1))
        } else next = list[(index + (down ? 1 : -1) + list.length) % list.length]
        if (!next) return
        pick(next)
        next.scrollIntoView({ block: "nearest" })
      } else if (event.key === "Enter") {
        const active = document.activeElement
        const focused = active && active !== document.body && active.localName !== HOST_TAG ? active : null
        const el = pickedRef.current ?? focused
        if (!el) return
        event.preventDefault()
        pick(null)
        placeAt(el, center(el))
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])

  useEffect(() => {
    const clear = () => setOutline(null)
    // Keyboard: the focused page element is the target (Enter comments on it).
    const onFocus = (event: FocusEvent) => {
      const el = event.target
      if (!(el instanceof Element) || el.localName === HOST_TAG || el === document.body) return
      const r = el.getBoundingClientRect()
      setOutline({ x: r.left, y: r.top, width: r.width, height: r.height })
    }
    window.addEventListener("scroll", clear, { capture: true, passive: true })
    document.addEventListener("focusin", onFocus)
    return () => {
      window.removeEventListener("scroll", clear, true)
      document.removeEventListener("focusin", onFocus)
    }
  }, [])

  const target = (x: number, y: number) => elementAt(x, y) ?? document.body

  // The drag start is in a ref: a quick click can end before the next render.
  const start = useRef<{ x: number; y: number } | null>(null)

  return (
    <>
      <div
        aria-hidden
        data-slot="comment-overlay"
        className="fixed inset-0 cursor-crosshair touch-manipulation"
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse") return
          if (pickedRef.current) pick(null)
          if (start.current) {
            setDrag({ ...start.current, x2: e.clientX, y2: e.clientY })
            return
          }
          const el = target(e.clientX, e.clientY)
          const r = el.getBoundingClientRect()
          setOutline({ x: r.left, y: r.top, width: r.width, height: r.height })
        }}
        onPointerLeave={() => setOutline(null)}
        onPointerDown={(e) => {
          if (e.button !== 0 || e.pointerType !== "mouse") return
          e.currentTarget.setPointerCapture(e.pointerId)
          start.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={(e) => {
          if (e.button !== 0) return
          const from = start.current
          start.current = null
          setDrag(null)
          const rect = from && rectOf({ ...from, x2: e.clientX, y2: e.clientY })
          if (rect && (rect.width >= DRAG_MIN || rect.height >= DRAG_MIN)) {
            placeAt(target(rect.x + rect.width / 2, rect.y + rect.height / 2), { rect })
          } else placeAt(target(e.clientX, e.clientY), { point: { x: e.clientX, y: e.clientY } })
        }}
        onPointerCancel={() => {
          start.current = null
          setDrag(null)
        }}
      >
        {picked?.isConnected && (
          <div
            data-slot="picked-outline"
            className="pointer-events-none fixed rounded-[2px] outline-2 outline-primary outline-offset-2 outline-solid"
            style={(({ left, top, width, height }) => ({ left, top, width, height }))(picked.getBoundingClientRect())}
          />
        )}
        {outline && !drag && !picked && (
          <div
            className="pointer-events-none fixed rounded-[2px] outline-2 outline-primary outline-offset-0 outline-solid"
            style={{ left: outline.x, top: outline.y, width: outline.width, height: outline.height }}
          />
        )}
        {drag && (
          <div
            className="pointer-events-none fixed rounded-sm border-2 border-primary bg-primary/10"
            style={(({ x, y, width, height }) => ({ left: x, top: y, width, height }))(rectOf(drag))}
          />
        )}
      </div>
      {moving && (
        <p
          role="status"
          className="fixed top-4 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-3 py-1.5 text-background text-xs shadow-lg"
        >
          Click the new place for the comment, or pick it with ↑ ↓ and press Enter. Esc cancels.
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {picked ? `${describe(picked)}. Press Enter to ${moving ? "move the comment here" : "comment"}.` : ""}
      </p>
    </>
  )
}
