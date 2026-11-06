// Talks to the comma server and keeps the store up to date.
import type { Anchor } from "./anchor"
import { getState, setState } from "./store"
import type { Comment, FileRef, Session, Thread, ThreadResult, User } from "./types"

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const storageKey = () => `comma:${getState().server}:${getState().project}`

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(storageKey())
    const value = raw ? JSON.parse(raw) : null
    return value && typeof value.token === "string" && value.user?.id ? value : null
  } catch {
    return null // Storage can be blocked.
  }
}

function saveSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(storageKey(), JSON.stringify(session))
    else localStorage.removeItem(storageKey())
  } catch {
    // Storage can be blocked. The session then lasts until reload.
  }
  etag = null
  setState({ session, signInOpen: false, ...(session ? {} : { threads: [], users: {}, loaded: false }) })
  if (session) void refresh()
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const { server, session } = getState()
  const init: RequestInit = { method, headers: { ...headers }, credentials: "omit" }
  const h = init.headers as Record<string, string>
  if (session) h.authorization = `Bearer ${session.token}`
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    h["content-type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`${server}${path}`, init)
  if (res.status === 304) return null as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && session && getState().session === session) saveSession(null)
    throw new ApiError(res.status, data.error ?? "Something went wrong. Try again.")
  }
  return data as T
}

export async function loadProject() {
  const { project } = getState()
  const info = await request<{ popupSignIn: boolean }>("GET", `/api/projects/${encodeURIComponent(project)}`)
  setState({ popupSignIn: info.popupSignIn })
}

// --- Sign-in ---

export async function signInAsGuest(name: string) {
  const session = await request<Session>("POST", "/api/session/guest", { project: getState().project, name })
  saveSession(session)
}

export async function identify(appToken: string) {
  const session = await request<Session>("POST", "/api/session/app", { project: getState().project, appToken })
  saveSession(session)
}

export function signOut() {
  saveSession(null)
}

// Opens the app sign-in in a popup. The popup sends the session back with postMessage.
export function signInWithPopup() {
  const { server, project } = getState()
  const url = `${server}/auth/start?project=${encodeURIComponent(project)}&origin=${encodeURIComponent(location.origin)}`
  const popup = window.open(url, "comma-sign-in", "popup,width=480,height=640")
  return new Promise<void>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== server || event.source !== popup) return
      const data = event.data
      if (data?.type !== "comma:session" || data.project !== project || typeof data.token !== "string") return
      cleanup()
      // The popup also closes itself. Firefox blocks that after a few redirects, so close it here too.
      popup?.close()
      saveSession({ token: data.token, user: data.user })
      resolve()
    }
    const timer = setInterval(() => {
      if (popup?.closed) {
        cleanup()
        reject(new ApiError(0, "Sign-in was closed."))
      }
    }, 500)
    const cleanup = () => {
      clearInterval(timer)
      window.removeEventListener("message", onMessage)
    }
    window.addEventListener("message", onMessage)
    if (!popup) {
      cleanup()
      reject(new ApiError(0, "Allow popups for this site to sign in."))
    }
  })
}

// --- Threads ---

let etag: string | null = null
let inFlight: Promise<void> | null = null
// Counts local changes. A poll that started before a change has old data: it must not replace the change.
let changes = 0

export function refresh(): Promise<void> {
  if (!getState().session) return Promise.resolve()
  inFlight ??= (async () => {
    let stale = false
    try {
      const session = getState().session
      const before = changes
      const data = await requestThreads()
      stale = before !== changes
      if (data && !stale && getState().session === session) {
        setState({
          threads: data.threads,
          users: data.users,
          loaded: true,
          session: session && { ...session, user: data.me },
        })
      }
    } catch {
      // Polling tries again later.
    } finally {
      inFlight = null
    }
    if (stale) await refresh()
  })()
  return inFlight
}

async function requestThreads() {
  const { server, session } = getState()
  const res = await fetch(`${server}/api/threads`, {
    headers: { authorization: `Bearer ${session?.token}`, ...(etag ? { "if-none-match": etag } : {}) },
    credentials: "omit",
  })
  if (res.status === 304) return null
  if (res.status === 401) {
    // Only this session expired. A new one (identify, sign-in) may have started while this request ran.
    if (getState().session === session) saveSession(null)
    return null
  }
  if (!res.ok) throw new ApiError(res.status, "Could not load comments")
  if (getState().session !== session) return null
  etag = res.headers.get("etag")
  return (await res.json()) as { me: User; threads: Thread[]; users: Record<string, User> }
}

const POLL_MS = 15_000

/** Polls every 15 s while the tab is visible, and when the window gets focus. */
export function startPolling() {
  const tick = () => {
    if (document.visibilityState === "visible") void refresh()
  }
  const timer = setInterval(tick, POLL_MS)
  window.addEventListener("focus", tick)
  document.addEventListener("visibilitychange", tick)
  return () => {
    clearInterval(timer)
    window.removeEventListener("focus", tick)
    document.removeEventListener("visibilitychange", tick)
  }
}

function applyThread({ thread, users }: ThreadResult) {
  etag = null
  changes++
  setState((s) => {
    const exists = s.threads.some((t) => t.id === thread.id)
    return {
      threads: exists ? s.threads.map((t) => (t.id === thread.id ? thread : t)) : [...s.threads, thread],
      users: { ...s.users, ...users },
    }
  })
  return thread
}

function removeThread(id: string) {
  etag = null
  changes++
  setState((s) => ({
    threads: s.threads.filter((t) => t.id !== id),
    openThreadId: s.openThreadId === id ? null : s.openThreadId,
  }))
}

export async function createThread(input: { page: string; anchor: Anchor; body: unknown; files: string[] }) {
  return applyThread(await request<ThreadResult>("POST", "/api/threads", input))
}

export async function reply(threadId: string, body: unknown, files: string[]) {
  return applyThread(await request<ThreadResult>("POST", `/api/threads/${threadId}/comments`, { body, files }))
}

export async function editComment(comment: Comment, body: unknown) {
  return applyThread(await request<ThreadResult>("PATCH", `/api/comments/${comment.id}`, { body }))
}

export async function deleteComment(comment: Comment) {
  const res = await request<{ threadDeleted: boolean }>("DELETE", `/api/comments/${comment.id}`)
  if (res.threadDeleted) return removeThread(comment.threadId)
  etag = null
  changes++
  setState((s) => ({
    threads: s.threads.map((t) =>
      t.id === comment.threadId ? { ...t, comments: t.comments.filter((c) => c.id !== comment.id) } : t,
    ),
  }))
}

export async function deleteThread(thread: Thread) {
  await request("DELETE", `/api/threads/${thread.id}`)
  removeThread(thread.id)
}

export async function setStatus(thread: Thread, status: Thread["status"]) {
  return applyThread(await request<ThreadResult>("PATCH", `/api/threads/${thread.id}`, { status }))
}

export async function moveThread(thread: Thread, page: string, anchor: Anchor) {
  // Show the new place at once. The server answer replaces it.
  changes++
  setState((s) => ({ threads: s.threads.map((t) => (t.id === thread.id ? { ...t, page, anchor } : t)) }))
  try {
    return applyThread(await request<ThreadResult>("PATCH", `/api/threads/${thread.id}`, { page, anchor }))
  } catch (error) {
    applyThread({ thread, users: {} })
    throw error
  }
}

export async function setRead(thread: Thread, read: boolean) {
  const setUnread = (unread: boolean) =>
    setState((s) => ({ threads: s.threads.map((t) => (t.id === thread.id ? { ...t, unread } : t)) }))
  changes++
  setUnread(!read)
  try {
    return applyThread(await request<ThreadResult>("POST", `/api/threads/${thread.id}/read`, { read }))
  } catch (error) {
    etag = null
    setUnread(thread.unread)
    throw error
  }
}

export async function toggleReaction(comment: Comment, emoji: string) {
  const me = getState().session?.user.id
  const mine = comment.reactions.some((r) => r.emoji === emoji && me && r.userIds.includes(me))
  const path = `/api/comments/${comment.id}/reactions/${encodeURIComponent(emoji)}`
  return applyThread(await request<ThreadResult>(mine ? "DELETE" : "PUT", path))
}

export async function searchUsers(q: string) {
  if (!getState().session) return []
  const res = await request<{ users: User[] }>("GET", `/api/users?q=${encodeURIComponent(q)}`)
  return res.users
}

export async function uploadFile(file: File) {
  const form = new FormData()
  form.set("file", file)
  return request<FileRef>("POST", "/api/files", form)
}

export function fileUrl(file: { url: string }) {
  return `${getState().server}${file.url}`
}
