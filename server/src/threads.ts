// Reads threads with their comments, reactions, files and read state, in the shape the widget uses.
import { publicUser, type User, type UserRow } from "./auth"
import type { Db } from "./db"

type ThreadRow = {
  id: string
  project: string
  page: string
  anchor: string
  status: "open" | "resolved"
  created_by: string
  created_at: number
  updated_at: number
  resolved_at: number | null
  resolved_by: string | null
}
type CommentRow = {
  id: string
  thread_id: string
  author_id: string
  body: string
  text: string
  created_at: number
  edited_at: number | null
}

export type Comment = {
  id: string
  threadId: string
  authorId: string
  body: unknown
  text: string
  createdAt: number
  editedAt: number | null
  mentions: string[]
  reactions: { emoji: string; userIds: string[] }[]
  files: { id: string; url: string; mime: string; width: number; height: number }[]
}

export type Thread = {
  id: string
  page: string
  anchor: unknown
  status: "open" | "resolved"
  createdBy: string
  createdAt: number
  updatedAt: number
  resolvedAt: number | null
  resolvedBy: string | null
  unread: boolean
  comments: Comment[]
}

export function getThreadRow(db: Db, project: string, id: string) {
  return db.query<ThreadRow, [string, string]>("select * from threads where id = ? and project = ?").get(id, project)
}

export function getCommentRow(db: Db, project: string, id: string) {
  return db
    .query<CommentRow & { project: string; thread_created_by: string }, [string, string]>(
      `select c.*, t.project, t.created_by as thread_created_by from comments c join threads t on t.id = c.thread_id
       where c.id = ? and t.project = ?`,
    )
    .get(id, project)
}

export function isFirstComment(db: Db, comment: { id: string; thread_id: string }) {
  const first = db
    .query<{ id: string }, [string]>("select id from comments where thread_id = ? order by created_at, rowid limit 1")
    .get(comment.thread_id)
  return first?.id === comment.id
}

// All threads of a project (or one thread), for one user.
export function loadThreads(db: Db, project: string, me: UserRow, onlyThread?: string) {
  const where = onlyThread ? "t.project = ? and t.id = ?" : "t.project = ?"
  const args = onlyThread ? [project, onlyThread] : [project]
  const threads = db
    .query<ThreadRow, string[]>(`select t.* from threads t where ${where} order by t.created_at, t.rowid`)
    .all(...args)
  const comments = db
    .query<CommentRow, string[]>(
      `select c.* from comments c join threads t on t.id = c.thread_id where ${where} order by c.created_at, c.rowid`,
    )
    .all(...args)
  const mentions = db
    .query<{ comment_id: string; user_id: string }, string[]>(
      `select m.* from mentions m join comments c on c.id = m.comment_id join threads t on t.id = c.thread_id where ${where}`,
    )
    .all(...args)
  const reactions = db
    .query<{ comment_id: string; user_id: string; emoji: string }, string[]>(
      `select r.comment_id, r.user_id, r.emoji from reactions r join comments c on c.id = r.comment_id
       join threads t on t.id = c.thread_id where ${where} order by r.created_at, r.rowid`,
    )
    .all(...args)
  const files = db
    .query<{ id: string; comment_id: string; mime: string; width: number; height: number }, string[]>(
      `select f.id, f.comment_id, f.mime, f.width, f.height from files f join comments c on c.id = f.comment_id
       join threads t on t.id = c.thread_id where ${where} order by f.created_at, f.rowid`,
    )
    .all(...args)
  const reads = new Map(
    db
      .query<{ thread_id: string; read_at: number; unread: number }, [string]>(
        "select thread_id, read_at, unread from reads where user_id = ?",
      )
      .all(me.id)
      .map((r) => [r.thread_id, r]),
  )

  const userIds = new Set<string>([me.id])
  const byComment = <T extends { comment_id: string }>(rows: T[]) => {
    const map = new Map<string, T[]>()
    for (const row of rows) map.set(row.comment_id, [...(map.get(row.comment_id) ?? []), row])
    return map
  }
  const mentionsBy = byComment(mentions)
  const reactionsBy = byComment(reactions)
  const filesBy = byComment(files)

  const commentsBy = new Map<string, Comment[]>()
  for (const c of comments) {
    userIds.add(c.author_id)
    const grouped = new Map<string, string[]>()
    for (const r of reactionsBy.get(c.id) ?? []) {
      grouped.set(r.emoji, [...(grouped.get(r.emoji) ?? []), r.user_id])
      userIds.add(r.user_id)
    }
    const mentioned = (mentionsBy.get(c.id) ?? []).map((m) => m.user_id)
    for (const id of mentioned) userIds.add(id)
    const comment: Comment = {
      id: c.id,
      threadId: c.thread_id,
      authorId: c.author_id,
      body: JSON.parse(c.body),
      text: c.text,
      createdAt: c.created_at,
      editedAt: c.edited_at,
      mentions: mentioned,
      reactions: [...grouped].map(([emoji, ids]) => ({ emoji, userIds: ids })),
      files: (filesBy.get(c.id) ?? []).map((f) => ({
        id: f.id,
        url: `/files/${f.id}`,
        mime: f.mime,
        width: f.width,
        height: f.height,
      })),
    }
    commentsBy.set(c.thread_id, [...(commentsBy.get(c.thread_id) ?? []), comment])
  }

  const result: Thread[] = threads.map((t) => {
    userIds.add(t.created_by)
    if (t.resolved_by) userIds.add(t.resolved_by)
    const list = commentsBy.get(t.id) ?? []
    const read = reads.get(t.id)
    const unread =
      read?.unread === 1 ||
      list.some((c) => c.authorId !== me.id && c.createdAt > (read?.read_at ?? Number.NEGATIVE_INFINITY))
    return {
      id: t.id,
      page: t.page,
      anchor: JSON.parse(t.anchor),
      status: t.status,
      createdBy: t.created_by,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      resolvedAt: t.resolved_at,
      resolvedBy: t.resolved_by,
      unread,
      comments: list,
    }
  })

  const users: Record<string, User> = {}
  const ids = [...userIds]
  if (ids.length > 0) {
    const rows = db
      .query<UserRow, string[]>(`select * from users where id in (${ids.map(() => "?").join(",")})`)
      .all(...ids)
    for (const u of rows) users[u.id] = publicUser(u)
  }
  return { threads: result, users }
}
