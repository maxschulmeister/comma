import { options } from "preact"
import { createRoot } from "react-dom/client"
import { App } from "./app"
import {
  answerSignInRequests,
  followAppToken,
  followOtherTabs,
  identify,
  loadProject,
  loadSession,
  refresh,
  signOut,
  startPolling,
} from "./client"
import { restoreDraft } from "./drafts"
import { PortalContainer } from "./lib/portal"
import { startTracking, watchPage } from "./live"
import { createShadowHost } from "./shadow"
import { getState, initStore, setState } from "./store"
import { loadPinsVisible, showCommentsWithPanel, startShortcuts } from "./ui/shortcuts"
import { keepReview, loadReview, loadView } from "./ui/view"

type Loader = {
  __queue: [string, unknown[]][]
  __script: { src: string; project: string; shortcut?: string; tokenFrom?: string }
}

// `data-shortcut` on the script tag: one letter, or "none". Default: C.
const parseShortcut = (value?: string) =>
  value === "none" ? null : value && /^[a-z]$/i.test(value) ? value.toLowerCase() : "c"

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
    projectInfo: null,
    revealed: new URLSearchParams(location.search).has("comma"),
    pendingLink: null,
    agentCode: null,
    session: null,
    loaded: false,
    loadFailed: false,
    threads: [],
    users: {},
    tags: [],
    page: location.pathname,
    commentMode: false,
    pinsVisible: loadPinsVisible(),
    hiddenView: null,
    panelOpen: false,
    ...loadView(),
    threadFocus: true,
    threadFromList: false,
    openThreadId: null,
    draft: null,
    draftMove: null,
    moving: null,
    filters: { scope: "page", status: "open", mine: false, rules: [], sort: "date", query: "" },
    signInOpen: false,
    notice: null,
    shortcut: parseShortcut(script.shortcut),
    appAccount: !!script.tokenFrom,
    detailsOpen: false,
  })
  setState({ session: loadSession(), ...loadReview() })
  keepReview()
  showCommentsWithPanel()
  followOtherTabs()
  answerSignInRequests()
  // `?comma`: a visitor wants to sign in (the toolbar can be hidden for visitors).
  if (getState().revealed && !getState().session) setState({ panelOpen: true })

  // The page API. Calls made before this module loaded wait in the queue.
  const api = {
    identify: (token: string) => identify(token),
    signOut: () => signOut(),
  }
  const run = ([name, args]: [string, unknown[]]) => {
    if (name === "identify" && typeof args[0] === "string") void api.identify(args[0]).catch(() => {})
    else if (name === "signOut") api.signOut()
    else if (name === "token" && (typeof args[0] === "string" || args[0] === null)) followAppToken(args[0])
    else if (name === "appSignedOut") followAppToken(false)
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
  portal.lang = "en"
  portal.dir = "ltr"
  root.after(portal)
  createRoot(root).render(
    <PortalContainer.Provider value={portal}>
      <App />
    </PortalContainer.Provider>,
  )

  // Client-side navigation: an open thread belongs to the old page. Each page has its own draft.
  watchPage((page) => {
    if (page !== getState().page) setState({ page, draft: restoreDraft(page), draftMove: null, openThreadId: null })
  })
  setState({ draft: restoreDraft(getState().page) })
  startTracking()
  startShortcuts()
  startPolling()
  void loadProjectUntilItWorks()
  void refresh()
}

/**
 * The toolbar needs the project's settings. A failed load (offline, server down) tries again: after 5 s, then
 * twice as long each time up to a minute, and at once when the browser is online again.
 */
async function loadProjectUntilItWorks() {
  for (let wait = 5000; ; wait = Math.min(wait * 2, 60_000)) {
    try {
      return await loadProject()
    } catch {
      const done = new AbortController()
      await new Promise<void>((resolve) => {
        setTimeout(resolve, wait)
        window.addEventListener("online", () => resolve(), { once: true, signal: done.signal })
      })
      done.abort()
    }
  }
}
