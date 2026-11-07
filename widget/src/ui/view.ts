// View settings: how the side panel shows (over the page, or next to it) and where the details open (in the panel,
// or in a window). Each person chooses in the panel's view menu; the choice stays in this browser. Without a
// choice, the project config decides (`panel`, `details`).
import { type State, setState } from "@/store"

type PanelMode = "overlay" | "push"
type DetailsMode = "panel" | "dialog"

const PANEL_KEY = "comma:panel-mode"
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
  detailsMode: load<DetailsMode>(DETAILS_KEY, ["panel", "dialog"]),
})

export function setPanelMode(panelMode: PanelMode) {
  setState({ panelMode })
  save(PANEL_KEY, panelMode)
}

export function setDetailsMode(detailsMode: DetailsMode) {
  setState({ detailsMode, detailsOpen: false })
  save(DETAILS_KEY, detailsMode)
}

export const panelMode = (s: State): PanelMode => s.panelMode ?? s.projectInfo?.panel ?? "overlay"
export const detailsMode = (s: State): DetailsMode => s.detailsMode ?? s.projectInfo?.details ?? "panel"
