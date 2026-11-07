// Popup sign-in on sites other than the app. Two ways, both end the same: the callback page sends a comma session
// to the widget with postMessage and closes.
// - App: /auth/start → app sign-in URL → app redirects to /auth/callback with a signed app token.
// - Slack: /auth/slack/start → Slack (OpenID Connect) → /auth/slack/callback with a code. comma asks Slack who it is.
import { type Context, Hono } from "hono"
import { html, raw } from "hono/html"
import { sign, verify } from "hono/jwt"
import { z } from "zod"
import type { User } from "./auth"
import { allowsOrigin, type Project } from "./config"

type Result = { token: string; user: User }
export type SlackProfile = { id: string; name: string; email?: string; avatar?: string }

type Options = {
  projects: Map<string, Project>
  secret: string
  session: (project: Project, appToken: string) => Promise<Result | null>
  slackSession: (project: Project, profile: SlackProfile) => Promise<Result>
  /** The address users reach comma at (behind a proxy). Default: the address of the request. */
  publicUrl?: string
  /** Slack's address. Tests use a fake. */
  slackUrl?: string
}

const STATE_SECONDS = 10 * 60
const SLACK_TIMEOUT_MS = 10_000

// The answer of Slack's `openid.connect.userInfo`.
const SlackUser = z.object({
  ok: z.literal(true),
  sub: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  email: z.email().max(200).optional(),
  picture: z
    .url({ protocol: /^https$/ })
    .max(2000)
    .optional(),
  "https://slack.com/team_id": z.string(),
})

function page(title: string, script: unknown = "") {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <style>
          body { font: 14px/1.5 system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; color: #18181b; }
        </style>
      </head>
      <body>
        <p>${title}</p>
        ${script}
      </body>
    </html>`
}

export function popupRoutes({ projects, secret, session, slackSession, publicUrl, slackUrl }: Options) {
  const app = new Hono()
  const slackBase = slackUrl ?? "https://slack.com"
  const callbackUrl = (c: Context, path: string) => new URL(path, publicUrl ?? c.req.url).href

  // The state carries the project and the site through the sign-in. Signed, so nobody can change the site.
  const newState = (project: Project, origin: string, typ: string) =>
    sign({ prj: project.id, origin, exp: Math.floor(Date.now() / 1000) + STATE_SECONDS, typ }, secret, "HS256")

  const readState = async (c: Context, typ: string) => {
    try {
      const payload = await verify(c.req.query("state") ?? "", secret, "HS256")
      if (payload.typ !== typ || typeof payload.prj !== "string" || typeof payload.origin !== "string") return null
      const project = projects.get(payload.prj)
      return project && allowsOrigin(project, payload.origin) ? { project, origin: payload.origin } : null
    } catch {
      return null
    }
  }

  const finish = (c: Context, project: Project, origin: string, result: Result) => {
    const message = JSON.stringify({ type: "comma:session", project: project.id, ...result }).replace(/</g, "\\u003c")
    const target = JSON.stringify(origin)
    c.header("cache-control", "no-store")
    c.header("referrer-policy", "no-referrer")
    return c.html(
      page(
        "Signed in. You can close this window.",
        html`<script>
          if (window.opener) window.opener.postMessage(${raw(message)}, ${raw(target)});
          window.close();
        </script>`,
      ),
    )
  }

  const expired = (c: Context) => c.html(page("Sign-in expired. Close this window and try again."), 400)
  const failed = (c: Context) => c.html(page("Sign-in failed. Close this window and try again."), 401)

  app.get("/start", async (c) => {
    const project = projects.get(c.req.query("project") ?? "")
    const origin = c.req.query("origin") ?? ""
    if (!project?.signInUrl || !project.appSignIn) return c.html(page("This project has no sign-in."), 404)
    if (!allowsOrigin(project, origin)) return c.html(page("This site is not allowed."), 403)
    const url = new URL(project.signInUrl)
    url.searchParams.set("redirect_uri", callbackUrl(c, "/auth/callback"))
    url.searchParams.set("state", await newState(project, origin, "comma-state"))
    return c.redirect(url.href, 302)
  })

  app.get("/callback", async (c) => {
    const state = await readState(c, "comma-state")
    if (!state) return expired(c)
    const result = await session(state.project, c.req.query("token") ?? "")
    if (!result) return failed(c)
    return finish(c, state.project, state.origin, result)
  })

  app.get("/slack/start", async (c) => {
    const project = projects.get(c.req.query("project") ?? "")
    const origin = c.req.query("origin") ?? ""
    if (!project?.slack) return c.html(page("This project has no Slack sign-in."), 404)
    if (!allowsOrigin(project, origin)) return c.html(page("This site is not allowed."), 403)
    const url = new URL("/openid/connect/authorize", slackBase)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("scope", "openid profile email")
    url.searchParams.set("client_id", project.slack.clientId)
    url.searchParams.set("team", project.slack.team)
    url.searchParams.set("redirect_uri", callbackUrl(c, "/auth/slack/callback"))
    url.searchParams.set("state", await newState(project, origin, "comma-slack"))
    return c.redirect(url.href, 302)
  })

  app.get("/slack/callback", async (c) => {
    const state = await readState(c, "comma-slack")
    const slack = state?.project.slack
    if (!state || !slack) return expired(c)
    // Server to Slack: the code and the client secret give an access token, the token gives the user.
    const user = await (async () => {
      try {
        const token = await fetch(new URL("/api/openid.connect.token", slackBase), {
          method: "POST",
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: c.req.query("code") ?? "",
            client_id: slack.clientId,
            client_secret: slack.clientSecret,
            redirect_uri: callbackUrl(c, "/auth/slack/callback"),
          }),
          signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
        }).then((r) => r.json())
        if (token?.ok !== true || typeof token.access_token !== "string") return null
        const info = await fetch(new URL("/api/openid.connect.userInfo", slackBase), {
          headers: { authorization: `Bearer ${token.access_token}` },
          signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
        }).then((r) => r.json())
        const parsed = SlackUser.safeParse(info)
        return parsed.success ? parsed.data : null
      } catch {
        return null
      }
    })()
    if (!user) return failed(c)
    if (user["https://slack.com/team_id"] !== slack.team) {
      return c.html(page("Sign in with your account of the team's Slack workspace."), 403)
    }
    const result = await slackSession(state.project, {
      id: user.sub,
      name: user.name,
      email: user.email,
      avatar: user.picture,
    })
    return finish(c, state.project, state.origin, result)
  })

  return app
}
