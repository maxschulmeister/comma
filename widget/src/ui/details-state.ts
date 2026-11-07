// Opens and closes the details (details.tsx), and moves the focus between the page and the panel.
// Here, so the thread popover does not load the details chunk.
import { getState, setState } from "@/store"
import { panelElements } from "./pins"
import { detailsMode } from "./view"

const inDialog = () => detailsMode(getState()) === "dialog"

// Opened from the panel list (→ or the item's button): closing goes back to the list.
let fromList = false

/** Opens the details of the open thread: in the panel, or in a dialog. */
export function openDetails(fromPanelList = false) {
  fromList = fromPanelList
  setState({ detailsOpen: true, ...(inDialog() ? {} : { panelOpen: true }) })
}

export function toggleDetails() {
  if (getState().detailsOpen) closeDetails()
  else openDetails()
}

/** In the panel: back to the list, at the same scroll position, with the focus on the open thread's item. */
export function closeDetails() {
  setState({ detailsOpen: false })
  if (!inDialog()) focusOpenItem()
}

/** Where the focus goes when the details dialog closes: the list item, if it was opened from the list. */
export const dialogFinalFocus = () => (fromList && panelElements.get(getState().openThreadId ?? "")) || true

/**
 * The open thread's item in the panel gets the focus (→ from the thread, Back from the details). The panel opens
 * first if it is closed. With the details open in the panel, they get the focus.
 */
export function focusOpenItem() {
  if (!getState().panelOpen) setState({ panelOpen: true })
  setTimeout(() => {
    const id = getState().openThreadId
    const item = id ? panelElements.get(id) : undefined
    const details = item?.closest("[data-slot=panel]")?.querySelector<HTMLElement>("[data-slot=details]")
    if (details) return details.focus({ preventScroll: true })
    item?.scrollIntoView({ block: "nearest" })
    item?.focus({ preventScroll: true })
  })
}
