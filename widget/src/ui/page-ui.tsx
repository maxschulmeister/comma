// The UI on the page: the pins with their threads and the composer, and the panel. A chunk of its own: comma loads it
// when it shows something on the page (see showsOnPage), so a closed comma loads and runs less.
import { useEffect } from "react"
import { preloadEditor } from "@/editor/preload"
import { loadFonts } from "@/shadow"
import { Panel } from "./panel"
import { PinsLayer } from "./pins"

export function PageUi() {
  // The font now. The editor in idle time, so the composer opens fast.
  useEffect(() => {
    loadFonts()
    const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 2000))
    idle(() => void preloadEditor().catch(() => {}))
  }, [])
  return (
    <>
      <PinsLayer />
      <Panel />
    </>
  )
}
