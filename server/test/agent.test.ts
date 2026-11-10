// A coding agent works on the comments: it connects, a person allows it in the widget, then it reads the comments
// and replies as that person (see /llms.txt).
import { describe, expect, test } from "bun:test"
import { ACME, anchor, type Json, OTHER, PREVIEW_A, PREVIEW_B, setup, text, upload } from "./helpers"

type T = Awaited<ReturnType<typeof setup>>

/** The agent asks to connect. */
const connect = (t: T, body: Json = { project: "acme" }) => t.request("POST", "/agent/connect", { origin: null, body })

/** The agent asks for its token. */
const poll = (t: T, secret: string) => t.request("POST", "/agent/token", { origin: null, body: { secret } })

/** The person answers in the widget. */
const answer = (t: T, token: string, code: string, allow = true, origin = ACME) =>
  t.request("POST", "/api/agent/connect", { token, origin, body: { code, allow } })

/** A connected agent of a new guest, with one thread on /pricing. */
async function connected(t: T) {
  const person = await t.guest("Ada")
  const created = await t.request("POST", "/api/threads", {
    token: person.token,
    body: { page: "/pricing", anchor, body: text("Make this bigger") },
  })
  const { code, secret } = (await connect(t)).json
  await answer(t, person.token, code)
  const { token } = (await poll(t, secret)).json
  return { person, token: token as string, threadId: created.json.thread.id as string }
}

describe("agent connect", () => {
  test("a person allows the agent, then the agent reads the open comments", async () => {
    const t = await setup()
    const person = await t.guest("Ada")
    await t.request("POST", "/api/threads", {
      token: person.token,
      body: { page: "/pricing", anchor, body: text("Make this bigger") },
    })

    const started = await connect(t)
    expect(started.status).toBe(200)
    expect(started.json.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(started.json.url).toBe(`http://comma.test/connect/${started.json.code}`)
    expect((await poll(t, started.json.secret)).status).toBe(202)

    expect((await answer(t, person.token, started.json.code)).status).toBe(200)
    const granted = await poll(t, started.json.secret)
    expect(granted.status).toBe(200)
    expect(granted.json.user.name).toBe("Ada")

    const threads = await t.request("GET", "/agent/threads", { origin: null, token: granted.json.token })
    expect(threads.status).toBe(200)
    expect(threads.headers.get("content-type")).toContain("text/markdown")
    expect(threads.text).toContain("Make this bigger")
    expect(threads.text).toContain("https://acme.test/pricing")
  })

  test("when the person says no, the agent gets no token", async () => {
    const t = await setup()
    const person = await t.guest("Ada")
    const { code, secret } = (await connect(t)).json
    expect((await answer(t, person.token, code, false)).status).toBe(200)
    expect((await poll(t, secret)).status).toBe(410)
    // The request is gone: nobody can allow it later.
    expect((await answer(t, person.token, code)).status).toBe(404)
  })

  test("the person has 10 minutes to answer", async () => {
    let time = Date.now()
    const t = await setup({ now: () => time })
    const person = await t.guest("Ada")
    const { code, secret } = (await connect(t)).json
    time += 11 * 60 * 1000
    expect((await answer(t, person.token, code)).status).toBe(404)
    expect((await poll(t, secret)).status).toBe(410)
  })

  test("the agent gets the token once", async () => {
    const t = await setup()
    const person = await t.guest("Ada")
    const { code, secret } = (await connect(t)).json
    await answer(t, person.token, code)
    expect((await poll(t, secret)).status).toBe(200)
    expect((await poll(t, secret)).status).toBe(410)
  })

  test("only people of the project can allow, and only an agent knows the secret", async () => {
    const t = await setup()
    const other = await t.guest("Eve", OTHER, "other")
    const { code, secret } = (await connect(t)).json
    expect((await answer(t, other.token, code, true, OTHER)).status).toBe(404)
    expect((await poll(t, "wrong")).status).toBe(410)
    expect((await poll(t, secret)).status).toBe(202)
  })

  test("with scope origin, the agent sees the comments of the site where the person allowed it", async () => {
    const t = await setup()
    const ada = await t.guest("Ada", PREVIEW_A, "previews")
    const bob = await t.guest("Bob", PREVIEW_B, "previews")
    for (const [person, origin, words] of [
      [ada, PREVIEW_A, "On A"],
      [bob, PREVIEW_B, "On B"],
    ] as const) {
      await t.request("POST", "/api/threads", {
        token: person.token,
        origin,
        body: { page: "/", anchor, body: text(words) },
      })
    }
    const { code, secret } = (await connect(t, { project: "previews" })).json
    await answer(t, ada.token, code, true, PREVIEW_A)
    const granted = (await poll(t, secret)).json
    expect(granted.site).toBe("feat-a.preview.test")
    const threads = await t.request("GET", "/agent/threads", { origin: null, token: granted.token })
    expect(threads.text).toContain("On A")
    expect(threads.text).not.toContain("On B")
    expect(threads.text).toContain("https://feat-a.preview.test/")
  })

  test("a project gets 60 requests to connect per hour", async () => {
    const t = await setup()
    for (let i = 0; i < 60; i++) expect((await connect(t)).status).toBe(200)
    expect((await connect(t)).status).toBe(429)
    expect((await connect(t, { project: "open" })).status).toBe(200)
  })

  test("an unknown project cannot connect", async () => {
    const t = await setup()
    expect((await connect(t, { project: "nope" })).status).toBe(404)
  })
})

describe("instructions for agents", () => {
  test("/llms.txt and / tell the agent how to connect, with the address of this server", async () => {
    const t = await setup({ publicUrl: "https://comma.example.com" })
    for (const path of ["/llms.txt", "/"]) {
      const res = await t.request("GET", path, { origin: null })
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toContain("text/markdown")
      expect(res.text).toContain("data-project")
      expect(res.text).toContain("curl -X POST https://comma.example.com/agent/connect")
      expect(res.text).toContain("https://comma.example.com/agent/token")
      expect(res.text).toContain("https://comma.example.com/agent/threads")
    }
  })
})

describe("connect page", () => {
  const comment = (t: T, token: string, origin: string, page: string) =>
    t.request("POST", "/api/threads", { token, origin, body: { page, anchor, body: text("Hi") } })

  test("sends the person to the site with the open comments, to the page of the newest one", async () => {
    let time = Date.now()
    const t = await setup({ now: () => time++ })
    const person = await t.guest("Ada")
    await comment(t, person.token, ACME, "/pricing")
    await comment(t, person.token, ACME, "/about")
    const { code } = (await connect(t)).json
    const res = await t.request("GET", `/connect/${code}`, { origin: null })
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(`https://acme.test/about#comma-connect=${code}`)
  })

  test("with open comments on more sites, the person chooses one", async () => {
    const t = await setup()
    const person = await t.guest("Ada")
    await comment(t, person.token, ACME, "/")
    await comment(t, person.token, ACME, "/pricing")
    await comment(t, person.token, "http://localhost:3000", "/")
    const { code } = (await connect(t)).json
    const res = await t.request("GET", `/connect/${code}`, { origin: null })
    expect(res.status).toBe(200)
    expect(res.text).toContain(`href="https://acme.test/pricing#comma-connect=${code}"`)
    expect(res.text).toContain("acme.test · 2 open")
    expect(res.text).toContain(`href="http://localhost:3000/#comma-connect=${code}"`)
    expect(res.text).toContain("localhost:3000 · 1 open")
  })

  test("the agent can name the site", async () => {
    const t = await setup()
    const person = await t.guest("Ada")
    await comment(t, person.token, ACME, "/")
    const { code } = (await connect(t, { project: "acme", site: "http://localhost:3000/pricing" })).json
    const res = await t.request("GET", `/connect/${code}`, { origin: null })
    expect(res.headers.get("location")).toBe(`http://localhost:3000/#comma-connect=${code}`)
    expect((await connect(t, { project: "acme", site: "evil.test" })).status).toBe(400)
  })

  test("an unknown or expired request shows that it expired", async () => {
    const t = await setup()
    const res = await t.request("GET", "/connect/AAAA-BBBB", { origin: null })
    expect(res.status).toBe(404)
    expect(res.text).toContain("expired")
  })
})

describe("agent threads", () => {
  test("the open comments, with what the agent needs to find the code", async () => {
    const t = await setup({ now: () => Date.UTC(2026, 4, 2, 14, 3) })
    const ada = await t.guest("Ada")
    const bob = await t.guest("Bob")
    const shot = (await upload(t, ada.token)).json.id
    const thread = (
      await t.request("POST", "/api/threads", {
        token: ada.token,
        body: {
          page: "/pricing",
          anchor: { ...anchor, text: "Pricing\n  for teams", context: "Plans for teams" },
          body: text("Make this bigger"),
          screenshot: shot,
          context: {
            url: "https://acme.test/pricing?plan=pro",
            title: "Pricing · Acme",
            viewport: { width: 1440, height: 900 },
            dpr: 2,
            browser: "Chrome",
            os: "macOS",
            theme: "dark",
          },
        },
      })
    ).json.thread
    const image = (await upload(t, bob.token)).json.id
    await t.request("POST", `/api/threads/${thread.id}/comments`, {
      token: bob.token,
      body: { body: text("And use the brand color"), files: [image] },
    })
    await t.request("PATCH", `/api/threads/${thread.id}`, { token: ada.token, body: { assignee: bob.user.id } })
    const old = await t.request("POST", "/api/threads", {
      token: ada.token,
      body: { page: "/", anchor, body: text("Done long ago") },
    })
    await t.request("PATCH", `/api/threads/${old.json.thread.id}`, { token: ada.token, body: { status: "resolved" } })
    const { code, secret } = (await connect(t)).json
    await answer(t, ada.token, code)
    const { token } = (await poll(t, secret)).json

    const res = await t.request("GET", "/agent/threads", { origin: null, token })
    expect(res.text).toBe(
      [
        "# Open comments on Acme",
        "",
        "1 open comment. You act as Ada.",
        "",
        `Reply: \`curl -X POST http://comma.test/agent/threads/<thread id>/reply -H "Authorization: Bearer $COMMA_TOKEN" --data-binary "What you changed"\`. Do not resolve comments: people check the change and resolve them.`,
        "",
        "## 1. Make this bigger",
        "",
        `- Thread: ${thread.id}`,
        "- Page: https://acme.test/pricing?plan=pro (Pricing · Acme)",
        '- Element: `<h2>` "Pricing for teams"',
        '- Near: "Plans for teams"',
        "- Selector: `body > main > h2`",
        "- Window: 1440 × 900 at 2×, Chrome on macOS, dark theme",
        `- Screenshot: http://comma.test/files/${shot}`,
        "- Assigned to: Bob",
        `- Link: https://acme.test/pricing#comma=${thread.id}`,
        "",
        "Ada, 2026-05-02 14:03 UTC:",
        "> Make this bigger",
        "",
        "Bob, 2026-05-02 14:03 UTC:",
        "> And use the brand color",
        `> Image: http://comma.test/files/${image}`,
        "",
      ].join("\n"),
    )
  })

  test("without open comments, the agent is told so", async () => {
    const t = await setup()
    const person = await t.guest("Ada")
    const { code, secret } = (await connect(t)).json
    await answer(t, person.token, code)
    const { token } = (await poll(t, secret)).json
    const res = await t.request("GET", "/agent/threads", { origin: null, token })
    expect(res.text).toContain("No open comments.")
  })
})

describe("agent reply", () => {
  test("the reply shows in the thread as the person, with its lines", async () => {
    const t = await setup()
    const { person, token, threadId } = await connected(t)
    const res = await t.request("POST", `/agent/threads/${threadId}/reply`, {
      origin: null,
      token,
      raw: "Fixed in a1b2c3.\nThe button is 48 px high now.",
    })
    expect(res.status).toBe(200)
    const { threads } = (await t.request("GET", "/api/threads", { token: person.token })).json
    const reply = threads[0].comments[1]
    expect(reply.authorId).toBe(person.user.id)
    expect(reply.text).toBe("Fixed in a1b2c3.\nThe button is 48 px high now.")
    expect(reply.body).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Fixed in a1b2c3." }] },
        { type: "paragraph", content: [{ type: "text", text: "The button is 48 px high now." }] },
      ],
    })
  })

  test("an empty reply is refused", async () => {
    const t = await setup()
    const { token, threadId } = await connected(t)
    const res = await t.request("POST", `/agent/threads/${threadId}/reply`, { origin: null, token, raw: "  \n " })
    expect(res.status).toBe(400)
  })
})

describe("agent token", () => {
  test("cannot resolve, delete or do anything else in the widget API", async () => {
    const t = await setup()
    const { token, threadId } = await connected(t)
    const resolve = await t.request("PATCH", `/api/threads/${threadId}`, { token, body: { status: "resolved" } })
    expect(resolve.status).toBe(401)
    expect((await t.request("DELETE", `/api/threads/${threadId}`, { token })).status).toBe(401)
  })

  test("stops working when the person signs out", async () => {
    const t = await setup()
    const { person, token } = await connected(t)
    expect((await t.request("GET", "/agent/threads", { origin: null, token })).status).toBe(200)
    await t.request("DELETE", "/api/session", { token: person.token })
    expect((await t.request("GET", "/agent/threads", { origin: null, token })).status).toBe(401)
  })

  test("works for a day", async () => {
    let time = Date.now()
    const t = await setup({ now: () => time })
    const { token } = await connected(t)
    time += 23 * 60 * 60 * 1000
    expect((await t.request("GET", "/agent/threads", { origin: null, token })).status).toBe(200)
    time += 2 * 60 * 60 * 1000
    expect((await t.request("GET", "/agent/threads", { origin: null, token })).status).toBe(401)
  })
})
