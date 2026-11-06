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
 * True when a popover closes because of a press inside the widget (a menu, a nested popover, a dialog).
 * Base UI keeps nested popups "inside" their parent through React's event bubbling. Preact bubbles
 * through the DOM, and our popups render in a shared container, so Base UI sees a press outside.
 * Top-level popovers ignore these presses. A press on the page still closes them.
 */
export function pressInsideWidget(details: { reason: string; event?: Event }) {
  if (details.reason !== "outside-press" || !details.event) return false
  return details.event.composedPath().some((node) => node instanceof Element && node.localName === HOST_TAG)
}
