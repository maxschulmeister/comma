import type { Anchor } from "./anchor"

export type User = { id: string; name: string; kind: "guest" | "app"; avatarUrl: string | null; isAdmin: boolean }

export type FileRef = { id: string; url: string; mime: string; width: number; height: number }

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
  files: FileRef[]
}

export type Thread = {
  id: string
  page: string
  anchor: Anchor
  status: "open" | "resolved"
  createdBy: string
  createdAt: number
  updatedAt: number
  resolvedAt: number | null
  resolvedBy: string | null
  unread: boolean
  comments: Comment[]
}

export type ThreadResult = { thread: Thread; users: Record<string, User> }
export type Session = { token: string; user: User }
