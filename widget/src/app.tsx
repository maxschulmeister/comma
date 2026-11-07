import { lazy, Suspense, useEffect } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { pageBox, useResolved } from "./live"
import { getState, setState, useStore, widgetVisible } from "./store"
import { Notices } from "./ui/notices"
import { CommentOverlay } from "./ui/overlay"
import { Panel } from "./ui/panel"
import { PinsLayer } from "./ui/pins"
import { Toolbar } from "./ui/toolbar"
import { detailsMode } from "./ui/view"

const DetailsDialog = lazy(() => import("./ui/details").then((m) => ({ default: m.DetailsDialog })))

const HASH = /^#comma=([\w-]+)$/

/**
 * Opens the thread in the URL hash (#comma=<id>) when it is loaded.
 * Signed out: the panel asks to sign in first. The link stays in the URL until the thread opens.
 */
function useDeepLink() {
  const loaded = useStore((s) => s.loaded)
  const signedIn = useStore((s) => !!s.session)
  const resolved = useResolved()
  // biome-ignore lint/correctness/useExhaustiveDependencies: run again on sign-in and when the threads load.
  useEffect(() => {
    const open = () => {
      const id = HASH.exec(location.hash)?.[1]
      if (!id) return
      if (!getState().session) {
        if (getState().pendingLink !== id) setState({ pendingLink: id, revealed: true, panelOpen: true })
        return
      }
      if (!getState().loaded) return
      const thread = getState().threads.find((t) => t.id === id)
      if (!thread) return
      const el = resolved.get(id)
      el?.scrollIntoView({ block: "center" })
      // Without a visible pin (detached, or the element is hidden), the thread opens next to its item in the panel.
      const pin = el && pageBox(thread.anchor, el)
      setState({ openThreadId: id, panelOpen: getState().panelOpen || !pin, pendingLink: null })
      history.replaceState(history.state, "", location.pathname + location.search)
    }
    open()
    window.addEventListener("hashchange", open)
    return () => window.removeEventListener("hashchange", open)
  }, [loaded, signedIn, resolved])
}

export function App() {
  const placing = useStore((s) => s.commentMode || !!s.moving)
  const visible = useStore(widgetVisible)
  const dialog = useStore((s) => s.detailsOpen && detailsMode(s) === "dialog")
  useDeepLink()
  return (
    <TooltipProvider delay={400}>
      {placing && <CommentOverlay />}
      <PinsLayer />
      <Panel />
      {visible && <Toolbar />}
      <Notices />
      {dialog && (
        <Suspense fallback={null}>
          <DetailsDialog />
        </Suspense>
      )}
    </TooltipProvider>
  )
}
