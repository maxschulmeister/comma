import { describe, expect, test } from "bun:test"
import { ConfigSchema } from "../src/config"
import { ACME, anchor, PREVIEW_A, PREVIEW_B, setup, text } from "./helpers"

describe("origin patterns", () => {
  test("`*` in an origin matches one subdomain label", async () => {
    const { request } = await setup()
    const status = async (origin: string) =>
      (await request("POST", "/api/session/guest", { origin, body: { project: "previews", name: "Ada" } })).status
    expect(await status(PREVIEW_A)).toBe(200)
    expect(await status("https://feature-1234.preview.test")).toBe(200)
    expect(await status("https://preview.test")).toBe(403)
    expect(await status("https://a.b.preview.test")).toBe(403)
    expect(await status("http://feat-a.preview.test")).toBe(403)
    expect(await status("https://feat-a.preview.test.evil.test")).toBe(403)
    expect(await status("https://evilpreview.test")).toBe(403)
  })

  test("CORS allows the origins that match a pattern", async () => {
    const { app } = await setup()
    const preflight = (origin: string) =>
      app.fetch(new Request("http://comma.test/api/threads", { method: "OPTIONS", headers: { origin } }))
    expect((await preflight(PREVIEW_A)).headers.get("access-control-allow-origin")).toBe(PREVIEW_A)
    expect((await preflight("https://a.b.preview.test")).headers.get("access-control-allow-origin")).toBeNull()
  })
})

test("`*` is only allowed as the first label of the host", () => {
  const parse = (origin: string) => ConfigSchema.safeParse({ projects: [{ id: "p", origins: [origin] }] }).success
  expect(parse("https://*.preview.test")).toBe(true)
  expect(parse("https://a.*.preview.test")).toBe(false)
  expect(parse("https://*")).toBe(false)
})

describe("scope", () => {
  test("with scope origin, each origin has its own comments", async () => {
    const { guest, request } = await setup()
    const a = await guest("Ada", PREVIEW_A, "previews")
    const b = await guest("Bob", PREVIEW_B, "previews")
    const created = await request("POST", "/api/threads", {
      token: a.token,
      origin: PREVIEW_A,
      body: { page: "/", anchor, body: text("on A") },
    })
    expect(created.status).toBe(200)
    const id = created.json.thread.id

    const onA = await request("GET", "/api/threads", { token: a.token, origin: PREVIEW_A })
    expect(onA.json.threads.map((t: { id: string }) => t.id)).toEqual([id])
    const onB = await request("GET", "/api/threads", { token: b.token, origin: PREVIEW_B })
    expect(onB.json.threads).toEqual([])
    // A session made on A, used from B, sees B's comments only.
    expect((await request("GET", "/api/threads", { token: a.token, origin: PREVIEW_B })).json.threads).toEqual([])
    const reply = await request("POST", `/api/threads/${id}/comments`, {
      token: b.token,
      origin: PREVIEW_B,
      body: { body: text("from B") },
    })
    expect(reply.status).toBe(404)
  })

  test("with scope project (the default), all origins share the comments", async () => {
    const { guest, request } = await setup()
    const a = await guest("Ada")
    await request("POST", "/api/threads", { token: a.token, body: { page: "/", anchor, body: text("hi") } })
    const local = await request("GET", "/api/threads", { token: a.token, origin: "http://localhost:3000" })
    expect(local.json.threads).toHaveLength(1)
    expect((await request("GET", "/api/threads", { token: a.token, origin: ACME })).json.threads).toHaveLength(1)
  })
})
