import { describe, expect, test } from "bun:test"
import { createClient } from "@libsql/client"
import { migrate } from "../src/db"
import { anchor, OTHER, setup, text } from "./helpers"

async function withThread(s: Awaited<ReturnType<typeof setup>>, body = text("First")) {
  const author = await s.guest("Author")
  const res = await s.request("POST", "/api/threads", { token: author.token, body: { page: "/pricing", anchor, body } })
  expect(res.status).toBe(200)
  return { author, thread: res.json.thread }
}

describe("threads and comments", () => {
  test("a user creates a thread, another user replies, both see it", async () => {
    const s = await setup()
    const { thread } = await withThread(s)
    expect(thread).toMatchObject({ page: "/pricing", status: "open", anchor })
    expect(thread.comments).toHaveLength(1)
    expect(thread.comments[0]).toMatchObject({ body: text("First"), text: "First" })

    const other = await s.guest("Other")
    const reply = await s.request("POST", `/api/threads/${thread.id}/comments`, {
      token: other.token,
      body: { body: text("Reply") },
    })
    expect(reply.status).toBe(200)

    const list = await s.request("GET", "/api/threads", { token: other.token })
    expect(list.json.threads).toHaveLength(1)
    expect(list.json.threads[0].comments.map((c: { text: string }) => c.text)).toEqual(["First", "Reply"])
    expect(
      Object.values(list.json.users)
        .map((u) => (u as { name: string }).name)
        .sort(),
    ).toEqual(["Author", "Other"])
  })

  test("the page is a URL path", async () => {
    const s = await setup()
    const { token } = await s.guest()
    const res = await s.request("POST", "/api/threads", {
      token,
      body: { page: "https://evil.test/x", anchor, body: text("x") },
    })
    expect(res.status).toBe(400)
  })

  test("only the author edits a comment", async () => {
    const s = await setup()
    const { author, thread } = await withThread(s)
    const comment = thread.comments[0]
    const other = await s.guest("Other")
    expect(
      (await s.request("PATCH", `/api/comments/${comment.id}`, { token: other.token, body: { body: text("Hacked") } }))
        .status,
    ).toBe(403)
    const edit = await s.request("PATCH", `/api/comments/${comment.id}`, {
      token: author.token,
      body: { body: text("Edited") },
    })
    expect(edit.status).toBe(200)
    expect(edit.json.comment).toMatchObject({ text: "Edited" })
    expect(edit.json.comment.editedAt).toBeNumber()
  })

  test("only the author deletes a comment", async () => {
    const s = await setup()
    const { thread } = await withThread(s)
    const other = await s.guest("Other")
    const reply = await s.request("POST", `/api/threads/${thread.id}/comments`, {
      token: other.token,
      body: { body: text("Reply") },
    })
    const replyId = reply.json.comment.id
    const author = thread.createdBy
    expect(author).toBeString()
    const stranger = await s.guest("Stranger")
    expect((await s.request("DELETE", `/api/comments/${replyId}`, { token: stranger.token })).status).toBe(403)
    const deleted = await s.request("DELETE", `/api/comments/${replyId}`, { token: other.token })
    expect(deleted.status).toBe(200)
    // The answer has the thread without the comment, with a newer revision.
    expect(deleted.json.threadDeleted).toBe(false)
    expect(deleted.json.thread.comments).toHaveLength(1)
    expect(deleted.json.thread.updatedAt).toBeGreaterThanOrEqual(reply.json.thread.updatedAt)
    const list = await s.request("GET", "/api/threads", { token: other.token })
    expect(list.json.threads[0].comments).toHaveLength(1)
  })

  test("deleting the first comment deletes the thread", async () => {
    const s = await setup()
    const { author, thread } = await withThread(s)
    await s.request("DELETE", `/api/comments/${thread.comments[0].id}`, { token: author.token })
    const list = await s.request("GET", "/api/threads", { token: author.token })
    expect(list.json.threads).toEqual([])
  })

  test("the thread author or an admin deletes a thread, nobody else", async () => {
    const s = await setup()
    const { author, thread } = await withThread(s)
    const other = await s.guest("Other")
    expect((await s.request("DELETE", `/api/threads/${thread.id}`, { token: other.token })).status).toBe(403)
    const admin = await s.appUser({ sub: "boss", name: "Boss", admin: true })
    expect((await s.request("DELETE", `/api/threads/${thread.id}`, { token: admin.token })).status).toBe(200)
    expect((await s.request("GET", "/api/threads", { token: author.token })).json.threads).toEqual([])
    const second = await withThread(s)
    expect((await s.request("DELETE", `/api/threads/${second.thread.id}`, { token: second.author.token })).status).toBe(
      200,
    )
  })

  test("anyone resolves and reopens a thread", async () => {
    const s = await setup()
    const { thread } = await withThread(s)
    const other = await s.guest("Other")
    const resolved = await s.request("PATCH", `/api/threads/${thread.id}`, {
      token: other.token,
      body: { status: "resolved" },
    })
    expect(resolved.json.thread).toMatchObject({ status: "resolved", resolvedBy: other.user.id })
    expect(resolved.json.thread.resolvedAt).toBeNumber()
    const open = await s.request("PATCH", `/api/threads/${thread.id}`, { token: other.token, body: { status: "open" } })
    expect(open.json.thread).toMatchObject({ status: "open", resolvedBy: null, resolvedAt: null })
  })

  test("only the thread author moves the pin", async () => {
    const s = await setup()
    const { author, thread } = await withThread(s)
    const moved = { ...anchor, point: { x: 90, y: 10 } }
    const other = await s.guest("Other")
    expect(
      (
        await s.request("PATCH", `/api/threads/${thread.id}`, {
          token: other.token,
          body: { page: "/", anchor: moved },
        })
      ).status,
    ).toBe(403)
    const res = await s.request("PATCH", `/api/threads/${thread.id}`, {
      token: author.token,
      body: { page: "/", anchor: moved },
    })
    expect(res.json.thread).toMatchObject({ page: "/", anchor: moved })
  })

  test("a thread of another project is not found", async () => {
    const s = await setup()
    const { thread } = await withThread(s)
    const other = await s.guest("B", "https://other.test", "other")
    const res = await s.request("POST", `/api/threads/${thread.id}/comments`, {
      token: other.token,
      origin: "https://other.test",
      body: { body: text("x") },
    })
    expect(res.status).toBe(404)
  })
})

describe("comment body", () => {
  const bad: [string, unknown][] = [
    ["an unknown node", { type: "doc", content: [{ type: "script", content: [] }] }],
    [
      "an unknown mark",
      {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "font" }] }] }],
      },
    ],
    [
      "a javascript: link",
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
          },
        ],
      },
    ],
    ["an empty comment", { type: "doc", content: [{ type: "paragraph" }] }],
    ["a very long comment", text("x".repeat(10_001))],
  ]
  for (const [name, body] of bad) {
    test(`${name} is rejected`, async () => {
      const s = await setup()
      const { token } = await s.guest()
      const res = await s.request("POST", "/api/threads", { token, body: { page: "/", anchor, body } })
      expect(res.status).toBe(400)
    })
  }

  test("rich text is kept, unknown attributes are dropped", async () => {
    const s = await setup()
    const { token } = await s.guest()
    const body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " " },
            {
              type: "text",
              text: "site",
              marks: [{ type: "link", attrs: { href: "https://x.test", onclick: "evil()" } }],
            },
          ],
        },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] }],
        },
      ],
    }
    const res = await s.request("POST", "/api/threads", { token, body: { page: "/", anchor, body } })
    expect(res.status).toBe(200)
    const stored = res.json.thread.comments[0]
    expect(stored.body.content[0].content[2].marks[0].attrs).toEqual({ href: "https://x.test" })
    expect(stored.text).toBe("bold site\nitem")
  })
})

describe("rate limit", () => {
  test("a user can add 100 comments per hour", async () => {
    let now = Date.UTC(2025, 0, 1)
    const s = await setup({ now: () => now })
    const { author, thread } = await withThread(s)
    for (let i = 0; i < 99; i++) {
      const res = await s.request("POST", `/api/threads/${thread.id}/comments`, {
        token: author.token,
        body: { body: text(`c${i}`) },
      })
      expect(res.status).toBe(200)
    }
    const over = await s.request("POST", `/api/threads/${thread.id}/comments`, {
      token: author.token,
      body: { body: text("over") },
    })
    expect(over.status).toBe(429)
    now += 60 * 60 * 1000 + 1
    const later = await s.request("POST", `/api/threads/${thread.id}/comments`, {
      token: author.token,
      body: { body: text("later") },
    })
    expect(later.status).toBe(200)
  })
})

describe("revisions", () => {
  test("every change gives the thread a higher updatedAt, also in the same millisecond", async () => {
    const s = await setup({ now: () => 1_000 })
    const author = await s.guest("Author")
    const created = await s.request("POST", "/api/threads", {
      token: author.token,
      body: { page: "/", anchor, body: text("x") },
    })
    const id = created.json.thread.id
    const commentId = created.json.thread.comments[0].id
    const a = await s.request("PUT", `/api/comments/${commentId}/reactions/${encodeURIComponent("👍")}`, {
      token: author.token,
    })
    const b = await s.request("POST", `/api/threads/${id}/comments`, { token: author.token, body: { body: text("y") } })
    const c = await s.request("PATCH", `/api/threads/${id}`, { token: author.token, body: { status: "resolved" } })
    const revisions = [created, a, b, c].map((r) => r.json.thread.updatedAt)
    expect(revisions).toEqual([1_000, 1_001, 1_002, 1_003])
  })
})

test("the server keeps every anchor field the widget sends", async () => {
  const s = await setup()
  const author = await s.guest("Author")
  const full = {
    ...anchor,
    twins: 2,
    fingerprint: "a1b2c3d4",
    repeated: true,
    scope: { depth: 1, hash: "9f8e7d6c" },
    card: { depth: 2, urls: ["1a2b3c4d"], all: true, text: true },
  }
  const res = await s.request("POST", "/api/threads", {
    token: author.token,
    body: { page: "/", anchor: full, body: text("x") },
  })
  expect(res.json.thread.anchor).toEqual(full)
})

describe("page context", () => {
  const context = {
    url: "https://acme.test/pricing?plan=pro",
    title: "Pricing | Acme",
    viewport: { width: 820, height: 1180 },
    dpr: 2,
    browser: "Safari 17",
    os: "iPadOS",
  }

  test("a thread keeps where it was made: URL, title, screen and browser", async () => {
    const s = await setup()
    const { token } = await s.guest()
    const res = await s.request("POST", "/api/threads", {
      token,
      body: { page: "/pricing", anchor, body: text("Wraps on tablets"), context },
    })
    expect(res.status).toBe(200)
    expect(res.json.thread.context).toEqual(context)
    const list = await s.request("GET", "/api/threads", { token })
    expect(list.json.threads[0].context).toEqual(context)
  })

  test("the context is optional, and only http links are kept", async () => {
    const s = await setup()
    const { token } = await s.guest()
    const plain = await s.request("POST", "/api/threads", { token, body: { page: "/", anchor, body: text("x") } })
    expect(plain.json.thread.context).toBeNull()
    const bad = await s.request("POST", "/api/threads", {
      token,
      body: { page: "/", anchor, body: text("x"), context: { ...context, url: "javascript:alert(1)" } },
    })
    expect(bad.status).toBe(400)
  })

  test("a database made before the context column gets it", async () => {
    const db = createClient({ url: ":memory:" })
    await db.execute(`create table threads (
      id text primary key, project text not null, page text not null, anchor text not null,
      status text not null default 'open', created_by text not null, created_at integer not null,
      updated_at integer not null, resolved_at integer, resolved_by text)`)
    await migrate(db, true)
    const columns = (await db.execute("select name from pragma_table_info('threads')")).rows.map((r) => r.name)
    expect(columns).toContain("context")
    expect(columns).toContain("assignee_id")
  })
})

describe("assignee", () => {
  test("a member assigns a thread to someone; it becomes unread for them; null unassigns", async () => {
    const s = await setup()
    const { author, thread } = await withThread(s)
    const bob = await s.guest("Bob")
    // Bob reads the thread, so only the assignment makes it unread again.
    await s.request("POST", `/api/threads/${thread.id}/read`, { token: bob.token, body: { read: true } })

    const assign = await s.request("PATCH", `/api/threads/${thread.id}`, {
      token: author.token,
      body: { assignee: bob.user.id },
    })
    expect(assign.status).toBe(200)
    expect(assign.json.thread.assigneeId).toBe(bob.user.id)
    expect(assign.json.users[bob.user.id]).toMatchObject({ name: "Bob" })

    const forBob = await s.request("GET", "/api/threads", { token: bob.token })
    expect(forBob.json.threads[0]).toMatchObject({ assigneeId: bob.user.id, unread: true })

    const unassign = await s.request("PATCH", `/api/threads/${thread.id}`, {
      token: bob.token,
      body: { assignee: null },
    })
    expect(unassign.json.thread.assigneeId).toBeNull()
  })

  test("only people of the same project can be assigned", async () => {
    const s = await setup()
    const { author, thread } = await withThread(s)
    const stranger = await s.guest("Stranger", OTHER, "other")
    const res = await s.request("PATCH", `/api/threads/${thread.id}`, {
      token: author.token,
      body: { assignee: stranger.user.id },
    })
    expect(res.status).toBe(400)
  })
})
