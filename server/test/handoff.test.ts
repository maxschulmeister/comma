// Sign-in through the app: the app runs comma with identify(). Other sites of the project open the app in a popup,
// and comma in the app hands the signed-in user over (see `appUrl` in README.md).
import { describe, expect, test } from "bun:test"
import { sign } from "hono/jwt"
import type { Config } from "../src/config"
import { setup } from "./helpers"

const APP = "https://app.suite.test"
const SITE = "https://www.suite.test"

const suite: Config = {
  projects: [
    { id: "suite", name: "Suite", origins: [APP, SITE], appSecret: "suite-secret", appUrl: `${APP}/`, guests: true },
    { id: "plain", origins: ["https://plain.test"], appSecret: "plain-secret", guests: true },
  ],
}

async function signedInApp() {
  const t = await setup({ config: suite })
  const appToken = await sign(
    { sub: "u-1", name: "Grace", exp: Math.floor(Date.now() / 1000) + 60 },
    "suite-secret",
    "HS256",
  )
  const res = await t.request("POST", "/api/session/app", { origin: APP, body: { project: "suite", appToken } })
  return { ...t, app: res.json as { token: string; user: { id: string } } }
}

describe("sign-in through the app", () => {
  test("the app hands its signed-in user over to another site of the project", async () => {
    const { request, app } = await signedInApp()
    const handoff = await request("POST", "/api/session/handoff", {
      origin: APP,
      token: app.token,
      body: { origin: SITE },
    })
    expect(handoff.status).toBe(200)
    const claim = await request("POST", "/api/session/claim", {
      origin: SITE,
      body: { project: "suite", handoff: handoff.json.handoff },
    })
    expect(claim.status).toBe(200)
    expect(claim.json.user).toMatchObject({ id: app.user.id, name: "Grace", kind: "app" })
    // The new session is the site's own: it works there.
    expect((await request("GET", "/api/threads", { origin: SITE, token: claim.json.token })).status).toBe(200)
    expect(claim.json.token).not.toBe(app.token)
  })

  test("only comma in the app hands over, only app users, and only to a site of the project", async () => {
    const { request, guest, app } = await signedInApp()
    const ask = (origin: string, token: string, target: string) =>
      request("POST", "/api/session/handoff", { origin, token, body: { origin: target } })
    // From another site of the project: not the app.
    expect((await ask(SITE, app.token, SITE)).status).toBe(403)
    // A guest: the app did not name them.
    const g = await guest("Ghost", APP, "suite")
    expect((await ask(APP, g.token, SITE)).status).toBe(403)
    // A site that is not in the project.
    expect((await ask(APP, app.token, "https://evil.test")).status).toBe(403)
  })

  test("a hand-over works only on the site it names, for one minute", async () => {
    let time = Date.now()
    const t = await setup({ config: suite, now: () => time })
    const appToken = await sign(
      { sub: "u-1", name: "Grace", exp: Math.floor(time / 1000) + 60 },
      "suite-secret",
      "HS256",
    )
    const { token } = (
      await t.request("POST", "/api/session/app", { origin: APP, body: { project: "suite", appToken } })
    ).json
    const { handoff } = (
      await t.request("POST", "/api/session/handoff", { origin: APP, token, body: { origin: SITE } })
    ).json
    const claim = (origin: string, project = "suite") =>
      t.request("POST", "/api/session/claim", { origin, body: { project, handoff } })
    expect((await claim(APP)).status).toBe(401)
    // Another project: it has no sign-in through the app.
    expect((await claim("https://plain.test", "plain")).status).toBe(404)
    time += 61_000
    expect((await claim(SITE)).status).toBe(401)
  })

  test("a project without appUrl has no hand-over; the widget learns appUrl from the project info", async () => {
    const t = await setup({ config: suite })
    const g = await t.guest("Ghost", "https://plain.test", "plain")
    const res = await t.request("POST", "/api/session/handoff", {
      origin: "https://plain.test",
      token: g.token,
      body: { origin: "https://plain.test" },
    })
    expect(res.status).toBe(404)
    const info = await t.request("GET", "/api/projects/suite", { origin: SITE })
    expect(info.json).toMatchObject({ popupSignIn: true, appUrl: `${APP}/` })
    expect(
      (await t.request("GET", "/api/projects/plain", { origin: "https://plain.test" })).json.appUrl,
    ).toBeUndefined()
  })

  test("appUrl must be a site of the project with app sign-in, and not with signInUrl", async () => {
    const project = { id: "x", origins: [SITE], appSecret: "s" }
    const bad: [string, object][] = [
      ["not a site of the project", { ...project, appUrl: `${APP}/` }],
      ["without app sign-in", { id: "x", origins: [APP], appUrl: `${APP}/` }],
      ["with signInUrl", { ...project, origins: [APP], appUrl: `${APP}/`, signInUrl: `${APP}/comma` }],
    ]
    for (const [, p] of bad) {
      await expect(setup({ config: { projects: [p] } as Config })).rejects.toThrow()
    }
  })
})
