import type { Anchor } from "./anchor"
import type { SavedContext } from "./lib/env"

export type User = { id: string; name: string; kind: "guest" | "app"; avatarUrl: string | null; isAdmin: boolean }

/** The colors of tags. Each has Tailwind classes for the light and dark theme (see ui/tags.tsx). */
export type TagColor = "gray" | "red" | "orange" | "amber" | "green" | "teal" | "blue" | "violet" | "pink"

/** A tag of the project. `createdBy`: null for the tags of the project config. Case does not matter in names. */
export type Tag = { name: string; color: TagColor; createdBy: string | null }

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
  /** Where the comment was made. null: made before comma kept it. */
  context: SavedContext | null
  assigneeId: string | null
  /** Tag names, in the order of the project's tags. */
  tags: string[]
  /** The element when the thread was made. */
  screenshot: FileRef | null
  unread: boolean
  comments: Comment[]
}

export type ThreadResult = { thread: Thread; users: Record<string, User>; tags: Tag[] }
export type Session = { token: string; user: User }
