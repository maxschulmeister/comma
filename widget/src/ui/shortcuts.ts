import { HOST_TAG, isTyping } from "@/lib/dom"
import { getState, setState } from "@/store"
import { preloadEditor } from "./composer"
import { startDraft } from "./overlay"
import { NARROW } from "./panel"

const PINS_KEY = "comma:pins"

export function loadPinsVisible() {
  try {
    return localStorage.getItem(PINS_KEY) !== "hidden"
  } catch {
    return true
  }
}

export function togglePins() {
  const pinsVisible = !getState().pinsVisible
  setState({ pinsVisible })
  try {
    localStorage.setItem(PINS_KEY, pinsVisible ? "visible" : "hidden")
  } catch {
    // Storage can be blocked. The choice then lasts until reload.
  }
}

/** Comment mode. The panel opens with it, except on narrow screens where it covers the page. */
export function setCommentMode(on: boolean) {
  if (on) {
    void preloadEditor().catch(() => {})
    setState({ commentMode: true, pinsVisible: true, panelOpen: getState().panelOpen || !matchMedia(NARROW).matches })
  } else setState({ commentMode: false, draft: null })
}

/** `C`: comment mode. `Esc`: exit. `Shift+C`: show or hide comments. */
export function startShortcuts() {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event)) return
    const state = getState()
    if (event.key === "Escape" && state.commentMode && !state.draft && !state.openThreadId) {
      setCommentMode(false)
    } else if (event.key === "Enter" && state.commentMode && !state.draft) {
      // Keyboard: comment on the focused page element.
      const el = document.activeElement
      if (!el || el === document.body || el.localName === HOST_TAG) return
      event.preventDefault()
      const r = el.getBoundingClientRect()
      startDraft(el, { point: { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
    } else if (event.code === "KeyC" && event.shiftKey) {
      event.preventDefault()
      togglePins()
    } else if (event.code === "KeyC" && !event.shiftKey) {
      event.preventDefault()
      setCommentMode(!state.commentMode)
    }
  }
  // Capture: runs before popovers close on Escape, so one Escape closes one thing.
  window.addEventListener("keydown", onKeyDown, true)
  return () => window.removeEventListener("keydown", onKeyDown, true)
}
