import { closeDraft } from "@/drafts"
import { fromWidgetPart, isTyping } from "@/lib/dom"
import { NARROW } from "@/lib/media"
import { getState, setState, widgetVisible } from "@/store"
import { preloadEditor } from "./composer"

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

/** Comment mode. The panel opens with it. On narrow screens the panel covers the page, so it closes. */
export function setCommentMode(on: boolean) {
  if (on) {
    void preloadEditor().catch(() => {})
    setState({ commentMode: true, pinsVisible: true, panelOpen: !matchMedia(NARROW).matches })
  } else {
    // A draft with text stays as a pin.
    closeDraft()
    setState({ commentMode: false, draftMove: null })
  }
}

// The letter on the key, also on Dvorak or AZERTY. Without a Latin letter (Cyrillic, Greek): the key's place.
const letterOf = (event: KeyboardEvent) =>
  /^[a-z]$/i.test(event.key)
    ? event.key.toLowerCase()
    : /^Key[A-Z]$/.test(event.code)
      ? event.code.slice(3).toLowerCase()
      : ""

/** `C` (or the site's key): comment mode. `Esc`: exit. `Shift+C`: show or hide comments. */
export function startShortcuts() {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event)) return
    // In the panel, Escape closes the panel (see Panel).
    if (event.key === "Escape" && fromWidgetPart(event, "[data-slot=panel]")) {
      return
    }
    const state = getState()
    if (!widgetVisible(state)) return
    if (event.key === "Escape" && state.moving) {
      setState({ moving: null })
    } else if (
      event.key === "Escape" &&
      state.commentMode &&
      !state.draft?.open &&
      !state.draftMove &&
      !state.openThreadId
    ) {
      setCommentMode(false)
    } else if (state.shortcut && letterOf(event) === state.shortcut && event.shiftKey) {
      event.preventDefault()
      togglePins()
    } else if (state.shortcut && letterOf(event) === state.shortcut) {
      event.preventDefault()
      setCommentMode(!state.commentMode)
    }
  }
  // Capture: runs before popovers close on Escape, so one Escape closes one thing.
  window.addEventListener("keydown", onKeyDown, true)
  return () => window.removeEventListener("keydown", onKeyDown, true)
}
