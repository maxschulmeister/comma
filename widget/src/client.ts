// Talks to the comma server and keeps the store up to date.
import type { Anchor } from "./anchor"
import { clearDrafts } from "./drafts"
import type { PageContext } from "./lib/env"
import { getState, type ProjectInfo, setState, subscribe } from "./store"
import type { Comment, FileRef, Session, Tag, TagColor, Thread, ThreadResult, User } from "./types"

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
  applySession(session)
}

// The composer keeps drafts per person: another person sees their own (see Composer).
function applySession(session: Session | null) {
  etag = null
  setState({
    session,
    signInOpen: false,
    ...(session ? {} : { threads: [], users: {}, tags: [], loaded: false, loadFailed: false }),
  })
  if (session) void refresh()
}

/**
 * The server ended this tab's session. The stored session can be newer: another tab signed in since. Then this tab
 * takes it; only a stored copy of the ended session is removed.
 */
function sessionEnded(session: Session) {
  const stored = loadSession()
  if (stored && stored.token !== session.token) applySession(stored)
  else saveSession(null)
}

/** All tabs of a site share one session: a sign-in or sign-out in another tab changes this tab too. */
export function followOtherTabs() {
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey()) return
    const stored = loadSession()
    if (stored?.token === getState().session?.token) return
    // Like a sign-in or sign-out here: an older attempt on its way must not win.
    authAttempt++
    applySession(stored)
  })
}

/**
 * True while the session that started a request is still the signed-in session.
 * By token: a poll replaces the session object with a fresh profile, the session stays the same.
 */
const isCurrent = (session: Session | null) => getState().session?.token === session?.token

const OFFLINE = "Cannot reach comma. Try again."

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
  const res = await fetch(`${server}${path}`, init).catch(() => {
    throw new ApiError(0, OFFLINE)
  })
  const data = await res.json().catch(() => ({}))
  if (signedIn) {
    if (res.status === 401 && session && isCurrent(session)) sessionEnded(session)
    // The answer belongs to a session that ended (sign-out, other user): it must not change the store.
    if (!isCurrent(session)) throw new ApiError(401, "You are signed out.")
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Something went wrong. Try again.")
  return data as T
}

export async function loadProject() {
  const { project } = getState()
  const info = await request<ProjectInfo>("GET", `/api/projects/${encodeURIComponent(project)}`, undefined, false)
  setState({
    projectInfo: {
      name: info.name,
      popupSignIn: info.popupSignIn,
      // Only a web address: the popup opens it.
      appUrl: typeof info.appUrl === "string" && /^https?:\/\//.test(info.appUrl) ? info.appUrl : undefined,
      slack: info.slack === true,
      guests: info.guests,
      toolbar: info.toolbar === "signed-in" ? "signed-in" : "always",
      details: info.details === "dialog" ? "dialog" : "panel",
      panel: info.panel === "push" ? "push" : "overlay",
    },
  })
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

// `data-token-from` (see loader.ts): the app's requests show its token, or no token.
let tokenSeen = false
let tokenGap = false
let signOutTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Signs in with the app's token: the first one on each page load (comma can still have a session of someone else),
 * and one that comes after requests without a token (another person may have signed in). Requests without a token for
 * 5 s: the app signed out. A token refresh also goes out without one, so comma waits.
 * `false`: the app removed its stored token (`data-token-key`). It signed out: comma too, at once.
 */
export function followAppToken(token: string | null | false) {
  clearTimeout(signOutTimer)
  if (token === false) {
    tokenGap = true
    if (getState().session) signOut()
    return
  }
  if (!token) {
    tokenGap = true
    signOutTimer = setTimeout(() => getState().session && signOut(), 5000)
    return
  }
  if (tokenSeen && !tokenGap) return
  tokenSeen = true
  tokenGap = false
  identify(token).catch(() => {})
}

export function signOut() {
  authAttempt++
  // The next person on this tab must not see the drafts.
  const { server, session } = getState()
  if (session) clearDrafts(session.user.id)
  setState({ draft: null, draftMove: null })
  saveSession(null)
  // End the session on the server too, so a copy of the token stops working. The tab is signed out already.
  if (session) {
    const headers = { authorization: `Bearer ${session.token}` }
    void fetch(`${server}/api/session`, { method: "DELETE", headers, credentials: "omit" }).catch(() => {})
  }
}

/**
 * Opens the app sign-in (or Slack's) in a popup. The popup sends the session back with postMessage.
 * Through the app (`appUrl`): the popup opens the app, which runs comma. comma asks it for the user until comma there is
 * signed in (also after the app's own login), and claims the hand-over it sends back (see answerSignInRequests).
 */
export function signInWithPopup(provider: "app" | "slack" = "app") {
  const { server, project, projectInfo } = getState()
  const appUrl = provider === "app" ? projectInfo?.appUrl : undefined
  const path = provider === "slack" ? "/auth/slack/start" : "/auth/start"
  const url =
    appUrl ?? `${server}${path}?project=${encodeURIComponent(project)}&origin=${encodeURIComponent(location.origin)}`
  const from = appUrl ? new URL(appUrl).origin : server
  const popup = window.open(url, "comma-sign-in", "popup,width=480,height=640")
  const attempt = ++authAttempt
  return new Promise<void>((resolve, reject) => {
    const finish = (session: Session) => {
      cleanup()
      // The popup also closes itself. Firefox blocks that after a few redirects, so close it here too.
      popup?.close()
      if (attempt === authAttempt) saveSession({ token: session.token, user: session.user })
      resolve()
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== from || event.source !== popup) return
      const data = event.data
      if (data?.project !== project) return
      if (data.type === "comma:session" && typeof data.token === "string") finish(data)
      else if (data.type === "comma:handoff" && typeof data.handoff === "string") {
        cleanup()
        request<Session>("POST", "/api/session/claim", { project, handoff: data.handoff }, false).then(
          finish,
          (error) => {
            popup?.close()
            reject(error)
          },
        )
      }
    }
    const timer = setInterval(() => {
      if (popup?.closed) {
        cleanup()
        reject(new ApiError(0, "Sign-in was closed."))
      } else if (appUrl) popup?.postMessage({ type: "comma:sign-in", project }, from)
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

/**
 * In the app (`appUrl`): a site of the project opened this window to sign in. Once comma here is signed in with the
 * app, it asks the server to hand the user over to that site, once. Only the site that opened the window gets it.
 */
export function answerSignInRequests() {
  if (!window.opener) return
  let site: { origin: string; window: MessageEventSource } | null = null
  let answered = false
  const answer = async () => {
    const user = getState().session?.user
    if (!site || answered || user?.kind !== "app") return
    answered = true
    const { origin, window: target } = site
    const { handoff } = await request<{ handoff: string }>("POST", "/api/session/handoff", { origin })
    target.postMessage({ type: "comma:handoff", project: getState().project, handoff }, { targetOrigin: origin })
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window.opener || event.data?.type !== "comma:sign-in") return
    if (event.data.project !== getState().project) return
    site ??= { origin: event.origin, window: window.opener }
    answer().catch(() => {})
  })
  subscribe(() => void answer().catch(() => {}))
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
      // The server answered (also "no change"): updates work.
      if (getState().loadFailed) setState({ loadFailed: false })
      stale = before !== changes
      if (result && !stale && isCurrent(session)) {
        const { data } = result
        etag = result.etag
        // A read change on its way sets the read state when its answer comes (see setRead).
        const local = new Map(getState().threads.map((t) => [t.id, t]))
        const threads = data.threads.map((t) => {
          const current = local.get(t.id)
          return current && readInFlight.get(t.id) ? { ...t, unread: current.unread } : t
        })
        setState({
          threads,
          users: data.users,
          tags: data.tags,
          loaded: true,
          loadFailed: false,
          session: session && { ...session, user: data.me },
        })
      }
    } catch {
      // Polling tries again later. Before the first load, the panel shows it.
      if (!getState().loadFailed) setState({ loadFailed: true })
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
    if (session && isCurrent(session)) sessionEnded(session)
    return null
  }
  if (!res.ok) throw new ApiError(res.status, "Could not load comments")
  if (!isCurrent(session)) return null
  // The caller keeps the ETag only if it uses the data.
  const data = (await res.json()) as { me: User; threads: Thread[]; users: Record<string, User>; tags: Tag[] }
  return { data, etag: res.headers.get("etag") }
}

const POLL_MS = 15_000
const IDLE_MS = 5 * 60_000
// Input that shows someone uses the page. Focus and a visible tab count too.
const ACTIVITY = ["pointermove", "pointerdown", "keydown", "wheel", "scroll", "touchstart", "focus"]

/**
 * Polls every 15 s while the tab is visible and someone uses the page. After 5 minutes with no input it stops,
 * so a tab that stays open costs no requests. The next input, focus or visible tab polls at once.
 */
export function startPolling() {
  let lastActivity = Date.now()
  const idle = () => Date.now() - lastActivity > IDLE_MS
  const tick = () => {
    if (document.visibilityState === "visible" && !idle()) void refresh()
  }
  const onActivity = (e: Event) => {
    const wasIdle = idle()
    lastActivity = Date.now()
    // Window focus polls at once. Focus on an element in the page only counts as input.
    if (wasIdle || (e.type === "focus" && e.target === window) || e.type === "visibilitychange") tick()
  }
  const options = { capture: true, passive: true }
  const timer = setInterval(tick, POLL_MS)
  for (const type of ACTIVITY) window.addEventListener(type, onActivity, options)
  document.addEventListener("visibilitychange", onActivity)
  return () => {
    clearInterval(timer)
    for (const type of ACTIVITY) window.removeEventListener(type, onActivity, options)
    document.removeEventListener("visibilitychange", onActivity)
  }
}

// Threads deleted here. A late answer about one of them must not bring it back.
const deleted = new Set<string>()

// Read changes per thread: the number of the latest one, and how many are on their way.
const readLatest = new Map<string, number>()
const readInFlight = new Map<string, number>()
let readCount = 0

/** `readAnswer`: the number of the read change this answer is for. */
function applyThread({ thread, users, tags }: ThreadResult, readAnswer?: number) {
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
      tags,
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

export async function createThread(input: {
  page: string
  anchor: Anchor
  body: unknown
  files: string[]
  context: PageContext
  screenshot?: string
}) {
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

export async function setAssignee(thread: Thread, assignee: string | null) {
  return applyThread(await request<ThreadResult>("PATCH", `/api/threads/${thread.id}`, { assignee }))
}

/** Makes a tag for the project. */
export async function createTag(name: string, color: TagColor) {
  const res = await request<{ tag: Tag; tags: Tag[] }>("POST", "/api/tags", { name, color })
  etag = null
  changes++
  setState({ tags: res.tags })
  return res.tag
}

/**
 * Changes the name or color of a tag that I made (or any tag that people made, for admins), or deletes it (`null`).
 * The threads and the panel filter change here at once: the server changes them for all threads.
 */
export async function changeTag(tag: Tag, change: { name: string; color: TagColor } | null) {
  const path = `/api/tags/${encodeURIComponent(tag.name)}`
  // A change answers with the changed tag. A delete has none.
  const res = await request<{ tag?: Tag; tags: Tag[] }>(change ? "PATCH" : "DELETE", path, change ?? undefined)
  const next = res.tag?.name ?? null
  const was = (name: string) => name.toLowerCase() === tag.name.toLowerCase()
  const rename = (names: string[]) => names.flatMap((name) => (!was(name) ? [name] : next ? [next] : []))
  etag = null
  changes++
  setState((s) => ({
    tags: res.tags,
    threads: s.threads.map((t) => (t.tags.some(was) ? { ...t, tags: rename(t.tags) } : t)),
    filters: { ...s.filters, tags: rename(s.filters.tags) },
  }))
}

/** Adds the tag to the thread, or removes it. */
export async function setThreadTag(thread: Thread, name: string, on: boolean) {
  const path = `/api/threads/${thread.id}/tags/${encodeURIComponent(name)}`
  return applyThread(await request<ThreadResult>(on ? "PUT" : "DELETE", path))
}

export async function moveThread(thread: Thread, page: string, anchor: Anchor) {
  const { session } = getState()
  // Show the new place at once. The server answer replaces it.
  changes++
  setState((s) => ({ threads: s.threads.map((t) => (t.id === thread.id ? { ...t, page, anchor } : t)) }))
  try {
    return applyThread(await request<ThreadResult>("PATCH", `/api/threads/${thread.id}`, { page, anchor }))
  } catch (error) {
    if (isCurrent(session)) applyThread({ thread, users: {}, tags: getState().tags })
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

/** The person allows a coding agent to work on the comments as them, or not (see /llms.txt on the server). */
export async function answerAgent(code: string, allow: boolean) {
  await request("POST", "/api/agent/connect", { code, allow })
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
