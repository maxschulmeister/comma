import { useSyncExternalStore } from "react"
import type { Anchor } from "./anchor"
import type { Session, Thread, User } from "./types"

/** A new thread that is not sent yet. `open`: the composer shows. Else only its pin. */
export type Draft = { id: number; anchor: Anchor; element: Element; page: string; open: boolean }

/** A short message about what an action did, with an optional action ("Undo"). */
/** A short message in the toolbar (see notices.tsx). `stay`: it does not go after a time. */
export type Notice = {
  id: number
  text: string
  action?: { kind: "undo" | "retry"; run: () => void }
  stay?: boolean
}

/** From the server: how people sign in, and who sees the toolbar. */
/** View settings (see ui/view.ts). */
export type PanelMode = "overlay" | "push"
export type PanelSide = "left" | "right"
export type DetailsMode = "panel" | "dialog"

export type ProjectInfo = {
  name?: string
  popupSignIn: boolean
  /** Sign-in through the app: the popup opens this page of the app, and comma there hands the user over. */
  appUrl?: string
  slack: boolean
  guests: boolean
  toolbar: "always" | "signed-in"
  details: DetailsMode
  panel: PanelMode
}

export type Filters = {
  scope: "page" | "all"
  mine: boolean
  assigned: boolean
  resolved: boolean
  sort: "date" | "unread"
  query: string
}

export type State = {
  server: string
  project: string
  /** null until it loads. */
  projectInfo: ProjectInfo | null
  /** A visitor asked for the widget: `?comma` in the URL, or a link to a thread. */
  revealed: boolean
  /** Thread in the URL hash (#comma=<id>) that opens after sign-in and load. */
  pendingLink: string | null
  session: Session | null
  loaded: boolean
  /** The last load of the threads did not reach comma. */
  loadFailed: boolean
  threads: Thread[]
  users: Record<string, User>
  /** URL path of the current page. Changes on client-side navigation. */
  page: string
  commentMode: boolean
  pinsVisible: boolean
  /** What hiding the comments took off the page. Showing them brings it back (see togglePins). */
  hiddenView: HiddenView | null
  panelOpen: boolean
  /** The person's view choices in this browser. null: the project default (see view.ts). */
  panelMode: PanelMode | null
  panelSide: PanelSide | null
  detailsMode: DetailsMode | null
  openThreadId: string | null
  /** The open thread takes the focus. Not when ↑ ↓ in the panel list select it: the focus stays in the list. */
  threadFocus: boolean
  /** The focus went into the open thread from the panel list: Escape goes back there, not closing the thread. */
  threadFromList: boolean
  draft: Draft | null
  /** A click on another place while a draft has text: asks if the draft moves there. */
  draftMove: { anchor: Anchor; element: Element; page: string } | null
  /** Thread whose pin the user moves with the keyboard or a click (thread menu, Move). */
  moving: string | null
  filters: Filters
  /** Set when an action needs a signed-in user. */
  signInOpen: boolean
  notice: Notice | null
  /** The details of the open thread show (in the panel or a dialog, see details.tsx). */
  detailsOpen: boolean
  /** The key for comment mode (with Shift: show or hide comments). null: no shortcut. */
  shortcut: string | null
  /** The app decides who is signed in (`data-token-from`): comma has no sign-out of its own. */
  appAccount: boolean
}

export type HiddenView = { panelOpen: boolean; threadId: string | null; details: boolean }

type Listener = () => void

let state: State
const listeners = new Set<Listener>()

/** The toolbar and the shortcuts are there for signed-in people, and for everyone unless the project hides them. */
/** The open thread takes the focus: not when it was selected in the panel list, and not with the details open. */
export const threadTakesFocus = (s: State) => s.threadFocus && !s.detailsOpen

export const widgetVisible = (s: State) => !!s.session || s.projectInfo?.toolbar === "always" || s.revealed

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
