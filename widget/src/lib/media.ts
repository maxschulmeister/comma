import { useSyncExternalStore } from "react"

/** Screens narrower than 640 px: the panel covers the full screen. */
export const NARROW = "(max-width: 639px)"

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches

/** True while the media query matches. */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const media = matchMedia(query)
      media.addEventListener("change", onChange)
      return () => media.removeEventListener("change", onChange)
    },
    () => matchMedia(query).matches,
  )
}
