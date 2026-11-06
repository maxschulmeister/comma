import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import {
  createGuest,
  getUser,
  newId,
  publicUser,
  signSession,
  type UserRow,
  upsertAppUser,
  verifyAppToken,
  verifySession,
} from "./auth"
import { parseBody } from "./body"
import { type Config, ConfigSchema, type Project } from "./config"
import type { Db } from "./db"
import { MAX_IMAGE_BYTES, readImage } from "./images"
import { popupRoutes } from "./popup"
import { RateLimit } from "./rate-limit"
import { getCommentRow, getThreadRow, isFirstComment, loadThreads } from "./threads"
import { widgetRoutes } from "./widget"

export type AppOptions = {
  db: Db
  config: Config
  /** Signs session tokens. */
  secret: string
  widgetDir: string
  now?: () => number
}

type Env = { Variables: { user: UserRow; project: Project } }

const MAX_FILES = 5
const UNUSED_FILE_MS = 24 * 60 * 60 * 1000
// Images that no comment uses yet, per project. New guests cannot get around it.
const MAX_UNUSED_BYTES = 200 * 1024 * 1024

const Point = z.object({ x: z.number().finite(), y: z.number().finite() })
const AnchorSchema = z
  .object({
    selectors: z.object({
      anchor: z.string().max(200).optional(),
      id: z.string().max(200).optional(),
      css: z.string().max(2000).optional(),
    }),
    tag: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .max(64),
    text: z.string().max(300),
    context: z.string().max(300),
    twins: z.number().int().min(2).max(100_000).optional(),
    fingerprint: z.string().max(16).optional(),
    repeated: z.boolean().optional(),
    scope: z.object({ depth: z.number().int().min(1).max(10), hash: z.string().max(16) }).optional(),
    card: z
      .object({ depth: z.number().int().min(1).max(10), urls: z.array(z.string().max(16)).min(1).max(50) })
      .optional(),
    point: Point.optional(),
    rect: Point.extend({ width: z.number().finite(), height: z.number().finite() }).optional(),
    viewport: z.number().int().min(0).max(100_000),
  })
  .refine((a) => !!a.point !== !!a.rect, "An anchor has a point or a rect")
const Page = z
  .string()
  .max(2000)
  .regex(/^\/[^\s#?]*$/, "A page is a URL path")
const FileIds = z.array(z.string().max(100)).max(MAX_FILES).default([])

const CreateThread = z.object({ page: Page, anchor: AnchorSchema, body: z.unknown(), files: FileIds })
const UpdateThread = z.union([
  z.object({ status: z.enum(["open", "resolved"]) }),
  z.object({ page: Page, anchor: AnchorSchema }),
])
const CreateComment = z.object({ body: z.unknown(), files: FileIds })
const UpdateComment = z.object({ body: z.unknown() })
const Read = z.object({ read: z.boolean() })
const Emoji = z
  .string()
  .max(32)
  .regex(/^(\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\u200d\ufe0f\u20e3#*0-9])+$/u)

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data)
  if (!result.success) throw new HTTPException(400, { message: result.error.issues[0]?.message ?? "Bad request" })
  return result.data
}

async function json(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return await c.req.json()
  } catch {
    throw new HTTPException(400, { message: "Send JSON" })
  }
}

export function createApp(options: AppOptions) {
  const { db, secret } = options
  const now = options.now ?? Date.now
  const config = ConfigSchema.parse(options.config)
  const projects = new Map(config.projects.map((p) => [p.id, p]))
  const allOrigins = new Set(config.projects.flatMap((p) => p.origins))
  const rateLimit = new RateLimit(100, 60 * 60 * 1000)
  const uploadLimit = new RateLimit(100, 60 * 60 * 1000)

  const bump = (project: string) =>
    db
      .query(
        "insert into versions (project, version) values (?, 1) on conflict (project) do update set version = version + 1",
      )
      .run(project)
  // `updated_at` is the thread revision: it always grows, also for two changes in the same millisecond.
  const touch = (threadId: string) =>
    db.query("update threads set updated_at = max(?, updated_at + 1) where id = ?").run(now(), threadId)
  const markRead = (userId: string, threadId: string) => {
    db.query(
      `insert into reads (user_id, thread_id, read_at, unread) values (?, ?, ?, 0)
       on conflict (user_id, thread_id) do update set read_at = excluded.read_at, unread = 0`,
    ).run(userId, threadId, now())
    db.query("update users set reads_version = reads_version + 1 where id = ?").run(userId)
  }

  // Other clients must see a new name or avatar: a change invalidates their ETag.
  const appUser = (project: Project, claims: NonNullable<Awaited<ReturnType<typeof verifyAppToken>>>) => {
    const { user, changed } = upsertAppUser(db, project, claims, now())
    if (changed) bump(project.id)
    return user
  }

  const app = new Hono<Env>()

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    console.error(err)
    return c.json({ error: "Server error" }, 500)
  })

  app.route("/", widgetRoutes(options.widgetDir))

  app.get("/files/:id", (c) => {
    const file = db
      .query<{ mime: string; data: Uint8Array }, [string]>("select mime, data from files where id = ?")
      .get(c.req.param("id"))
    if (!file) return c.notFound()
    return new Response(new Uint8Array(file.data), {
      headers: {
        "content-type": file.mime,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
        "cross-origin-resource-policy": "cross-origin",
      },
    })
  })

  app.route(
    "/auth",
    popupRoutes({
      projects,
      secret,
      session: async (project, appToken) => {
        const claims = await verifyAppToken(project, appToken)
        if (!claims) return null
        const user = appUser(project, claims)
        return { token: await signSession(secret, user), user: publicUser(user) }
      },
    }),
  )

  // CORS: only origins of a registered project. Each route also checks the origin against its project.
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin")
    const allowed = origin && allOrigins.has(origin) ? origin : null
    if (c.req.method === "OPTIONS") {
      const headers: Record<string, string> = { vary: "Origin" }
      if (allowed) {
        headers["access-control-allow-origin"] = allowed
        headers["access-control-allow-methods"] = "GET, POST, PUT, PATCH, DELETE"
        headers["access-control-allow-headers"] = "authorization, content-type, if-none-match"
        headers["access-control-max-age"] = "600"
      }
      return c.body(null, 204, headers)
    }
    await next()
    c.res.headers.append("vary", "Origin")
    if (allowed) {
      c.res.headers.set("access-control-allow-origin", allowed)
      c.res.headers.set("access-control-expose-headers", "etag")
    }
  })

  const projectFor = (id: unknown, origin: string | undefined) => {
    const project = typeof id === "string" ? projects.get(id) : undefined
    if (!project) throw new HTTPException(404, { message: "Unknown project" })
    if (!origin || !project.origins.includes(origin)) throw new HTTPException(403, { message: "Origin not allowed" })
    return project
  }

  app.get("/api/projects/:id", (c) => {
    const project = projectFor(c.req.param("id"), c.req.header("origin"))
    return c.json({ id: project.id, popupSignIn: !!(project.signInUrl && project.appSecret) })
  })

  app.post("/api/session/guest", async (c) => {
    const input = parse(z.object({ project: z.string(), name: z.string().trim().min(1).max(60) }), await json(c))
    const project = projectFor(input.project, c.req.header("origin"))
    const user = createGuest(db, project, input.name, now())
    return c.json({ token: await signSession(secret, user), user: publicUser(user) })
  })

  app.post("/api/session/app", async (c) => {
    const input = parse(z.object({ project: z.string(), appToken: z.string().max(10_000) }), await json(c))
    const project = projectFor(input.project, c.req.header("origin"))
    if (!project.appSecret) throw new HTTPException(404, { message: "This project has no app sign-in" })
    const claims = await verifyAppToken(project, input.appToken)
    if (!claims) throw new HTTPException(401, { message: "Invalid app token" })
    const user = appUser(project, claims)
    return c.json({ token: await signSession(secret, user), user: publicUser(user) })
  })

  const auth = createMiddleware<Env>(async (c, next) => {
    const header = c.req.header("authorization") ?? ""
    const session = header.startsWith("Bearer ") ? await verifySession(secret, header.slice(7)) : null
    const user = session && getUser(db, session.userId)
    const project = session && projects.get(session.project)
    if (!session || !user || !project || user.project !== project.id) {
      throw new HTTPException(401, { message: "Sign in again" })
    }
    const origin = c.req.header("origin")
    if (!origin || !project.origins.includes(origin)) throw new HTTPException(403, { message: "Origin not allowed" })
    c.set("user", user)
    c.set("project", project)
    await next()
  })
  app.use("/api/*", auth)

  const limit = (user: UserRow) => {
    if (!rateLimit.take(user.id, now()))
      throw new HTTPException(429, { message: "Too many comments. Try again later." })
  }

  // Checks files: uploaded by this user, in this project, not used yet.
  const claimFiles = (user: UserRow, ids: string[]) => {
    for (const id of ids) {
      const file = db
        .query<{ id: string }, [string, string, string]>(
          "select id from files where id = ? and project = ? and uploaded_by = ? and comment_id is null",
        )
        .get(id, user.project, user.id)
      if (!file) throw new HTTPException(400, { message: "Unknown image" })
    }
    return [...new Set(ids)]
  }

  const bodyOf = (input: unknown, hasFiles: boolean) => {
    const parsed = parseBody(input)
    if ("error" in parsed) throw new HTTPException(400, { message: parsed.error })
    if (!parsed.text && !hasFiles) throw new HTTPException(400, { message: "The comment is empty" })
    return parsed
  }

  const insertComment = (
    user: UserRow,
    threadId: string,
    parsed: Extract<ReturnType<typeof parseBody>, { body: unknown }>,
    files: string[],
  ) => {
    const id = newId()
    db.query("insert into comments (id, thread_id, author_id, body, text, created_at) values (?, ?, ?, ?, ?, ?)").run(
      id,
      threadId,
      user.id,
      JSON.stringify(parsed.body),
      parsed.text,
      now(),
    )
    saveMentions(user, id, parsed.mentions)
    for (const fileId of files) db.query("update files set comment_id = ? where id = ?").run(id, fileId)
    return id
  }

  // Mentions of users in the same project only.
  const saveMentions = (user: UserRow, commentId: string, ids: string[]) => {
    db.query("delete from mentions where comment_id = ?").run(commentId)
    for (const id of ids) {
      const target = getUser(db, id)
      if (target?.project === user.project) {
        db.query("insert or ignore into mentions (comment_id, user_id) values (?, ?)").run(commentId, id)
      }
    }
  }

  const thread = (user: UserRow, id: string) => {
    const result = loadThreads(db, user.project, user, id)
    return { thread: result.threads[0], users: result.users }
  }

  const findThread = (user: UserRow, id: string) => {
    const row = getThreadRow(db, user.project, id)
    if (!row) throw new HTTPException(404, { message: "Thread not found" })
    return row
  }

  const findComment = (user: UserRow, id: string) => {
    const row = getCommentRow(db, user.project, id)
    if (!row) throw new HTTPException(404, { message: "Comment not found" })
    return row
  }

  app.get("/api/threads", (c) => {
    const user = c.get("user")
    const version = db
      .query<{ version: number }, [string]>("select version from versions where project = ?")
      .get(user.project)
    const etag = `"${version?.version ?? 0}-${user.reads_version}-${user.id}"`
    c.header("etag", etag)
    c.header("cache-control", "no-cache")
    if (c.req.header("if-none-match") === etag) return c.body(null, 304)
    return c.json({ me: publicUser(user), ...loadThreads(db, user.project, user) })
  })

  app.post("/api/threads", async (c) => {
    const user = c.get("user")
    const input = parse(CreateThread, await json(c))
    const files = claimFiles(user, input.files)
    const parsed = bodyOf(input.body, files.length > 0)
    limit(user)
    const id = newId()
    db.transaction(() => {
      db.query(
        "insert into threads (id, project, page, anchor, created_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
      ).run(id, user.project, input.page, JSON.stringify(input.anchor), user.id, now(), now())
      insertComment(user, id, parsed, files)
      markRead(user.id, id)
      bump(user.project)
    })()
    return c.json(thread(user, id))
  })

  app.patch("/api/threads/:id", async (c) => {
    const user = c.get("user")
    const row = findThread(user, c.req.param("id"))
    const input = parse(UpdateThread, await json(c))
    if ("status" in input) {
      if (input.status !== row.status) {
        const resolved = input.status === "resolved"
        db.query(
          "update threads set status = ?, resolved_at = ?, resolved_by = ?, updated_at = max(?, updated_at + 1) where id = ?",
        ).run(input.status, resolved ? now() : null, resolved ? user.id : null, now(), row.id)
      }
    } else {
      if (row.created_by !== user.id) throw new HTTPException(403, { message: "Only the author can move this comment" })
      db.query("update threads set page = ?, anchor = ?, updated_at = max(?, updated_at + 1) where id = ?").run(
        input.page,
        JSON.stringify(input.anchor),
        now(),
        row.id,
      )
    }
    bump(user.project)
    return c.json(thread(user, row.id))
  })

  app.delete("/api/threads/:id", (c) => {
    const user = c.get("user")
    const row = findThread(user, c.req.param("id"))
    if (row.created_by !== user.id && user.is_admin !== 1) {
      throw new HTTPException(403, { message: "Only the author or an admin can delete this thread" })
    }
    db.transaction(() => {
      db.query("delete from threads where id = ?").run(row.id)
      bump(user.project)
    })()
    return c.json({ ok: true })
  })

  app.post("/api/threads/:id/read", async (c) => {
    const user = c.get("user")
    const row = findThread(user, c.req.param("id"))
    const input = parse(Read, await json(c))
    if (input.read) markRead(user.id, row.id)
    else {
      db.query(
        `insert into reads (user_id, thread_id, read_at, unread) values (?, ?, 0, 1)
         on conflict (user_id, thread_id) do update set unread = 1`,
      ).run(user.id, row.id)
      db.query("update users set reads_version = reads_version + 1 where id = ?").run(user.id)
    }
    return c.json(thread(user, row.id))
  })

  app.post("/api/threads/:id/comments", async (c) => {
    const user = c.get("user")
    const row = findThread(user, c.req.param("id"))
    const input = parse(CreateComment, await json(c))
    const files = claimFiles(user, input.files)
    const parsed = bodyOf(input.body, files.length > 0)
    limit(user)
    let id = ""
    db.transaction(() => {
      id = insertComment(user, row.id, parsed, files)
      touch(row.id)
      markRead(user.id, row.id)
      bump(user.project)
    })()
    const result = thread(user, row.id)
    return c.json({ ...result, comment: result.thread?.comments.find((x) => x.id === id) })
  })

  app.patch("/api/comments/:id", async (c) => {
    const user = c.get("user")
    const row = findComment(user, c.req.param("id"))
    if (row.author_id !== user.id) throw new HTTPException(403, { message: "Only the author can edit this comment" })
    const input = parse(UpdateComment, await json(c))
    const hasFiles = !!db.query("select 1 from files where comment_id = ?").get(row.id)
    const parsed = bodyOf(input.body, hasFiles)
    db.transaction(() => {
      db.query("update comments set body = ?, text = ?, edited_at = ? where id = ?").run(
        JSON.stringify(parsed.body),
        parsed.text,
        now(),
        row.id,
      )
      saveMentions(user, row.id, parsed.mentions)
      touch(row.thread_id)
      bump(user.project)
    })()
    const result = thread(user, row.thread_id)
    return c.json({ ...result, comment: result.thread?.comments.find((x) => x.id === row.id) })
  })

  app.delete("/api/comments/:id", (c) => {
    const user = c.get("user")
    const row = findComment(user, c.req.param("id"))
    if (row.author_id !== user.id) throw new HTTPException(403, { message: "Only the author can delete this comment" })
    // The first comment is the thread. Its author is the thread author.
    const deletesThread = isFirstComment(db, row)
    db.transaction(() => {
      if (deletesThread) db.query("delete from threads where id = ?").run(row.thread_id)
      else {
        db.query("delete from comments where id = ?").run(row.id)
        touch(row.thread_id)
      }
      bump(user.project)
    })()
    if (deletesThread) return c.json({ ok: true, threadDeleted: true })
    return c.json({ ok: true, threadDeleted: false, ...thread(user, row.thread_id) })
  })

  const react = (add: boolean) =>
    createMiddleware<Env>(async (c) => {
      const user = c.get("user")
      const row = findComment(user, c.req.param("id") ?? "")
      const emoji = parse(Emoji, decodeURIComponent(c.req.param("emoji") ?? ""))
      db.transaction(() => {
        if (add) {
          db.query("insert or ignore into reactions (comment_id, user_id, emoji, created_at) values (?, ?, ?, ?)").run(
            row.id,
            user.id,
            emoji,
            now(),
          )
        } else
          db.query("delete from reactions where comment_id = ? and user_id = ? and emoji = ?").run(
            row.id,
            user.id,
            emoji,
          )
        touch(row.thread_id)
        bump(user.project)
      })()
      return c.json(thread(user, row.thread_id))
    })
  app.put("/api/comments/:id/reactions/:emoji", react(true))
  app.delete("/api/comments/:id/reactions/:emoji", react(false))

  // Mention picker: signed-in app users and people who commented.
  app.get("/api/users", (c) => {
    const user = c.get("user")
    const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 60)
    const rows = db
      .query<UserRow, [string, string, string]>(
        `select * from users u where u.project = ?
         and (u.kind = 'app' or exists (select 1 from comments c where c.author_id = u.id))
         and instr(lower(u.name), ?) > 0
         order by (instr(lower(u.name), ?) = 1) desc, u.name limit 8`,
      )
      .all(user.project, q, q)
    return c.json({ users: rows.map(publicUser) })
  })

  app.post("/api/files", async (c) => {
    const user = c.get("user")
    let form: FormData
    try {
      form = await c.req.formData()
    } catch {
      throw new HTTPException(400, { message: "Send the image as form data" })
    }
    const file = form.get("file")
    if (!(file instanceof File)) throw new HTTPException(400, { message: "Send the image in the field 'file'" })
    if (!uploadLimit.take(user.id, now()))
      throw new HTTPException(429, { message: "Too many images. Try again later." })
    if (file.size > MAX_IMAGE_BYTES) throw new HTTPException(413, { message: "Images can be up to 5 MB" })
    const unused = db
      .query<{ total: number | null }, [string]>(
        "select sum(size) as total from files where project = ? and comment_id is null",
      )
      .get(user.project)
    if ((unused?.total ?? 0) + file.size > MAX_UNUSED_BYTES) {
      throw new HTTPException(507, { message: "Too many images waiting. Try again later." })
    }
    const data = new Uint8Array(await file.arrayBuffer())
    const info = readImage(data)
    if (!info) throw new HTTPException(415, { message: "Use a PNG, JPEG, GIF or WebP image" })
    const id = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url")
    db.query(
      "insert into files (id, project, uploaded_by, mime, size, width, height, data, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, user.project, user.id, info.mime, data.length, info.width, info.height, data, now())
    return c.json({ id, url: `/files/${id}`, mime: info.mime, width: info.width, height: info.height })
  })

  return Object.assign(app, {
    /** Deletes uploads that no comment uses after 24 h. */
    cleanupFiles: () =>
      db.query("delete from files where comment_id is null and created_at < ?").run(now() - UNUSED_FILE_MS).changes,
  })
}
