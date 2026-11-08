// SitePing → comma: copies the feedback of one SitePing project into a comma project. SitePing is only read.
// Each feedback becomes a thread: its message the first comment (the type, if not "other", as the first word), its
// replies the next comments, its screenshot the thread's screenshot. Each author name becomes one guest.
// The pin: a browser opens each page and finds the element as SitePing would (see browser.ts). Not found: the thread
// is detached ("Element not found"), with what SitePing knew about the element.
// Ids come from the SitePing ids, so a second run adds only what is new.
//
//   SITEPING_DB=libsql://… SITEPING_DB_TOKEN=… COMMA_DB=… [COMMA_DB_TOKEN, COMMA_FILES=s3 and its settings] \
//   [PREVIEW_AUTH=user:password] \
//   bun scripts/siteping/import.ts --from website --project acme-site --origin https://preview.acme.com
import { createHash } from "node:crypto"
import { parseArgs } from "node:util"
import { createClient } from "@libsql/client"
import { parseBody } from "../../server/src/body"
import { all, type Db, migrate, sql } from "../../server/src/db"
import type { FileStore } from "../../server/src/files"
import { readImage } from "../../server/src/images"
import { readSettings } from "../../server/src/settings"
import type { Anchor } from "../../widget/src/anchor"
import { browserOf, osOf } from "../../widget/src/lib/env"
import { placeOf } from "./place"

/** What SitePing stored about the element. `rect`: the region, in fractions of the element box. */
export type SitepingAnnotation = {
  feedbackId: string
  css: string
  xpath: string
  text: string
  tag: string
  rect: { x: number; y: number; width: number; height: number }
  viewport: { width: number; height: number }
}

export type ImportOptions = {
  from: Db
  to: Db
  files?: FileStore
  /** SitePing's project name. */
  sitepingProject: string
  /** The comma project. */
  project: string
  /** The site's origin, for example https://preview.acme.com. */
  origin: string
  screenshot: (url: string) => Promise<Uint8Array | null>
  /** Opens a page and finds the elements. `anchors`: by feedback id, only the ones it found. */
  anchor: (page: string, annotations: SitepingAnnotation[]) => Promise<{ title: string; anchors: Map<string, Anchor> }>
  now?: () => number
}

type FeedbackRow = {
  id: string
  type: string
  message: string
  status: string
  url: string
  screenshot_url: string | null
  viewport: string
  user_agent: string
  author_name: string
  author_email: string
  resolved_at: number | null
  created_at: number
  updated_at: number
}
type AnnotationRow = {
  feedback_id: string
  css_selector: string
  xpath: string
  text_snippet: string
  element_tag: string
  x_pct: number
  y_pct: number
  w_pct: number
  h_pct: number
  scroll_x: number
  scroll_y: number
  viewport_w: number
  viewport_h: number
  device_pixel_ratio: number
}
type CommentRow = {
  id: string
  feedback_id: string
  body: string
  author_name: string
  author_email: string
  created_at: number
}

// A comma page is a URL path. SitePing stored the path, older versions the full URL.
const pageOf = (url: string) => new URL(url, "https://x.invalid").pathname

/** Plain text as a comment body: an empty line starts a paragraph, a line break stays one. */
function bodyOf(text: string) {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => ({
      type: "paragraph",
      content: p
        .split("\n")
        .flatMap((line, i) => [
          ...(i > 0 ? [{ type: "hardBreak" }] : []),
          ...(line ? [{ type: "text", text: line }] : []),
        ]),
    }))
  const parsed = parseBody({ type: "doc", content: paragraphs })
  if ("error" in parsed) throw new Error(parsed.error)
  return parsed
}

/** Without the element: what SitePing knew about it. comma shows the thread as detached. */
function detachedAnchor(a: AnnotationRow): Anchor {
  const tag = a.element_tag.toLowerCase()
  const anchor: Anchor = {
    selectors: { css: a.css_selector },
    tag: /^[a-z][a-z0-9-]*$/.test(tag) ? tag : "div",
    text: a.text_snippet.replace(/\s+/g, " ").trim().slice(0, 120),
    context: "",
    viewport: a.viewport_w,
  }
  return { ...anchor, ...placeOf({ x: a.x_pct, y: a.y_pct, width: a.w_pct, height: a.h_pct }) }
}

export async function importSiteping(o: ImportOptions) {
  const now = o.now ?? Date.now
  // The same SitePing row gets the same comma id in each run.
  const idOf = (kind: string, key: string) => {
    const h = createHash("sha256").update(`siteping:${o.project}:${kind}:${key}`).digest("hex")
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
  }
  const userOf = (name: string) => idOf("user", name.trim())
  const site = new URL(o.origin).host

  const feedbacks = await all<FeedbackRow>(
    o.from,
    "select * from siteping_feedbacks where project_name = ? order by created_at",
    o.sitepingProject,
  )
  const ids = feedbacks.map((f) => f.id)
  const marks = ids.map(() => "?").join(",")
  // SitePing stores one annotation per feedback. If there are more, the first one.
  const annotations = new Map<string, AnnotationRow>()
  for (const a of await all<AnnotationRow>(
    o.from,
    `select * from siteping_annotations where feedback_id in (${marks}) order by position`,
    ...ids,
  ))
    if (!annotations.has(a.feedback_id)) annotations.set(a.feedback_id, a)
  const replies = await all<CommentRow>(
    o.from,
    `select * from siteping_comments where feedback_id in (${marks}) order by created_at, position`,
    ...ids,
  )

  const existing = async (table: string, list: string[]) =>
    new Set(
      list.length === 0
        ? []
        : (
            await all<{ id: string }>(
              o.to,
              `select id from ${table} where id in (${list.map(() => "?").join(",")})`,
              ...list,
            )
          ).map((r) => r.id),
    )
  const knownThreads = await existing(
    "threads",
    ids.map((id) => idOf("thread", id)),
  )
  const knownComments = await existing(
    "comments",
    replies.map((c) => idOf("comment", c.id)),
  )
  const added = feedbacks.filter((f) => !knownThreads.has(idOf("thread", f.id)))

  // The pins: one visit per page. A page that does not load (a preview that is gone): its threads are detached.
  const found = new Map<string, { anchor: Anchor | null; title: string }>()
  const pagesNotLoaded: string[] = []
  const byPage = new Map<string, FeedbackRow[]>()
  for (const f of added) byPage.set(pageOf(f.url), [...(byPage.get(pageOf(f.url)) ?? []), f])
  for (const [page, list] of byPage) {
    const wanted = list.flatMap((f) => {
      const a = annotations.get(f.id)
      if (!a) return []
      return [
        {
          feedbackId: f.id,
          css: a.css_selector,
          xpath: a.xpath,
          text: a.text_snippet,
          tag: a.element_tag,
          rect: { x: a.x_pct, y: a.y_pct, width: a.w_pct, height: a.h_pct },
          viewport: { width: a.viewport_w, height: a.viewport_h },
        },
      ]
    })
    const result = await o.anchor(page, wanted).catch(() => {
      pagesNotLoaded.push(page)
      return { title: "", anchors: new Map<string, Anchor>() }
    })
    for (const f of list) found.set(f.id, { anchor: result.anchors.get(f.id) ?? null, title: result.title })
  }

  const statements = []
  const report = {
    threads: 0,
    comments: 0,
    anchored: 0,
    detached: 0,
    screenshots: 0,
    detachedIds: [] as string[],
    missingScreenshots: [] as string[],
    pagesNotLoaded,
  }

  const people = new Map<string, string>()
  for (const f of added) people.set(f.author_name.trim(), f.author_email)
  for (const c of replies)
    if (!knownComments.has(idOf("comment", c.id))) people.set(c.author_name.trim(), c.author_email)
  for (const [name, email] of people) {
    statements.push(
      sql(
        "insert into users (id, project, kind, name, email, created_at) values (?, ?, 'guest', ?, ?, ?) on conflict (id) do nothing",
        userOf(name),
        o.project,
        name.slice(0, 60),
        email || null,
        now(),
      ),
    )
  }

  for (const f of added) {
    const threadId = idOf("thread", f.id)
    const a = annotations.get(f.id)
    const { anchor, title } = found.get(f.id) ?? { anchor: null, title: "" }
    const place = anchor ?? (a ? detachedAnchor(a) : null)
    if (!place) throw new Error(`SitePing feedback ${f.id} has no annotation`)
    if (anchor) report.anchored++
    else {
      report.detached++
      report.detachedIds.push(f.id)
    }
    const [width = 0, height = 0] = f.viewport.split("x").map(Number)
    const page = pageOf(f.url)
    const context = {
      url: `${o.origin}${page}`,
      title: title.slice(0, 200),
      viewport: { width: width || (a?.viewport_w ?? 0), height: height || (a?.viewport_h ?? 0) },
      dpr: a?.device_pixel_ratio ?? 1,
      browser: browserOf(f.user_agent),
      os: osOf(f.user_agent),
      ...(a && { scroll: { x: Math.max(0, Math.round(a.scroll_x)), y: Math.max(0, Math.round(a.scroll_y)) } }),
    }
    const author = userOf(f.author_name)
    statements.push(
      sql(
        `insert into threads (id, project, site, page, anchor, status, created_by, created_at, updated_at, resolved_at, context)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict (id) do nothing`,
        threadId,
        o.project,
        site,
        page,
        JSON.stringify(place),
        f.status === "resolved" ? "resolved" : "open",
        author,
        f.created_at,
        f.updated_at,
        f.status === "resolved" ? (f.resolved_at ?? f.updated_at) : null,
        JSON.stringify(context),
      ),
    )
    const type = f.type === "other" ? "" : `${f.type.charAt(0).toUpperCase()}${f.type.slice(1)}: `
    const message = bodyOf(`${type}${f.message}`)
    statements.push(
      sql(
        "insert into comments (id, thread_id, author_id, body, text, created_at) values (?, ?, ?, ?, ?, ?) on conflict (id) do nothing",
        idOf("comment", `message:${f.id}`),
        threadId,
        author,
        JSON.stringify(message.body),
        message.text,
        f.created_at,
      ),
    )
    report.threads++
    report.comments++

    const bytes = f.screenshot_url ? await o.screenshot(f.screenshot_url) : null
    const image = bytes && readImage(bytes)
    if (!bytes || !image) {
      report.missingScreenshots.push(f.id)
      continue
    }
    const fileId = idOf("screenshot", f.id)
    const data = new Uint8Array(bytes)
    if (o.files) await o.files.put(fileId, data, image.mime)
    statements.push(
      sql(
        `insert into files (id, project, thread_id, uploaded_by, mime, size, width, height, data, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict (id) do nothing`,
        fileId,
        o.project,
        threadId,
        author,
        image.mime,
        data.length,
        image.width,
        image.height,
        o.files ? new Uint8Array() : data,
        f.created_at,
      ),
    )
    report.screenshots++
  }

  for (const c of replies) {
    const id = idOf("comment", c.id)
    if (knownComments.has(id)) continue
    const reply = bodyOf(c.body)
    statements.push(
      sql(
        "insert into comments (id, thread_id, author_id, body, text, created_at) values (?, ?, ?, ?, ?, ?) on conflict (id) do nothing",
        id,
        idOf("thread", c.feedback_id),
        userOf(c.author_name),
        JSON.stringify(reply.body),
        reply.text,
        c.created_at,
      ),
    )
    report.comments++
  }

  // Open widgets load the threads again.
  statements.push(
    sql(
      "insert into versions (project, version) values (?, 1) on conflict (project) do update set version = version + 1",
      o.project,
    ),
  )
  // One transaction: all or nothing.
  await o.to.batch(statements, "write")
  return report
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { from: { type: "string" }, project: { type: "string" }, origin: { type: "string" } },
  })
  const { from, project, origin } = values
  const source = process.env.SITEPING_DB
  if (!from || !project || !origin || !source) {
    console.error(
      "Usage: SITEPING_DB=… COMMA_DB=… bun scripts/siteping/import.ts --from <SitePing project> --project <comma project> --origin <site origin>",
    )
    process.exit(2)
  }
  // The import signs no tokens: it does not need the server secret.
  const settings = readSettings({ ...process.env, COMMA_SECRET: "-".repeat(32) })
  const to = await migrate(createClient(settings.db), settings.db.local)
  const siteping = createClient({ url: source, authToken: process.env.SITEPING_DB_TOKEN })
  const { pages } = await import("./browser-run")
  const browser = await pages(origin, process.env.PREVIEW_AUTH)
  try {
    const report = await importSiteping({
      from: siteping,
      to,
      files: settings.files,
      sitepingProject: from,
      project,
      origin,
      screenshot: async (url) => {
        const res = await fetch(url)
        return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
      },
      anchor: browser.anchor,
    })
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}
