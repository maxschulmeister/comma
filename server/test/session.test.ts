import { describe, expect, test } from "bun:test"
import { sign } from "hono/jwt"
import { ACME, appToken_, OTHER, setup } from "./helpers"

describe("guest session", () => {
  test("a guest gets a session token that works for the API", async () => {
    const { guest, request } = setup()
    const { token, user } = await guest("Ada")
    expect(user).toMatchObject({ name: "Ada", kind: "guest" })
    const res = await request("GET", "/api/threads", { token })
    expect(res.status).toBe(200)
    expect(res.json.me).toMatchObject({ id: user.id, name: "Ada" })
  })

  test("a guest needs a name", async () => {
    const { request } = setup()
    const res = await request("POST", "/api/session/guest", { body: { project: "acme", name: "  " } })
    expect(res.status).toBe(400)
  })

  test("an unknown project fails", async () => {
    const { request } = setup()
    const res = await request("POST", "/api/session/guest", { body: { project: "nope", name: "Ada" } })
    expect(res.status).toBe(404)
  })

  test("an origin not registered for the project fails", async () => {
    const { request } = setup()
    const res = await request("POST", "/api/session/guest", { origin: OTHER, body: { project: "acme", name: "Ada" } })
    expect(res.status).toBe(403)
  })
})

describe("app session", () => {
  test("a valid app token gives a session with the app user", async () => {
    const { appUser } = setup()
    const { user } = await appUser({
      sub: "u-1",
      name: "Grace",
      email: "grace@acme.test",
      avatar: "https://acme.test/g.png",
    })
    expect(user).toMatchObject({ name: "Grace", kind: "app", avatarUrl: "https://acme.test/g.png", isAdmin: false })
  })

  test("the same app user gets the same comma user, with new details", async () => {
    const { appUser } = setup()
    const a = await appUser({ sub: "u-1", name: "Grace" })
    const b = await appUser({ sub: "u-1", name: "Grace Hopper", admin: true })
    expect(b.user.id).toBe(a.user.id)
    expect(b.user).toMatchObject({ name: "Grace Hopper", isAdmin: true })
  })

  const cases: [string, () => Promise<string>][] = [
    ["a bad signature", () => appToken_({ sub: "u", name: "X" }, "wrong")],
    ["an expired token", () => sign({ sub: "u", name: "X", exp: Math.floor(Date.now() / 1000) - 10 }, "acme-secret")],
    ["a token without expiry", () => sign({ sub: "u", name: "X" }, "acme-secret")],
    [
      "a token that expires after more than 5 minutes",
      () => appToken_({ sub: "u", name: "X", exp: Math.floor(Date.now() / 1000) + 3600 }),
    ],
    ["a token for another project", () => appToken_({ sub: "u", name: "X" }, "other-secret")],
    ["a token without a name", () => appToken_({ sub: "u" })],
  ]
  for (const [name, make] of cases) {
    test(`${name} fails`, async () => {
      const { request } = setup()
      const res = await request("POST", "/api/session/app", { body: { project: "acme", appToken: await make() } })
      expect(res.status).toBe(401)
    })
  }

  test("a project without an app secret has no app sign-in", async () => {
    const { request } = setup()
    const appToken = await appToken_({ sub: "u", name: "X" }, "other-secret")
    const res = await request("POST", "/api/session/app", { origin: OTHER, body: { project: "nope", appToken } })
    expect(res.status).toBe(404)
  })
})

describe("session token", () => {
  test("the API needs a session token", async () => {
    const { request } = setup()
    expect((await request("GET", "/api/threads")).status).toBe(401)
    expect((await request("GET", "/api/threads", { token: "garbage" })).status).toBe(401)
  })

  test("a session token only works from the origins of its project", async () => {
    const { guest, request } = setup()
    const { token } = await guest()
    expect((await request("GET", "/api/threads", { token, origin: OTHER })).status).toBe(403)
    expect((await request("GET", "/api/threads", { token, origin: "http://localhost:3000" })).status).toBe(200)
  })

  test("a session token of one project does not show another project's data", async () => {
    const { guest, request } = setup()
    const acme = await guest("A")
    const other = await guest("B", OTHER, "other")
    await request("POST", "/api/threads", {
      token: acme.token,
      body: { page: "/", anchor: (await import("./helpers")).anchor, body: (await import("./helpers")).text("hi") },
    })
    const res = await request("GET", "/api/threads", { token: other.token, origin: OTHER })
    expect(res.json.threads).toEqual([])
  })
})

describe("CORS", () => {
  test("preflight allows registered origins only", async () => {
    const { app } = setup()
    const preflight = (origin: string) =>
      app.fetch(
        new Request("http://comma.test/api/threads", {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": "POST",
            "access-control-request-headers": "authorization,content-type",
          },
        }),
      )
    const ok = await preflight(ACME)
    expect(ok.headers.get("access-control-allow-origin")).toBe(ACME)
    expect(ok.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization")
    const bad = await preflight("https://evil.test")
    expect(bad.headers.get("access-control-allow-origin")).toBeNull()
  })

  test("responses name the request origin", async () => {
    const { guest, request } = setup()
    const { token } = await guest()
    const res = await request("GET", "/api/threads", { token })
    expect(res.headers.get("access-control-allow-origin")).toBe(ACME)
    expect(res.headers.get("vary")).toContain("Origin")
  })
})
