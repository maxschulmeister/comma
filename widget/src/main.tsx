import { createRoot } from "react-dom/client"
import { App } from "./App"
import { PortalContainer } from "./lib/portal"
import { createShadowHost } from "./shadow"

const { root } = createShadowHost(new URL(".", import.meta.url).href)
const portal = document.createElement("div")
root.after(portal)
portal.className = "comma-root"
createRoot(root).render(
  <PortalContainer.Provider value={portal}>
    <App />
  </PortalContainer.Provider>,
)
