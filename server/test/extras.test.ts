import { describe, expect, test } from "bun:test"
import { anchor, appToken_, setup, text } from "./helpers"

const mention = (id: string, label: string, before = "Hi ") => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: before },
        { type: "mention", attrs: { id, label } },
      ],
    },
  ],
})

async function start(s: ReturnType<typeof setup>) {
  const a = await s.guest("Ada")
  const res = await s.request("POST", "/api/threads", {
    token: a.token,
    body: { page: "/", anchor, body: text("First") },
  })
  return { a, thread: res.json.thread }
}

describe("mentions", () => {
  test("the server reads mentions from the body, only users of the project", async () => {
    const s = setup()
    const b = await s.guest("Bob")
    const outsider = await s.guest("Out", "https://other.test", "other")
    const a = await s.guest("Ada")
    const body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: b.user.id, label: "Bob" } },
            { type: "text", text: " and " },
            { type: "mention", attrs: { id: outsider.user.id, label: "Out" } },
          ],
        },
      ],
    }
    const res = await s.request("POST", "/api/threads", { token: a.token, body: { page: "/", anchor, body } })
    expect(res.json.thread.comments[0].mentions).toEqual([b.user.id])
    expect(res.json.thread.comments[0].text).toBe("@Bob and @Out")
    expect(res.json.users[b.user.id]).toMatchObject({ name: "Bob" })
  })

  test("editing a comment updates its mentions", async () => {
    const s = setup()
    const b = await s.guest("Bob")
    const { a, thread } = await start(s)
    const res = await s.request("PATCH", `/api/comments/${thread.comments[0].id}`, {
      token: a.token,
      body: { body: mention(b.user.id, "Bob") },
    })
    expect(res.json.comment.mentions).toEqual([b.user.id])
  })
})

describe("user search", () => {
  test("finds app users and people who commented, not silent guests", async () => {
    const s = setup()
    await s.appUser({ sub: "1", name: "Grace Hopper" })
    await s.guest("Gregory Silent")
    const { a } = await start(s)
    const res = await s.request("GET", "/api/users?q=gr", { token: a.token })
    expect(res.json.users.map((u: { name: string }) => u.name)).toEqual(["Grace Hopper"])
    const ada = await s.request("GET", "/api/users?q=ada", { token: a.token })
    expect(ada.json.users.map((u: { name: string }) => u.name)).toEqual(["Ada"])
  })

  test("names that start with the query come first", async () => {
    const s = setup()
    await s.appUser({ sub: "1", name: "Max Ann" })
    await s.appUser({ sub: "2", name: "Anna Lee" })
    const { a } = await start(s)
    const res = await s.request("GET", "/api/users?q=ann", { token: a.token })
    expect(res.json.users.map((u: { name: string }) => u.name)).toEqual(["Anna Lee", "Max Ann"])
  })
})

describe("reactions", () => {
  test("users add and remove reactions", async () => {
    const s = setup()
    const { a, thread } = await start(s)
    const b = await s.guest("Bob")
    const id = thread.comments[0].id
    await s.request("PUT", `/api/comments/${id}/reactions/${encodeURIComponent("👍")}`, { token: a.token })
    await s.request("PUT", `/api/comments/${id}/reactions/${encodeURIComponent("👍")}`, { token: b.token })
    const twice = await s.request("PUT", `/api/comments/${id}/reactions/${encodeURIComponent("👍")}`, {
      token: b.token,
    })
    expect(twice.json.thread.comments[0].reactions).toEqual([{ emoji: "👍", userIds: [a.user.id, b.user.id] }])
    const removed = await s.request("DELETE", `/api/comments/${id}/reactions/${encodeURIComponent("👍")}`, {
      token: a.token,
    })
    expect(removed.json.thread.comments[0].reactions).toEqual([{ emoji: "👍", userIds: [b.user.id] }])
  })

  test("a reaction must be an emoji", async () => {
    const s = setup()
    const { a, thread } = await start(s)
    const res = await s.request("PUT", `/api/comments/${thread.comments[0].id}/reactions/abc`, { token: a.token })
    expect(res.status).toBe(400)
    const flag = await s.request(
      "PUT",
      `/api/comments/${thread.comments[0].id}/reactions/${encodeURIComponent("👍🏽")}`,
      { token: a.token },
    )
    expect(flag.status).toBe(200)
  })
})

describe("read state", () => {
  test("a thread is unread when someone else comments after my last read", async () => {
    const s = setup()
    const { a, thread } = await start(s)
    const b = await s.guest("Bob")
    const forB = async () => (await s.request("GET", "/api/threads", { token: b.token })).json.threads[0].unread
    const forA = async () => (await s.request("GET", "/api/threads", { token: a.token })).json.threads[0].unread
    expect(await forA()).toBe(false)
    expect(await forB()).toBe(true)
    await s.request("POST", `/api/threads/${thread.id}/read`, { token: b.token, body: { read: true } })
    expect(await forB()).toBe(false)
    await s.request("POST", `/api/threads/${thread.id}/comments`, { token: b.token, body: { body: text("Reply") } })
    expect(await forB()).toBe(false)
    expect(await forA()).toBe(true)
  })

  test("mark as unread", async () => {
    const s = setup()
    const { a, thread } = await start(s)
    const res = await s.request("POST", `/api/threads/${thread.id}/read`, { token: a.token, body: { read: false } })
    expect(res.json.thread.unread).toBe(true)
    const read = await s.request("POST", `/api/threads/${thread.id}/read`, { token: a.token, body: { read: true } })
    expect(read.json.thread.unread).toBe(false)
  })
})

describe("ETag", () => {
  test("no change gives 304, a change gives new data", async () => {
    const s = setup()
    const { a, thread } = await start(s)
    const first = await s.request("GET", "/api/threads", { token: a.token })
    const etag = first.headers.get("etag") ?? ""
    expect(etag).not.toBe("")
    const same = await s.request("GET", "/api/threads", { token: a.token, headers: { "if-none-match": etag } })
    expect(same.status).toBe(304)
    const b = await s.guest("Bob")
    await s.request("PUT", `/api/comments/${thread.comments[0].id}/reactions/${encodeURIComponent("🎉")}`, {
      token: b.token,
    })
    const changed = await s.request("GET", "/api/threads", { token: a.token, headers: { "if-none-match": etag } })
    expect(changed.status).toBe(200)
    expect(changed.json.threads[0].comments[0].reactions).toHaveLength(1)
  })

  test("my read state changes the ETag", async () => {
    const s = setup()
    const { a, thread } = await start(s)
    const etag = (await s.request("GET", "/api/threads", { token: a.token })).headers.get("etag") ?? ""
    await s.request("POST", `/api/threads/${thread.id}/read`, { token: a.token, body: { read: false } })
    const res = await s.request("GET", "/api/threads", { token: a.token, headers: { "if-none-match": etag } })
    expect(res.status).toBe(200)
  })
})

// A 2×3 PNG.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR42mP8z8DwnwEIGHEIAD0KBf+0cY5MAAAAAElFTkSuQmCC"),
  (c) => c.charCodeAt(0),
)

async function upload(
  s: ReturnType<typeof setup>,
  token: string,
  bytes: Uint8Array<ArrayBuffer> = PNG,
  name = "a.png",
) {
  const form = new FormData()
  form.set("file", new File([bytes], name, { type: "image/png" }))
  return s.request("POST", "/api/files", { token, body: form })
}

describe("files", () => {
  test("an uploaded image is attached to a comment and served", async () => {
    const s = setup()
    const a = await s.guest("Ada")
    const up = await upload(s, a.token)
    expect(up.status).toBe(200)
    expect(up.json).toMatchObject({ mime: "image/png", width: 2, height: 3 })
    expect(up.json.id.length).toBeGreaterThanOrEqual(22)
    const res = await s.request("POST", "/api/threads", {
      token: a.token,
      body: { page: "/", anchor, body: { type: "doc", content: [{ type: "paragraph" }] }, files: [up.json.id] },
    })
    expect(res.status).toBe(200)
    expect(res.json.thread.comments[0].files).toEqual([
      { id: up.json.id, url: `/files/${up.json.id}`, mime: "image/png", width: 2, height: 3 },
    ])
    const file = await s.app.fetch(new Request(`http://comma.test/files/${up.json.id}`))
    expect(file.headers.get("content-type")).toBe("image/png")
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG)
  })

  test("the type comes from the content, not the name", async () => {
    const s = setup()
    const a = await s.guest("Ada")
    const res = await upload(s, a.token, new TextEncoder().encode("<svg onload=alert(1)>"), "x.png")
    expect(res.status).toBe(415)
  })

  test("images over 5 MB are rejected", async () => {
    const s = setup()
    const a = await s.guest("Ada")
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    big.set(PNG)
    expect((await upload(s, a.token, big)).status).toBe(413)
  })

  test("a file can be used once, by its uploader only, up to 5 per comment", async () => {
    const s = setup()
    const a = await s.guest("Ada")
    const b = await s.guest("Bob")
    const up = await upload(s, a.token)
    const create = (token: string, files: string[]) =>
      s.request("POST", "/api/threads", { token, body: { page: "/", anchor, body: text("x"), files } })
    expect((await create(b.token, [up.json.id])).status).toBe(400)
    expect((await create(a.token, [up.json.id])).status).toBe(200)
    expect((await create(a.token, [up.json.id])).status).toBe(400)
    const six = await Promise.all(Array.from({ length: 6 }, () => upload(s, a.token)))
    expect(
      (
        await create(
          a.token,
          six.map((r) => r.json.id),
        )
      ).status,
    ).toBe(400)
  })

  test("uploads that no comment uses are deleted after 24 h", async () => {
    let now = Date.now()
    const s = setup({ now: () => now })
    const a = await s.guest("Ada")
    const unused = await upload(s, a.token)
    const used = await upload(s, a.token)
    await s.request("POST", "/api/threads", {
      token: a.token,
      body: { page: "/", anchor, body: text("x"), files: [used.json.id] },
    })
    now += 24 * 60 * 60 * 1000 + 1
    expect(s.app.cleanupFiles()).toBe(1)
    expect((await s.app.fetch(new Request(`http://comma.test/files/${unused.json.id}`))).status).toBe(404)
    expect((await s.app.fetch(new Request(`http://comma.test/files/${used.json.id}`))).status).toBe(200)
  })

  test("deleting a thread deletes its files", async () => {
    const s = setup()
    const a = await s.guest("Ada")
    const up = await upload(s, a.token)
    const res = await s.request("POST", "/api/threads", {
      token: a.token,
      body: { page: "/", anchor, body: text("x"), files: [up.json.id] },
    })
    await s.request("DELETE", `/api/threads/${res.json.thread.id}`, { token: a.token })
    expect((await s.app.fetch(new Request(`http://comma.test/files/${up.json.id}`))).status).toBe(404)
  })
})

describe("popup sign-in", () => {
  test("start redirects to the app sign-in URL with a callback and state", async () => {
    const s = setup()
    const res = await s.app.fetch(
      new Request("http://comma.test/auth/start?project=acme&origin=https%3A%2F%2Facme.test"),
    )
    expect(res.status).toBe(302)
    const url = new URL(res.headers.get("location") ?? "")
    expect(url.origin + url.pathname).toBe("https://app.acme.test/comma")
    expect(url.searchParams.get("redirect_uri")).toBe("http://comma.test/auth/callback")
    expect(url.searchParams.get("state")).toBeString()
  })

  test("behind a proxy, the callback is on the public URL, not on the address the proxy uses", async () => {
    const s = setup({ publicUrl: "https://comma.acme.test" })
    const res = await s.app.fetch(
      new Request("http://localhost:4000/auth/start?project=acme&origin=https%3A%2F%2Facme.test"),
    )
    const url = new URL(res.headers.get("location") ?? "")
    expect(url.searchParams.get("redirect_uri")).toBe("https://comma.acme.test/auth/callback")
  })

  test("start refuses origins not registered for the project", async () => {
    const s = setup()
    const res = await s.app.fetch(
      new Request("http://comma.test/auth/start?project=acme&origin=https%3A%2F%2Fevil.test"),
    )
    expect(res.status).toBe(403)
  })

  test("callback posts a session to the opener origin only", async () => {
    const s = setup()
    const start = await s.app.fetch(
      new Request("http://comma.test/auth/start?project=acme&origin=https%3A%2F%2Facme.test"),
    )
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? ""
    const token = await appToken_({ sub: "u1", name: "Grace </script><script>alert(1)" })
    const res = await s.app.fetch(
      new Request(`http://comma.test/auth/callback?token=${token}&state=${encodeURIComponent(state)}`),
    )
    expect(res.status).toBe(200)
    const page = await res.text()
    expect(page).toContain('"type":"comma:session"')
    expect(page).toContain(', "https://acme.test")')
    expect(page).not.toContain("</script><script>alert")
  })

  test("callback with a bad state or token fails", async () => {
    const s = setup()
    const token = await appToken_({ sub: "u1", name: "Grace" })
    expect((await s.app.fetch(new Request(`http://comma.test/auth/callback?token=${token}&state=bad`))).status).toBe(
      400,
    )
    const start = await s.app.fetch(
      new Request("http://comma.test/auth/start?project=acme&origin=https%3A%2F%2Facme.test"),
    )
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? ""
    expect(
      (await s.app.fetch(new Request(`http://comma.test/auth/callback?token=bad&state=${encodeURIComponent(state)}`)))
        .status,
    ).toBe(401)
  })
})

describe("upload limit", () => {
  test("a user can upload 100 images per hour", async () => {
    const s = setup()
    const a = await s.guest("Uploader")
    for (let i = 0; i < 100; i++) expect((await upload(s, a.token)).status).toBe(200)
    expect((await upload(s, a.token)).status).toBe(429)
  })
})

describe("unused upload quota", () => {
  test("a project holds at most 200 MB of images that no comment uses", async () => {
    const s = setup()
    // Fill the quota directly: 40 unused files of 5 MB.
    const g = await s.guest("Filler")
    const insert = s.db.query(
      "insert into files (id, project, uploaded_by, mime, size, width, height, data, created_at) values (?, 'acme', ?, 'image/png', ?, 1, 1, x'00', ?)",
    )
    for (let i = 0; i < 40; i++) insert.run(`f${i}`, g.user.id, 5 * 1024 * 1024, Date.now())
    const other = await s.guest("Other")
    expect((await upload(s, other.token)).status).toBe(507)
  })
})

describe("profile changes", () => {
  test("a new name of an app user changes the ETag", async () => {
    const s = setup()
    const grace = await s.appUser({ sub: "g", name: "Grace" })
    await s.request("POST", "/api/threads", { token: grace.token, body: { page: "/", anchor, body: text("x") } })
    const b = await s.guest("Bob")
    const etag = (await s.request("GET", "/api/threads", { token: b.token })).headers.get("etag") ?? ""
    await s.appUser({ sub: "g", name: "Grace Hopper" })
    const res = await s.request("GET", "/api/threads", { token: b.token, headers: { "if-none-match": etag } })
    expect(res.status).toBe(200)
    expect(res.json.users[grace.user.id].name).toBe("Grace Hopper")
  })
})
