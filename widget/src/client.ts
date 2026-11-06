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

/**
 * True while the session that started a request is still the signed-in session.
 * By token: a poll replaces the session object with a fresh profile, the session stays the same.
 */
const isCurrent = (session: Session | null) => getState().session?.token === session?.token

/** `signedIn: false`: no session (sign-in, project info). The answer does not depend on the current session. */
async function request<T>(method: string, path: string, body?: unknown, signedIn = true): Promise<T> {
  const { server } = getState()
  const session = signedIn ? getState().session : null
  const init: RequestInit = { method, headers: {}, credentials: "omit" }
  const h = init.headers as Record<string, string>
  if (session) h.authorization = `Bearer ${session.token}`
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    h["content-type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`${server}${path}`, init)
  const data = await res.json().catch(() => ({}))
  if (signedIn) {
    if (res.status === 401 && session && isCurrent(session)) saveSession(null)
    // The answer belongs to a session that ended (sign-out, other user): it must not change the store.
    if (!isCurrent(session)) throw new ApiError(401, "You are signed out.")
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Something went wrong. Try again.")
  return data as T
}

export async function loadProject() {
  const { project } = getState()
  const info = await request<{ popupSignIn: boolean }>(
    "GET",
    `/api/projects/${encodeURIComponent(project)}`,
    undefined,
    false,
  )
  setState({ popupSignIn: info.popupSignIn })
}

// --- Sign-in ---

// Each sign-in attempt and each sign-out gets a number. Only the latest may change the session:
// a sign-out cancels a sign-in that is still on its way, and a newer sign-in wins over an older one.
let authAttempt = 0

async function signIn(path: string, body: Record<string, string>) {
  const attempt = ++authAttempt
  const session = await request<Session>("POST", path, { project: getState().project, ...body }, false)
  if (attempt === authAttempt) saveSession(session)
}

export const signInAsGuest = (name: string) => signIn("/api/session/guest", { name })

export const identify = (appToken: string) => signIn("/api/session/app", { appToken })

export function signOut() {
  authAttempt++
  saveSession(null)
}

// Opens the app sign-in in a popup. The popup sends the session back with postMessage.
export function signInWithPopup() {
  const { server, project } = getState()
  const url = `${server}/auth/start?project=${encodeURIComponent(project)}&origin=${encodeURIComponent(location.origin)}`
  const popup = window.open(url, "comma-sign-in", "popup,width=480,height=640")
  const attempt = ++authAttempt
  return new Promise<void>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== server || event.source !== popup) return
      const data = event.data
      if (data?.type !== "comma:session" || data.project !== project || typeof data.token !== "string") return
      cleanup()
      // The popup also closes itself. Firefox blocks that after a few redirects, so close it here too.
      popup?.close()
      if (attempt === authAttempt) saveSession({ token: data.token, user: data.user })
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
      const result = await requestThreads()
      stale = before !== changes
      if (result && !stale && isCurrent(session)) {
        const { data } = result
        etag = result.etag
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
    if (isCurrent(session)) saveSession(null)
    return null
  }
  if (!res.ok) throw new ApiError(res.status, "Could not load comments")
  if (!isCurrent(session)) return null
  // The caller keeps the ETag only if it uses the data.
  const data = (await res.json()) as { me: User; threads: Thread[]; users: Record<string, User> }
  return { data, etag: res.headers.get("etag") }
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

// Threads deleted here. A late answer about one of them must not bring it back.
const deleted = new Set<string>()

// Read changes per thread: the number of the latest one, and how many are on their way.
const readLatest = new Map<string, number>()
const readInFlight = new Map<string, number>()
let readCount = 0

/** `readAnswer`: the number of the read change this answer is for. */
function applyThread({ thread, users }: ThreadResult, readAnswer?: number) {
  etag = null
  changes++
  if (deleted.has(thread.id)) return thread
  setState((s) => {
    const current = s.threads.find((t) => t.id === thread.id)
    // Answers can arrive out of order: an older thread (lower revision) does not replace a newer one.
    // While a read change is on its way, only its own answer sets the read state.
    let next = current && current.updatedAt > thread.updatedAt ? current : thread
    const keepRead = readAnswer ? readLatest.get(thread.id) !== readAnswer : (readInFlight.get(thread.id) ?? 0) > 0
    if (current && keepRead) next = { ...next, unread: current.unread }
    return {
      threads: current ? s.threads.map((t) => (t.id === thread.id ? next : t)) : [...s.threads, next],
      users: { ...s.users, ...users },
    }
  })
  return thread
}

function removeThread(id: string) {
  etag = null
  changes++
  deleted.add(id)
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
  const res = await request<{ threadDeleted: true } | ({ threadDeleted: false } & ThreadResult)>(
    "DELETE",
    `/api/comments/${comment.id}`,
  )
  if (res.threadDeleted) removeThread(comment.threadId)
  else applyThread(res)
}

export async function deleteThread(thread: Thread) {
  await request("DELETE", `/api/threads/${thread.id}`)
  removeThread(thread.id)
}

export async function setStatus(thread: Thread, status: Thread["status"]) {
  return applyThread(await request<ThreadResult>("PATCH", `/api/threads/${thread.id}`, { status }))
}

export async function moveThread(thread: Thread, page: string, anchor: Anchor) {
  const { session } = getState()
  // Show the new place at once. The server answer replaces it.
  changes++
  setState((s) => ({ threads: s.threads.map((t) => (t.id === thread.id ? { ...t, page, anchor } : t)) }))
  try {
    return applyThread(await request<ThreadResult>("PATCH", `/api/threads/${thread.id}`, { page, anchor }))
  } catch (error) {
    if (isCurrent(session)) applyThread({ thread, users: {} })
    throw error
  }
}

export async function setRead(thread: Thread, read: boolean) {
  const setUnread = (unread: boolean) =>
    setState((s) => ({ threads: s.threads.map((t) => (t.id === thread.id ? { ...t, unread } : t)) }))
  const { session } = getState()
  const number = ++readCount
  readLatest.set(thread.id, number)
  readInFlight.set(thread.id, (readInFlight.get(thread.id) ?? 0) + 1)
  changes++
  setUnread(!read)
  try {
    // An older read change (open = read, then "Mark as unread") must not undo the newer one.
    return applyThread(await request<ThreadResult>("POST", `/api/threads/${thread.id}/read`, { read }), number)
  } catch (error) {
    if (readLatest.get(thread.id) === number && isCurrent(session)) {
      etag = null
      setUnread(thread.unread)
    }
    throw error
  } finally {
    readInFlight.set(thread.id, (readInFlight.get(thread.id) ?? 1) - 1)
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
