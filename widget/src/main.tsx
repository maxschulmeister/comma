import { options } from "preact"
import { createRoot } from "react-dom/client"
import { App } from "./app"
import { identify, loadProject, loadSession, refresh, signOut, startPolling } from "./client"
import { PortalContainer } from "./lib/portal"
import { startTracking, watchPage } from "./live"
import { createShadowHost } from "./shadow"
import { getState, initStore, setState } from "./store"
import { preloadEditor } from "./ui/composer"
import { loadPinsVisible, startShortcuts } from "./ui/shortcuts"

type Loader = { __queue: [string, unknown[]][]; __script: { src: string; project: string } }

const loader = (window as unknown as { comma?: Loader }).comma
if (loader?.__script) start(loader)

// Render after the whole event, not between its listeners (Preact's default is a microtask).
// Base UI checks clicks in nested popups after our handlers run. React keeps a portal "inside" its
// parent; Preact does not. If a nested popup unmounts before the check, the parent sees a click
// outside and closes too.
options.debounceRendering = (render) => setTimeout(render, 0)

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
    moving: null,
    filters: { scope: "page", mine: false, resolved: false, sort: "date", query: "" },
    signInOpen: false,
  })
  setState({ session: loadSession() })

  // The page API. Calls made before this module loaded wait in the queue.
  const api = {
    identify: (token: string) => identify(token),
    signOut: () => signOut(),
  }
  const run = ([name, args]: [string, unknown[]]) => {
    if (name === "identify" && typeof args[0] === "string") void api.identify(args[0]).catch(() => {})
    else if (name === "signOut") api.signOut()
  }
  ;(window as unknown as { comma: typeof api }).comma = api
  for (const call of queue.splice(0)) run(call)
  // Code can still hold a stub from c.js: `window.comma.identify(await getToken())` reads the function
  // before the await. Such late calls run now.
  queue.push = (...calls) => {
    for (const call of calls) run(call)
    return 0
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

  // Client-side navigation: a draft or an open thread belongs to the old page.
  watchPage((page) => {
    if (page !== getState().page) setState({ page, draft: null, openThreadId: null })
  })
  startTracking()
  startShortcuts()
  startPolling()
  void loadProject().catch(() => {})
  void refresh()
  const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 2000))
  idle(() => void preloadEditor().catch(() => {}))
}
