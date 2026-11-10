import { type Context, Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { HTTPException } from "hono/http-exception"
import { sign, verify } from "hono/jwt"
import { z } from "zod"
import { connectLink, connectPage, llmsTxt, newCode, textBody, threadsMarkdown } from "./agent"
import {
  appUserClaims,
  type Claims,
  createGuest,
  getSessionUser,
  newId,
  publicUser,
  randomToken,
  startSession,
  type UserRow,
  upsertAppUser,
  verifySession,
} from "./auth"
import { MAX_BODY_BYTES, parseBody } from "./body"
import { allowsHost, allowsOrigin, type Config, ConfigSchema, originOf, type Project } from "./config"
import { all, type Db, get, run, sql } from "./db"
import type { FileStore } from "./files"
import { MAX_IMAGE_BYTES, readImage } from "./images"
import { popupRoutes } from "./popup"
import { takeLimit } from "./rate-limit"
import { tagKey } from "./tags"
import { getCommentRow, getThreadRow, isFirstComment, loadThreads, type Scope } from "./threads"
import { widgetRoutes } from "./widget"

export type AppOptions = {
  db: Db
  config: Config
  /** Signs session tokens. */
  secret: string
  /** The built widget (`widget/dist`). Without it, the platform serves the widget files (Workers, Vercel). */
  widgetDir?: string
  /** Where image bytes live. Default: in the database. */
  files?: FileStore
  now?: () => number
  /** The address users reach comma at, behind a proxy (`COMMA_URL`). The popup sign-in callback uses it. */
  publicUrl?: string
  /** Slack's address. Tests use a fake. Default: https://slack.com. */
  slackUrl?: string
}

type Env = { Variables: { user: UserRow; project: Project; site: string; scope: Scope; sessionId: string } }
type Ctx = Context<Env>

const HOUR_MS = 60 * 60 * 1000
const MAX_FILES = 5
const UNUSED_FILE_MS = 24 * HOUR_MS
// Images that no comment uses yet, per project. New guests cannot get around it.
const MAX_UNUSED_BYTES = 200 * 1024 * 1024
// A coding agent: the person allows it within 10 minutes. Its token works for a day.
const CONNECT_MS = 10 * 60 * 1000
const AGENT_TOKEN_SECONDS = 24 * 60 * 60
// Anyone can ask to connect: a limit for each project, like new guests.
const CONNECTS_PER_HOUR = 60

type ConnectRow = {
  code: string
  secret: string
  project: string
  site: string | null
  user_id: string | null
  session_id: string | null
  expires_at: number
}

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
      .object({
        depth: z.number().int().min(1).max(10),
        urls: z.array(z.string().max(16)).min(1).max(50),
        all: z.literal(true).optional(),
        text: z.literal(true).optional(),
      })
      .optional(),
    point: Point.optional(),
    rect: Point.extend({ width: z.number().finite(), height: z.number().finite() }).optional(),
    viewport: z.number().int().min(0).max(100_000),
  })
  .refine((a) => !!a.point !== !!a.rect, "An anchor has a point or a rect")
/** Where a comment is on the page. */
export type Anchor = z.infer<typeof AnchorSchema>
const Page = z
  .string()
  .max(2000)
  .regex(/^\/[^\s#?]*$/, "A page is a URL path")
const FileIds = z.array(z.string().max(100)).max(MAX_FILES).default([])
// Where the comment was made. Shown to the team, so they can see the page as the author saw it.
const PageContext = z.object({
  url: z.url({ protocol: /^https?$/ }).max(2000),
  title: z.string().max(200),
  viewport: z.object({ width: z.number().int().min(0).max(100_000), height: z.number().int().min(0).max(100_000) }),
  dpr: z.number().positive().max(16),
  browser: z.string().max(60),
  os: z.string().max(60),
  // Added later: older widgets do not send them.
  theme: z.enum(["light", "dark"]).optional(),
  language: z.string().max(35).optional(),
  timeZone: z.string().max(64).optional(),
  scroll: z
    .object({ x: z.number().int().min(0).max(10_000_000), y: z.number().int().min(0).max(10_000_000) })
    .optional(),
})

/** Where a comment was made. */
export type PageContext = z.infer<typeof PageContext>

const CreateThread = z.object({
  page: Page,
  anchor: AnchorSchema,
  body: z.unknown(),
  files: FileIds,
  context: PageContext.optional(),
  /** An upload: the screenshot of the element. It does not count as one of the images of the comment. */
  screenshot: z.string().max(64).optional(),
})
const UpdateThread = z.union([
  z.object({ status: z.enum(["open", "resolved"]) }),
  z.object({ page: Page, anchor: AnchorSchema }),
  z.object({ assignee: z.string().max(100).nullable() }),
])
const CreateComment = z.object({ body: z.unknown(), files: FileIds })
const UpdateComment = z.object({ body: z.unknown() })
const Read = z.object({ read: z.boolean() })
// The token of a coding agent (see /agent/token).
const AgentClaims = z.object({
  typ: z.literal("comma-agent"),
  sub: z.string(),
  sid: z.string(),
  prj: z.string(),
  site: z.string(),
  exp: z.number(),
})
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
  const { db, secret, files: store } = options
  const now = options.now ?? Date.now
  const config = ConfigSchema.parse(options.config)
  const projects = new Map(config.projects.map((p) => [p.id, p]))
  const limitOk = (key: string, max: number) => takeLimit(db, key, max, HOUR_MS, now())

  const bump = (project: string) =>
    sql(
      "insert into versions (project, version) values (?, 1) on conflict (project) do update set version = version + 1",
      project,
    )
  // `updated_at` is the thread revision: it always grows, also for two changes in the same millisecond.
  const touch = (threadId: string) =>
    sql("update threads set updated_at = max(?, updated_at + 1) where id = ?", now(), threadId)
  const markRead = (userId: string, threadId: string) => [
    sql(
      `insert into reads (user_id, thread_id, read_at, unread) values (?, ?, ?, 0)
       on conflict (user_id, thread_id) do update set read_at = excluded.read_at, unread = 0`,
      userId,
      threadId,
      now(),
    ),
    sql("update users set reads_version = reads_version + 1 where id = ?", userId),
  ]

  // Child rows go first. The app deletes them itself: remote databases may not keep `pragma foreign_keys`.
  const deleteComments = (where: string, arg: string) => [
    sql(`delete from reactions where comment_id in (select id from comments where ${where})`, arg),
    sql(`delete from mentions where comment_id in (select id from comments where ${where})`, arg),
    sql(`delete from files where comment_id in (select id from comments where ${where})`, arg),
    sql(`delete from comments where ${where}`, arg),
  ]
  const deleteThread = (id: string) => [
    ...deleteComments("thread_id = ?", id),
    sql("delete from files where thread_id = ?", id),
    sql("delete from reads where thread_id = ?", id),
    sql("delete from thread_tags where thread_id = ?", id),
    sql("delete from threads where id = ?", id),
  ]
  // Image bytes outside the database go after the rows. A failure leaves bytes that no row uses, not the reverse.
  const filesOf = async (where: string, arg: string) =>
    store
      ? (
          await all<{ id: string }>(
            db,
            `select id from files where comment_id in (select id from comments where ${where})`,
            arg,
          )
        ).map((f) => f.id)
      : []
  // The files of a thread: its comments' images and its element screenshot.
  const threadFiles = async (id: string) =>
    store
      ? (
          await all<{ id: string }>(
            db,
            "select id from files where thread_id = ? or comment_id in (select id from comments where thread_id = ?)",
            id,
            id,
          )
        ).map((f) => f.id)
      : []
  const deleteStored = async (ids: string[]) => {
    if (store && ids.length > 0) await store.delete(ids)
  }

  // Other clients must see a new name or avatar: a change invalidates their ETag.
  const appUser = async (project: Project, claims: Claims) => {
    const { user, changed } = await upsertAppUser(db, project, claims, now())
    if (changed) await db.execute(bump(project.id))
    return user
  }
  // A new session: the answer of every sign-in.
  const sessionOf = async (user: UserRow) => ({
    token: await startSession(db, secret, user, now()),
    user: publicUser(user),
  })

  const app = new Hono<Env>()

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    console.error(err)
    return c.json({ error: "Server error" }, 500)
  })

  if (options.widgetDir) app.route("/", widgetRoutes(options.widgetDir))

  app.get("/files/:id", async (c) => {
    const id = c.req.param("id")
    const file = await get<{ mime: string; data: ArrayBuffer }>(db, "select mime, data from files where id = ?", id)
    const data = file && (store ? await store.get(id) : new Uint8Array(file.data))
    if (!file || !data) return c.notFound()
    return new Response(data, {
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
      publicUrl: options.publicUrl,
      slackUrl: options.slackUrl,
      session: async (project, appToken) => {
        const claims = await appUserClaims(project, appToken)
        return claims && sessionOf(await appUser(project, claims))
      },
      slackSession: async (project, claims) => sessionOf(await appUser(project, claims)),
    }),
  )

  // CORS: only origins of a registered project. Each route also checks the origin against its project.
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin")
    const allowed = origin && config.projects.some((p) => allowsOrigin(p, origin)) ? origin : null
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

  // The request comes from a page on an origin of the project. Browsers send no Origin header on same-origin GET
  // requests (comma behind the site's own proxy): then the browser's Sec-Fetch-Site says "same-origin" (pages cannot
  // set it), and the host of this request (behind a proxy: the forwarded host) must be an origin of the project.
  // Returns the host of the site.
  const checkOrigin = (c: Context, project: Project) => {
    const origin = c.req.header("origin")
    const host = c.req.header("x-forwarded-host") ?? new URL(c.req.url).host
    const allowed = origin
      ? allowsOrigin(project, origin)
      : c.req.header("sec-fetch-site") === "same-origin" && allowsHost(project, host)
    if (!allowed) throw new HTTPException(403, { message: "Origin not allowed" })
    return origin ? new URL(origin).host : host
  }

  const projectFor = (id: unknown, c: Context) => {
    const project = typeof id === "string" ? projects.get(id) : undefined
    if (!project) throw new HTTPException(404, { message: "Unknown project" })
    checkOrigin(c, project)
    return project
  }

  app.get("/api/projects/:id", (c) => {
    const project = projectFor(c.req.param("id"), c)
    return c.json({
      id: project.id,
      name: project.name,
      popupSignIn: !!((project.signInUrl || project.appUrl) && project.appSignIn),
      ...(project.appUrl && { appUrl: project.appUrl }),
      slack: !!project.slack,
      guests: project.guests,
      toolbar: project.toolbar,
      details: project.details,
      panel: project.panel,
    })
  })

  app.post("/api/session/guest", async (c) => {
    const input = parse(z.object({ project: z.string(), name: z.string().trim().min(1).max(60) }), await json(c))
    const project = projectFor(input.project, c)
    if (!project.guests) throw new HTTPException(403, { message: "Sign in with your account to comment on this site" })
    if (!(await limitOk(`guests:${project.id}`, project.limits.guestsPerHour)))
      throw new HTTPException(429, { message: "Too many new guests. Try again later." })
    return c.json(await sessionOf(await createGuest(db, project, input.name, now())))
  })

  app.post("/api/session/app", async (c) => {
    const input = parse(z.object({ project: z.string(), appToken: z.string().max(10_000) }), await json(c))
    const project = projectFor(input.project, c)
    if (!project.appSignIn) throw new HTTPException(404, { message: "This project has no app sign-in" })
    const claims = await appUserClaims(project, input.appToken)
    if (!claims) throw new HTTPException(401, { message: "Invalid app token" })
    return c.json(await sessionOf(await appUser(project, claims)))
  })

  // Sign-in through the app (`appUrl`): comma in the app asks for a hand-over (below), the site that opened the
  // popup claims it here. One minute, for that site only.
  app.post("/api/session/claim", async (c) => {
    const input = parse(z.object({ project: z.string(), handoff: z.string().max(2000) }), await json(c))
    const project = projectFor(input.project, c)
    if (!project.appUrl) throw new HTTPException(404, { message: "This project has no sign-in through the app" })
    const claims = await verify(input.handoff, secret, "HS256").catch(() => null)
    const user =
      claims?.typ === "comma-handoff" &&
      claims.prj === project.id &&
      claims.origin === c.req.header("origin") &&
      typeof claims.exp === "number" &&
      typeof claims.sub === "string" &&
      claims.exp * 1000 > now() &&
      (await get<UserRow>(db, "select * from users where id = ? and project = ?", claims.sub, project.id))
    if (!user) throw new HTTPException(401, { message: "Sign-in expired. Try again." })
    return c.json(await sessionOf(user))
  })

  // A request of a signed-in person: from the widget (auth), or from an agent that acts as them (agentAuth).
  // `siteOf`: the host of the site, for a valid session.
  const enter = async (
    c: Ctx,
    session: { userId: string; sessionId: string; project: string } | null,
    siteOf: (project: Project) => string,
    message: string,
  ) => {
    const user = session && (await getSessionUser(db, session, now()))
    const project = session && projects.get(session.project)
    if (!session || !user || !project || user.project !== project.id) throw new HTTPException(401, { message })
    const site = siteOf(project)
    c.set("sessionId", session.sessionId)
    c.set("user", user)
    c.set("project", project)
    c.set("site", site)
    c.set("scope", { project: project.id, site: project.scope === "origin" ? site : null })
  }

  const auth = createMiddleware<Env>(async (c, next) => {
    const header = c.req.header("authorization") ?? ""
    const session = header.startsWith("Bearer ") ? await verifySession(secret, header.slice(7)) : null
    await enter(c, session, (project) => checkOrigin(c, project), "Sign in again")
    await next()
  })
  app.use("/api/*", auth)

  // comma in the app hands its signed-in user over to another site of the project (see /api/session/claim).
  app.post("/api/session/handoff", async (c) => {
    const { origin } = parse(z.object({ origin: z.string().max(200) }), await json(c))
    const project = c.get("project")
    const user = c.get("user")
    if (!project.appUrl) throw new HTTPException(404, { message: "This project has no sign-in through the app" })
    if (
      c.req.header("origin") !== new URL(project.appUrl).origin ||
      user.kind !== "app" ||
      !allowsOrigin(project, origin)
    )
      throw new HTTPException(403, { message: "Not allowed" })
    const exp = Math.floor(now() / 1000) + 60
    return c.json({ handoff: await sign({ typ: "comma-handoff", sub: user.id, prj: project.id, origin, exp }, secret) })
  })

  // The person answers a coding agent's request to connect (see /agent/connect).
  app.post("/api/agent/connect", async (c) => {
    const input = parse(z.object({ code: z.string().max(20), allow: z.boolean() }), await json(c))
    const user = c.get("user")
    // One statement: of two answers at the same time, only one changes the request.
    const open = "code = ? and project = ? and user_id is null and expires_at > ?"
    const args = [input.code, user.project, now()]
    const changed = input.allow
      ? await run(
          db,
          `update agent_connects set user_id = ?, session_id = ?, site = ? where ${open}`,
          user.id,
          c.get("sessionId"),
          c.get("site"),
          ...args,
        )
      : await run(db, `delete from agent_connects where ${open}`, ...args)
    if (changed === 0)
      throw new HTTPException(404, { message: "This request expired. Ask the agent to connect again." })
    return c.json({ ok: true })
  })

  app.delete("/api/session", async (c) => {
    await run(db, "delete from sessions where id = ?", c.get("sessionId"))
    return c.json({ ok: true })
  })

  const limit = async (c: Ctx) => {
    if (!(await limitOk(`comments:${c.get("user").id}`, c.get("project").limits.commentsPerHour)))
      throw new HTTPException(429, { message: "Too many comments. Try again later." })
  }

  // Checks files: uploaded by this user, in this project, not used yet.
  const claimFiles = async (user: UserRow, ids: string[]) => {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return unique
    const found = await all<{ id: string }>(
      db,
      `select id from files where project = ? and uploaded_by = ? and comment_id is null and thread_id is null
       and id in (${unique.map(() => "?").join(",")})`,
      user.project,
      user.id,
      ...unique,
    )
    if (found.length !== unique.length) throw new HTTPException(400, { message: "Unknown image" })
    return unique
  }

  const bodyOf = (input: unknown, hasFiles: boolean) => {
    const parsed = parseBody(input)
    if ("error" in parsed) throw new HTTPException(400, { message: parsed.error })
    if (!parsed.text && !hasFiles) throw new HTTPException(400, { message: "The comment is empty" })
    return parsed
  }

  // Users in the same project only (mentions, assignees).
  const projectUsers = async (user: UserRow, ids: string[]) => {
    if (ids.length === 0) return []
    const rows = await all<{ id: string }>(
      db,
      `select id from users where project = ? and id in (${ids.map(() => "?").join(",")})`,
      user.project,
      ...ids,
    )
    return rows.map((r) => r.id)
  }
  const saveMentions = (commentId: string, ids: string[]) => [
    sql("delete from mentions where comment_id = ?", commentId),
    ...ids.map((id) => sql("insert or ignore into mentions (comment_id, user_id) values (?, ?)", commentId, id)),
  ]

  const insertComment = async (
    user: UserRow,
    id: string,
    threadId: string,
    parsed: Extract<ReturnType<typeof parseBody>, { body: unknown }>,
    files: string[],
  ) => [
    sql(
      "insert into comments (id, thread_id, author_id, body, text, created_at) values (?, ?, ?, ?, ?, ?)",
      id,
      threadId,
      user.id,
      JSON.stringify(parsed.body),
      parsed.text,
      now(),
    ),
    ...saveMentions(id, await projectUsers(user, parsed.mentions)),
    // `comment_id is null`: of two comments at the same time with the same image, only one gets it.
    ...files.map((fileId) => sql("update files set comment_id = ? where id = ? and comment_id is null", id, fileId)),
  ]

  // A reply: the comment, a new revision of the thread, and the thread read for its author.
  const addReply = async (
    user: UserRow,
    threadId: string,
    parsed: Extract<ReturnType<typeof parseBody>, { body: unknown }>,
    files: string[],
  ) => {
    const id = newId()
    await db.batch(
      [
        ...(await insertComment(user, id, threadId, parsed, files)),
        touch(threadId),
        ...markRead(user.id, threadId),
        bump(user.project),
      ],
      "write",
    )
    return id
  }

  const thread = async (c: Ctx, id: string) => {
    const result = await loadThreads(db, c.get("scope"), c.get("user"), c.get("project").tags, id)
    return { thread: result.threads[0], users: result.users, tags: result.tags }
  }

  const findThread = async (c: Ctx, id: string) => {
    const row = await getThreadRow(db, c.get("scope"), id)
    if (!row) throw new HTTPException(404, { message: "Thread not found" })
    return row
  }

  const findComment = async (c: Ctx, id: string) => {
    const row = await getCommentRow(db, c.get("scope"), id)
    if (!row) throw new HTTPException(404, { message: "Comment not found" })
    return row
  }

  // The address of comma, behind a proxy too.
  const serverUrl = (c: Context, path = "/") => new URL(path, options.publicUrl ?? c.req.url)

  // Instructions for coding agents. Agents that find comma in the repo look at its address first.
  const agentDocs = (c: Context) => {
    c.header("content-type", "text/markdown; charset=utf-8")
    return c.body(llmsTxt(serverUrl(c).origin))
  }
  app.get("/llms.txt", agentDocs)
  app.get("/", agentDocs)

  // A coding agent asks to connect. The person opens `url` and allows it in the widget (see /api/agent/connect).
  app.post("/agent/connect", async (c) => {
    const input = parse(z.object({ project: z.string().max(64), site: z.string().max(2000).optional() }), await json(c))
    const project = projects.get(input.project)
    if (!project) throw new HTTPException(404, { message: "Unknown project" })
    // A host or a URL: `staging.acme.com`, `https://staging.acme.com/pricing`.
    const site =
      input.site === undefined
        ? null
        : (URL.parse(input.site.includes("://") ? input.site : `https://${input.site}`)?.host ?? "")
    if (site !== null && !allowsHost(project, site)) {
      throw new HTTPException(400, { message: "This site is not a site of the project" })
    }
    if (!(await limitOk(`connects:${project.id}`, CONNECTS_PER_HOUR)))
      throw new HTTPException(429, { message: "Too many requests to connect. Try again later." })
    const code = newCode()
    const pollSecret = randomToken(32)
    const expiresAt = now() + CONNECT_MS
    await run(
      db,
      "insert into agent_connects (code, secret, project, site, created_at, expires_at) values (?, ?, ?, ?, ?, ?)",
      code,
      pollSecret,
      project.id,
      site,
      now(),
      expiresAt,
    )
    return c.json({ code, url: serverUrl(c, `/connect/${code}`).href, secret: pollSecret, expiresAt })
  })

  // The person opens this page from the agent. It sends them to the site with the open comments (or the site that
  // the agent named), where the widget asks them to allow the agent. With more sites, they choose one.
  app.get("/connect/:code", async (c) => {
    c.header("cache-control", "no-store")
    c.header("referrer-policy", "no-referrer")
    const row = await get<ConnectRow>(
      db,
      "select * from agent_connects where code = ? and user_id is null and expires_at > ?",
      c.req.param("code"),
      now(),
    )
    const project = row && projects.get(row.project)
    if (!row || !project) return c.html(connectPage(null, []), 404)
    // The sites with open comments, the most active first, and the page of the newest open comment of each.
    const rows = await all<{ site: string; open: number; page: string }>(
      db,
      `select t.site, count(*) as open,
         (select n.page from threads n where n.project = t.project and n.site = t.site and n.status = 'open'
          order by n.created_at desc, n.rowid desc limit 1) as page
       from threads t where t.project = ? and t.status = 'open' and t.site is not null
       group by t.site order by max(t.updated_at) desc`,
      project.id,
    )
    const named = row.site ? originOf(project, row.site) : undefined
    if (named) {
      const page = rows.find((r) => r.site === row.site)?.page ?? "/"
      return c.redirect(connectLink(named, page, row.code), 302)
    }
    const withComments = rows.flatMap((r) => {
      const origin = originOf(project, r.site)
      return origin ? [{ host: r.site, href: connectLink(origin, r.page, row.code), open: r.open }] : []
    })
    // No open comments yet: the sites of the project that have one address.
    const sites = withComments.length
      ? withComments
      : project.origins
          .filter((o) => !o.includes("*"))
          .map((o) => ({ host: new URL(o).host, href: connectLink(o, "/", row.code), open: 0 }))
    if (sites.length === 1) return c.redirect(sites[0].href, 302)
    return c.html(connectPage(row.code, sites))
  })

  // The agent asks for its token until the person answers.
  app.post("/agent/token", async (c) => {
    const input = parse(z.object({ secret: z.string().max(100) }), await json(c))
    const row = await get<ConnectRow>(
      db,
      "select * from agent_connects where secret = ? and expires_at > ?",
      input.secret,
      now(),
    )
    const gone = new HTTPException(410, { message: "The request expired or the person said no. Connect again." })
    if (!row) throw gone
    if (!row.user_id || !row.session_id) return c.json({ status: "pending" }, 202)
    // One token for each request.
    if ((await run(db, "delete from agent_connects where code = ?", row.code)) === 0) throw gone
    const user = await getSessionUser(db, { userId: row.user_id, sessionId: row.session_id }, now())
    if (!user) throw gone
    const exp = Math.floor(now() / 1000) + AGENT_TOKEN_SECONDS
    const token = await sign(
      { typ: "comma-agent", sub: user.id, sid: row.session_id, prj: row.project, site: row.site, exp },
      secret,
      "HS256",
    )
    return c.json({ token, site: row.site, user: publicUser(user), expiresAt: exp * 1000 })
  })

  // The agent acts as the person who allowed it, until the token expires or the person signs out.
  const agentAuth = createMiddleware<Env>(async (c, next) => {
    const header = c.req.header("authorization") ?? ""
    // `exp: false`: the check below uses the app's clock.
    const payload = header.startsWith("Bearer ")
      ? await verify(header.slice(7), secret, { alg: "HS256", exp: false }).catch(() => null)
      : null
    const claims = AgentClaims.safeParse(payload).data
    const message = "Connect again (see /llms.txt)"
    if (!claims || claims.exp * 1000 <= now()) throw new HTTPException(401, { message })
    await enter(c, { userId: claims.sub, sessionId: claims.sid, project: claims.prj }, () => claims.site, message)
    await next()
  })
  // Also matches /agent/threads.
  app.use("/agent/threads/*", agentAuth)

  app.get("/agent/threads", async (c) => {
    const project = c.get("project")
    const { threads, users } = await loadThreads(db, c.get("scope"), c.get("user"), project.tags)
    c.header("content-type", "text/markdown; charset=utf-8")
    c.header("cache-control", "no-store")
    return c.body(
      threadsMarkdown({
        threads: threads.filter((t) => t.status === "open"),
        users,
        me: c.get("user").name,
        project,
        origin: originOf(project, c.get("site")) ?? `https://${c.get("site")}`,
        server: serverUrl(c).origin,
      }),
    )
  })

  // Plain text, like `curl --data-binary "Fixed in a1b2c3"`. Posted as the person.
  app.post("/agent/threads/:id/reply", async (c) => {
    const user = c.get("user")
    const row = await findThread(c, c.req.param("id"))
    const text = await c.req.text()
    // Before the paragraphs: a large body makes many objects.
    if (text.length > MAX_BODY_BYTES) throw new HTTPException(400, { message: "The comment is too long" })
    const parsed = bodyOf(textBody(text), false)
    await limit(c)
    return c.json({ ok: true, id: await addReply(user, row.id, parsed, []) })
  })

  app.get("/api/threads", async (c) => {
    const user = c.get("user")
    const version = await get<{ version: number }>(db, "select version from versions where project = ?", user.project)
    const etag = `"${version?.version ?? 0}-${user.reads_version}-${user.id}"`
    c.header("etag", etag)
    c.header("cache-control", "no-cache")
    if (c.req.header("if-none-match") === etag) return c.body(null, 304)
    return c.json({ me: publicUser(user), ...(await loadThreads(db, c.get("scope"), user, c.get("project").tags)) })
  })

  app.post("/api/threads", async (c) => {
    const user = c.get("user")
    const input = parse(CreateThread, await json(c))
    const files = await claimFiles(user, input.files)
    const [screenshot] = input.screenshot ? await claimFiles(user, [input.screenshot]) : []
    if (screenshot && files.includes(screenshot)) throw new HTTPException(400, { message: "Unknown image" })
    const parsed = bodyOf(input.body, files.length > 0)
    await limit(c)
    const id = newId()
    await db.batch(
      [
        sql(
          "insert into threads (id, project, site, page, anchor, context, created_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          id,
          user.project,
          c.get("site"),
          input.page,
          JSON.stringify(input.anchor),
          input.context ? JSON.stringify(input.context) : null,
          user.id,
          now(),
          now(),
        ),
        ...(await insertComment(user, newId(), id, parsed, files)),
        ...(screenshot
          ? [
              sql(
                "update files set thread_id = ? where id = ? and comment_id is null and thread_id is null",
                id,
                screenshot,
              ),
            ]
          : []),
        ...markRead(user.id, id),
        bump(user.project),
      ],
      "write",
    )
    return c.json(await thread(c, id))
  })

  app.patch("/api/threads/:id", async (c) => {
    const user = c.get("user")
    const row = await findThread(c, c.req.param("id"))
    const input = parse(UpdateThread, await json(c))
    const changes = []
    if ("status" in input) {
      if (input.status !== row.status) {
        const resolved = input.status === "resolved"
        changes.push(
          sql(
            "update threads set status = ?, resolved_at = ?, resolved_by = ?, updated_at = max(?, updated_at + 1) where id = ?",
            input.status,
            resolved ? now() : null,
            resolved ? user.id : null,
            now(),
            row.id,
          ),
        )
      }
    } else if ("assignee" in input) {
      const assignee = input.assignee
      if (assignee && (await projectUsers(user, [assignee])).length === 0) {
        throw new HTTPException(400, { message: "Unknown user" })
      }
      changes.push(
        sql(
          "update threads set assignee_id = ?, updated_at = max(?, updated_at + 1) where id = ?",
          assignee,
          now(),
          row.id,
        ),
      )
      // The thread shows as unread for the new assignee, so they see it in their list.
      if (assignee && assignee !== user.id) {
        changes.push(
          sql(
            `insert into reads (user_id, thread_id, read_at, unread) values (?, ?, 0, 1)
             on conflict (user_id, thread_id) do update set unread = 1`,
            assignee,
            row.id,
          ),
          sql("update users set reads_version = reads_version + 1 where id = ?", assignee),
        )
      }
    } else {
      if (row.created_by !== user.id) throw new HTTPException(403, { message: "Only the author can move this comment" })
      changes.push(
        sql(
          "update threads set page = ?, anchor = ?, updated_at = max(?, updated_at + 1) where id = ?",
          input.page,
          JSON.stringify(input.anchor),
          now(),
          row.id,
        ),
      )
    }
    await db.batch([...changes, bump(user.project)], "write")
    return c.json(await thread(c, row.id))
  })

  app.delete("/api/threads/:id", async (c) => {
    const user = c.get("user")
    const row = await findThread(c, c.req.param("id"))
    if (row.created_by !== user.id && user.is_admin !== 1) {
      throw new HTTPException(403, { message: "Only the author or an admin can delete this thread" })
    }
    const stored = await threadFiles(row.id)
    await db.batch([...deleteThread(row.id), bump(user.project)], "write")
    await deleteStored(stored)
    return c.json({ ok: true })
  })

  // Anyone in the project adds and removes tags, like reactions: one tag at a time, so two people at the same time
  // do not undo each other's change.
  const tagThread = (add: boolean) =>
    createMiddleware<Env>(async (c) => {
      const user = c.get("user")
      const row = await findThread(c, c.req.param("id") ?? "")
      const key = tagKey(decodeURIComponent(c.req.param("tag") ?? ""))
      if (add && !c.get("project").tags.some((t) => tagKey(t.name) === key))
        throw new HTTPException(400, { message: "Unknown tag" })
      await db.batch(
        [
          add
            ? sql("insert or ignore into thread_tags (thread_id, key, created_at) values (?, ?, ?)", row.id, key, now())
            : sql("delete from thread_tags where thread_id = ? and key = ?", row.id, key),
          touch(row.id),
          bump(user.project),
        ],
        "write",
      )
      return c.json(await thread(c, row.id))
    })
  app.put("/api/threads/:id/tags/:tag", tagThread(true))
  app.delete("/api/threads/:id/tags/:tag", tagThread(false))

  app.post("/api/threads/:id/read", async (c) => {
    const user = c.get("user")
    const row = await findThread(c, c.req.param("id"))
    const input = parse(Read, await json(c))
    await db.batch(
      input.read
        ? markRead(user.id, row.id)
        : [
            sql(
              `insert into reads (user_id, thread_id, read_at, unread) values (?, ?, 0, 1)
               on conflict (user_id, thread_id) do update set unread = 1`,
              user.id,
              row.id,
            ),
            sql("update users set reads_version = reads_version + 1 where id = ?", user.id),
          ],
      "write",
    )
    return c.json(await thread(c, row.id))
  })

  app.post("/api/threads/:id/comments", async (c) => {
    const user = c.get("user")
    const row = await findThread(c, c.req.param("id"))
    const input = parse(CreateComment, await json(c))
    const files = await claimFiles(user, input.files)
    const parsed = bodyOf(input.body, files.length > 0)
    await limit(c)
    const id = await addReply(user, row.id, parsed, files)
    const result = await thread(c, row.id)
    return c.json({ ...result, comment: result.thread?.comments.find((x) => x.id === id) })
  })

  app.patch("/api/comments/:id", async (c) => {
    const user = c.get("user")
    const row = await findComment(c, c.req.param("id"))
    if (row.author_id !== user.id) throw new HTTPException(403, { message: "Only the author can edit this comment" })
    const input = parse(UpdateComment, await json(c))
    const hasFiles = !!(await get(db, "select 1 from files where comment_id = ?", row.id))
    const parsed = bodyOf(input.body, hasFiles)
    await db.batch(
      [
        sql(
          "update comments set body = ?, text = ?, edited_at = ? where id = ?",
          JSON.stringify(parsed.body),
          parsed.text,
          now(),
          row.id,
        ),
        ...saveMentions(row.id, await projectUsers(user, parsed.mentions)),
        touch(row.thread_id),
        bump(user.project),
      ],
      "write",
    )
    const result = await thread(c, row.thread_id)
    return c.json({ ...result, comment: result.thread?.comments.find((x) => x.id === row.id) })
  })

  app.delete("/api/comments/:id", async (c) => {
    const user = c.get("user")
    const row = await findComment(c, c.req.param("id"))
    if (row.author_id !== user.id) throw new HTTPException(403, { message: "Only the author can delete this comment" })
    // The first comment is the thread. Its author is the thread author.
    const deletesThread = await isFirstComment(db, row)
    const stored = deletesThread ? await threadFiles(row.thread_id) : await filesOf("id = ?", row.id)
    await db.batch(
      [
        ...(deletesThread ? deleteThread(row.thread_id) : [...deleteComments("id = ?", row.id), touch(row.thread_id)]),
        bump(user.project),
      ],
      "write",
    )
    await deleteStored(stored)
    if (deletesThread) return c.json({ ok: true, threadDeleted: true })
    return c.json({ ok: true, threadDeleted: false, ...(await thread(c, row.thread_id)) })
  })

  const react = (add: boolean) =>
    createMiddleware<Env>(async (c) => {
      const user = c.get("user")
      const row = await findComment(c, c.req.param("id") ?? "")
      const emoji = parse(Emoji, decodeURIComponent(c.req.param("emoji") ?? ""))
      await db.batch(
        [
          add
            ? sql(
                "insert or ignore into reactions (comment_id, user_id, emoji, created_at) values (?, ?, ?, ?)",
                row.id,
                user.id,
                emoji,
                now(),
              )
            : sql("delete from reactions where comment_id = ? and user_id = ? and emoji = ?", row.id, user.id, emoji),
          touch(row.thread_id),
          bump(user.project),
        ],
        "write",
      )
      return c.json(await thread(c, row.thread_id))
    })
  app.put("/api/comments/:id/reactions/:emoji", react(true))
  app.delete("/api/comments/:id/reactions/:emoji", react(false))

  // Mention picker: signed-in app users and people who commented.
  app.get("/api/users", async (c) => {
    const user = c.get("user")
    const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 60)
    const rows = await all<UserRow>(
      db,
      `select * from users u where u.project = ?
       and (u.kind = 'app' or exists (select 1 from comments c where c.author_id = u.id))
       and instr(lower(u.name), ?) > 0
       order by (instr(lower(u.name), ?) = 1) desc, u.name limit 8`,
      user.project,
      q,
      q,
    )
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
    if (!(await limitOk(`uploads:${user.id}`, c.get("project").limits.imagesPerHour)))
      throw new HTTPException(429, { message: "Too many images. Try again later." })
    if (file.size > MAX_IMAGE_BYTES) throw new HTTPException(413, { message: "Images can be up to 4 MB" })
    const unused = await get<{ total: number | null }>(
      db,
      "select sum(size) as total from files where project = ? and comment_id is null and thread_id is null",
      user.project,
    )
    if ((unused?.total ?? 0) + file.size > MAX_UNUSED_BYTES) {
      throw new HTTPException(507, { message: "Too many images waiting. Try again later." })
    }
    const data = new Uint8Array(await file.arrayBuffer())
    const info = readImage(data)
    if (!info) throw new HTTPException(415, { message: "Use a PNG, JPEG, GIF or WebP image" })
    const id = randomToken(16)
    // Bytes in the store first: a row always has its bytes.
    if (store) await store.put(id, data, info.mime)
    await run(
      db,
      "insert into files (id, project, uploaded_by, mime, size, width, height, data, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      user.project,
      user.id,
      info.mime,
      data.length,
      info.width,
      info.height,
      store ? new Uint8Array() : data,
      now(),
    )
    return c.json({ id, url: `/files/${id}`, mime: info.mime, width: info.width, height: info.height })
  })

  return Object.assign(app, {
    /** Deletes uploads that no comment uses after 24 h, and what expired. Returns how many uploads and sessions. */
    cleanup: async () => {
      const sessions = await run(db, "delete from sessions where expires_at <= ?", now())
      await run(db, "delete from agent_connects where expires_at <= ?", now())
      await run(db, "delete from limits where window_start < ?", now() - 24 * HOUR_MS)
      const old = await all<{ id: string }>(
        db,
        "select id from files where comment_id is null and thread_id is null and created_at < ?",
        now() - UNUSED_FILE_MS,
      )
      const ids = old.map((f) => f.id)
      if (ids.length > 0) {
        await run(db, `delete from files where id in (${ids.map(() => "?").join(",")})`, ...ids)
        await deleteStored(ids)
      }
      return { files: ids.length, sessions }
    },
  })
}
