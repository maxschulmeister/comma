import { useSyncExternalStore } from "react"
import type { Anchor } from "./anchor"
import type { Session, Thread, User } from "./types"

export type Draft = { anchor: Anchor; element: Element; page: string }

export type Filters = {
  scope: "page" | "all"
  mine: boolean
  resolved: boolean
  sort: "date" | "unread"
  query: string
}

export type State = {
  server: string
  project: string
  popupSignIn: boolean
  session: Session | null
  loaded: boolean
  threads: Thread[]
  users: Record<string, User>
  /** URL path of the current page. Changes on client-side navigation. */
  page: string
  commentMode: boolean
  pinsVisible: boolean
  panelOpen: boolean
  openThreadId: string | null
  draft: Draft | null
  filters: Filters
  /** Set when an action needs a signed-in user. */
  signInOpen: boolean
}

type Listener = () => void

let state: State
const listeners = new Set<Listener>()

export function initStore(initial: State) {
  state = initial
}

export function getState() {
  return state
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }
  for (const listener of listeners) listener()
}

export function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Selects a value from the state. Return stable values (not new objects) from the selector. */
export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}
