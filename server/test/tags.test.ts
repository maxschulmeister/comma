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
