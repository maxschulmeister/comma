import { loadFonts } from "@/shadow"

/** Loads the pins and the panel (see page-ui.tsx), and their font. Early when someone is about to use comma. */
export function loadPageUi() {
  loadFonts()
  return import("./page-ui")
}
