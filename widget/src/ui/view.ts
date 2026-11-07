// View settings: how the side panel shows (over the page, or next to it), on which side, and where the details
// open (in the panel, or in a window). Each person chooses in the panel's view menu (the side also by dragging the
// panel); the choice stays in this browser. Without a choice, the project config decides (`panel`, `details`).
import { type State, setState } from "@/store"

type PanelMode = "overlay" | "push"
type PanelSide = "left" | "right"
type DetailsMode = "panel" | "dialog"

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
