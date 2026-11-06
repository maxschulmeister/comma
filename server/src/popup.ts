// Popup sign-in on sites other than the app:
// widget opens /auth/start → app sign-in URL → app redirects to /auth/callback with a signed app token
// → the callback page sends a comma session to the widget with postMessage and closes.
import { Hono } from "hono"
import { html, raw } from "hono/html"
import { sign, verify } from "hono/jwt"
import type { User } from "./auth"
import type { Project } from "./config"

type Options = {
  projects: Map<string, Project>
  secret: string
  session: (project: Project, appToken: string) => Promise<{ token: string; user: User } | null>
}

const STATE_SECONDS = 10 * 60

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

export function popupRoutes({ projects, secret, session }: Options) {
  const app = new Hono()

  app.get("/start", async (c) => {
    const project = projects.get(c.req.query("project") ?? "")
    const origin = c.req.query("origin") ?? ""
    if (!project?.signInUrl || !project.appSecret) return c.html(page("This project has no sign-in."), 404)
    if (!project.origins.includes(origin)) return c.html(page("This site is not allowed."), 403)
    const exp = Math.floor(Date.now() / 1000) + STATE_SECONDS
    const state = await sign({ prj: project.id, origin, exp, typ: "comma-state" }, secret, "HS256")
    const url = new URL(project.signInUrl)
    url.searchParams.set("redirect_uri", new URL("/auth/callback", c.req.url).href)
    url.searchParams.set("state", state)
    return c.redirect(url.href, 302)
  })

  app.get("/callback", async (c) => {
    let state: { prj: string; origin: string }
    try {
      const payload = await verify(c.req.query("state") ?? "", secret, "HS256")
      if (payload.typ !== "comma-state" || typeof payload.prj !== "string" || typeof payload.origin !== "string")
        throw 0
      state = { prj: payload.prj, origin: payload.origin }
    } catch {
      return c.html(page("Sign-in expired. Close this window and try again."), 400)
    }
    const project = projects.get(state.prj)
    if (!project?.origins.includes(state.origin)) return c.html(page("This site is not allowed."), 403)
    const result = await session(project, c.req.query("token") ?? "")
    if (!result) return c.html(page("Sign-in failed. Close this window and try again."), 401)
    const message = JSON.stringify({ type: "comma:session", project: project.id, ...result }).replace(/</g, "\\u003c")
    const target = JSON.stringify(state.origin)
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
  })

  return app
}
