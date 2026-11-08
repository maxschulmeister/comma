import { beforeEach, expect, test } from "bun:test"
import { createClient } from "@libsql/client"
import { importSiteping, type SitepingAnnotation } from "../../scripts/siteping/import"
import { type Db, run } from "../src/db"
import { type Json, OPEN, setup } from "./helpers"

// The tables of SitePing's Drizzle adapter (migration 0000_init), with the columns the import reads.
const SITEPING_SCHEMA = `
create table siteping_feedbacks (
  id text primary key, project_name text not null, type text not null, message text not null,
  status text default 'open' not null, url text not null, url_pattern text, screenshot_url text,
  screenshot_region text, diagnostics text, viewport text not null, user_agent text not null,
  author_name text not null, author_email text not null, client_id text not null, resolved_at integer,
  created_at integer not null, updated_at integer not null, message_search text
);
create table siteping_annotations (
  id text primary key, feedback_id text not null, css_selector text not null, xpath text not null,
  text_snippet text not null, element_tag text not null, element_id text, text_prefix text not null,
  text_suffix text not null, fingerprint text not null, neighbor_text text not null, anchor_key text,
  x_pct real not null, y_pct real not null, w_pct real not null, h_pct real not null, scroll_x real not null,
  scroll_y real not null, viewport_w integer not null, viewport_h integer not null,
  device_pixel_ratio real default 1 not null, position integer default 0 not null, created_at integer not null
);
create table siteping_comments (
  id text primary key, feedback_id text not null, body text not null, author_name text not null,
  author_email text not null, author_role text default 'client' not null, client_id text not null,
  created_at integer not null, position integer default 0 not null
);`

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
// A 2×3 PNG.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR42mP8z8DwnwEIGHEIAD0KBf+0cY5MAAAAAElFTkSuQmCC"),
  (c) => c.charCodeAt(0),
)

let siteping: Db
beforeEach(async () => {
  siteping = createClient({ url: ":memory:" })
  await siteping.executeMultiple(SITEPING_SCHEMA)
})

async function feedback(
  id: string,
  f: { project?: string; type?: string; message: string; status?: string; url?: string; author?: string; at: number },
) {
  await run(
    siteping,
    `insert into siteping_feedbacks (id, project_name, type, message, status, url, screenshot_url, viewport,
       user_agent, author_name, author_email, client_id, resolved_at, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, '1789x1194', ?, ?, '', ?, ?, ?, ?)`,
    id,
    f.project ?? "website",
    f.type ?? "other",
    f.message,
    f.status ?? "open",
    f.url ?? "/",
    `https://siteping.test/screenshots/siteping-${id}.png`,
    UA,
    f.author ?? "Ada",
    `client-${id}`,
    f.status === "resolved" ? f.at + 500 : null,
    f.at,
    f.at + 500,
  )
  await run(
    siteping,
    `insert into siteping_annotations (id, feedback_id, css_selector, xpath, text_snippet, element_tag, text_prefix,
       text_suffix, fingerprint, neighbor_text, x_pct, y_pct, w_pct, h_pct, scroll_x, scroll_y, viewport_w,
       viewport_h, device_pixel_ratio, created_at)
     values (?, ?, 'main > h1', '//main[1]/h1[1]', '  Plan your growth  ', 'H1', '', '', '1:0:0', '',
       0.25, 0.5, 0.5, 0.25, 0, 321, 1789, 1194, 2, ?)`,
    `annotation-${id}`,
    id,
    f.at,
  )
}

async function reply(id: string, feedbackId: string, body: string, author: string, at: number) {
  await run(
    siteping,
    `insert into siteping_comments (id, feedback_id, body, author_name, author_email, client_id, created_at)
     values (?, ?, ?, ?, '', ?, ?)`,
    id,
    feedbackId,
    body,
    author,
    `client-${id}`,
    at,
  )
}

const ANCHOR = {
  selectors: { css: "main > h1" },
  tag: "h1",
  text: "Plan your growth",
  context: "|",
  rect: { x: 25, y: 50, width: 50, height: 25 },
  viewport: 1789,
}

async function importInto(target: Db, anchored: (a: SitepingAnnotation) => boolean = () => true) {
  return importSiteping({
    from: siteping,
    to: target,
    sitepingProject: "website",
    project: "open",
    origin: OPEN,
    screenshot: async (url) => (url.endsWith(".png") ? PNG : null),
    anchor: async (page, annotations) => ({
      title: `Acme ${page}`,
      anchors: new Map(annotations.filter(anchored).map((a) => [a.feedbackId, ANCHOR] as const)),
    }),
    now: () => 9_000,
  })
}

test("SitePing feedback becomes threads with the same text, authors, times, status and screenshot", async () => {
  await feedback("f1", { type: "bug", message: "The heading is cut off", author: "Ada", at: 1_000 })
  await reply("c1", "f1", "Fixed on staging", "Bob", 2_000)
  await feedback("f2", { message: "Nice", status: "resolved", url: "/platform/", author: "Bob", at: 3_000 })
  await feedback("other", { project: "feature-x", message: "Not this project", at: 4_000 })
  const { db, guest, request } = await setup()

  const report = await importInto(db, (a) => a.feedbackId === "f1")
  expect(report).toMatchObject({ threads: 2, comments: 3, anchored: 1, detached: 1, screenshots: 2 })

  const me = await guest("Reviewer", OPEN, "open")
  const res = await request("GET", "/api/threads", { token: me.token, origin: OPEN })
  const threads = (res.json.threads as Json[]).sort((a, b) => a.createdAt - b.createdAt)
  const name = (id: string) => res.json.users[id].name
  expect(threads).toHaveLength(2)

  const [bug, nice] = threads as [Json, Json]
  expect(bug).toMatchObject({ page: "/", status: "open", anchor: ANCHOR, createdAt: 1_000, resolvedAt: null })
  // The SitePing type stays as the first word, "other" says nothing.
  expect(bug.comments.map((c: Json) => [name(c.authorId), c.text, c.createdAt])).toEqual([
    ["Ada", "Bug: The heading is cut off", 1_000],
    ["Bob", "Fixed on staging", 2_000],
  ])
  expect(bug.context).toMatchObject({
    url: `${OPEN}/`,
    title: "Acme /",
    viewport: { width: 1789, height: 1194 },
    dpr: 2,
    browser: "Chrome 140",
    os: "macOS",
    scroll: { x: 0, y: 321 },
  })
  expect(bug.screenshot).toMatchObject({ mime: "image/png", width: 2, height: 3 })
  const image = await request("GET", bug.screenshot.url, { token: me.token, origin: OPEN })
  expect(image.status).toBe(200)

  // Not found on the page: detached, with what SitePing knew about the element.
  expect(nice).toMatchObject({ page: "/platform/", status: "resolved", resolvedAt: 3_500 })
  expect(nice.comments.map((c: Json) => c.text)).toEqual(["Nice"])
  expect(nice.anchor).toEqual({
    selectors: { css: "main > h1" },
    tag: "h1",
    text: "Plan your growth",
    context: "",
    rect: { x: 25, y: 50, width: 50, height: 25 },
    viewport: 1789,
  })
  expect(name(nice.createdBy)).toBe("Bob")
})

test("a second run adds only what is new", async () => {
  await feedback("f1", { message: "First", at: 1_000 })
  const { db, guest, request } = await setup()
  await importInto(db)

  await reply("c1", "f1", "A reply made after the first run", "Bob", 2_000)
  await feedback("f2", { message: "Second", author: "Bob", at: 3_000 })
  const report = await importInto(db)
  expect(report).toMatchObject({ threads: 1, comments: 2, screenshots: 1 })

  const me = await guest("Reviewer", OPEN, "open")
  const threads = (await request("GET", "/api/threads", { token: me.token, origin: OPEN })).json.threads as Json[]
  expect(threads.map((t) => t.comments.length).sort()).toEqual([1, 2])
  // Ada and Bob are one user each, also across runs.
  const authors = new Set(threads.flatMap((t) => t.comments.map((c: Json) => c.authorId)))
  expect(authors.size).toBe(2)
})

test("a feedback without a screenshot is imported without one", async () => {
  await feedback("f1", { message: "First", at: 1_000 })
  await run(siteping, "update siteping_feedbacks set screenshot_url = 'https://siteping.test/gone.jpg'")
  const { db } = await setup()
  const report = await importInto(db)
  expect(report).toMatchObject({ threads: 1, screenshots: 0, missingScreenshots: ["f1"] })
})

test("a page that does not load (a preview that is gone): its feedback is imported, detached", async () => {
  await feedback("f1", { message: "On the old preview", status: "resolved", at: 1_000 })
  const { db } = await setup()
  const report = await importSiteping({
    from: siteping,
    to: db,
    sitepingProject: "website",
    project: "open",
    origin: OPEN,
    screenshot: async () => PNG,
    anchor: async () => {
      throw new Error("net::ERR_NAME_NOT_RESOLVED")
    },
    now: () => 9_000,
  })
  expect(report).toMatchObject({ threads: 1, detached: 1, detachedIds: ["f1"], pagesNotLoaded: ["/"] })
})
