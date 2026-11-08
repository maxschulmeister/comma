import { afterAll, describe, expect, test } from "bun:test"
import { s3Files } from "../src/files"
import { readSettings } from "../src/settings"
import { anchor, setup, text } from "./helpers"

// A 2×3 PNG.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR42mP8z8DwnwEIGHEIAD0KBf+0cY5MAAAAAElFTkSuQmCC"),
  (c) => c.charCodeAt(0),
)

// A small S3: objects by path. It accepts only signed requests.
const objects = new Map<string, Uint8Array<ArrayBuffer>>()
const s3 = Bun.serve({
  port: 0,
  async fetch(req) {
    if (!req.headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256 ")) return new Response("", { status: 403 })
    const path = new URL(req.url).pathname
    if (req.method === "PUT") objects.set(path, new Uint8Array(await req.arrayBuffer()))
    else if (req.method === "DELETE") objects.delete(path)
    else if (req.method === "GET") {
      const data = objects.get(path)
      return data ? new Response(data) : new Response("", { status: 404 })
    }
    return new Response("")
  },
})
afterAll(() => s3.stop())

const store = () =>
  s3Files({ bucket: "comma", region: "auto", endpoint: s3.url.origin, accessKeyId: "id", secretAccessKey: "secret" })

async function withImage(now?: () => number) {
  const s = await setup({ files: store(), now })
  const a = await s.guest("Ada")
  const form = new FormData()
  form.set("file", new File([PNG], "a.png", { type: "image/png" }))
  const up = await s.request("POST", "/api/files", { token: a.token, body: form })
  expect(up.status).toBe(200)
  return { s, a, id: up.json.id as string }
}

describe("images in S3", () => {
  test("an upload goes to the bucket, and comma serves it", async () => {
    const { s, a, id } = await withImage()
    expect(objects.get(`/comma/files/${id}`)).toEqual(PNG)
    await s.request("POST", "/api/threads", {
      token: a.token,
      body: { page: "/", anchor, body: text("x"), files: [id] },
    })
    const file = await s.app.fetch(new Request(`http://comma.test/files/${id}`))
    expect(file.headers.get("content-type")).toBe("image/png")
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG)
  })

  test("deleting the thread deletes the image in the bucket", async () => {
    const { s, a, id } = await withImage()
    const res = await s.request("POST", "/api/threads", {
      token: a.token,
      body: { page: "/", anchor, body: text("x"), files: [id] },
    })
    await s.request("DELETE", `/api/threads/${res.json.thread.id}`, { token: a.token })
    expect(objects.has(`/comma/files/${id}`)).toBe(false)
    expect((await s.app.fetch(new Request(`http://comma.test/files/${id}`))).status).toBe(404)
  })

  test("cleanup deletes unused images in the bucket", async () => {
    let now = Date.now()
    const { s, id } = await withImage(() => now)
    now += 25 * 60 * 60 * 1000
    expect((await s.app.cleanup()).files).toBe(1)
    expect(objects.has(`/comma/files/${id}`)).toBe(false)
  })
})

describe("settings", () => {
  const secret = "x".repeat(32)

  test("a plain path is a local file, a URL is a remote database", () => {
    expect(readSettings({ COMMA_SECRET: secret, COMMA_DB: "data/comma.sqlite" }).db).toEqual({
      url: "file:data/comma.sqlite",
      local: true,
    })
    expect(readSettings({ COMMA_SECRET: secret, COMMA_DB: "libsql://x.turso.io", COMMA_DB_TOKEN: "t" }).db).toEqual({
      url: "libsql://x.turso.io",
      authToken: "t",
      local: false,
    })
  })

  test("missing or bad settings give a message for the person who deploys", () => {
    expect(() => readSettings({ COMMA_SECRET: "short" })).toThrow("COMMA_SECRET")
    // No .env: a git worktree does not copy it.
    expect(() => readSettings({})).toThrow("Set COMMA_SECRET")
    expect(() => readSettings({ COMMA_SECRET: secret, COMMA_URL: "comma.example.com" })).toThrow("COMMA_URL")
    expect(() => readSettings({ COMMA_SECRET: secret, COMMA_FILES: "s3" })).toThrow("COMMA_S3_BUCKET")
  })
})
