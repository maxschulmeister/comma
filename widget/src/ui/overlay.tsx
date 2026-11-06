import { useEffect, useRef, useState } from "react"
import { type Box, createAnchor } from "@/anchor"
import { moveThread } from "@/client"
import { elementAt, HOST_TAG } from "@/lib/dom"
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

// Comment mode: hover outlines the element under the cursor, click pins a comment to it,
// drag draws a region. On touch, a tap pins a comment and the page still scrolls.
export function CommentOverlay() {
  const moving = useStore((s) => s.moving)
  const [outline, setOutline] = useState<Box | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  useEffect(() => {
    const clear = () => setOutline(null)
    // Keyboard: the focused page element is the target (Enter comments on it, see shortcuts).
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
        {outline && !drag && (
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
          Click the new place for the comment, or focus an element and press Enter. Esc cancels.
        </p>
      )}
    </>
  )
}
