import { afterAll, describe, expect, test } from "bun:test"
import type { Config } from "../src/config"
import { ACME, OTHER, setup } from "./helpers"

// A fake Slack: the token and user info endpoints of "Sign in with Slack" (OpenID Connect).
const TEAM = "T0ACME"
const users: Record<string, Record<string, unknown>> = {
  "code-grace": { sub: "U1", name: "Grace Hopper", email: "grace@acme.test", picture: "https://slack.test/g.png" },
  "code-outsider": { sub: "U9", name: "Mallory", email: "m@evil.test", "https://slack.com/team_id": "T0EVIL" },
}
const slack = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/api/openid.connect.token") {
      const form = await req.formData()
      const code = String(form.get("code"))
      const ok =
        form.get("client_id") === "client-1" &&
        form.get("client_secret") === "secret-1" &&
        form.get("redirect_uri") === "http://comma.test/auth/slack/callback" &&
        code in users
      return Response.json(ok ? { ok: true, access_token: `token-${code}` } : { ok: false, error: "invalid_code" })
    }
    if (url.pathname === "/api/openid.connect.userInfo") {
      const code = (req.headers.get("authorization") ?? "").replace("Bearer token-", "")
      const user = users[code]
      if (!user) return Response.json({ ok: false, error: "invalid_auth" })
      return Response.json({ ok: true, "https://slack.com/team_id": TEAM, email_verified: true, ...user })
    }
    return new Response("not found", { status: 404 })
  },
})
afterAll(() => slack.stop())

const config: Config = {
  projects: [
    { id: "acme", origins: [ACME], slack: { clientId: "client-1", clientSecret: "secret-1", team: TEAM } },
    { id: "other", origins: [OTHER] },
  ],
}

async function start(s: Awaited<ReturnType<typeof setup>>, project = "acme", origin = ACME) {
  const query = new URLSearchParams({ project, origin })
  return s.app.fetch(new Request(`http://comma.test/auth/slack/start?${query}`))
}

async function callback(s: Awaited<ReturnType<typeof setup>>, code: string, state: string) {
  const query = new URLSearchParams({ code, state })
  const res = await s.app.fetch(new Request(`http://comma.test/auth/slack/callback?${query}`))
  const html = await res.text()
  const token = /"token":"([^"]+)"/.exec(html)?.[1]
  return { status: res.status, html, token }
}

const stateOf = (res: Response) => new URL(res.headers.get("location") ?? "").searchParams.get("state") ?? ""

describe("Sign in with Slack", () => {
  test("start sends the popup to Slack, for the project's workspace", async () => {
    const s = await setup({ config, slackUrl: slack.url.origin })
    const res = await start(s)
    expect(res.status).toBe(302)
    const to = new URL(res.headers.get("location") ?? "")
    expect(`${to.origin}${to.pathname}`).toBe(`${slack.url.origin}/openid/connect/authorize`)
    expect(Object.fromEntries(to.searchParams)).toMatchObject({
      response_type: "code",
      scope: "openid profile email",
      client_id: "client-1",
      team: TEAM,
      redirect_uri: "http://comma.test/auth/slack/callback",
    })
  })

  test("the callback signs in the Slack user and sends the session to the site", async () => {
    const s = await setup({ config, slackUrl: slack.url.origin })
    const first = await callback(s, "code-grace", stateOf(await start(s)))
    expect(first.status).toBe(200)
    expect(first.html).toContain(JSON.stringify(ACME))
    expect(first.token).toBeDefined()
    const threads = await s.request("GET", "/api/threads", { token: first.token })
    expect(threads.status).toBe(200)
    expect(threads.json.me).toMatchObject({ name: "Grace Hopper", kind: "app", avatarUrl: "https://slack.test/g.png" })
    // The same Slack user is the same comma user next time.
    const again = await callback(s, "code-grace", stateOf(await start(s)))
    const me = (await s.request("GET", "/api/threads", { token: again.token })).json.me
    expect(me.id).toBe(threads.json.me.id)
  })

  test("a user of another workspace is refused", async () => {
    const s = await setup({ config, slackUrl: slack.url.origin })
    const res = await callback(s, "code-outsider", stateOf(await start(s)))
    expect(res.status).toBe(403)
    expect(res.token).toBeUndefined()
  })

  test("a bad code or a bad state is refused", async () => {
    const s = await setup({ config, slackUrl: slack.url.origin })
    expect((await callback(s, "code-wrong", stateOf(await start(s)))).status).toBe(401)
    expect((await callback(s, "code-grace", "forged")).status).toBe(400)
  })

  test("only the project's origins, and only projects with Slack", async () => {
    const s = await setup({ config, slackUrl: slack.url.origin })
    expect((await start(s, "acme", "https://evil.test")).status).toBe(403)
    expect((await start(s, "other", OTHER)).status).toBe(404)
  })

  test("the widget learns that the project has Slack; Slack does not change guests", async () => {
    const s = await setup({ config, slackUrl: slack.url.origin })
    expect((await s.request("GET", "/api/projects/acme")).json).toMatchObject({ slack: true, guests: true })
    expect((await s.request("GET", "/api/projects/other", { origin: OTHER })).json).toMatchObject({ slack: false })
  })
})
