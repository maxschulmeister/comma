// Unsent comments. They stay when the popover closes and after a reload, for the person who wrote them.
// In sessionStorage: one tab, until it closes. Uploads on their way stay in memory (see Composer).
import { type Anchor, resolveAnchor } from "./anchor"
import type { JSONContent } from "./editor/editor"
import { type Draft, getState, setState } from "./store"
import type { FileRef } from "./types"

/** `anchor`: for a new thread, the place it goes. */
export type SavedDraft = { json: JSONContent; files: FileRef[]; anchor?: Anchor }

const prefix = () => `comma:draft:${getState().server}:${getState().project}:`

/** Kinds: `new:<page>` (one new thread per page), `reply:<thread id>`. */
export const draftKey = (userId: string, kind: string) => `${prefix()}${userId}:${kind}`

/** The key of the new-thread draft on a page, for the signed-in person. */
export const newDraftKey = (page: string) => {
  const user = getState().session?.user.id
  return user ? draftKey(user, `new:${page}`) : null
}

// Storage can be blocked or full. Then drafts last until reload.
const memory = new Map<string, SavedDraft>()

export function loadDraft(key: string): SavedDraft | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as SavedDraft) : null
  } catch {
    return memory.get(key) ?? null
  }
}

export function saveDraft(key: string, draft: SavedDraft | null) {
  if (draft) memory.set(key, draft)
  else memory.delete(key)
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft))
    else sessionStorage.removeItem(key)
  } catch {
    // See `memory`.
  }
}

export const hasDraft = (key: string | null) => !!key && !!loadDraft(key)

/** Sign-out: the next person on this tab must not see the drafts. */
export function clearDrafts(userId: string) {
  try {
    const start = `${prefix()}${userId}:`
    for (const key of memory.keys()) if (key.startsWith(start)) memory.delete(key)
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(start)) sessionStorage.removeItem(key)
  } catch {
    // Storage can be blocked.
  }
}

let nextId = 0
export const newDraft = (anchor: Anchor, element: Element, page: string): Draft => ({
  id: ++nextId,
  anchor,
  element,
  page,
  open: true,
})

/** The popover closes: a draft with text stays as a pin, an empty one goes. */
export function closeDraft() {
  const { draft } = getState()
  if (!draft) return
  setState({ draft: hasDraft(newDraftKey(draft.page)) ? { ...draft, open: false } : null })
}

/** The saved draft of this page, as a closed pin on its element. None if the element is not on the page. */
export function restoreDraft(page: string) {
  const key = newDraftKey(page)
  const anchor = key && loadDraft(key)?.anchor
  const element = anchor ? resolveAnchor(anchor) : null
  return anchor && element ? { ...newDraft(anchor, element, page), open: false } : null
}
