import { describe, expect, test } from "bun:test"
import { anchor, appToken_, OPEN, PNG, setup, text, upload } from "./helpers"

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

async function start(s: Awaited<ReturnType<typeof setup>>) {
  const a = await s.guest("Ada")
  const res = await s.request("POST", "/api/threads", {
    token: a.token,
    body: { page: "/", anchor, body: text("First") },
  })
  return { a, thread: res.json.thread }
}

describe("mentions", () => {
  test("the server reads mentions from the body, only users of the project", async () => {
    const s = await setup()
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
    const s = await setup()
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
    const s = await setup()
    await s.appUser({ sub: "1", name: "Grace Hopper" })
    await s.guest("Gregory Silent")
    const { a } = await start(s)
    const res = await s.request("GET", "/api/users?q=gr", { token: a.token })
    expect(res.json.users.map((u: { name: string }) => u.name)).toEqual(["Grace Hopper"])
    const ada = await s.request("GET", "/api/users?q=ada", { token: a.token })
    expect(ada.json.users.map((u: { name: string }) => u.name)).toEqual(["Ada"])
  })

  test("names that start with the query come first", async () => {
    const s = await setup()
    await s.appUser({ sub: "1", name: "Max Ann" })
    await s.appUser({ sub: "2", name: "Anna Lee" })
    const { a } = await start(s)
    const res = await s.request("GET", "/api/users?q=ann", { token: a.token })
    expect(res.json.users.map((u: { name: string }) => u.name)).toEqual(["Anna Lee", "Max Ann"])
  })
})

describe("reactions", () => {
  test("users add and remove reactions", async () => {
    const s = await setup()
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
    const s = await setup()
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
    const s = await setup()
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

  test("a thread is mentioned when someone else mentions me after my last read", async () => {
    let time = 1000
    const s = await setup({ now: () => ++time })
    const a = await s.guest("Ada")
    const b = await s.guest("Bob")
    const created = await s.request("POST", "/api/threads", {
      token: a.token,
      body: { page: "/", anchor, body: mention(b.user.id, "Bob") },
    })
    const id = created.json.thread.id
    const mentioned = async (token: string) =>
      (await s.request("GET", "/api/threads", { token })).json.threads[0].mentioned
    // The first comment mentions Bob. It is not about Ada.
    expect(await mentioned(b.token)).toBe(true)
    expect(await mentioned(a.token)).toBe(false)
    await s.request("POST", `/api/threads/${id}/read`, { token: b.token, body: { read: true } })
    expect(await mentioned(b.token)).toBe(false)
    // A reply without a mention makes the thread unread, not mentioned.
    await s.request("POST", `/api/threads/${id}/comments`, { token: a.token, body: { body: text("More") } })
    const unread = (await s.request("GET", "/api/threads", { token: b.token })).json.threads[0]
    expect(unread).toMatchObject({ unread: true, mentioned: false })
    // A reply that mentions Bob.
    await s.request("POST", `/api/threads/${id}/comments`, {
      token: a.token,
      body: { body: mention(b.user.id, "Bob") },
    })
    expect(await mentioned(b.token)).toBe(true)
    // Mark as unread after a read: the old mention does not come back.
    await s.request("POST", `/api/threads/${id}/read`, { token: b.token, body: { read: true } })
    await s.request("POST", `/api/threads/${id}/read`, { token: b.token, body: { read: false } })
    expect(await mentioned(b.token)).toBe(false)
    // Bob mentions himself: no.
    await s.request("POST", `/api/threads/${id}/comments`, {
      token: b.token,
      body: { body: mention(b.user.id, "Bob") },
    })
    expect(await mentioned(b.token)).toBe(false)
  })

  test("mark as unread", async () => {
    const s = await setup()
    const { a, thread } = await start(s)
    const res = await s.request("POST", `/api/threads/${thread.id}/read`, { token: a.token, body: { read: false } })
    expect(res.json.thread.unread).toBe(true)
    const read = await s.request("POST", `/api/threads/${thread.id}/read`, { token: a.token, body: { read: true } })
    expect(read.json.thread.unread).toBe(false)
  })
})

describe("ETag", () => {
  test("no change gives 304, a change gives new data", async () => {
    const s = await setup()
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
    const s = await setup()
    const { a, thread } = await start(s)
    const etag = (await s.request("GET", "/api/threads", { token: a.token })).headers.get("etag") ?? ""
    await s.request("POST", `/api/threads/${thread.id}/read`, { token: a.token, body: { read: false } })
    const res = await s.request("GET", "/api/threads", { token: a.token, headers: { "if-none-match": etag } })
    expect(res.status).toBe(200)
  })
})

describe("files", () => {
  test("an uploaded image is attached to a comment and served", async () => {
    const s = await setup()
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
    const s = await setup()
    const a = await s.guest("Ada")
    const res = await upload(s, a.token, new TextEncoder().encode("<svg onload=alert(1)>"), "x.png")
    expect(res.status).toBe(415)
  })

  test("images over 4 MB are rejected", async () => {
    const s = await setup()
    const a = await s.guest("Ada")
    const big = new Uint8Array(4 * 1024 * 1024 + 1)
    big.set(PNG)
    const res = await upload(s, a.token, big)
    expect(res.status).toBe(413)
    expect(res.json.error).toBe("Images can be up to 4 MB")
  })

  test("a file can be used once, by its uploader only, up to 5 per comment", async () => {
    const s = await setup()
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
    const s = await setup({ now: () => now })
    const a = await s.guest("Ada")
    const unused = await upload(s, a.token)
    const used = await upload(s, a.token)
    await s.request("POST", "/api/threads", {
      token: a.token,
      body: { page: "/", anchor, body: text("x"), files: [used.json.id] },
    })
    now += 24 * 60 * 60 * 1000 + 1
    expect((await s.app.cleanup()).files).toBe(1)
    expect((await s.app.fetch(new Request(`http://comma.test/files/${unused.json.id}`))).status).toBe(404)
    expect((await s.app.fetch(new Request(`http://comma.test/files/${used.json.id}`))).status).toBe(200)
  })

  test("deleting a thread deletes its files", async () => {
    const s = await setup()
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
    const s = await setup()
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
    const s = await setup({ publicUrl: "https://comma.acme.test" })
    const res = await s.app.fetch(
      new Request("http://localhost:4000/auth/start?project=acme&origin=https%3A%2F%2Facme.test"),
    )
    const url = new URL(res.headers.get("location") ?? "")
    expect(url.searchParams.get("redirect_uri")).toBe("https://comma.acme.test/auth/callback")
  })

  test("start refuses origins not registered for the project", async () => {
    const s = await setup()
    const res = await s.app.fetch(
      new Request("http://comma.test/auth/start?project=acme&origin=https%3A%2F%2Fevil.test"),
    )
    expect(res.status).toBe(403)
  })

  test("callback posts a session to the opener origin only", async () => {
    const s = await setup()
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
    const s = await setup()
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
    const s = await setup()
    const a = await s.guest("Uploader")
    for (let i = 0; i < 100; i++) expect((await upload(s, a.token)).status).toBe(200)
    expect((await upload(s, a.token)).status).toBe(429)
  })
})

test("a project can set its own limits per hour", async () => {
  const s = await setup({
    config: {
      projects: [{ id: "small", origins: [OPEN], limits: { commentsPerHour: 2, imagesPerHour: 1, guestsPerHour: 2 } }],
    },
  })
  const join = () => s.request("POST", "/api/session/guest", { origin: OPEN, body: { project: "small", name: "Ada" } })
  const a = (await join()).json
  expect((await join()).status).toBe(200)
  expect((await join()).status).toBe(429)
  const post = () =>
    s.request("POST", "/api/threads", { token: a.token, origin: OPEN, body: { page: "/", anchor, body: text("x") } })
  expect((await post()).status).toBe(200)
  expect((await post()).status).toBe(200)
  expect((await post()).status).toBe(429)
  const form = () => {
    const f = new FormData()
    f.set("file", new File([PNG], "a.png", { type: "image/png" }))
    return s.request("POST", "/api/files", { token: a.token, origin: OPEN, body: f })
  }
  expect((await form()).status).toBe(200)
  expect((await form()).status).toBe(429)
})

describe("element screenshot", () => {
  test("a new thread keeps a screenshot of its element, apart from the 5 images", async () => {
    const s = await setup()
    const a = await s.guest("Ada")
    const shot = (await upload(s, a.token)).json.id
    const images = []
    for (let i = 0; i < 5; i++) images.push((await upload(s, a.token)).json.id)
    const res = await s.request("POST", "/api/threads", {
      token: a.token,
      body: { page: "/", anchor, body: text("x"), files: images, screenshot: shot },
    })
    expect(res.status).toBe(200)
    expect(res.json.thread.screenshot).toMatchObject({ id: shot, url: `/files/${shot}`, width: 2, height: 3 })
    expect(res.json.thread.comments[0].files.map((f: { id: string }) => f.id)).toEqual(images)
    // It stays after the cleanup, and goes with the thread.
    expect((await s.app.cleanup()).files).toBe(0)
    await s.request("DELETE", `/api/threads/${res.json.thread.id}`, { token: a.token })
    expect((await s.app.fetch(new Request(`http://comma.test/files/${shot}`))).status).toBe(404)
  })

  test("the screenshot must be an unused upload of the same user", async () => {
    const s = await setup()
    const a = await s.guest("Ada")
    const b = await s.guest("Bob")
    const theirs = (await upload(s, b.token)).json.id
    const res = await s.request("POST", "/api/threads", {
      token: a.token,
      body: { page: "/", anchor, body: text("x"), screenshot: theirs },
    })
    expect(res.status).toBe(400)
  })

  test("a thread without a screenshot has null", async () => {
    const s = await setup()
    const a = await s.guest("Ada")
    const res = await s.request("POST", "/api/threads", {
      token: a.token,
      body: { page: "/", anchor, body: text("x") },
    })
    expect(res.json.thread.screenshot).toBeNull()
  })
})

describe("unused upload quota", () => {
  test("a project holds at most 200 MB of images that no comment uses", async () => {
    const s = await setup()
    // Fill the quota directly: 40 unused files of 5 MB.
    const g = await s.guest("Filler")
    for (let i = 0; i < 40; i++) {
      await s.db.execute({
        sql: "insert into files (id, project, uploaded_by, mime, size, width, height, data, created_at) values (?, 'acme', ?, 'image/png', ?, 1, 1, x'00', ?)",
        args: [`f${i}`, g.user.id, 5 * 1024 * 1024, Date.now()],
      })
    }
    const other = await s.guest("Other")
    expect((await upload(s, other.token)).status).toBe(507)
  })
})

describe("profile changes", () => {
  test("a new name of an app user changes the ETag", async () => {
    const s = await setup()
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
