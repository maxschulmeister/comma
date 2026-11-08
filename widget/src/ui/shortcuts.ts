import { closeDraft } from "@/drafts"
import { fromWidgetPart, HOST_TAG, isTyping } from "@/lib/dom"
import { NARROW } from "@/lib/media"
import { getState, type State, setState, subscribe, widgetVisible } from "@/store"
import { preloadEditor } from "./composer"
import { setFocusOnClose } from "./thread"
import { panelMode } from "./view"

const PINS_KEY = "comma:pins"

export function loadPinsVisible() {
  try {
    return localStorage.getItem(PINS_KEY) !== "hidden"
  } catch {
    return true
  }
}

function setPinsVisible(pinsVisible: boolean, patch: Partial<State> = {}) {
  setState({ ...patch, pinsVisible })
  try {
    localStorage.setItem(PINS_KEY, pinsVisible ? "visible" : "hidden")
  } catch {
    // Storage can be blocked. The choice then lasts until reload.
  }
}

/**
 * Hide: comma goes off the page, for a look at the page as visitors see it. The pins, the panel, the open thread
 * with its details, and comment mode. Show: the panel, the thread and the details come back.
 */
export function togglePins() {
  const s = getState()
  if (!s.pinsVisible) {
    const view = s.hiddenView
    const thread = s.threads.find((t) => t.id === view?.threadId && t.page === s.page)
    setPinsVisible(true, {
      hiddenView: null,
      panelOpen: view?.panelOpen ?? s.panelOpen,
      ...(thread && { openThreadId: thread.id, threadFocus: false, detailsOpen: !!view?.details }),
    })
    return
  }
  if (s.commentMode) setCommentMode(false)
  // The focus is in what closes (the thread, the panel): it goes to the eye, which brings it back.
  const root = document.querySelector(HOST_TAG)?.shadowRoot
  if (root?.activeElement && !root.activeElement.closest("[data-slot=toolbar]")) {
    const eye = () => root.querySelector<HTMLElement>("[data-pins-button]")
    if (s.openThreadId) setFocusOnClose(eye)
    else eye()?.focus()
  }
  setPinsVisible(false, {
    hiddenView: { panelOpen: s.panelOpen, threadId: s.openThreadId, details: s.detailsOpen },
    panelOpen: false,
    openThreadId: null,
    detailsOpen: false,
  })
}

/** The panel lists the comments: opening it while they are hidden shows them (without bringing a thread back). */
export function showCommentsWithPanel() {
  return subscribe(() => {
    const s = getState()
    if (s.panelOpen && !s.pinsVisible) setPinsVisible(true, { hiddenView: null })
  })
}

/** Comment mode. The panel opens with it. On narrow screens the panel covers the page, so it closes. */
export function setCommentMode(on: boolean) {
  if (on) {
    void preloadEditor().catch(() => {})
    // The panel opens next to the page (push). Floating, it would cover elements to comment on: it stays as it is.
    // Narrow screens: it covers the page, so it closes.
    const s = getState()
    const panelOpen = matchMedia(NARROW).matches ? false : panelMode(s) === "push" || s.panelOpen
    setPinsVisible(true, { commentMode: true, panelOpen, hiddenView: null })
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
