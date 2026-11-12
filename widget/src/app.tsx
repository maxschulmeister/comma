import { lazy, Suspense, useEffect, useRef } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { pageBox, resolvedElement, showsOnPage, useResolved } from "./live"
import { getState, setState, useStore, widgetVisible } from "./store"
import { loadPageUi } from "./ui/load-page-ui"
import { CommentOverlay } from "./ui/overlay"
import { Toolbar } from "./ui/toolbar"
import { detailsMode } from "./ui/view"

const PageUi = lazy(() => loadPageUi().then((m) => ({ default: m.PageUi })))
const DetailsDialog = lazy(() => import("./ui/details").then((m) => ({ default: m.DetailsDialog })))
const AgentConnect = lazy(() => import("./ui/agent-connect").then((m) => ({ default: m.AgentConnect })))

const HASH = /^#comma=([\w-]+)$/
const CONNECT = /^#comma-connect=([A-Z2-9]{4}-[A-Z2-9]{4})$/

/**
 * A coding agent asks to connect (#comma-connect=<code>): the widget shows, and asks the person. The link goes from the
 * URL at once, so a reload does not ask again.
 */
function useAgentLink() {
  useEffect(() => {
    const read = () => {
      const code = CONNECT.exec(location.hash)?.[1]
      if (!code) return
      setState({ agentCode: code, revealed: true })
      history.replaceState(history.state, "", location.pathname + location.search)
    }
    read()
    window.addEventListener("hashchange", read)
    return () => window.removeEventListener("hashchange", read)
  }, [])
}

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
      const el = resolvedElement(id)
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
  // Loaded once, the page UI stays: it closes with its animations, and keeps its state.
  const shows = useStore(showsOnPage)
  const pageUi = useRef(false)
  if (shows) pageUi.current = true
  const visible = useStore(widgetVisible)
  const dialog = useStore((s) => s.detailsOpen && detailsMode(s) === "dialog")
  const agentCode = useStore((s) => s.agentCode)
  useDeepLink()
  useAgentLink()
  return (
    <TooltipProvider delay={400}>
      {placing && <CommentOverlay />}
      {pageUi.current && (
        <Suspense fallback={null}>
          <PageUi />
        </Suspense>
      )}
      {visible && <Toolbar />}
      {dialog && (
        <Suspense fallback={null}>
          <DetailsDialog />
        </Suspense>
      )}
      {agentCode && (
        <Suspense fallback={null}>
          <AgentConnect key={agentCode} code={agentCode} />
        </Suspense>
      )}
    </TooltipProvider>
  )
}
