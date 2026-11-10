// View settings: how the side panel shows (over the page, or next to it), on which side, and where the details
// open (in the panel, or in a window). Each person chooses in the panel's view menu (the side also by dragging the
// panel); the choice stays in this browser. Without a choice, the project config decides (`panel`, `details`).
import { readRules } from "@/lib/filters"
import { type DetailsMode, getState, type PanelMode, type PanelSide, type State, setState, subscribe } from "@/store"

const PANEL_KEY = "comma:panel-mode"
const SIDE_KEY = "comma:panel-side"
const DETAILS_KEY = "comma:details-mode"

function load<T extends string>(key: string, values: readonly T[]): T | null {
  try {
    const value = localStorage.getItem(key)
    return values.find((v) => v === value) ?? null
  } catch {
    return null
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage can be blocked. The choice then lasts until reload.
  }
}

export const loadView = () => ({
  panelMode: load<PanelMode>(PANEL_KEY, ["overlay", "push"]),
  panelSide: load<PanelSide>(SIDE_KEY, ["left", "right"]),
  detailsMode: load<DetailsMode>(DETAILS_KEY, ["panel", "dialog"]),
})

export function setPanelMode(panelMode: PanelMode) {
  setState({ panelMode })
  save(PANEL_KEY, panelMode)
}

export function setPanelSide(panelSide: PanelSide) {
  setState({ panelSide })
  save(SIDE_KEY, panelSide)
}

export function setDetailsMode(detailsMode: DetailsMode) {
  setState({ detailsMode, detailsOpen: false })
  save(DETAILS_KEY, detailsMode)
}

export const panelMode = (s: State): PanelMode => s.panelMode ?? s.projectInfo?.panel ?? "overlay"
export const panelSide = (s: State): PanelSide => s.panelSide ?? "right"
export const detailsMode = (s: State): DetailsMode => s.detailsMode ?? s.projectInfo?.details ?? "panel"

/**
 * The arrow keys follow the screen. Toward the page: into the thread, or back from the details. Away from it:
 * deeper into the panel (the details), or from the thread back to the list.
 */
export function arrowKeys(side: PanelSide) {
  return side === "right"
    ? { toPage: "ArrowLeft", fromPage: "ArrowRight", fromPageGlyph: "→" }
    : { toPage: "ArrowRight", fromPage: "ArrowLeft", fromPageGlyph: "←" }
}

// The review in this tab: the panel, its filters, and what hiding the comments took off the page. Kept for the tab
// (sessionStorage), so a review goes on after a page load, also on another page of the site.
const reviewKey = () => `comma:review:${getState().server}:${getState().project}`

export function loadReview(): Pick<State, "panelOpen" | "filters" | "hiddenView"> | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(reviewKey()) ?? "null")
    const f = value?.filters
    const h = value?.hiddenView
    const hiddenView =
      typeof h?.panelOpen === "boolean" &&
      typeof h.details === "boolean" &&
      (h.threadId === null || typeof h.threadId === "string")
        ? { panelOpen: h.panelOpen, threadId: h.threadId, details: h.details }
        : null
    if (
      typeof value?.panelOpen !== "boolean" ||
      !["page", "all"].includes(f?.scope) ||
      !["date", "unread"].includes(f?.sort) ||
      typeof f.mine !== "boolean" ||
      typeof f.query !== "string"
    )
      return null
    const { scope, sort, mine, query } = f
    // A review from the version before has `resolved` and `tags` ("Assigned to me" does not stay).
    const status = ["open", "resolved", "all"].includes(f.status) ? f.status : f.resolved === true ? "all" : "open"
    const rules = f.rules ? readRules(f.rules) : readRules([{ field: "tag", op: "is", values: f.tags }])
    return {
      panelOpen: value.panelOpen,
      filters: { scope, status, mine, rules, sort, query: query.slice(0, 200) },
      hiddenView,
    }
  } catch {
    return null // Storage can be blocked.
  }
}

export function keepReview() {
  let last = ""
  return subscribe(() => {
    const { panelOpen, filters, hiddenView } = getState()
    const value = JSON.stringify({ panelOpen, filters, hiddenView })
    if (value === last) return
    last = value
    try {
      sessionStorage.setItem(reviewKey(), value)
    } catch {
      // Storage can be blocked. The review then starts again after a page load.
    }
  })
}
