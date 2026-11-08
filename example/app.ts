// The example: a small site and app that use comma.
// - /, /pricing, /docs: pages with the comma script tag.
// - /login: the app's own sign-in (a name in a cookie). /app: signed-in page that calls comma.identify(token).
// - /comma-token: the one endpoint an app adds. It signs a short token with the project secret.
// - /comma-sign-in: popup sign-in for other sites (here: http://127.0.0.1:4100).
import { resolve } from "node:path"
import { sign } from "hono/jwt"

const port = Number(process.env.PORT ?? 4100)
const commaUrl = process.env.COMMA_URL ?? "http://localhost:4000"
const secret = process.env.EXAMPLE_APP_SECRET ?? ""
const pages = resolve(import.meta.dir, "pages")

if (!secret) console.warn("EXAMPLE_APP_SECRET is not set: app sign-in is off.")

const userOf = (req: Request) => {
  const match = /(?:^|;\s*)example_user=([^;]+)/.exec(req.headers.get("cookie") ?? "")
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

// The app token: JWT, HS256, project secret, expires in 2 minutes.
const appToken = (name: string) =>
  sign(
    {
      sub: `example:${name.toLowerCase()}`,
      name,
      admin: name.toLowerCase() === "admin",
      exp: Math.floor(Date.now() / 1000) + 120,
    },
    secret,
    "HS256",
  )

const html = (body: string, status = 200) =>
  new Response(body.replaceAll("{{COMMA_URL}}", commaUrl), {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  })

const loginPage = (next: string) =>
  html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in to Example</title><link rel="stylesheet" href="/style.css"></head>
<body><main class="narrow"><h1>Sign in to Example</h1>
<form method="post" action="/login"><input type="hidden" name="next" value="${next.replace(/"/g, "&quot;")}">
<label>Name <input name="name" required autofocus></label><button>Sign in</button></form></main></body></html>`)

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === "/login" && req.method === "POST") {
      const form = await req.formData()
      const name = String(form.get("name") ?? "")
        .trim()
        .slice(0, 60)
      const next = String(form.get("next") ?? "/app")
      if (!name) return loginPage(next)
      return new Response(null, {
        status: 303,
        headers: {
          location: next.startsWith("/") ? next : "/app",
          "set-cookie": `example_user=${encodeURIComponent(name)}; Path=/; HttpOnly; SameSite=Lax`,
        },
      })
    }
    if (url.pathname === "/login") return loginPage(url.searchParams.get("next") ?? "/app")
    if (url.pathname === "/logout") {
      return new Response(null, {
        status: 303,
        headers: { location: "/", "set-cookie": "example_user=; Path=/; Max-Age=0" },
      })
    }

    if (url.pathname === "/comma-token") {
      const user = userOf(req)
      if (!user || !secret) return Response.json({ error: "Not signed in" }, { status: 401 })
      return Response.json({ token: await appToken(user) })
    }

    if (url.pathname === "/comma-sign-in") {
      const redirect = url.searchParams.get("redirect_uri") ?? ""
      const state = url.searchParams.get("state") ?? ""
      // Only send tokens back to our comma server.
      if (redirect !== `${commaUrl}/auth/callback`) return new Response("Bad redirect_uri", { status: 400 })
      const user = userOf(req)
      if (!user) return loginPage(url.pathname + url.search)
      const back = new URL(redirect)
      back.searchParams.set("token", await appToken(user))
      back.searchParams.set("state", state)
      return Response.redirect(back.href, 302)
    }

    // `?project=<id>` changes the script tag, as on the test pages.
    if (url.pathname === "/app") {
      const user = userOf(req)
      if (!user)
        return Response.redirect(`${url.origin}/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302)
      const page = await Bun.file(resolve(pages, "app.html")).text()
      const project = url.searchParams.get("project")?.replace(/[^\w-]/g, "") ?? "example"
      return html(
        page
          .replace("{{USER}}", user.replace(/[<>&"]/g, ""))
          .replace('data-project="example"', `data-project="${project}"`),
      )
    }

    // Test pages: any /t/<name> path serves the same page, so each test has its own page.
    // `?project=<id>` and `?shortcut=<key>` change the script tag.
    if (url.pathname.startsWith("/t/")) {
      const attr = (name: string) => url.searchParams.get(name)?.replace(/[^\w-]/g, "")
      const page = await Bun.file(resolve(pages, "fixtures/test.html")).text()
      const project = attr("project") ?? "example"
      const shortcut = attr("shortcut")
      return html(
        page.replace(
          'data-project="example"',
          `data-project="${project}"${shortcut === undefined ? "" : ` data-shortcut="${shortcut}"`}`,
        ),
      )
    }

    let path = url.pathname.endsWith("/") ? `${url.pathname}index` : url.pathname
    if (!path.includes(".")) path += ".html"
    const file = Bun.file(resolve(pages, `.${path}`))
    if (!file.name?.startsWith(pages) || !(await file.exists())) return html("<h1>Not found</h1>", 404)
    if (path.endsWith(".html")) return html(await file.text())
    return new Response(file)
  },
})
console.log(`example: http://localhost:${port}`)
