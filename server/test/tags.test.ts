import { describe, expect, test } from "bun:test"
import { anchor, config, setup, text } from "./helpers"

const DEFAULT_TAGS = [
  { name: "Bug", color: "red", createdBy: null },
  { name: "Change", color: "blue", createdBy: null },
  { name: "Content", color: "violet", createdBy: null },
  { name: "Design", color: "pink", createdBy: null },
  { name: "Question", color: "amber", createdBy: null },
  { name: "Idea", color: "green", createdBy: null },
]

async function withThread(s: Awaited<ReturnType<typeof setup>>) {
  const author = await s.guest("Author")
  const res = await s.request("POST", "/api/threads", {
    token: author.token,
    body: { page: "/pricing", anchor, body: text("First") },
  })
  expect(res.status).toBe(200)
  return { author, thread: res.json.thread }
}

describe("tags on threads", () => {
  test("anyone adds and removes tags; case does not matter; others see the change", async () => {
    const s = await setup()
    const { author, thread } = await withThread(s)
    const bob = await s.guest("Bob")
    const before = await s.request("GET", "/api/threads", { token: author.token })
    const etag = before.headers.get("etag") ?? ""

    const tag = (token: string, name: string, method = "PUT") =>
      s.request(method, `/api/threads/${thread.id}/tags/${encodeURIComponent(name)}`, { token })
    const added = await tag(bob.token, "bug")
    expect(added.status).toBe(200)
    expect(added.json.thread.tags).toEqual(["Bug"])
    await tag(author.token, "BUG")
    // In the order of the project's tags.
    expect((await tag(author.token, "Content")).json.thread.tags).toEqual(["Bug", "Content"])
    expect((await tag(author.token, "Bug")).json.thread.tags).toEqual(["Bug", "Content"])

    const after = await s.request("GET", "/api/threads", { token: author.token, headers: { "if-none-match": etag } })
    expect(after.status).toBe(200)
    expect(after.json.threads[0].tags).toEqual(["Bug", "Content"])

    expect((await tag(bob.token, "Bug", "DELETE")).json.thread.tags).toEqual(["Content"])
  })

  test("only tags of the project; only threads of the project", async () => {
    const s = await setup()
    const { author, thread } = await withThread(s)
    const unknown = await s.request("PUT", `/api/threads/${thread.id}/tags/Perf`, { token: author.token })
    expect(unknown.status).toBe(400)
    const stranger = await s.guest("Stranger", "https://other.test", "other")
    const other = await s.request("PUT", `/api/threads/${thread.id}/tags/Bug`, {
      token: stranger.token,
      origin: "https://other.test",
    })
    expect(other.status).toBe(404)
  })

  test("deleting a thread deletes its tags", async () => {
    const s = await setup()
    const { author, thread } = await withThread(s)
    await s.request("PUT", `/api/threads/${thread.id}/tags/Bug`, { token: author.token })
    expect((await s.request("DELETE", `/api/threads/${thread.id}`, { token: author.token })).status).toBe(200)
    const rows = await s.db.execute("select * from thread_tags")
    expect(rows.rows).toHaveLength(0)
  })
})

describe("new tags", () => {
  test("a guest makes a tag; it comes after the config's tags, in the order of names; anyone can use it", async () => {
    const s = await setup()
    const { author, thread } = await withThread(s)
    const make = (name: string, color: string) =>
      s.request("POST", "/api/tags", { token: author.token, body: { name, color } })
    const perf = await make(" Perf ", "teal")
    expect(perf.status).toBe(200)
    expect(perf.json.tag).toEqual({ name: "Perf", color: "teal", createdBy: author.user.id })
    await make("a11y", "gray")

    const bob = await s.guest("Bob")
    const tagged = await s.request("PUT", `/api/threads/${thread.id}/tags/perf`, { token: bob.token })
    expect(tagged.json.thread.tags).toEqual(["Perf"])
    expect(tagged.json.tags.slice(DEFAULT_TAGS.length)).toEqual([
      { name: "a11y", color: "gray", createdBy: author.user.id },
      { name: "Perf", color: "teal", createdBy: author.user.id },
    ])
    // Other projects do not have it.
    const stranger = await s.guest("Stranger", "https://other.test", "other")
    const other = await s.request("GET", "/api/threads", { token: stranger.token, origin: "https://other.test" })
    expect(other.json.tags).toEqual(DEFAULT_TAGS)
  })

  test("a name with % works in the URL", async () => {
    const s = await setup()
    const { author, thread } = await withThread(s)
    await s.request("POST", "/api/tags", { token: author.token, body: { name: "100% done", color: "green" } })
    const path = `/api/threads/${thread.id}/tags/${encodeURIComponent("100% done")}`
    const res = await s.request("PUT", path, { token: author.token })
    expect(res.status).toBe(200)
    expect(res.json.thread.tags).toEqual(["100% done"])
  })

  test("a name that the project has, in any case, is taken", async () => {
    const s = await setup()
    const { token } = await s.guest("Ada")
    const make = (name: string) => s.request("POST", "/api/tags", { token, body: { name, color: "blue" } })
    expect((await make("bug")).status).toBe(409)
    expect((await make("Perf")).status).toBe(200)
    const taken = await make("PERF")
    expect(taken.status).toBe(409)
    expect(taken.json.error).toBe("A tag with this name exists")
  })

  test("a tag has a name and one of the colors", async () => {
    const s = await setup()
    const { token } = await s.guest("Ada")
    const make = (body: unknown) => s.request("POST", "/api/tags", { token, body })
    expect((await make({ name: "Perf", color: "crimson" })).status).toBe(400)
    expect((await make({ name: "  ", color: "red" })).status).toBe(400)
    expect((await make({ name: "x".repeat(33), color: "red" })).status).toBe(400)
  })

  test("new tags count as comments for the limit", async () => {
    const project = { ...config.projects[0], limits: { commentsPerHour: 2 } }
    const s = await setup({ config: { projects: [project] } })
    const { token } = await s.guest("Ada")
    const make = (name: string) => s.request("POST", "/api/tags", { token, body: { name, color: "red" } })
    expect((await make("One")).status).toBe(200)
    expect((await make("Two")).status).toBe(200)
    expect((await make("Three")).status).toBe(429)
  })
})

describe("change and delete tags", () => {
  async function withTaggedThread() {
    const s = await setup()
    const { author, thread } = await withThread(s)
    await s.request("POST", "/api/tags", { token: author.token, body: { name: "Perf", color: "teal" } })
    await s.request("PUT", `/api/threads/${thread.id}/tags/Perf`, { token: author.token })
    await s.request("PUT", `/api/threads/${thread.id}/tags/Bug`, { token: author.token })
    const tagsOf = async () =>
      (await s.request("GET", "/api/threads", { token: author.token })).json.threads[0].tags as string[]
    return { s, author, thread, tagsOf }
  }

  test("the creator renames a tag and changes its color; threads keep it", async () => {
    const { s, author, tagsOf } = await withTaggedThread()
    const change = (tag: string, body: unknown) => s.request("PATCH", `/api/tags/${tag}`, { token: author.token, body })
    const renamed = await change("perf", { name: "Speed", color: "blue" })
    expect(renamed.status).toBe(200)
    expect(renamed.json.tags.at(-1)).toEqual({ name: "Speed", color: "blue", createdBy: author.user.id })
    expect(await tagsOf()).toEqual(["Bug", "Speed"])
    // Only the case: the same tag.
    expect((await change("Speed", { name: "speed" })).status).toBe(200)
    expect(await tagsOf()).toEqual(["Bug", "speed"])
    expect((await change("speed", { name: "BUG" })).status).toBe(409)
    expect((await change("Nothing", { color: "red" })).status).toBe(404)
  })

  test("the creator deletes a tag: it goes off all threads", async () => {
    const { s, author, tagsOf } = await withTaggedThread()
    const res = await s.request("DELETE", "/api/tags/Perf", { token: author.token })
    expect(res.status).toBe(200)
    expect(res.json.tags).toEqual(DEFAULT_TAGS)
    expect(await tagsOf()).toEqual(["Bug"])
    // A new tag with the same name does not come back on the thread.
    await s.request("POST", "/api/tags", { token: author.token, body: { name: "Perf", color: "teal" } })
    expect(await tagsOf()).toEqual(["Bug"])
  })

  test("only the creator or an admin changes a tag; nobody changes the config's tags here", async () => {
    const { s, tagsOf } = await withTaggedThread()
    const bob = await s.guest("Bob")
    expect((await s.request("PATCH", "/api/tags/Perf", { token: bob.token, body: { color: "red" } })).status).toBe(403)
    expect((await s.request("DELETE", "/api/tags/Perf", { token: bob.token })).status).toBe(403)
    const admin = await s.appUser({ sub: "admin", name: "Admin", admin: true })
    expect((await s.request("DELETE", "/api/tags/Bug", { token: admin.token })).status).toBe(403)
    expect((await s.request("PATCH", "/api/tags/Bug", { token: admin.token, body: { color: "blue" } })).status).toBe(
      403,
    )
    expect((await s.request("DELETE", "/api/tags/Perf", { token: admin.token })).status).toBe(200)
    expect(await tagsOf()).toEqual(["Bug"])
  })
})

describe("project tags", () => {
  test("a project without tags in its config has the default tags; a new thread has no tags", async () => {
    const s = await setup()
    const { author, thread } = await withThread(s)
    expect(thread.tags).toEqual([])
    const list = await s.request("GET", "/api/threads", { token: author.token })
    expect(list.json.tags).toEqual(DEFAULT_TAGS)
  })

  test("tags in the config replace the defaults; an empty list turns them off", async () => {
    const own = [{ name: "Perf", color: "teal" as const }]
    const s = await setup({
      config: {
        projects: [
          { ...config.projects[0], tags: own },
          { ...config.projects[1], tags: [] },
        ],
      },
    })
    const acme = await s.guest("Ada")
    expect((await s.request("GET", "/api/threads", { token: acme.token })).json.tags).toEqual([
      { name: "Perf", color: "teal", createdBy: null },
    ])
    const other = await s.guest("Bob", "https://other.test", "other")
    expect(
      (await s.request("GET", "/api/threads", { token: other.token, origin: "https://other.test" })).json.tags,
    ).toEqual([])
  })

  test("the config accepts only the tag colors and one tag for each name", async () => {
    const project = config.projects[0]
    const crimson = { ...project, tags: [{ name: "Perf", color: "crimson" }] }
    // @ts-expect-error: not a tag color
    await expect(setup({ config: { projects: [crimson] } })).rejects.toThrow()
    await expect(
      setup({
        config: {
          projects: [
            {
              ...project,
              tags: [
                { name: "Bug", color: "red" },
                { name: "bug", color: "blue" },
              ],
            },
          ],
        },
      }),
    ).rejects.toThrow()
  })
})
