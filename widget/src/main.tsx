import { createRoot } from "react-dom/client"
import { App } from "./app"
import { identify, loadProject, loadSession, refresh, signOut, startPolling } from "./client"
import { PortalContainer } from "./lib/portal"
import { startTracking, watchPage } from "./live"
import { createShadowHost } from "./shadow"
import { initStore, setState } from "./store"
import { preloadEditor } from "./ui/composer"
import { loadPinsVisible, startShortcuts } from "./ui/shortcuts"

type Loader = { __queue: [string, unknown[]][]; __script: { src: string; project: string } }

const loader = (window as unknown as { comma?: Loader }).comma
if (loader?.__script) start(loader)

function start({ __queue: queue, __script: script }: Loader) {
  const server = new URL(script.src).origin
  initStore({
    server,
    project: script.project,
    popupSignIn: false,
    session: null,
    loaded: false,
    threads: [],
    users: {},
    page: location.pathname,
    commentMode: false,
    pinsVisible: loadPinsVisible(),
    panelOpen: false,
    openThreadId: null,
    draft: null,
    filters: { scope: "page", mine: false, resolved: false, sort: "date", query: "" },
    signInOpen: false,
  })
  setState({ session: loadSession() })

  // The page API. Calls made before this module loaded wait in the queue.
  const api = {
    identify: (token: string) => identify(token),
    signOut: () => signOut(),
  }
  ;(window as unknown as { comma: typeof api }).comma = api
  for (const [name, args] of queue) {
    if (name === "identify" && typeof args[0] === "string") void api.identify(args[0]).catch(() => {})
    else if (name === "signOut") api.signOut()
  }

  const { root } = createShadowHost(new URL("w/", script.src).href)
  const portal = document.createElement("div")
  portal.className = "comma-root"
  root.after(portal)
  createRoot(root).render(
    <PortalContainer.Provider value={portal}>
      <App />
    </PortalContainer.Provider>,
  )

  watchPage((page) => setState({ page }))
  startTracking()
  startShortcuts()
  startPolling()
  void loadProject().catch(() => {})
  void refresh()
  const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 2000))
  idle(() => void preloadEditor().catch(() => {}))
}
