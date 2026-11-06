// Page DOM helpers. The widget host is never a target.

export const HOST_TAG = "comma-widget"

/** The page element at a viewport point, under the widget layers. */
export function elementAt(x: number, y: number) {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.localName === HOST_TAG || el === document.documentElement) continue
    return el
  }
  return null
}

/** True when the key event comes from a text field, so it must not trigger shortcuts. */
export function isTyping(event: Event) {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue
    if (
      target.isContentEditable ||
      target.localName === "input" ||
      target.localName === "textarea" ||
      target.localName === "select"
    ) {
      return true
    }
  }
  return false
}

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/**
 * Runs after the current event is done. Use it to close a nested popover from a click inside it:
 * if it closes during the click, the parent popover sees a click outside and closes too.
 */
export const afterEvent = (fn: () => void) => setTimeout(fn, 0)
