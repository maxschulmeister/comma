import { createContext, useContext } from "react"

// Popups render into the widget shadow root, not into document.body.
export const PortalContainer = createContext<HTMLElement | null>(null)

export function usePortalContainer() {
  return useContext(PortalContainer) ?? undefined
}
