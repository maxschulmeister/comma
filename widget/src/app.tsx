import { useEffect } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { pageBox, useResolved } from "./live"
import { getState, setState, useStore } from "./store"
import { CommentOverlay } from "./ui/overlay"
import { Panel } from "./ui/panel"
import { PinsLayer } from "./ui/pins"
import { Toolbar } from "./ui/toolbar"

const HASH = /^#comma=([\w-]+)$/

/** Opens the thread in the URL hash (#comma=<id>) when it is loaded. */
function useDeepLink() {
  const loaded = useStore((s) => s.loaded)
  const resolved = useResolved()
  // biome-ignore lint/correctness/useExhaustiveDependencies: run again when the threads load.
  useEffect(() => {
    const open = () => {
      const id = HASH.exec(location.hash)?.[1]
      if (!id || !getState().loaded) return
      const thread = getState().threads.find((t) => t.id === id)
      if (!thread) return
      const el = resolved.get(id)
      el?.scrollIntoView({ block: "center" })
      // Without a visible pin (detached, or the element is hidden), the thread opens next to its item in the panel.
      const pin = el && pageBox(thread.anchor, el)
      setState({ openThreadId: id, panelOpen: getState().panelOpen || !pin })
      history.replaceState(history.state, "", location.pathname + location.search)
    }
    open()
    window.addEventListener("hashchange", open)
    return () => window.removeEventListener("hashchange", open)
  }, [loaded, resolved])
}

export function App() {
  const placing = useStore((s) => s.commentMode || !!s.moving)
  useDeepLink()
  return (
    <TooltipProvider delay={400}>
      {placing && <CommentOverlay />}
      <PinsLayer />
      <Panel />
      <Toolbar />
    </TooltipProvider>
  )
}
