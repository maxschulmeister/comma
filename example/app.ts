import { resolve } from "node:path"

// A static site that uses comma. Serves the files in example/pages.
const port = Number(process.env.PORT ?? 4100)
const pages = resolve(import.meta.dir, "pages")

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)
    let path = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname
    if (!path.includes(".")) path += ".html"
    const file = Bun.file(resolve(pages, `.${path}`))
    if (!file.name?.startsWith(pages) || !(await file.exists())) return new Response("Not found", { status: 404 })
    return new Response(file)
  },
})
console.log(`example: http://localhost:${port}`)
