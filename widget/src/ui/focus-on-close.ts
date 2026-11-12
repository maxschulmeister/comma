// Where the focus goes when the open thread closes, if not back to its pin: an action that removes the thread
// chooses it (Undo after resolve, the Comments button after delete). Found when the thread has closed.
let focusOnClose: (() => HTMLElement | null | undefined) | null = null
/** Where the focus goes when the open thread closes, once. */
export function setFocusOnClose(find: (() => HTMLElement | null | undefined) | null) {
  focusOnClose = find
}
export function takeFocusOnClose() {
  const find = focusOnClose
  focusOnClose = null
  return find?.() ?? null
}
