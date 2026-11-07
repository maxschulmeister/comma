import { afterAll, describe, expect, test } from "bun:test"
import type { Config } from "../src/config"
import { ACME, setup } from "./helpers"

// The app's own API: it knows the user of an access token. comma asks it, the app needs no change.
const upstream = Bun.serve({
  port: 0,
  fetch(req) {
    const auth = req.headers.get("authorization")
    if (auth === "Bearer grace-token")
      return Response.json({ data: { uuid: "u-1", full_name: "Grace Hopper", email: "grace@acme.test" } })
    if (auth === "Bearer no-name-token") return Response.json({ data: { uuid: "u-2" } })
    if (auth === "Bearer no-id-token") return Response.json({ data: { full_name: "Nobody" } })
    if (auth === "Bearer broken-token") return new Response("down", { status: 503 })
    return Response.json({ detail: "Invalid token" }, { status: 401 })
  },
})
afterAll(() => upstream.stop())

const config = (userUrl: string): Config => ({
  projects: [
    {
      id: "api",
      origins: [ACME],
      userUrl,
      // biome-ignore lint/suspicious/noExplicitAny: the shape of the app's answer.
      user: (body: any) => ({ sub: body.data.uuid, name: body.data.full_name, email: body.data.email }),
    },
  ],
})

const identify = async (s: Awaited<ReturnType<typeof setup>>, appToken: string) =>
  s.request("POST", "/api/session/app", { body: { project: "api", appToken } })

describe("user URL: comma checks the app's access token with the app's API", () => {
  test("a token the app accepts signs in its user, the same comma user each time", async () => {
    const s = await setup({ config: config(`${upstream.url}me`) })
    const first = await identify(s, "grace-token")
    expect(first.status).toBe(200)
    expect(first.json.user).toMatchObject({ name: "Grace Hopper", kind: "app" })
    const second = await identify(s, "grace-token")
    expect(second.json.user.id).toBe(first.json.user.id)
    expect((await s.request("GET", "/api/threads", { token: second.json.token })).status).toBe(200)
  })

  test("a token the app refuses fails", async () => {
    const s = await setup({ config: config(`${upstream.url}me`) })
    const res = await identify(s, "stolen-token")
    expect(res.status).toBe(401)
  })

  test("an answer without the user's id or name fails", async () => {
    const s = await setup({ config: config(`${upstream.url}me`) })
    expect((await identify(s, "no-name-token")).status).toBe(401)
    expect((await identify(s, "no-id-token")).status).toBe(401)
  })

  test("if the app's API is down, the sign-in fails with 502, not 401", async () => {
    const s = await setup({ config: config(`${upstream.url}me`) })
    expect((await identify(s, "broken-token")).status).toBe(502)
    const unreachable = await setup({ config: config("http://127.0.0.1:1/me") })
    expect((await identify(unreachable, "grace-token")).status).toBe(502)
  })

  test("a project with a user URL has no guests by default", async () => {
    const s = await setup({ config: config(`${upstream.url}me`) })
    const res = await s.request("POST", "/api/session/guest", { body: { project: "api", name: "Ada" } })
    expect(res.status).toBe(403)
  })
})
